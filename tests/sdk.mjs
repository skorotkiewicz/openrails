// Run: cargo build --locked && node tests/sdk.mjs (Node 20+).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'openrails-sdk-'));
const token = 'sdk-test-token-with-at-least-32-characters';
const providerRequests = [];
const mock = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : null;
    providerRequests.push({ path: req.url, auth: req.headers.authorization, body });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/chat/completions') {
      assert.equal(req.headers.authorization, 'Bearer mock-llm-key');
      assert.equal(body.model, 'mock-model');
      let content = 'Hello from the model';
      let tool_calls;
      if (body.response_format) content = JSON.stringify({ answer: 42 });
      if (body.tools && !body.messages.some(m => m.content.startsWith('Tool results:'))) {
        content = '';
        tool_calls = [{ id: 'call-1', type: 'function', function: { name: 'double', arguments: '{"n":2}' } }];
      }
      res.end(JSON.stringify({ id: 'chat-1', model: 'mock-model', choices: [{ message: { content, tool_calls }, finish_reason: tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }));
    } else if (req.url === '/emails') {
      assert.equal(req.headers.authorization, 'Bearer mock-email-key');
      assert.equal(body.from, 'sender@example.com');
      assert.equal(body.reply_to, 'reply@example.com');
      res.end(JSON.stringify({ id: 'email-1' }));
    } else if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://127.0.0.1:1/private' });
      res.end('{}');
    } else if (req.url === '/large') {
      res.end('x'.repeat(4 * 1024 * 1024 + 1));
    } else {
      assert.equal(req.headers.authorization, 'Bearer mock-connector-key');
      res.setHeader('set-cookie', 'secret=private');
      res.setHeader('x-private', 'private');
      res.end(JSON.stringify({ path: req.url, body }));
    }
  } catch (error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: error.message }));
  }
});
mock.listen(0, '127.0.0.1');
await once(mock, 'listening');
const provider = `http://127.0.0.1:${mock.address().port}`;
const configPath = join(dir, 'config.json');
await writeFile(configPath, JSON.stringify({
  users: [{ uuid: 'user-1', name: 'Owner', email: 'owner@example.com', is_admin: true }],
  queries: { task: { sql: "SELECT json_extract(value, '$.title') AS title FROM kv WHERE scope='' AND collection='sql_tasks' AND key=$1", params: [{ name: 'key', type: 'string' }], description: 'One task' } },
  llm: { base_url: `${provider}/v1`, api_key_env: 'MOCK_LLM_KEY', model: 'mock-model' },
  email: { url: `${provider}/emails`, from: 'sender@example.com', api_key_env: 'MOCK_EMAIL_KEY' },
  service_connectors: { mock: { base_url: provider, allowed_methods: ['GET', 'POST'], bearer_token_env: 'MOCK_CONNECTOR_KEY', usage_instructions: 'Local test' } },
}));
// The backend cannot report an ephemeral port to the SDK before startup.
const socket = createSocketServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const url = `http://127.0.0.1:${port}`;
process.env.OPENRAILS_TOKEN = token;
process.env.OPENRAILS_URL = url;
const server = spawn(join(root, 'target/debug/openrails-backend'), [], {
  env: { ...process.env, OPENRAILS_TOKEN: token, OPENRAILS_BIND: `127.0.0.1:${port}`, OPENRAILS_PUBLIC_URL: url, OPENRAILS_DB_PATH: join(dir, 'backend.sqlite3'), OPENRAILS_CONFIG: configPath, MOCK_LLM_KEY: 'mock-llm-key', MOCK_EMAIL_KEY: 'mock-email-key', MOCK_CONNECTOR_KEY: 'mock-connector-key' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let logs = '';
server.stderr.on('data', chunk => { logs += chunk; });
server.on('error', error => { logs += error.message; });

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(logs);
    try { ready = (await fetch(`${url}/health`)).ok; } catch {}
    if (ready) break;
    await delay(50);
  }
  assert(ready, logs || 'Backend did not start');
  const { db, files, appUsers, data, dataConnectors, query, savedQueries, llm, llmProviders, email, connector, serviceConnectors, serviceConnectorDocs, agents, ApiError, ctx, secrets, configure } = await import('@openrails/sdk');
  assert.throws(() => configure({ url: 'file:///tmp/backend', token }), TypeError);
  configure({ url, token });
  const tasks = db.collection('tasks');
  assert.equal(await tasks.get('missing'), null);
  assert.deepEqual(await tasks.put('folder/a ✓', { score: 2, active: true }), { score: 2, active: true });
  await tasks.put('b', { score: 1, active: false });
  await tasks.put('c', { score: 3, active: true });
  assert.deepEqual(await tasks.get('folder/a ✓'), { score: 2, active: true });
  assert.equal((await tasks.list()).length, 3);
  assert.equal(await tasks.where('active', 'eq', true).count(), 2);
  assert.equal((await tasks.where('score', 'in', [2, 3]).orderBy('score', 'desc').first()).key, 'c');
  assert.equal((await tasks.query().orderBy('score').page(2, 1))[0].key, 'folder/a ✓');
  assert.equal((await tasks.prefix('folder/').page()).length, 1);
  assert.equal(await tasks.query().updatedSince(new Date('2000-01-01')).count(), 3);
  assert.equal(await tasks.query().updatedBefore(new Date('2000-01-01')).count(), 0);
  assert.deepEqual(await db.scoped('user-1').collection('tasks').list(), []);
  assert.equal(await db.scopedRole('role-1').collection('tasks').get('absent'), null);
  await tasks.delete('b');
  assert.equal(await tasks.get('b'), null);
  await assert.rejects(tasks.query().page(0), e => e instanceof ApiError && e.status === 400 && e.detail.includes('page'));

  const meta = await files.put('nested/hello ✓.txt', 'file body');
  assert.equal(meta.size, 9);
  assert(meta.content_type.startsWith('text/plain'));
  assert.equal(await (await files.get(meta.name)).text(), 'file body');
  assert.equal(await files.get('missing'), null);
  assert.equal((await files.list()).length, 1);
  const batch = await files.urls([meta.name, 'missing']);
  assert.deepEqual(batch.missing, ['missing']);
  const link = await files.url(meta.name);
  assert.equal(link.expires_in, 900);
  assert.equal(await (await fetch(link.url)).text(), 'file body');
  const tampered = new URL(link.url);
  tampered.searchParams.set('name', 'other');
  assert.equal((await fetch(tampered)).status, 403);
  await files.delete(meta.name);
  assert.equal(await files.get(meta.name), null);

  assert.deepEqual(await appUsers(), [{ id: 'user-1', name: 'Owner', email: 'owner@example.com', is_admin: true }]);
  assert.deepEqual(await dataConnectors(), [{ engine: 'sqlite', name: 'default' }]);
  await db.collection('sql_tasks').put('1', { title: 'demo' });
  const rows = await data.runSQL("SELECT json_extract(value, '$.title') AS title FROM kv WHERE scope='' AND collection='sql_tasks' AND key=$1", ['1']);
  assert.deepEqual(rows[0], { title: 'demo' });
  assert.deepEqual(rows.columns, ['title']);
  assert.equal(rows.rowcount, 1);
  assert.equal(rows.truncated, false);
  assert.equal((await savedQueries())[0].name, 'task');
  assert.equal((await query('task', { key: '1' }))[0].title, 'demo');
  await assert.rejects(query('task', { key: 1 }), e => e.status === 400);
  await assert.rejects(data.runSQL('DELETE FROM kv'), e => e.status === 400);

  assert.equal((await llmProviders())[0].provider, 'openai');
  const result = await llm.generate('hello', { metadata: { tag: 'test' } });
  assert.equal(result.text, 'Hello from the model');
  assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 3, totalTokens: 8 });
  assert.deepEqual(providerRequests.at(-1).body.metadata, { tag: 'test' });
  const structured = await llm.generate('json', { output: { type: 'json', schema: { type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'], additionalProperties: false } } });
  assert.deepEqual(structured.output, { answer: 42 });
  const events = [];
  for await (const event of llm.stream('hello')) events.push(event);
  assert.deepEqual(events.map(e => e.type), ['text', 'done']);
  const raw = await llm.streamRaw('hello');
  assert(raw.headers.get('content-type').includes('application/x-ndjson'));
  assert.equal(JSON.parse((await raw.text()).trim().split('\n').at(-1)).type, 'done');
  const run = await llm.generate('use a tool', { tools: [{ name: 'double', description: 'Double a number', schema: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] }, run: ({ n }) => n * 2 }] });
  assert.equal(run.steps[0].result, 4);
  assert.equal(run.stopReason, 'end');
  assert.equal(run.usage.totalTokens, 16);

  assert.equal((await email.send({ to: 'recipient@example.com', subject: 'Test', text: 'Body', replyTo: 'reply@example.com' })).status, 'accepted');
  await assert.rejects(email.send({ to: 'recipient@example.com', subject: 'Test\r\nBcc: attacker', text: 'Body' }), e => e.status === 400);
  const info = await serviceConnectors();
  assert.equal(info[0].name, 'mock');
  assert.equal(info[0].kind, 'http');
  assert(!JSON.stringify(info).includes(provider));
  assert.equal((await serviceConnectorDocs('mock')).usage_instructions, 'Local test');
  assert.deepEqual(await connector('mock').tools(), []);
  const proxied = await connector('mock').fetch('/test?q=ok', { method: 'POST', body: '{"ok":true}' });
  assert.equal(proxied.ok, true);
  assert.deepEqual(await proxied.json(), { path: '/test?q=ok', body: { ok: true } });
  assert(!('set-cookie' in proxied.headers));
  assert(!('x-private' in proxied.headers));
  assert.equal((await connector('mock').fetch('/redirect')).status, 302);
  assert.equal((await connector('mock').fetch('/large')).truncated, true);
  for (const path of ['//example.com', 'http://example.com', '/\\example.com']) {
    await assert.rejects(connector('mock').fetch(path), e => e.status === 400);
  }
  await assert.rejects(connector('mock').fetch('/test', { method: 'DELETE' }), e => e.status === 405);
  await assert.rejects(connector('mock').call('missing'), e => e.status === 501);
  await assert.rejects(agents.start('missing'), e => e.status === 501);
  assert.equal(ctx.user, null); // Static service token, not a fabricated user identity.
  assert.equal(ctx.trigger, 'http');
  assert.equal(ctx.invocationId, 'local');
  assert.equal('bigquery' in await import('@openrails/sdk'), false);
  assert.equal('turso' in await import('@openrails/sdk'), false);
  assert.equal('postgres' in await import('@openrails/sdk'), false);
  // A failed SQL query must not disable primary KV writes.
  await tasks.put('after-sql', { score: 4 });
  assert.equal((await tasks.get('after-sql')).score, 4);
  assert.equal(secrets.OPENRAILS_TOKEN, token);
  assert.equal((await fetch(`${url}/fn/data/files`)).status, 401);
  console.log('SDK smoke test passed: persistence APIs, SQL, LLM/tool loop/NDJSON, email, connectors, authentication.');
} finally {
  const exited = once(server, 'exit');
  if (server.exitCode === null) { server.kill('SIGTERM'); await exited; }
  await new Promise(resolve => mock.close(resolve));
  // Keep the isolated temp database available for inspecting a failed check.
}
