import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SCOPE_NAMES, TOPIC_NAMES, WEBHOOK_API_VERSIONS, isScope, isTopic, requiredScope } from "@ebilladdress/app-sdk";
import { TomlError, parse as parseToml } from "smol-toml";
import { z } from "zod";

export const APP_FILE = "ebill.app.toml";
export const LISTING_FILE = "listing.toml";

/** The CLI keeps no list of its own: scopes and topics come from the SDK. */
export const KNOWN_SCOPES = SCOPE_NAMES;
export const KNOWN_TOPICS = TOPIC_NAMES;

export const SETTING_TYPES = ["text", "number", "boolean", "select", "date", "email", "url"] as const;
export const LISTING_CATEGORIES = ["billing", "accounting", "payments", "documents", "productivity", "communication", "other"] as const;

/** Checks that need the network. eBill runs them when you deploy. */
export const SKIPPED_CHECKS = ["links open", "images can be fetched", "image sizes and dimensions"] as const;

export interface Failure {
  check: string;
  path: string;
  reason: string;
}

const CLIENT_ID = /^app_[a-z0-9]{24}$/;
const HANDLE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SETTING_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(ctx: z.RefinementCtx, check: string, reason: string, path: PropertyKey[] = []): void {
  ctx.addIssue({ code: "custom", message: reason, params: { check }, path });
}

function httpsProblem(value: string): string | undefined {
  if (!URL.canParse(value)) return "must be a full URL starting with https://";
  const url = new URL(value);
  if (url.protocol !== "https:") return "must use https://";
  if (url.username || url.password) return "must not contain a user name or password";
  return undefined;
}

const segmenter = new Intl.Segmenter();

function characters(value: string): number {
  let count = 0;
  for (const segment of segmenter.segment(value)) if (segment.segment) count++;
  return count;
}

const text = (min: number, max: number) =>
  z.string().superRefine((value, ctx) => {
    if (characters(value.trim()) < min || characters(value) > max)
      fail(ctx, "length", min === 0 ? `must be at most ${String(max)} characters` : `must be ${String(min)} to ${String(max)} characters`);
  });

const https = z.string().superRefine((value, ctx) => {
  const problem = httpsProblem(value);
  if (problem) fail(ctx, "https-url", problem);
});

const count = <T extends z.ZodType>(item: T, min: number, max: number) =>
  z.array(item).superRefine((value, ctx) => {
    if (value.length < min || value.length > max) {
      fail(ctx, "count", min === 0 ? `must have at most ${String(max)} entries` : `must have ${String(min)} to ${String(max)} entries`);
    }
  });

function noDuplicates(check: string) {
  return (values: string[], ctx: z.RefinementCtx): void => {
    values.forEach((value, index) => {
      if (values.indexOf(value) !== index) fail(ctx, check, `"${value}" is listed more than once`, [index]);
    });
  };
}

const optionSchema = z.strictObject({ value: z.string().min(1), label: text(1, 60) });

const fieldSchema = z
  .strictObject({
    key: z.string().superRefine((value, ctx) => {
      if (!SETTING_KEY.test(value)) fail(ctx, "settings-key-format", "must start with a lowercase letter and use only a-z, 0-9 and _, up to 40 characters");
    }),
    type: z.enum(SETTING_TYPES),
    label: text(1, 60),
    help: text(0, 200).optional(),
    required: z.boolean().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    options: z.array(optionSchema).optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === "select") {
      if (!field.options?.length) fail(ctx, "settings-options", "a select field needs at least one entry in options", ["options"]);
      field.options?.forEach((option, index, all) => {
        if (all.findIndex((other) => other.value === option.value) !== index) {
          fail(ctx, "settings-options", `option value "${option.value}" is listed more than once`, ["options", index, "value"]);
        }
      });
    } else if (field.options !== undefined) {
      fail(ctx, "settings-options", "only select fields take options", ["options"]);
    }
    if (field.type !== "number" && (field.min !== undefined || field.max !== undefined)) {
      fail(ctx, "settings-options", "min and max only apply to number fields", [field.min === undefined ? "max" : "min"]);
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) fail(ctx, "settings-options", "min must not be greater than max", ["min"]);
    if (field.default !== undefined) {
      const problem = defaultProblem(field);
      if (problem) fail(ctx, "settings-default", problem, ["default"]);
    }
  });

type Field = z.infer<typeof fieldSchema>;

