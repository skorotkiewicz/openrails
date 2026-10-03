# API server

## Start

Requires Rust 1.88+ and a C compiler. Run from the OpenRails repository root:

```sh
export OPENRAILS_TOKEN="$(openssl rand -hex 32)"
cargo run --release --locked
```

The server listens on `http://127.0.0.1:8787`. `GET /health` is public. Protected endpoints require `Authorization: Bearer <project-key>`.

## Settings

| Variable | Default / purpose |
| --- | --- |
| `OPENRAILS_TOKEN` | Single-project key: at least 32 printable ASCII characters without whitespace |
| `OPENRAILS_BIND` | `127.0.0.1:8787` |
| `OPENRAILS_PUBLIC_URL` | `http://127.0.0.1:8787`; used for signed download links |
| `OPENRAILS_DB_PATH` | `.openrails/backend.sqlite3` |
| `OPENRAILS_FILES_DIR` | `files/` beside the database; single-project mode |
| `OPENRAILS_CONFIG` | Optional server JSON file |
| `OPENRAILS_PROJECTS_DIR` | `projects/` beside the database; multi-project storage |

## Multiple projects

Each project has its own key, database, files and integrations. Save this as the server's `config.json`:

```json
{
  "projects": {
    "app": { "api_key_env": "APP_API_KEY" }
  }
}
```

```sh
export APP_API_KEY="$(openssl rand -hex 32)"
export OPENRAILS_CONFIG=config.json
cargo run --release --locked
```

Add entries with distinct keys. The bearer key selects the project. `OPENRAILS_TOKEN` is not a master key; only keys referenced by `api_key_env` are accepted in multi-project mode.

Storage defaults to `.openrails/projects/<id>/`. IDs allow 1–64 lowercase ASCII letters, digits, `_` and `-`. Restart after configuration or key changes.

## Optional configuration

These fields belong at the top level in single-project mode, or inside each project's `config`:

| Field | Purpose |
| --- | --- |
| `users` | Static roster, not authentication or permissions |
| `queries` | [Saved read-only SQL queries](./queries) |
| `llm` | OpenAI-compatible endpoint and model |
| `email` | Resend-compatible endpoint and sender |
| `service_connectors` | [Named HTTP services](./service-connectors) with a pinned origin and allowed methods |

Provider credentials use environment-variable names (`api_key_env`, `bearer_token_env`). Server configuration is separate from the client's `url` and `token`.

## HTTP endpoints

Paths below are relative to `/fn/data` and require a project key.

| Method | Path | Action |
| --- | --- | --- |
| `GET` | `/kv/{collection}` | List, filter, order and paginate |
| `GET`, `PUT`, `DELETE` | `/kv/{collection}/{key}` | Record access; PUT body contains `value` |
| `GET` | `/files` | File metadata |
| `PUT` | `/files/blob?name=...` | Upload raw bytes |
| `GET`, `DELETE` | `/files/{name}` | Download or delete |
| `POST` | `/files/url`, `/files/urls` | Signed links; body contains `name` or `names` |
| `POST` | `/sql` | Read-only SQL with `query` and a `params` array |
| `GET` | `/connections`, `/queries`, `/app-users` | SQLite, saved queries and roster discovery |
| `POST` | `/queries/{name}` | Saved query with a `params` object |
| `GET` | `/llm/providers`, `/service-connectors` | Integration discovery |
| `POST` | `/llm/generate`, `/llm/stream`, `/email/send` | Configured LLM or email |
| `POST` | `/service-connectors/request` | HTTP request with `connector`, `path`, `method` and optional string `body` |

Errors return JSON with `detail`. Invalid keys return `401`; unavailable integrations and reserved agent/MCP execution return `501`.

## Limits and deployment

Uploads/requests: 16 MiB. SQL: read-only, 5 seconds, 1000 rows and 4 MiB. Signed download links work without a bearer key and expire after 15 minutes. LLM streams currently buffer each completion.

Use a TLS reverse proxy for public hosting. For consistent backups, stop the server and copy databases/WAL files and every file/project directory, including custom storage locations.
