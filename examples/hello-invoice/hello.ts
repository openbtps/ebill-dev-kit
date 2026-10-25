// What hello-invoice does with eBillAddress's API, kept apart from its server so it can be tested without one: write a
// one-line invoice from the organisation that installed the app to an address it is given, and send it.
import type { Document, DraftRequest, EbillClient } from "@ebilladdress/app-sdk";

export interface HelloInvoice {
  /** One of the organisation's own addresses, which it sends from. */
  from: string;
  /** Who receives it: any eBillAddress address. */
  to: string;
  /** When it is dated; now when left out. */
  now?: Date;
}

/** The draft: one line, A$1.00, no tax, due in 14 days. The invoice number is the date and time, so each is new. */
export function helloDraft({ from, to, now = new Date() }: HelloInvoice): DraftRequest {
  const due = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  return {
    kind: "invoice",
    currency: "AUD",
    documentNumber: `HELLO-${now.toISOString().slice(0, 19).replace(/\D/g, "")}`,
    title: "Hello from hello-invoice",
    fromAddress: from,
    toAddress: to,
    issuedAt: now.toISOString(),
    dueAt: due.toISOString(),
    description: "Your first invoice sent through the eBillAddress API.",
    lineItems: [{ description: "Hello", quantity: "1", unitPriceMinor: 100, lineTotalMinor: 100, taxAmountMinor: 0, taxCategory: "none" }],
  };
}

/**
 * Writes the draft and sends it. The idempotency key is the draft's own id, so sending again after a lost answer sends
 * it once: eBill answers a retry with the same key as it answered the first.
 */
export async function sendHello(client: EbillClient, invoice: HelloInvoice): Promise<Document> {
  const draft = await client.createDraft(helloDraft(invoice));
  return client.sendDocument(draft.id, { idempotencyKey: `hello-${draft.id}` });
}
