---
title: KV collections
description: Store JSON records and query them with the SDK or HTTP API.
---

# KV collections

Collections store JSON values by key in your project's SQLite database. No extra server configuration is needed. SDK examples assume [the client is configured](/sdk).

## SDK

```ts
import { db } from '@openrails/sdk';

const tasks = db.collection<{ title: string; done: boolean }>('tasks');
await tasks.put('first', { title: 'Ship it', done: false });
const task = await tasks.get('first'); // Value or null
const records = await tasks.where('done', 'eq', false)
  .orderBy('title').page(1, 20);
const total = await tasks.query().count();
await tasks.delete('first');
```

`put()` replaces the complete value, not a partial update. `list()`, `page()` and `first()` return records with `key`, `value` and `updated_at`; `get()` returns only the value. `first()` returns `null` if nothing matches.

Queries also support `prefix()`, `updatedSince()` and `updatedBefore()`. Filters support dotted fields and `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`; `in` needs an array. Sorting accepts value fields, `key` or `updated_at`.

## HTTP

Use your project bearer key. Paths are relative to `/fn/data`:

| Method | Path | Body / result |
| --- | --- | --- |
| `GET` | `/kv/{collection}` | `{ "items": [...] }` |
| `GET` | `/kv/{collection}/{key}` | Record; `404` if missing |
| `PUT` | `/kv/{collection}/{key}` | Send `{ "value": ... }`; returns record |
| `DELETE` | `/kv/{collection}/{key}` | `204`, including absent keys |

Listing parameters: `page`, `size`, `prefix`, `where`, `order`, `updated_since`, `updated_before`, `count`. URL-encode JSON parameters: `where` is an array of `[field, operator, value]` triples; `order` is `[field, "asc" | "desc"]`. `count=true` returns `{ "count": ... }` instead of items.

## Limits

- Pages are 1-based; default size 100, maximum 1000. Up to 32 filters per query.
- Timestamp bounds accept RFC3339: `updatedSince` is inclusive, `updatedBefore` exclusive.
- Collection names are single path segments. Keys may contain `/`, spaces and Unicode; names are limited to 1024 bytes. The SDK rejects `.` and `..` path segments.
- Filters and sorting scan a collection in memory. Use indexed SQL for large datasets.
- `db.scoped()` and `db.scopedRole()` are read-only imported views, not user authorization. They remain empty until populated offline.
