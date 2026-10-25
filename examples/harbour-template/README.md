# harbour-template

An example eBillAddress Marketplace template: a calm, blue layout for invoices and receipts.

A template has no server and asks for no access. Your organisation chooses it in Compose, and the document carries a
reference to it, so whoever receives the document sees it the way you drew it, on any provider that reads templates.
It changes only how a document looks: never an amount, who is paid, or how.

| File               | What it is                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `ebill.app.toml`   | The app: its handle, kind `template`, and version.                                                         |
| `template.json`    | The layout: fonts from a fixed list, colours, which sections come in which order, labels, and static text. |
| `listing.toml`     | Its page in the Marketplace.                                                                               |
| `template.test.ts` | Its checks, as `ebill app validate` makes them.                                                            |

## Try it

Register it in eBillAddress's developer portal (**Developer**) as a template, and put the client id it gives you in
`ebill.app.toml`. Then:

```sh
ebill login
ebill app validate
ebill app dev
```

`ebill app dev` pushes it to your sandbox. Write an invoice there and choose **Harbour** in Compose.

The words in `template.json` may not hold an amount, a bank or card number, a link, or an email address: eBill refuses
any of these at push, so a template can never put payment details in front of a reader.
