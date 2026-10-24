# App contract, v0

How an app on the eBillAddress Marketplace talks to eBill, and what eBill sends back. The SDK and CLI in this repository follow this document. It is
version 0: details may still change before the Marketplace opens, and changes will be listed here.

## Base URL

`https://api.ebilladdress.com`. Both packages let you point at another base URL for testing.

## Installing an app: OAuth 2.0 authorization code

1. The user approves your app in eBill.
2. eBill redirects the browser to one of your `redirect_urls` with `?code=...&state=...`.
3. Your server swaps the code for tokens:

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=...&redirect_uri=...&client_id=...&client_secret=...
```

`redirect_uri` must be the URL the user came back to, exactly as listed in `ebill.app.toml`. A code works once.

### Starting the install from your app, and `state`

To connect a signed-in user of your app to their eBill organisation, send their browser to
`https://app.ebilladdress.com/marketplace/apps/<handle>/install?state=<value>`. eBill hands `state` back unchanged with the code. It must be
1 to 500 printable ASCII characters.

- Make `state` a random value you keep in that user's session (a cookie, for example), and check it matches when the browser comes back.
  Refuse a callback whose `state` you didn't give to this browser.
- Link the eBill organisation to the user your session says is signed in, never to a user named by `state`. Otherwise someone could start
  an install from their own account and send the link to an organisation's owner, joining that organisation to their account.
- When the install began in eBill instead (from the Marketplace), eBill makes up its own random `state`. Your app has no session for it:
  sign the person in to your app first, then link the organisation to them.

4. eBill answers:

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "installation_id": "...",
  "scopes": ["documents:read"]
}
```

Store the tokens per `installation_id`, encrypted.

To get a new access token:

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=...&client_id=...&client_secret=...
```

The answer has the same shape. If it carries a new refresh token, store it in place of the old one.

## Calling the API

Every call sends `Authorization: Bearer <access_token>`. Request and response bodies are JSON.

