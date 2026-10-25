---
title: Settings
---

# Settings

Your app can ask each organisation for settings: payment terms, an account to post to, whether to send receipts. You declare the
fields in `ebill.app.toml`; eBillAddress draws the settings page in its own design, checks what is typed, and keeps the values per
installation. You never build a settings screen, and never ask anyone for a password to another service.

```toml
[[settings.sections]]
title = "Invoicing"
fields = [
  { key = "terms_days", type = "number", label = "Payment terms (days)", default = 14, min = 0, max = 120 },
  { key = "send_receipts", type = "boolean", label = "Send a receipt when an invoice is paid", default = true },
]
```

| Type      | Notes                                         |
| --------- | --------------------------------------------- |
| `text`    |                                               |
| `number`  | may have `min` and `max`                      |
| `boolean` |                                               |
| `select`  | needs `options`, a list of `{ value, label }` |
| `date`    | a default is written `"YYYY-MM-DD"`           |
| `email`   |                                               |
| `url`     | https only                                    |

Each field has a `key` (`^[a-z][a-z0-9_]{0,39}$`, unique across sections), a `type` and a `label` (1 to 60 characters), and may have
`help` (up to 200), `required` and a `default`, which must be valid for its own field.

## Reading them

```ts
const { values, updatedAt } = await ebill.getSettings();
```

`values` is keyed by your field keys. When an owner or admin changes them, you hear `app.settings.updated`, with the new `values`.
