import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SCOPE_NAMES, SCOPES, TOPIC_NAMES, isScope, isTopic, requiredScope } from "./catalog.ts";
import { parseRetryAfter } from "./http.ts";
import { SDK_VERSION } from "./version.ts";

test("scopes are exactly the published list", () => {
  assert.deepEqual(SCOPE_NAMES, [
    "drafts:write",
    "documents:send",
    "documents:read",
    "documents:received:read",
    "files:read",
    "contacts:read",
    "payments:read",
    "payments:write",
  ]);
  assert.equal(SCOPES["documents:send"], "Send documents in your name");
  assert.ok(isScope("files:read"));
  assert.ok(!isScope("toString"));
});

test("topics are exactly the published list, each with its scope", () => {
  assert.deepEqual(Object.fromEntries(TOPIC_NAMES.map((topic) => [topic, requiredScope(topic)])), {
    "document.sent": "documents:read",
    "document.delivered": "documents:read",
    "document.failed": "documents:read",
    "document.received": "documents:received:read",
    "payment.proposed": "payments:read",
    "payment.accepted": "payments:read",
    "payment.rejected": "payments:read",
    "app.installed": null,
    "app.uninstalled": null,
    "app.settings.updated": null,
  });
  assert.ok(isTopic("app.installed"));
  assert.ok(!isTopic("app"));
});

test("SDK_VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(SDK_VERSION, pkg.version);
});

test("Retry-After accepts seconds and HTTP dates", () => {
  assert.equal(parseRetryAfter("5"), 5);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter("soon"), undefined);
  assert.equal(parseRetryAfter("Wed, 21 Oct 2026 07:28:10 GMT", Date.parse("Wed, 21 Oct 2026 07:28:00 GMT")), 10);
});
