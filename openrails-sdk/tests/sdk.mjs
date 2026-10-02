import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configure, ApiError, db, files, data, llm, errorFrame, toNdjson } from '../dist/index.js';
import { runToolLoop } from '../dist/tool-loop.js';

const result = { text: 'done', output: null, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, cost: null, model: 'local', provider: 'local', finishReason: 'stop', requestId: 'test' };

test('typed client builds URLs, preserves values and merges SQL metadata', async () => {
  configure({ url: 'http://localhost:8787', token: 'test-token' });
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: new URL(url), init });
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-token');
    if (url.endsWith('/sql')) return Response.json({ columns: ['answer'], rows: [[42]], rowcount: 1, truncated: false });
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json({ key: 'nested/a ✓', value: JSON.parse(init.body).value, updated_at: '2026-01-01T00:00:00Z' });
  };
  try {
    const values = db.collection('values');
    for (const value of [0, false, '', null, { title: 'typed' }]) assert.deepEqual(await values.put('nested/a ✓', value), value);
    assert(requests[0].url.pathname.endsWith('/nested/a%20%E2%9C%93'));
    await values.delete('nested/a ✓');
    const rows = await data.runSQL('SELECT $1 AS answer', [42]);
    assert.deepEqual(rows[0], { answer: 42 });
    assert.deepEqual(rows.columns, ['answer']);
    assert.equal(rows.rowcount, 1);
    assert.equal(rows.truncated, false);
    const count = requests.length;
    assert.throws(() => db.collection('bad/name'), TypeError);
    await assert.rejects(values.put('../wrong', 1), TypeError);
    await assert.rejects(files.put('nested/../wrong', 'data'), TypeError);
    assert.equal(requests.length, count);
  } finally { globalThis.fetch = original; }
});

test('API errors and NDJSON retain error details and close their source', async () => {
  const error = new ApiError(400, '{"detail":{"error":"bad_input","message":"Wrong input"}}');
  assert.equal(error.detail, 'Wrong input');
  assert.deepEqual(errorFrame(error), { type: 'error', error: 'bad_input', message: 'Wrong input' });
  let closed = false;
  async function* source() { try { yield { type: 'text', text: 'hello' }; throw error; } finally { closed = true; } }
  const response = toNdjson(source(), { headers: new Headers({ 'x-test': 'ok' }) });
  const frames = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(response.headers.get('x-test'), 'ok');
  assert.equal(frames[1].error, 'bad_input');
  assert.equal(closed, true);
});

test('tool loop validates, observes failures, enforces budgets and handles cancellation', async () => {
  let turns = 0;
  const wire = {
    async generate() { return ++turns === 1 ? { ...result, text: '', toolCalls: [{ id: '1', name: 'double', arguments: { n: 'wrong' } }] } : result; },
    async *stream() { throw new Error('not used'); },
  };
  const invalid = await runToolLoop('hello', { tools: [{ name: 'double', description: 'Double', schema: { properties: { n: { type: 'integer' } } }, run: () => { throw new Error('must not execute invalid input'); } }] }, wire);
  assert.equal(invalid.steps[0].status, 'error');
  assert(invalid.steps[0].error.includes('wrong type'));
  assert.equal(invalid.stopReason, 'end');
  assert.equal(invalid.usage.totalTokens, 4);
  const planning = { ...wire, generate: async () => ({ ...result, toolCalls: [{ id: '1', name: 'double', arguments: { n: 2 } }] }) };
  const limited = await runToolLoop('hello', { tools: [{ name: 'double', description: 'Double', run: ({ n }) => n * 2 }], limits: { maxToolCalls: 0 } }, planning);
  assert.equal(limited.stopReason, 'max_tool_calls');
  assert.equal(limited.steps.length, 0);
  const never = await runToolLoop('hello', { tools: [{ name: 'double', description: 'Double', run: () => new Promise(() => {}) }], limits: { timeoutMs: 10 } }, planning);
  assert.equal(never.stopReason, 'timeout');
  const controller = new AbortController();
  controller.abort();
  const aborted = await runToolLoop('hello', { signal: controller.signal }, wire);
  assert.equal(aborted.stopReason, 'aborted');
  assert.throws(() => llm.streamRaw('hello', { tools: [{ name: 'tool', description: 'Tool', run: () => null }] }), TypeError);
});