function defaultProblem(field: Field): string | undefined {
  const value = field.default;
  switch (field.type) {
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number for a number field";
      if (field.min !== undefined && value < field.min) return `must be at least min (${String(field.min)})`;
      if (field.max !== undefined && value > field.max) return `must be at most max (${String(field.max)})`;
      return undefined;
    case "boolean":
      return typeof value === "boolean" ? undefined : "must be true or false for a boolean field";
    case "select":
      return typeof value === "string" && field.options?.some((option) => option.value === value) ? undefined : "must be one of the option values";
    case "date":
      return typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
        ? undefined
        : 'must be a date written as a quoted string, "YYYY-MM-DD"';
    case "email":
      return typeof value === "string" && EMAIL.test(value) ? undefined : "must be an email address";
    case "url":
      return typeof value === "string" ? httpsProblem(value) : "must be an https URL";
    case "text":
      return typeof value === "string" ? undefined : "must be a string for a text field";
  }
}

const appSchema = z.strictObject({
  app: z.strictObject({
    client_id: z.string().superRefine((value, ctx) => {
      if (!CLIENT_ID.test(value)) fail(ctx, "client-id-format", 'must be "app_" followed by 24 lowercase letters or digits, as issued at registration');
    }),
    handle: z.string().superRefine((value, ctx) => {
      if (!HANDLE.test(value)) fail(ctx, "handle-format", "must be 3 to 50 lowercase letters, digits or hyphens, starting and ending with a letter or digit");
    }),
    kind: z.enum(["integration", "template"]),
    version: z.string().superRefine((value, ctx) => {
      if (!VERSION.test(value)) fail(ctx, "version-format", "must be x.y.z with no leading zeros and no pre-release part, for example 1.0.0");
    }),
  }),
  auth: z.strictObject({
    redirect_urls: count(
      z.string().superRefine((value, ctx) => {
        const problem = httpsProblem(value) ?? (value.includes("#") ? "must not contain a #fragment" : undefined);
        if (problem) fail(ctx, "https-url", problem);
      }),
      1,
      5,
    ).superRefine(noDuplicates("redirect-url-duplicate")),
  }),
  access: z.strictObject({
    scopes: z
      .array(z.string())
      .superRefine((values, ctx) => {
        values.forEach((value, index) => {
          if (!isScope(value)) fail(ctx, "scope-known", `"${value}" is not a scope. Known scopes: ${KNOWN_SCOPES.join(", ")}`, [index]);
        });
      })
      .superRefine(noDuplicates("scope-duplicate")),
  }),
  webhooks: z
    .strictObject({
      api_version: z.string().superRefine((value, ctx) => {
        if (!(WEBHOOK_API_VERSIONS as readonly string[]).includes(value)) {
          fail(ctx, "webhook-api-version", `must be one of: ${WEBHOOK_API_VERSIONS.join(", ")}`);
        }
      }),
      url: https,
      topics: count(z.string(), 1, KNOWN_TOPICS.length)
        .superRefine((values, ctx) => {
          values.forEach((value, index) => {
            if (!isTopic(value)) fail(ctx, "topic-known", `"${value}" is not a topic. Known topics: ${KNOWN_TOPICS.join(", ")}`, [index]);
          });
        })
        .superRefine(noDuplicates("topic-duplicate")),
    })
    .optional(),
  settings: z
    .strictObject({
      sections: z.array(z.strictObject({ title: text(1, 60), fields: count(fieldSchema, 1, 50) })),
    })
    .optional(),
  sync: z.strictObject({ browser: z.boolean() }).optional(),
  pricing: z.strictObject({ model: z.enum(["free", "one_time"]) }),
});

const listingSchema = z
  .strictObject({
    name: text(1, 40),
    tagline: text(1, 80),
    category: z.enum(LISTING_CATEGORIES),
    keywords: count(text(1, 30), 0, 10).optional(),
    description: text(1, 4000),
    release_notes: text(0, 2000).optional(),
    icon_url: https,
    cover_url: https,
    screenshot_urls: count(https, 0, 8).optional(),
    support_url: https,
    privacy_policy_url: https,
    terms_url: https,
    developer_name: text(1, 80),
  })
  .superRefine((listing, ctx) => {
    if (/<\/?[a-z][^>]*>/i.test(listing.description)) fail(ctx, "description-markdown", "must not contain HTML; use markdown", ["description"]);
    if (/!\[[^\]]*\]\(/.test(listing.description)) fail(ctx, "description-markdown", "must not embed images; use screenshot_urls", ["description"]);
  });

