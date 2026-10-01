# http-loadtest

> High-performance HTTP load testing CLI for Node.js, powered by undici `dispatch()`.

```bash
hlt https://api.example.com -n 10000 -c 100
```

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

---

## Features

- **Extreme Throughput**: Direct access to `undici.Pool.dispatch()` raw request dispatching.
- **Zero Per-Request Garbage**: Pre-allocated reusable request handler slots. No per-request allocations or result arrays.
- **Microsecond Precision Latency**: Monotonic `process.hrtime.bigint()` timing with high-dynamic-range histogram ([hdr-histogram-js](https://github.com/HdrHistogram/HdrHistogramJS)) measuring p50, p75, p90, p95, p99, and p99.9 percentiles.
- **Coordinated Omission Correction**: Automatic Gil Tene Coordinated Omission correction for rate-paced benchmarks, accurately capturing queue-time latency under saturation.
- **High-Precision Rate Pacing**: Sub-millisecond `setImmediate` + `hrtime` event loop scheduling that prevents `setTimeout` drift and clumping at high TPS (>1,000 req/s).
- **Connection Warm-Up Phase**: Discard connection setup and TLS handshake outliers with `-W, --warmup <seconds>` before recording benchmark metrics.
- **Multi-Core / Worker Threads Scaling**: Scale test generation across multiple CPU cores with `-w, --workers <number>`. Aggregates HDR histograms seamlessly without cross-thread lock contention.
- **Worker Fault Tolerance**: Resilient multi-worker execution that aggregates partial snapshots and tracks worker errors rather than aborting.
- **HTTP/2 Multiplexing Support**: Automatic ALPN HTTP/2 negotiation for HTTPS endpoints (`--no-h2` to force HTTP/1.1), avoiding TCP head-of-line blocking.
- **HTTP/1.1 Pipelining**: Increase saturation over high-latency links via `--pipelining <n>` (e.g. 4 or 8).
- **Fast Buffer Pre-Encoding**: Pre-encodes headers into flat arrays and string bodies into native Node Buffers, eliminating string parsing on the hot path.
- **Full Connection Control**: Configurable connection pooling (`--connections`) and HTTP pipelining depth (`--pipelining`).
- **Comprehensive Metrics**: Status code distribution, error breakdown, throughput (req/s), and bandwidth (MB/s).
- **Graceful Shutdown**: Thread-safe interception of `SIGINT` / `SIGTERM` across both main and worker threads to drain in-flight requests and snapshot metrics.
- **Multiple Output Formats**: Styled ANSI terminal report or machine-readable JSON (`-o json`).
- **Embedded Self-Benchmark**: Verify load tester capabilities against a local zero-latency loopback server.

---

## Install

```bash
npm install -g http-loadtest
# or run directly with npx
npx http-loadtest https://api.example.com -n 1000 -c 50
```

Requires **Node.js >= 20**.

---

## Usage

```bash
hlt <url> [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --requests <number>` | Total number of requests | `200` |
| `-c, --concurrency <number>` | Concurrent requests | `50` |
| `-d, --duration <seconds>` | Run for duration in seconds (overrides `-n`) | — |
| `-W, --warmup <seconds>` | Warm-up duration in seconds before recording metrics | `0` |
| `--max-requests <number>` | Hard safety limit for total requests in duration mode | — |
| `-r, --rate <number>` | Target requests per second (TPS / RPS limit) | — |
| `-w, --workers <number>` | Number of worker threads for multi-core scaling | `1` |
| `--correct-latency` | Enable Coordinated Omission latency correction (enabled by default with `-r`) | `true` with `-r` |
| `--no-correct-latency` | Disable Coordinated Omission latency correction | `false` |
| `--no-h2` | Disable HTTP/2 support (defaults to enabled for HTTPS) | `false` |
| `-H, --header <header>` | Add request header (`"K: V"`), repeatable | — |
| `-m, --method <method>` | HTTP method (`GET`, `POST`, `PUT`, `DELETE`, etc.) | `GET` (or `POST` if `-b`) |
| `-b, --body <body>` | Request body string | — |
| `-t, --timeout <ms>` | Request timeout in milliseconds | `20000` |
| `-o, --output <format>` | Output format: `text` or `json` | `text` |
| `--connections <number>` | Pool connection count | same as concurrency |
| `--pipelining <number>` | Pipeline depth per connection | `1` |

---

## Examples

### 1. Simple High-Concurrency Benchmark
```bash
hlt https://localhost:3000/api -n 100000 -c 500
```

### 2. Multi-Core Scaling Across CPU Threads
Scale test generation across 4 worker threads:
```bash
hlt https://localhost:3000/api -n 500000 -c 500 -w 4
```

### 3. HTTP Pipelining on Supported Servers
Pipeline 4 requests per connection:
```bash
hlt https://localhost:3000/api -n 100000 -c 100 --pipelining 4
```

### 4. Rate-Paced Test (100 TPS)
```bash
hlt https://localhost:3000/api -n 1000 -c 20 -r 100
```

### 5. Sustained Duration Test
Run for 30 seconds at 100 concurrency:
```bash
hlt https://localhost:3000/health -d 30 -c 100
```

### 6. Custom Headers & Auth Token
```bash
hlt https://localhost:3000/api \
  -n 50000 \
  -c 200 \
  -H "Authorization: Bearer my-secret-token" \
  -H "Accept: application/json"
```

### 7. POST Request with JSON Body
```bash
hlt https://localhost:3000/api \
  -m POST \
  -b '{"action":"test","active":true}' \
  -H "Content-Type: application/json" \
  -n 5000 \
  -c 50
```

### 8. Machine-Readable JSON Output
```bash
hlt https://localhost:3000/api -n 1000 -c 50 -o json > results.json
```

---

## Sample Output

```text
┌──────────────────────────────────────────────────────┐
│  hlt — Load Test Results                             │
├──────────────────────────────────────────────────────┤
│  Target:        http://127.0.0.1:3000/api            │
│  Method:        GET                                  │
│  Concurrency:   100                                  │
│  Duration:      2.21s                                │
│  Total Reqs:    100,000                              │
├──────────────────────────────────────────────────────┤
│  Throughput:    45,323.63 req/s                      │
│  Data:          3.53 MB (1.60 MB/s)                  │
├──────────────────────────────────────────────────────┤
│  Latency (ms)                                        │
│    p50    1.75                                       │
│    p75    2.10                                       │
│    p90    2.86                                       │
│    p95    3.39                                       │
│    p99    4.97                                       │
│    p99.9  17.79                                      │
│    min    0.10                                       │
│    max    34.56                                      │
│    mean   1.98                                       │
│    stdev  1.02                                       │
├──────────────────────────────────────────────────────┤
│  Status Codes                                        │
│    200    100,000                                    │
└──────────────────────────────────────────────────────┘
```

---

## Self-Benchmark Mode

Test hlt against an internal zero-allocation HTTP server on loopback to benchmark machine limits:

```bash
# Default (100k requests, 100 concurrency)
hlt self-benchmark

# Multi-core self benchmark with 4 workers
hlt self-benchmark -n 500000 -c 200 -w 4

# Rate-controlled benchmark (100 TPS)
hlt self-benchmark -n 1000 -c 20 -r 100
```

---

## Architecture & Performance Optimizations

```
CLI Parser (Commander.js)
       │
       ▼
Config & Options Validator (Workers, Rate, H2, Pipelining)
       │
       ▼
Load Engine (Single-thread or Multi-Worker Threads Orchestration)
       │
       ├─► Worker Thread 1 (undici.Pool.dispatch + RequestSlotHandler Pool)
       ├─► Worker Thread 2 (undici.Pool.dispatch + RequestSlotHandler Pool)
       └─► Worker Thread N ...
               │
               ▼
       Base64 Compressed HDR Histograms & Status Maps
               │
               ▼
Metrics Merger (Combines HDR Histograms + Accurate Percentiles)
               │
               ▼
Reporter (ANSI Box-Drawn Terminal or JSON)
```

1. **`dispatch()` over `request()` / `fetch()`**: Undici's low-level dispatch bypasses ReadableStream wrapping, Response object allocations, and header cloning.
2. **Reusable Handler Slot Pool**: Pre-allocates $C$ handler instances where $C$ is concurrency. Each handler is recycled with `reset()`, creating zero GC pressure on the hot path.
3. **HTTP/2 Multiplexing**: Enabled by default for HTTPS via ALPN negotiation. Multiplexes streams across connections without head-of-line blocking.
4. **Header Buffer Pre-Encoding**: Flat string array encoding `[key, value, ...]` and `Buffer.from(body)` avoid per-request object iteration.
5. **Multi-Worker Thread Scaling**: Overcomes the V8 single-thread execution limit by spawning $N$ Node.js `worker_threads` and merging compressed HDR histograms into unified latency percentiles.

---

## Development

```bash
# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Watch mode
npm run dev

# Run test suite
npm test

# Run self-benchmark
npm run self-benchmark
```

---

## License

MIT © [pushpendrabansal](https://github.com/pushpendrabansal)
