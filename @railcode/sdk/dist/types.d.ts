/** The verified caller of this invocation — embedded in the invocation token,
 * mirroring the v1 `/_api/me` shape. Null only on cron triggers. */
export interface RailcodeUser {
    id: string;
    email: string;
    name: string;
    /** Whether the caller is an org owner or admin. Enforce in YOUR code — the
     * worker is the app's authorization engine. */
    is_admin: boolean;
    /** The caller's platform seat: "builder" (owner/admin/builder — build-capable)
     * or "viewer" (view-only). Render read-only UX for viewers if you like, but
     * enforce every write in YOUR code — this is a hint, not an ACL. */
    seat: "builder" | "viewer";
    roles: RoleRef[];
}
export interface RoleRef {
    uuid: string;
    name: string;
}
export type WhereOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in";
export interface KvRecord<T = unknown> {
    key: string;
    value: T;
    updated_at: string;
}
export interface FileMeta {
    name: string;
    content_type: string;
    size: number;
    updated_at: string;
}
export interface FileResolvedUrl {
    name: string;
    url: string;
    expires_in: number | null;
}
/** `files.urls()` — resolved URLs plus the names that had no stored file. A
 *  partial answer is the normal case, so absent names are reported, not thrown. */
export interface FileUrlBatch {
    items: FileResolvedUrl[];
    missing: string[];
}
export interface LlmMessage {
    role: "system" | "user" | "assistant";
    content: string;
}
export type LlmOutputSpec = {
    type?: "text";
} | {
    type: "json";
    schema: Record<string, unknown>;
};
export interface LlmToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}
export interface LlmToolContext {
    signal: AbortSignal;
    step: number;
}
export interface LlmTool<TArgs = any> {
    name: string;
    description: string;
    schema?: Record<string, unknown>;
    run?(args: TArgs, ctx: LlmToolContext): Promise<unknown> | unknown;
    summarize?(result: unknown): string;
}
export interface LlmToolStep {
    id: string;
    index: number;
    tool: string;
    args: unknown;
    status: "running" | "ok" | "error";
    result: unknown | null;
    error: string | null;
    ms: number | null;
}
export interface LlmRunLimits {
    maxSteps?: number;
    maxToolCalls?: number;
    timeoutMs?: number;
}
export type LlmStopReason = "end" | "max_steps" | "max_tool_calls" | "timeout" | "aborted";
export interface LlmOptions {
    model?: string;
    provider?: string;
    system?: string;
    output?: LlmOutputSpec;
    tools?: LlmTool[];
    limits?: LlmRunLimits;
    signal?: AbortSignal;
    maxOutputTokens?: number;
    metadata?: Record<string, unknown>;
}
export interface LlmModelInfo {
    model: string;
    default: boolean;
}
export interface LlmProviderInfo {
    provider: string;
    managed: boolean;
    default: boolean;
    models: LlmModelInfo[];
}
export interface LlmUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}
export interface LlmResult {
    text: string;
    output: unknown | null;
    toolCalls: LlmToolCall[];
    usage: LlmUsage;
    cost: string | null;
    provider: string;
    model: string;
    finishReason: string | null;
    requestId: string;
    steps?: LlmToolStep[];
    messages?: LlmMessage[];
    stopReason?: LlmStopReason;
}
export type LlmStreamEvent = {
    type: "text";
    text: string;
} | {
    type: "step";
    step: LlmToolStep;
} | {
    type: "done";
    usage: LlmUsage;
    cost: string | null;
    provider: string;
    model: string;
    finishReason: string | null;
    requestId: string;
    toolCalls?: LlmToolCall[];
    text?: string;
    output?: unknown | null;
    steps?: LlmToolStep[];
    messages?: LlmMessage[];
    stopReason?: LlmStopReason;
} | {
    type: "error";
    error: string;
    message: string;
    retryable?: boolean;
    requestId?: string;
    step?: number | null;
};
export interface EmailSendOptions {
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
}
export interface EmailSendResult {
    id: string;
    status: string;
    requestId: string;
}
/** One named connection on a specific engine. */
export interface DatabaseHandle {
    /** Run a read-only query. Use `$1, $2, …` placeholders + a params array. */
    runSQL(query: string, params?: unknown[]): Promise<SqlRows>;
}
export type DatabaseNamespace = ((connection: string) => DatabaseHandle) & DatabaseHandle;
export type SqlRows = Array<Record<string, unknown>> & {
    columns?: string[];
    rowcount?: number;
    truncated?: boolean;
};
export interface SavedQueryParam {
    name: string;
    type: string;
}
export interface SavedQueryInfo {
    name: string;
    description: string;
    params: SavedQueryParam[];
    version: number;
}
/** One member of the app's org (from `appUsers()`). Never a password or grant. */
export interface AppUser {
    id: string;
    name: string;
    email: string;
    /** Whether this member is an org owner or admin — information, not an ACL.
     * The worker is the app's authorization engine, so gate access in your code. */
    is_admin: boolean;
}
/** One org data connection (from `dataConnectors()`) — name + engine, never a DSN. */
export interface DataConnectorInfo {
    engine: "postgres" | "bigquery" | "turso" | string;
    name: string;
}
/** One service connector this app may call (from `serviceConnectors()`). Never
 * the credential. `has_docs`/`has_openapi` hint which expose documentation you
 * can pull with `serviceConnectorDocs(name)`; `kind`/`has_tools` say whether to
 * drive it with `connector(name).fetch()` (http) or `connector(name).call()`
 * (mcp, or an http connector that also exposes tools). */
