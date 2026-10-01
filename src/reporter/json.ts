import type { MetricsSnapshot } from '../metrics.js';
import type { LoadConfig } from '../config.js';

export function reportJson(config: LoadConfig, snapshot: MetricsSnapshot): string {
  const jsonReport = {
    summary: {
      url: config.url.href,
      method: config.method,
      concurrency: config.concurrency,
      connections: config.connections,
      pipelining: config.pipelining,
      rate: config.rate ?? null,
      warmup: config.warmup,
      maxRequests: config.maxRequests ?? null,
      totalRequests: snapshot.totalRequests,
      successCount: snapshot.successCount,
      errorCount: snapshot.errorCount,
      timeoutCount: snapshot.timeoutCount,
      durationSeconds: snapshot.durationSeconds,
      rps: snapshot.rps,
      bytesRead: snapshot.bytesRead,
      bytesPerSecond: snapshot.bytesPerSecond,
    },
    latencyMs: snapshot.latencyMs,
    correctedLatencyMs: snapshot.correctedLatencyMs ?? null,
    statusCodes: Object.fromEntries(snapshot.statusCodes.entries()),
    errors: Object.fromEntries(snapshot.errors.entries()),
  };

  return JSON.stringify(jsonReport, null, 2);
}
