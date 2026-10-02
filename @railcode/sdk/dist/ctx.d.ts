import type { RailcodeUser } from "./types";
export declare const ctx: {
    /** The verified caller, or null on cron triggers. */
    readonly user: RailcodeUser | null;
    /** How this invocation started: "http" (a member's request) or "cron". */
    readonly trigger: "http" | "cron";
    /** The invocation's id — also your idempotency key for cron side effects. */
    readonly invocationId: string;
    /** Extend the invocation past the response (deployed workers only). */
    waitUntil(promise: Promise<unknown>): void;
};
