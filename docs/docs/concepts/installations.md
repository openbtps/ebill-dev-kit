---
title: Organisations and installations
---

# Organisations and installations

eBillAddress is organised in **organisations**. A person may belong to several, with a role in each: owner, admin or member.

An **installation** is one organisation's install of your app. Everything your app does, it does for one installation:

- The install gives you tokens for that installation alone, with an `installation_id`. Keep them by it.
- An access token reaches only that organisation's data, and only what its scopes allow.
- Webhooks name the installation they are for (`installationId`).

Only an organisation's **owners and admins** install, update and remove apps. A member is told to ask one of them.

## Updates

When you release a new version, each installation moves to it if it already granted every scope the new version asks for. An
installation the new version would need more of stays on the version it has, and keeps working, until an owner or admin agrees
to exactly what the new version adds.

## Removal

When an organisation removes your app, its tokens stop working at once, its settings are deleted, and you get `app.uninstalled`.
You must then delete what you kept for that organisation within 30 days.
