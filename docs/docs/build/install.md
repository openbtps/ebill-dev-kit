---
title: Complete the install
---

# Complete the install

Installing is OAuth 2.0's authorization code flow. An owner or admin approves your app in eBillAddress; eBillAddress sends their
browser to one of your `[auth] redirect_urls` with `?code=...&state=...`; your server trades the code for tokens.

```ts
import { exchangeCode } from "@ebilladdress/app-sdk";

const tokens = await exchangeCode({ code, redirectUri: "https://your-host/auth/callback", clientId, clientSecret });
// { accessToken, refreshToken, tokenType, expiresIn, expiresAt, installationId, scopes }
```

- `redirectUri` must be the address the browser came back to, exactly as listed in `ebill.app.toml`.
- A code works once, for ten minutes.
- Keep the tokens by `installationId`, encrypted.

## Refreshing

An access token lasts an hour. Get a new one with the refresh token, and keep the new refresh token if the answer has one:

```ts
import { refreshToken } from "@ebilladdress/app-sdk";

const fresh = await refreshToken({ refreshToken: tokens.refreshToken, clientId, clientSecret });
```

`EbillClient` takes a function for `accessToken`, so you can refresh in one place.

## Starting the install from your app

To connect a signed-in user of your app to their eBillAddress organisation, send their browser to:

```text
https://app.ebilladdress.com/marketplace/apps/<handle>/install?state=<value>
```

eBillAddress hands `state` back unchanged with the code. It must be 1 to 500 printable ASCII characters.

- Make `state` a random value you keep in that user's session, and refuse a callback whose `state` you didn't give to this browser.
- Link the organisation to the user your session says is signed in, **never** to a user named by `state`. Otherwise someone could
  start an install from their own account and send the link to an organisation's owner, joining that organisation to their account.
- When the install began in eBillAddress instead, from the Marketplace, eBillAddress makes up its own `state`. Sign the person in to
  your app first, then link the organisation to them.

## A paid app

A paid app must be bought before it can be installed. See [Paid apps](./paid-apps.md).
