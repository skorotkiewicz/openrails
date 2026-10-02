# OpenRails SDK demo

A small browser workbench using `@openrails/sdk` on a Node HTTP server. Plain HTML, CSS and JavaScript, no runtime dependencies beyond the SDK. Node 20+ and an already-running OpenRails server are required. The demo listens only on `127.0.0.1:3000`; it is not a production app or a user-login system.

## Client configuration

The demo is a client of your OpenRails server. The Node app reads **`config.json`** at startup and passes its URL and existing project key to the SDK. This file contains no server projects, LLM configuration or database settings, and is never served to the browser.

Run these commands inside this directory:

```sh
bun install
cp -n config.example.json config.json
chmod 600 config.json
```

This directory includes its own `package.json` and a bundled `@openrails/sdk` npm archive. Installation does not require parent directories, server sources, or an SDK build. `npm install` also works.

Edit the client file, using your actual server URL and the exact project key already registered on that server:

```json
{
  "url": "http://127.0.0.1:8787",
  "token": "YOUR_EXISTING_DEMO_PROJECT_KEY"
}
```

Then run `bun run demo` and open **http://127.0.0.1:3000**. `npm run demo` works too. No client key generation or extra backend is needed. `config.json` is Git-ignored; the committed `config.example.json` contains only public defaults. Keep the private file out of backups or artifacts shared with others, and restart the demo after changing it.

`DEMO_CONFIG` can select another client JSON path. `OPENRAILS_URL` and `DEMO_API_KEY` remain optional overrides for `url` and `token`; unset them if you want the file's values used. `OPENRAILS_TOKEN` is not used by the demo. `DEMO_PORT` changes the local web port. The runtime panel redacts the configured token and separately shows whether the environment variable is present.

## Local model

The LLM controls use your project's configured model through OpenRails. Use `llmProviders()` to inspect the actual provider and model, or leave the model override blank to use the project's default. The client does not configure or assume an LLM endpoint or model filesystem path.

Generation, message arrays, JSON output, NDJSON, raw streams, tool definitions, executable tool loops and streamed tool steps have separate buttons. The arithmetic tool is bounded and does not access secrets or files. JSON/tool support depends on the model; failures are displayed rather than hidden. The backend currently buffers each upstream completion before emitting NDJSON. Stop cancels the demo's LLM request; it does not promise your inference server stops work already in progress.

## Coverage and safety

- Collection CRUD, list, every filter operator, prefix, ordering, time bounds, pages, first and count. The explicit seed button replaces only sample-a/b/c in `demo_tasks`.
- File text/stream/byte uploads, bounded previews, streamed downloads, list, single/batch signed URLs and deletion. Uploads are capped at 16 MiB. Delete buttons require confirmation. There is no automatic cleanup.
- Local SQL with parameters and metadata, the `default` database handle, saved-query discovery/execution and database discovery.
- Static project roster, user/role read-only scopes, standalone context and redacted environment-access examples. Scope results are empty until scoped rows are imported offline.
- HTTP connector discovery/docs, text/JSON responses, tools and reserved calls. Agents and MCP execution return the backend's actual `501` errors.
- `ApiError`, `LlmRunError`, `errorFrame()` and `toNdjson()`, including a generator-error example.
- Email sending requires an enabled email integration on the connected project; otherwise it returns `501`. Only the confirmed Send button can send mail; the demo never sends automatically.

The app validates local Host/Origin headers and accepts JSON-only action requests. Results render as text, not HTML. It has no user authentication, so do not expose its port or reverse-proxy it publicly. Project keys grant full project access; the demo is for a trusted local developer.

## Check

```sh
bun run check
```

This checks the client JavaScript without starting a server. `npm run check` works too.
