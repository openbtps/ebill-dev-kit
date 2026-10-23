# eBillAddress developer kit

Tools for building apps and templates for the eBillAddress Marketplace.

| Package                                     | What it is                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`@ebilladdress/cli`](packages/cli)         | The `ebill` command: create an app, check its files, and (soon) deploy and release it |
| [`@ebilladdress/app-sdk`](packages/app-sdk) | A small library for your app's server: install flow, API calls, webhook verification  |

[CONTRACT.md](CONTRACT.md) describes everything between an app and eBill: the install flow, the API, webhooks, scopes and the two app files.

Status: version 0.1, an early preview. The packages are not on npm yet. Commands that need the eBill developer API (`login`, `dev`, `deploy`,
`versions`, `release`, `rollback`, `status`) say so and exit with code 2 until that API is available.

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

## Licence

[MIT](LICENSE). The licence covers this code only: it grants no right to the eBillAddress name or marks, and using the
eBill API is under its own terms.
