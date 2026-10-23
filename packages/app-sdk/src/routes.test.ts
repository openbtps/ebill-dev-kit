// The typed calls against the API's own OpenAPI document (openapi.json, copied from eBill): each one is a route the
// API answers, and every route the API answers has one. When eBill adds a route, copy the document again, run
// `pnpm generate`, and this test says what the client is missing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import openapiTS, { astToString } from "openapi-typescript";
import { EbillClient } from "./client.ts";
import { fakeFetch, header, json } from "./test-helpers.ts";

const documentText = readFileSync(new URL("../openapi.json", import.meta.url), "utf8");
const document = JSON.parse(documentText) as { paths: Record<string, Record<string, unknown>> };

test("src/api-types.ts is what openapi.json makes (pnpm generate)", async () => {
  const made = astToString(await openapiTS(documentText));
  const kept = readFileSync(new URL("./api-types.ts", import.meta.url), "utf8");
  // The generator's own banner is written by its command line only.
  assert.equal(kept.slice(kept.indexOf("export ")), made.slice(made.indexOf("export ")));
});

/** `get /v1/documents/{id}` for a call to `GET https://api.test/v1/documents/d-1?…`, by the document's own templates. */
function routeOf(method: string, url: string): string | undefined {
  const path = new URL(url).pathname;
  for (const [template, operations] of Object.entries(document.paths)) {
    const pattern = new RegExp(`^${template.replace(/\{[^}]+\}/g, "[^/]+")}$`);
    if (pattern.test(path) && method.toLowerCase() in operations) return `${method.toLowerCase()} ${template}`;
  }
  return undefined;
}

test("every typed call is a route in the API's document, and every route but the token endpoint has one", async () => {
  const page = { data: [], next: null };
  const { fetch, calls } = fakeFetch([
    json(200, {}),
    json(200, {}),
    json(200, page),
    json(200, {}),
    new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "application/pdf" } }),
    json(200, {}),
    json(201, {}),
    json(202, {}),
    json(200, { data: [] }),
  ]);
  const api = new EbillClient({ accessToken: "tok", baseUrl: "https://api.test", fetch, retry: { maxRetries: 0 } });
  await api.getInstallation();
  await api.getSettings();
  await api.listDocuments("incoming", { limit: 10 });
  await api.getDocument("d-1");
  assert.deepEqual([...(await api.downloadFile("d-1", 0))], [1, 2, 3]);
  await api.getPayment("d-1");
  await api.createDraft({ kind: "letter" } as Parameters<EbillClient["createDraft"]>[0]);
  await api.sendDocument("d-1", { idempotencyKey: "send-d-1-once" });
  assert.deepEqual(await api.listContacts(), []);

  const called = calls.map((call) => routeOf(call.init.method ?? "GET", call.url));
  assert.ok(!called.includes(undefined), `a call that is not a route: ${JSON.stringify(calls.map((call) => call.url))}`);
  const routes = Object.entries(document.paths).flatMap(([path, operations]) => Object.keys(operations).map((method) => `${method} ${path}`));
  assert.deepEqual(new Set(called), new Set(routes.filter((route) => route !== "post /oauth/token")));
  assert.equal(header(calls[7], "idempotency-key"), "send-d-1-once");
  assert.equal(new URL(calls[2]?.url ?? "").searchParams.get("direction"), "incoming");
});
