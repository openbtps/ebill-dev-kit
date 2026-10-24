# @ebilladdress/app-sdk

A small library for the server side of an eBillAddress Marketplace app: complete the install, call the API, verify webhooks. No runtime
dependencies. Requires Node.js 22.12 or later. An ES module: `import` it, or `require()` it from CommonJS, which Node.js 22.12
and later can do with no build of its own.

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
// Keep the key with the draft: a retried send with the same key is never sent twice.
await ebill.sendDocument(draft.id, { idempotencyKey: `send-${draft.id}` });

for await (const document of ebill.documents("incoming")) {
  console.log(document.id, document.kind);
}
```

| Call                                                      | Route                                     | Scope                                         |
| --------------------------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| `getInstallation()`                                       | `GET /v1/installation`                    | none                                          |
| `getSettings()`                                           | `GET /v1/installation/settings`           | none                                          |
| `listDocuments(direction, { limit, after })`, `documents` | `GET /v1/documents`                       | `documents:read` or `documents:received:read` |
| `getDocument(id)`                                         | `GET /v1/documents/{id}`                  | by its direction                              |
| `downloadFile(id, position)`                              | `GET /v1/documents/{id}/files/{position}` | `files:read`                                  |
| `getPayment(id)`                                          | `GET /v1/documents/{id}/payment`          | `payments:read`                               |
| `createDraft(draft)`                                      | `POST /v1/drafts`                         | `drafts:write`                                |
| `sendDocument(id, { idempotencyKey })`                    | `POST /v1/documents/{id}/send`            | `documents:send`                              |
| `listContacts()`                                          | `GET /v1/contacts`                        | `contacts:read`                               |

The types (`Document`, `Payment`, `Contact`, `DraftRequest`, and `paths` and `components` for everything) are generated from the API's OpenAPI
document. `request(method, path, options)` calls any other `/v1/...` route.

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
  const event = verifyWebhook({
    rawBody,
    signatureHeader: req.headers[WEBHOOK_HEADERS.signature],
    deliveryHeader: req.headers[WEBHOOK_HEADERS.delivery],
    secret: process.env.EBILL_WEBHOOK_SECRET ?? "",
  });
  if (event.topic === "document.delivered") {
    console.log(event.data.documentId); // typed by topic
  }
} catch (error) {
  if (error instanceof WebhookVerificationError) {
    // error.reason: malformed_header | timestamp_out_of_tolerance | signature_mismatch | invalid_body | unknown_topic | delivery_mismatch
    // answer 400
  }
  throw error; // a TypeError: the secret is missing or too short, a mistake in your configuration
}
```

- Signatures are compared in constant time. Timestamps more than `toleranceSeconds` (default 300) from now are refused.
- While you rotate your secret, pass both: `secret: [current, next]`. Headers with several `v1` values are accepted if any matches.
- A secret that is missing or shorter than 32 characters throws a `TypeError` rather than verifying anything.
- eBill retries a delivery with the same event `id`. Record the ids you have handled and skip repeats by `event.id`, which is signed, never by
  the `Ebill-Delivery` header alone, which is not. Pass the header as `deliveryHeader` and a delivery whose header is not its `id` is refused.
- `data` is typed per topic but not checked field by field.
- After `app.uninstalled`, delete the data you synced for that organisation within 30 days.

`signWebhook({ rawBody, secret, timestamp })` builds a signature header the way eBill does, for your own tests.

## Browser sync (own-key users)

Some eBill addresses keep their own key: eBill cannot open their bills, so it cannot give them to your app through the API. The person can
share them with you themselves, in eBill's sync window: a small window at eBill's own address that your page opens. There they see what
you asked for and which bills it found, and choose to share them. Their browser seals each bill to your public key and hands them to your
page. eBill never sees the bills or their key, and you never see their key.

1. Make a key pair and declare the public half in `ebill.app.toml`. Keep the private half on your server only.

   ```sh
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out sync-private.pem
   openssl pkey -in sync-private.pem -pubout -out sync-public.pem
   ```

   ```toml
   [sync]
   browser = true
   public_key = """
   -----BEGIN PUBLIC KEY-----
   ...
   -----END PUBLIC KEY-----
   """
   ```

   Installing your app then asks to "Read the bills you choose to share with it from your browser" (`documents:received:sync`).

2. Open the window from a click, on a page at your redirect URL's origin. eBill hands the bills to that origin only.

   ```ts
   import { SyncCancelledError, openSyncWindow } from "@ebilladdress/app-sdk/browser";

   button.onclick = async () => {
     try {
       const { documents } = await openSyncWindow({ app: "acme-books", kinds: ["invoice"], from: "2026-10-01", min: "300", currency: "AUD" });
       await fetch("/ebill/synced", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(documents) });
     } catch (error) {
       if (!(error instanceof SyncCancelledError)) throw error;
     }
   };
   ```

3. Open them on your server.

   ```ts
   import { openSyncedDocument } from "@ebilladdress/app-sdk";

   for (const { sealed } of documents) {
     const bill = openSyncedDocument(process.env.EBILL_SYNC_PRIVATE_KEY, sealed);
     // bill.document: the BTPS document as its sender signed it.
   }
   ```

eBill's window never asks a person for their key: it uses one they already opened in eBill on that device. Never ask a person for their
eBill key yourself, on your pages or anywhere else. eBill's review rejects an app that does.

## Scopes and topics

`SCOPES` maps each scope to the label users see; `TOPICS` maps each webhook topic to the scope it needs. `isScope`, `isTopic` and `requiredScope`
help you check values. See [CONTRACT.md](https://github.com/openbtps/ebill-dev-kit/blob/main/CONTRACT.md) for the full list.

## Licence

[MIT](LICENSE).
