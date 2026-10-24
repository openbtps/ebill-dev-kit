// Browser sync, on your server: open a bill a person shared with your app in eBill's sync window.
//
// The window (openSyncWindow, from "@ebilladdress/app-sdk/browser") hands your page each shared bill sealed to the key
// your manifest declares (`[sync] public_key`). Send them to your server as they are, and open them there with the
// private half of that key. Only that key opens them: not eBill, not anyone who sees them on the way.
//
// Sealed as BTPS seals a document: a random AES-256 key wrapped with RSA-OAEP (SHA-256), the content under
// AES-256-GCM with a 12-byte IV and a 16-byte tag.
import { constants, createDecipheriv, privateDecrypt, type KeyObject } from "node:crypto";

export interface SealedDocument {
  /** The content, sealed: base64. */
  document: string;
  /** algorithm "aes-256-gcm", type "standardEncrypt": checked as it arrives, since it came through a browser. */
  encryption: { algorithm: string; type: string; encryptedKey: string; iv: string; authTag: string };
}

/** A bill a person shared: who sent it to which of their addresses, when it arrived, and the bill as its sender signed it. */
export interface SyncedDocument {
  id: string;
  receivedAt: string;
  fromAddress: string;
  toAddress: string;
  /** The BTPS document as its sender signed it. */
  document: unknown;
}

/** Thrown when a sealed bill cannot be opened with the key given: another key's, or not one eBill sealed. */
export class SyncedDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncedDocumentError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function bytesOf(value: unknown, length?: number): Buffer {
  if (typeof value !== "string") throw new SyncedDocumentError("not a sealed document");
  const bytes = Buffer.from(value, "base64");
  if (length !== undefined && bytes.length !== length) throw new SyncedDocumentError("not a sealed document");
  return bytes;
}

function syncedOf(value: unknown): SyncedDocument {
  if (!isRecord(value)) throw new SyncedDocumentError("not a shared bill");
  const { id, receivedAt, fromAddress, toAddress, document } = value;
  if (typeof id !== "string" || typeof receivedAt !== "string" || typeof fromAddress !== "string" || typeof toAddress !== "string") {
    throw new SyncedDocumentError("not a shared bill");
  }
  return { id, receivedAt, fromAddress, toAddress, document };
}

/**
 * Opens `sealed` with your sync key's private half (a PEM string or a KeyObject).
 *
 * @example
 * const bill = openSyncedDocument(process.env.EBILL_SYNC_PRIVATE_KEY, sealed);
 */
export function openSyncedDocument(privateKey: string | KeyObject, sealed: SealedDocument): SyncedDocument {
  const { encryption } = sealed;
  if (encryption.algorithm !== "aes-256-gcm" || encryption.type !== "standardEncrypt") throw new SyncedDocumentError("not a sealed document");
  let key: Buffer;
  try {
    key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, bytesOf(encryption.encryptedKey));
  } catch {
    throw new SyncedDocumentError("sealed to another key");
  }
  let plain: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, bytesOf(encryption.iv, 12));
    decipher.setAuthTag(bytesOf(encryption.authTag, 16));
    plain = Buffer.concat([decipher.update(bytesOf(sealed.document)), decipher.final()]).toString("utf8");
  } catch {
    throw new SyncedDocumentError("not a sealed document");
  } finally {
    key.fill(0);
  }
  try {
    return syncedOf(JSON.parse(plain) as unknown);
  } catch (error) {
    if (error instanceof SyncedDocumentError) throw error;
    throw new SyncedDocumentError("not a shared bill");
  }
}
