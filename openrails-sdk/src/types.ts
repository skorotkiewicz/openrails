export interface OpenRailsUser {
    id: string;
    email: string;
    name: string;
    is_admin: boolean;
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
    expires_in: number;
}
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
export interface DatabaseHandle {
    runSQL(query: string, params?: unknown[]): Promise<SqlRows>;
}
export type DatabaseNamespace = ((connection: string) => DatabaseHandle) & DatabaseHandle;
export type SqlRows = Array<Record<string, unknown>> & {
    columns: string[];
    rowcount: number;
    truncated: boolean;
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
export interface AppUser {
    id: string;
    name: string;
    email: string;
    is_admin: boolean;
}
export interface DataConnectorInfo {
    engine: "sqlite";
    name: string;
}
export interface ServiceConnectorInfo {
    name: string;
    description: string | null;
    auth_type: string;
    allowed_methods: string[];
    has_docs: boolean;
    has_openapi: boolean;
    kind: "http" | "mcp";
    has_tools: boolean;
    provider: string | null;
    account_label: string | null;
}
export interface ServiceConnectorDocs {
    name: string;
    description: string | null;
    auth_type: string;
    allowed_methods: string[];
    kind: "http" | "mcp";
    has_tools: boolean;
    content_type: string;
    api_docs_link: string | null;
    api_docs_inline: string | null;
    openapi_spec_link: string | null;
    openapi_spec_inline: string | null;
    usage_instructions: string | null;
}
export interface ConnectorFetchOptions {
    method?: string;
    body?: string;
}
export interface ServiceConnectorResponse {
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    truncated: boolean;
    text(): Promise<string>;
    json<T = unknown>(): Promise<T>;
}
export interface ConnectorTool {
    slug: string;
    description: string;
    input_schema: Record<string, unknown>;
}
export interface ConnectorHandle {
    fetch(path: string, opts?: ConnectorFetchOptions): Promise<ServiceConnectorResponse>;
    tools(): Promise<ConnectorTool[]>;
    call<T = unknown>(tool: string, args?: Record<string, unknown>): Promise<T>;
}
export interface AgentStep {
    step_index: number;
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
    status: "queued" | "running" | "success" | "failed" | "cancelled" | "limit_exceeded";
    trigger_type: "api" | "app" | "cron";
    input_json: unknown | null;
    output_json: unknown | null;
    error_code: string | null;
    error_message: string | null;
    request_id: string;
    limits_json: Record<string, unknown>;
    started_at: string;
    finished_at: string | null;
    steps?: AgentStep[];
}
