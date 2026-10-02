// @railcode/sdk — generated bundle, do not edit

// src/ambient.ts
var devStore;
function b64urlJson(part) {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - b64.length % 4) % 4);
  return JSON.parse(atob(b64 + pad));
}
function devAmbient() {
  if (devStore !== void 0) return devStore;
  const env = globalThis.process?.env ?? {};
  const token = env.RC_DEV_TOKEN;
  const url2 = env.RC_DATA_PLANE_URL;
  if (!token || !url2) {
    devStore = null;
    return null;
  }
  let claims = {};
  try {
    claims = b64urlJson(token.split(".")[1] ?? "");
  } catch {
    claims = {};
  }
  devStore = {
    token,
    claims,
    user: claims.user ?? null,
    trigger: "http",
    invocationId: "dev",
    dataPlaneUrl: url2,
    secrets: env
  };
  return devStore;
}
function ambient() {
  const als = globalThis.__RAILCODE_AMBIENT__;
  const store = als?.getStore?.();
  if (store) return store;
  const dev = devAmbient();
  if (dev) return dev;
  throw new Error(
    "@railcode/sdk only runs inside a deployed Railcode worker or under `railcode dev`. Start your app with: railcode dev"
  );
}

// src/http.ts
var ApiError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
  /** The backend's own message, verbatim. `message` is the raw response body
   * (usually `{"detail": "…"}` or `{"detail": {"error", "message"}}`); this
   * unwraps it so a 400 like "x is an MCP connector — call its tools with
   * connector(name).call(…)" reads as a sentence. Falls back to the raw body. */
  get detail() {
    try {
      const body3 = JSON.parse(this.message);
      const detail = body3.detail;
      if (typeof detail === "string") return detail;
      if (detail && typeof detail === "object") {
        const message = detail.message;
        if (typeof message === "string") return message;
      }
    } catch {
    }
    return this.message;
  }
};
function buildUrl(path, query2) {
  const base = ambient().dataPlaneUrl.replace(/\/$/, "");
  const url2 = new URL(base + "/fn/data" + path);
  if (query2) {
    for (const [key, value] of Object.entries(query2)) {
      if (value !== void 0) url2.searchParams.set(key, String(value));
    }
  }
  return url2.toString();
}
function authHeaders(extra = {}) {
  return { authorization: `Bearer ${ambient().token}`, ...extra };
}
async function send(input, init) {
  init.headers = { ...authHeaders(), ...init.headers ?? {} };
  return fetch(input, init);
}
async function call(method, path, opts = {}) {
  const init = { method };
  const headers = {};
  if (opts.body !== void 0) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  init.headers = headers;
  const resp = await send(buildUrl(path, opts.query), init);
  if (!resp.ok) throw new ApiError(resp.status, await resp.text());
  if (resp.status === 204) return void 0;
  return await resp.json();
}
async function getOrNull(path, query2) {
  const resp = await send(buildUrl(path, query2), { method: "GET" });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new ApiError(resp.status, await resp.text());
  return await resp.json();
}

// src/agents.ts
function start(name, input) {
  return call("POST", `/agents/${encodeURIComponent(name)}`, { body: { input } });
}
function get(requestId) {
  return call("GET", `/agents/runs/${encodeURIComponent(requestId)}`);
}
var agents = { start, get };

// src/ctx.ts
var ctx = {
  /** The verified caller, or null on cron triggers. */
  get user() {
    return ambient().user;
  },
  /** How this invocation started: "http" (a member's request) or "cron". */
  get trigger() {
    return ambient().trigger;
  },
  /** The invocation's id — also your idempotency key for cron side effects. */
  get invocationId() {
    return ambient().invocationId;
  },
  /** Extend the invocation past the response (deployed workers only). */
  waitUntil(promise) {
    ambient().waitUntil?.(promise);
  }
};

// src/util.ts
function encPath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}
function toIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

