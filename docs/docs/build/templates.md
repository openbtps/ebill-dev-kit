---
title: Templates
---

# Templates

A template app is three files: `ebill.app.toml` with `kind = "template"`, `listing.toml`, and `template.json`, the layout.

```bash
ebill app init my-template --template
ebill app validate
```

The finished example is [`examples/harbour-template`](https://github.com/openbtps/ebill-dev-kit/tree/main/examples/harbour-template).

A template is never installed and asks for nothing, but its `ebill.app.toml` still has the sections every app has: `[auth]` with a
redirect URL nothing is sent to, and `[access]` with `scopes = []`.

## `template.json`

```json
{
  "format": 1,
  "kinds": ["invoice", "receipt"],
  "page": { "font": "geist", "size": "normal", "density": "comfortable", "background": "#ffffff", "text": "#102a43", "muted": "#486581", "accent": "#1f5f8b" },
  "logo": { "position": "top-right", "size": "medium" },
  "sections": ["header", "parties", "details", "lines", "totals", "payment", "notes", "terms", "footer"],
  "labels": { "title": "Tax invoice", "to": "Billed to", "amountDue": "Total due" },
  "lines": { "style": "plain", "header": "plain" },
  "totals": { "style": "boxed" },
  "text": { "terms": "Payment within fourteen days of the invoice date.", "footer": "Thank you." }
}
```

| Key                                          | Rule                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `kinds`                                      | `invoice` and or `receipt`                                                   |
| `page.font`                                  | `geist`, `source-serif-4`, `atkinson-hyperlegible-next` or `geist-mono`      |
| `page.size`, `page.density`                  | `small`, `normal` or `large`; `compact` or `comfortable`                     |
| `page.background`, `text`, `muted`, `accent` | `#rrggbb`; text and muted contrast at least 4.5:1, the accent at least 3:1   |
| `logo.position`, `logo.size`                 | `top-left`, `top-center`, `top-right` or `none`; `small`, `medium`, `large`  |
| `sections`                                   | their order, each once; all but `terms` and `footer` required                |
| `labels`                                     | your words for eBillAddress's labels, 1 to 40 characters of plain text       |
| `lines.style`, `lines.header`                | `plain`, `striped` or `boxed`; `plain` or `accent`                           |
| `totals.style`                               | `plain`, `boxed` or `accent`                                                 |
| `text.terms`, `text.footer`                  | plain text, up to 2000 and 300 characters; required when `sections` has them |

The logo is always the sender's own. A template is at most 16 KB, and unknown keys are refused.

## What a template's words may not say

Your labels and text are printed on every document drawn with your template, so they may never say where to pay or whom to contact:
no number of four or more digits, no web, email or BTPS address, and no hidden or direction-changing characters. Payment details are
always the sender's own.

## How it travels

A document drawn with your template carries a reference to it, by name, version and fingerprint, from eBillAddress's registry.
A receiving provider fetches it once, when the document arrives, checks the fingerprint, and draws with it. If anything fails, the
document is shown in the standard view: what was signed is never in doubt.
