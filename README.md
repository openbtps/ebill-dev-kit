# eBillAddress developer kit

Tools for building apps and templates for the eBillAddress Marketplace.

| Package                                     | What it is                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`@ebilladdress/cli`](packages/cli)         | The `ebill` command: create an app, check its files, try it in your sandbox, deploy and release |
| [`@ebilladdress/app-sdk`](packages/app-sdk) | A small library for your app's server: install flow, API calls, webhook verification            |

[CONTRACT.md](CONTRACT.md) describes everything between an app and eBill: the install flow, the API, webhooks, scopes and the two app files.

Two finished examples, checked in CI like the packages:

- [`examples/hello-invoice`](examples/hello-invoice): an integration that hears when an invoice arrives and reads it, end to end in your sandbox.
- [`examples/harbour-template`](examples/harbour-template): a template for invoices and receipts.

Status: version 0.1, an early preview. The packages are not on npm yet.

## Quick start

```sh
npx @ebilladdress/cli app init my-app
cd my-app
npx @ebilladdress/cli app validate
```

`init` writes `ebill.app.toml`, `listing.toml`, a starter `server.ts` and a README for your app.

## Working on this repository

You need Node.js 22.18 or later and pnpm (`corepack enable` gives you the version this repository pins).

```sh
pnpm install
pnpm check      # typecheck, lint, prettier --check, tests
pnpm build
```

Tests use `node:test` and run straight from the TypeScript sources.

The developer documentation (developers.ebilladdress.com) is in [`docs/`](docs). `pnpm --filter @ebilladdress/docs start` serves it locally.
Its reference pages are generated from the code each build, and `pnpm build` fails on a broken link.

## Licence

[MIT](LICENSE). The licence covers this code only: it grants no right to the eBillAddress name or marks, and using the
eBill API is under its own terms.
