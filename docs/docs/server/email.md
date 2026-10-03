---
title: Email
description: Send email through a configured Resend-compatible provider.
---

# Email

Email is optional and uses a Resend-compatible HTTP API. It does not run an SMTP server or guarantee final delivery.

## Configure the server

Example using Resend. Replace `from` with your verified sender:

```json
{
  "email": {
    "api_key_env": "RESEND_API_KEY",
    "from": "OpenRails <notifications@example.com>"
  }
}
```

Set `RESEND_API_KEY` on the server, load the file with `OPENRAILS_CONFIG` and restart. In multi-project mode, put `email` inside the project's `config`. Optional `url` defaults to `https://api.resend.com/emails`; use a compatible endpoint if overriding it. Sender and provider credentials are chosen by server config.

## SDK

After [configuring the client](/sdk/index), call this only when you intend to send real email:

```ts
import { email } from '@openrails/sdk';

const result = await email.send({
  to: process.env.EMAIL_TO!,
  subject: 'OpenRails notification',
  text: 'Hello from OpenRails.',
});
console.log(result.id, result.status); // accepted, not confirmed delivery
```

Set `EMAIL_TO` to the actual recipient. `to`, `cc` and `bcc` accept a string or an array. Optional fields: `html`, `text`, `cc`, `bcc`, `replyTo`. Supply `to`, a nonempty `subject`, and at least one of `text` or `html`; clients cannot override the sender.

## HTTP

Send `POST /fn/data/email/send` with the project bearer key, `Content-Type: application/json`, and the same fields as the SDK example.

Success returns `{ "id": "...", "status": "accepted", "requestId": "..." }`. Invalid input returns `400`; without an email provider the route returns `501`. SDK failures throw `ApiError`.

## Safety

Credentials stay on the server. Each recipient array accepts 1–100 entries. Subject, recipients and reply-to cannot contain line breaks. Restrict who can trigger email in your application and observe the provider's sender-verification and sending limits.
