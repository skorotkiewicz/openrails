---
title: SQL
description: Read your project's own SQLite database using parameterized SQL.
---

# SQL

SQL reads the same SQLite database used by collections and file metadata. There are no external SQL provider connections. No extra server configuration is needed.

## SDK

After [configuring the client](/sdk):

```ts
import { data, dataConnectors } from '@openrails/sdk';

const rows = await data.runSQL(
  "SELECT key, json_extract(value, '$.title') AS title FROM kv WHERE scope = '' AND collection = $1",
  ['tasks'],
);
console.log(rows[0], rows.columns, rows.rowcount, rows.truncated);

const databases = await dataConnectors(); // SQLite connection named default
const sameDatabase = await data('default').runSQL('SELECT 42 AS answer');
```

The result is an array of row objects with `columns`, `rowcount` and `truncated` metadata. Bind values through the parameter array; do not interpolate user input into SQL.

## Tables

| Table | Columns |
| --- | --- |
| `kv` | `scope`, `collection`, `key`, JSON-text `value`, `updated_at` |
| `files` | `name`, `content_type`, `storage_key`, `size`, `updated_at` |

Normal collections use `scope = ''`. Imported scopes use `user:<id>` or `role:<id>`. File bytes are stored on disk, not in the active `files` table.

## HTTP

Send `POST /fn/data/sql` with your project bearer key and `Content-Type: application/json`:

```json
{
  "query": "SELECT key FROM kv WHERE scope = '' AND collection = $1",
  "params": ["tasks"],
  "connection": "default"
}
```

The response contains `columns`, positional `rows`, `rowcount` and `truncated`. `connection` defaults to `default`; optional `engine` must be `sqlite`. `GET /fn/data/connections` discovers the connection.

## Limits

Only single read-only row queries are allowed. Writes, pragmas, database attachment and extension loading are denied. Queries have a 5-second budget, 1000-row cap and 4 MiB data limit. Check `truncated` before assuming results are complete.

Objects and arrays bind as JSON text; returned binary columns are hexadecimal strings. Use [saved queries](./queries) to configure reusable SQL and call it with `query(name, params)`.
