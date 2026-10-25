---
title: Webhooks
---

# Webhooks

eBillAddress `POST`s each event your app listens for to `[webhooks] url`, signed with your webhook secret:

```json
{ "id": "...", "topic": "document.delivered", "createdAt": "...", "installationId": "...", "data": {} }
```

An app hears only the topics in `[webhooks] topics`, and only while it holds each one's scope. The topics, their scopes and their
`data` are in the [webhook topics reference](../reference/generated/webhook-topics.md).

## Verify every delivery

Pass the body exactly as it arrived, before parsing it:

```ts check
import { WEBHOOK_HEADERS, WebhookVerificationError, verifyWebhook } from "@ebilladdress/app-sdk";

try {
  const event = verifyWebhook({
    rawBody,
    signatureHeader: req.headers[WEBHOOK_HEADERS.signature],
    deliveryHeader: req.headers[WEBHOOK_HEADERS.delivery],
    secret: process.env.EBILL_WEBHOOK_SECRET ?? "",
  });
  if (event.topic === "document.received") console.log(event.data.documentId);
} catch (error) {
  if (error instanceof WebhookVerificationError) {
    // answer 400
  }
  throw error;
}
```

`Ebill-Signature` is `t=<unix seconds>,v1=<hex>`: HMAC-SHA256 with your secret over `${t}.${rawBody}`. `verifyWebhook` compares in
constant time and refuses a `t` more than 300 seconds from your clock.

## Answer quickly, once

- **Answer 2xx at once, then do the work.** A slow answer is a failed delivery.
- **Skip repeats by the body's `id`**, which is signed. eBillAddress retries a delivery with the same `id`. Never skip by the
  `Ebill-Delivery` header alone, which is not signed.

## When deliveries fail

A delivery not answered 2xx is tried again, with backoff, for about a day. When all of an app's deliveries have failed for 24 hours,
its webhooks are suspended and deliveries are dropped, until you re-enable them in the developer portal.

## After `app.uninstalled`

Delete what you kept for that organisation within 30 days.
