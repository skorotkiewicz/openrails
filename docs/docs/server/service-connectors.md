---
title: Service connectors
description: Configure named HTTP integrations and call them through OpenRails.
---

# Service connectors

`service_connectors` defines optional HTTP services your application can call through OpenRails. The server chooses the destination and adds any configured bearer credential; the SDK uses the connector's name.

This is separate from `llm`: connectors make ordinary HTTP requests, while `llm` handles model generation.

## Configure the server

Example for an OpenAI-compatible model server. Replace `base_url` with your service's actual origin:

```json
{
  "service_connectors": {
    "models": {
      "base_url": "http://127.0.0.1:8888",
      "allowed_methods": ["GET"],
      "description": "Model discovery",
      "usage_instructions": "GET /v1/models to list available models."
    }
  }
}
```

In multi-project mode, put `service_connectors` inside the project's `config`. Load the file with `OPENRAILS_CONFIG` and restart the server.

| Field | Purpose |
| --- | --- |
| `base_url` | Required HTTP(S) service URL; requests stay on its origin |
| `allowed_methods` | Uppercase method allowlist; defaults to `["GET"]` |
| `bearer_token_env` | Optional environment-variable name; its nonempty value must exist on the server at startup |
| `content_type` | Request-body type; defaults to `application/json` |
| `description`, `usage_instructions`, `api_docs_link` | Optional documentation; does not restrict requests |

## Call from the SDK

After configuring the SDK with the existing project key:

```ts
import { connector, serviceConnectors, serviceConnectorDocs } from '@openrails/sdk';

const available = await serviceConnectors();
const docs = await serviceConnectorDocs('models');
const response = await connector('models').fetch('/v1/models');
if (!response.ok || response.truncated) throw new Error('Incomplete or failed response');
const models = await response.json();
```

The response exposes `status`, `ok`, `headers`, `truncated`, `text()` and `json()`. It is a buffered SDK response, not a native streaming `Response`. An upstream HTTP error sets `ok: false`; invalid connector requests throw `ApiError`.

For writes, allow the method in server config and pass `{ method: 'POST', body: JSON.stringify(payload) }` to `fetch()`. Request bodies must be strings.

## HTTP API

Use your project's `Authorization: Bearer <project-key>` header. Paths are relative to `/fn/data`:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/service-connectors` | List configured connectors |
| `GET` | `/service-connectors/{name}` | Connector documentation |
| `POST` | `/service-connectors/request` | Send a request |

The POST body contains `connector`, `path`, `method` and an optional string `body`. The response contains `status`, `ok`, filtered `headers`, `truncated` and a string `body`.

## Security and limits

- Paths start with `/` and resolve from the service origin, not a base-path prefix. Other origins and redirects are not followed. There is no per-path allowlist.
- The project key grants access to that project's connectors and allowed methods. Keep it on your application server. Credentials are not included in discovery responses.
- Responses are capped at 4 MiB and may be truncated; check before parsing JSON. Upstream cookies and private headers are not forwarded.
- Unknown connector: `404`. Disallowed method: `405`. Invalid path: `400`. Connection failure: `502`.
- Connector tool execution/MCP is not implemented: `tools()` returns `[]` for configured HTTP connectors and `call()` returns `501`.
