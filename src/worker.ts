import { workerData, parentPort } from 'node:worker_threads';
import { runSingle } from './engine-single.js';
import type { LoadConfig } from './config.js';

async function main() {
  const rawConfig = workerData.config;
  const config: LoadConfig = {
    ...rawConfig,
    url: new URL(rawConfig.url),
  };

  const abortController = new AbortController();

  const onMessage = (msg: any) => {
    if (msg?.type === 'stop') {
      abortController.abort();
    }
  };

  parentPort?.on('message', onMessage);

  try {
    const snapshot = await runSingle(config, { signal: abortController.signal });

    parentPort?.postMessage({
      type: 'done',
      snapshot: {
        ...snapshot,
        statusCodes: Array.from(snapshot.statusCodes.entries()),
        errors: Array.from(snapshot.errors.entries()),
      },
    });
  } catch (err: any) {
    parentPort?.postMessage({
      type: 'error',
      error: err?.message || String(err),
    });
  } finally {
    parentPort?.off('message', onMessage);
    parentPort?.unref?.();
  }
}

main().catch((err) => {
  parentPort?.postMessage({
    type: 'error',
    error: err?.message || String(err),
  });
});
