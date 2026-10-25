---
title: Changelog and versioning
---

# Changelog and versioning

The SDK and the CLI follow [semantic versioning](https://semver.org). Webhook payloads are versioned apart from them, by
`[webhooks] api_version` in your `ebill.app.toml`: a change that could break your code comes as a new API version, and yours keeps
the payloads it was written for.

| Webhook API version | Notes          |
| ------------------- | -------------- |
| `2026-12`           | The first one. |

## 0.1.0

The first preview of `@ebilladdress/app-sdk` and `@ebilladdress/cli`.