// src/db.ts
var DbQuery = class {
  constructor(collection) {
    this.collection = collection;
  }
  _where = [];
  _prefix;
  _since;
  _before;
  _order;
  where(field, op, value) {
    this._where.push([field, op, value]);
    return this;
  }
  prefix(value) {
    this._prefix = value;
    return this;
  }
  updatedSince(value) {
    this._since = toIso(value);
    return this;
  }
  updatedBefore(value) {
    this._before = toIso(value);
    return this;
  }
  orderBy(field, direction = "asc") {
    this._order = [field, direction];
    return this;
  }
  params(extra = {}) {
    return {
      where: this._where.length ? JSON.stringify(this._where) : void 0,
      order: this._order ? JSON.stringify(this._order) : void 0,
      prefix: this._prefix,
      updated_since: this._since,
      updated_before: this._before,
      ...extra
    };
  }
  async fetchPage(page, size) {
    const resp = await call("GET", `/kv/${encPath(this.collection)}`, {
      query: this.params({ page, size })
    });
    return resp.items;
  }
  page(page = 1, size) {
    return this.fetchPage(page, size);
  }
  async first() {
    const items = await this.fetchPage(1, 1);
    return items[0] ?? null;
  }
  async count() {
    const resp = await call("GET", `/kv/${encPath(this.collection)}`, {
      query: this.params({ count: true })
    });
    return resp.count;
  }
};
var Collection = class {
  constructor(name) {
    this.name = name;
  }
  /** The stored value for ``key``, or null if absent. */
  async get(key) {
    const record = await getOrNull(`/kv/${encPath(this.name)}/${encPath(key)}`);
    return record ? record.value : null;
  }
  /** Upsert ``key`` → ``value``; returns the stored value. */
  async put(key, value) {
    const record = await call("PUT", `/kv/${encPath(this.name)}/${encPath(key)}`, {
      body: { value }
    });
    return record.value;
  }
  delete(key) {
    return call("DELETE", `/kv/${encPath(this.name)}/${encPath(key)}`);
  }
  /** All records in the collection (first page). */
  async list() {
    const resp = await call("GET", `/kv/${encPath(this.name)}`);
    return resp.items;
  }
  query() {
    return new DbQuery(this.name);
  }
  where(field, op, value) {
    return this.query().where(field, op, value);
  }
  prefix(value) {
    return this.query().prefix(value);
  }
};
var FrozenCollection = class {
  constructor(kind, owner, name) {
    this.kind = kind;
    this.owner = owner;
    this.name = name;
  }
  base() {
    return `/kv-scoped/${this.kind}/${encPath(this.owner)}/${encPath(this.name)}`;
  }
  async get(key) {
    const record = await getOrNull(`${this.base()}/${encPath(key)}`);
    return record ? record.value : null;
  }
  async list(page = 1, size) {
    const resp = await call("GET", this.base(), {
      query: { page, size }
    });
    return resp.items;
  }
};
var db = {
  collection(name) {
    return new Collection(name);
  },
  /** A migrated v1 app's frozen USER-scoped data (read-only). */
  scoped(userId) {
    return {
      collection: (name) => new FrozenCollection("user", userId, name)
    };
  },
  /** A migrated v1 app's frozen ROLE-scoped data (read-only). */
  scopedRole(roleUuid) {
    return {
      collection: (name) => new FrozenCollection("role", roleUuid, name)
    };
  }
};

// src/directory.ts
var appUsers = () => call("GET", "/app-users").then(
  (rows) => rows.map((r) => ({ id: r.uuid, name: r.name, email: r.email, is_admin: r.is_admin }))
);

// src/email.ts
function body(opts) {
  const out = { to: opts.to, subject: opts.subject };
  if (opts.html !== void 0) out.html = opts.html;
  if (opts.text !== void 0) out.text = opts.text;
  if (opts.cc !== void 0) out.cc = opts.cc;
  if (opts.bcc !== void 0) out.bcc = opts.bcc;
  if (opts.replyTo !== void 0) out.replyTo = opts.replyTo;
  return out;
}
function send2(opts) {
  return call("POST", "/email/send", { body: body(opts) });
}
var email = { send: send2 };

