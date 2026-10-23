// The commands that talk to eBill, against a stand-in for its developer API (CONTRACT.md, "Developer API"): sign in
// with the device grant, then deploy, list, release, roll back and show the app in a folder.
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { EXIT, run } from "./cli.ts";
import { isControl } from "./commands.ts";
import { initApp } from "./init.ts";

const CLIENT_ID = "app_abcdefghijklmnopqrstuvwx";
const TOKEN = `ebdt_${"t".repeat(43)}`;
let root: string;

interface Version {
  id: string;
  version: string;
  state: string;
  submittedAt: string;
  reviewNote: string | null;
}

/** The stand-in: one login that is approved after `polls` polls (or refused), and one app. */
class FakeEbill {
  polls = 0;
  approveAfter = 2;
  refuse = false;
  rejectPush = false;
  seen: string[] = [];
  versions: Version[] = [];

  readonly fetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => Promise.resolve(this.answer(input, init));

  private answer(input: string | URL | Request, init: RequestInit): Response {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const headers = init.headers as Record<string, string> | undefined;
    const sent = typeof init.body === "string" ? init.body : "";
    this.seen.push(`${init.method ?? "GET"} ${url.pathname}`);
    const json = (status: number, value: unknown): Response => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/developer/device/code")
      return json(200, {
        device_code: `ebdc_${"d".repeat(43)}`,
        user_code: "BCDF-GHJK",
        verification_uri: "https://app.test/developer/device",
        verification_uri_complete: "https://app.test/developer/device?code=BCDF-GHJK",
        expires_in: 600,
        interval: 5,
      });
    if (url.pathname === "/developer/device/token") {
      // As eBill's token endpoint: a form, never JSON.
      const form = headers?.["content-type"] === "application/x-www-form-urlencoded" ? new URLSearchParams(sent) : undefined;
      if (form?.get("grant_type") !== "urn:ietf:params:oauth:grant-type:device_code" || !form.get("device_code")?.startsWith("ebdc_"))
        return json(400, { error: "invalid_request" });
      this.polls += 1;
      if (this.refuse) return json(400, { error: "access_denied" });
      return this.polls < this.approveAfter
        ? json(400, { error: "authorization_pending" })
        : json(200, { access_token: TOKEN, token_type: "Bearer", expires_in: 7776000 });
    }
    if (headers?.authorization !== `Bearer ${TOKEN}`)
      return json(401, { error: "unauthorized", message: "The developer token is missing.", reference: "AB12-CD34" });
    if (url.pathname === "/developer/v1/apps")
      return json(200, {
        data: [{ id: "app-1", handle: "acme-subscriptions", kind: "integration", clientId: CLIENT_ID, delistedAt: null, versions: this.versions }],
      });
    if (url.pathname === "/developer/v1/apps/app-1/versions") {
      if (this.rejectPush)
        return json(200, { state: "rejected", failures: [{ check: "image-size", path: "listing.toml:icon_url", reason: "is 100×100; must be 512×512" }] });
      const version = (JSON.parse(sent) as { manifest: { app: { version: string } } }).manifest.app.version;
      const made = { id: `v-${version}`, version, state: "review_pending", submittedAt: "2027-01-01T00:00:00Z", reviewNote: null };
      this.versions.unshift(made);
      return json(200, { state: "review_pending", failures: [], version: made });
    }
    const released = /^\/developer\/v1\/versions\/(.+)\/release$/.exec(url.pathname)?.[1];
    const target = this.versions.find((one) => one.id === released);
    if (target) {
      for (const one of this.versions) if (one.state === "released") one.state = "superseded";
      target.state = "released";
      return json(200, { version: target, moved: 3, waiting: 1 });
    }
    return json(404, { error: "not_found", message: "Not found." });
  }
}

let ebillServer: FakeEbill;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "ebill-commands-"));
  await initApp(join(root, "acme"));
  const manifest = await readFile(join(root, "acme", "ebill.app.toml"), "utf8");
  await writeFile(join(root, "acme", "ebill.app.toml"), manifest.replace(/client_id = "[^"]*"/, `client_id = "${CLIENT_ID}"`));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  ebillServer = new FakeEbill();
});

async function ebill(env: Record<string, string>, ...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await run(argv, {
    stdout: (text) => (out += text),
    stderr: (text) => (err += text),
    cwd: root,
    env: { EBILL_API_URL: "https://api.test", ...env },
    configDir: join(root, ".config"),
    fetch: ebillServer.fetch,
    sleep: () => Promise.resolve(),
  });
  return { code, out, err };
}

