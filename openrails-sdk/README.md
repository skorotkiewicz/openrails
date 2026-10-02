# @openrails/sdk

Typed, server-side client for the primary self-hosted OpenRails server. The runtime and public types are maintained in `src/*.ts`, not reconstructed declaration files. `tsc` produces ESM JavaScript, declarations and source maps in `dist/`.

## Build and use

From the repository root:

```sh
bun install
bun run build:sdk
bun run test:sdk
```

```ts
import { configure, db, files, data } from '@openrails/sdk';

configure({ url: 'http://127.0.0.1:8787', token: 'your-server-token' });

const tasks = db.collection<{ title: string; done: boolean }>('tasks');
await tasks.put('first', { title: 'Owned by OpenRails', done: false });
const task = await tasks.get('first'); // { title: string; done: boolean } | null
const pending = await tasks.where('done', 'eq', false).page();

await files.put('notes/hello.txt', 'Hello');
const download = await files.url('notes/hello.txt');

// SQL reads the same records stored by db.collection(), on the primary server.
const rows = await data.runSQL(
  "SELECT key, json_extract(value, '$.title') AS title FROM kv WHERE scope = '' AND collection = $1",
  ['tasks'],
);
console.log(task, pending, download.url, rows.columns);
```

Alternatively, set `OPENRAILS_URL` and `OPENRAILS_TOKEN`; configuration is loaded lazily on the first request. `configure()` validates the URL and can replace the current connection. This package targets Node 20+ and Bun. Keep the service token on trusted servers, never in a frontend bundle.

## API

- `db`: typed collections, filtering, ordering, pagination and read-only imported scopes.
- `files`: metadata, binary uploads/downloads, listing, deletion and signed URL batches. ReadableStream uploads work with Node's required duplex option.
- `data`, `query`, `savedQueries`, `dataConnectors`: read-only SQL on OpenRails' own SQLite database. No external database provider namespaces.
- `appUsers`: the configured roster, not a user authentication system.
- `llm`, `llmProviders`: optional model integration, structured output, NDJSON and executable tool loops. Server-side streaming currently buffers one completion.
- `email` and HTTP `connector`: opt-in integrations; the core server does not require them.
- `ApiError`, `errorFrame`, `toNdjson`: structured errors and streaming response helpers.
- `agents` and connector tool calls are reserved APIs; the current server returns `501`.
- `ctx`: standalone context (`user: null`, `trigger: 'http'`, `invocationId: 'local'`). It does not decode unverified user claims or pretend to be a deployed worker.
- `secrets`: your client process environment, not secrets fetched from the server.

Collection names are single path segments. Keys and file names may contain `/`, spaces and Unicode, but `.` and `..` segments are rejected before requests are sent. The backend still validates all request input.

## Package maintenance

`npm run build`, `npm run typecheck` and `npm test` also work inside this directory after dependencies have been installed. There is no bundler or runtime dependency. The published package includes generated runtime/declarations plus the TypeScript source for debugging; `legacy-dist/` is an unmodified local reference and is not published.

Tests cover typed collection usage, invalid type rejection, URL construction, error details, SQL result metadata, NDJSON source cleanup, tool validation, execution limits and cancellation. The repository's `tests/sdk.mjs` additionally exercises this built package against a real Rust server.
