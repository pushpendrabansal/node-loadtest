import { describe, it, expect } from 'vitest';
import { parseConfig } from '../src/config.js';
import { Metrics } from '../src/metrics.js';
import { reportText } from '../src/reporter/text.js';
import { reportJson } from '../src/reporter/json.js';

describe('reporter', () => {
  const config = parseConfig('http://localhost:3000/test', {
    concurrency: '20',
  });

  const metrics = new Metrics();
  metrics.start();
  metrics.recordSuccess(200, 1_500_000n, 120);
  metrics.recordSuccess(404, 2_000_000n, 50);
  const err = new Error('ECONNREFUSED');
  (err as any).code = 'ECONNREFUSED';
  metrics.recordError(err, 500_000n);
  metrics.stop();

  const snapshot = metrics.snapshot();

  it('generates text report containing key metrics', () => {
    const text = reportText(config, snapshot);
    expect(text).toContain('hlt — Load Test Results');
    expect(text).toContain('http://localhost:3000/test');
    expect(text).toContain('Latency (ms)');
    expect(text).toContain('Status Codes');
    expect(text).toContain('200');
    expect(text).toContain('404');
    expect(text).toContain('ECONNREFUSED');
  });

  it('generates valid JSON report', () => {
    const jsonStr = reportJson(config, snapshot);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.summary.url).toBe('http://localhost:3000/test');
    expect(parsed.summary.concurrency).toBe(20);
    expect(parsed.summary.totalRequests).toBe(3);
    expect(parsed.statusCodes['200']).toBe(1);
    expect(parsed.statusCodes['404']).toBe(1);
    expect(parsed.errors['ECONNREFUSED']).toBe(1);
    expect(parsed.latencyMs.p50).toBeDefined();
  });

  it('formats Coordinated Omission corrected latency and warmup in reports', () => {
    const rateConfig = parseConfig('http://localhost:3000/test', {
      concurrency: '10',
      rate: '100',
      warmup: '2',
    });

    const m = new Metrics(10000);
    m.start();
    m.recordSuccess(200, 1_000_000n, 100);
    m.stop();
    const snap = m.snapshot();

    const text = reportText(rateConfig, snap);
    expect(text).toContain('Warmup:');
    expect(text).toContain('Target Rate:');
    expect(text).toContain('Latency (CO Corrected) (ms)');

    const json = JSON.parse(reportJson(rateConfig, snap));
    expect(json.summary.warmup).toBe(2);
    expect(json.summary.rate).toBe(100);
    expect(json.correctedLatencyMs).toBeDefined();
    expect(json.correctedLatencyMs.p50).toBeDefined();
  });
});
