---
slug: /
title: Build on eBillAddress
sidebar_label: Overview
---

# Build on eBillAddress

eBillAddress delivers invoices, receipts, letters and payslips over BTPS, the open billing protocol, in place of email. The
Marketplace is where organisations add what eBillAddress does not do on its own: connections to other products, and templates
that change how their documents look.

You can build two kinds of app:

- **An integration** runs on your own server and uses eBillAddress's API: it sends documents from another product, reads the
  documents an organisation receives, follows payments, or anything else its scopes allow. An organisation installs it and approves
  exactly what it may do.
- **A template** is a layout for invoices and receipts, in one file. It has no server and asks for no access: eBillAddress draws it
  on the sender's and the receiver's own devices.

Nothing you build runs inside eBillAddress. An app never reaches anyone's keys, never signs for anyone, and never sees another
organisation's data.

## Where to start

- **[Your first app](./get-started/first-app.md)**: an integration that sends an invoice and hears it was delivered, in your sandbox,
  in about 15 minutes.
- **[Concepts](./concepts/apps-and-templates.md)**: what an app, an installation, a scope and a version are.
- **[Build](./build/install.md)**: one task per page.
- **[Reference](./reference/index.md)**: the API, the SDK, webhook topics and the CLI, generated from their own code.

## The tools

| Tool                    | What it is                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `@ebilladdress/cli`     | The `ebill` command: create an app, check it, try it in your sandbox, deploy and release it |
| `@ebilladdress/app-sdk` | A small library for your app's server: the install flow, API calls, webhook verification    |

Both are MIT licensed, in [openbtps/ebill-dev-kit](https://github.com/openbtps/ebill-dev-kit), with two finished examples.