// src/files.ts
function contentTypeOf(data2, explicit) {
  if (explicit) return explicit;
  if (typeof Blob !== "undefined" && data2 instanceof Blob && data2.type) return data2.type;
  if (typeof data2 === "string") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}
async function put(name, data2, contentType) {
  const resp = await send(buildUrl("/files/blob", { name }), {
    method: "PUT",
    body: data2,
    headers: { "Content-Type": contentTypeOf(data2, contentType) }
  });
  if (!resp.ok) throw new ApiError(resp.status, await resp.text());
  return await resp.json();
}
async function get2(name) {
  const resp = await send(buildUrl(`/files/${encPath(name)}`), { method: "GET" });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new ApiError(resp.status, await resp.text());
  return resp;
}
async function url(name) {
  return call("POST", "/files/url", { body: { name } });
}
async function urls(names) {
  return call("POST", "/files/urls", { body: { names } });
}
async function list() {
  const resp = await call("GET", "/files");
  return resp.items;
}
function remove(name) {
  return call("DELETE", `/files/${encPath(name)}`);
}
var files = { put, get: get2, url, urls, list, delete: remove };

// src/tool-loop.ts
var OBSERVATION_CHARS = 6e3;
var DEFAULT_LIMITS = {
  maxSteps: 8,
  maxToolCalls: 30,
  timeoutMs: 12e4
};
var LlmRunError = class extends Error {
  /** The planning turn the failure happened on (1-based), if known. */
  step;
  cause;
  constructor(message, step, cause) {
    super(message);
    this.name = "LlmRunError";
    this.step = step;
    this.cause = cause;
  }
};
var now = () => typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
var toMessages = (input) => typeof input === "string" ? [{ role: "user", content: input }] : input.map((m) => ({ ...m }));
var errMessage = (err) => err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
function clip(text, n) {
  return text.length > n ? `${text.slice(0, n)}\u2026 (${text.length - n} more chars)` : text;
}
function defaultStringify(value) {
  if (value === void 0) return "undefined";
  try {
    const s = JSON.stringify(value);
    return s === void 0 ? String(value) : s;
  } catch {
    return String(value);
  }
}
function summarizeResult(tool, raw) {
  if (tool.summarize) {
    try {
      return clip(String(tool.summarize(raw)), OBSERVATION_CHARS);
    } catch {
    }
  }
  return clip(defaultStringify(raw), OBSERVATION_CHARS);
}
var JS_TYPE_OK = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && !Number.isNaN(v),
  integer: (v) => typeof v === "number" && Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  null: (v) => v === null
};
function typeMatches(type, value) {
  const allowed = Array.isArray(type) ? type : [type];
  return allowed.some((t) => typeof t === "string" && JS_TYPE_OK[t]?.(value));
}
function validateArgs(schema, args) {
  if (!schema || typeof schema !== "object") return null;
  if (schema.type && schema.type !== "object") {
    return typeMatches(schema.type, args) ? null : `arguments must be of type ${schema.type}`;
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return "arguments must be an object";
  }
  const obj = args;
  for (const key of schema.required ?? []) {
    if (!(key in obj)) return `missing required property "${key}"`;
  }
  const props = schema.properties ?? {};
  for (const [key, spec] of Object.entries(props)) {
    if (!(key in obj) || spec == null) continue;
    const value = obj[key];
    if (spec.type && !typeMatches(spec.type, value)) {
      return `property "${key}" must be of type ${JSON.stringify(spec.type)}`;
    }
    if (Array.isArray(spec.enum) && !spec.enum.includes(value)) {
      return `property "${key}" must be one of ${JSON.stringify(spec.enum)}`;
    }
  }
  return null;
}
function assistantTurn(text, calls) {
  const decided = calls.map((c) => `${c.name}(${defaultStringify(c.arguments)})`).join(", ");
  const content = text ? `${text}

[calling tools: ${decided}]` : `[calling tools: ${decided}]`;
  return { role: "assistant", content };
}
function observationTurn(lines) {
  return { role: "user", content: `Tool results:
${lines.join("\n")}` };
}
var RunLedger = class {
  usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  model = "";
  provider = "";
  finishReason = null;
  requestId = "";
  costSum = 0;
  costSeen = false;
  costMissing = false;
  turn(t) {
    this.usage.inputTokens += t.usage.inputTokens;
    this.usage.outputTokens += t.usage.outputTokens;
    this.usage.totalTokens += t.usage.totalTokens;
    if (t.model) this.model = t.model;
    if (t.provider) this.provider = t.provider;
    if (t.finishReason !== void 0) this.finishReason = t.finishReason;
    if (t.requestId) this.requestId = t.requestId;
    const parsed = t.cost == null ? NaN : Number(t.cost);
    if (Number.isFinite(parsed)) {
      this.costSum += parsed;
      this.costSeen = true;
    } else {
      this.costMissing = true;
    }
  }
  /** Sum of per-turn costs; null unless every turn reported one. */
  get cost() {
    if (!this.costSeen || this.costMissing) return null;
    return this.costSum.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  }
};
var toDefs = (tools) => tools.map((t) => ({ name: t.name, description: t.description, schema: t.schema }));
async function* engine(input, opts, wire2, streamFinal) {
  const tools = opts.tools ?? [];
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  const toolDefs = toDefs(tools);
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const { system: baseSystem, model, provider, output, maxOutputTokens, metadata } = opts;
  const messages = toMessages(input);
  const steps = [];
  const ledger = new RunLedger();
  if (model) ledger.model = model;
  let toolExecs = 0;
  let turn = 0;
  let finalText = "";
  let finalOutput = null;
  let hasStructuredOutput = false;
  let stopReason = "end";
  const controller = new AbortController();
  let abortReason = "aborted";
  const onExternalAbort = () => {
    abortReason = "aborted";
    controller.abort();
  };
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => {
    abortReason = "timeout";
    controller.abort();
  }, limits.timeoutMs);
  const signal = controller.signal;
  const budgetSystem = () => {
    if (!limits.maxSteps) return baseSystem;
    const line = `You have used ${turn} of ${limits.maxSteps} tool steps.`;
    return baseSystem ? `${baseSystem}

${line}` : line;
  };
  async function* planTurn(system) {
    const turnOpts = {
      system,
      tools: toolDefs,
      model,
      provider,
      maxOutputTokens,
      metadata,
      signal
    };
    if (!streamFinal) {
      try {
        const result = await wire2.generate(messages, turnOpts);
        ledger.turn(result);
        return { text: result.text, toolCalls: result.toolCalls ?? [] };
      } catch (err) {
        if (signal.aborted) return { text: "", toolCalls: [] };
        throw err;
      }
    }
    let turnText = "";
    let toolCalls = [];
    try {
      for await (const event of wire2.stream(messages, turnOpts)) {
        if (signal.aborted) break;
        if (event.type === "text") {
          turnText += event.text;
          yield { type: "text", text: event.text };
        } else if (event.type === "done") {
          ledger.turn(event);
          toolCalls = event.toolCalls ?? [];
        } else if (event.type === "error") {
          throw new LlmRunError(event.message, turn, event);
        }
      }
    } catch (err) {
      if (!signal.aborted) throw err;
    }
    return { text: turnText, toolCalls };
  }
  try {
    planning: while (true) {
      if (signal.aborted) {
        stopReason = abortReason;
        break;
      }
      if (turn >= limits.maxSteps) {
        stopReason = "max_steps";
        break;
      }
      const system = budgetSystem();
      turn += 1;
      const result = yield* planTurn(system);
      if (signal.aborted) {
        finalText = result.text;
        stopReason = abortReason;
        break;
      }
      if (result.toolCalls.length === 0) {
        finalText = result.text;
        stopReason = "end";
        break;
      }
      messages.push(assistantTurn(result.text, result.toolCalls));
      const observations = [];
      for (const call2 of result.toolCalls) {
        if (signal.aborted) {
          messages.push(observationTurn(observations.length ? observations : ["(cancelled)"]));
          stopReason = abortReason;
          break planning;
        }
        if (toolExecs >= limits.maxToolCalls) {
          observations.push(`- ${call2.name}: skipped (tool-call budget exhausted)`);
          stopReason = "max_tool_calls";
          continue;
        }
        toolExecs += 1;
        const step = {
          id: call2.id || `step_${toolExecs}`,
          index: toolExecs,
          tool: call2.name,
          args: call2.arguments,
          status: "running",
          result: null,
          error: null,
          ms: null
        };
        steps.push(step);
        yield { type: "step", step: { ...step } };
        const started = now();
        let observation;
        const tool = toolsByName.get(call2.name);
        if (!tool) {
          step.status = "error";
          step.error = `Unknown tool "${call2.name}"`;
          observation = step.error;
        } else {
          const invalid = validateArgs(tool.schema, call2.arguments);
          if (invalid) {
            step.status = "error";
            step.error = invalid;
            observation = `Invalid arguments: ${invalid}`;
          } else {
            try {
              const raw = await tool.run(call2.arguments, { signal, step: turn });
              step.status = "ok";
              step.result = raw;
              observation = summarizeResult(tool, raw);
            } catch (err) {
              step.status = "error";
              step.error = errMessage(err);
              observation = `Error: ${step.error}`;
            }
          }
        }
        step.ms = Math.round(now() - started);
        observations.push(`- ${call2.name} [${step.id}]: ${observation}`);
        yield { type: "step", step: { ...step } };
      }
      messages.push(observationTurn(observations));
      if (stopReason === "max_tool_calls") break;
    }
    if (output && output.type === "json" && stopReason === "end" && !hasStructuredOutput) {
      const result = await wire2.generate(messages, {
        system: baseSystem,
        output,
        model,
        provider,
        maxOutputTokens,
        metadata,
        signal
      });
      ledger.turn(result);
      finalText = result.text;
      finalOutput = result.output;
      hasStructuredOutput = true;
      if (streamFinal && finalText) yield { type: "text", text: finalText };
    }
    if (finalText) messages.push({ role: "assistant", content: finalText });
    yield {
      type: "done",
      usage: ledger.usage,
      cost: ledger.cost,
      provider: ledger.provider,
      model: ledger.model,
      finishReason: ledger.finishReason,
      requestId: ledger.requestId,
      text: finalText,
      output: hasStructuredOutput ? finalOutput : null,
      steps,
      messages,
      stopReason
    };
  } catch (err) {
    const cause = err instanceof LlmRunError ? err.cause : err;
    const wireError = cause && typeof cause === "object" && "error" in cause ? cause : void 0;
    yield {
      type: "error",
      error: typeof wireError?.error === "string" ? wireError.error : "tool_loop_error",
      message: errMessage(err),
      ...wireError?.retryable !== void 0 ? { retryable: wireError.retryable } : {},
      ...wireError?.requestId !== void 0 ? { requestId: wireError.requestId } : {},
      step: err instanceof LlmRunError ? err.step : turn
    };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }
}
function streamToolLoop(input, opts, wire2) {
  return engine(input, opts, wire2, true);
}
async function runToolLoop(input, opts, wire2) {
  for await (const event of engine(input, opts, wire2, false)) {
    if (event.type === "done") {
      return {
        text: event.text ?? "",
        output: event.output ?? null,
        toolCalls: [],
        usage: event.usage,
        cost: event.cost,
        provider: event.provider,
        model: event.model,
        finishReason: event.finishReason,
        requestId: event.requestId,
        steps: event.steps,
        messages: event.messages,
        stopReason: event.stopReason
      };
    }
    if (event.type === "error") {
      throw new LlmRunError(event.message, event.step ?? null, event);
    }
  }
  throw new LlmRunError("tool loop produced no result", null, null);
}

