import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EbillApiError } from "./errors.ts";
import { exchangeCode, refreshToken } from "./oauth.ts";
import { fakeFetch, header, json } from "./test-helpers.ts";

const tokenBody = {
  access_token: "at_1",
  refresh_token: "rt_1",
  token_type: "Bearer",
  expires_in: 3600,
  installation_id: "inst_1",
  scopes: ["drafts:write"],
};

function form(body: RequestInit["body"]): Record<string, string> {
  assert.equal(typeof body, "string");
  return Object.fromEntries(new URLSearchParams(body as string));
}

describe("OAuth token exchange", () => {
  test("exchangeCode posts an authorization_code grant", async () => {
    const { fetch, calls } = fakeFetch([json(200, tokenBody)]);
    const before = Date.now();
    const tokens = await exchangeCode({
      code: "code_1",
      redirectUri: "https://app.example/auth/callback",
      clientId: "app_abc",
      clientSecret: "shh",
      baseUrl: "https://api.test/",
      fetch,
    });
    const [call] = calls;
    assert.ok(call);
    assert.equal(call.url, "https://api.test/oauth/token");
    assert.equal(call.init.method, "POST");
    assert.equal(header(call, "content-type"), "application/x-www-form-urlencoded");
    assert.equal(header(call, "authorization"), undefined);
    assert.deepEqual(form(call.init.body), {
      grant_type: "authorization_code",
      code: "code_1",
      redirect_uri: "https://app.example/auth/callback",
      client_id: "app_abc",
      client_secret: "shh",
    });
    assert.equal(tokens.accessToken, "at_1");
    assert.equal(tokens.refreshToken, "rt_1");
    assert.equal(tokens.tokenType, "Bearer");
    assert.equal(tokens.expiresIn, 3600);
    assert.equal(tokens.installationId, "inst_1");
    assert.deepEqual(tokens.scopes, ["drafts:write"]);
    assert.ok(tokens.expiresAt.getTime() >= before + 3_600_000);
  });

  test("refreshToken posts a refresh_token grant", async () => {
    const { fetch, calls } = fakeFetch([json(200, tokenBody)]);
    await refreshToken({ refreshToken: "rt_0", clientId: "app_abc", clientSecret: "shh", baseUrl: "https://api.test", fetch });
    assert.deepEqual(form(calls[0]?.init.body), { grant_type: "refresh_token", refresh_token: "rt_0", client_id: "app_abc", client_secret: "shh" });
  });

  test("uses the production API by default", async () => {
    const { fetch, calls } = fakeFetch([json(200, tokenBody)]);
    await refreshToken({ refreshToken: "rt_0", clientId: "app_abc", clientSecret: "shh", fetch });
    assert.equal(calls[0]?.url, "https://api.ebilladdress.com/oauth/token");
  });

  test("a refused grant is an EbillApiError and is not retried", async () => {
    const { fetch, calls } = fakeFetch([json(400, { error: "invalid_grant", error_description: "Code already used" })]);
    await assert.rejects(
      exchangeCode({ code: "c", redirectUri: "https://app.example/cb", clientId: "a", clientSecret: "s", fetch }),
      (error: unknown) => error instanceof EbillApiError && error.error === "invalid_grant" && error.message === "Code already used",
    );
    assert.equal(calls.length, 1);
  });

  test("an unexpected answer is refused", async () => {
    const { fetch } = fakeFetch([json(200, { access_token: "at_1" })]);
    await assert.rejects(exchangeCode({ code: "c", redirectUri: "https://app.example/cb", clientId: "a", clientSecret: "s", fetch }), TypeError);
  });
});
