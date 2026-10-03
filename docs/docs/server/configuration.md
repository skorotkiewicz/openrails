---
title: Example configurations
description: Complete server, project and client configuration templates.
---

# Example configurations

These public templates include every currently supported server JSON field. Example hosts, addresses and `REPLACE_WITH_*` values are placeholders, not discovered settings. Replace them before use. **Never use public placeholder strings as credentials.**

## Download

- [Single-project server JSON](/examples/server.json)
- [Multi-project server JSON](/examples/projects.json)
- [Server environment template](/examples/server.env.example)
- [Client JSON](/examples/client.json)

Save one server JSON template as `config.json`, set `OPENRAILS_CONFIG=config.json`, provide its credential environment variables, and restart the server. Optional integrations can be omitted entirely. Do not merge top-level single-project fields with `projects`.

## Server JSON fields

| Object | Supported fields |
| --- | --- |
| Single-project root / project `config` | `users`, `queries`, `llm`, `email`, `service_connectors` |
| Multi-project root | `projects` |
| Each project | Required `api_key_env`; optional `config` |
| Each user | `uuid`, `name`, `email`, `is_admin` |
| Each saved query | Required `sql`; optional `description`, `params` |
| Each query parameter | `name`, `type`: string, integer, number, boolean, object, array or null |
| `llm` | Required `base_url`, `model`; optional `api_key_env`, `provider` (default `openai`) |
| `email` | Required `api_key_env`, `from`; optional `url` (default `https://api.resend.com/emails`) |
| Each service connector | Required `base_url`; optional `description`, `allowed_methods`, `bearer_token_env`, `content_type`, `api_docs_link`, `usage_instructions` |

Unknown JSON fields fail startup. Credential fields hold environment-variable **names**, not secrets. Referenced credentials must be nonempty at startup. An unauthenticated local model or HTTP service should omit `api_key_env` or `bearer_token_env` respectively.

## Single-project mode

Use the full `server.json` download above. `OPENRAILS_TOKEN` supplies its service key. A minimal server config is simply `{}`; collections, files and SQL work without integrations.

The full example includes a roster, a parameterized query, a local LLM, email and model discovery. Set your actual model ID, verified email sender, service URLs and documentation URL. Read the [LLM](./llm), [email](./email), [saved query](./queries) and [HTTP connector](./service-connectors) guides for usage.

## Multi-project mode

The `projects.json` download embeds the complete server configuration under `projects.app.config`, plus a second isolated project:

```json
{
  "projects": {
    "app": { "api_key_env": "APP_API_KEY", "config": {} },
    "crm": { "api_key_env": "CRM_API_KEY", "config": {} }
  }
}
```

The inline example is minimal; use the download for every optional setting. Keys must be distinct, at least 32 printable ASCII characters without whitespace. Use each existing project's key in its client. `OPENRAILS_TOKEN` is not a master key.

## Environment settings

The downloadable environment template covers every server setting:

| Variable | Default / purpose |
| --- | --- |
| `OPENRAILS_TOKEN` | Required in single-project mode |
| `OPENRAILS_BIND` | `127.0.0.1:8787` |
| `OPENRAILS_PUBLIC_URL` | `http://127.0.0.1:8787`; signed-link origin |
| `OPENRAILS_CONFIG` | Unset; path to server JSON |
| `OPENRAILS_DB_PATH` | `.openrails/backend.sqlite3` |
| `OPENRAILS_FILES_DIR` | `files/` beside the database; single-project only |
| `OPENRAILS_PROJECTS_DIR` | `projects/` beside the database; multi-project only |

In multi-project mode, `OPENRAILS_DB_PATH` determines the default root's parent, not a shared database. Credential names such as `APP_API_KEY` and `LLM_API_KEY` are chosen by your JSON, not fixed server settings. Protect private environment files and do not commit secrets.

## Client configuration

Client options are only `url` and `token`:

```json
{
  "url": "http://127.0.0.1:8787",
  "token": ""
}
```

Fill `token` with the existing project key and call `configure(clientConfig)` on your trusted application server. The empty token intentionally prevents using the public template unchanged. The SDK itself does not load JSON files; your app must read the file. Alternatively, the SDK reads client-process `OPENRAILS_URL` and `OPENRAILS_TOKEN`.

Keep this client JSON private. It does not contain server projects, LLM settings or database paths. In multi-project mode, the SDK client's token selects exactly one project, even when its environment variable is named `OPENRAILS_TOKEN`.
