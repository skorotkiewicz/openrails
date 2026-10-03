---
title: LLM
description: Configure an OpenAI-compatible model provider and generate responses.
---

# LLM

Optional model generation uses an OpenAI-compatible `/chat/completions` endpoint. It is separate from [HTTP connectors](./service-connectors).

## Configure the server

Example for a local model server. Replace the URL and model placeholder with your actual endpoint and model ID:

```json
{
  "llm": {
    "base_url": "http://127.0.0.1:8888/v1",
    "model": "REPLACE_WITH_YOUR_MODEL_ID",
    "provider": "local"
  }
}
```

Put `llm` inside the project's `config` in multi-project mode. Load the file with `OPENRAILS_CONFIG` and restart. For an authenticated provider, add `api_key_env` naming a nonempty server environment variable. `provider` is an identifier, not a separate endpoint; it defaults to `openai`.

## SDK

After [configuring the client](/sdk):

```ts
import { llm, llmProviders } from '@openrails/sdk';

const configured = await llmProviders();
const result = await llm.generate('Say hello in one sentence.', {
  maxOutputTokens: 128,
});
console.log(result.text);

for await (const event of llm.stream('Say hello.')) {
  if (event.type === 'text') console.log(event.text);
}
```

Input may be a string or a message array with `system`, `user` and `assistant` roles. Options include `system`, `model`, `provider`, `maxOutputTokens`, `metadata` and an abort `signal`. Model overrides use the same configured endpoint; provider must match the configured identifier.

The result includes `text`, `output`, `toolCalls`, token `usage`, `provider`, `model`, `finishReason` and `requestId`. Cost is currently `null`.

## JSON and tools

For structured output, pass `output: { type: 'json', schema }` to `generate()` with a JSON Schema object and read `result.output`. Model support is required; malformed JSON returns an error.

Tool definitions use `name`, `description` and optional `schema`. Without `run`, generation returns tool calls for your application to handle. With `run` on every tool, the SDK executes a bounded loop in your application process. Use `limits` to bound steps, calls and runtime. Do not mix tools with and without `run`.

`streamRaw()` returns the raw NDJSON `Response` and cannot execute tool handlers. For JSON output, use `generate()` or a tool loop, not plain `stream()`.

## HTTP and limits

Use the project bearer key. `GET /fn/data/llm/providers` lists the configured provider/model, not every model loaded upstream. Without configuration it returns `[]`; generation returns `501`.

`POST /fn/data/llm/generate` accepts `input` or `messages` plus generation options. `POST /fn/data/llm/stream` accepts the same body and returns NDJSON. HTTP tool definitions do not execute application code.

Streams currently buffer each upstream completion, not individual tokens. Responses are capped at 4 MiB. Message arrays accept 1–256 messages; `maxOutputTokens` accepts 1–131072, subject to provider limits. JSON and tool-call support depends on the model. Handle request failures as `ApiError` and SDK tool-loop failures as `LlmRunError`.
