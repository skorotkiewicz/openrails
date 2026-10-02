import type { LlmMessage, LlmOptions, LlmProviderInfo, LlmResult, LlmStreamEvent } from "./types";
type Input = string | LlmMessage[];
/** The raw ndjson stream Response — for pass-through relaying to a browser.
 *
 * Refuses RUN-BEARING tools, and only those: a pass-through hands the bytes to
 * someone else, so there is nobody here to execute a `run()` or feed its result
 * back. Run-LESS tool defs are fine and are a real pattern — the model's
 * requested calls arrive on the `done` frame and whoever reads the stream (a
 * browser loop that needs human approval, say) executes them. */
declare function streamRaw(input: Input, opts?: LlmOptions): Promise<Response>;
declare function generate(input: Input, opts?: LlmOptions): Promise<LlmResult>;
declare function stream(input: Input, opts?: LlmOptions): AsyncIterable<LlmStreamEvent>;
export declare const llm: {
    generate: typeof generate;
    stream: typeof stream;
    streamRaw: typeof streamRaw;
};
/** Every provider the org has configured, so app code can pick (provider, model). */
export declare const llmProviders: () => Promise<LlmProviderInfo[]>;
export {};