// src/llm.ts
function toolMode(tools) {
  if (!tools || tools.length === 0) return "none";
  const withRun = tools.filter((t) => typeof t.run === "function").length;
  if (withRun === 0) return "defs";
  if (withRun === tools.length) return "loop";
  throw new Error(
    "llm tools must either all define run() (the SDK runs the loop) or none of them (raw toolCalls passthrough)."
  );
}
function body2(input, opts = {}) {
  const out = Array.isArray(input) ? { messages: input } : { input };
  if (opts.model !== void 0) out.model = opts.model;
  if (opts.provider !== void 0) out.provider = opts.provider;
  if (opts.system !== void 0) out.system = opts.system;
  if (opts.output !== void 0) out.output = opts.output;
  if (opts.tools !== void 0) {
    out.tools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      schema: t.schema
    }));
  }
  if (opts.maxOutputTokens !== void 0) out.maxOutputTokens = opts.maxOutputTokens;
  if (opts.metadata !== void 0) out.metadata = opts.metadata;
  return out;
}
async function doGenerate(input, opts = {}) {
  const resp = await send(buildUrl("/llm/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body2(input, opts)),
    signal: opts.signal ?? null
  });
  if (!resp.ok) throw new ApiError(resp.status, await resp.text());
  return await resp.json();
}
async function openStream(input, opts = {}) {
  const resp = await send(buildUrl("/llm/stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body2(input, opts)),
    signal: opts.signal ?? null
  });
  if (!resp.ok) throw new ApiError(resp.status, await resp.text());
  return resp;
}
async function streamRaw(input, opts = {}) {
  if (opts.tools?.some((tool) => typeof tool.run === "function")) {
    throw new Error(
      "llm.streamRaw() does not run tool loops \u2014 whoever reads these bytes must handle the tool calls. Use llm.stream(), or pass the tools without run()."
    );
  }
  return openStream(input, opts);
}
async function* doStream(input, opts = {}) {
  const resp = await openStream(input, opts);
  if (!resp.body) throw new Error("LLM stream response has no body.");
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line);
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) yield JSON.parse(tail);
  } finally {
    reader.releaseLock();
  }
}
var wire = { generate: doGenerate, stream: doStream };
function generate(input, opts = {}) {
  const mode = toolMode(opts.tools);
  if (opts.output?.type === "json" && mode === "defs") {
    throw new Error(
      "llm.generate() does not support JSON output with run-less tools; add run() handlers or omit tools."
    );
  }
  if (mode === "loop") return runToolLoop(input, opts, wire);
  return doGenerate(input, opts);
}
function stream(input, opts = {}) {
  const mode = toolMode(opts.tools);
  if (opts.output?.type === "json" && mode !== "loop") {
    throw new Error("llm.stream() does not support JSON output; use llm.generate().");
  }
  if (mode === "loop") return streamToolLoop(input, opts, wire);
  return doStream(input, opts);
}
var llm = { generate, stream, streamRaw };
var llmProviders = () => call("GET", "/llm/providers");

