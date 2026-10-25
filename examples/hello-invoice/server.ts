// hello-invoice: the finished code of the "first app" tutorial. Install it in your sandbox, open http://localhost:3000,
// send a hello invoice, and watch its delivery arrive as a webhook. Run with: node server.ts (Node 22.18 or later).
//
// This page has no sign-in of its own: anyone who can reach it can send from the organisation that installed the app.
// Run it on your own machine only. A real app signs its users in and links each to the installation they own.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  EbillApiError,
  EbillClient,
  WEBHOOK_HEADERS,
  WebhookVerificationError,
  exchangeCode,
  verifyWebhook,
  type TokenSet,
  type WebhookEvent,
} from "@ebilladdress/app-sdk";
import { sendHello } from "./hello.ts";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before starting the server.`);
  return value;
}

const config = {
  port: Number(process.env.PORT ?? 3000),
  baseUrl: process.env.EBILL_API_URL ?? "https://api.ebilladdress.com",
  clientId: env("EBILL_CLIENT_ID"),
  clientSecret: env("EBILL_CLIENT_SECRET"),
  webhookSecret: env("EBILL_WEBHOOK_SECRET"),
  // Must be one of the redirect_urls in ebill.app.toml, exactly.
  redirectUrl: env("EBILL_REDIRECT_URL"),
};

// In memory, so the example runs as it is. A real app keeps tokens in a database, encrypted, by installation.
let installed: { tokens: TokenSet; organisation: string } | undefined;
const handledEvents = new Set<string>();
const MAX_FORM_BYTES = 4096;

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);

function readBody(req: IncomingMessage, limit = Number.POSITIVE_INFINITY): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) req.destroy(new Error("Too large."));
      else chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type }).end(body);
}

function page(res: ServerResponse, message = ""): void {
  const body = installed
    ? `<p>Installed for <strong>${escape(installed.organisation)}</strong>.</p>
       <form method="post" action="/hello">
         <p><label>From (one of your addresses) <input name="from" required></label></p>
         <p><label>To <input name="to" required></label></p>
         <p><button>Send a hello invoice</button></p>
       </form>`
    : "<p>Not installed yet. Install the app from your sandbox: <code>ebill app dev</code> prints the link.</p>";
  send(res, 200, `<!doctype html><meta charset="utf-8"><title>hello-invoice</title><h1>hello-invoice</h1>${message}${body}`, "text/html; charset=utf-8");
}

async function handleCallback(url: URL, res: ServerResponse): Promise<void> {
  const code = url.searchParams.get("code");
  if (!code) {
    send(res, 400, "Missing code.");
    return;
  }
  try {
    const tokens = await exchangeCode({
      code,
      redirectUri: config.redirectUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      baseUrl: config.baseUrl,
    });
    const installation = await new EbillClient({ accessToken: tokens.accessToken, baseUrl: config.baseUrl }).getInstallation();
    installed = { tokens, organisation: installation.organisation.name };
    res.writeHead(303, { location: "/" }).end();
  } catch (error) {
    const reference = error instanceof EbillApiError && error.reference ? ` Reference: ${error.reference}` : "";
    console.error("Install failed", error);
    send(res, 502, `Install could not be completed.${reference}`);
  }
}

async function handleHello(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Only this page's own form: another site's page must not send invoices through a browser that has this one open.
  if (req.headers.origin !== `http://localhost:${String(config.port)}`) {
    send(res, 403, "Send from this app's own page.");
    return;
  }
  if (!installed) {
    page(res);
    return;
  }
  const form = new URLSearchParams((await readBody(req, MAX_FORM_BYTES)).toString("utf8"));
  const [from, to] = [form.get("from")?.trim() ?? "", form.get("to")?.trim() ?? ""];
  try {
    const client = new EbillClient({ accessToken: installed.tokens.accessToken, baseUrl: config.baseUrl });
    const sent = await sendHello(client, { from, to });
    page(res, `<p>Sent: <code>${escape(sent.id)}</code>. Its delivery arrives as a webhook: watch this server's log.</p>`);
  } catch (error) {
    const said = error instanceof EbillApiError ? `${error.message}${error.reference ? ` (reference ${error.reference})` : ""}` : "It did not send.";
    page(res, `<p role="alert">${escape(said)}</p>`);
  }
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rawBody = await readBody(req);
  let event: WebhookEvent;
  try {
    event = verifyWebhook({
      rawBody,
      signatureHeader: req.headers[WEBHOOK_HEADERS.signature],
      deliveryHeader: req.headers[WEBHOOK_HEADERS.delivery],
      secret: config.webhookSecret,
    });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      send(res, 400, error.reason);
      return;
    }
    throw error;
  }
  if (!handledEvents.has(event.id)) {
    if (event.topic === "document.delivered") console.log(`Delivered: ${event.data.documentId} (${event.data.kind}) at ${event.data.at}`);
    else if (event.topic === "app.uninstalled") installed = undefined;
    handledEvents.add(event.id);
  }
  send(res, 200, "OK");
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/") page(res);
  else if (req.method === "GET" && url.pathname === "/auth/callback") await handleCallback(url, res);
  else if (req.method === "POST" && url.pathname === "/hello") await handleHello(req, res);
  else if (req.method === "POST" && url.pathname === "/webhooks") await handleWebhook(req, res);
  else send(res, 404, "Not found.");
}

createServer((req, res) => {
  route(req, res).catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) send(res, 500, "Something went wrong.");
  });
}).listen(config.port, () => {
  console.log(`hello-invoice on http://localhost:${String(config.port)}`);
});
