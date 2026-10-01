import hdr from 'hdr-histogram-js';
import { nsToMs } from './utils.js';

export interface LatencyStats {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
  min: number;
  max: number;
  mean: number;
  stddev: number;
}

export interface MetricsSnapshot {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  durationSeconds: number;
  rps: number;
  bytesRead: number;
  bytesPerSecond: number;
  statusCodes: Map<number, number>;
  errors: Map<string, number>;
  latencyMs: LatencyStats;
  correctedLatencyMs?: LatencyStats;
  encodedHistogram?: string;
  expectedIntervalUs?: number;
}

export class Metrics {
  public totalRequests = 0;
  public successCount = 0;
  public errorCount = 0;
  public timeoutCount = 0;
  public bytesRead = 0;
  public statusCodes = new Map<number, number>();
  public errors = new Map<string, number>();
  public expectedIntervalUs?: number;

  private startTime: bigint = 0n;
  private endTime: bigint = 0n;
  // Histogram records latency in microseconds (1 microsecond to 1 minute, 3 sig figures)
  private histogram: any;

  constructor(expectedIntervalUs?: number) {
    this.expectedIntervalUs = expectedIntervalUs;
    this.histogram = hdr.build({
      lowestDiscernibleValue: 1,
      highestTrackableValue: 60_000_000,
      numberOfSignificantValueDigits: 3,
    });
  }

  public reset(): void {
    this.totalRequests = 0;
    this.successCount = 0;
    this.errorCount = 0;
    this.timeoutCount = 0;
    this.bytesRead = 0;
    this.statusCodes.clear();
    this.errors.clear();
    this.startTime = process.hrtime.bigint();
    this.endTime = 0n;
    if (this.histogram && typeof this.histogram.reset === 'function') {
      this.histogram.reset();
    }
  }

  public start(): void {
    this.startTime = process.hrtime.bigint();
  }

  public stop(): void {
    this.endTime = process.hrtime.bigint();
  }

  public recordSuccess(statusCode: number, latencyNs: bigint, bytes: number): void {
    this.totalRequests++;
    this.successCount++;
    this.bytesRead += bytes;

    const count = this.statusCodes.get(statusCode) || 0;
    this.statusCodes.set(statusCode, count + 1);

    // Convert nanoseconds to microseconds for HDR histogram
    const latencyUs = Math.max(1, Math.min(60_000_000, Number(latencyNs / 1000n)));
    this.histogram.recordValue(latencyUs);
  }

  public recordError(error: Error, latencyNs: bigint): void {
    this.totalRequests++;
    this.errorCount++;

    const isTimeout =
      error.message?.includes('timeout') ||
      (error as any).code === 'UND_ERR_HEADERS_TIMEOUT' ||
      (error as any).code === 'UND_ERR_BODY_TIMEOUT';

    if (isTimeout) {
      this.timeoutCount++;
    }

    const errKey = (error as any).code || error.message || 'UNKNOWN_ERROR';
    const count = this.errors.get(errKey) || 0;
    this.errors.set(errKey, count + 1);

    const latencyUs = Math.max(1, Math.min(60_000_000, Number(latencyNs / 1000n)));
    this.histogram.recordValue(latencyUs);
  }

  public addHistogram(otherHistogram: any): void {
    if (otherHistogram) {
      this.histogram.add(otherHistogram);
    }
  }

  public getRawHistogram(): any {
    return this.histogram;
  }

  public snapshot(expectedIntervalUs?: number): MetricsSnapshot {
    const end = this.endTime || process.hrtime.bigint();
    const durationNs = end - this.startTime;
    const durationSeconds = Math.max(0.0001, Number(durationNs) / 1_000_000_000);

    const rps = this.totalRequests / durationSeconds;
    const bytesPerSecond = this.bytesRead / durationSeconds;

    // Convert microseconds to milliseconds (us / 1000)
    const usToMs = (us: number) => us / 1000;

    let encodedHistogram: string | undefined;
    try {
      encodedHistogram = hdr.encodeIntoCompressedBase64(this.histogram);
    } catch {
      // ignore
    }

    const interval = expectedIntervalUs ?? this.expectedIntervalUs;
    let correctedLatencyMs: LatencyStats | undefined;

    if (interval && interval > 0 && this.histogram.totalCount > 0) {
      try {
        const correctedHist = this.histogram.copyCorrectedForCoordinatedOmission(interval);
        correctedLatencyMs = {
          p50: usToMs(correctedHist.getValueAtPercentile(50)),
          p75: usToMs(correctedHist.getValueAtPercentile(75)),
          p90: usToMs(correctedHist.getValueAtPercentile(90)),
          p95: usToMs(correctedHist.getValueAtPercentile(95)),
          p99: usToMs(correctedHist.getValueAtPercentile(99)),
          p999: usToMs(correctedHist.getValueAtPercentile(99.9)),
          min: usToMs(correctedHist.minNonZeroValue || correctedHist.minValue),
          max: usToMs(correctedHist.maxValue),
          mean: usToMs(correctedHist.mean),
          stddev: usToMs(correctedHist.stdDeviation),
        };
      } catch {
        // ignore
      }
    }

    return {
      totalRequests: this.totalRequests,
      successCount: this.successCount,
      errorCount: this.errorCount,
      timeoutCount: this.timeoutCount,
      durationSeconds,
      rps,
      bytesRead: this.bytesRead,
      bytesPerSecond,
      statusCodes: new Map(this.statusCodes),
      errors: new Map(this.errors),
      latencyMs: {
        p50: usToMs(this.histogram.getValueAtPercentile(50)),
        p75: usToMs(this.histogram.getValueAtPercentile(75)),
        p90: usToMs(this.histogram.getValueAtPercentile(90)),
        p95: usToMs(this.histogram.getValueAtPercentile(95)),
        p99: usToMs(this.histogram.getValueAtPercentile(99)),
        p999: usToMs(this.histogram.getValueAtPercentile(99.9)),
        min: usToMs(this.histogram.minNonZeroValue || this.histogram.minValue),
        max: usToMs(this.histogram.maxValue),
        mean: usToMs(this.histogram.mean),
        stddev: usToMs(this.histogram.stdDeviation),
      },
      correctedLatencyMs,
      encodedHistogram,
      expectedIntervalUs: interval,
    };
  }
}

