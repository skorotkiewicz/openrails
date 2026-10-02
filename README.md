# Self-hosted Railcode SDK backend

A single-app Rust HTTP server for the bundled `@railcode/sdk` 0.4.0. The SDK stays unchanged. SQLite stores collection values and file bytes durably, so no database service or object store is required.

## Run

Requires Rust 1.88+ and a C compiler for bundled SQLite.

```sh
export RC_TOKEN="$(openssl rand -hex 32)"
export RC_PUBLIC_URL="http://127.0.0.1:8787"
cargo run --release --locked
```

Point your trusted Node/Bun app at the server, using the **same token**:

```sh
export RC_DEV_TOKEN="$RC_TOKEN"
export RC_DATA_PLANE_URL="http://127.0.0.1:8787"
```

```js
import { db, files } from './@railcode/sdk/dist/index.js';

const tasks = db.collection('tasks');
await tasks.put('first', { title: 'Self-hosted', done: false });
console.log(await tasks.where('done', 'eq', false).page());

await files.put('notes/hello.txt', 'Hello');
console.log(await files.url('notes/hello.txt'));
```

`RC_DATA_PLANE_URL` is the server origin, not `/fn/data`. All SDK requests carry `Authorization: Bearer <token>`. `/health` is public; generated file download links are public capabilities valid for 15 minutes.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `RC_TOKEN` | required | Strong random ASCII service token, at least 32 characters |
| `RC_BIND` | `127.0.0.1:8787` | Listen address |
| `RC_PUBLIC_URL` | `http://127.0.0.1:8787` | Externally reachable URL used in signed file links |
| `RC_DB_PATH` | `.railcode/backend.sqlite3` | Persistent KV/file database |
| `RC_CONFIG` | unset | Optional JSON configuration file |
| `RC_SQLITE_PATH` | unset | Existing external SQLite database for read-only SQL |

Configuration is loaded at startup. Start with no config for KV/files only. Copy `config.example.json` to `config.json`, remove integrations you do not need, and set `RC_CONFIG=config.json` to enable others. Credentials are referenced by environment-variable name, never sent in connector discovery responses. Every configured credential must exist at startup.

```sh
export RC_CONFIG=config.json
export OPENAI_API_KEY='...'
export RESEND_API_KEY='...'
export EXAMPLE_API_TOKEN='...'
export RC_SQLITE_PATH=/absolute/path/to/source.sqlite3
```

For an OpenAI-compatible local model server, set `llm.base_url` to its API root, for example `http://127.0.0.1:11434/v1`, choose a model it has installed, and omit `api_key_env` if it requires no authentication. Model capabilities determine whether tools and JSON schema output work.

## SDK coverage

| SDK API | Behavior |
| --- | --- |
| `db.collection()` | Persistent JSON get/put/delete, prefix, filters, order, count and pagination |
| `db.scoped()` / `db.scopedRole()` | Read-only legacy scope views; empty until data is imported into SQLite |
| `files` | Binary put/get/delete/list and HMAC-signed single/batch download URLs |
| `appUsers()` | Configured roster; SDK receives `id` from the backend's `uuid` field |
| `llm`, `llmProviders()` | Optional OpenAI-compatible completions, JSON output, tools, SDK-side tool loops and NDJSON responses |
| `email.send()` | Optional Resend-compatible HTTP API; returns `accepted`, not a delivery guarantee |
| `data.runSQL()`, `data('default')` | Optional external, read-only SQLite connection |
| `query()`, `savedQueries()` | Configured SQL queries with required typed parameters in declared order |
| `connector().fetch()`, discovery/docs | Optional HTTP connectors with pinned origin, method allowlist and server-side bearer credentials |
| `agents`, connector tools/MCP | Not implemented; execution returns a JSON `501` error, HTTP connector `tools()` returns `[]` |
| `postgres`, `bigquery`, `turso` | Not implemented; use `data` for SQLite, other engines return `501` |

