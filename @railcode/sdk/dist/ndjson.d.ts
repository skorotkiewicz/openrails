export interface NdjsonErrorFrame {
    type: "error";
    /** The platform's typed code where there is one, else a generic label. */
    error: string;
    message: string;
}
export interface NdjsonOptions extends ResponseInit {
    /** Map a thrown value to the final frame. Defaults to `errorFrame`. */
    onError?: (error: unknown) => unknown;
}
/** Turn a thrown value into a terminal error frame, keeping the typed code.
 *
 *  A data-plane failure arrives as `ApiError(status, body)` where the body is
 *  the raw JSON text — usually `{"detail":{"error":"…","message":"…"}}`. The
 *  code is the part a UI can act on, so it is preserved rather than flattened
 *  into a sentence. */
export declare function errorFrame(error: unknown): NdjsonErrorFrame;
/**
 * An ndjson `Response` over `source` — return it straight from a worker route.
 *
 * ```ts
 * app.post("/api/chat", async (c) => {
 *   const body = await c.req.json();
 *   return toNdjson(llm.stream(body.messages, { tools }));
 * });
 * ```
 *
 * Every value is written as one line of JSON. A throw mid-stream becomes a
 * final `{"type":"error", …}` frame instead of a lost connection. A client that
 * disconnects closes the source, so the run stops.
 */
export declare function toNdjson<T>(source: AsyncIterable<T> | Iterable<T>, opts?: NdjsonOptions): Response;
