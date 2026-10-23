import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { EbillClient } from "./client.ts";
import { EbillApiError, EbillNetworkError } from "./errors.ts";
import type { RetryInfo } from "./http.ts";
import { fakeFetch, header, json, settle, type Reply } from "./test-helpers.ts";

function client(replies: Reply[], maxRetries?: number) {
  const fake = fakeFetch(replies);
  const retries: RetryInfo[] = [];
  const api = new EbillClient({
    accessToken: "tok_1",
    baseUrl: "https://api.test",
    fetch: fake.fetch,
    retry: { onRetry: (info) => retries.push(info), ...(maxRetries === undefined ? {} : { maxRetries }) },
  });
  return { api, calls: fake.calls, delays: () => retries.map((info) => info.delayMs) };
}

const installation = {
  id: "inst_1",
  organisation: { id: "org_1", name: "Acme" },
  app: { handle: "acme-subscriptions", version: "1.0.0" },
  scopes: ["documents:read"],
  installedAt: "2027-01-01T00:00:00Z",
};

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  mock.method(Math, "random", () => 0.5);
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

describe("EbillClient requests", () => {
  test("getInstallation sends the bearer token to /v1/installation", async () => {
    const { api, calls } = client([json(200, installation)]);
    assert.deepEqual(await api.getInstallation(), installation);
    assert.equal(calls[0]?.url, "https://api.test/v1/installation");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(header(calls[0], "authorization"), "Bearer tok_1");
    assert.match(header(calls[0], "user-agent") ?? "", /^ebilladdress-app-sdk\/0\.1\.0$/);
  });

  test("getSettings reads /v1/installation/settings", async () => {
    const settings = { values: { terms_days: 14 }, updatedAt: "2027-01-01T00:00:00Z" };
    const { api, calls } = client([json(200, settings)]);
    assert.deepEqual(await api.getSettings(), settings);
    assert.equal(calls[0]?.url, "https://api.test/v1/installation/settings");
  });

  test("request sends query, JSON body and Idempotency-Key", async () => {
    const { api, calls } = client([json(201, { id: "drf_1" })]);
    const result = await api.request<{ id: string }>("POST", "/v1/drafts", {
      query: { dry: true, tag: ["a", "b"], skip: undefined },
      body: { to: "pat$example.com" },
      idempotencyKey: "key-1",
    });
    assert.equal(result.id, "drf_1");
    assert.equal(calls[0]?.url, "https://api.test/v1/drafts?dry=true&tag=a&tag=b");
    assert.equal(calls[0].init.body, JSON.stringify({ to: "pat$example.com" }));
    assert.equal(header(calls[0], "content-type"), "application/json");
    assert.equal(header(calls[0], "idempotency-key"), "key-1");
  });

  test("an access token function is called for each request", async () => {
    let n = 0;
    const fake = fakeFetch([json(200, installation), json(200, installation)]);
    const api = new EbillClient({ accessToken: () => Promise.resolve(`tok_${String(++n)}`), baseUrl: "https://api.test", fetch: fake.fetch });
    await api.getInstallation();
    await api.getInstallation();
    assert.deepEqual(
      fake.calls.map((call) => header(call, "authorization")),
      ["Bearer tok_1", "Bearer tok_2"],
    );
  });

  test("request refuses paths outside /v1/", async () => {
    const { api, calls } = client([]);
    await assert.rejects(api.request("POST", "/oauth/token"), TypeError);
    assert.equal(calls.length, 0);
  });
});

describe("EbillApiError mapping", () => {
  test("maps the JSON error body", async () => {
    const { api, calls } = client([json(400, { error: "invalid_request", message: "to is required", reference: "ref_123" })]);
    const error = await api.request("POST", "/v1/drafts", { body: {} }).catch((caught: unknown) => caught);
    assert.ok(error instanceof EbillApiError);
    assert.equal(error.status, 400);
    assert.equal(error.error, "invalid_request");
    assert.equal(error.message, "to is required");
    assert.equal(error.reference, "ref_123");
    assert.equal(error.retryAfter, undefined);
    assert.equal(calls.length, 1);
  });

  test("falls back when the body is not JSON", async () => {
    const { api } = client([new Response("oops", { status: 404, statusText: "Not Found" })]);
    await assert.rejects(api.request("GET", "/v1/nothing"), (error: unknown) => {
      return error instanceof EbillApiError && error.error === "http_404" && error.message === "404 Not Found" && error.reference === undefined;
    });
  });

  test("carries Retry-After when retries are exhausted", async () => {
    const { api } = client([json(429, { error: "rate_limited", message: "Slow down" }, { "retry-after": "7" })], 0);
    await assert.rejects(api.getInstallation(), (error: unknown) => error instanceof EbillApiError && error.status === 429 && error.retryAfter === 7);
  });
});

