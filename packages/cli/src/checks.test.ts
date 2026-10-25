// The checks catalogue (checks.ts) against the code: every check the CLI can report is described, and every check said
// to be the CLI's is one it reports. eBill's own ("ebill") are held to eBill's code there, not here.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { CHECKS } from "./checks.ts";

const SOURCE = new URL("./", import.meta.url);
const NAMED = [/check: "([a-z-]+)"/g, /fail\(ctx, "([a-z-]+)"/g, /noDuplicates\("([a-z-]+)"\)/g];

async function namesInCode(): Promise<Set<string>> {
  const names = new Set<string>();
  for (const file of await readdir(SOURCE)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts") || file === "checks.ts") continue;
    const text = await readFile(new URL(file, SOURCE), "utf8");
    for (const pattern of NAMED) for (const match of text.matchAll(pattern)) names.add(match[1] ?? "");
  }
  return names;
}

test("every check the CLI reports is in the catalogue, with what it means and how to fix it", async () => {
  const missing = [...(await namesInCode())].filter((name) => !Object.hasOwn(CHECKS, name));
  assert.deepEqual(missing, []);
  for (const [name, info] of Object.entries(CHECKS)) assert.ok(info.what.length > 0 && info.fix.length > 0, name);
});

test("every check the catalogue says the CLI runs is one it reports", async () => {
  const inCode = await namesInCode();
  const stale = Object.entries(CHECKS)
    .filter(([name, info]) => info.where !== "ebill" && !inCode.has(name))
    .map(([name]) => name);
  assert.deepEqual(stale, []);
});
