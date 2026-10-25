import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initApp } from "./init.ts";
import { validateApp, validateAppManifest } from "./manifest.ts";
import { TEMPLATE_FILE, contrast, validateTemplate } from "./template.ts";

type Doc = Record<string, unknown>;

async function starter(): Promise<Doc> {
  const source = await readFile(new URL(`../templates/${TEMPLATE_FILE}`, import.meta.url), "utf8");
  return JSON.parse(source.replaceAll("{{name}}", "Kauri Studio")) as Doc;
}

const said = (raw: unknown): string[] => validateTemplate(raw).map((failure) => `${failure.check} ${failure.path}`);
const at = (doc: Doc, key: string): Doc => doc[key] as Doc;

test("the init template is clean", async () => {
  assert.deepEqual(said(await starter()), []);
});

// The same cases as eBill's own checks, at the same paths, so a push is told what validate said.
const CASES: [string, (doc: Doc) => void, string[]][] = [
  ["a later format", (d) => (d.format = 2), ["allowed-value template.json:format"]],
  ["an unknown key", (d) => (d.script = "alert(1)"), ["unknown-key template.json"]],
  ["a font not on eBill's list", (d) => (at(d, "page").font = "Comic Sans"), ["allowed-value template.json:page.font"]],
  ["a colour that is a url", (d) => (at(d, "page").background = "url(https://x.test/a.png)"), ["template-value template.json:page.background"]],
  ["a kind with no template reference yet", (d) => (d.kinds = ["letter"]), ["allowed-value template.json:kinds[0]"]],
  [
    "a section with signed fields left out",
    (d) => (d.sections = ["header", "parties", "details", "lines", "totals", "notes"]),
    ["section-required template.json:sections"],
  ],
  ["terms shown with none given", (d) => delete at(d, "text").terms, ["section-text template.json:text.terms"]],
  ["a label that is markup", (d) => (at(d, "labels").title = "<b>Invoice</b>"), ["template-value template.json:labels.title"]],
  ["a label for a field that is not one", (d) => (at(d, "labels").amount = "999"), ["unknown-key template.json:labels"]],
  ["text that cannot be read", (d) => (at(d, "page").text = "#eeeeee"), ["contrast template.json:page.text"]],
  ["a logo of the developer's", (d) => (at(d, "logo").url = "https://dev.test/logo.png"), ["unknown-key template.json:logo"]],
  ["text that reads backwards", (d) => (at(d, "text").footer = "Kauri ‮oiduts"), ["template-value template.json:text.footer"]],
  ["bank details in the terms", (d) => (at(d, "text").terms = "Pay to BSB 062-000 account 1234 5678"), ["template-value template.json:text.terms"]],
  ["a web address in the footer", (d) => (at(d, "text").footer = "Pay at www.pay.test"), ["template-value template.json:text.footer"]],
  ["a BTPS address in the terms", (d) => (at(d, "text").terms = "Send to pay$kauri.test"), ["template-value template.json:text.terms"]],
];

for (const [name, change, expected] of CASES) {
  test(`refused: ${name}`, async () => {
    const doc = await starter();
    change(doc);
    assert.deepEqual(said(doc), expected);
  });
}

test("contrast is WCAG's", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(0), "21");
});

test("init --template makes a template app that validates, and a template.json beside an integration is told", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ebill-template-"));
  try {
    const made = await initApp(join(dir, "kauri"), { template: true });
    assert.deepEqual(made.files, ["ebill.app.toml", "listing.toml", "template.json", "README.md"]);
    assert.deepEqual(await validateApp(made.dir), []);
    await rm(join(made.dir, TEMPLATE_FILE));
    assert.deepEqual(
      (await validateApp(made.dir)).map((failure) => `${failure.check} ${failure.path}`),
      ["file-missing template.json"],
    );
    const integration = await initApp(join(dir, "acme"));
    await writeFile(join(integration.dir, TEMPLATE_FILE), JSON.stringify(await starter()));
    assert.deepEqual(
      (await validateApp(integration.dir)).map((failure) => failure.check),
      ["template-kind"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a template asks for nothing: scopes, webhooks or browser sync are refused, as eBill refuses them", () => {
  const manifest = {
    app: { client_id: "app_000000000000000000000000", handle: "kauri", kind: "template", version: "1.0.0" },
    auth: { redirect_urls: ["https://example.com/auth/callback"] },
    access: { scopes: ["documents:read"] },
    webhooks: { api_version: "2026-12", url: "https://example.com/webhooks", topics: ["app.uninstalled"] },
    pricing: { model: "free" },
  };
  assert.deepEqual(
    validateAppManifest(manifest).map((failure) => `${failure.check} ${failure.path}`),
    ["template-access ebill.app.toml:access.scopes", "template-access ebill.app.toml:webhooks.url", "template-access ebill.app.toml:webhooks.topics"],
  );
  assert.deepEqual(validateAppManifest({ ...manifest, access: { scopes: [] }, webhooks: undefined }), []);
});
