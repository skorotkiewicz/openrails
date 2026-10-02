import type { RailcodeUser } from "./types";
export interface AmbientStore {
    token: string;
    claims: Record<string, unknown>;
    user: RailcodeUser | null;
    trigger: "http" | "cron";
    invocationId: string;
    dataPlaneUrl: string;
    secrets: Record<string, string>;
    log?: (level: string, args: unknown[]) => void;
    waitUntil?: (p: Promise<unknown>) => void;
}
export declare function ambient(): AmbientStore;
