---
title: Your first app
---

# Your first app

You'll build an integration that hears when an invoice arrives, reads it through the API, and says hello to it. It runs in your
**sandbox**: a second organisation eBillAddress makes for you, which reaches no real address. In a sandbox, the invoices that
arrive are samples you add yourself. The finished code is
[`examples/hello-invoice`](https://github.com/openbtps/ebill-dev-kit/tree/main/examples/hello-invoice).

You need Node.js 22.18 or later, an eBillAddress organisation you are an owner or admin of, and a way to give your computer an https
address that eBillAddress can reach, such as a
[Cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to `localhost:3000`.

## 1. Install the CLI and sign in

```bash
npm install --global @ebilladdress/cli
ebill login
```

`ebill login` prints a link and a code. Open the link where you're signed in to eBillAddress, check the code matches, and approve it.

## 2. Make your sandbox and register the app

In eBillAddress, open **Developer**:

1. **Make a sandbox.** Its people are your organisation's owners and admins.
2. **Register an app**, as an integration, with a handle such as `hello-invoice`. You are shown its client id, client secret and
   webhook secret, once. Keep the two secrets somewhere safe.

## 3. Write the app

```bash
ebill app init hello-invoice
cd hello-invoice
npm install @ebilladdress/app-sdk
```

In `ebill.app.toml`, put your client id, your tunnel's address, and the one scope the app needs:

```toml
[auth]
redirect_urls = ["https://<your-tunnel>/auth/callback"]

[access]
scopes = ["documents:received:read"]

[webhooks]
api_version = "2026-12"
url = "https://<your-tunnel>/webhooks"
topics = ["document.received", "app.uninstalled"]
```

Check the files:

```bash
ebill app validate
```

Replace `server.ts` with the example's [`server.ts`](https://github.com/openbtps/ebill-dev-kit/blob/main/examples/hello-invoice/server.ts),
and add its [`hello.ts`](https://github.com/openbtps/ebill-dev-kit/blob/main/examples/hello-invoice/hello.ts). When a
`document.received` webhook arrives, the server reads the document it names:

```ts
export async function helloTo(client: EbillClient, documentId: string): Promise<string> {
  return helloLine(await client.getDocument(documentId));
}
```

## 4. Run it in your sandbox

Start the server with the secrets from step 2:

```bash
export EBILL_CLIENT_ID=app_...
export EBILL_CLIENT_SECRET=...
export EBILL_WEBHOOK_SECRET=...
export EBILL_REDIRECT_URL=https://<your-tunnel>/auth/callback
node server.ts
```

In another terminal:

```bash
ebill app dev
```

`ebill app dev` puts your files through eBillAddress's checks and installs them, as your app's dev version, in your sandbox. It prints
a link: open it, and your server completes the install.

## 5. Receive an invoice

In **Developer**, press **Add a sample invoice**. Your server's log says hello to it:

```text
Hello, invoice SAMPLE-1F3A9C2E from sample-biller$sandbox.invalid for A$165.00 (a sample).
```

A sample is marked `sample: true` in the API, and nobody sent it. A sandbox can't send: it has no address of its own.

## What next

- Keep tokens in a database, and start the install from your own app: [Complete the install](../build/install.md).
- Handle the rest of the webhooks: [Webhooks](../build/webhooks.md).
- Ship it: [Versions and review](../concepts/versions-and-review.md).
