import type { MetricsSnapshot } from '../metrics.js';
import type { LoadConfig } from '../config.js';
import { formatBytes, formatDuration, formatNumber } from '../utils.js';

export function reportText(config: LoadConfig, snapshot: MetricsSnapshot): string {
  const width = 54;
  const line = '─'.repeat(width);
  const out: string[] = [];

  const row = (label: string, value: string): string => {
    const content = '  ' + label.padEnd(16) + value;
    return '│' + content.slice(0, width).padEnd(width) + '│';
  };

  const header = (title: string): string => {
    const content = '  ' + title;
    return '│' + content.slice(0, width).padEnd(width) + '│';
  };

  const statRow = (percentile: string, value: string): string => {
    const content = '    ' + percentile.padEnd(8) + value;
    return '│' + content.slice(0, width).padEnd(width) + '│';
  };

  out.push(`┌${line}┐`);
  out.push(header('hlt — Load Test Results'));
  out.push(`├${line}┤`);
  out.push(row('Target:', config.url.href));
  out.push(row('Method:', config.method));
  out.push(row('Concurrency:', String(config.concurrency)));
  if (config.rate) {
    out.push(row('Target Rate:', `${formatNumber(config.rate)} req/s`));
  }
  if (config.warmup > 0) {
    out.push(row('Warmup:', formatDuration(config.warmup)));
  }
  out.push(row('Duration:', formatDuration(snapshot.durationSeconds)));
  out.push(row('Total Reqs:', formatNumber(snapshot.totalRequests)));
  out.push(`├${line}┤`);
  out.push(row('Throughput:', `${formatNumber(snapshot.rps, 2)} req/s`));
  out.push(
    row(
      'Data:',
      `${formatBytes(snapshot.bytesRead)} (${formatBytes(snapshot.bytesPerSecond)}/s)`,
    ),
  );
  out.push(`├${line}┤`);
  out.push(header('Latency (ms)'));
  out.push(statRow('p50', snapshot.latencyMs.p50.toFixed(2)));
  out.push(statRow('p75', snapshot.latencyMs.p75.toFixed(2)));
  out.push(statRow('p90', snapshot.latencyMs.p90.toFixed(2)));
  out.push(statRow('p95', snapshot.latencyMs.p95.toFixed(2)));
  out.push(statRow('p99', snapshot.latencyMs.p99.toFixed(2)));
  out.push(statRow('p99.9', snapshot.latencyMs.p999.toFixed(2)));
  out.push(statRow('min', snapshot.latencyMs.min.toFixed(2)));
  out.push(statRow('max', snapshot.latencyMs.max.toFixed(2)));
  out.push(statRow('mean', snapshot.latencyMs.mean.toFixed(2)));
  out.push(statRow('stdev', snapshot.latencyMs.stddev.toFixed(2)));

  if (snapshot.correctedLatencyMs) {
    out.push(`├${line}┤`);
    out.push(header('Latency (CO Corrected) (ms)'));
    out.push(statRow('p50', snapshot.correctedLatencyMs.p50.toFixed(2)));
    out.push(statRow('p75', snapshot.correctedLatencyMs.p75.toFixed(2)));
    out.push(statRow('p90', snapshot.correctedLatencyMs.p90.toFixed(2)));
    out.push(statRow('p95', snapshot.correctedLatencyMs.p95.toFixed(2)));
    out.push(statRow('p99', snapshot.correctedLatencyMs.p99.toFixed(2)));
    out.push(statRow('p99.9', snapshot.correctedLatencyMs.p999.toFixed(2)));
    out.push(statRow('min', snapshot.correctedLatencyMs.min.toFixed(2)));
    out.push(statRow('max', snapshot.correctedLatencyMs.max.toFixed(2)));
    out.push(statRow('mean', snapshot.correctedLatencyMs.mean.toFixed(2)));
    out.push(statRow('stdev', snapshot.correctedLatencyMs.stddev.toFixed(2)));
  }

  out.push(`├${line}┤`);
  out.push(header('Status Codes'));

  if (snapshot.statusCodes.size === 0) {
    out.push(header('  (none)'));
  } else {
    for (const [code, count] of snapshot.statusCodes.entries()) {
      out.push(statRow(String(code), formatNumber(count)));
    }
  }

  if (snapshot.errorCount > 0) {
    out.push(`├${line}┤`);
    out.push(row('Errors:', String(snapshot.errorCount)));
    for (const [err, count] of snapshot.errors.entries()) {
      const errStr = `${err.slice(0, 28)}: ${formatNumber(count)}`;
      out.push(header(`  ${errStr}`));
    }
  }

  out.push(`└${line}┘`);
  return out.join('\n');
}
