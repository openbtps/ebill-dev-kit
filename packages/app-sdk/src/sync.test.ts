import assert from "node:assert/strict";
import { constants, createCipheriv, generateKeyPairSync, publicEncrypt, randomBytes } from "node:crypto";
import { test } from "node:test";
import { SyncedDocumentError, openSyncedDocument, type SealedDocument } from "./sync.ts";
import { syncKeyBits, syncKeyProblem } from "./sync-key.ts";
import { SyncBlockedError, SyncCancelledError, openSyncWindow, syncWindowUrl, type SyncHost, type SyncMessageEvent, type SyncPopup } from "./sync-window.ts";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const PRIVATE = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

/** Sealed as eBill's sync window seals a bill: RSA-OAEP (SHA-256) around an AES-256-GCM key. */
function seal(content: unknown, publicKey = PUBLIC): SealedDocument {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const sealed = Buffer.concat([cipher.update(JSON.stringify(content), "utf8"), cipher.final()]);
  return {
    document: sealed.toString("base64"),
    encryption: {
      algorithm: "aes-256-gcm",
      type: "standardEncrypt",
      encryptedKey: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key).toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
    },
  };
}

const BILL = { id: "d1", receivedAt: "2026-10-24T00:00:00.000Z", fromAddress: "biller$acme.test", toAddress: "me$mine.test", document: { total: 1 } };

test("a shared bill opens with the sync key's private half, and only with it", () => {
  assert.deepEqual(openSyncedDocument(PRIVATE, seal(BILL)), BILL);
  assert.deepEqual(openSyncedDocument(pair.privateKey, seal(BILL)), BILL);
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  assert.throws(() => openSyncedDocument(other, seal(BILL)), SyncedDocumentError);
  const tampered = seal(BILL);
  tampered.document = Buffer.from("x".repeat(40)).toString("base64");
  assert.throws(() => openSyncedDocument(PRIVATE, tampered), SyncedDocumentError);
  assert.throws(() => openSyncedDocument(PRIVATE, seal({ not: "a bill" })), SyncedDocumentError);
});

test("the sync key: an RSA public key of 2048 to 4096 bits, its exponent 65537", () => {
  assert.equal(syncKeyBits(PUBLIC), 2048);
  assert.equal(syncKeyProblem(PUBLIC), undefined);
  const weak = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 3 }).publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.equal(syncKeyBits(weak), undefined);
  assert.match(syncKeyProblem(generateKeyPairSync("rsa", { modulusLength: 1024 }).publicKey.export({ type: "spki", format: "pem" }).toString()) ?? "", /1024/);
});

/** A page with eBill's window open in it: what openSyncWindow opened, and the messages it listens to. */
function page(opens = true): { host: SyncHost; popup: SyncPopup; send: (event: SyncMessageEvent) => void; opened: string[] } {
  const popup: SyncPopup = { closed: false };
  const listeners = new Set<(event: SyncMessageEvent) => void>();
  const opened: string[] = [];
  const host: SyncHost = {
    open: (url) => {
      opened.push(url);
      return opens ? popup : null;
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  const send = (event: SyncMessageEvent): void => {
    for (const listener of listeners) listener(event);
  };
  return { host, popup, opened, send };
}

test("the window's address says what is asked, at eBill's own address", () => {
  assert.equal(
    syncWindowUrl({ app: "acme-books", kinds: ["invoice", "receipt"], from: "2026-10-01", min: "300", currency: "AUD", state: "s1" }),
    "https://ebilladdress.com/marketplace/sync?app=acme-books&from=2026-10-01&kinds=invoice%2Creceipt&min=300&currency=AUD&state=s1",
  );
});

test("only eBill's window, at eBill's origin, is listened to; the shared bills come back", async () => {
  const { host, popup, send, opened } = page();
  const result = openSyncWindow({ app: "acme-books", state: "s1" }, host);
  assert.equal(opened.length, 1);
  const documents = [{ id: "d1", sealed: seal(BILL) }];
  const message = { type: "ebill.sync", version: 1, state: "s1", documents };
  send({ origin: "https://evil.example", source: popup, data: { ...message, documents: [] } });
  send({ origin: "https://ebilladdress.com", source: {}, data: { ...message, documents: [] } });
  send({ origin: "https://ebilladdress.com", source: popup, data: message });
  assert.deepEqual(await result, { state: "s1", documents });
});

test("cancelled, closed, or blocked: the promise says so", async () => {
  const cancelled = page();
  const asked = openSyncWindow({ app: "acme-books" }, cancelled.host);
  cancelled.send({ origin: "https://ebilladdress.com", source: cancelled.popup, data: { type: "ebill.sync.cancelled", version: 1, state: null } });
  await assert.rejects(asked, SyncCancelledError);

  const closed = page();
  const left = openSyncWindow({ app: "acme-books" }, closed.host);
  closed.popup.closed = true;
  await assert.rejects(left, SyncCancelledError);

  await assert.rejects(openSyncWindow({ app: "acme-books" }, page(false).host), SyncBlockedError);
});
