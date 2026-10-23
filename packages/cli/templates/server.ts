// A starting point for your app's server: install callback and webhooks, on node:http with no framework.
// Run with: node server.ts (Node 22.18 or later). Configure with the environment variables below.
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

// In memory only so this file runs as is. Use a database: tokens encrypted at rest, keyed by installation.
const tokens = new Map<string, TokenSet>();
// eBill retries a delivery with the same Ebill-Delivery id. Remember the ids you have handled, in a database
// with a unique constraint, so a retry is not processed twice.
const handledDeliveries = new Set<string>();

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
  // eBill also sends `state`. If your app started the install itself, check it matches the value you sent.
  const code = url.searchParams.get("code");
  if (!code) {
    send(res, 400, "Missing code.");
    return;
  }
  try {
    const tokenSet = await exchangeCode({
      code,
      redirectUri: config.redirectUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      baseUrl: config.baseUrl,
    });
    tokens.set(tokenSet.installationId, tokenSet);
    const installation = await new EbillClient({ accessToken: tokenSet.accessToken, baseUrl: config.baseUrl }).getInstallation();
    send(res, 200, `Installed for ${installation.organisation.name}. You can close this page.`);
  } catch (error) {
    const reference = error instanceof EbillApiError && error.reference ? ` Reference: ${error.reference}` : "";
    console.error("Install failed", error);
    send(res, 502, `Install could not be completed.${reference}`);
  }
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rawBody = await readBody(req);
  let event: WebhookEvent;
  try {
    event = verifyWebhook({ rawBody, signatureHeader: req.headers[WEBHOOK_HEADERS.signature], secret: config.webhookSecret });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      send(res, 400, error.reason);
      return;
    }
    throw error;
  }

  const deliveryId = req.headers[WEBHOOK_HEADERS.delivery];
  const delivery = typeof deliveryId === "string" ? deliveryId : event.id;
  if (handledDeliveries.has(delivery)) {
    send(res, 200, "Already handled.");
    return;
  }

  switch (event.topic) {
    case "document.delivered":
      console.log(`Document ${event.data.documentId} (${event.data.kind}) delivered at ${event.data.at}`);
      break;
    case "app.settings.updated":
      console.log("Settings changed", event.data.values);
      break;
    case "app.uninstalled":
      // You must delete the data you synced for this organisation within 30 days.
      tokens.delete(event.installationId);
      break;
    default:
      console.log(`Unhandled topic ${event.topic}`);
  }

  handledDeliveries.add(delivery);
  // Answer quickly. Do slow work in a queue, after responding.
  send(res, 200, "OK");
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/auth/callback") {
    await handleCallback(url, res);
  } else if (req.method === "POST" && url.pathname === "/webhooks") {
    await handleWebhook(req, res);
  } else {
    send(res, 404, "Not found.");
  }
}

const server = createServer((req, res) => {
  route(req, res).catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) send(res, 500, "Something went wrong.");
  });
});

server.listen(config.port, () => {
  console.log(`Listening on http://localhost:${String(config.port)}`);
});
