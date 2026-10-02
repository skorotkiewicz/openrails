export declare class ApiError extends Error {
    status: number;
    constructor(status: number, message: string);
    /** The backend's own message, verbatim. `message` is the raw response body
     * (usually `{"detail": "…"}` or `{"detail": {"error", "message"}}`); this
     * unwraps it so a 400 like "x is an MCP connector — call its tools with
     * connector(name).call(…)" reads as a sentence. Falls back to the raw body. */
    get detail(): string;
}
type QueryValue = string | number | boolean | undefined;
export type Query = Record<string, QueryValue>;
export declare function buildUrl(path: string, query?: Query): string;
export declare function authHeaders(extra?: Record<string, string>): Record<string, string>;
export declare function send(input: string, init: RequestInit): Promise<Response>;
export declare function call<T = unknown>(method: string, path: string, opts?: {
    query?: Query;
    body?: unknown;
}): Promise<T>;
export declare function getOrNull<T>(path: string, query?: Query): Promise<T | null>;
export {};
