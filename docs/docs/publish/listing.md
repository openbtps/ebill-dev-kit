---
title: Your listing
---

# Your listing

`listing.toml` is your app's page in the Marketplace. eBillAddress checks it at every push, and a person reviews it with each
version.

| Key                                              | Rule                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `name`                                           | 1 to 40 characters                                                             |
| `tagline`                                        | 1 to 80 characters                                                             |
| `category`                                       | billing, accounting, payments, documents, productivity, communication or other |
| `keywords` (optional)                            | up to 10, each 1 to 30 characters                                              |
| `description`                                    | 1 to 4000 characters of markdown, no HTML, no images                           |
| `release_notes` (optional)                       | up to 2000 characters                                                          |
| `icon_url`, `cover_url`                          | https: the icon 512 × 512, the cover 1600 × 900                                |
| `screenshot_urls` (optional)                     | up to 8, https, each 640 × 400 to 3840 × 2400                                  |
| `support_url`, `privacy_policy_url`, `terms_url` | https, and each must open                                                      |
| `developer_name`                                 | 1 to 80 characters                                                             |

Images are PNG, JPEG or WebP, up to 5 MB. eBillAddress fetches each once when you deploy, keeps its own copy, and shows only that.

## What review looks for

- **Each permission is needed** for something the description says the app does. Say what each is for.
- **Nothing suggests eBillAddress made, verifies or endorses the app**, in the name, description or screenshots, and nothing imitates a
  trust label such as "Sender verified".
- **The content is appropriate and the category is right.**
- **The privacy policy says** the app deletes an organisation's synced data within 30 days of being removed.
- **The app works**: it is installed in a test organisation, used once, and removed, and its access then stops.

An app that asks anyone for their eBillAddress key, anywhere, is rejected.

Every check a push can fail, with its fix, is in [the automatic checks](../reference/generated/checks.md).
