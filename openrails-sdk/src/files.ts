import { ApiError, buildUrl, call, send } from './http.js';
import type { FileMeta, FileResolvedUrl, FileUrlBatch } from './types.js';
import { encPath } from './util.js';

export type FileData = string | ArrayBuffer | ArrayBufferView<ArrayBuffer> | Blob | ReadableStream<Uint8Array>;
async function put(name: string, data: FileData, contentType?: string): Promise<FileMeta> {
  encPath(name);
  const type = contentType ?? (data instanceof Blob && data.type ? data.type : typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/octet-stream');
  const response = await send(buildUrl('/files/blob', { name }), {
    method: 'PUT', body: data, headers: { 'content-type': type },
    ...(data instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return await response.json() as FileMeta;
}
async function get(name: string): Promise<Response | null> {
  const response = await send(buildUrl(`/files/${encPath(name)}`), { method: 'GET' });
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return response;
}
export const files = {
  put, get,
  url(name: string): Promise<FileResolvedUrl> { encPath(name); return call('POST', '/files/url', { body: { name } }); },
  urls(names: string[]): Promise<FileUrlBatch> { names.forEach(encPath); return call('POST', '/files/urls', { body: { names } }); },
  async list(): Promise<FileMeta[]> { return (await call<{ items: FileMeta[] }>('GET', '/files')).items; },
  delete(name: string): Promise<void> { return call('DELETE', `/files/${encPath(name)}`); },
};
