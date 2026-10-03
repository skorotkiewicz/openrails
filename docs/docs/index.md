# OpenRails

A self-hosted Rust API server with SQLite storage and a server-side TypeScript SDK. Collections and file metadata live in SQLite; uploaded contents live on disk.

- [API server](./server): startup, project keys, configuration and endpoints.
- [TypeScript SDK](./sdk): collections, files, SQL and integrations.

LLM, email and HTTP connectors are optional. No external database or object storage is required.

Project keys grant full project access. Keep them on trusted application servers, never in browser bundles. User authentication and permissions belong in your application.
