// The guides' code samples, held to the SDK they show: every block fenced ```ts check is written out as its own module,
// with the inputs a guide takes for granted declared before it, and type-checked against @ebilladdress/app-sdk's source.
// A sample that no longer matches the SDK fails `pnpm --filter @ebilladdress/docs test`, so it fails CI.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PAGES = join(ROOT, "docs");
const OUT = join(ROOT, ".samples");

// What a guide's sample may use without writing it out: the values a server has to hand.
const PRELUDE = `import type { TokenSet } from "@ebilladdress/app-sdk";
declare const code: string;
declare const clientId: string;
declare const clientSecret: string;
declare const tokens: TokenSet;
declare const rawBody: Buffer;
declare const req: { headers: Record<string, string | string[] | undefined> };
declare const current: string;
declare const next: string;
declare const signatureHeader: string | undefined;
declare const deliveryHeader: string | undefined;
`;

async function pages(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (relative(PAGES, path).startsWith("reference")) continue;
      found.push(...(await pages(path)));
    } else if (entry.name.endsWith(".md")) found.push(path);
  }
  return found;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
let count = 0;
for (const page of await pages(PAGES)) {
  const text = await readFile(page, "utf8");
  for (const [index, match] of [...text.matchAll(/^```ts check\n([\s\S]*?)^```$/gm)].entries()) {
    // .mts: the docs package is not "type": "module" (Docusaurus's server bundle needs that), and a sample is a module.
    const name = `${relative(PAGES, page).replace(/[/.]/g, "_")}_${String(index + 1)}.mts`;
    const sample = match[1] ?? "";
    // A name the sample declares itself is its own, not the prelude's.
    const prelude = PRELUDE.split("\n").filter((line) => {
      const declared = /^declare const (\w+):/.exec(line)?.[1];
      return declared === undefined || !new RegExp(`\\b(const|let|var)\\s+(\\{[^}]*\\b${declared}\\b[^}]*\\}|${declared}\\b)`).test(sample);
    });
    await writeFile(join(OUT, name), `${prelude.join("\n")}\n${sample}\nexport {};\n`);
    count += 1;
  }
}
await writeFile(
  join(OUT, "tsconfig.json"),
  JSON.stringify({
    extends: "../../tsconfig.base.json",
    compilerOptions: { noEmit: true, noUnusedLocals: false, customConditions: ["@ebilladdress/source"] },
    include: ["*.mts"],
  }),
);
console.log(`check-samples: type-checking ${String(count)} samples`);
execFileSync(process.execPath, [fileURLToPath(import.meta.resolve("typescript/bin/tsc")), "-p", join(OUT, "tsconfig.json")], { stdio: "inherit" });
