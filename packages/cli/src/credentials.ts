import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

/** An EBILL_API_URL the CLI will not send a sign-in to. */
export class ApiUrlError extends Error {
  override readonly name = "ApiUrlError";
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The API to talk to: EBILL_API_URL, then the default. Https only, but for this computer: a token never crosses a network in the clear. */
export function apiUrlOf(place: Place): string {
  const given = place.env.EBILL_API_URL;
  const url = (given && given !== "" ? given : DEFAULT_API_URL).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiUrlError(`EBILL_API_URL "${url}" is not a URL.`);
  }
  const local = parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !local) throw new ApiUrlError(`EBILL_API_URL must be https (http only for localhost): "${url}" was not used.`);
  if (parsed.username !== "" || parsed.password !== "") throw new ApiUrlError("EBILL_API_URL must not carry a user name or password.");
  return url;
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

/**
 * Saved readable by this user alone, whatever was there before: a mode only applies to a file as it is made, so the
 * sign-in goes into a new file and replaces the old one, and the folder is closed to others too.
 */
export async function saveCredentials(place: Place, credentials: Credentials): Promise<string> {
  const dir = folder(place);
  const file = credentialsFile(place);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const fresh = join(dir, `.credentials-${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(fresh, `${JSON.stringify({ ...credentials, savedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(fresh, file);
  } catch (error) {
    await rm(fresh, { force: true });
    throw error;
  }
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
