import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { run } from '../src/engine.js';
import { parseConfig } from '../src/config.js';

describe('engine', () => {
  let server: http.Server;
  let serverUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/slow') {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('slow ok');
        }, 50);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string') {
          serverUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('runs exactly N requests in count mode', async () => {
    const config = parseConfig(serverUrl, {
      requests: '150',
      concurrency: '10',
    });

    const snapshot = await run(config);

    expect(snapshot.totalRequests).toBe(150);
    expect(snapshot.successCount).toBe(150);
    expect(snapshot.errorCount).toBe(0);
    expect(snapshot.statusCodes.get(200)).toBe(150);
    expect(snapshot.rps).toBeGreaterThan(0);
  });

  it('runs within duration bounds in duration mode', async () => {
    const config = parseConfig(serverUrl, {
      duration: '1',
      concurrency: '10',
    });

    const snapshot = await run(config);

    expect(snapshot.totalRequests).toBeGreaterThan(10);
    expect(snapshot.durationSeconds).toBeGreaterThanOrEqual(0.9);
    expect(snapshot.durationSeconds).toBeLessThanOrEqual(2.5);
  });

  it('controls request rate when rate (TPS) is configured', async () => {
    const config = parseConfig(serverUrl, {
      requests: '100',
      concurrency: '20',
      rate: '50', // 50 requests per second
    });

    const snapshot = await run(config);

    expect(snapshot.totalRequests).toBe(100);
    expect(snapshot.successCount).toBe(100);
    expect(snapshot.durationSeconds).toBeGreaterThanOrEqual(1.5);
    expect(snapshot.rps).toBeLessThanOrEqual(70);
  });

  it('scales across multiple worker threads', async () => {
    const config = parseConfig(serverUrl, {
      requests: '200',
      concurrency: '20',
      workers: '2',
    });

    const snapshot = await run(config);

    expect(snapshot.totalRequests).toBe(200);
    expect(snapshot.successCount).toBe(200);
    expect(snapshot.errorCount).toBe(0);
    expect(snapshot.statusCodes.get(200)).toBe(200);
    expect(snapshot.latencyMs.p50).toBeGreaterThan(0);
  });

  it('runs warm-up phase before recording benchmark metrics', async () => {
    const config = parseConfig(serverUrl, {
      requests: '50',
      concurrency: '10',
      warmup: '1', // 1 second warmup
    });

    const snapshot = await run(config);

    // Warm-up requests are discarded; recorded requests must match target count
    expect(snapshot.totalRequests).toBe(50);
    expect(snapshot.successCount).toBe(50);
  });

  it('honors max-requests safety cap in duration mode', async () => {
    const config = parseConfig(serverUrl, {
      duration: '10', // long duration
      concurrency: '5',
      maxRequests: '25', // stop at 25 requests
    });

    const startTime = Date.now();
    const snapshot = await run(config);
    const elapsedMs = Date.now() - startTime;

    expect(snapshot.totalRequests).toBe(25);
    // Should finish in much less than 10 seconds (typically < 500ms)
    expect(elapsedMs).toBeLessThan(5000);
  });

  it('computes Coordinated Omission corrected latency during rate-paced runs', async () => {
    const config = parseConfig(`${serverUrl}/slow`, {
      requests: '30',
      concurrency: '5',
      rate: '50',
    });

    const snapshot = await run(config);
    expect(snapshot.totalRequests).toBe(30);
    expect(snapshot.correctedLatencyMs).toBeDefined();
    expect(snapshot.correctedLatencyMs!.p50).toBeGreaterThan(0);
    expect(snapshot.correctedLatencyMs!.p99).toBeGreaterThan(0);
  });
});
