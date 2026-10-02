# OpenRails SDK demo

A small browser workbench using `@openrails/sdk` on a Node HTTP server. Plain HTML, CSS and JavaScript, no runtime dependencies beyond the SDK. Node 20+ and Rust are required. The demo listens only on `127.0.0.1:3000`; it is not a production app or a user-login system.

## Connect to your server

The demo **does not generate an API key**. Use the existing key configured for the demo project on your OpenRails server. Server administrators provision project keys through environment variables; the server has no HTTP endpoint for retrieving or issuing them.

### 1. Register the project on the server

Copy the `projects.demo` entry from `demo/config.json` into your server's `projects` map, keeping your other projects. It includes the local LLM, saved query and model-discovery connector. Its `api_key_env` is `DEMO_API_KEY`.

Supply that project's existing secret in the **server environment** and restart the server with its configuration:

```sh
export DEMO_API_KEY='YOUR_EXISTING_DEMO_PROJECT_KEY'
OPENRAILS_CONFIG=config.projects.json cargo run --locked
```

Use your actual server config path, and keep the other projects' credential variables available. For a newly provisioned project, the administrator chooses a strong random key once and gives the same key to its trusted application; the client never chooses a different key.

### 2. Start the demo client

From the repository root, in the demo app's terminal:

```sh
bun install
export DEMO_API_KEY='YOUR_EXISTING_DEMO_PROJECT_KEY'
export OPENRAILS_URL='http://127.0.0.1:8787'
bun run demo
```

Use the server's actual URL and the **exact same key value**. The demo calls `configure({ url, token: process.env.DEMO_API_KEY })`; no `OPENRAILS_TOKEN` alias is needed. SDK configuration happens once at Node startup, and browser requests never receive the key. Store the existing secret in your protected environment/service configuration, not a frontend bundle or Git.

Open **http://127.0.0.1:3000**. `npm run demo` works too. Change `DEMO_PORT` if port 3000 is occupied.

### Optional: dedicated local demo backend

To avoid changing your usual server, start the included demo configuration separately. In the backend terminal:

```sh
export DEMO_API_KEY='YOUR_EXISTING_DEMO_PROJECT_KEY'
export OPENRAILS_BIND='127.0.0.1:8788'
export OPENRAILS_PUBLIC_URL='http://127.0.0.1:8788'
export OPENRAILS_PROJECTS_DIR='.openrails/demo-data'
bun run demo:backend
```

Then start the client with the same `DEMO_API_KEY` and `OPENRAILS_URL=http://127.0.0.1:8788`. This uses `.openrails/demo-data/demo/`, leaving your usual server and project data untouched. `npm run demo:backend` works too.

If you used the previous `.openrails/demo.env` setup, keep its existing secret: source that file and run `export DEMO_API_KEY="$OPENRAILS_TOKEN"` in both terminals before restarting the backend and demo. No key rotation or data migration is needed.

## Local model

The included config uses only the local OpenAI-compatible LLM at **http://192.168.0.124:8888/v1**, with the discovered model `/models/gemma4/E2B/gemma-4-E2B-it-Q4_K_M.gguf`. No cloud-model credentials are required. If you load another model, update `demo/config.json` or use the UI model override. The `models` HTTP connector calls `/v1/models` on the same local server.

Generation, message arrays, JSON output, NDJSON, raw streams, tool definitions, executable tool loops and streamed tool steps have separate buttons. The arithmetic tool is bounded and does not access secrets or files. JSON/tool support depends on the model; failures are displayed rather than hidden. The backend currently buffers each upstream completion before emitting NDJSON. Stop cancels the demo's LLM request; it does not promise your inference server stops work already in progress.

## Coverage and safety

- Collection CRUD, list, every filter operator, prefix, ordering, time bounds, pages, first and count. The explicit seed button replaces only sample-a/b/c in `demo_tasks`.
- File text/stream/byte uploads, bounded previews, streamed downloads, list, single/batch signed URLs and deletion. Names use `demo/`; uploads are capped at 16 MiB. Delete buttons require confirmation. There is no automatic cleanup.
- Local SQL with parameters and metadata, the `default` database handle, saved-query discovery/execution and database discovery.
- Static project roster, user/role read-only scopes, standalone context and redacted environment-access examples. Scope results are empty until scoped rows are imported offline.
- HTTP connector discovery/docs, text/JSON responses, tools and reserved calls. Agents and MCP execution return the backend's actual `501` errors.
- `ApiError`, `LlmRunError`, `errorFrame()` and `toNdjson()`, including a generator-error example.
- Email sending is available but **disabled in the included backend configuration**. It returns `501` unless you explicitly add an email config to `projects.demo.config`, using the example in `config.example.json` and its credential environment variable. Only the confirmed Send button can send mail; the demo never sends automatically.

The app validates local Host/Origin headers and accepts JSON-only action requests. Results render as text, not HTML. It has no user authentication, so do not expose its port or reverse-proxy it publicly. Project keys grant full project access; the demo is for a trusted local developer.

## Check

```sh
cargo build --locked
bun run build:sdk
node tests/sdk.mjs --demo
```

This check starts an isolated real backend, the demo and local mock providers. It exercises the SDK actions and HTTP safety guards without contacting your LLM or sending real email. The actual demo configuration can be tried independently against your local LLM.
