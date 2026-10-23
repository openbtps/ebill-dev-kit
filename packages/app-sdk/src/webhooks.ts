import { createHmac, timingSafeEqual } from "node:crypto";
import { isTopic, type Topic } from "./catalog.ts";
import { WebhookVerificationError } from "./errors.ts";

/** Header names, lower-cased as Node's `IncomingMessage.headers` gives them. */
export const WEBHOOK_HEADERS = {
  event: "ebill-event",
  /** The same on every retry of one delivery: use it to ignore repeats. */
  delivery: "ebill-delivery",
  signature: "ebill-signature",
} as const;

export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

/** Webhook payload versions this SDK's types describe. Set one as `[webhooks] api_version` in `ebill.app.toml`. */
export const WEBHOOK_API_VERSIONS = ["2026-12"] as const;

export type WebhookApiVersion = (typeof WEBHOOK_API_VERSIONS)[number];

export interface DocumentEventData {
  documentId: string;
  /** For example `invoice`, `receipt`, `payslip` or `letter`. */
  kind: string;
  /** The receiver's address, on events about documents you send. */
  to?: string;
  /** The sender's address, on events about documents you receive. */
  from?: string;
  /** ISO 8601 time the thing happened. */
  at: string;
}

export interface PaymentEventData {
  documentId: string;
  eventId: string;
  /** In the currency's smallest unit, for example cents. */
  amountMinor: number;
  /** ISO 4217 code, for example `AUD`. */
  currency: string;
  at: string;
}

export interface WebhookEventDataMap {
  "document.sent": DocumentEventData;
  "document.delivered": DocumentEventData;
  "document.failed": DocumentEventData;
  "document.received": DocumentEventData;
  "payment.proposed": PaymentEventData;
  "payment.accepted": PaymentEventData;
  "payment.rejected": PaymentEventData;
  "app.installed": Record<string, never>;
  /** The app must delete the data it synced for this organisation within 30 days. */
  "app.uninstalled": Record<string, never>;
  "app.settings.updated": { values: Record<string, unknown> };
}

export interface WebhookEventOf<T extends Topic> {
  id: string;
  topic: T;
  /** ISO 8601 time. */
  createdAt: string;
  installationId: string;
  data: WebhookEventDataMap[T];
}

/** Narrow on `topic` to get the matching `data` type. */
export type WebhookEvent = { [T in Topic]: WebhookEventOf<T> }[Topic];

export interface VerifyWebhookOptions {
  /** The body exactly as received, before any JSON parsing. */
  rawBody: string | Uint8Array;
  /** The `Ebill-Signature` header. */
  signatureHeader: string | readonly string[] | null | undefined;
  /** Your webhook secret. Pass several while you rotate it. */
  secret: string | readonly string[];
  toleranceSeconds?: number;
  now?: Date;
}

interface ParsedSignature {
  timestamp: number;
  signatures: Buffer[];
}

function parseSignatureHeader(header: VerifyWebhookOptions["signatureHeader"]): ParsedSignature {
  const value = typeof header === "string" ? header : header?.join(",");
  const malformed = (): WebhookVerificationError =>
    new WebhookVerificationError("malformed_header", "Ebill-Signature header is missing or not of the form t=<seconds>,v1=<hex>.");
  if (!value) throw malformed();
  let timestamp: number | undefined;
  const signatures: Buffer[] = [];
  for (const part of value.split(",")) {
    const [key, item, ...rest] = part.trim().split("=");
    if (key === undefined || item === undefined || rest.length > 0) throw malformed();
    if (key === "t") {
      if (timestamp !== undefined || !/^\d{1,12}$/.test(item)) throw malformed();
      timestamp = Number(item);
    } else if (key === "v1") {
      if (!/^[0-9a-f]{64}$/i.test(item)) throw malformed();
      signatures.push(Buffer.from(item, "hex"));
    }
  }
  if (timestamp === undefined || signatures.length === 0) throw malformed();
  return { timestamp, signatures };
}

function hmac(secret: string, timestamp: number, rawBody: string | Uint8Array): Buffer {
  return createHmac("sha256", secret)
    .update(`${String(timestamp)}.`)
    .update(rawBody)
    .digest();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEvent(rawBody: string | Uint8Array): WebhookEvent {
  let body: unknown;
  try {
    body = JSON.parse(typeof rawBody === "string" ? rawBody : new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
  } catch {
    throw new WebhookVerificationError("invalid_body", "Webhook body is not valid JSON.");
  }
  if (
    !isRecord(body) ||
    typeof body.id !== "string" ||
    typeof body.topic !== "string" ||
    typeof body.createdAt !== "string" ||
    typeof body.installationId !== "string" ||
    !isRecord(body.data)
  ) {
    throw new WebhookVerificationError("invalid_body", "Webhook body is missing id, topic, createdAt, installationId or data.");
  }
  if (!isTopic(body.topic)) {
    throw new WebhookVerificationError("unknown_topic", `Unknown webhook topic "${body.topic}". Update @ebilladdress/app-sdk.`);
  }
  return body as unknown as WebhookEvent;
}

/**
 * Check that a webhook came from eBill and is recent, then return its event.
 * Throws `WebhookVerificationError` otherwise. Deduplicate on the `Ebill-Delivery` header: eBill retries with the same id.
 */
export function verifyWebhook(options: VerifyWebhookOptions): WebhookEvent {
  const { timestamp, signatures } = parseSignatureHeader(options.signatureHeader);
  const tolerance = options.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - timestamp) > tolerance) {
    throw new WebhookVerificationError("timestamp_out_of_tolerance", `Webhook timestamp is more than ${String(tolerance)} seconds from now.`);
  }
  const secrets = typeof options.secret === "string" ? [options.secret] : options.secret;
  let matched = false;
  for (const secret of secrets) {
    const expected = hmac(secret, timestamp, options.rawBody);
    for (const signature of signatures) {
      if (timingSafeEqual(expected, signature)) matched = true;
    }
  }
  if (!matched) throw new WebhookVerificationError("signature_mismatch", "Webhook signature does not match.");
  return parseEvent(options.rawBody);
}

export interface SignWebhookOptions {
  rawBody: string | Uint8Array;
  secret: string;
  /** Unix seconds. Defaults to now. */
  timestamp?: number;
}

/** Build an `Ebill-Signature` header value the way eBill does. For your own tests and local tools. */
export function signWebhook(options: SignWebhookOptions): string {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  return `t=${String(timestamp)},v1=${hmac(options.secret, timestamp, options.rawBody).toString("hex")}`;
}
