import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, test } from "node:test";
import { WebhookVerificationError } from "./errors.ts";
import { signWebhook, verifyWebhook } from "./webhooks.ts";

const secret = "whsec_test_secret";
const t = 1_800_000_000;
const now = new Date(t * 1000);
const event = {
  id: "evt_1",
  topic: "document.delivered",
  createdAt: "2027-01-15T08:00:00Z",
  installationId: "inst_1",
  data: { documentId: "doc_1", kind: "invoice", to: "pat$example.com", at: "2027-01-15T08:00:00Z" },
};
const rawBody = JSON.stringify(event);

function sig(body: string, key: string, timestamp = t): string {
  return createHmac("sha256", key)
    .update(`${String(timestamp)}.${body}`)
    .digest("hex");
}

function rejects(reason: WebhookVerificationError["reason"]) {
  return (error: unknown) => error instanceof WebhookVerificationError && error.reason === reason;
}

describe("verifyWebhook", () => {
  test("accepts a valid signature and returns the typed event", () => {
    const result = verifyWebhook({ rawBody, signatureHeader: `t=${String(t)},v1=${sig(rawBody, secret)}`, secret, now });
    assert.deepEqual(result, event);
    assert.equal(result.topic, "document.delivered");
    assert.equal(result.data.documentId, "doc_1");
  });

  test("accepts the body as bytes", () => {
    const header = signWebhook({ rawBody, secret, timestamp: t });
    assert.equal(verifyWebhook({ rawBody: new TextEncoder().encode(rawBody), signatureHeader: header, secret, now }).id, "evt_1");
  });

  test("rejects a tampered body", () => {
    const tampered = rawBody.replace("doc_1", "doc_2");
    assert.throws(
      () => verifyWebhook({ rawBody: tampered, signatureHeader: `t=${String(t)},v1=${sig(rawBody, secret)}`, secret, now }),
      rejects("signature_mismatch"),
    );
  });

  test("rejects the wrong secret", () => {
    assert.throws(() => verifyWebhook({ rawBody, signatureHeader: `t=${String(t)},v1=${sig(rawBody, "other")}`, secret, now }), rejects("signature_mismatch"));
  });

  test("rejects a timestamp outside the tolerance, in either direction", () => {
    const header = signWebhook({ rawBody, secret, timestamp: t });
    assert.throws(() => verifyWebhook({ rawBody, signatureHeader: header, secret, now: new Date((t + 301) * 1000) }), rejects("timestamp_out_of_tolerance"));
    assert.throws(() => verifyWebhook({ rawBody, signatureHeader: header, secret, now: new Date((t - 301) * 1000) }), rejects("timestamp_out_of_tolerance"));
    assert.equal(verifyWebhook({ rawBody, signatureHeader: header, secret, now: new Date((t + 300) * 1000) }).id, "evt_1");
    assert.throws(
      () => verifyWebhook({ rawBody, signatureHeader: header, secret, now: new Date((t + 11) * 1000), toleranceSeconds: 10 }),
      rejects("timestamp_out_of_tolerance"),
    );
  });

  test("accepts any of several v1 values, for secret rotation", () => {
    const header = `t=${String(t)},v1=${sig(rawBody, "old-secret")},v1=${sig(rawBody, secret)}`;
    assert.equal(verifyWebhook({ rawBody, signatureHeader: header, secret, now }).id, "evt_1");
  });

  test("accepts any of several secrets held by the app", () => {
    const header = `t=${String(t)},v1=${sig(rawBody, "new-secret")}`;
    assert.equal(verifyWebhook({ rawBody, signatureHeader: header, secret: [secret, "new-secret"], now }).id, "evt_1");
  });

  test("rejects malformed headers", () => {
    const good = sig(rawBody, secret);
    for (const header of [undefined, null, "", "garbage", `v1=${good}`, `t=${String(t)}`, `t=abc,v1=${good}`, `t=${String(t)},v1=xyz`, `t=1,t=2,v1=${good}`]) {
      assert.throws(() => verifyWebhook({ rawBody, signatureHeader: header, secret, now }), rejects("malformed_header"), String(header));
    }
  });

  test("ignores unknown signature schemes next to v1", () => {
    const header = `t=${String(t)},v0=whatever,v1=${sig(rawBody, secret)}`;
    assert.equal(verifyWebhook({ rawBody, signatureHeader: header, secret, now }).id, "evt_1");
  });

  test("rejects a signed body that is not an event", () => {
    const body = JSON.stringify({ hello: "world" });
    assert.throws(
      () => verifyWebhook({ rawBody: body, signatureHeader: signWebhook({ rawBody: body, secret, timestamp: t }), secret, now }),
      rejects("invalid_body"),
    );
    const notJson = "not json";
    assert.throws(
      () => verifyWebhook({ rawBody: notJson, signatureHeader: signWebhook({ rawBody: notJson, secret, timestamp: t }), secret, now }),
      rejects("invalid_body"),
    );
  });

  test("rejects a topic this SDK does not know", () => {
    const body = JSON.stringify({ ...event, topic: "document.exploded" });
    assert.throws(
      () => verifyWebhook({ rawBody: body, signatureHeader: signWebhook({ rawBody: body, secret, timestamp: t }), secret, now }),
      rejects("unknown_topic"),
    );
  });
});
