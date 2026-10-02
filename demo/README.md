# OpenRails SDK demo

A small browser workbench using `@openrails/sdk` on a Node HTTP server. Plain HTML, CSS and JavaScript, no runtime dependencies beyond the SDK. Node 20+ and Rust are required. The demo listens only on `127.0.0.1:3000`; it is not a production app or a user-login system.

## Run from the repository root

Install the workspace dependencies and create a private environment file once. The command refuses to overwrite an existing file:

```sh
bun install
mkdir -p .openrails
(umask 077; set -C; printf 'OPENRAILS_TOKEN=%s\nOPENRAILS_URL=http://127.0.0.1:8788\nOPENRAILS_BIND=127.0.0.1:8788\nOPENRAILS_PUBLIC_URL=http://127.0.0.1:8788\nOPENRAILS_PROJECTS_DIR=.openrails/demo-data\n' "$(openssl rand -hex 32)" > .openrails/demo.env)
```

Terminal 1, start the Rust backend:

```sh
set -a; . ./.openrails/demo.env; set +a
bun run demo:backend
```

Terminal 2, start the demo (builds the npm package first):

```sh
set -a; . ./.openrails/demo.env; set +a
bun run demo
```

Open **http://127.0.0.1:3000**. `npm run demo` and `npm run demo:backend` work too. Change `DEMO_PORT` if port 3000 is occupied. The dedicated backend uses port 8788 and `.openrails/demo-data/demo/`, leaving your usual server and project data untouched.

To use an already-running multi-project server instead, add the `demo` project from `demo/config.json` to its configuration, supply the matching key to that server, and restart it. Set the demo app's `OPENRAILS_URL` and `OPENRAILS_TOKEN` to that server and project key. SDK configuration happens once at Node startup; browser requests never receive the key.

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