// src/ndjson.ts
function errorFrame(error) {
  if (error instanceof ApiError) {
    let code = "provider_error";
    let message = error.message;
    try {
      const body3 = JSON.parse(error.message);
      const detail = body3.detail ?? body3;
      if (typeof detail === "string") {
        message = detail;
      } else if (detail) {
        if (typeof detail.error === "string") code = detail.error;
        if (typeof detail.message === "string") message = detail.message;
      }
    } catch {
    }
    return { type: "error", error: code, message };
  }
  return {
    type: "error",
    error: "worker_error",
    message: error instanceof Error ? error.message : String(error)
  };
}
function iterate(source) {
  const asAsync = source[Symbol.asyncIterator];
  if (typeof asAsync === "function") return asAsync.call(source);
  const sync = source[Symbol.iterator]();
  return {
    next: () => Promise.resolve(sync.next()),
    return: (value) => Promise.resolve(sync.return?.(value) ?? { done: true, value })
  };
}
function toNdjson(source, opts = {}) {
  const { onError = errorFrame, headers, ...init } = opts;
  const encoder = new TextEncoder();
  const iterator = iterate(source);
  const line = (value) => encoder.encode(JSON.stringify(value) + "\n");
  let finished = false;
  const stream2 = new ReadableStream({
    async pull(controller) {
      if (finished) return;
      try {
        const next = await iterator.next();
        if (next.done) {
          finished = true;
          controller.close();
          return;
        }
        controller.enqueue(line(next.value));
      } catch (error) {
        finished = true;
        controller.enqueue(line(onError(error)));
        controller.close();
      }
    },
    async cancel(reason) {
      finished = true;
      await iterator.return?.(reason);
    }
  });
  return new Response(stream2, {
    ...init,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
      // Tells a buffering proxy to pass bytes straight through; without it a
      // token-by-token stream arrives as one lump at the end.
      "x-accel-buffering": "no",
      ...headers
    }
  });
}

