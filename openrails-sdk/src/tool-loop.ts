import { errorFrame } from './ndjson.js';
import type { LlmMessage, LlmOptions, LlmResult, LlmStopReason, LlmStreamEvent, LlmTool, LlmToolCall, LlmToolStep } from './types.js';

export const OBSERVATION_CHARS = 6000;
export class LlmRunError extends Error {
  constructor(message: string, public step: number | null, cause: unknown) {
    super(message, { cause });
    this.name = 'LlmRunError';
  }
}
export interface WireRunners {
  generate(input: LlmMessage[], options: LlmOptions): Promise<LlmResult>;
  stream(input: LlmMessage[], options: LlmOptions): AsyncIterable<LlmStreamEvent>;
}
type Done = Extract<LlmStreamEvent, { type: 'done' }>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const types: Record<string, (value: unknown) => boolean> = {
  string: value => typeof value === 'string', number: value => typeof value === 'number' && Number.isFinite(value),
  integer: value => typeof value === 'number' && Number.isInteger(value), boolean: value => typeof value === 'boolean',
  object, array: Array.isArray, null: value => value === null,
};
function typeMatches(type: unknown, value: unknown): boolean {
  return (Array.isArray(type) ? type : [type]).some(type => typeof type === 'string' && types[type]?.(value));
}
function validateArgs(schema: Record<string, unknown> | undefined, args: unknown): string | null {
  if (!schema) return null;
  if (!object(args)) return 'arguments must be an object';
  if (Array.isArray(schema.required)) {
    for (const key of schema.required) if (typeof key === 'string' && !(key in args)) return `missing required property "${key}"`;
  }
  // ponytail: shallow schema validation; use a JSON Schema validator if nested validation is needed.
  for (const [key, spec] of Object.entries(object(schema.properties) ? schema.properties : {})) {
    if (!(key in args) || !object(spec)) continue;
    if (spec.type && !typeMatches(spec.type, args[key])) return `property "${key}" has the wrong type`;
    if (Array.isArray(spec.enum) && !spec.enum.includes(args[key])) return `property "${key}" is not in its enum`;
  }
  return null;
}
function stringify(value: unknown): string {
  try { return JSON.stringify(value) ?? 'undefined'; } catch { return String(value); }
}
function summary(tool: LlmTool, result: unknown): string {
  let text: string;
  try { text = tool.summarize ? tool.summarize(result) : stringify(result); } catch { text = stringify(result); }
  return text.length > OBSERVATION_CHARS ? `${text.slice(0, OBSERVATION_CHARS)}… (${text.length - OBSERVATION_CHARS} more chars)` : text;
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  let abort: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  return Promise.race([promise, cancelled]).finally(() => signal.removeEventListener('abort', abort));
}

