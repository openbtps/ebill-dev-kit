// hello-invoice: the finished code of the "first app" tutorial. Install it in your sandbox, add a sample invoice in the
// developer portal, and watch this server read it when it arrives. Run with: node server.ts (Node 22.18 or later).
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
import { helloTo } from "./hello.ts";

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

// In memory, so the example runs as it is. A real app keeps tokens in a database, encrypted, by installation, and
// refreshes them (refreshToken) before they expire.
const installations = new Map<string, TokenSet>();
// eBill retries a delivery with the same event id, which is signed: remember the ids you have handled, in a real app in
// a database with a unique constraint, so a retry is not processed twice.
const handledEvents = new Set<string>();

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end(body);
}

async function handleCallback(url: URL, res: ServerResponse): Promise<void> {
  // eBill also sends `state`. If your app started the install itself, check it matches the value you kept in this
  // browser's session (CONTRACT.md, "Starting the install from your app").
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
    installations.set(tokens.installationId, tokens);
    const installation = await new EbillClient({ accessToken: tokens.accessToken, baseUrl: config.baseUrl }).getInstallation();
    send(res, 200, `Installed for ${installation.organisation.name}. Add a sample invoice in the developer portal, then watch this server's log.`);
  } catch (error) {
    const reference = error instanceof EbillApiError && error.reference ? ` Reference: ${error.reference}` : "";
    console.error("Install failed", error);
    send(res, 502, `Install could not be completed.${reference}`);
  }
}

async function onEvent(event: WebhookEvent): Promise<void> {
  if (event.topic === "app.uninstalled") {
    // Delete what you kept for this organisation within 30 days.
    installations.delete(event.installationId);
    return;
  }
  if (event.topic !== "document.received") return;
  const tokens = installations.get(event.installationId);
  if (!tokens) {
    console.log(`An invoice arrived for an installation this server has no tokens for: ${event.installationId}`);
    return;
  }
  const client = new EbillClient({ accessToken: tokens.accessToken, baseUrl: config.baseUrl });
  console.log(await helloTo(client, event.data.documentId));
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
  // Answer at once; do the work after. A slow answer is a failed delivery, and eBill tries again.
  send(res, 200, "OK");
  if (handledEvents.has(event.id)) return;
  handledEvents.add(event.id);
  onEvent(event).catch((error: unknown) => {
    console.error(`Handling ${event.topic} ${event.id} failed`, error);
  });
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/auth/callback") await handleCallback(url, res);
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
