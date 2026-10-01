import { describe, it, expect } from 'vitest';
import { Metrics } from '../src/metrics.js';

describe('metrics', () => {
  it('correctly tallies success, status codes, and latency percentiles', () => {
    const metrics = new Metrics();
    metrics.start();

    // 100 successful requests at 1ms (1,000,000 ns) each
    for (let i = 0; i < 90; i++) {
      metrics.recordSuccess(200, 1_000_000n, 100);
    }
    // 10 successful requests at 10ms (10,000,000 ns) each
    for (let i = 0; i < 10; i++) {
      metrics.recordSuccess(200, 10_000_000n, 100);
    }

    metrics.stop();
    const snapshot = metrics.snapshot();

    expect(snapshot.totalRequests).toBe(100);
    expect(snapshot.successCount).toBe(100);
    expect(snapshot.errorCount).toBe(0);
    expect(snapshot.bytesRead).toBe(10000);
    expect(snapshot.statusCodes.get(200)).toBe(100);

    // p50 should be around 1ms, p99 should be around 10ms
    expect(snapshot.latencyMs.p50).toBeGreaterThanOrEqual(0.9);
    expect(snapshot.latencyMs.p50).toBeLessThanOrEqual(2.0);
    expect(snapshot.latencyMs.p99).toBeGreaterThanOrEqual(9.0);
  });

  it('correctly tallies errors and timeout count', () => {
    const metrics = new Metrics();
    metrics.start();

    const timeoutErr = new Error('Request headers timeout');
    (timeoutErr as any).code = 'UND_ERR_HEADERS_TIMEOUT';

    metrics.recordError(timeoutErr, 500_000n);
    metrics.recordError(new Error('ECONNRESET'), 200_000n);

    metrics.stop();
    const snapshot = metrics.snapshot();

    expect(snapshot.totalRequests).toBe(2);
    expect(snapshot.errorCount).toBe(2);
    expect(snapshot.timeoutCount).toBe(1);
    expect(snapshot.errors.get('UND_ERR_HEADERS_TIMEOUT')).toBe(1);
    expect(snapshot.errors.get('ECONNRESET')).toBe(1);
  });

  it('resets all counters and histogram with reset()', () => {
    const metrics = new Metrics();
    metrics.start();
    metrics.recordSuccess(200, 1_000_000n, 500);
    metrics.recordError(new Error('fail'), 1_000_000n);

    expect(metrics.totalRequests).toBe(2);

    metrics.reset();
    expect(metrics.totalRequests).toBe(0);
    expect(metrics.successCount).toBe(0);
    expect(metrics.errorCount).toBe(0);
    expect(metrics.bytesRead).toBe(0);
    expect(metrics.statusCodes.size).toBe(0);
    expect(metrics.errors.size).toBe(0);
  });

  it('corrects for Coordinated Omission when expectedIntervalUs is provided', () => {
    const expectedIntervalUs = 1000; // 1ms expected interval (1000 TPS)
    const metrics = new Metrics(expectedIntervalUs);
    metrics.start();

    // 99 requests at 1ms
    for (let i = 0; i < 99; i++) {
      metrics.recordSuccess(200, 1_000_000n, 10);
    }
    // 1 request at 1000ms (1 second stall)
    metrics.recordSuccess(200, 1_000_000_000n, 10);

    metrics.stop();
    const snapshot = metrics.snapshot();

    // Uncorrected p99 will only reflect 99/100, which is around 1ms
    expect(snapshot.latencyMs.p99).toBeLessThan(10);

    // Coordinated Omission corrected latency MUST account for the 1000 missing samples
    expect(snapshot.correctedLatencyMs).toBeDefined();
    expect(snapshot.correctedLatencyMs!.p99).toBeGreaterThanOrEqual(900);
    expect(snapshot.correctedLatencyMs!.p50).toBeGreaterThanOrEqual(400);
  });
});
