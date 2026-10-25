// hello-invoice, checked as `ebill app validate` checks it, and its reading of an invoice, against a stand-in for eBill.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { EbillClient, type Document } from "@ebilladdress/app-sdk";
import { validateApp } from "@ebilladdress/cli";
import { amountOf, helloLine, helloTo } from "./hello.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));

const SAMPLE: Document = {
  id: "doc_1",
  kind: "invoice",
  direction: "incoming",
  state: "received",
  from: "sample-biller$sandbox.invalid",
  to: "you$sandbox.invalid",
  encrypted: false,
  ownKey: false,
  number: "S-1001",
  title: "Sample invoice",
  issuedAt: "2027-01-02T00:00:00Z",
  dueAt: null,
  currency: "AUD",
  totalMinor: 4950,
  references: [],
  files: [],
  content: null,
  createdAt: "2027-01-02T00:00:00Z",
  queuedAt: null,
  deliveredAt: null,
  receivedAt: "2027-01-02T00:00:00Z",
  failedAt: null,
  failureCode: null,
  retrying: false,
  sample: true,
};

test("its manifest and listing pass every check `ebill app validate` makes", async () => {
  assert.deepEqual(await validateApp(HERE), []);
});

test("it says hello to an invoice by its number, sender and amount, and to one it cannot open by its sender alone", () => {
  assert.equal(helloLine(SAMPLE), "Hello, invoice S-1001 from sample-biller$sandbox.invalid for A$49.50 (a sample).");
  assert.match(helloLine({ ...SAMPLE, ownKey: true, sample: false }), /^Hello, invoice from sample-biller\$sandbox\.invalid: kept with its owner's own key/);
  assert.deepEqual([amountOf({ currency: "NZD", totalMinor: 100 }), amountOf({ currency: null, totalMinor: null })], ["1.00 NZD", undefined]);
});

test("it reads the document the webhook names, and nothing else", async () => {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${input instanceof Request ? input.url : String(input)}`);
    return Promise.resolve(new Response(JSON.stringify(SAMPLE), { status: 200, headers: { "content-type": "application/json" } }));
  };
  const said = await helloTo(new EbillClient({ accessToken: "token", baseUrl: "https://api.test", fetch }), "doc_1");
  assert.match(said, /S-1001/);
  assert.deepEqual(calls, ["GET https://api.test/v1/documents/doc_1"]);
});
