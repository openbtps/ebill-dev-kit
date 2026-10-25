---
title: Apps and templates
---

# Apps and templates

Every listing in the Marketplace is an **app**, of one of two kinds. Its `[app] kind` in `ebill.app.toml` says which.

## Integrations

An integration connects eBillAddress to something else, and runs on your own server. It:

- is installed by an organisation's owner or admin, who approves exactly the [scopes](./scopes.md) it asks for;
- calls eBillAddress's API with the tokens the install gives it;
- hears what happens through signed [webhooks](../build/webhooks.md);
- may ask the organisation for [settings](../build/settings.md), which eBillAddress draws and keeps.

Accounting products sending their invoices through eBillAddress instead of email, subscriptions that issue an invoice every month,
and receipts sent once a payment arrives are all integrations.

## Templates

A template changes how invoices and receipts look, and nothing else. It is one file, `template.json`: fonts from a fixed list,
colours, the order of the sections, your words for the labels, and static terms and footer text.

- It has no server and asks for no access. eBillAddress draws it on the reader's own device.
- An organisation chooses it in Compose. The document then carries a reference to it, so whoever receives the document sees it as
  it was drawn, on any provider that reads templates.
- It can never change what a document says: no amount, date, sender, receiver or payment details, and no hidden field.

See [Templates](../build/templates.md).

## What no app can do

Nothing you build runs inside eBillAddress. An app never reaches anyone's keys, never signs for anyone, never sees another
organisation's data, and can do only what its scopes allow while it is installed.
