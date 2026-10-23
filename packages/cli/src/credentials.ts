import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_API_URL = "https://api.ebilladdress.com";

/** Where the CLI keeps its sign-in, and what it reads from the environment. */
export interface Place {
  env: Record<string, string | undefined>;
  /** Overrides the config folder: tests. */
  configDir?: string | undefined;
}

export interface Credentials {
  apiUrl: string;
  token: string;
}

const TOKEN = /^ebdt_[A-Za-z0-9_-]{43}$/;

function folder(place: Place): string {
  if (place.configDir) return place.configDir;
  const xdg = place.env.XDG_CONFIG_HOME;
  return join(xdg && xdg !== "" ? xdg : join(homedir(), ".config"), "ebill");
}

export const credentialsFile = (place: Place): string => join(folder(place), "credentials.json");

/** The API to talk to: EBILL_API_URL, then the default. */
export function apiUrlOf(place: Place): string {
  const url = place.env.EBILL_API_URL;
  return (url && url !== "" ? url : DEFAULT_API_URL).replace(/\/+$/, "");
}

/**
 * The sign-in to use: EBILL_TOKEN (for CI, where nobody can approve a code), else the one `ebill login` saved for
 * this API. Undefined when there is neither.
 */
export async function readCredentials(place: Place): Promise<Credentials | undefined> {
  const apiUrl = apiUrlOf(place);
  const fromEnv = place.env.EBILL_TOKEN;
  if (fromEnv && TOKEN.test(fromEnv)) return { apiUrl, token: fromEnv };
  try {
    const saved: unknown = JSON.parse(await readFile(credentialsFile(place), "utf8"));
    if (typeof saved !== "object" || saved === null) return undefined;
    const { apiUrl: savedUrl, token } = saved as Record<string, unknown>;
    return savedUrl === apiUrl && typeof token === "string" && TOKEN.test(token) ? { apiUrl, token } : undefined;
  } catch {
    return undefined;
  }
}

/** Saved readable by this user alone. */
export async function saveCredentials(place: Place, credentials: Credentials): Promise<string> {
  const file = credentialsFile(place);
  await mkdir(folder(place), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify({ ...credentials, savedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  return file;
}

export async function forgetCredentials(place: Place): Promise<boolean> {
  try {
    await rm(credentialsFile(place));
    return true;
  } catch {
    return false;
  }
}