function formatPath(file: string, path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path) out += typeof part === "number" ? `[${String(part)}]` : `${out ? "." : ""}${String(part)}`;
  return out ? `${file}:${out}` : file;
}

function fromZod(file: string, error: z.ZodError): Failure[] {
  return error.issues.map((issue) => {
    const path = formatPath(file, issue.path);
    switch (issue.code) {
      case "custom": {
        const check = (issue.params as { check?: unknown } | undefined)?.check;
        return { check: typeof check === "string" ? check : "schema", path, reason: issue.message };
      }
      case "invalid_type":
        return issue.input === undefined
          ? { check: "required", path, reason: "is required" }
          : { check: "type", path, reason: `must be ${issue.expected === "array" ? "a list" : `a ${issue.expected}`}` };
      case "unrecognized_keys":
        return { check: "unknown-key", path, reason: `unknown key${issue.keys.length > 1 ? "s" : ""}: ${issue.keys.join(", ")}` };
      case "invalid_value":
        return { check: "allowed-value", path, reason: `must be one of: ${issue.values.map(String).join(", ")}` };
      default:
        return { check: "schema", path, reason: issue.message };
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function at(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) current = isRecord(current) ? current[key] : undefined;
  return current;
}

/** Rules that span sections. Run on the raw file so they report even when other parts have errors. */
function crossChecks(raw: unknown): Failure[] {
  const failures: Failure[] = [];
  const granted = new Set(strings(at(raw, "access", "scopes")));
  const topics = at(raw, "webhooks", "topics");
  if (Array.isArray(topics)) {
    topics.forEach((topic: unknown, index) => {
      if (typeof topic !== "string" || !isTopic(topic)) return;
      const scope = requiredScope(topic);
      if (scope !== null && !granted.has(scope)) {
        failures.push({
          check: "topic-scope",
          path: formatPath(APP_FILE, ["webhooks", "topics", index]),
          reason: `"${topic}" needs the "${scope}" scope in [access] scopes`,
        });
      }
    });
  }
  const seen = new Map<string, string>();
  const sections = at(raw, "settings", "sections");
  if (Array.isArray(sections)) {
    sections.forEach((section: unknown, s) => {
      const fields = at(section, "fields");
      if (!Array.isArray(fields)) return;
      fields.forEach((field: unknown, f) => {
        const key = at(field, "key");
        if (typeof key !== "string") return;
        const path = formatPath(APP_FILE, ["settings", "sections", s, "fields", f, "key"]);
        const first = seen.get(key);
        if (first) failures.push({ check: "settings-key-unique", path, reason: `"${key}" is already used at ${first}` });
        else seen.set(key, path);
      });
    });
  }
  return failures;
}

async function load(dir: string, file: string): Promise<{ raw: unknown } | { failure: Failure }> {
  let source: string;
  try {
    source = await readFile(join(dir, file), "utf8");
  } catch {
    return { failure: { check: "file-missing", path: file, reason: `${file} was not found. Run "ebill app init" to create it.` } };
  }
  try {
    return { raw: parseToml(source) };
  } catch (error) {
    const reason =
      error instanceof TomlError ? `line ${String(error.line)}, column ${String(error.column)}: ${error.message.split("\n")[0] ?? ""}` : String(error);
    return { failure: { check: "toml-syntax", path: file, reason } };
  }
}

export function validateAppManifest(raw: unknown): Failure[] {
  const result = appSchema.safeParse(raw, { reportInput: true });
  return [...(result.success ? [] : fromZod(APP_FILE, result.error)), ...crossChecks(raw)];
}

export function validateListing(raw: unknown): Failure[] {
  const result = listingSchema.safeParse(raw, { reportInput: true });
  return result.success ? [] : fromZod(LISTING_FILE, result.error);
}

/** Every local check on an app directory. An empty list means it is ready to deploy, as far as can be told offline. */
export async function validateApp(dir: string): Promise<Failure[]> {
  const [app, listing] = await Promise.all([load(dir, APP_FILE), load(dir, LISTING_FILE)]);
  return [...("failure" in app ? [app.failure] : validateAppManifest(app.raw)), ...("failure" in listing ? [listing.failure] : validateListing(listing.raw))];
}
