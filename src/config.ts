export interface LoadConfig {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  requests: number;
  concurrency: number;
  duration: number;
  warmup: number; // Warmup duration in seconds before recording metrics (default 0)
  maxRequests?: number; // Hard safety limit for requests in duration mode
  timeout: number;
  connections: number;
  pipelining: number;
  output: 'text' | 'json';
  rate?: number; // Target requests per second (TPS / RPS limit)
  workers?: number; // Number of worker threads (default 1)
  allowH2?: boolean; // HTTP/2 support flag (default true for HTTPS)
  correctLatency?: boolean; // Enable Coordinated Omission latency correction
  expectedIntervalUs?: number; // Target interval between requests in microseconds
}

export interface RawCliOptions {
  requests?: string;
  concurrency?: string;
  duration?: string;
  warmup?: string;
  maxRequests?: string;
  header?: string[];
  method?: string;
  body?: string;
  timeout?: string;
  output?: string;
  connections?: string;
  pipelining?: string;
  rate?: string;
  workers?: string;
  h2?: boolean;
  correctLatency?: boolean;
}

export function parseHeaders(headerList?: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!headerList) return headers;

  for (const item of headerList) {
    const colonIdx = item.indexOf(':');
    if (colonIdx === -1) {
      headers[item.trim()] = '';
    } else {
      const key = item.slice(0, colonIdx).trim();
      const val = item.slice(colonIdx + 1).trim();
      if (key) {
        headers[key] = val;
      }
    }
  }
  return headers;
}

export function parseConfig(targetUrl: string, rawOptions: RawCliOptions): LoadConfig {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    throw new Error(`Invalid URL provided: "${targetUrl}"`);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`URL protocol must be http: or https:, received "${parsedUrl.protocol}"`);
  }

  const duration = rawOptions.duration ? Number(rawOptions.duration) : 0;
  if (isNaN(duration) || duration < 0) {
    throw new Error(`Invalid duration value: ${rawOptions.duration}`);
  }

  const warmup = rawOptions.warmup ? Number(rawOptions.warmup) : 0;
  if (isNaN(warmup) || warmup < 0) {
    throw new Error(`Invalid warmup value: ${rawOptions.warmup}. Must be >= 0.`);
  }

  let maxRequests: number | undefined;
  if (rawOptions.maxRequests !== undefined) {
    maxRequests = Number(rawOptions.maxRequests);
    if (isNaN(maxRequests) || maxRequests <= 0) {
      throw new Error(`Invalid max-requests value: ${rawOptions.maxRequests}. Must be > 0.`);
    }
  }

  const rawRequests = rawOptions.requests !== undefined ? Number(rawOptions.requests) : 200;
  if (isNaN(rawRequests) || rawRequests < 0) {
    throw new Error(`Invalid requests value: ${rawOptions.requests}`);
  }
  const requests = duration > 0 ? 0 : rawRequests;

  const concurrency = rawOptions.concurrency ? Number(rawOptions.concurrency) : 50;
  if (isNaN(concurrency) || concurrency <= 0) {
    throw new Error(`Invalid concurrency value: ${rawOptions.concurrency}. Must be >= 1.`);
  }

  const connections = rawOptions.connections ? Number(rawOptions.connections) : concurrency;
  if (isNaN(connections) || connections <= 0) {
    throw new Error(`Invalid connections value: ${rawOptions.connections}. Must be >= 1.`);
  }

  const pipelining = rawOptions.pipelining ? Number(rawOptions.pipelining) : 1;
  if (isNaN(pipelining) || pipelining <= 0) {
    throw new Error(`Invalid pipelining value: ${rawOptions.pipelining}. Must be >= 1.`);
  }

  const timeout = rawOptions.timeout ? Number(rawOptions.timeout) : 20000;
  if (isNaN(timeout) || timeout <= 0) {
    throw new Error(`Invalid timeout value: ${rawOptions.timeout}. Must be > 0.`);
  }

  let rate: number | undefined;
  let expectedIntervalUs: number | undefined;
  if (rawOptions.rate !== undefined) {
    rate = Number(rawOptions.rate);
    if (isNaN(rate) || rate <= 0) {
      throw new Error(`Invalid rate (TPS) value: ${rawOptions.rate}. Must be > 0.`);
    }
    expectedIntervalUs = Math.max(1, Math.round(1_000_000 / rate));
  }

  // Coordinated Omission: default to true when rate is configured, unless explicitly disabled
  const correctLatency =
    rawOptions.correctLatency !== undefined
      ? Boolean(rawOptions.correctLatency)
      : rate !== undefined && rate > 0;

  let workers = rawOptions.workers ? Number(rawOptions.workers) : 1;
  if (isNaN(workers) || workers <= 0) {
    throw new Error(`Invalid workers value: ${rawOptions.workers}. Must be >= 1.`);
  }

  const allowH2 = rawOptions.h2 !== undefined ? Boolean(rawOptions.h2) : true;

  const body = rawOptions.body ?? null;
  let method = rawOptions.method?.toUpperCase();
  if (!method) {
    method = body !== null ? 'POST' : 'GET';
  }

  const outputFormat = rawOptions.output?.toLowerCase();
  const output: 'text' | 'json' = outputFormat === 'json' ? 'json' : 'text';

  const headers = parseHeaders(rawOptions.header);

  return {
    url: parsedUrl,
    method,
    headers,
    body,
    requests,
    concurrency,
    duration,
    warmup,
    maxRequests,
    timeout,
    connections,
    pipelining,
    output,
    rate,
    workers,
    allowH2,
    correctLatency,
    expectedIntervalUs,
  };
}
