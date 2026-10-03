// Run: cargo build --locked && node tests/sdk.mjs (Node 20+).
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, copyFile, writeFile, readdir, readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'openrails-sdk-'));
const token = 'sdk-test-token-with-at-least-32-characters';
const otherToken = 'other-project-key-with-at-least-32-characters';
const multi = process.argv.includes('--projects');
const storageDir = multi ? join(dir, 'projects', 'main') : dir;
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
const appConfig = {
  users: [{ uuid: 'user-1', name: 'Owner', email: 'owner@example.com', is_admin: true }],
  queries: { task: { sql: "SELECT json_extract(value, '$.title') AS title FROM kv WHERE scope='' AND collection='sql_tasks' AND key=$1", params: [{ name: 'key', type: 'string' }], description: 'One task' } },
  llm: { base_url: `${provider}/v1`, api_key_env: 'MOCK_LLM_KEY', model: 'mock-model' },
  email: { url: `${provider}/emails`, from: 'sender@example.com', api_key_env: 'MOCK_EMAIL_KEY' },
  service_connectors: { mock: { base_url: provider, allowed_methods: ['GET', 'POST'], bearer_token_env: 'MOCK_CONNECTOR_KEY', usage_instructions: 'Local test' } },
};
await writeFile(configPath, JSON.stringify(multi ? {
  projects: {
    main: { api_key_env: 'MOCK_PROJECT_KEY', config: appConfig },
    other: { api_key_env: 'MOCK_OTHER_KEY', config: {
      users: [{ uuid: 'other-owner', name: 'Other Owner', email: 'other@example.com', is_admin: false }],
      queries: { only_other: { sql: "SELECT 'other' AS project" } },
    } },
  },
} : appConfig));
// The backend cannot report an ephemeral port to the SDK before startup.
const socket = createSocketServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const url = `http://127.0.0.1:${port}`;
process.env.OPENRAILS_TOKEN = token;
process.env.OPENRAILS_URL = url;
const serverEnv = { ...process.env, OPENRAILS_TOKEN: multi ? 'unused-global-token-with-at-least-32-characters' : token, MOCK_PROJECT_KEY: token, MOCK_OTHER_KEY: otherToken, OPENRAILS_PROJECTS_DIR: join(dir, 'projects'), OPENRAILS_FILES_DIR: join(storageDir, 'files'), OPENRAILS_BIND: `127.0.0.1:${port}`, OPENRAILS_PUBLIC_URL: url, OPENRAILS_DB_PATH: join(dir, 'backend.sqlite3'), OPENRAILS_CONFIG: configPath, MOCK_LLM_KEY: 'mock-llm-key', MOCK_EMAIL_KEY: 'mock-email-key', MOCK_CONNECTOR_KEY: 'mock-connector-key' };
const server = spawn(join(root, 'target/debug/openrails-backend'), [], {
  env: serverEnv,
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
  const { db, files, appUsers, data, dataConnectors, query, savedQueries, llm, llmProviders, email, connector, serviceConnectors, serviceConnectorDocs, agents, ApiError, ctx, secrets, configure } = await import('openrails');
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
  const stored = await readdir(join(storageDir, 'files'));
  assert.equal(stored.length, 1);
  assert.match(stored[0], /^[0-9a-f]{64}\.blob$/);
  assert.equal(await readFile(join(storageDir, 'files', stored[0]), 'utf8'), 'file body');
  const downloaded = await files.get(meta.name);
  assert.equal(downloaded.headers.get('content-length'), '9');
  assert.equal(await downloaded.text(), 'file body');
  const metadataRows = await data.runSQL('SELECT name, size, storage_key FROM files');
  assert.equal(metadataRows[0].size, 9);
  assert.equal(metadataRows[0].storage_key + '.blob', stored[0]);
  await assert.rejects(data.runSQL('SELECT data FROM files'), error => error.status === 400);
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
  assert.deepEqual(await readdir(join(storageDir, 'files')), []);
  const binary = new Uint8Array([0, 255, 128, 1]);
  await files.put('binary.dat', binary);
  assert.deepEqual(new Uint8Array(await (await files.get('binary.dat')).arrayBuffer()), binary);
  await files.put('stream.txt', new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('streamed upload')); controller.close(); } }));
  assert.equal(await (await files.get('stream.txt')).text(), 'streamed upload');
  await files.delete('binary.dat');
  await files.delete('stream.txt');

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
  assert.equal('bigquery' in await import('openrails'), false);
  assert.equal('turso' in await import('openrails'), false);
  assert.equal('postgres' in await import('openrails'), false);
  // A failed SQL query must not disable primary KV writes.
  await tasks.put('after-sql', { score: 4 });
  assert.equal((await tasks.get('after-sql')).score, 4);
  assert.equal(secrets.OPENRAILS_TOKEN, token);
  assert.equal((await fetch(`${url}/fn/data/files`)).status, 401);
  if (process.argv.includes('--demo')) {
    assert.equal(JSON.parse(await readFile(join(root, 'config.demo.example.json'), 'utf8')).projects.demo.api_key_env, 'DEMO_API_KEY');
    const clientDir = join(dir, 'client');
    await mkdir(clientDir);
    for (const name of ['package.json', 'openrails-sdk-0.1.0.tgz', 'config.example.json', 'server.mjs', 'index.html', 'client.js']) {
      await copyFile(join(root, 'openrails-demo', name), join(clientDir, name));
    }
    assert.equal(JSON.parse(await readFile(join(clientDir, 'package.json'), 'utf8')).scripts.demo, 'node server.mjs');
    assert.deepEqual(Object.keys(JSON.parse(await readFile(join(clientDir, 'config.example.json'), 'utf8'))).sort(), ['token', 'url']);
    execFileSync('bun', ['install', '--offline'], { cwd: clientDir, timeout: 15000, stdio: 'pipe' });
    execFileSync('bun', ['run', 'check'], { cwd: clientDir, timeout: 15000, stdio: 'pipe' });
    await writeFile(join(clientDir, 'config.json'), JSON.stringify({ url, token }), { mode: 0o600 });
    const privateMarker = 'private-config-token-must-never-appear-in-logs';
    const invalidConfigs = [
      [JSON.stringify({ url, token: '' }), /Put your existing project key/],
      [JSON.stringify({ projects: {} }), /Client config must contain only url and token/],
      [JSON.stringify({ url, token: 123 }), /Client config must contain only url and token/],
      [JSON.stringify({ url, token, extra: true }), /Client config must contain only url and token/],
      [`{"url":"${url}","token":"${privateMarker}" invalid}`, /Could not read client config/],
    ];
    for (const [configuration, expected] of invalidConfigs) {
      const rejectedPath = join(dir, 'invalid-client.json');
      await writeFile(rejectedPath, configuration);
      const rejected = spawn(process.execPath, ['server.mjs'], {
        cwd: clientDir,
        env: { ...process.env, DEMO_CONFIG: rejectedPath, DEMO_API_KEY: undefined, OPENRAILS_URL: undefined, OPENRAILS_TOKEN: token }, stdio: ['ignore', 'ignore', 'pipe'], timeout: 5000,
      });
      let logs = '';
      rejected.stderr.on('data', chunk => { logs += chunk; });
      assert.equal((await once(rejected, 'exit'))[0], 1);
      assert.match(logs, expected);
      assert(!logs.includes(privateMarker));
      assert(!logs.includes(token));
    }
    const demo = spawn(process.execPath, ['server.mjs'], {
      cwd: clientDir,
      env: { ...process.env, DEMO_CONFIG: undefined, OPENRAILS_URL: undefined, DEMO_API_KEY: undefined, OPENRAILS_TOKEN: 'wrong-global-key-must-not-be-used-by-the-demo', DEMO_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let demoLogs = '';
    demo.stdout.on('data', chunk => { demoLogs += chunk; });
    demo.stderr.on('data', chunk => { demoLogs += chunk; });
    try {
      let demoUrl;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (demo.exitCode !== null) throw new Error(demoLogs);
        demoUrl = demoLogs.match(/OpenRails demo: (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
        if (demoUrl) break;
        await delay(30);
      }
      assert(demoUrl, demoLogs);
      const action = async (op, input = {}, expected = 200) => {
        const response = await fetch(`${demoUrl}/api`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, ...input }) });
        assert.equal(response.status, expected, await response.clone().text());
        return response.headers.get('content-type').includes('ndjson') ? (await response.text()).trim().split('\n').map(line => JSON.parse(line)) : response.json();
      };
      const page = await (await fetch(demoUrl)).text();
      assert(page.includes('Local LLM') && page.includes('Reserved agent APIs'));
      assert(page.includes('type="module" src="/client.js"'));
      assert((await fetch(`${demoUrl}/client.js`)).ok);
      const state = await action('context');
      assert.equal(state.ctx.user, null);
      assert.equal(state.secrets.DEMO_API_KEY.configured, false);
      assert.equal(state.config.url, url);
      assert.equal(state.config.token, '[never sent to browser]');
      assert(!JSON.stringify(state).includes(token));
      assert.equal((await fetch(`${demoUrl}/config.json`)).status, 404);
      assert.equal((await action('users'))[0].id, 'user-1');
      assert.equal((await action('kv.seed')).length, 3);
      assert.equal((await action('kv.get')).score, 1);
      await action('kv.put', { key: 'extra', value: '{"score":9,"title":"<script>never execute</script>"}' });
      assert.equal((await action('kv.list')).length, 4);
      assert.equal((await action('kv.page', { field: 'score', operator: 'gte', match: '2', order: 'score', direction: 'desc', page: 1, size: 1 }))[0].key, 'extra');
      assert.equal((await action('kv.first', { field: 'score', operator: 'eq', match: '9' })).key, 'extra');
      assert.equal(await action('kv.count', { since: '2000-01-01T00:00:00Z' }), 4);
      assert.equal(await action('kv.count', { before: '2000-01-01T00:00:00Z' }), 0);
      assert.equal((await action('kv.where', { field: 'score', operator: 'in', match: '[1,2]' })).length, 2);
      assert.equal((await action('kv.prefix', { prefix: 'sample-' })).length, 3);
      await action('kv.delete', { key: 'extra' });
      assert.equal(await action('kv.get', { key: 'extra' }), null);
      for (const kind of ['user', 'role']) { assert.deepEqual(await action('scope.list', { kind }), []); assert.equal(await action('scope.get', { kind }), null); }
      assert.equal((await action('files.put', { text: 'demo file' })).size, 9);
      assert.equal((await action('files.get')).preview, 'demo file');
      assert.equal((await action('files.list')).length, 1);
      const link = await action('files.url'); assert.equal(await (await fetch(link.url)).text(), 'demo file');
      assert.deepEqual((await action('files.urls')).missing, ['demo/missing.txt']);
      assert.equal(await (await fetch(`${demoUrl}/download?name=hello.txt`)).text(), 'demo file');
      await action('files.streamPut', { name: 'stream.txt', text: 'stream body' });
      assert.equal((await action('files.get', { name: 'stream.txt' })).preview, 'stream body');
      const uploaded = await fetch(`${demoUrl}/upload?name=binary.dat`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array([0, 255, 1]) });
      assert.equal(uploaded.status, 200);
      assert.deepEqual(new Uint8Array(await (await fetch(`${demoUrl}/download?name=binary.dat`)).arrayBuffer()), new Uint8Array([0, 255, 1]));
      await action('files.put', { name: 'large.txt', text: 'x'.repeat(5000) });
      const preview = await action('files.get', { name: 'large.txt' }); assert.equal(preview.preview.length, 4096); assert.equal(preview.truncated, true);
      await action('files.delete'); assert.equal(await action('files.get'), null);
      const sql = await action('sql', { sql: 'SELECT key FROM kv WHERE collection=$1', params: '["demo_tasks"]' }); assert.equal(sql.rowcount, 3); assert.deepEqual(sql.columns, ['key']);
      assert.equal((await action('sql.connection', { sql: 'SELECT 42 AS answer', params: '[]' })).rows[0].answer, 42);
      assert.equal((await action('dataConnectors'))[0].engine, 'sqlite');
      assert.equal((await action('savedQueries'))[0].name, 'task');
      assert.equal((await action('query', { name: 'task', params: '{"key":"1"}' })).rows[0].title, 'demo');
      await action('sql', { sql: 'DELETE FROM kv', params: '[]' }, 400);
      assert.equal((await action('llm.providers'))[0].provider, 'openai');
      assert.equal((await action('llm.generate')).text, 'Hello from the model');
      assert.equal((await action('llm.messages')).text, 'Hello from the model');
      assert.equal((await action('llm.json')).output.answer, 42);
      for (const op of ['llm.stream', 'llm.streamRaw']) assert.equal((await action(op)).at(-1).type, 'done');
      assert.equal((await action('llm.definitions')).toolCalls[0].name, 'double');
      assert.equal((await action('llm.tools')).steps[0].result, 4);
      assert((await action('llm.toolStream')).some(frame => frame.type === 'step' && frame.step.status === 'ok'));
      assert.equal((await action('email.send', { to: 'test@example.com', replyTo: 'reply@example.com' })).status, 'accepted');
      assert.equal((await action('connectors'))[0].name, 'mock');
      assert.equal((await action('connector.docs', { name: 'mock' })).kind, 'http');
      assert.equal((await action('connector.fetch', { name: 'mock', path: '/demo' })).status, 200);
      assert.equal((await action('connector.json', { name: 'mock', path: '/demo' })).path, '/demo');
      assert.deepEqual(await action('connector.tools', { name: 'mock' }), []);
      for (const op of ['connector.call', 'agents.start', 'agents.get']) await action(op, { name: 'mock' }, 501);
      assert.equal((await action('errorFrame')).frame.error, 'provider_error');
      assert.equal((await action('ndjson', { fail: 'yes' })).at(-1).type, 'error');
      assert.equal((await action('ndjson')).length, 2);
      await action('__proto__', {}, 404);
      await action('kv.put', { value: '{bad' }, 400);
      await action('llm.generate', { tokens: -1 }, 400);
      assert.equal((await fetch(`${demoUrl}/api`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{"op":"kv.seed"}' })).status, 403);
      assert.equal((await fetch(`${demoUrl}/api`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"op":"kv.seed"}' })).status, 415);
      assert.equal((await fetch(`${demoUrl}/api`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
      const deniedHost = await new Promise((resolve, reject) => {
        const request = httpRequest(demoUrl, { headers: { host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
        request.on('error', reject); request.end();
      });
      assert.equal(deniedHost, 403);
      console.log('Browser demo HTTP check passed: SDK actions, streaming, uploads, scoped APIs, reserved errors and local-only guards.');
    } finally {
      const exited = once(demo, 'exit');
      if (demo.exitCode === null) { demo.kill('SIGTERM'); await exited; }
    }
  }
  if (multi) {
    const isolated = db.collection('isolation');
    await isolated.put('same', { project: 'main' });
    await files.put('same.txt', 'main file');
    const mainLink = await files.url('same.txt');
    assert.equal(new URL(mainLink.url).searchParams.get('project'), 'main');
    assert.equal(await (await fetch(mainLink.url)).text(), 'main file');
    const unauthorized = await fetch(`${url}/fn/data/files`, { headers: { authorization: 'Bearer unused-global-token-with-at-least-32-characters' } });
    assert.equal(unauthorized.status, 401);
    configure({ url, token: otherToken });
    assert.equal(await isolated.get('same'), null);
    assert.equal(await files.get('same.txt'), null);
    assert.equal((await files.list()).length, 0);
    assert.equal((await appUsers())[0].id, 'other-owner');
    assert.deepEqual((await savedQueries()).map(item => item.name), ['only_other']);
    assert.equal((await query('only_other'))[0].project, 'other');
    await assert.rejects(query('task', { key: 'task-1' }), error => error.status === 404);
    assert.deepEqual(await llmProviders(), []);
    const before = providerRequests.length;
    await assert.rejects(llm.generate('Must not use the main model'), error => error.status === 501);
    await assert.rejects(email.send({ to: 'test@example.com', subject: 'Isolated', text: 'test' }), error => error.status === 501);
    await assert.rejects(connector('mock').fetch('/test'), error => error.status === 404);
    assert.equal(providerRequests.length, before);
    await isolated.put('same', { project: 'other' });
    await files.put('same.txt', 'other file');
    assert.equal(await (await files.get('same.txt')).text(), 'other file');
    const rows = await data.runSQL("SELECT json_extract(value, '$.project') AS project FROM kv WHERE collection='isolation'");
    assert.deepEqual(rows.map(row => row.project), ['other']);
    await assert.rejects(data.runSQL(`ATTACH DATABASE '${join(storageDir, 'backend.sqlite3')}' AS other`), error => error.status === 400);
    const otherLink = await files.url('same.txt');
    assert.equal(await (await fetch(otherLink.url)).text(), 'other file');
    const changed = new URL(mainLink.url);
    changed.searchParams.set('project', 'other');
    assert.equal((await fetch(changed)).status, 403);
    changed.searchParams.delete('project');
    assert.equal((await fetch(changed)).status, 403);
    changed.searchParams.set('project', 'missing');
    assert.equal((await fetch(changed)).status, 403);
    configure({ url, token });
    assert.equal((await isolated.get('same')).project, 'main');
    assert.equal(await (await files.get('same.txt')).text(), 'main file');
    // A project query parameter cannot override the key-selected project.
    const attemptedOverride = await fetch(`${url}/fn/data/kv/isolation/same?project=other`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await attemptedOverride.json()).value.project, 'main');
    const invalidHeaders = [undefined, `Bearer ${otherToken}x`, 'Basic nope', 'Bearer short'];
    for (const authorization of invalidHeaders) {
      assert.equal((await fetch(`${url}/fn/data/app-users`, { headers: authorization ? { authorization } : {} })).status, 401);
    }
    // Concurrent requests keep their own authenticated App, not a global selected project.
    const concurrent = await Promise.all(Array.from({ length: 20 }, async (_, i) => {
      const key = i % 2 ? token : otherToken;
      return await (await fetch(`${url}/fn/data/kv/isolation/same`, { headers: { authorization: `Bearer ${key}` } })).json();
    }));
    concurrent.forEach((item, i) => assert.equal(item.value.project, i % 2 ? 'main' : 'other'));
    const minimal = { main: { api_key_env: 'MOCK_PROJECT_KEY' } };
    const invalidConfigs = [
      [{ projects: {} }, {}, /Configure at least one project/],
      [{ projects: { ...minimal, other: { api_key_env: 'MOCK_OTHER_KEY' } } }, { MOCK_OTHER_KEY: token }, /distinct API key/],
      [{ projects: { '../escape': minimal.main } }, {}, /Project IDs/],
      [{ projects: { main: { api_key_env: 'MISSING_PROJECT_KEY' } } }, { MISSING_PROJECT_KEY: undefined }, /Set MISSING_PROJECT_KEY/],
      [{ projects: minimal }, { MOCK_PROJECT_KEY: 'short' }, /API keys/],
      [{ projects: minimal, users: [] }, {}, /unknown field.*users/],
      [{ projects: { main: { ...minimal.main, config: { llm: { base_url: provider, model: 'mock', api_key_env: 'MISSING_MODEL_KEY' } } } } }, { MISSING_MODEL_KEY: undefined }, /Provider credential/],
    ];
    for (const [configuration, environment, expected] of invalidConfigs) {
      const rejectedDir = await mkdtemp(join(tmpdir(), 'openrails-invalid-project-'));
      const rejectedConfig = join(rejectedDir, 'config.json');
      await writeFile(rejectedConfig, JSON.stringify(configuration));
      const rejected = spawn(join(root, 'target/debug/openrails-backend'), [], {
        env: { ...serverEnv, ...environment, OPENRAILS_CONFIG: rejectedConfig, OPENRAILS_BIND: '127.0.0.1:0', OPENRAILS_DB_PATH: join(rejectedDir, 'backend.sqlite3'), OPENRAILS_PROJECTS_DIR: join(rejectedDir, 'projects') },
        stdio: ['ignore', 'ignore', 'pipe'], timeout: 5000,
      });
      let error = '';
      rejected.stderr.on('data', chunk => { error += chunk; });
      const [code] = await once(rejected, 'exit');
      assert.equal(code, 1, error);
      assert.match(error, expected);
      assert.deepEqual(await readdir(rejectedDir), ['config.json']);
    }
  }
  console.log(`SDK smoke test passed (${multi ? 'multiple projects' : 'single project'}): persistence APIs, SQL, LLM/tool loop/NDJSON, email, connectors, authentication${multi ? ', project isolation' : ''}.`);
} finally {
  const exited = once(server, 'exit');
  if (server.exitCode === null) { server.kill('SIGTERM'); await exited; }
  await new Promise(resolve => mock.close(resolve));
  // Keep the isolated temp database available for inspecting a failed check.
}
