---
title: Scopes and consent
---

# Scopes and consent

A scope is one thing your app may do. You list the scopes you need in `[access] scopes`; the owner or admin installing your app sees
each one's label, in eBillAddress's own words, and approves them all or doesn't install.

Ask for the fewest you need. eBillAddress's review checks that each one is needed for something your listing says the app does.
Every scope, with the words the person is shown, is in the [scopes reference](../reference/generated/webhook-topics.md#scopes).

`documents:received:sync` is never listed in `[access]`: it comes with browser sync, from `[sync]`.

## Asking for more later

A new version that asks for a scope an installation has not granted does not take it. That installation stays on its version until
an owner or admin agrees to what is new. Until then, your app keeps exactly what it had.

## Documents an app cannot open

Some eBillAddress addresses keep their own key: eBillAddress cannot open their documents, so it cannot give them to your app through
the API either. The API says so (`ownKey: true`) and gives no content. The person can share them with your app themselves, through
browser sync.
