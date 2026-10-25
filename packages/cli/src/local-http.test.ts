import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "smol-toml";
import { isLocalApi } from "./credentials.ts";
import { APP_FILE, LISTING_FILE, validateApp } from "./manifest.ts";

async function templateFile(file: string): Promise<Record<string, unknown>> {
  const source = await readFile(new URL(`../templates/${file}`, import.meta.url), "utf8");
  return parse(source.replaceAll("{{handle}}", "test-app").replaceAll("{{name}}", "Test app").replaceAll("{{kind}}", "integration"));
}

test("for an eBill on this computer, http addresses on this computer pass https only; any other address still fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ebill-local-http-"));
  try {
    const app = await templateFile(APP_FILE);
    (app.auth as Record<string, unknown>).redirect_urls = ["http://localhost:8090/oauth/callback", "http://elsewhere.example/callback"];
    const listing = await templateFile(LISTING_FILE);
    listing.support_url = "http://127.0.0.1:8090/support";
    await writeFile(join(dir, APP_FILE), stringify(app));
    await writeFile(join(dir, LISTING_FILE), stringify(listing));
    const https = async (localHttp: boolean) =>
      (await validateApp(dir, { localHttp })).filter((failure) => failure.check === "https-url").map((failure) => failure.path);
    assert.deepEqual(await https(true), ["ebill.app.toml:auth.redirect_urls[1]"]);
    assert.deepEqual(await https(false), ["ebill.app.toml:auth.redirect_urls[0]", "ebill.app.toml:auth.redirect_urls[1]", "listing.toml:support_url"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an eBill on this computer is one at http://localhost; the default and https ones are not", () => {
  assert.equal(isLocalApi({ env: { EBILL_API_URL: "http://localhost:4000" } }), true);
  assert.equal(isLocalApi({ env: { EBILL_API_URL: "http://127.0.0.1:4000/" } }), true);
  assert.equal(isLocalApi({ env: { EBILL_API_URL: "https://localhost:4000" } }), false);
  assert.equal(isLocalApi({ env: {} }), false);
  assert.equal(isLocalApi({ env: { EBILL_API_URL: "http://api.example" } }), false, "refused, so not local");
});
