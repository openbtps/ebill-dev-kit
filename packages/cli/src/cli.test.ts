import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { EXIT, run } from "./cli.ts";
import { INIT_FILES, handleFromName, initApp } from "./init.ts";
import { validateApp } from "./manifest.ts";

let root: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "ebill-cli-"));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function ebill(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  // No environment and a config folder of its own: a developer's real sign-in is never read.
  const code = await run(argv, { stdout: (text) => (out += text), stderr: (text) => (err += text), cwd: root, env: {}, configDir: join(root, ".config") });
  return { code, out, err };
}

describe("ebill app init", () => {
  test("writes the starter files, which validate clean", async () => {
    const result = await initApp(join(root, "Acme Subscriptions"));
    assert.deepEqual(result.files, [...INIT_FILES]);
    assert.deepEqual((await readdir(result.dir)).sort(), [...INIT_FILES].sort());
    const manifest = await readFile(join(result.dir, "ebill.app.toml"), "utf8");
    assert.match(manifest, /^handle = "acme-subscriptions"$/m);
    assert.match(await readFile(join(result.dir, "listing.toml"), "utf8"), /^name = "Acme Subscriptions"$/m);
    assert.match(await readFile(join(result.dir, "server.ts"), "utf8"), /verifyWebhook/);
    assert.deepEqual(await validateApp(result.dir), []);
  });

  test("refuses to overwrite, and writes nothing when any file exists", async () => {
    const dir = join(root, "existing");
    await initApp(dir);
    await rm(join(dir, "server.ts"));
    await writeFile(join(dir, "README.md"), "mine");
    await rm(join(dir, "listing.toml"));
    const result = await ebill("app", "init", "existing");
    assert.equal(result.code, EXIT.failed);
    assert.match(result.err, /Not overwriting existing files: ebill\.app\.toml, README\.md/);
    assert.equal(await readFile(join(dir, "README.md"), "utf8"), "mine");
    assert.deepEqual((await readdir(dir)).sort(), ["README.md", "ebill.app.toml"]);
  });

  test("takes --handle and refuses an invalid one", async () => {
    const ok = await ebill("app", "init", "custom", "--handle", "my-handle");
    assert.equal(ok.code, EXIT.ok);
    assert.match(await readFile(join(root, "custom", "ebill.app.toml"), "utf8"), /^handle = "my-handle"$/m);
    const bad = await ebill("app", "init", "custom-bad", "--handle", "Bad Handle");
    assert.equal(bad.code, EXIT.failed);
    assert.match(bad.err, /not a valid handle/);
  });

  test("derives a handle from the folder name", () => {
    assert.equal(handleFromName("Acme  Subscriptions!"), "acme-subscriptions");
    assert.equal(handleFromName("--x--"), "my-app");
    assert.equal(handleFromName("a".repeat(60)), "a".repeat(50));
  });
});

describe("ebill app validate", () => {
  test("exits 0 on a good app and says what it skipped", async () => {
    await initApp(join(root, "good"));
    const result = await ebill("app", "validate", "good");
    assert.equal(result.code, EXIT.ok);
    assert.match(result.out, /no problems found/);
    assert.match(result.out, /links open/);
  });

  test("exits 1 and lists each failure with check, path and reason", async () => {
    const dir = join(root, "bad");
    await initApp(dir);
    const manifest = await readFile(join(dir, "ebill.app.toml"), "utf8");
    await writeFile(
      join(dir, "ebill.app.toml"),
      manifest.replace('kind = "integration"', 'kind = "plugin"').replace("https://example.com/webhooks", "http://x"),
    );
    const result = await ebill("app", "validate", "bad");
    assert.equal(result.code, EXIT.failed);
    assert.match(result.err, /2 problems in bad/);
    assert.match(result.err, /ebill\.app\.toml:app\.kind {2}\(allowed-value\)\n {4}must be one of: integration, template/);
    assert.match(result.err, /ebill\.app\.toml:webhooks\.url {2}\(https-url\)/);
  });

  test("--json prints failures as data", async () => {
    const dir = join(root, "json");
    await initApp(dir);
    await rm(join(dir, "listing.toml"));
    const result = await ebill("app", "validate", "json", "--json");
    assert.equal(result.code, EXIT.failed);
    const parsed = JSON.parse(result.out) as { ok: boolean; failures: { check: string; path: string; reason: string }[]; skipped: string[] };
    assert.equal(parsed.ok, false);
    assert.deepEqual(
      parsed.failures.map((failure) => [failure.check, failure.path]),
      [["file-missing", "listing.toml"]],
    );
    assert.ok(parsed.skipped.length > 0);
  });

  test("reports a TOML syntax error with its position", async () => {
    const dir = join(root, "syntax");
    await initApp(dir);
    await writeFile(join(dir, "listing.toml"), 'name = "unterminated\n');
    const failures = await validateApp(dir);
    assert.equal(failures[0]?.check, "toml-syntax");
    assert.match(failures[0].reason, /^line 1, column \d+/);
  });
});

describe("commands that talk to eBill, before any sign-in (commands.test.ts has them signed in)", () => {
  test("each needs a sign-in, and says how to get one", async () => {
    await initApp(join(root, "unsigned"));
    for (const argv of [
      ["app", "dev", "--dir", "unsigned"],
      ["app", "versions", "--dir", "unsigned"],
      ["app", "release", "1.0.0", "--dir", "unsigned"],
      ["app", "status", "--dir", "unsigned"],
    ]) {
      const result = await ebill(...argv);
      assert.equal(result.code, EXIT.failed, argv.join(" "));
      assert.match(result.err, /Not signed in to eBill. Run "ebill login"/, argv.join(" "));
    }
  });

  test("parse their options for real", async () => {
    assert.equal((await ebill("app", "deploy", "--version", "1.2")).code, EXIT.failed);
    assert.equal((await ebill("app", "release", "v1.0.0")).code, EXIT.failed);
    assert.equal((await ebill("app", "dev", "--port", "99999")).code, EXIT.failed);
  });

  test("deploy checks the app locally first", async () => {
    const result = await ebill("app", "deploy", "--dir", "missing");
    assert.equal(result.code, EXIT.failed);
    assert.match(result.err, /file-missing/);
  });
});

describe("ebill", () => {
  test("--version prints the package version", async () => {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    const result = await ebill("--version");
    assert.equal(result.code, EXIT.ok);
    assert.equal(result.out.trim(), pkg.version);
  });

  test("help lists the commands", async () => {
    const result = await ebill("help");
    assert.equal(result.code, EXIT.ok);
    assert.match(result.out, /login/);
    assert.match(result.out, /app/);
    const app = await ebill("help", "app");
    for (const command of ["init", "validate", "dev", "deploy", "versions", "release", "rollback", "status"]) assert.match(app.out, new RegExp(command));
  });

  test("an unknown command exits 1", async () => {
    assert.equal((await ebill("app", "publish")).code, EXIT.failed);
  });
});
