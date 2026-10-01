import { Command } from 'commander';
import { parseConfig, type RawCliOptions } from './config.js';
import { run } from './engine.js';
import { reportText } from './reporter/text.js';
import { reportJson } from './reporter/json.js';
import { runSelfBenchmark } from './self-benchmark.js';

export function collectHeaders(val: string, memo: string[]): string[] {
  memo.push(val);
  return memo;
}

export function buildCli(): Command {
  const program = new Command();

  program
    .name('hlt')
    .description('High-performance HTTP load testing CLI for Node.js, powered by undici dispatch()')
    .version('0.1.0')
    .enablePositionalOptions();

  program
    .command('self-benchmark')
    .description('Compare hlt against itself on a local tiny HTTP server')
    .option('-n, --requests <number>', 'Total number of requests', '100000')
    .option('-c, --concurrency <number>', 'Concurrent requests', '100')
    .option('-r, --rate <number>', 'Target requests per second (TPS limit)')
    .option('-w, --workers <number>', 'Number of worker threads (default: 1)')
    .option('-W, --warmup <seconds>', 'Warmup duration in seconds (default: 0)')
    .option('--correct-latency', 'Enable Coordinated Omission latency correction')
    .option('--no-correct-latency', 'Disable Coordinated Omission latency correction')
    .option('--connections <number>', 'Pool connections')
    .option('--pipelining <number>', 'Pipeline depth', '1')
    .option('-o, --output <format>', 'Output format: text or json', 'text')
    .action(async (opts) => {
      try {
        await runSelfBenchmark(opts);
      } catch (err: any) {
        console.error(`Benchmark Error: ${err.message || err}`);
        process.exit(1);
      }
    });

  program
    .argument('[url]', 'Target URL to benchmark')
    .option('-n, --requests <number>', 'Total number of requests', '200')
    .option('-c, --concurrency <number>', 'Concurrent requests', '50')
    .option('-d, --duration <seconds>', 'Run for duration in seconds (overrides -n)')
    .option('-W, --warmup <seconds>', 'Warmup duration in seconds before recording metrics', '0')
    .option('--max-requests <number>', 'Maximum requests limit in duration mode')
    .option('-r, --rate <number>', 'Target requests per second (TPS / rate limit)')
    .option('-w, --workers <number>', 'Number of worker threads for multi-core scaling', '1')
    .option('--correct-latency', 'Enable Coordinated Omission latency correction (default on with --rate)')
    .option('--no-correct-latency', 'Disable Coordinated Omission latency correction')
    .option('--no-h2', 'Disable HTTP/2 support (defaults to enabled for HTTPS)')
    .option('-H, --header <header>', 'Add request header ("K: V"), repeatable', collectHeaders, [])
    .option('-m, --method <method>', 'HTTP method (GET, POST, PUT, DELETE, etc.)')
    .option('-b, --body <body>', 'Request body')
    .option('-t, --timeout <ms>', 'Request timeout in ms', '20000')
    .option('-o, --output <format>', 'Output format: text or json', 'text')
    .option('--connections <number>', 'Pool connections (defaults to concurrency)')
    .option('--pipelining <number>', 'Pipeline depth', '1')
    .action(async (url: string | undefined, opts: RawCliOptions) => {
      if (!url) {
        program.outputHelp();
        process.exit(1);
      }

      try {
        const config = parseConfig(url, opts);
        const snapshot = await run(config);

        if (config.output === 'json') {
          console.log(reportJson(config, snapshot));
        } else {
          console.log(reportText(config, snapshot));
        }
      } catch (err: any) {
        console.error(`Error: ${err.message || err}`);
        process.exit(1);
      }
    });

  return program;
}

export async function main() {
  const program = buildCli();
  await program.parseAsync(process.argv);
}
