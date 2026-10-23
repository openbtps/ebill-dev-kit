# {{name}}

An app for the eBillAddress Marketplace, created with `ebill app init`.

## Files

- `ebill.app.toml`: how the app installs: client id, redirect URLs, scopes, webhooks, settings, pricing.
- `listing.toml`: the app's Marketplace page.
- `server.ts`: a starter server that completes the install and receives webhooks.

Check both TOML files at any time:

```sh
ebill app validate
```

## Run the starter server

You need Node.js 22.18 or later.

```sh
npm init -y
npm pkg set type=module
npm install @ebilladdress/app-sdk
EBILL_CLIENT_ID=app_... \
EBILL_CLIENT_SECRET=... \
EBILL_WEBHOOK_SECRET=... \
EBILL_REDIRECT_URL=https://your-host/auth/callback \
node server.ts
```

`EBILL_REDIRECT_URL` must be one of the `redirect_urls` in `ebill.app.toml`, and `[webhooks] url` must point at `/webhooks` on the same server. Both
must be reachable over https, so put the server behind a tunnel or a host with TLS while you develop.

## What the server does

- `GET /auth/callback`: eBill sends the user here after they approve the install. The server swaps the `code` for tokens with `exchangeCode` and
  keeps them per installation.
- `POST /webhooks`: eBill posts events here. The server checks the signature with `verifyWebhook`, ignores deliveries it has already handled
  (`Ebill-Delivery` header), and answers 200.

Before going live, replace the in-memory maps with a database, store tokens encrypted, and delete an organisation's synced data within 30 days of
`app.uninstalled`.

## More

The full contract between apps and eBill: https://github.com/openbtps/ebill-dev-kit/blob/main/CONTRACT.md