async function* engine(input: string | LlmMessage[], options: LlmOptions, wire: WireRunners, streaming: boolean): AsyncGenerator<LlmStreamEvent> {
  const { maxSteps = 8, maxToolCalls = 30, timeoutMs = 120_000 } = options.limits ?? {};
  if (![maxSteps, maxToolCalls].every(value => Number.isSafeInteger(value) && value >= 0) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Tool limits must be non-negative integers and timeoutMs must be positive');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Tool loop timed out', 'TimeoutError')), timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const abortedReason = (): LlmStopReason => controller.signal.aborted ? 'timeout' : 'aborted';
  const messages: LlmMessage[] = typeof input === 'string' ? [{ role: 'user', content: input }] : input.map(message => ({ ...message }));
  const tools = options.tools ?? [];
  const toolsByName = new Map(tools.map(tool => [tool.name, tool]));
  const definitions = tools.map(({ name, description, schema }) => ({ name, description, schema }));
  const steps: LlmToolStep[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let provider = options.provider ?? '';
  let model = options.model ?? '';
  let requestId = '';
  let finishReason: string | null = null;
  let cost = 0;
  let costKnown = true;
  let calls = 0;
  let turn = 0;
  let text = '';
  let output: unknown = null;
  let stopReason: LlmStopReason = 'end';
  function record(result: Pick<LlmResult, 'usage' | 'cost' | 'provider' | 'model' | 'requestId' | 'finishReason'>): void {
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.totalTokens += result.usage.totalTokens;
    provider = result.provider || provider;
    model = result.model || model;
    requestId = result.requestId;
    finishReason = result.finishReason;
    if (result.cost !== null && Number.isFinite(Number(result.cost))) cost += Number(result.cost);
    else costKnown = false;
  }
  async function* plan(options: LlmOptions): AsyncGenerator<LlmStreamEvent, { text: string; toolCalls: LlmToolCall[] }> {
    if (!streaming) {
      try {
        const result = await abortable(wire.generate(messages, options), signal);
        record(result);
        return { text: result.text, toolCalls: result.toolCalls };
      } catch (error) { if (!signal.aborted) throw error; return { text: '', toolCalls: [] }; }
    }
    let text = '';
    let toolCalls: LlmToolCall[] = [];
    try {
      for await (const event of wire.stream(messages, options)) {
        if (signal.aborted) break;
        if (event.type === 'text') { text += event.text; yield event; }
        else if (event.type === 'done') { record(event); toolCalls = event.toolCalls ?? []; }
        else if (event.type === 'error') throw new LlmRunError(event.message, turn, event);
      }
    } catch (error) { if (!signal.aborted) throw error; }
    return { text, toolCalls };
  }
  try {
    while (true) {
      if (signal.aborted) { stopReason = abortedReason(); break; }
      if (turn >= maxSteps) { stopReason = 'max_steps'; break; }
      const budget = `You have used ${turn} of ${maxSteps} tool steps.`;
      turn++;
      const result = yield* plan({ ...options, output: undefined, tools: definitions, signal,
        system: options.system ? `${options.system}\n\n${budget}` : budget });
      if (signal.aborted) { text = result.text; stopReason = abortedReason(); break; }
      if (!result.toolCalls.length) { text = result.text; break; }
      messages.push({ role: 'assistant', content: `${result.text}\n[calling tools: ${result.toolCalls.map(call => `${call.name}(${stringify(call.arguments)})`).join(', ')}]` });
      const observations: string[] = [];
      for (const call of result.toolCalls) {
        if (signal.aborted) { stopReason = abortedReason(); break; }
        if (calls >= maxToolCalls) {
          observations.push(`- ${call.name}: skipped (tool-call budget exhausted)`);
          stopReason = 'max_tool_calls';
          continue;
        }
        calls++;
        const step: LlmToolStep = { id: call.id || `step_${calls}`, index: calls, tool: call.name, args: call.arguments, status: 'running', result: null, error: null, ms: null };
        steps.push(step);
        yield { type: 'step', step: { ...step } };
        const started = performance.now();
        let observation: string;
        try {
          const tool = toolsByName.get(call.name);
          if (!tool?.run) throw new Error(`Unknown executable tool "${call.name}"`);
          const invalid = validateArgs(tool.schema, call.arguments);
          if (invalid) throw new Error(invalid);
          const raw = await abortable(Promise.resolve(tool.run(call.arguments, { signal, step: turn })), signal);
          step.status = 'ok';
          step.result = raw;
          observation = summary(tool, raw);
        } catch (error) {
          step.status = 'error';
          step.error = error instanceof Error ? error.message : stringify(error);
          observation = `Error: ${step.error}`;
        }
        step.ms = Math.round(performance.now() - started);
        observations.push(`- ${call.name} [${step.id}]: ${observation}`);
        yield { type: 'step', step: { ...step } };
      }
      messages.push({ role: 'user', content: `Tool results:\n${observations.join('\n')}` });
      if (signal.aborted) { stopReason = abortedReason(); break; }
      if (stopReason === 'max_tool_calls') break;
    }
    if (options.output?.type === 'json' && stopReason === 'end') {
      try {
        const result = await abortable(wire.generate(messages, { ...options, tools: undefined, signal }), signal);
        record(result);
        text = result.text;
        output = result.output;
        if (streaming && text) yield { type: 'text', text };
      } catch (error) { if (!signal.aborted) throw error; stopReason = abortedReason(); }
    }
    if (text) messages.push({ role: 'assistant', content: text });
    yield { type: 'done', text, output, toolCalls: [], usage, cost: costKnown && turn > 0 ? String(cost) : null, provider, model, requestId, finishReason, steps, messages, stopReason };
  } catch (error) {
    const cause = error instanceof LlmRunError ? error.cause : error;
    const frame = object(cause) && cause.type === 'error' && typeof cause.error === 'string' && typeof cause.message === 'string'
      ? { type: 'error' as const, error: cause.error, message: cause.message }
      : errorFrame(cause);
    yield { ...frame, step: error instanceof LlmRunError ? error.step : turn };
  } finally { clearTimeout(timer); }
}
export function streamToolLoop(input: string | LlmMessage[], options: LlmOptions, wire: WireRunners): AsyncGenerator<LlmStreamEvent> {
  return engine(input, options, wire, true);
}
export async function runToolLoop(input: string | LlmMessage[], options: LlmOptions, wire: WireRunners): Promise<LlmResult> {
  for await (const event of engine(input, options, wire, false)) {
    if (event.type === 'error') throw new LlmRunError(event.message, event.step ?? null, event);
    if (event.type === 'done') {
      const { type: _, ...done }: Done = event;
      return { ...done, text: done.text ?? '', output: done.output ?? null, toolCalls: done.toolCalls ?? [] };
    }
  }
  throw new LlmRunError('Tool loop produced no result', null, null);
}
