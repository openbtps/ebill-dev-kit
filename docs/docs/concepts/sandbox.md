---
title: Your sandbox
---

# Your sandbox

Your sandbox is a second organisation eBillAddress makes for yours, for trying your apps before anyone reviews them. Its people are
your organisation's owners and admins; anyone who stops being one stops being in it.

## What it can do

- `ebill app dev` installs your app's **dev version** there: checked, never reviewed, replaced each time you run it, and never
  installed anywhere else.
- **Add a sample invoice**, in the developer portal, puts a received invoice there, as if a biller had sent it. Your app hears
  `document.received` and reads it through the API like any other. A sample is marked `sample: true`, and nobody sent it.
- Its tokens act in the sandbox alone.

## What it cannot do

A sandbox reaches no real address. It has no address of its own, so it cannot send, ask for trust, invite people, use a custom
domain or import mail. An app that sends can be tried for real only once it is released and installed in a real organisation.

A dev version's failing webhooks never suspend your released app's.
