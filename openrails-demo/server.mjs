import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  configure, db, appUsers, files, data, dataConnectors, query, savedQueries,
  llm, llmProviders, email, connector, serviceConnectors, serviceConnectorDocs,
  agents, ctx, secrets, ApiError, LlmRunError, errorFrame, toNdjson,
} from 'openrails';

let clientConfig;
try {
  clientConfig = JSON.parse(await readFile(process.env.DEMO_CONFIG || new URL('config.json', import.meta.url), 'utf8'));
} catch {
  // Do not print JSON parser errors: they can include the secret from a malformed config.
  throw new Error('Could not read client config. Copy config.example.json to config.json and supply valid JSON, or set DEMO_CONFIG to a client config path.');
}
if (!clientConfig || typeof clientConfig !== 'object' || Array.isArray(clientConfig) || typeof clientConfig.url !== 'string' || typeof clientConfig.token !== 'string' || Object.keys(clientConfig).some(key => !['url', 'token'].includes(key))) {
  throw new Error('Client config must contain only url and token. Projects and LLM settings belong on the OpenRails server.');
}
const backend = process.env.OPENRAILS_URL ?? clientConfig.url;
const token = process.env.DEMO_API_KEY ?? clientConfig.token;
if (!token) throw new Error('Put your existing project key in config.json as token, or set DEMO_API_KEY. See README.md.');
configure({ url: backend, token });
const port = Number(process.env.DEMO_PORT || 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid DEMO_PORT');
const assets = new Map(await Promise.all(['index.html', 'client.js'].map(async name => [name, await readFile(new URL(name, import.meta.url))])));
const tasks = db.collection('demo_tasks');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (value, fallback = '') => value === undefined || value === '' ? fallback : typeof value === 'string' ? value : fail(400, 'Expected a string');
const number = (value, fallback) => {
  if (value !== undefined && typeof value !== 'string' && typeof value !== 'number') fail(400, 'Expected a number');
  const result = value === undefined || value === '' ? fallback : Number(value);
  return Number.isFinite(result) ? result : fail(400, 'Expected a finite number');
};
const json = (value, fallback) => value === undefined || value === '' ? fallback : JSON.parse(text(value));
const filename = name => `demo/${text(name, 'hello.txt')}`;
function filtered(p) {
  const q = tasks.query();
  if (p.field) q.where(text(p.field), text(p.operator, 'eq'), json(p.match, null));
  if (p.prefix) q.prefix(text(p.prefix));
  if (p.since) q.updatedSince(text(p.since));
  if (p.before) q.updatedBefore(text(p.before));
  if (p.order) q.orderBy(text(p.order), text(p.direction, 'asc'));
  return q;
}
const sqlResult = rows => ({ rows, columns: rows.columns, rowcount: rows.rowcount, truncated: rows.truncated });
const double = {
  name: 'double', description: 'Double a number.',
  schema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'], additionalProperties: false },
  run: ({ n }) => { if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1_000_000) fail(400, 'Tool argument n is outside the demo range'); return n * 2; },
};
const { run, ...definition } = double;
function options(p, signal) {
  const maxOutputTokens = number(p.tokens, 384);
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 2048) fail(400, 'Use 1..2048 output tokens');
  return { signal, maxOutputTokens, ...(p.model ? { model: text(p.model) } : {}), system: 'Answer briefly.' };
}
const toolPrompt = p => `Use the double tool with n=${number(p.n, 21)}, then report its result.`;
const toolOptions = (p, signal) => ({ ...options(p, signal), tools: [double], limits: { maxSteps: 3, maxToolCalls: 5, timeoutMs: 120_000 } });
const scoped = p => (p.kind === 'role' ? db.scopedRole(text(p.owner, 'owner')) : db.scoped(text(p.owner, 'owner'))).collection('demo_tasks');

