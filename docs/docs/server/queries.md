---
title: Saved queries
description: Configure named SQL queries and call them through the SDK or HTTP API.
---

# Saved queries

`query()` executes a named, read-only SQL query on your project's own SQLite database. `savedQueries()` lists the queries configured for that project.

## Configure the server

Add this to your server configuration. In multi-project mode, put `queries` inside the selected project's `config` object:

```json
{
  "queries": {
    "demo_task": {
      "description": "Read a record from the demo collection",
      "sql": "SELECT key, json_extract(value, '$.title') AS title FROM kv WHERE scope = '' AND collection = 'demo_tasks' AND key = $1",
      "params": [{ "name": "key", "type": "string" }]
    }
  }
}
```

Load the file with `OPENRAILS_CONFIG` and restart the server. This is server configuration, not the client app's `url`/`token` configuration.

## Call from the SDK

After configuring the SDK with your server URL and existing project key:

```ts
import { db, query, savedQueries } from '@openrails/sdk';

await db.collection('demo_tasks').put('first', { title: 'My task' });

const rows = await query('demo_task', { key: 'first' });
console.log(rows[0]); // { key: 'first', title: 'My task' }

const available = await savedQueries();
```

`query()` is a standalone import, not `db.query()`. Results are an array of row objects with `columns`, `rowcount` and `truncated` metadata. No matching record returns an empty array.

## Call over HTTP

Send `POST /fn/data/queries/demo_task` with your project's `Authorization: Bearer <project-key>` header and `Content-Type: application/json`:

```json
{ "params": { "key": "first" } }
```

The response contains `columns`, positional `rows`, `rowcount` and `truncated`. `GET /fn/data/queries` lists configured queries.

## Parameters and limits

- Supply exactly the declared parameter names and types. Declared order maps to `$1`, `$2`, and so on; values are bound, not interpolated into SQL.
- Types: `string`, `integer`, `number`, `boolean`, `object`, `array`, `null`. A query without parameters can be called as `query(name)`.
- Unknown query: `404`. Missing, extra or incorrectly typed parameters: `400`.
- Queries are read-only and project-isolated, with a 5-second budget, 1000-row cap and 4 MiB data limit. Check `truncated` when reading results.
