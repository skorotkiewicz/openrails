# OpenRails

OpenRails is the primary self-hosted Rust server. It stores collections and file metadata in SQLite, and file contents on disk under `.openrails/files/`. No external database provider or object store is required. The `@openrails/sdk` package lives in `openrails-sdk/`, with editable TypeScript source, generated declarations and an ESM build.

## Run

Requires Rust 1.88+ and a C compiler for bundled SQLite.

```sh
export OPENRAILS_TOKEN="$(openssl rand -hex 32)"
export OPENRAILS_PUBLIC_URL="http://127.0.0.1:8787"
cargo run --release --locked
```

Point your trusted Node/Bun app at the server, using the **same token**:

```sh
# Keep the same OPENRAILS_TOKEN as the server.
export OPENRAILS_URL="http://127.0.0.1:8787"
```

```js
import { configure, db, files } from '@openrails/sdk';

configure({ url: 'http://127.0.0.1:8787', token: process.env.OPENRAILS_TOKEN });

const tasks = db.collection('tasks');
await tasks.put('first', { title: 'Self-hosted', done: false });
console.log(await tasks.where('done', 'eq', false).page());

await files.put('notes/hello.txt', 'Hello');
console.log(await files.url('notes/hello.txt'));
```

Build the local SDK first with `bun install && bun run build:sdk`. You can use `configure({ url, token })` instead of environment variables.

`OPENRAILS_URL` is the server origin, not `/fn/data`. All SDK requests carry `Authorization: Bearer <token>`. `/health` is public; generated file download links are public capabilities valid for 15 minutes.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENRAILS_TOKEN` | required | Strong random ASCII service token, at least 32 characters |
| `OPENRAILS_BIND` | `127.0.0.1:8787` | Listen address |
| `OPENRAILS_PUBLIC_URL` | `http://127.0.0.1:8787` | Externally reachable URL used in signed file links |
| `OPENRAILS_DB_PATH` | `.openrails/backend.sqlite3` | Persistent collections and file metadata |
| `OPENRAILS_FILES_DIR` | `files/` beside the database | File contents, default `.openrails/files/` |
| `OPENRAILS_CONFIG` | unset | Optional JSON configuration file |

Configuration is loaded at startup. KV, files and SQL work without any config. Copy `config.example.json` to `config.json` and set `OPENRAILS_CONFIG=config.json` to add a roster and saved queries. Customize the example's queries for your stored data and remove optional integrations you do not use. LLM, email and HTTP connectors remain optional integrations; none is needed for the server to start. Configured credentials are referenced by environment-variable name, never sent in connector discovery responses, and must exist at startup.

```sh
export OPENRAILS_CONFIG=config.json
```

Optional local model configuration:

```json
{"llm":{"base_url":"http://127.0.0.1:11434/v1","model":"your-installed-model","provider":"local"}}
```

Model capabilities determine whether tools and JSON schema output work. Optional authenticated providers use `api_key_env`; email config uses `from` and a Resend-compatible `url`, and HTTP connectors use `base_url`, `allowed_methods` and optionally `bearer_token_env`.

## SDK coverage

| SDK API | Behavior |
| --- | --- |
| `db.collection()` | Persistent JSON get/put/delete, prefix, filters, order, count and pagination |
| `db.scoped()` / `db.scopedRole()` | Read-only scoped views; empty until scoped data is imported into SQLite |
| `files` | Disk-backed binary put/get/delete/list, streamed downloads and HMAC-signed single/batch URLs |
| `appUsers()` | Configured roster; SDK receives `id` from the backend's `uuid` field |
| `llm`, `llmProviders()` | Optional OpenAI-compatible completions, JSON output, tools, SDK-side tool loops and NDJSON responses |
| `email.send()` | Optional Resend-compatible HTTP API; returns `accepted`, not a delivery guarantee |
| `data.runSQL()`, `data('default')` | Read-only queries on the primary server's own SQLite database |
| `query()`, `savedQueries()` | Configured SQL queries with required typed parameters in declared order |
| `connector().fetch()`, discovery/docs | Optional HTTP connectors with pinned origin, method allowlist and server-side bearer credentials |
| `agents`, connector tools/MCP | Not implemented; execution returns a JSON `501` error, HTTP connector `tools()` returns `[]` |

OpenRails is the server of record, not a proxy to a hosted platform. `dataConnectors()` always reports its local SQLite `default` connection; there are no cloud SQL exports. The server does not yet deploy JavaScript apps, run cron, provide OAuth or issue user invocation JWTs. Standalone SDK context has `ctx.user = null`, trigger `http`, invocation ID `local`, and `secrets` reads the client app's environment. The configured roster does not authenticate its members.