const actions = {
  'context': () => ({ ctx, backend, config: { url: backend, token: '[never sent to browser]' }, secrets: { DEMO_API_KEY: { configured: Boolean(secrets.DEMO_API_KEY), value: '[never sent to browser]' } } }),
  'users': () => appUsers(),
  'kv.seed': async () => {
    const values = [{ title: 'Try collections', score: 1, done: false }, { title: 'Upload a file', score: 2, done: true }, { title: 'Ask the local model', score: 3, done: false }];
    for (const [i, value] of values.entries()) await tasks.put(`sample-${String.fromCharCode(97 + i)}`, value);
    return tasks.list();
  },
  'kv.put': p => tasks.put(text(p.key, 'sample-a'), json(p.value, {})),
  'kv.get': p => tasks.get(text(p.key, 'sample-a')),
  'kv.delete': p => tasks.delete(text(p.key, 'sample-a')),
  'kv.list': () => tasks.list(),
  'kv.page': p => filtered(p).page(number(p.page, 1), number(p.size, 10)),
  'kv.first': p => filtered(p).first(),
  'kv.count': p => filtered(p).count(),
  'kv.where': p => tasks.where(text(p.field, 'score'), text(p.operator, 'eq'), json(p.match, 1)).page(),
  'kv.prefix': p => tasks.prefix(text(p.prefix, 'sample-')).page(),
  'scope.get': p => scoped(p).get(text(p.key, 'sample-a')),
  'scope.list': p => scoped(p).list(number(p.page, 1), number(p.size, 10)),
  'files.put': p => files.put(filename(p.name), text(p.text, 'Hello from OpenRails!')),
  'files.streamPut': p => files.put(filename(p.name), new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text(p.text, 'Hello from a ReadableStream!'))); controller.close(); } }), 'text/plain; charset=utf-8'),
  'files.list': () => files.list(),
  'files.get': async p => {
    const response = await files.get(filename(p.name));
    if (!response) return null;
    const reader = response.body.getReader(); const chunks = []; let received = 0;
    try {
      while (received <= 4096) { const { value, done } = await reader.read(); if (done) break; chunks.push(Buffer.from(value)); received += value.length; }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = Buffer.concat(chunks).subarray(0, 4096);
    return { size: Number(response.headers.get('content-length')), contentType: response.headers.get('content-type'), preview: bytes.toString('utf8'), truncated: received > 4096 };
  },
  'files.url': p => files.url(filename(p.name)),
  'files.urls': p => files.urls(text(p.names, 'hello.txt,missing.txt').split(',').map(name => filename(name.trim()))),
  'files.delete': p => files.delete(filename(p.name)),
  'sql': async p => sqlResult(await data.runSQL(text(p.sql, "SELECT key, value FROM kv WHERE collection = $1"), json(p.params, ['demo_tasks']))),
  'sql.connection': async p => sqlResult(await data('default').runSQL(text(p.sql, 'SELECT name, size FROM files'), json(p.params, []))),
  'dataConnectors': () => dataConnectors(),
  'savedQueries': () => savedQueries(),
  'query': async p => sqlResult(await query(text(p.name, 'demo_task'), json(p.params, { key: 'sample-a' }))),
  'llm.providers': () => llmProviders(),
  'llm.generate': (p, signal) => llm.generate(text(p.prompt, 'Say hello in one sentence.'), options(p, signal)),
  'llm.messages': (p, signal) => llm.generate(json(p.messages, [{ role: 'user', content: 'Say hello.' }]), options(p, signal)),
  'llm.json': (p, signal) => llm.generate(`What is double ${number(p.n, 21)}? Return only JSON with a numeric answer.`, { ...options(p, signal), output: { type: 'json', schema: { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'], additionalProperties: false } } }),
  'llm.stream': (p, signal) => toNdjson(llm.stream(text(p.prompt, 'Say hello.'), options(p, signal))),
  'llm.streamRaw': (p, signal) => llm.streamRaw(text(p.prompt, 'Say hello.'), options(p, signal)),
  'llm.definitions': (p, signal) => llm.generate(toolPrompt(p), { ...options(p, signal), tools: [definition] }),
  'llm.tools': (p, signal) => llm.generate(toolPrompt(p), toolOptions(p, signal)),
  'llm.toolStream': (p, signal) => toNdjson(llm.stream(toolPrompt(p), toolOptions(p, signal))),
  'email.send': p => email.send({ to: text(p.to), subject: text(p.subject, 'OpenRails demo'), text: text(p.text, 'Hello from the demo.'), ...(p.replyTo ? { replyTo: text(p.replyTo) } : {}) }),
  'connectors': () => serviceConnectors(),
  'connector.docs': p => serviceConnectorDocs(text(p.name, 'models')),
  'connector.fetch': async p => { const response = await connector(text(p.name, 'models')).fetch(text(p.path, '/v1/models'), { method: text(p.method, 'GET'), ...(p.body ? { body: text(p.body) } : {}) }); return { status: response.status, ok: response.ok, headers: response.headers, truncated: response.truncated, body: await response.text() }; },
  'connector.json': async p => connector(text(p.name, 'models')).fetch(text(p.path, '/v1/models')).then(response => response.json()),
  'connector.tools': p => connector(text(p.name, 'models')).tools(),
  'connector.call': p => connector(text(p.name, 'models')).call(text(p.tool, 'example'), json(p.args, {})),
  'agents.start': p => agents.start(text(p.name, 'demo'), json(p.input, {})),
  'agents.get': p => agents.get(text(p.id, 'demo-request')),
  'errorFrame': () => ({ frame: errorFrame(new ApiError(400, JSON.stringify({ detail: 'Example SDK error' }))), classes: [ApiError.name, LlmRunError.name] }),
  'ndjson': p => toNdjson((async function* () { yield { type: 'example', message: 'First frame' }; yield { type: 'example', message: 'Second frame' }; if (p.fail === 'yes') throw new Error('Example generator failure'); })()),
};

async function body(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) { size += chunk.length; if (size > limit) { req.resume(); fail(413, 'Request body exceeds the demo limit'); } chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value === undefined ? { ok: true } : value));
}
async function sendResponse(res, response) {
  res.writeHead(response.status, { 'content-type': response.headers.get('content-type') || 'application/octet-stream', ...(response.headers.has('content-disposition') ? { 'content-disposition': 'attachment' } : {}) });
  if (response.body) await pipeline(Readable.fromWeb(response.body), res);
  else res.end();
}
const server = createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const controller = new AbortController();
  res.once('close', () => controller.abort());
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
  try {
    const hosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
    if (!hosts.includes(req.headers.host) || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) fail(403, 'This demo only accepts local, same-origin requests');
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/client.js')) {
      res.writeHead(200, { 'content-type': url.pathname === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' });
      res.end(assets.get(url.pathname === '/' ? 'index.html' : 'client.js'));
    } else if (req.method === 'GET' && url.pathname === '/download') {
      const response = await files.get(filename(url.searchParams.get('name') || 'hello.txt'));
      if (!response) fail(404, 'File not found');
      res.setHeader('content-disposition', 'attachment');
      await sendResponse(res, response);
    } else if (req.method === 'POST' && url.pathname === '/upload') {
      const bytes = await body(req, 16 * 1024 * 1024);
      sendJson(res, 200, await files.put(filename(url.searchParams.get('name') || 'upload.bin'), bytes, req.headers['content-type'] || 'application/octet-stream'));
    } else if (req.method === 'POST' && url.pathname === '/api') {
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') fail(415, 'Use application/json');
      const payload = JSON.parse((await body(req, 1024 * 1024)).toString('utf8'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.op !== 'string') fail(400, 'Supply an operation object');
      if (!Object.hasOwn(actions, payload.op)) fail(404, 'Unknown demo operation');
      const result = await actions[payload.op](payload, signal);
      if (result instanceof Response) await sendResponse(res, result);
      else sendJson(res, 200, result);
    } else fail(404, 'Not found');
  } catch (error) {
    if (res.destroyed) return;
    if (res.headersSent) { res.destroy(); return; }
    const status = error instanceof ApiError ? error.status : error.status || (error instanceof SyntaxError ? 400 : 502);
    sendJson(res, status, { ...errorFrame(error), status });
  }
});
server.listen(port, '127.0.0.1', () => console.log(`OpenRails demo: http://127.0.0.1:${server.address().port}`));
