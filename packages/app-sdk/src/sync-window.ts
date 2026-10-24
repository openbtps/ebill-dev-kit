// Browser sync, in your page: open eBill's sync window, so a person whose eBill address keeps its own key can share
// their bills with your app. Import it from "@ebilladdress/app-sdk/browser".
//
// The window is eBill's page, at eBill's address, as signing in with Google is Google's. There the person sees what
// you asked for, gives their key to eBill's page (never to yours), sees the bills it found, and chooses to share them.
// Their browser seals each to your manifest's `[sync] public_key` and hands the sealed bills back to your page. Send
// them to your server as they are, and open them there with openSyncedDocument.
//
// Your app must declare `[sync] browser = true` with its public key, and be installed with browser sync. eBill hands
// the bills only to the origin of your manifest's redirect URL, so open the window from a page on that origin.
//
// Rule (eBill's review): ask for a person's eBill key only through this window. An app that asks for it any other way,
// on its own pages or anywhere else, is rejected.

import type { SealedDocument } from "./sync.ts";

export const DEFAULT_EBILL_ORIGIN = "https://ebilladdress.com";
export const SYNC_WINDOW_PATH = "/marketplace/sync";
export type SyncKind = "invoice" | "receipt" | "letter" | "payslip";

export interface SyncWindowOptions {
  /** Your app's handle: its Marketplace address. */
  app: string;
  /** Received on or after this day (YYYY-MM-DD). By default 30 days before `to`. */
  from?: string;
  /** Received on or before this day (YYYY-MM-DD). By default today. A year at most from `from`. */
  to?: string;
  /** Which kinds of bill. By default every kind. */
  kinds?: readonly SyncKind[];
  /** Amounts in `currency`, which they then need: "300" or "300.50". */
  min?: string;
  max?: string;
  /** ISO 4217, e.g. "AUD". Alone: only bills in it. */
  currency?: string;
  /** Your own value, handed back with the result as it was given: up to 200 printable characters. Use it to match the answer to the request. */
  state?: string;
  /** eBill's origin; for a local or test eBill only. */
  ebillOrigin?: string;
}

export interface SyncResult {
  state: string | null;
  /** The bills the person chose to share, sealed to your key: send them to your server and open them there. */
  documents: { id: string; sealed: SealedDocument }[];
}

/** The person closed the window or chose Cancel: nothing was shared. */
export class SyncCancelledError extends Error {
  constructor() {
    super("The person closed eBill's sync window without sharing.");
    this.name = "SyncCancelledError";
  }
}

/** The window could not be opened: a popup blocker, most often. Open it from a click. */
export class SyncBlockedError extends Error {
  constructor() {
    super("eBill's sync window could not be opened. Open it from a click, and allow pop-ups for this site.");
    this.name = "SyncBlockedError";
  }
}

/** What this needs of the page: the parts of `window` it uses. */
export interface SyncHost {
  open(url: string, target: string, features: string): SyncPopup | null;
  addEventListener(type: "message", listener: (event: SyncMessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: SyncMessageEvent) => void): void;
}

export interface SyncPopup {
  closed: boolean;
}

export interface SyncMessageEvent {
  origin: string;
  source: unknown;
  data: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The window's address for `options`. */
export function syncWindowUrl(options: SyncWindowOptions): string {
  const url = new URL(SYNC_WINDOW_PATH, options.ebillOrigin ?? DEFAULT_EBILL_ORIGIN);
  url.searchParams.set("app", options.app);
  if (options.from !== undefined) url.searchParams.set("from", options.from);
  if (options.to !== undefined) url.searchParams.set("to", options.to);
  if (options.kinds !== undefined) url.searchParams.set("kinds", options.kinds.join(","));
  if (options.min !== undefined) url.searchParams.set("min", options.min);
  if (options.max !== undefined) url.searchParams.set("max", options.max);
  if (options.currency !== undefined) url.searchParams.set("currency", options.currency);
  if (options.state !== undefined) url.searchParams.set("state", options.state);
  return url.toString();
}

function resultOf(data: unknown): SyncResult | "cancelled" | undefined {
  if (!isRecord(data) || data.version !== 1) return undefined;
  const state = typeof data.state === "string" ? data.state : null;
  if (data.type === "ebill.sync.cancelled") return "cancelled";
  if (data.type !== "ebill.sync" || !Array.isArray(data.documents)) return undefined;
  const documents = (data.documents as unknown[]).filter(
    (one): one is { id: string; sealed: SealedDocument } => isRecord(one) && typeof one.id === "string" && isRecord(one.sealed),
  );
  return { state, documents };
}

/**
 * Opens eBill's sync window and waits for the person: resolves with the bills they shared, sealed to your key; rejects
 * with SyncCancelledError when they close it or cancel, and SyncBlockedError when it could not be opened. Call it from
 * a click, or the browser blocks the window.
 *
 * @example
 * button.onclick = async () => {
 *   const { documents } = await openSyncWindow({ app: "acme-books", kinds: ["invoice"], from: "2026-10-01" });
 *   await fetch("/ebill/synced", { method: "POST", body: JSON.stringify(documents) });
 * };
 */
export function openSyncWindow(options: SyncWindowOptions, host: SyncHost = globalThis as unknown as SyncHost): Promise<SyncResult> {
  const origin = new URL(options.ebillOrigin ?? DEFAULT_EBILL_ORIGIN).origin;
  const popup = host.open(syncWindowUrl(options), "ebill-sync", "popup,width=520,height=720");
  if (!popup) return Promise.reject(new SyncBlockedError());
  return new Promise((resolve, reject) => {
    const done = (): void => {
      host.removeEventListener("message", listen);
      clearInterval(watch);
    };
    const listen = (event: SyncMessageEvent): void => {
      // Only eBill's window, at eBill's origin, is listened to.
      if (event.origin !== origin || event.source !== popup) return;
      const result = resultOf(event.data);
      if (result === undefined) return;
      done();
      if (result === "cancelled") reject(new SyncCancelledError());
      else resolve(result);
    };
    const watch = setInterval(() => {
      if (!popup.closed) return;
      done();
      reject(new SyncCancelledError());
    }, 500);
    host.addEventListener("message", listen);
  });
}
