import type { Dispatcher } from 'undici';

export class RequestSlotHandler implements Dispatcher.DispatchHandler {
  public id: number;
  private startTime: bigint = 0n;
  private expectedStartTime: bigint = 0n;
  private statusCode: number = 0;
  private bytesRead: number = 0;
  private controller: Dispatcher.DispatchController | null = null;

  constructor(
    id: number,
    private readonly onDone: (slotId: number, status: number, latencyNs: bigint, bytes: number) => void,
    private readonly onFail: (slotId: number, error: Error, latencyNs: bigint) => void,
  ) {
    this.id = id;
  }

  public reset(expectedStartTime?: bigint): void {
    const now = process.hrtime.bigint();
    this.startTime = now;
    this.expectedStartTime = expectedStartTime && expectedStartTime < now ? expectedStartTime : now;
    this.statusCode = 0;
    this.bytesRead = 0;
    this.controller = null;
  }

  // --- undici v8 DispatchHandler methods ---
  public onRequestStart(controller: Dispatcher.DispatchController): void {
    this.controller = controller;
  }

  public onResponseStart(
    _controller: Dispatcher.DispatchController,
    statusCode: number,
    _headers: any,
    _statusMessage?: string,
  ): void {
    this.statusCode = statusCode;
  }

  public onResponseData(_controller: Dispatcher.DispatchController, chunk: Buffer): void {
    this.bytesRead += chunk.byteLength;
  }

  public onResponseEnd(_controller: Dispatcher.DispatchController, _trailers: any): void {
    const latency = process.hrtime.bigint() - this.expectedStartTime;
    this.onDone(this.id, this.statusCode, latency, this.bytesRead);
  }

  public onResponseError(_controller: Dispatcher.DispatchController, error: Error): void {
    const latency = process.hrtime.bigint() - this.expectedStartTime;
    this.onFail(this.id, error, latency);
  }

  // --- undici v7 compatibility fallbacks ---
  public onConnect(abort: () => void): void {
    // compatibility with older undici if needed
    (this as any).abortFn = abort;
  }

  public onHeaders(statusCode: number, _headers: any, _resume: () => void): boolean {
    this.statusCode = statusCode;
    return true;
  }

  public onData(chunk: Buffer): boolean {
    this.bytesRead += chunk.byteLength;
    return true;
  }

  public onComplete(_trailers: any): void {
    const latency = process.hrtime.bigint() - this.expectedStartTime;
    this.onDone(this.id, this.statusCode, latency, this.bytesRead);
  }

  public onError(err: Error): void {
    const latency = process.hrtime.bigint() - this.expectedStartTime;
    this.onFail(this.id, err, latency);
  }

  public abort(): void {
    if (this.controller) {
      try {
        this.controller.abort(new Error('Operation aborted'));
      } catch {
        // ignore
      }
    } else if ((this as any).abortFn) {
      try {
        (this as any).abortFn();
      } catch {
        // ignore
      }
    }
  }
}
