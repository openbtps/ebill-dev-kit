// hello-invoice, checked as `ebill app validate` checks it, and its calls to the API, against a stand-in for eBill.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { EbillClient } from "@ebilladdress/app-sdk";
import { validateApp } from "@ebilladdress/cli";
import { helloDraft, sendHello } from "./hello.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));

test("its manifest and listing pass every check `ebill app validate` makes", async () => {
  assert.deepEqual(await validateApp(HERE), []);
});

test("the draft: one line of A$1.00, no tax, from and to the addresses given, due in 14 days", () => {
  const draft = helloDraft({ from: "acme$ebilladdress.com", to: "bob$ebilladdress.com", now: new Date("2027-01-02T03:04:05Z") });
  assert.equal(draft.kind, "invoice");
  assert.deepEqual(
    [draft.fromAddress, draft.toAddress, draft.currency, draft.documentNumber],
    ["acme$ebilladdress.com", "bob$ebilladdress.com", "AUD", "HELLO-20270102030405"],
  );
  assert.equal(draft.dueAt, "2027-01-16T03:04:05.000Z");
  assert.deepEqual(
    draft.lineItems.map((line) => [line.unitPriceMinor, line.lineTotalMinor, line.taxAmountMinor, line.taxCategory]),
    [[100, 100, 0, "none"]],
  );
});

test("it writes the draft, then sends it once, keyed by the draft's id", async () => {
  const calls: { url: string; method: string; key: string | null }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, method: init?.method ?? "GET", key: new Headers(init?.headers).get("idempotency-key") });
    const body = url.endsWith("/send") ? { id: "doc_1", state: "queued" } : { id: "doc_1", state: "draft" };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  };
  const client = new EbillClient({ accessToken: "token", baseUrl: "https://api.test", fetch });
  const sent = await sendHello(client, { from: "acme$ebilladdress.com", to: "bob$ebilladdress.com" });
  assert.equal(sent.id, "doc_1");
  assert.deepEqual(
    calls.map((call) => [call.method, call.url, call.key]),
    [
      ["POST", "https://api.test/v1/drafts", null],
      ["POST", "https://api.test/v1/documents/doc_1/send", "hello-doc_1"],
    ],
  );
});
