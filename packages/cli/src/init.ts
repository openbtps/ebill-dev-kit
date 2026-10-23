import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { APP_FILE, LISTING_FILE } from "./manifest.ts";

export const INIT_FILES = [APP_FILE, LISTING_FILE, "server.ts", "README.md"] as const;

const TEMPLATES = new URL("../templates/", import.meta.url);
const HANDLE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export class InitConflictError extends Error {
  override readonly name = "InitConflictError";
  readonly existing: string[];

  constructor(existing: string[]) {
    super(`Not overwriting existing files: ${existing.join(", ")}`);
    this.existing = existing;
  }
}

/** A valid handle from a folder name, or `my-app` when nothing usable is left. */
export function handleFromName(name: string): string {
  const handle = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return HANDLE.test(handle) ? handle : "my-app";
}

function displayName(handle: string): string {
  return handle
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .slice(0, 40)
    .trim();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface InitOptions {
  handle?: string;
}

/** Write the starter files into `dir`. Writes nothing if any of them already exists. */
export async function initApp(dir: string, options: InitOptions = {}): Promise<{ dir: string; files: string[] }> {
  const target = resolve(dir);
  const handle = options.handle ?? handleFromName(basename(target));
  if (!HANDLE.test(handle)) throw new TypeError(`"${handle}" is not a valid handle: use 3 to 50 lowercase letters, digits or hyphens.`);

  const existing: string[] = [];
  for (const file of INIT_FILES) if (await exists(join(target, file))) existing.push(file);
  if (existing.length > 0) throw new InitConflictError(existing);

  await mkdir(target, { recursive: true });
  const values: Record<string, string> = { handle, name: displayName(handle) };
  for (const file of INIT_FILES) {
    const template = await readFile(new URL(file, TEMPLATES), "utf8");
    const content = template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
    await writeFile(join(target, file), content, { flag: "wx" });
  }
  return { dir: target, files: [...INIT_FILES] };
}
