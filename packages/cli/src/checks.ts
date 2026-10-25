// Every check an app's files go through, by the name a failure carries (`{ check, path, reason }`): what it means and
// how to fix it. `ebill app validate` runs the "cli" and "both" ones; eBill runs "both" and its own ("ebill") when you
// deploy. The developer docs' checks page is generated from this. checks.test.ts holds it to the names the code uses.
export type CheckWhere = "cli" | "both" | "ebill";

export interface CheckInfo {
  where: CheckWhere;
  /** What failed, in one line. */
  what: string;
  /** How to fix it. */
  fix: string;
}

export const CHECKS = {
  // Reading the files.
  "file-missing": { where: "cli", what: "A file the app needs isn't there.", fix: "Run `ebill app init` to write the starter files, or add the missing one." },
  "toml-syntax": { where: "cli", what: "A TOML file can't be read.", fix: "Fix the syntax at the line the reason names." },
  "json-syntax": { where: "cli", what: "`template.json` can't be read as JSON.", fix: "Fix the syntax at the place the reason names." },
  "file-size": {
    where: "ebill",
    what: "A pushed file is larger than eBill accepts (64 KB).",
    fix: "Shorten it: the listing's description and release notes are usually the cause.",
  },
  "file-format": {
    where: "ebill",
    what: "A pushed file isn't the file as the CLI read it.",
    fix: "Push with `ebill app deploy` rather than calling the API by hand.",
  },

  // Shape.
  required: { where: "both", what: "A key that must be there is missing.", fix: "Add it. `ebill app init` writes every required key with a comment." },
  type: {
    where: "both",
    what: "A value is the wrong kind: text where a number belongs, a single value where a list does.",
    fix: "Write it as the reason says.",
  },
  "unknown-key": { where: "both", what: "A key eBill doesn't know, often a typo.", fix: "Correct its spelling, or remove it." },
  "allowed-value": { where: "both", what: "A value isn't one of those allowed.", fix: "Use one of the values the reason lists." },
  schema: { where: "both", what: "A value breaks a rule not named more precisely.", fix: "Read the reason; the app contract has the full rules." },
  length: { where: "both", what: "Text is too short or too long.", fix: "Bring it within the limits the reason gives." },
  count: { where: "both", what: "A list has too few or too many entries.", fix: "Bring it within the limits the reason gives." },
  "https-url": { where: "both", what: "An address isn't a full https URL.", fix: "Use `https://…`, with no `#fragment`." },

  // ebill.app.toml.
  "client-id-format": {
    where: "both",
    what: "`[app] client_id` isn't a client id eBill issued.",
    fix: "Copy it from the developer portal: `app_` and 24 letters or digits.",
  },
  "handle-format": {
    where: "both",
    what: "`[app] handle` breaks the handle rules.",
    fix: "Use 3 to 50 lowercase letters, digits or hyphens, starting and ending with a letter or digit.",
  },
  "version-format": { where: "both", what: "`[app] version` isn't `x.y.z`.", fix: "Write it like `1.2.0`: no leading zeros, no pre-release part." },
  "app-registered": {
    where: "ebill",
    what: "The handle or kind isn't the one the app was registered with.",
    fix: "Use the handle and kind the developer portal shows for this client id.",
  },
  "version-increased": { where: "ebill", what: "This version was pushed already, or isn't higher than the app's last.", fix: "Raise `[app] version`." },
  "redirect-url-duplicate": { where: "both", what: "A redirect URL is listed twice.", fix: "List each once." },
  "scope-known": { where: "both", what: "A scope eBill doesn't have.", fix: "Use one of the scopes the reason lists." },
  "scope-duplicate": { where: "both", what: "A scope is listed twice.", fix: "List each once." },
  "webhook-api-version": { where: "both", what: "`[webhooks] api_version` isn't one eBill sends.", fix: "Use one of the versions the reason lists." },
  "topic-known": { where: "both", what: "A webhook topic eBill doesn't have.", fix: "Use one of the topics the reason lists." },
  "topic-duplicate": { where: "both", what: "A webhook topic is listed twice.", fix: "List each once." },
  "topic-scope": {
    where: "both",
    what: "A webhook topic needs a scope `[access]` doesn't ask for.",
    fix: "Add the scope the reason names to `[access] scopes`, or drop the topic.",
  },
  "settings-key-format": {
    where: "both",
    what: "A settings field's `key` breaks the key rules.",
    fix: "Start with a lowercase letter and use only `a-z`, `0-9` and `_`, up to 40 characters.",
  },
  "settings-key-unique": { where: "both", what: "Two settings fields share a `key`.", fix: "Give each field its own key, across all sections." },
  "settings-options": {
    where: "both",
    what: "A settings field's `options`, `min` or `max` don't fit its type.",
    fix: "Only `select` takes `options`, at least one, each value once; only `number` takes `min` and `max`, with `min` not above `max`.",
  },
  "settings-default": { where: "both", what: "A settings field's `default` isn't valid for that field.", fix: "Give a default its own field accepts." },
  "sync-key": {
    where: "both",
    what: "`[sync] public_key` is missing, unused, or not a key eBill can seal to.",
    fix: "With `browser = true`, give an RSA public key of the size the reason gives; with `browser = false`, remove it.",
  },
  "sync-scope": { where: "both", what: "`documents:received:sync` is listed in `[access]`.", fix: "Remove it: `[sync] browser = true` grants it." },

  // listing.toml.
  "description-markdown": {
    where: "both",
    what: "The listing's description contains HTML.",
    fix: "Write it in markdown: headings, lists, links, bold and italic.",
  },
  "link-opens": { where: "ebill", what: "A support, privacy or terms link doesn't open.", fix: "Make sure the page answers at that address, then push again." },
  "image-fetch": {
    where: "ebill",
    what: "A listing image couldn't be fetched, or is over 5 MB.",
    fix: "Make sure the image answers at its https address, at most 5 MB.",
  },
  "image-type": { where: "ebill", what: "A listing image isn't a PNG, JPEG or WebP, by its own bytes.", fix: "Save it as PNG, JPEG or WebP." },
  "image-size": {
    where: "ebill",
    what: "A listing image is the wrong size.",
    fix: "Icon 512 × 512; cover 1600 × 900; each screenshot 640 × 400 to 3840 × 2400.",
  },

  // template.json.
  "template-kind": { where: "both", what: "A `template.json` beside an integration.", fix: 'Remove it, or make the app `kind = "template"`.' },
  "template-access": {
    where: "both",
    what: "A template asks for scopes, webhooks or browser sync. It reads nothing and is sent nothing.",
    fix: "Empty `[access] scopes`, remove `[webhooks]`'s url and topics, and set `[sync] browser = false` or remove `[sync]`.",
  },
  "template-size": { where: "both", what: "`template.json` is over 16 KB.", fix: "Shorten its labels and text." },
  "template-value": {
    where: "both",
    what: "A template value breaks a rule: a colour, a label, or words that may not appear.",
    fix: "Read the reason. Words may hold no number of four or more digits, no web, email or BTPS address, and no hidden characters.",
  },
  contrast: { where: "both", what: "A text colour doesn't contrast enough with the background.", fix: "Text and muted text need 4.5:1, the accent 3:1." },
  "section-once": { where: "both", what: "A section is listed twice.", fix: "List each section once." },
  "section-required": { where: "both", what: "A required section is missing.", fix: "List every section but `terms` and `footer`." },
  "section-text": { where: "both", what: "`terms` or `footer` is listed with no text for it.", fix: "Add `text.terms` or `text.footer`, or drop the section." },
} as const satisfies Record<string, CheckInfo>;

export type CheckName = keyof typeof CHECKS;
