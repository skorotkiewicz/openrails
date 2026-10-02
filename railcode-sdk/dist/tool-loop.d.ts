import type { LlmMessage, LlmOptions, LlmResult, LlmStreamEvent } from "./types";
export declare const OBSERVATION_CHARS = 6000;
/** Thrown by `llm.generate()` when a tool-loop run fails (an LLM turn erroring —
 * never a misbehaving tool, whose failure is fed back to the model instead). */
export declare class LlmRunError extends Error {
    /** The planning turn the failure happened on (1-based), if known. */
    step: number | null;
    cause: unknown;
    constructor(message: string, step: number | null, cause: unknown);
}
export interface WireRunners {
    generate(input: LlmMessage[], opts: LlmOptions): Promise<LlmResult>;
    stream(input: LlmMessage[], opts: LlmOptions): AsyncIterable<LlmStreamEvent>;
}
/** The loop behind `llm.stream({ tools })` with run-bearing tools. */
export declare function streamToolLoop(input: string | LlmMessage[], opts: LlmOptions, wire: WireRunners): AsyncGenerator<LlmStreamEvent, void>;
/** The loop behind `llm.generate({ tools })` with run-bearing tools. */
export declare function runToolLoop(input: string | LlmMessage[], opts: LlmOptions, wire: WireRunners): Promise<LlmResult>;
