---
title: Call the API
---

# Call the API

Every call sends `Authorization: Bearer <access_token>`, to `https://api.ebilladdress.com`. Bodies are JSON and times are ISO 8601.
The full list of routes is in the [API reference](../reference/index.md).

```ts check
import { EbillClient } from "@ebilladdress/app-sdk";

const ebill = new EbillClient({ accessToken: tokens.accessToken });

const installation = await ebill.getInstallation();

const draft = await ebill.createDraft({
  kind: "invoice",
  fromAddress: "accounts$acme.example",
  toAddress: "customer$ebilladdress.com",
  documentNumber: "INV-1001",
  title: "October",
  issuedAt: new Date().toISOString(),
  currency: "AUD",
  lineItems: [{ description: "Subscription", quantity: "1", unitPriceMinor: 2500, lineTotalMinor: 2500, taxAmountMinor: 0, taxCategory: "none" }],
});
await ebill.sendDocument(draft.id, { idempotencyKey: `send-${draft.id}` });

for await (const document of ebill.documents("incoming")) {
  console.log(document.id, document.kind);
}
```

Amounts are whole minor units (cents), and `fromAddress` must be one of the organisation's own addresses.

## Idempotency

Send an `Idempotency-Key` on any call that creates or changes something. Repeating the call with the same key does the work once.
Sending requires one, so a retried send is never sent twice. Keep the key with what it is for, such as the draft's id.

## Errors

A non-2xx answer has a JSON body, which the SDK throws as `EbillApiError`:

```json
{ "error": "invalid_request", "message": "to is required", "reference": "K7M2-9QXD" }
```

`error` is a stable code; `message` is for people. Quote `reference` to eBillAddress support: it finds that request. A request that got
no answer throws `EbillNetworkError`.

## Retrying

429 is always retried, honouring `Retry-After`: the request was not processed. 5xx and network failures are retried on `GET`, `PUT`
and `DELETE`, and on `POST` or `PATCH` only with an `idempotencyKey`, because otherwise a retry could do the work twice. Other 4xx are
never retried. The SDK retries up to 3 times, with backoff and jitter.

## Lists

List routes answer `{ data, next }`. Pass `next` back as `?after=<next>` for the next page; `next: null` is the last. The SDK's
`documents()` and `paginate()` do this for you.
