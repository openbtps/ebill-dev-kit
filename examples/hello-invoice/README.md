# hello-invoice

An example eBillAddress Marketplace app: when your organisation receives an invoice, it hears so by webhook, reads the invoice
through the eBillAddress API, and says hello to it. It is the finished code of the "first app" tutorial, and it runs end to end
in your sandbox, where the invoices that arrive are the samples you add.

| File             | What it is                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `ebill.app.toml` | How it installs and runs: the one scope it asks for, its webhook topics.                      |
| `listing.toml`   | Its page in the Marketplace.                                                                  |
| `hello.ts`       | What it does with the API: read the document a webhook names.                                 |
| `server.ts`      | The install callback and the webhook.                                                         |
| `hello.test.ts`  | Its checks, as `ebill app validate` makes them, and its reading against a stand-in for eBill. |

## Run it in your sandbox

1. In eBillAddress's developer portal (**Developer**, as an owner or admin of your organisation), make your sandbox and register
   the app as an integration. Put the client id it gives you in `ebill.app.toml`. Then sign the CLI in:

   ```sh
   ebill login
   ```

2. Give your computer an https address (a tunnel, such as cloudflared, to `localhost:3000`) and put it in `ebill.app.toml`:
   `[auth] redirect_urls` as `https://<tunnel>/auth/callback`, and `[webhooks] url` as `https://<tunnel>/webhooks`.

3. Start the server, with the secrets the portal showed you once:

   ```sh
   export EBILL_CLIENT_ID=app_...
   export EBILL_CLIENT_SECRET=...
   export EBILL_WEBHOOK_SECRET=...
   export EBILL_REDIRECT_URL=https://<tunnel>/auth/callback
   node server.ts
   ```

4. In another terminal, install it in your sandbox, and open the link it prints:

   ```sh
   ebill app dev
   ```

5. In the developer portal, press **Add a sample invoice**. The server's log says hello to it.

## Before you build on it

- **Tokens are kept in memory.** A real app keeps them in a database, encrypted, by installation, and refreshes them.
- **Handled event ids are kept in memory.** A real app keeps them in a database with a unique constraint.
- **On `app.uninstalled`,** delete what you kept for that organisation within 30 days.
- **A sandbox can't send.** It has no address of its own, so a real send can be tried only from a real organisation.
