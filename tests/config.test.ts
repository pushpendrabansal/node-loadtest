import { describe, it, expect } from 'vitest';
import { parseConfig, parseHeaders } from '../src/config.js';

describe('config', () => {
  it('parses repeatable headers correctly', () => {
    const raw = ['Authorization: Bearer token123', 'Content-Type: application/json', 'X-Custom:'];
    const parsed = parseHeaders(raw);
    expect(parsed).toEqual({
      Authorization: 'Bearer token123',
      'Content-Type': 'application/json',
      'X-Custom': '',
    });
  });

  it('sets sensible defaults for basic GET', () => {
    const config = parseConfig('http://localhost:3000/api', {});
    expect(config.url.href).toBe('http://localhost:3000/api');
    expect(config.method).toBe('GET');
    expect(config.requests).toBe(200);
    expect(config.concurrency).toBe(50);
    expect(config.connections).toBe(50);
    expect(config.pipelining).toBe(1);
    expect(config.timeout).toBe(20000);
    expect(config.output).toBe('text');
    expect(config.rate).toBeUndefined();
  });

  it('parses rate / TPS setting', () => {
    const config = parseConfig('http://localhost:3000/api', {
      rate: '100',
    });
    expect(config.rate).toBe(100);
  });

  it('infers POST when body is provided without explicit method', () => {
    const config = parseConfig('http://localhost:3000/api', {
      body: '{"test":true}',
    });
    expect(config.method).toBe('POST');
    expect(config.body).toBe('{"test":true}');
  });

  it('handles duration mode overriding total requests', () => {
    const config = parseConfig('http://localhost:3000/api', {
      duration: '10',
      requests: '500',
    });
    expect(config.duration).toBe(10);
    expect(config.requests).toBe(0);
  });

  it('rejects invalid URLs', () => {
    expect(() => parseConfig('ftp://localhost:3000', {})).toThrow(/protocol must be http/);
    expect(() => parseConfig('invalid-url', {})).toThrow(/Invalid URL/);
  });

  it('parses warmup, maxRequests, and correctLatency options', () => {
    const config = parseConfig('http://localhost:3000/api', {
      warmup: '5',
      maxRequests: '1000',
      rate: '200',
    });
    expect(config.warmup).toBe(5);
    expect(config.maxRequests).toBe(1000);
    expect(config.correctLatency).toBe(true);
    expect(config.expectedIntervalUs).toBe(5000); // 1,000,000 / 200 = 5000 us
  });

  it('allows disabling correctLatency explicitly', () => {
    const config = parseConfig('http://localhost:3000/api', {
      rate: '100',
      correctLatency: false,
    });
    expect(config.correctLatency).toBe(false);
  });
});
