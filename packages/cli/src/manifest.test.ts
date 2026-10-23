import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { SCOPE_NAMES, TOPIC_NAMES, requiredScope } from "@ebilladdress/app-sdk";
import { parse } from "smol-toml";
import { KNOWN_SCOPES, KNOWN_TOPICS, validateAppManifest, validateListing, type Failure } from "./manifest.ts";

type Doc = Record<string, unknown>;

function template(file: string): Doc {
  const source = readFileSync(new URL(`../templates/${file}`, import.meta.url), "utf8");
  return parse(source.replaceAll("{{handle}}", "acme-subscriptions").replaceAll("{{name}}", "Acme Subscriptions"));
}

function goodApp(): Doc {
  return template("ebill.app.toml");
}

function goodListing(): Doc {
  return template("listing.toml");
}

function section(doc: Doc, name: string): Doc {
  return doc[name] as Doc;
}

function field(doc: Doc, index = 0): Doc {
  const sections = section(doc, "settings").sections as Doc[];
  const found = (sections[0]?.fields as Doc[])[index];
  assert.ok(found);
  return found;
}

function checks(failures: Failure[]): string[] {
  return failures.map((failure) => `${failure.check} ${failure.path}`);
}

describe("ebill.app.toml", () => {
  test("the init template is clean", () => {
    assert.deepEqual(validateAppManifest(goodApp()), []);
  });

  const cases: [string, (doc: Doc) => void, string][] = [
    ["client id format", (d) => (section(d, "app").client_id = "app_SHORT"), "client-id-format ebill.app.toml:app.client_id"],
    ["handle format", (d) => (section(d, "app").handle = "-Acme"), "handle-format ebill.app.toml:app.handle"],
    ["handle too short", (d) => (section(d, "app").handle = "ab"), "handle-format ebill.app.toml:app.handle"],
    ["kind", (d) => (section(d, "app").kind = "plugin"), "allowed-value ebill.app.toml:app.kind"],
    ["version leading zero", (d) => (section(d, "app").version = "01.0.0"), "version-format ebill.app.toml:app.version"],
    ["version pre-release", (d) => (section(d, "app").version = "1.0.0-beta.1"), "version-format ebill.app.toml:app.version"],
    ["missing section", (d) => delete d.auth, "required ebill.app.toml:auth"],
    ["unknown key", (d) => (section(d, "app").colour = "red"), "unknown-key ebill.app.toml:app"],
    ["wrong type", (d) => (section(d, "sync").browser = "no"), "type ebill.app.toml:sync.browser"],
    ["redirect not https", (d) => (section(d, "auth").redirect_urls = ["http://example.com/cb"]), "https-url ebill.app.toml:auth.redirect_urls[0]"],
    ["redirect with fragment", (d) => (section(d, "auth").redirect_urls = ["https://example.com/cb#x"]), "https-url ebill.app.toml:auth.redirect_urls[0]"],
    ["no redirect urls", (d) => (section(d, "auth").redirect_urls = []), "count ebill.app.toml:auth.redirect_urls"],
    [
      "six redirect urls",
      (d) => (section(d, "auth").redirect_urls = [1, 2, 3, 4, 5, 6].map((n) => `https://example.com/${String(n)}`)),
      "count ebill.app.toml:auth.redirect_urls",
    ],
    [
      "duplicate redirect url",
      (d) => (section(d, "auth").redirect_urls = ["https://example.com/cb", "https://example.com/cb"]),
      "redirect-url-duplicate ebill.app.toml:auth.redirect_urls[1]",
    ],
    ["unknown scope", (d) => (section(d, "access").scopes = ["documents:read", "documents:delete"]), "scope-known ebill.app.toml:access.scopes[1]"],
    ["duplicate scope", (d) => (section(d, "access").scopes = ["documents:read", "documents:read"]), "scope-duplicate ebill.app.toml:access.scopes[1]"],
    ["webhook url not https", (d) => (section(d, "webhooks").url = "http://example.com/webhooks"), "https-url ebill.app.toml:webhooks.url"],
    ["webhook api version", (d) => (section(d, "webhooks").api_version = "2020-01"), "webhook-api-version ebill.app.toml:webhooks.api_version"],
    ["unknown topic", (d) => (section(d, "webhooks").topics = ["document.exploded"]), "topic-known ebill.app.toml:webhooks.topics[0]"],
    ["duplicate topic", (d) => (section(d, "webhooks").topics = ["app.installed", "app.installed"]), "topic-duplicate ebill.app.toml:webhooks.topics[1]"],
    ["topic without its scope", (d) => (section(d, "webhooks").topics = ["payment.accepted"]), "topic-scope ebill.app.toml:webhooks.topics[0]"],
    ["pricing model", (d) => (section(d, "pricing").model = "subscription"), "allowed-value ebill.app.toml:pricing.model"],
    ["settings key format", (d) => (field(d).key = "Terms"), "settings-key-format ebill.app.toml:settings.sections[0].fields[0].key"],
    ["settings label length", (d) => (field(d).label = "x".repeat(61)), "length ebill.app.toml:settings.sections[0].fields[0].label"],
    ["settings field type", (d) => (field(d).type = "colour"), "allowed-value ebill.app.toml:settings.sections[0].fields[0].type"],
    ["number default above max", (d) => (field(d).default = 500), "settings-default ebill.app.toml:settings.sections[0].fields[0].default"],
    ["number default wrong type", (d) => (field(d).default = "14"), "settings-default ebill.app.toml:settings.sections[0].fields[0].default"],
    ["min above max", (d) => Object.assign(field(d), { min: 50, max: 10, default: 20 }), "settings-options ebill.app.toml:settings.sections[0].fields[0].min"],
    [
      "select without options",
      (d) => Object.assign(field(d), { type: "select", default: "a", min: undefined, max: undefined }),
      "settings-options ebill.app.toml:settings.sections[0].fields[0].options",
    ],
    [
      "options on a text field",
      (d) => Object.assign(field(d), { type: "text", default: "x", min: undefined, max: undefined, options: [{ value: "a", label: "A" }] }),
      "settings-options ebill.app.toml:settings.sections[0].fields[0].options",
    ],
    [
      "min on a text field",
      (d) => Object.assign(field(d), { type: "text", default: "x", max: undefined }),
      "settings-options ebill.app.toml:settings.sections[0].fields[0].min",
    ],
    [
      "select default not an option",
      (d) => Object.assign(field(d), { type: "select", default: "c", min: undefined, max: undefined, options: [{ value: "a", label: "A" }] }),
      "settings-default ebill.app.toml:settings.sections[0].fields[0].default",
    ],
    [
      "boolean default",
      (d) => Object.assign(field(d), { type: "boolean", default: "yes", min: undefined, max: undefined }),
      "settings-default ebill.app.toml:settings.sections[0].fields[0].default",
    ],
    [
      "date default",
      (d) => Object.assign(field(d), { type: "date", default: "2027-02-30x", min: undefined, max: undefined }),
      "settings-default ebill.app.toml:settings.sections[0].fields[0].default",
    ],
    [
      "email default",
      (d) => Object.assign(field(d), { type: "email", default: "not-an-email", min: undefined, max: undefined }),
      "settings-default ebill.app.toml:settings.sections[0].fields[0].default",
    ],
    [
      "url default",
      (d) => Object.assign(field(d), { type: "url", default: "http://example.com", min: undefined, max: undefined }),
      "settings-default ebill.app.toml:settings.sections[0].fields[0].default",
    ],
    [
      "duplicate settings key across sections",
      (d) => {
        const settings = section(d, "settings");
        settings.sections = [...(settings.sections as Doc[]), { title: "More", fields: [{ key: "terms_days", type: "boolean", label: "Again" }] }];
      },
      "settings-key-unique ebill.app.toml:settings.sections[1].fields[0].key",
    ],
  ];

  for (const [name, mutate, expected] of cases) {
    test(`fails: ${name}`, () => {
      const doc = goodApp();
      mutate(doc);
      // Round-trip drops keys set to undefined, as TOML has no way to write them.
      const cleaned = JSON.parse(JSON.stringify(doc)) as Doc;
      const failures = validateAppManifest(cleaned);
      assert.ok(checks(failures).includes(expected), `expected ${expected}, got ${JSON.stringify(failures, null, 2)}`);
      for (const failure of failures) assert.ok(failure.reason.length > 0);
    });
  }

  test("valid settings of every type pass", () => {
    const doc = goodApp();
    section(doc, "settings").sections = [
      {
        title: "Everything",
        fields: [
          { key: "a_text", type: "text", label: "Text", default: "hi" },
          { key: "a_number", type: "number", label: "Number", default: 3, min: 1, max: 5 },
          { key: "a_bool", type: "boolean", label: "Bool", default: true },
          {
            key: "a_select",
            type: "select",
            label: "Select",
            default: "b",
            options: [
              { value: "a", label: "A" },
              { value: "b", label: "B" },
            ],
          },
          { key: "a_date", type: "date", label: "Date", default: "2027-02-28" },
          { key: "an_email", type: "email", label: "Email", default: "billing@example.com" },
          { key: "a_url", type: "url", label: "Link", default: "https://example.com" },
        ],
      },
    ];
    assert.deepEqual(validateAppManifest(doc), []);
  });

  test("optional sections may be left out", () => {
    const doc = goodApp();
    delete doc.webhooks;
    delete doc.settings;
    delete doc.sync;
    assert.deepEqual(validateAppManifest(doc), []);
  });

  test("scopes and topics come from the SDK, and every pair it defines is accepted", () => {
    assert.equal(KNOWN_SCOPES, SCOPE_NAMES);
    assert.equal(KNOWN_TOPICS, TOPIC_NAMES);
    const doc = goodApp();
    section(doc, "access").scopes = [...SCOPE_NAMES];
    section(doc, "webhooks").topics = [...TOPIC_NAMES];
    assert.deepEqual(validateAppManifest(doc), []);
    for (const topic of TOPIC_NAMES) {
      const scope = requiredScope(topic);
      const single = goodApp();
      section(single, "access").scopes = scope === null ? [] : [scope];
      section(single, "webhooks").topics = [topic];
      assert.deepEqual(validateAppManifest(single), [], topic);
    }
  });
});

