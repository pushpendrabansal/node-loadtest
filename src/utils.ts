export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const num = bytes / Math.pow(1024, i);
  return `${num.toFixed(2)} ${units[i]}`;
}

export function formatNumber(n: number, decimals = 0): string {
  if (decimals > 0) {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return n.toLocaleString('en-US');
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) {
    return `${(seconds * 1000).toFixed(0)}ms`;
  }
  return `${seconds.toFixed(2)}s`;
}

export function nsToMs(ns: bigint | number): number {
  if (typeof ns === 'bigint') {
    return Number(ns) / 1_000_000;
  }
  return ns / 1_000_000;
}