/**
 * Merge multiple Metrics snapshots or raw metrics from worker threads into a single aggregated snapshot.
 */
export function mergeWorkerSnapshots(
  workerSnapshots: Array<{
    snapshot: MetricsSnapshot;
  }>,
  overallDurationSeconds: number,
  expectedIntervalUs?: number,
): MetricsSnapshot {
  const mergedMetrics = new Metrics();
  let totalBytes = 0;
  let totalSuccess = 0;
  let totalErrors = 0;
  let totalTimeouts = 0;
  let totalReqs = 0;

  for (const { snapshot } of workerSnapshots) {
    totalReqs += snapshot.totalRequests;
    totalSuccess += snapshot.successCount;
    totalErrors += snapshot.errorCount;
    totalTimeouts += snapshot.timeoutCount;
    totalBytes += snapshot.bytesRead;

    for (const [code, count] of snapshot.statusCodes.entries()) {
      mergedMetrics.statusCodes.set(code, (mergedMetrics.statusCodes.get(code) || 0) + count);
    }
    for (const [err, count] of snapshot.errors.entries()) {
      mergedMetrics.errors.set(err, (mergedMetrics.errors.get(err) || 0) + count);
    }

    if (snapshot.encodedHistogram) {
      try {
        const decoded = hdr.decodeFromCompressedBase64(snapshot.encodedHistogram);
        mergedMetrics.addHistogram(decoded);
      } catch {
        // ignore
      }
    }
  }

  const usToMs = (us: number) => us / 1000;
  const hist = mergedMetrics.getRawHistogram();
  const safeDuration = Math.max(0.0001, overallDurationSeconds);

  let correctedLatencyMs: LatencyStats | undefined;
  if (expectedIntervalUs && expectedIntervalUs > 0 && hist.totalCount > 0) {
    try {
      const correctedHist = hist.copyCorrectedForCoordinatedOmission(expectedIntervalUs);
      correctedLatencyMs = {
        p50: usToMs(correctedHist.getValueAtPercentile(50)),
        p75: usToMs(correctedHist.getValueAtPercentile(75)),
        p90: usToMs(correctedHist.getValueAtPercentile(90)),
        p95: usToMs(correctedHist.getValueAtPercentile(95)),
        p99: usToMs(correctedHist.getValueAtPercentile(99)),
        p999: usToMs(correctedHist.getValueAtPercentile(99.9)),
        min: usToMs(correctedHist.minNonZeroValue || correctedHist.minValue),
        max: usToMs(correctedHist.maxValue),
        mean: usToMs(correctedHist.mean),
        stddev: usToMs(correctedHist.stdDeviation),
      };
    } catch {
      // ignore
    }
  }

  let encodedHistogram: string | undefined;
  try {
    encodedHistogram = hdr.encodeIntoCompressedBase64(hist);
  } catch {
    // ignore
  }

  return {
    totalRequests: totalReqs,
    successCount: totalSuccess,
    errorCount: totalErrors,
    timeoutCount: totalTimeouts,
    durationSeconds: safeDuration,
    rps: totalReqs / safeDuration,
    bytesRead: totalBytes,
    bytesPerSecond: totalBytes / safeDuration,
    statusCodes: mergedMetrics.statusCodes,
    errors: mergedMetrics.errors,
    latencyMs: {
      p50: usToMs(hist.getValueAtPercentile(50)),
      p75: usToMs(hist.getValueAtPercentile(75)),
      p90: usToMs(hist.getValueAtPercentile(90)),
      p95: usToMs(hist.getValueAtPercentile(95)),
      p99: usToMs(hist.getValueAtPercentile(99)),
      p999: usToMs(hist.getValueAtPercentile(99.9)),
      min: usToMs(hist.minNonZeroValue || hist.minValue),
      max: usToMs(hist.maxValue),
      mean: usToMs(hist.mean),
      stddev: usToMs(hist.stdDeviation),
    },
    correctedLatencyMs,
    encodedHistogram,
    expectedIntervalUs,
  };
}
