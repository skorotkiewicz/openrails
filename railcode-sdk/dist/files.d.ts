import type { FileMeta, FileResolvedUrl, FileUrlBatch } from "./types";
type FileData = string | ArrayBuffer | ArrayBufferView | Blob | ReadableStream<Uint8Array>;
/** Upload bytes under ``name``; returns the stored metadata. */
declare function put(name: string, data: FileData, contentType?: string): Promise<FileMeta>;
/** Stream a stored file back as a fetch Response, or null if absent. */
declare function get(name: string): Promise<Response | null>;
/** A short-lived signed download URL for ``name`` (hand it to your frontend). */
declare function url(name: string): Promise<FileResolvedUrl>;
/** Resolve MANY download URLs in one call.
 *
 * Prefer this over a loop of `files.url()`: a worker invocation has a finite
 * subrequest budget, and one call per file is what exhausts it. Names with no
 * stored file come back under `missing` instead of throwing, because a gallery
 * listing a stale name is normal, not exceptional. */
declare function urls(names: string[]): Promise<FileUrlBatch>;
declare function list(): Promise<FileMeta[]>;
declare function remove(name: string): Promise<void>;
export declare const files: {
    put: typeof put;
    get: typeof get;
    url: typeof url;
    urls: typeof urls;
    list: typeof list;
    delete: typeof remove;
};
export {};
