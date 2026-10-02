import { ApiError } from './http.js';

export interface NdjsonErrorFrame { type: 'error'; error: string; message: string; }
export interface NdjsonOptions extends ResponseInit { onError?: (error: unknown) => unknown; }
export function errorFrame(error: unknown): NdjsonErrorFrame {
  let code = 'worker_error';
  let message = error instanceof Error ? error.message : String(error);
  if (error instanceof ApiError) {
    code = 'provider_error';
    try {
      const body = JSON.parse(error.message);
      const detail = body.detail ?? body;
      if (typeof detail === 'string') message = detail;
      else if (detail && typeof detail === 'object') {
        if (typeof detail.error === 'string') code = detail.error;
        if (typeof detail.message === 'string') message = detail.message;
      }
    } catch {}
  }
  return { type: 'error', error: code, message };
}
export function toNdjson<T>(source: AsyncIterable<T> | Iterable<T>, options: NdjsonOptions = {}): Response {
  const { onError = errorFrame, headers, ...init } = options;
  const iterator = Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
  const encoder = new TextEncoder();
  const line = (value: unknown) => encoder.encode(JSON.stringify(value) + '\n');
  let finished = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      try {
        const next = await iterator.next();
        if (next.done) { finished = true; controller.close(); return; }
        controller.enqueue(line(next.value));
      } catch (error) {
        finished = true;
        controller.enqueue(line(onError(error)));
        controller.close();
        await iterator.return?.();
      }
    },
    async cancel(reason) { finished = true; await iterator.return?.(reason); },
  });
  const responseHeaders = new Headers(headers);
  if (!responseHeaders.has('content-type')) responseHeaders.set('content-type', 'application/x-ndjson; charset=utf-8');
  if (!responseHeaders.has('cache-control')) responseHeaders.set('cache-control', 'no-cache');
  responseHeaders.set('x-accel-buffering', 'no');
  return new Response(stream, { ...init, headers: responseHeaders });
}