export interface ServiceConnectorInfo {
    name: string;
    description: string | null;
    /** "none" | "bearer" | "header" | "query" | "basic". */
    auth_type: string;
    /** HTTP verbs the connector allows (the proxy rejects others with 405). */
    allowed_methods: string[];
    has_docs: boolean;
    has_openapi: boolean;
    /** "http" (method/path proxy — `fetch()`) or "mcp" (remote MCP server —
     * `tools()`/`call()`). */
    kind: "http" | "mcp";
    /** Whether `connector(name).tools()` lists anything callable by name. */
    has_tools: boolean;
    /** The catalog provider it was linked from (e.g. "gmail"); null for custom. */
    provider: string | null;
    /** The linked account, as labeled at link time (e.g. an email); null if unset. */
    account_label: string | null;
}
/** The docs bundle for one connector (from `serviceConnectorDocs()`). Same
 * app-facing boundary as the list — no base_url, no credential. */
export interface ServiceConnectorDocs {
    name: string;
    description: string | null;
    auth_type: string;
    allowed_methods: string[];
    kind: "http" | "mcp";
    has_tools: boolean;
    /** The Content-Type the proxy stamps on a request that carries a body. */
    content_type: string;
    api_docs_link: string | null;
    api_docs_inline: string | null;
    openapi_spec_link: string | null;
    openapi_spec_inline: string | null;
    usage_instructions: string | null;
}
export interface ConnectorFetchOptions {
    /** HTTP verb; must be one of the connector's allowed methods. Default GET. */
    method?: string;
    /** Raw request body, sent verbatim. The connector sets the Content-Type. */
    body?: string;
}
/** A fetch()-like response from a service connector. The credential, the pinned
 * origin, and any upstream Set-Cookie/auth headers are stripped server-side. */
export interface ServiceConnectorResponse {
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    /** True when the body was truncated at the connector's response-size limit. */
    truncated: boolean;
    text(): Promise<string>;
    json<T = unknown>(): Promise<T>;
}
/** One callable tool of a connector (from `connector(name).tools()`): an MCP
 * server's tool, or a linked provider's in-code tool such as Gmail's
 * `send_email`. `input_schema` is the JSON Schema of the `call()` arguments. */
export interface ConnectorTool {
    slug: string;
    description: string;
    input_schema: Record<string, unknown>;
}
/** A handle scoped to one named connector: `connector('stripe')`. */
export interface ConnectorHandle {
    /** Proxy an HTTP request through the connector. You control method, path and
     * body only; the backend pins the host and injects the credential you never see.
     * HTTP connectors only — on an MCP connector the backend answers 400 with a
     * message pointing at `call()`; the ApiError carries it (`err.detail`). */
    fetch(path: string, opts?: ConnectorFetchOptions): Promise<ServiceConnectorResponse>;
    /** The tools this app may call on the connector, with their input schemas.
     * Empty for a plain HTTP connector. */
    tools(): Promise<ConnectorTool[]>;
    /** Run one tool by name. Resolves to the tool's `result` (for an MCP tool an
     * MCP-style content list, e.g. `[{ type: "text", text: "…" }]`). Undeclared
     * tool → 403; unknown tool → 404; an HTTP connector with no tools → 400 (the
     * ApiError carries the backend's message verbatim in `err.detail`). */
    call<T = unknown>(tool: string, args?: Record<string, unknown>): Promise<T>;
}
export interface AgentStep {
    step_index: number;
    /** `analysis` is the tool-free LLM call that condensed one oversized tool result
     *  before the model saw it — a priced call the agent never asked for, anchored to
     *  the tool call it condensed by `tool_call_id`. */
    kind: "model" | "tool" | "analysis";
    status: "success" | "error";
    tool_name: string | null;
    tool_call_id: string | null;
    args_summary: string | null;
    result_summary: string | null;
    llm_request_id: string | null;
    op_request_id: string | null;
    error_code: string | null;
    error_message: string | null;
    created_at: string;
}
export interface AgentRun {
    uuid: string;
    /** "queued" = accepted, not started yet. Runs execute off the request — the
     *  worker never holds one open. */
    status: "queued" | "running" | "success" | "failed" | "cancelled" | "limit_exceeded";
    trigger_type: "api" | "app" | "cron";
    input_json: unknown | null;
    output_json: unknown | null;
    error_code: string | null;
    error_message: string | null;
    /** The poll handle. Safe to hand to your frontend — the run is already scoped
     *  to this app and this caller, so nothing else can read it. */
    request_id: string;
    limits_json: Record<string, unknown>;
    started_at: string;
    finished_at: string | null;
    steps?: AgentStep[];
}