// src/sql.ts
var toSqlRows = (r) => {
  const columns = r.columns;
  const rows = r.rows.map(
    (row) => Object.fromEntries(columns.map((cn, i) => [cn, row[i]]))
  );
  rows.columns = columns;
  rows.rowcount = r.rowcount;
  rows.truncated = r.truncated;
  return rows;
};
var runSQL = (engine2, connection, query2, params) => call("POST", "/sql", {
  body: { ...engine2 ? { engine: engine2 } : {}, connection, query: query2, params: params || [] }
}).then(toSqlRows);
var namespace = (engine2) => {
  const handle = (connection) => ({
    runSQL: (query2, params) => runSQL(engine2, connection, query2, params)
  });
  const ns = handle;
  ns.runSQL = (query2, params) => runSQL(engine2, "default", query2, params);
  return ns;
};
var data = namespace();
var postgres = namespace("postgres");
var bigquery = namespace("bigquery");
var turso = namespace("turso");
var dataConnectors = () => call("GET", "/connections");

// src/queries.ts
var query = (name, params) => call("POST", `/queries/${encPath(name)}`, {
  body: { params: params || {} }
}).then(toSqlRows);
var savedQueries = () => call("GET", "/queries");

// src/secrets.ts
var secrets = new Proxy(
  {},
  {
    get(_t, prop) {
      if (typeof prop !== "string") return void 0;
      return ambient().secrets[prop];
    },
    has(_t, prop) {
      return typeof prop === "string" && prop in ambient().secrets;
    },
    ownKeys() {
      return Object.keys(ambient().secrets);
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (typeof prop === "string" && prop in ambient().secrets) {
        return { configurable: true, enumerable: true, value: ambient().secrets[prop] };
      }
      return void 0;
    }
  }
);

