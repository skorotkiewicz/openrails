import type { AgentRun } from "./types";
/** Start a run, returning as soon as it is queued. Poll it with `agents.get()`. */
declare function start<TInput = unknown>(name: string, input?: TInput): Promise<AgentRun>;
/** Read a run this app started for this caller, by its `request_id`. */
declare function get(requestId: string): Promise<AgentRun>;
export declare const agents: {
    start: typeof start;
    get: typeof get;
};
export {};
