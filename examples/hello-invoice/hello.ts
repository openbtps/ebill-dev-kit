// What hello-invoice does with eBillAddress's API, kept apart from its server so it can be tested without one: when an
// invoice arrives, read it and say hello to it. In your sandbox, the invoices that arrive are the samples you add in the
// developer portal (each has `sample: true`).
import type { Document, EbillClient } from "@ebilladdress/app-sdk";

/** The amount as a person reads it: A$49.00. Undefined for a document with none (a letter, or one kept with its own key). */
export function amountOf(document: Pick<Document, "currency" | "totalMinor">): string | undefined {
  if (document.totalMinor === null || document.currency === null) return undefined;
  const whole = (Math.abs(document.totalMinor) / 100).toFixed(2);
  const sign = document.totalMinor < 0 ? "-" : "";
  return document.currency === "AUD" ? `${sign}A$${whole}` : `${sign}${whole} ${document.currency}`;
}

/** The line hello-invoice prints for a document that arrived. */
export function helloLine(document: Document): string {
  if (document.ownKey) return `Hello, ${document.kind} from ${document.from}: kept with its owner's own key, so eBill cannot open it for an app.`;
  const amount = amountOf(document);
  const sample = document.sample ? " (a sample)" : "";
  return `Hello, ${document.kind} ${document.number} from ${document.from}${amount ? ` for ${amount}` : ""}${sample}.`;
}

/** Reads the document a document.received webhook names, and says hello to it. */
export async function helloTo(client: EbillClient, documentId: string): Promise<string> {
  return helloLine(await client.getDocument(documentId));
}