// src/service-connectors.ts
var toResponse = (env) => {
  const body3 = env.body ?? "";
  return {
    status: env.status,
    ok: env.ok,
    headers: env.headers || {},
    truncated: Boolean(env.truncated),
    text: () => Promise.resolve(body3),
    json: () => Promise.resolve(JSON.parse(body3))
  };
};
var request = (name, path, opts) => call("POST", "/service-connectors/request", {
  body: {
    connector: name,
    method: (opts?.method || "GET").toUpperCase(),
    path,
    body: opts?.body
  }
}).then(toResponse);
var listTools = (name) => call("GET", `/service-connectors/${encPath(name)}/tools`);
var callTool = (name, tool, args = {}) => call("POST", "/service-connectors/call", {
  body: { connector: name, tool, arguments: args }
}).then((out) => out.result);
var connector = (name) => ({
  fetch: (path, opts) => request(name, path, opts),
  tools: () => listTools(name),
  call: (tool, args) => callTool(name, tool, args)
});
var serviceConnectors = () => call("GET", "/service-connectors");
var serviceConnectorDocs = (name) => call("GET", `/service-connectors/${encPath(name)}`);
export {
  ApiError,
  LlmRunError,
  agents,
  appUsers,
  bigquery,
  connector,
  ctx,
  data,
  dataConnectors,
  db,
  email,
  errorFrame,
  files,
  llm,
  llmProviders,
  postgres,
  query,
  savedQueries,
  secrets,
  serviceConnectorDocs,
  serviceConnectors,
  toNdjson,
  turso
};
