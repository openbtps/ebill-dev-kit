# @ebilladdress/app-sdk

A small library for the server side of an eBillAddress Marketplace app: complete the install, call the API, verify webhooks. No runtime
dependencies. Requires Node.js 22.12 or later.

```sh
npm install @ebilladdress/app-sdk
```

## Complete the install

eBill sends the user to your redirect URL with `?code=...&state=...`. Swap the code for tokens:

```ts
import { exchangeCode, refreshToken } from "@ebilladdress/app-sdk";

const tokens = await exchangeCode({ code, redirectUri: "https://your-host/auth/callback", clientId, clientSecret });
// tokens: { accessToken, refreshToken, tokenType, expiresIn, expiresAt, installationId, scopes }

const fresh = await refreshToken({ refreshToken: tokens.refreshToken, clientId, clientSecret });
```

Store tokens per `installationId`, encrypted.

## Call the API

```ts
import { EbillClient } from "@ebilladdress/app-sdk";

const ebill = new EbillClient({ accessToken: tokens.accessToken });

const installation = await ebill.getInstallation();
const { values } = await ebill.getSettings();

const draft = await ebill.request<{ id: string }>("POST", "/v1/drafts", { body: draftBody, idempotencyKey: crypto.randomUUID() });

for await (const document of ebill.paginate<{ id: string }>("/v1/documents", { kind: "invoice" })) {
  console.log(document.id);
}
```

`accessToken` can also be a function returning a current token, so you can refresh it in one place.

Options for `EbillClient`, `exchangeCode` and `refreshToken`: `baseUrl` (default `https://api.ebilladdress.com`), `fetch`, `timeoutMs` (default
30 s per attempt), `userAgent`, and `retry: { maxRetries, baseDelayMs, maxDelayMs, onRetry }`.

### Errors and retries

A non-2xx answer throws `EbillApiError` with `status`, `error`, `message`, `reference` and `retryAfter`. A request that got no answer throws
`EbillNetworkError`.

429 is retried, honouring `Retry-After`. 5xx and network failures are retried on `GET`, `PUT` and `DELETE`, and on `POST` or `PATCH` only when you
pass an `idempotencyKey`. Other 4xx are never retried. Up to 3 retries by default, with exponential backoff and jitter. A `Retry-After` longer than
`maxDelayMs` (default 30 s) is not waited for: the error is thrown with `retryAfter` set.

## Verify webhooks

Pass the body exactly as received, before parsing it:

```ts
import { WEBHOOK_HEADERS, WebhookVerificationError, verifyWebhook } from "@ebilladdress/app-sdk";

try {
  const event = verifyWebhook({ rawBody, signatureHeader: req.headers[WEBHOOK_HEADERS.signature], secret: process.env.EBILL_WEBHOOK_SECRET! });
  if (event.topic === "document.delivered") {
    console.log(event.data.documentId); // typed by topic
  }
} catch (error) {
  if (error instanceof WebhookVerificationError) {
    // error.reason: malformed_header | timestamp_out_of_tolerance | signature_mismatch | invalid_body | unknown_topic
    // answer 400
  }
}
```

- Signatures are compared in constant time. Timestamps more than `toleranceSeconds` (default 300) from now are refused.
- While you rotate your secret, pass both: `secret: [current, next]`. Headers with several `v1` values are accepted if any matches.
- eBill retries a delivery with the same `Ebill-Delivery` header. Record the ids you have handled and skip repeats.
- `data` is typed per topic but not checked field by field.
- After `app.uninstalled`, delete the data you synced for that organisation within 30 days.

`signWebhook({ rawBody, secret, timestamp })` builds a signature header the way eBill does, for your own tests.

## Scopes and topics

`SCOPES` maps each scope to the label users see; `TOPICS` maps each webhook topic to the scope it needs. `isScope`, `isTopic` and `requiredScope`
help you check values. See [CONTRACT.md](https://github.com/openbtps/ebill-dev-kit/blob/main/CONTRACT.md) for the full list.

## Licence

To be announced.
