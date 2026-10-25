# hello-invoice

An example eBillAddress Marketplace app: it sends a one-line invoice through the eBillAddress API, and logs when it is
delivered. It is the finished code of the "first app" tutorial.

| File             | What it is                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `ebill.app.toml` | How it installs and runs: the scopes it asks for, its webhook topics.                           |
| `listing.toml`   | Its page in the Marketplace.                                                                    |
| `hello.ts`       | What it does with the API: write the draft, send it.                                            |
| `server.ts`      | The install callback, a page to send from, and the webhook.                                     |
| `hello.test.ts`  | Its checks, as `ebill app validate` makes them, and its API calls against a stand-in for eBill. |

## Run it in your sandbox

1. Register the app in eBillAddress's developer portal (**Developer**, as an owner or admin of your organisation), with
   the handle `hello-invoice` or one of your own. Put the client id it gives you in `ebill.app.toml`. Then sign the CLI
   in:

   ```sh
   ebill login
   ```

2. Start the server, with the secrets the portal showed you once:

   ```sh
   export EBILL_CLIENT_ID=app_...
   export EBILL_CLIENT_SECRET=...
   export EBILL_WEBHOOK_SECRET=...
   export EBILL_REDIRECT_URL=https://localhost:3000/auth/callback
   node server.ts
   ```

3. In another terminal, push it to your sandbox and install it there. Your sandbox has no real addresses, so nothing
   leaves it:

   ```sh
   ebill app dev
   ```

4. Open <http://localhost:3000>, send a hello invoice, and watch the server's log for `Delivered:`.

eBill sends webhooks only to an https address it can reach. While you develop, point `[webhooks] url` at a tunnel to
`localhost:3000`.

## Before you build on it

- **The page has no sign-in.** Anyone who can reach it sends from the organisation that installed the app. A real app
  signs its users in and links each one to the installation it belongs to.
- **Tokens are kept in memory.** A real app keeps them in a database, encrypted, by installation, and refreshes them.
- **On `app.uninstalled`,** delete what you kept for that organisation within 30 days.