describe("retries", () => {
  test("429 waits for Retry-After, then succeeds", async () => {
    const { api, calls, delays } = client([json(429, { error: "rate_limited", message: "Slow down" }, { "retry-after": "2" }), json(200, installation)]);
    assert.deepEqual(await settle(api.getInstallation()), installation);
    assert.equal(calls.length, 2);
    assert.deepEqual(delays(), [2000]);
  });

  test("503 backs off with jitter, then succeeds", async () => {
    const { api, calls, delays } = client([json(503, { error: "unavailable", message: "Try again" }), json(200, installation)]);
    assert.deepEqual(await settle(api.getInstallation()), installation);
    assert.equal(calls.length, 2);
    assert.deepEqual(delays(), [375]);
  });

  test("backoff doubles and stops after maxRetries", async () => {
    const failure = (): Response => json(500, { error: "internal", message: "Broken" });
    const { api, calls, delays } = client([failure(), failure(), failure(), failure(), failure()]);
    await assert.rejects(settle(api.getInstallation()), (error: unknown) => error instanceof EbillApiError && error.status === 500);
    assert.equal(calls.length, 4);
    assert.deepEqual(delays(), [375, 750, 1500]);
  });

  test("400 is not retried", async () => {
    const { api, calls } = client([json(400, { error: "invalid_request", message: "Bad" }), json(200, installation)]);
    await assert.rejects(settle(api.getInstallation()), EbillApiError);
    assert.equal(calls.length, 1);
  });

  test("network errors are retried on GET", async () => {
    const { api, calls } = client([new TypeError("fetch failed"), json(200, installation)]);
    assert.deepEqual(await settle(api.getInstallation()), installation);
    assert.equal(calls.length, 2);
  });

  test("network errors surface as EbillNetworkError once retries run out", async () => {
    const { api } = client([new TypeError("fetch failed")], 0);
    await assert.rejects(api.getInstallation(), EbillNetworkError);
  });

  test("POST without an idempotency key is not retried on 5xx, but is on 429", async () => {
    const unsafe = client([json(503, { error: "unavailable", message: "Try again" }), json(201, {})]);
    await assert.rejects(settle(unsafe.api.request("POST", "/v1/drafts", { body: {} })), EbillApiError);
    assert.equal(unsafe.calls.length, 1);

    const limited = client([json(429, { error: "rate_limited", message: "Slow down" }), json(201, { id: "drf_1" })]);
    assert.deepEqual(await settle(limited.api.request("POST", "/v1/drafts", { body: {} })), { id: "drf_1" });
    assert.equal(limited.calls.length, 2);
  });

  test("POST with an idempotency key is retried on 5xx with the same key", async () => {
    const { api, calls } = client([json(502, { error: "bad_gateway", message: "Try again" }), json(201, { id: "drf_1" })]);
    await settle(api.request("POST", "/v1/drafts", { body: {}, idempotencyKey: "key-1" }));
    assert.deepEqual(
      calls.map((call) => header(call, "idempotency-key")),
      ["key-1", "key-1"],
    );
  });

  test("a Retry-After longer than maxDelayMs is thrown rather than waited for", async () => {
    const { api, calls } = client([json(429, { error: "rate_limited", message: "Slow down" }, { "retry-after": "3600" }), json(200, installation)]);
    await assert.rejects(settle(api.getInstallation()), (error: unknown) => error instanceof EbillApiError && error.retryAfter === 3600);
    assert.equal(calls.length, 1);
  });
});

describe("paginate", () => {
  test("follows next until it is null", async () => {
    const { api, calls } = client([json(200, { data: [{ id: 1 }, { id: 2 }], next: "cur_2" }), json(200, { data: [{ id: 3 }], next: null })]);
    const items: unknown[] = [];
    for await (const item of api.paginate<{ id: number }>("/v1/documents", { kind: "invoice" })) items.push(item);
    assert.deepEqual(items, [{ id: 1 }, { id: 2 }, { id: 3 }]);
    assert.deepEqual(
      calls.map((call) => call.url),
      ["https://api.test/v1/documents?kind=invoice", "https://api.test/v1/documents?kind=invoice&after=cur_2"],
    );
  });

  test("throws when the endpoint is not a list", async () => {
    const { api } = client([json(200, { id: "x" })]);
    await assert.rejects(api.paginate("/v1/installation").next(), TypeError);
  });
});
