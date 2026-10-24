// A template app's template.json: how a document looks, never what it says. Format 1. eBill checks every push with the
// same rules, names, paths and words, and its renderer draws documents from it on the receiver's device.
//
// A template may choose: the order of the sections, colours and a font from eBill's list, where the sender's logo goes,
// labels, how lines and totals are styled, and static terms and footer text. There is no field that could change an
// amount, a date, who it is from or to, payment details or the verified badge; none that hides a section carrying a
// signed field; none that names anything to fetch; and nothing that is run. Unknown keys are refused.
import { z } from "zod";
import type { Failure } from "./manifest.ts";

export const TEMPLATE_FILE = "template.json";
export const TEMPLATE_FORMAT = 1;
/** The fonts eBill draws documents in, served by eBill: nothing is fetched from anywhere else. */
export const TEMPLATE_FONTS = ["geist", "source-serif-4", "atkinson-hyperlegible-next", "geist-mono"] as const;
/** The kinds that carry a template today. */
export const TEMPLATE_KINDS = ["invoice", "receipt"] as const;
export const TEMPLATE_SECTIONS = ["header", "parties", "details", "lines", "totals", "payment", "notes", "terms", "footer"] as const;
/** The sections that carry signed fields: every template shows each of them. */
export const REQUIRED_SECTIONS = ["header", "parties", "details", "lines", "totals", "payment", "notes"] as const;
export const TEMPLATE_LABELS = [
  "title",
  "from",
  "to",
  "number",
  "issued",
  "due",
  "description",
  "quantity",
  "unitPrice",
  "tax",
  "lineTotal",
  "subtotal",
  "taxTotal",
  "total",
  "amountDue",
  "paid",
  "notes",
  "payment",
] as const;
/** The most a template.json may be, as JSON. */
export const MAX_TEMPLATE_BYTES = 16 * 1024;

const COLOUR = /^#[0-9a-f]{6}$/;

/** Printable text and line breaks, and no angle brackets: words, never markup. */
function isWords(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if ((code < 0x20 && char !== "\n") || code === 0x7f || char === "<" || char === ">") return false;
  }
  return true;
}

const words = (min: number, max: number) =>
  z
    .string()
    .min(min, { message: `must be ${String(min)} to ${String(max)} characters` })
    .max(max, { message: `must be ${String(min)} to ${String(max)} characters` })
    .refine(isWords, { message: "must be plain text: no markup and no control characters" });
const colour = z.string().regex(COLOUR, { message: 'must be a colour like "#1a2b3c", in lower case' });

const templateSchema = z.strictObject({
  format: z.literal(TEMPLATE_FORMAT),
  kinds: z.array(z.enum(TEMPLATE_KINDS)).min(1).max(TEMPLATE_KINDS.length),
  page: z.strictObject({
    font: z.enum(TEMPLATE_FONTS),
    size: z.enum(["small", "normal", "large"]),
    density: z.enum(["compact", "comfortable"]),
    background: colour,
    text: colour,
    muted: colour,
    accent: colour,
  }),
  logo: z.strictObject({ position: z.enum(["top-left", "top-center", "top-right", "none"]), size: z.enum(["small", "medium", "large"]) }),
  // At most one of each; which must be there is said by crossChecks, naming them.
  sections: z.array(z.enum(TEMPLATE_SECTIONS)).max(TEMPLATE_SECTIONS.length * 2),
  labels: z.partialRecord(z.enum(TEMPLATE_LABELS), words(1, 40)),
  lines: z.strictObject({ style: z.enum(["plain", "striped", "boxed"]), header: z.enum(["plain", "accent"]) }),
  totals: z.strictObject({ style: z.enum(["plain", "boxed", "accent"]) }),
  text: z.strictObject({ terms: words(1, 2000).optional(), footer: words(1, 300).optional() }).optional(),
});

export type Template = z.infer<typeof templateSchema>;

function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path) out += typeof part === "number" ? `[${String(part)}]` : `${out ? "." : ""}${String(part)}`;
  return out ? `${TEMPLATE_FILE}:${out}` : TEMPLATE_FILE;
}

function fromZod(error: z.ZodError): Failure[] {
  return error.issues.map((issue) => {
    const path = formatPath(issue.path);
    switch (issue.code) {
      case "invalid_type":
        return issue.input === undefined
          ? { check: "required", path, reason: "is required" }
          : { check: "type", path, reason: `must be ${issue.expected === "array" ? "a list" : `a ${issue.expected}`}` };
      case "unrecognized_keys":
        return { check: "unknown-key", path, reason: `unknown key${issue.keys.length > 1 ? "s" : ""}: ${issue.keys.join(", ")}` };
      case "invalid_value":
        return { check: "allowed-value", path, reason: `must be one of: ${issue.values.map(String).join(", ")}` };
      case "invalid_key":
        return { check: "unknown-key", path, reason: `must be one of: ${TEMPLATE_LABELS.join(", ")}` };
      default:
        return { check: "template-value", path, reason: issue.message };
    }
  });
}

function luminance(hex: string): number {
  const channel = (at: number): number => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The WCAG contrast ratio of two colours. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function crossChecks(template: Template): Failure[] {
  const failures: Failure[] = [];
  const seen = new Set<string>();
  template.sections.forEach((section, index) => {
    if (seen.has(section)) failures.push({ check: "section-once", path: formatPath(["sections", index]), reason: `"${section}" is listed twice` });
    seen.add(section);
  });
  const missing = REQUIRED_SECTIONS.filter((section) => !seen.has(section));
  if (missing.length > 0) {
    failures.push({
      check: "section-required",
      path: formatPath(["sections"]),
      reason: `must show every section with signed fields; missing: ${missing.join(", ")}`,
    });
  }
  for (const section of ["terms", "footer"] as const) {
    if (seen.has(section) && template.text?.[section] === undefined) {
      failures.push({ check: "section-text", path: formatPath(["text", section]), reason: `is required when sections lists "${section}"` });
    }
  }
  const { page } = template;
  for (const [key, least] of [
    ["text", 4.5],
    ["muted", 4.5],
    ["accent", 3],
  ] as const) {
    const ratio = contrast(page[key], page.background);
    if (ratio < least) {
      failures.push({
        check: "contrast",
        path: formatPath(["page", key]),
        reason: `must contrast with background at least ${String(least)}:1; it is ${ratio.toFixed(2)}:1`,
      });
    }
  }
  return failures;
}

/** What is wrong with `raw` as a template.json; none when it is one eBill draws. */
export function validateTemplate(raw: unknown): Failure[] {
  if (JSON.stringify(raw ?? null).length > MAX_TEMPLATE_BYTES) {
    return [{ check: "template-size", path: TEMPLATE_FILE, reason: `must be at most ${String(MAX_TEMPLATE_BYTES)} bytes as JSON` }];
  }
  const result = templateSchema.safeParse(raw, { reportInput: true });
  return result.success ? crossChecks(result.data) : fromZod(result.error);
}