| Call                            | Answer                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /v1/installation`          | `{ id, organisation: { id, name }, app: { handle, version }, scopes: string[], installedAt }` |
| `GET /v1/installation/settings` | `{ values: Record<string, unknown>, updatedAt }`, keyed by the setting keys you declared      |

Drafts, sending, documents and the rest of `/v1/` will be described by an OpenAPI document. Until then, the SDK's generic `request` reaches any
`/v1/` path.

Times are ISO 8601 strings.

### Idempotency

Send an `Idempotency-Key` header on any call that creates or changes something. Repeating the call with the same key does the work once.

### Errors

A non-2xx answer has a JSON body:

```json
{ "error": "invalid_request", "message": "to is required", "reference": "..." }
```

`error` is a stable machine-readable code; `message` is for people. Quote `reference` when you contact eBill support. A `Retry-After` header (seconds,
or an HTTP date) may come with 429 and 503.

### Retrying

Retry 429, 5xx and network failures, with exponential backoff and jitter, honouring `Retry-After`. Never retry any other 4xx. The SDK retries up to 3
times by default. It retries 5xx and network failures on `POST` and `PATCH` only when the call carries an `Idempotency-Key`, because otherwise a retry
could do the work twice. 429 is always retried: the request was not processed.

### Lists

List endpoints answer `{ data: T[], next: string | null }`. Pass `next` back as `?after=<next>` for the following page. `next: null` is the last
page.

## Webhooks

eBill `POST`s events to your `[webhooks] url`:

```json
{ "id": "...", "topic": "document.delivered", "createdAt": "...", "installationId": "...", "data": {} }
```

Headers:

| Header            | Value                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `Ebill-Event`     | the topic                                                                                         |
| `Ebill-Delivery`  | a UUID, the same on every retry, and equal to the body's `id`. It is not covered by the signature |
| `Ebill-Signature` | `t=<unix seconds>,v1=<hex>`                                                                       |

Skip repeats by the body's `id`, which is signed: remember the ids you have handled. Never by `Ebill-Delivery` alone: within the 300 seconds a
captured delivery could be sent again with a new one.

`v1` is HMAC-SHA256, keyed with your webhook secret, over the exact string `${t}.${rawBody}`, in lowercase hex. While a secret is being rotated the
header carries one `v1` per secret; accept the delivery if any of them matches.

To verify: take the body bytes exactly as received, recompute the HMAC, compare in constant time, and refuse a `t` more than 300 seconds from your
clock. Answer 2xx quickly; do slow work after responding. `verifyWebhook` in the SDK does all of this.

### Topics

| Topic                  | Scope needed              | `data`                                          |
| ---------------------- | ------------------------- | ----------------------------------------------- |
| `document.sent`        | `documents:read`          | `{ documentId, kind, direction, from, to, at }` |
| `document.delivered`   | `documents:read`          | `{ documentId, kind, direction, from, to, at }` |
| `document.failed`      | `documents:read`          | `{ documentId, kind, direction, from, to, at }` |
| `document.received`    | `documents:received:read` | `{ documentId, kind, direction, from, to, at }` |
| `payment.proposed`     | `payments:read`           | `{ documentId, eventId, event, direction, at }` |
| `payment.answered`     | `payments:read`           | `{ documentId, eventId, event, direction, at }` |
| `app.installed`        | none                      | `{}`                                            |
| `app.uninstalled`      | none                      | `{}`                                            |
| `app.settings.updated` | none                      | `{ values }`                                    |

`kind` is the document type, for example `invoice`. `direction` is `outgoing` or `incoming`. `at` is when the thing happened.

Payment events are thin on purpose: what an event says (an amount, an answer's decision) can be sealed, so a webhook says only which event it
was. `event` is `paid`, `partially_paid`, `disputed`, `refund_requested`, `refund` or `response`; `payment.proposed` is a new proposal and
`payment.answered` is an answer to one. Read the payment, with its status and events, at `GET /v1/documents/{documentId}/payment`.

An app hears only the topics listed in `[webhooks] topics`, and only while it holds each one's scope. A delivery that is not answered 2xx is
tried again, with backoff, for about a day. An app whose deliveries have all failed for 24 hours is suspended: its deliveries are dropped until
you re-enable it in the developer portal.

After `app.uninstalled`, you must delete the data you synced for that organisation within 30 days.

## Scopes

Ask for the fewest you need. The user sees these labels when approving the install.

| Scope                     | Label                                            |
| ------------------------- | ------------------------------------------------ |
| `drafts:write`            | Create and change drafts                         |
| `documents:send`          | Send documents in your name                      |
| `documents:read`          | See documents you send and what happened to them |
| `documents:received:read` | See documents you receive                        |
| `files:read`              | Download the files on your documents             |
| `contacts:read`           | See your contacts                                |
| `payments:read`           | See payments on your invoices                    |
| `payments:write`          | Record payments and answer them in your name     |

## App files

`ebill app init` writes both files with comments; `ebill app validate` checks them.

### `ebill.app.toml`

| Key                                | Rule                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `[app] client_id`                  | `app_` and 24 lowercase letters or digits, issued at registration                                         |
| `[app] handle`                     | `^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$`                                                                       |
| `[app] kind`                       | `integration` or `template`                                                                               |
| `[app] version`                    | `x.y.z`, no leading zeros, no pre-release part                                                            |
| `[auth] redirect_urls`             | 1 to 5 https URLs, no `#fragment`, no repeats                                                             |
| `[access] scopes`                  | known scopes only, no repeats                                                                             |
| `[webhooks]` (optional)            | `api_version` (`2026-12`), `url` (https), `topics` (known, no repeats, each with its scope in `[access]`) |
| `[[settings.sections]]` (optional) | `title` (1 to 60 characters) and `fields`                                                                 |
| `[sync]` (optional)                | `browser`, true or false. Browser sync is not documented yet; keep it false.                              |
| `[pricing] model`                  | `free` or `one_time`                                                                                      |

Each settings field has `key` (`^[a-z][a-z0-9_]{0,39}$`, unique across all sections), `type`, `label` (1 to 60 characters), and optionally `help`
(up to 200), `required` and `default`. Types: `text`, `number` (may have `min` and `max`), `boolean`, `select` (needs `options`, a list of
`{ value, label }`), `date` (default written as `"YYYY-MM-DD"`), `email`, `url` (https). A `default` must be valid for its own field.

Unknown keys are refused, so a typo does not pass silently.

### `listing.toml`

