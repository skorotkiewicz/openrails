---
title: Files
description: Upload, download and share files stored by OpenRails.
---

# Files

File contents live on disk; names, sizes, content types and timestamps live in your project's SQLite database. Logical names do not become physical paths. No extra server configuration is required.

## SDK

After [configuring the client](/sdk/index):

```ts
import { files } from 'openrails';

const metadata = await files.put('notes/hello.txt', 'Hello');
const response = await files.get('notes/hello.txt'); // Response or null
const text = await response?.text();
const { url } = await files.url('notes/hello.txt');
const batch = await files.urls(['notes/hello.txt', 'missing.txt']);
const all = await files.list();
await files.delete('notes/hello.txt');
```

`put()` accepts strings, ArrayBuffers, typed arrays, blobs and readable streams. An optional third argument sets the content type. `get()` returns a native `Response` for reading text, bytes or its stream. Batch URLs return `items` and `missing` names.

## HTTP

Use your project bearer key. Paths are relative to `/fn/data`:

| Method | Path | Body / result |
| --- | --- | --- |
| `GET` | `/files` | `{ "items": [...] }` metadata |
| `PUT` | `/files/blob?name=...` | Raw bytes with `Content-Type`; returns metadata |
| `GET` | `/files/{name}` | File bytes with content type and length |
| `DELETE` | `/files/{name}` | Delete active file and metadata; `204` |
| `POST` | `/files/url` | `{ "name": "..." }`; returns signed URL |
| `POST` | `/files/urls` | `{ "names": [...] }`; returns batch URLs |

URL-encode names. Missing files return `404` for reads and single signed links; deleting a missing file succeeds.

## Limits and safety

- Uploads are buffered and capped at 16 MiB. Downloads stream directly from disk. URL batches accept at most 1000 names.
- Signed links expire after 15 minutes and require no bearer key. Treat them as secrets; changing their project ID invalidates the signature. Rotating the project key invalidates existing links.
- Names may include `/`, spaces and Unicode, up to 1024 bytes without control characters; the SDK rejects `.` and `..` segments.
- Replacement uploads use immutable disk objects so ongoing downloads keep their original bytes. Unreferenced versions and interrupted uploads are retained, not automatically garbage-collected.
- Back up a stopped server's database/WAL files and file directory together. `OPENRAILS_FILES_DIR` overrides single-project storage; multi-project files live in each project's directory.
