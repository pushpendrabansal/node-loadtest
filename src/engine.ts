import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { parseConfig, type LoadConfig, type RawCliOptions } from './config.js';
import { type MetricsSnapshot, type LatencyStats, mergeWorkerSnapshots, Metrics } from './metrics.js';
import { runSingle, type RunOptions } from './engine-single.js';

export type { RunOptions, LoadConfig, RawCliOptions, MetricsSnapshot, LatencyStats };
export { Metrics, mergeWorkerSnapshots, runSingle, parseConfig };

export function resolveWorkerPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidate1 = path.resolve(currentDir, './worker.js');
  if (fs.existsSync(candidate1)) {
    return candidate1;
  }
  const candidate2 = path.resolve(process.cwd(), './dist/worker.js');
  if (fs.existsSync(candidate2)) {
    return candidate2;
  }
  return candidate1;
}

export async function run(config: LoadConfig, options?: RunOptions): Promise<MetricsSnapshot> {
  const numWorkers = config.workers ?? 1;

  // Single worker or 1 worker thread: run directly in the main thread (zero IPC overhead)
  if (numWorkers <= 1) {
    return runSingle(config, options);
  }

  // Multi-Worker Thread Scaling
  const workerScriptPath = resolveWorkerPath();
  const startTime = process.hrtime.bigint();

  // Partition requests, concurrency, connections, rate, and maxRequests across workers
  const totalRequests = config.requests;
  const baseRequestsPerWorker = Math.floor(totalRequests / numWorkers);
  const remainderRequests = totalRequests % numWorkers;

  const totalConcurrency = config.concurrency;
  const baseConcurrency = Math.max(1, Math.floor(totalConcurrency / numWorkers));

  const totalConnections = config.connections;
  const baseConnections = Math.max(1, Math.floor(totalConnections / numWorkers));

  const ratePerWorker = config.rate ? config.rate / numWorkers : undefined;
  const workerMaxRequests = config.maxRequests
    ? Math.max(1, Math.floor(config.maxRequests / numWorkers))
    : undefined;

  const activeWorkers: Worker[] = [];

  const stopAllWorkers = () => {
    for (const w of activeWorkers) {
      try {
        w.postMessage({ type: 'stop' });
      } catch {
        // ignore
      }
    }
  };

  process.on('SIGINT', stopAllWorkers);
  process.on('SIGTERM', stopAllWorkers);

  if (options?.signal) {
    if (options.signal.aborted) {
      stopAllWorkers();
    } else {
      options.signal.addEventListener('abort', stopAllWorkers, { once: true });
    }
  }

  const workerPromises = Array.from({ length: numWorkers }, (_, index) => {
    const isFirst = index === 0;
    const workerRequests =
      config.duration > 0
        ? 0
        : baseRequestsPerWorker + (isFirst ? remainderRequests : 0);

    const workerConfig: LoadConfig = {
      ...config,
      url: new URL(config.url.href),
      requests: workerRequests,
      concurrency: baseConcurrency,
      connections: baseConnections,
      rate: ratePerWorker,
      maxRequests: workerMaxRequests,
      workers: 1,
      // In worker, expectedInterval is based on worker's individual rate
      expectedIntervalUs: ratePerWorker ? Math.max(1, Math.round(1_000_000 / ratePerWorker)) : undefined,
    };

    return new Promise<{ snapshot?: MetricsSnapshot; error?: Error }>((resolve) => {
      const worker = new Worker(workerScriptPath, {
        workerData: {
          config: {
            ...workerConfig,
            url: workerConfig.url.href, // serialize URL
          },
        },
      });

      activeWorkers.push(worker);
      let returnedSnapshot: MetricsSnapshot | undefined = undefined;
      let workerError: Error | undefined = undefined;

      worker.on('message', (msg) => {
        if (msg.type === 'done') {
          const raw = msg.snapshot;
          returnedSnapshot = {
            ...raw,
            statusCodes: new Map(raw.statusCodes),
            errors: new Map(raw.errors),
          };
          worker.terminate().catch(() => {});
          resolve({ snapshot: returnedSnapshot });
        } else if (msg.type === 'error') {
          workerError = new Error(msg.error);
          worker.terminate().catch(() => {});
          resolve({ error: workerError });
        }
      });

      worker.on('error', (err) => {
        workerError = err instanceof Error ? err : new Error(String(err));
        worker.terminate().catch(() => {});
        resolve({ error: workerError });
      });

      worker.on('exit', (code) => {
        if (returnedSnapshot) {
          resolve({ snapshot: returnedSnapshot });
        } else if (workerError) {
          resolve({ error: workerError });
        } else if (code !== 0) {
          resolve({ error: new Error(`Worker stopped with exit code ${code}`) });
        } else {
          resolve({ error: new Error('Worker exited without returning snapshot') });
        }
      });
    });
  });

  let workerResults: Array<{ snapshot?: MetricsSnapshot; error?: Error }>;
  try {
    workerResults = await Promise.all(workerPromises);
  } finally {
    process.off('SIGINT', stopAllWorkers);
    process.off('SIGTERM', stopAllWorkers);
  }

  const endTime = process.hrtime.bigint();
  const overallDurationSeconds = Math.max(0.0001, Number(endTime - startTime) / 1_000_000_000);

  const successfulSnapshots: Array<{ snapshot: MetricsSnapshot }> = [];
  const workerFailures: string[] = [];

  for (const res of workerResults) {
    if (res.snapshot) {
      successfulSnapshots.push({ snapshot: res.snapshot });
    } else if (res.error) {
      workerFailures.push(res.error.message || String(res.error));
    }
  }

  if (successfulSnapshots.length === 0) {
    throw new Error(`All workers failed: ${workerFailures.join('; ')}`);
  }

  const merged = mergeWorkerSnapshots(successfulSnapshots, overallDurationSeconds, config.expectedIntervalUs);

  // If some workers failed, record worker failures in the error map so partial results are preserved
  if (workerFailures.length > 0) {
    merged.errors.set(
      `WORKER_FAILURE (${workerFailures.length}/${numWorkers} workers failed)`,
      workerFailures.length,
    );
    merged.errorCount += workerFailures.length;
  }

  return merged;
}