### Limits and semantics

- One process and one token serve one trusted app. Use separate instances, databases and file directories for separate apps. Possession of the token grants full access to that instance's data and configured services. Do not expose it to browsers or untrusted users. User authorization belongs in your app.
- Requests/files are limited to 16 MiB, upstream responses to 4 MiB. Connector bodies are truncated with `truncated: true`; other oversized upstream responses fail. Uploads are buffered up to the 16 MiB limit; downloads stream directly from disk. SQLite stores file names, content types, sizes, timestamps and generated storage keys, not new file contents. Logical file names never become filesystem paths.
- Collection names are single path segments. Keys/file names may contain `/`, spaces and Unicode. Avoid `.` and `..` path segments because the SDK's URL builder normalizes those segments. Names are at most 1024 bytes, without control characters.
- Pages are 1-based; default size is 100, maximum 1000. Filters operate on value fields, with dotted nested fields supported. `in` requires an array. Missing fields compare as `null`. Sorting supports value fields plus `key` and `updated_at`; equal values are ordered by key.
- `updatedSince` is inclusive, `updatedBefore` is exclusive. Both accept RFC3339 timestamps with offsets. Filters and sorting scan one collection in memory. Move these to indexed SQL when collections outgrow this approach.
- LLM NDJSON is wire-compatible but currently buffers one upstream completion before emitting `text` and `done`. It is not token-by-token streaming. Cost is `null`; usage comes from the provider. Add SSE translation when interactive token latency matters.
- SQL reads the same `kv` and `files` tables used by the other APIs. For example: `SELECT key, json_extract(value, '$.title') AS title FROM kv WHERE scope = '' AND collection = 'tasks'`. SQLite SQL accepts `$1`, `$2`, etc. Only single read-only row queries are permitted. Writes, pragmas, attach and extension loading are denied by SQLite's authorizer. Query execution has a 5-second budget, 1000-row cap and 4 MiB data limit, reported through `truncated`. Blob columns are hex strings; objects/arrays bind as JSON text. Saved queries use the same constraints.
- HTTP connector paths start with `/` and resolve relative to the configured origin, not a base path prefix. Redirects are never followed; upstream cookies, auth, location and private headers are not forwarded. Returned bodies are the upstream service's data.
- Scoped rows use `kv.scope = 'user:<id>'` or `'role:<uuid>'`; normal rows use an empty scope. Import trusted scoped data offline. There is no scoped write API.

## Container

```sh
docker build -t openrails-backend .
docker run --name openrails-backend -p 127.0.0.1:8787:8787 \
  -e OPENRAILS_TOKEN -e OPENRAILS_PUBLIC_URL=http://localhost:8787 \
  -v openrails-data:/data openrails-backend
```

The container runs as UID/GID 10001. Bind-mounted data directories must be writable by that UID. Mount optional config files read-only and provide their paths and credential environment variables. The image build is provided but not required to run the binary.

For public hosting, put the server behind a TLS reverse proxy, set `OPENRAILS_BIND=0.0.0.0:8787` as needed and `OPENRAILS_PUBLIC_URL=https://your-host`. Keep the internal port firewalled. No browser CORS is enabled because this token is for trusted server-side SDK clients. Configure request timeouts and rate limits at the proxy.

Protect the data directory and environment files with restrictive filesystem permissions. Data is stored unencrypted. For a consistent backup, stop the server and copy the entire data directory, including SQLite/WAL files and `files/`. If `OPENRAILS_FILES_DIR` points elsewhere, back up that directory too. Token rotation invalidates existing signed file URLs. SIGINT/SIGTERM shuts down gracefully.

Existing database-stored files are exported automatically at startup; their original database copies are retained for recovery. New uploads store only metadata in SQLite. Replacement uploads use new immutable files, so ongoing downloads retain their original bytes. Unreferenced versions and interrupted uploads are retained, not automatically garbage-collected; clean them offline only after taking a backup. `files.delete()` removes the active metadata and disk object.

## Checks

```sh
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
bun install --frozen-lockfile
bun run test:sdk
cargo build --locked && node tests/sdk.mjs
```

The SDK smoke check requires Node 20+. It starts a real backend and local mock integrations, exercises the built TypeScript package via its workspace import, and makes no external service calls. Tests retain isolated databases under the OS temporary directory for inspection.
