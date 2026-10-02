import { ApiError, buildUrl, call, send } from './http.js';
import { runToolLoop, streamToolLoop, type WireRunners } from './tool-loop.js';
import type { LlmMessage, LlmOptions, LlmProviderInfo, LlmResult, LlmStreamEvent } from './types.js';

type Input = string | LlmMessage[];
function toolMode(options: LlmOptions): 'none' | 'defs' | 'loop' {
  const tools = options.tools ?? [];
  if (!tools.length) return 'none';
  const count = tools.filter(tool => typeof tool.run === 'function').length;
  if (!count) return 'defs';
  if (count === tools.length) return 'loop';
  throw new TypeError('Tools must either all define run() or none of them');
}
function body(input: Input, options: LlmOptions): object {
  const { model, provider, system, output, tools, maxOutputTokens, metadata } = options;
  return { ...(typeof input === 'string' ? { input } : { messages: input }), model, provider, system, output,
    tools: tools?.map(({ name, description, schema }) => ({ name, description, schema })), maxOutputTokens, metadata };
}
async function request(path: string, input: Input, options: LlmOptions): Promise<Response> {
  const response = await send(buildUrl(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(input, options)), signal: options.signal });
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return response;
}
async function generateWire(input: Input, options: LlmOptions = {}): Promise<LlmResult> {
  return await (await request('/llm/generate', input, options)).json() as LlmResult;
}
async function* streamWire(input: Input, options: LlmOptions = {}): AsyncGenerator<LlmStreamEvent> {
  const response = await request('/llm/stream', input, options);
  if (!response.body) throw new Error('LLM response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { completed = true; break; }
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as LlmStreamEvent;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield JSON.parse(buffer) as LlmStreamEvent;
  } finally {
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
const wire: WireRunners = { generate: generateWire, stream: streamWire };
export const llm = {
  generate(input: Input, options: LlmOptions = {}): Promise<LlmResult> {
    const mode = toolMode(options);
    if (options.output?.type === 'json' && mode === 'defs') throw new TypeError('JSON output with tool definitions requires run() handlers');
    return mode === 'loop' ? runToolLoop(input, options, wire) : generateWire(input, options);
  },
  stream(input: Input, options: LlmOptions = {}): AsyncIterable<LlmStreamEvent> {
    const mode = toolMode(options);
    if (options.output?.type === 'json' && mode !== 'loop') throw new TypeError('For JSON output, use generate() or run-bearing tools');
    return mode === 'loop' ? streamToolLoop(input, options, wire) : streamWire(input, options);
  },
  streamRaw(input: Input, options: LlmOptions = {}): Promise<Response> {
    if (options.tools?.some(tool => typeof tool.run === 'function')) throw new TypeError('streamRaw() cannot execute run() handlers; use stream()');
    return request('/llm/stream', input, options);
  },
};
export function llmProviders(): Promise<LlmProviderInfo[]> { return call('GET', '/llm/providers'); }
