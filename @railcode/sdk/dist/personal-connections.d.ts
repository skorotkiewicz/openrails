import type { ConnectStart, PersonalCallResult, PersonalConnection, PersonalTool } from "./types";
/** The caller's connections for the toolkits THIS app declares. */
declare function list(): Promise<PersonalConnection[]>;
/**
 * Begin linking `toolkit` to the caller's account.
 *
 * For an OAuth connector this returns `mode: "oauth"` and a `redirect_url` — send
 * it to the browser and open it in a POPUP (a full-page redirect would blow away
 * whatever the user was doing). Poll `list()` while it is open and close it once
 * the toolkit reports `active`. The OAuth callback lands on the platform, not
 * your app, so no callback route of your own is needed. For a token connector it
 * returns `mode: "token"`; the user links those from the Railcode console.
 */
declare function connect(toolkit: string): Promise<ConnectStart>;
/** The tools of `toolkit` this app may call — its declared subset only. */
declare function tools(toolkit: string): Promise<PersonalTool[]>;
/**
 * Run one tool on the caller's connected account.
 *
 * Scoped by connector: name the `toolkit` the tool belongs to (the one you
 * declared in `personal_connectors:` and passed to `tools()`) as well as the
 * `tool`. Bounded by this app's manifest AND the caller's own live connection.
 * 403 if the toolkit/tool isn't declared; 404 if the tool isn't part of that
 * toolkit; 409 if they haven't connected that toolkit yet — surface the 409 as a
 * "Connect your account" prompt rather than an error.
 */
declare function callTool<T = unknown>(toolkit: string, tool: string, args?: Record<string, unknown>): Promise<PersonalCallResult<T>>;
export declare const personalConnections: {
    list: typeof list;
    connect: typeof connect;
    tools: typeof tools;
    call: typeof callTool;
};
export {};