| Key                                              | Rule                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `name`                                           | 1 to 40 characters                                                             |
| `tagline`                                        | 1 to 80 characters                                                             |
| `category`                                       | billing, accounting, payments, documents, productivity, communication or other |
| `keywords` (optional)                            | up to 10, each 1 to 30 characters                                              |
| `description`                                    | 1 to 4000 characters of markdown, no HTML, no images                           |
| `release_notes` (optional)                       | up to 2000 characters                                                          |
| `icon_url`, `cover_url`                          | https                                                                          |
| `screenshot_urls` (optional)                     | up to 8, https                                                                 |
| `support_url`, `privacy_policy_url`, `terms_url` | https                                                                          |
| `developer_name`                                 | 1 to 80 characters                                                             |

### What the CLI cannot check

Whether links open, whether images can be fetched, and image sizes need the network. eBill checks them when you deploy; `ebill app validate` says
it skipped them.

## Developer API

What the CLI calls to sign in and to ship an app. It acts for an organisation, not for an installation. Refusals have the same
`{ error, message, reference }` body as the rest of the API.

### Signing in: OAuth 2.0 device authorization (RFC 8628)

```http
POST /developer/device/code
```

```json
{
  "device_code": "ebdc_...",
  "user_code": "BCDF-GHJK",
  "verification_uri": "https://app.ebilladdress.com/developer/device",
  "verification_uri_complete": "https://app.ebilladdress.com/developer/device?code=BCDF-GHJK",
  "expires_in": 600,
  "interval": 5
}
```

The person opens the page, signed in to eBill, and approves or refuses the code. Only the organisation's owners and admins may. Meanwhile, poll
every `interval` seconds:

```http
POST /developer/device/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=ebdc_...&label=...
```

`label` (optional, up to 80 characters) names the token in eBill's list of developer tokens. Until approved, the answer is 400 with `error`:

- `authorization_pending`: keep polling.
- `slow_down`: add 5 seconds to the interval.
- `access_denied`: the code was refused.
- `expired_token`: the code expired; start again.

Once approved:

```json
{ "access_token": "ebdt_...", "token_type": "Bearer", "expires_in": 7776000 }
```

A device code is traded for a token once. The token lasts 90 days and can be revoked in eBill. It acts only while the person who approved it is
still an owner or admin of the organisation: after that it is refused with 403 `forbidden`.

### Shipping an app

Each call sends `Authorization: Bearer ebdt_...`. A missing, expired or revoked token is 401 `unauthorized`.

| Call                                      | Body                    | Answer                                                                     |
| ----------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| `GET /developer/v1/apps`                  |                         | `{ data: [{ id, handle, kind, clientId, delistedAt, versions }] }`         |
| `POST /developer/v1/apps/:id/versions`    | `{ manifest, listing }` | `{ state: "rejected" \| "review_pending", failures, version? }`            |
| `POST /developer/v1/versions/:id/release` | `{}`                    | `{ version, moved, waiting }`                                              |
| `POST /developer/v1/apps/:id/dev`         | `{ manifest, listing }` | `{ state: "rejected" \| "dev", failures, version, sandbox, installation }` |

- **versions:** each is `{ id, appId, version, state, submittedAt, reviewNote }`, newest first. `state` is one of `review_pending`,
  `changes_requested`, `approved`, `released`, `superseded`, `retired`, or `dev` (the app's one dev version, in the sandbox only).
- **dev:** the files go through every check but the version going up, as the app's one dev version (replaced each time, its number
  free), installed in the organisation's sandbox in place of the one before. `installation.redirectUrl` is the app's redirect URL with a
  `code` the app's server trades at `/oauth/token`, for tokens that act in the sandbox alone. Without a sandbox it is 409 `no_sandbox`.
- **push:** `manifest` and `listing` are `ebill.app.toml` and `listing.toml` parsed to JSON. eBill runs the same checks as the CLI, plus the
  ones that need the network, and a version must be higher than the app's last. `failures` has the `{ check, path, reason }` shape that
  `ebill app validate --json` prints. A rejected push stores nothing.
- **release:** works on an `approved` version, or on a `superseded` one to roll back. Any other state is refused with 409 `not_releasable`.
  `moved` counts the installations now on the version. `waiting` counts those left where they are because the version asks for scopes their
  organisation has not granted.

## CLI exit codes

| Code | Meaning                                              |
| ---- | ---------------------------------------------------- |
| 0    | done                                                 |
| 1    | something to fix, or a mistake in the command        |
| 2    | the command needs something eBill does not offer yet |