This is a data-plane backend, **not** the Railcode worker deployment platform. It does not deploy JavaScript apps, run cron, provide OAuth or issue user invocation JWTs. `ctx` and `secrets` are SDK-local ambient values. With the static service token, `ctx.user` is `null`, trigger is `http`, invocation ID is `dev`, and `secrets` reads the app's environment. The configured roster does not authenticate its members.

### Limits and semantics

- One process and one token serve one trusted app. Use separate instances and databases for separate apps. Possession of the token grants full access to that instance's data and configured services. Do not expose it to browsers or untrusted users. User authorization belongs in your app.
- Requests/files are limited to 16 MiB, upstream responses to 4 MiB. Connector bodies are truncated with `truncated: true`; other oversized upstream responses fail. Files are buffered in SQLite, not streamed from object storage.
- Collection names are single path segments. Keys/file names may contain `/`, spaces and Unicode. Avoid `.` and `..` path segments because the SDK's URL builder normalizes those segments. Names are at most 1024 bytes, without control characters.
- Pages are 1-based; default size is 100, maximum 1000. Filters operate on value fields, with dotted nested fields supported. `in` requires an array. Missing fields compare as `null`. Sorting supports value fields plus `key` and `updated_at`; equal values are ordered by key.
- `updatedSince` is inclusive, `updatedBefore` is exclusive. Both accept RFC3339 timestamps with offsets. Filters and sorting scan one collection in memory. Move these to indexed SQL when collections outgrow this approach.
- LLM NDJSON is wire-compatible but currently buffers one upstream completion before emitting `text` and `done`. It is not token-by-token streaming. Cost is `null`; usage comes from the provider. Add SSE translation when interactive token latency matters.
- SQLite SQL accepts `$1`, `$2`, etc. Only single read-only row queries are permitted. Writes, pragmas, attach and extension loading are denied by SQLite's authorizer. Query execution has a 5-second budget, 1000-row cap and 4 MiB data limit, reported through `truncated`. Blob columns are hex strings; objects/arrays bind as JSON text. Saved queries use the same constraints.
- HTTP connector paths start with `/` and resolve relative to the configured origin, not a base path prefix. Redirects are never followed; upstream cookies, auth, location and private headers are not forwarded. Returned bodies are the upstream service's data.
- Legacy rows use `kv.scope = 'user:<id>'` or `'role:<uuid>'`; normal rows use an empty scope. Import trusted legacy data offline. There is no scoped write API.

## Container

```sh
docker build -t railcode-backend .
docker run --name railcode-backend -p 127.0.0.1:8787:8787 \
  -e RC_TOKEN -e RC_PUBLIC_URL=http://localhost:8787 \
  -v railcode-data:/data railcode-backend
```

The container runs as UID/GID 10001. Bind-mounted data directories must be writable by that UID. Mount optional config/source database files read-only and provide their paths and credential environment variables. The image build is provided but not required to run the binary.

For public hosting, put the server behind a TLS reverse proxy, set `RC_BIND=0.0.0.0:8787` as needed and `RC_PUBLIC_URL=https://your-host`. Keep the internal port firewalled. No browser CORS is enabled because this token is for trusted server-side SDK clients. Configure request timeouts and rate limits at the proxy.

Protect the data directory and environment files with restrictive filesystem permissions. Data is stored unencrypted. Back up SQLite with its online backup mechanism, or stop the server and copy the whole data directory, including any WAL files. Do not point `RC_SQLITE_PATH` at the internal backend database. Token rotation invalidates existing signed file URLs. SIGINT/SIGTERM shuts down gracefully.

## Checks

```sh
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo build --locked && node tests/sdk.mjs
```

The SDK smoke check requires Node 22.13+ with `node:sqlite`. It starts a real backend and local mock providers, exercises the unchanged SDK, and makes no external service calls. Tests retain isolated databases under the OS temporary directory for inspection.
