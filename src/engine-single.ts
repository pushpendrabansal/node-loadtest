import { isMainThread } from 'node:worker_threads';
import { Pool, Client } from 'undici';
import type { Dispatcher } from 'undici';
import type { LoadConfig } from './config.js';
import { Metrics, type MetricsSnapshot } from './metrics.js';
import { RequestSlotHandler } from './handler.js';

export interface RunOptions {
  onProgress?: (completed: number, inflight: number) => void;
  signal?: AbortSignal;
}

export async function runSingle(config: LoadConfig, options?: RunOptions): Promise<MetricsSnapshot> {
  const isHttps = config.url.protocol === 'https:';
  const allowH2 = config.allowH2 ?? true;

  // Undici Pool creation with HTTP/2 support & connection pooling
  const pool = new Pool(config.url.origin, {
    connections: config.connections,
    pipelining: config.pipelining,
    headersTimeout: config.timeout,
    bodyTimeout: config.timeout,
    allowH2: isHttps && allowH2,
    factory: (origin, opts) => {
      return new Client(origin, {
        ...opts,
        allowH2: isHttps && allowH2,
      });
    },
  });

  const metrics = new Metrics(config.expectedIntervalUs);
  metrics.start();

  const pathAndQuery = `${config.url.pathname}${config.url.search}`;

  // Optimization: Pre-encode headers as a flat Array [key, value, key, value]
  const rawHeadersList: string[] = [];
  for (const [key, value] of Object.entries(config.headers)) {
    rawHeadersList.push(key, value);
  }

  // Pre-encode request body into Buffer if given as string
  const bodyBuffer: Buffer | null =
    typeof config.body === 'string' ? Buffer.from(config.body) : null;

  const dispatchOpts: Dispatcher.DispatchOptions = {
    origin: config.url.origin,
    path: pathAndQuery || '/',
    method: config.method as Dispatcher.HttpMethod,
    headers: rawHeadersList.length > 0 ? rawHeadersList : undefined,
    body: bodyBuffer ?? undefined,
  };

  const freeSlots: number[] = [];
  const handlers: RequestSlotHandler[] = [];
  const slotIsWarmup = new Array<boolean>(config.concurrency).fill(false);

  let sent = 0;
  let inflight = 0;
  let isDone = false;
  let isDrained = true;
  let isWarmingUp = config.warmup > 0;
  let resolvePromise: (snapshot: MetricsSnapshot) => void;

  // Rate Limiting (TPS) State
  const isRateLimited = config.rate !== undefined && config.rate > 0;
  const targetRate = isRateLimited ? config.rate! : 0;
  let rateTimer: NodeJS.Timeout | NodeJS.Immediate | null = null;
  let isRateTimerImmediate = false;
  let startHrTime = process.hrtime.bigint();

  const clearRateTimer = () => {
    if (rateTimer) {
      if (isRateTimerImmediate) {
        clearImmediate(rateTimer as NodeJS.Immediate);
      } else {
        clearTimeout(rateTimer as NodeJS.Timeout);
      }
      rateTimer = null;
      isRateTimerImmediate = false;
    }
  };

  const scheduleNextRateTick = (delayMs: number) => {
    if (rateTimer || isDone) return;
    // For sub-millisecond or fast pacing: use setImmediate to yield to libuv loop without 1-4ms timer floor
    if (delayMs <= 1.5) {
      isRateTimerImmediate = true;
      rateTimer = setImmediate(() => {
        rateTimer = null;
        isRateTimerImmediate = false;
        schedule();
      });
    } else {
      isRateTimerImmediate = false;
      rateTimer = setTimeout(() => {
        rateTimer = null;
        isRateTimerImmediate = false;
        schedule();
      }, Math.floor(delayMs));
    }
  };

  const onSlotDone = (slotId: number, status: number, latencyNs: bigint, bytes: number) => {
    if (!slotIsWarmup[slotId]) {
      metrics.recordSuccess(status, latencyNs, bytes);
      options?.onProgress?.(metrics.totalRequests, inflight);
    }
    inflight--;
    freeSlots.push(slotId);
    schedule();
  };

  const onSlotFail = (slotId: number, error: Error, latencyNs: bigint) => {
    if (!slotIsWarmup[slotId]) {
      metrics.recordError(error, latencyNs);
      options?.onProgress?.(metrics.totalRequests, inflight);
    }
    inflight--;
    freeSlots.push(slotId);
    schedule();
  };

  for (let i = 0; i < config.concurrency; i++) {
    handlers.push(new RequestSlotHandler(i, onSlotDone, onSlotFail));
    freeSlots.push(i);
  }

  let durationTimer: NodeJS.Timeout | null = null;
  let warmupTimer: NodeJS.Timeout | null = null;

  const stop = () => {
    if (!isDone) {
      isDone = true;
      if (warmupTimer) {
        clearTimeout(warmupTimer);
        warmupTimer = null;
      }
      if (durationTimer) {
        clearTimeout(durationTimer);
        durationTimer = null;
      }
      clearRateTimer();
      checkCompletion();
    }
  };

  const finishWarmup = () => {
    if (isDone) return;
    isWarmingUp = false;
    warmupTimer = null;
    metrics.reset();
    metrics.start();
    startHrTime = process.hrtime.bigint();
    sent = 0;

    // Start duration timer now that warm-up is complete
    if (config.duration > 0) {
      durationTimer = setTimeout(stop, config.duration * 1000);
    }
    schedule();
  };

  if (isWarmingUp) {
    warmupTimer = setTimeout(finishWarmup, config.warmup * 1000);
  } else if (config.duration > 0) {
    durationTimer = setTimeout(stop, config.duration * 1000);
  }

  // Handle abort signal
  if (options?.signal) {
    if (options.signal.aborted) {
      stop();
    } else {
      options.signal.addEventListener('abort', () => stop(), { once: true });
    }
  }

  // Process signals: ONLY in main thread to avoid collisions in worker threads
  let sigintHandler: (() => void) | null = null;
  if (isMainThread) {
    sigintHandler = () => {
      stop();
    };
    process.on('SIGINT', sigintHandler);
    process.on('SIGTERM', sigintHandler);
  }

  const checkCompletion = () => {
    if (isDone && inflight === 0) {
      metrics.stop();
      clearRateTimer();
      if (warmupTimer) {
        clearTimeout(warmupTimer);
        warmupTimer = null;
      }
      if (durationTimer) {
        clearTimeout(durationTimer);
        durationTimer = null;
      }
      if (sigintHandler) {
        process.off('SIGINT', sigintHandler);
        process.off('SIGTERM', sigintHandler);
        sigintHandler = null;
      }
      pool.close().catch(() => {});
      resolvePromise(metrics.snapshot(config.expectedIntervalUs));
    }
  };

  pool.on('drain', () => {
    isDrained = true;
    schedule();
  });

  const schedule = () => {
    if (isDone) {
      checkCompletion();
      return;
    }

    // Count mode termination check (only when not warming up)
    if (!isWarmingUp && config.requests > 0 && sent >= config.requests) {
      isDone = true;
      checkCompletion();
      return;
    }

    // Safety limit check (maxRequests in duration mode)
    if (!isWarmingUp && config.maxRequests && config.maxRequests > 0 && sent >= config.maxRequests) {
      isDone = true;
      checkCompletion();
      return;
    }

    if (isRateLimited) {
      const now = process.hrtime.bigint();
      const elapsedSeconds = Number(now - startHrTime) / 1_000_000_000;
      const maxAllowed = Math.floor(elapsedSeconds * targetRate) + 1;

      if (sent >= maxAllowed) {
        const nextAllowedAt = sent / targetRate;
        const delayMs = Math.max(0, (nextAllowedAt - elapsedSeconds) * 1000);
        scheduleNextRateTick(delayMs);
        return;
      }
    }

    // Dispatch while slots and pool capacity permit
    while (!isDone && freeSlots.length > 0 && isDrained) {
      if (!isWarmingUp && config.requests > 0 && sent >= config.requests) {
        isDone = true;
        checkCompletion();
        break;
      }

      if (!isWarmingUp && config.maxRequests && config.maxRequests > 0 && sent >= config.maxRequests) {
        isDone = true;
        checkCompletion();
        break;
      }

      let expectedStartNs: bigint | undefined;
      if (isRateLimited) {
        const now = process.hrtime.bigint();
        const elapsedSeconds = Number(now - startHrTime) / 1_000_000_000;
        const maxAllowed = Math.floor(elapsedSeconds * targetRate) + 1;
        if (sent >= maxAllowed) {
          const nextAllowedAt = sent / targetRate;
          const delayMs = Math.max(0, (nextAllowedAt - elapsedSeconds) * 1000);
          scheduleNextRateTick(delayMs);
          break;
        }

        // Expected scheduled start time for Coordinated Omission correction
        if (config.correctLatency) {
          const scheduledDelayNs = BigInt(Math.floor((sent / targetRate) * 1_000_000_000));
          expectedStartNs = startHrTime + scheduledDelayNs;
        }
      }

      const slotId = freeSlots.pop()!;
      slotIsWarmup[slotId] = isWarmingUp;
      const handler = handlers[slotId];
      handler.reset(expectedStartNs);

      sent++;
      inflight++;

      const canAcceptMore = pool.dispatch(dispatchOpts, handler);
      if (!canAcceptMore) {
        isDrained = false;
        break;
      }
    }

    if (isDone) {
      checkCompletion();
    }
  };

  return new Promise<MetricsSnapshot>((resolve) => {
    resolvePromise = resolve;
    // Kick off dispatching
    schedule();
  });
}