describe("listing.toml", () => {
  test("the init template is clean", () => {
    assert.deepEqual(validateListing(goodListing()), []);
  });

  const cases: [string, (doc: Doc) => void, string][] = [
    ["name too long", (d) => (d.name = "x".repeat(41)), "length listing.toml:name"],
    ["empty name", (d) => (d.name = "  "), "length listing.toml:name"],
    ["tagline too long", (d) => (d.tagline = "x".repeat(81)), "length listing.toml:tagline"],
    ["category", (d) => (d.category = "games"), "allowed-value listing.toml:category"],
    ["too many keywords", (d) => (d.keywords = Array.from({ length: 11 }, (_, i) => `k${String(i)}`)), "count listing.toml:keywords"],
    ["keyword too long", (d) => (d.keywords = ["x".repeat(31)]), "length listing.toml:keywords[0]"],
    ["description too long", (d) => (d.description = "x".repeat(4001)), "length listing.toml:description"],
    ["description with HTML", (d) => (d.description = "Hello <script>alert(1)</script>"), "description-markdown listing.toml:description"],
    ["description with an image", (d) => (d.description = "Look ![shot](https://example.com/a.png)"), "description-markdown listing.toml:description"],
    ["release notes too long", (d) => (d.release_notes = "x".repeat(2001)), "length listing.toml:release_notes"],
    ["icon not https", (d) => (d.icon_url = "http://example.com/icon.png"), "https-url listing.toml:icon_url"],
    ["cover not a URL", (d) => (d.cover_url = "cover.png"), "https-url listing.toml:cover_url"],
    [
      "too many screenshots",
      (d) => (d.screenshot_urls = Array.from({ length: 9 }, (_, i) => `https://example.com/${String(i)}.png`)),
      "count listing.toml:screenshot_urls",
    ],
    ["screenshot not https", (d) => (d.screenshot_urls = ["ftp://example.com/a.png"]), "https-url listing.toml:screenshot_urls[0]"],
    ["support url", (d) => (d.support_url = "mailto:help@example.com"), "https-url listing.toml:support_url"],
    ["privacy policy missing", (d) => delete d.privacy_policy_url, "required listing.toml:privacy_policy_url"],
    ["terms url", (d) => (d.terms_url = "http://example.com/terms"), "https-url listing.toml:terms_url"],
    ["developer name too long", (d) => (d.developer_name = "x".repeat(81)), "length listing.toml:developer_name"],
    ["unknown key", (d) => (d.price = 10), "unknown-key listing.toml"],
  ];

  for (const [name, mutate, expected] of cases) {
    test(`fails: ${name}`, () => {
      const doc = goodListing();
      mutate(doc);
      const failures = validateListing(doc);
      assert.ok(checks(failures).includes(expected), `expected ${expected}, got ${JSON.stringify(failures, null, 2)}`);
    });
  }
});
