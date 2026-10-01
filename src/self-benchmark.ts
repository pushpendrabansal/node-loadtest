import http from 'node:http';
import { run } from './engine.js';
import { parseConfig } from './config.js';
import { reportText } from './reporter/text.js';
import { reportJson } from './reporter/json.js';

const RESPONSE_BODY = Buffer.from('{"status":"ok","message":"benchmark"}');

export async function runSelfBenchmark(options: {
  requests?: string;
  concurrency?: string;
  connections?: string;
  pipelining?: string;
  output?: string;
  rate?: string;
  workers?: string;
  warmup?: string;
  maxRequests?: string;
  correctLatency?: boolean;
}): Promise<void> {
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': RESPONSE_BODY.byteLength,
      Connection: 'keep-alive',
    });
    res.end(RESPONSE_BODY);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to bind local benchmark server');
  }

  const url = `http://127.0.0.1:${address.port}/`;

  try {
    const config = parseConfig(url, {
      requests: options.requests ?? '100000',
      concurrency: options.concurrency ?? '100',
      connections: options.connections,
      pipelining: options.pipelining,
      output: options.output ?? 'text',
      rate: options.rate,
      workers: options.workers,
      warmup: options.warmup,
      maxRequests: options.maxRequests,
      correctLatency: options.correctLatency,
    });

    if (config.output === 'text') {
      console.log(`Starting self-benchmark against embedded server on port ${address.port}...`);
    }

    const snapshot = await run(config);

    if (config.output === 'json') {
      console.log(reportJson(config, snapshot));
    } else {
      console.log(reportText(config, snapshot));
    }
  } finally {
    server.close();
  }
}