describe("ebill login", () => {
  test("shows the page and the code, waits while it is pending, and keeps the token readable by this user alone", async () => {
    const result = await ebill({}, "login");
    assert.equal(result.code, EXIT.ok, result.err);
    assert.match(result.out, /https:\/\/app\.test\/developer\/device\?code=BCDF-GHJK/);
    assert.match(result.out, /BCDF-GHJK/);
    assert.equal(ebillServer.polls, 2);
    const file = join(root, ".config", "credentials.json");
    const saved = JSON.parse(await readFile(file, "utf8")) as { apiUrl: string; token: string };
    assert.deepEqual([saved.apiUrl, saved.token], ["https://api.test", TOKEN]);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  });

  test("a sign-in saved over a file others could read leaves it readable by this user alone", async () => {
    const file = join(root, ".config", "credentials.json");
    await writeFile(file, "{}", { mode: 0o644 });
    await chmod(file, 0o644);
    await chmod(join(root, ".config"), 0o755);
    assert.equal((await ebill({}, "login")).code, EXIT.ok);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(join(root, ".config"))).mode & 0o777, 0o700);
  });

  test("a token is never sent in the clear: http is refused but for this computer", async () => {
    const refused = await ebill({ EBILL_API_URL: "http://api.example.com" }, "login");
    assert.equal(refused.code, EXIT.failed);
    assert.match(refused.err, /must be https/);
    assert.deepEqual(ebillServer.seen, [], "nothing was sent");
    assert.match((await ebill({ EBILL_API_URL: "http://api.example.com", EBILL_TOKEN: TOKEN }, "app", "versions", "--dir", "acme")).err, /must be https/);
    assert.deepEqual(ebillServer.seen, []);
    assert.equal((await ebill({ EBILL_API_URL: "http://localhost:4000" }, "login")).code, EXIT.ok);
  });

  test("a refused sign-in is said, and nothing is kept; logout forgets it", async () => {
    await ebill({}, "logout");
    ebillServer.refuse = true;
    const refused = await ebill({}, "login");
    assert.equal(refused.code, EXIT.failed);
    assert.match(refused.err, /refused in eBill/);
    assert.match((await ebill({}, "logout")).out, /Not signed in/);
  });
});

describe("the app's versions", () => {
  test("deploy pushes the folder's app, which then waits for review; versions and status show it", async () => {
    const deployed = await ebill({ EBILL_TOKEN: TOKEN }, "app", "deploy", "--dir", "acme");
    assert.equal(deployed.code, EXIT.ok, deployed.err);
    assert.match(deployed.out, /Deployed acme-subscriptions 1\.0\.0\. It waits for eBill's review/);
    assert.ok(ebillServer.seen.includes("POST /developer/v1/apps/app-1/versions"));
    assert.match((await ebill({ EBILL_TOKEN: TOKEN }, "app", "versions", "--dir", "acme")).out, /1\.0\.0\s+waiting for review/);
    const shown = await ebill({ EBILL_TOKEN: TOKEN }, "app", "status", "--dir", "acme");
    assert.match(shown.out, /Live: no version released yet/);
    assert.match(shown.out, /Waiting:/);
  });

  test("a push eBill's checks refuse is told every failure; a --version that is not the file's is refused before anything is sent", async () => {
    ebillServer.rejectPush = true;
    const refused = await ebill({ EBILL_TOKEN: TOKEN }, "app", "deploy", "--dir", "acme");
    assert.equal(refused.code, EXIT.failed);
    assert.match(refused.err, /listing\.toml:icon_url {2}\(image-size\)/);
    const mismatched = await ebill({ EBILL_TOKEN: TOKEN }, "app", "deploy", "--dir", "acme", "--version", "9.9.9");
    assert.equal(mismatched.code, EXIT.failed);
    assert.match(mismatched.err, /is not the version in ebill\.app\.toml/);
  });

  test("release moves installations; rollback only to a version released before; an unknown version is said", async () => {
    ebillServer.versions = [
      { id: "v-1.1.0", version: "1.1.0", state: "approved", submittedAt: "2027-01-02T00:00:00Z", reviewNote: null },
      { id: "v-1.0.0", version: "1.0.0", state: "released", submittedAt: "2027-01-01T00:00:00Z", reviewNote: null },
    ];
    const released = await ebill({ EBILL_TOKEN: TOKEN }, "app", "release", "1.1.0", "--dir", "acme");
    assert.equal(released.code, EXIT.ok, released.err);
    assert.match(released.out, /Released acme-subscriptions 1\.1\.0: 3 installations moved to it\. 1 wait/);
    const back = await ebill({ EBILL_TOKEN: TOKEN }, "app", "rollback", "1.0.0", "--dir", "acme");
    assert.equal(back.code, EXIT.ok, back.err);
    assert.equal((await ebill({ EBILL_TOKEN: TOKEN }, "app", "rollback", "1.0.0", "--dir", "acme")).code, EXIT.failed);
    const unknown = await ebill({ EBILL_TOKEN: TOKEN }, "app", "release", "7.0.0", "--dir", "acme");
    assert.match(unknown.err, /has no version 7\.0\.0/);
  });

  test("what eBill says is printed without control characters: an answer cannot drive the terminal", async () => {
    ebillServer.versions = [
      { id: "v-1.0.0", version: "1.0.0", state: "changes_requested", submittedAt: "2027-01-01T00:00:00Z", reviewNote: "fix\u001b]0;owned\u0007 this" },
    ];
    const shown = await ebill({ EBILL_TOKEN: TOKEN }, "app", "versions", "--dir", "acme");
    assert.ok(!Array.from(shown.out).some((character) => character !== "\n" && isControl(character)));
    assert.ok(shown.out.includes("fix ]0;owned  this"));
  });

  test("a token eBill does not take is told, with its reference, and how to sign in again", async () => {
    const result = await ebill({ EBILL_TOKEN: `ebdt_${"x".repeat(43)}` }, "app", "versions", "--dir", "acme");
    assert.equal(result.code, EXIT.failed);
    assert.match(result.err, /unauthorized, reference AB12-CD34/);
    assert.match(result.err, /Run "ebill login" to sign in again/);
  });
});
