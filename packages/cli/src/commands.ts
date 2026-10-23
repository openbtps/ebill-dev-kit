// The commands that talk to eBill: signing in (the OAuth 2.0 device grant, RFC 8628), and pushing, listing and
// releasing the app in a folder, found in the organisation's apps by the client id in its ebill.app.toml.
import { hostname } from "node:os";
import { ApiUrlError, apiUrlOf, forgetCredentials, readCredentials, saveCredentials, credentialsFile, type Place } from "./credentials.ts";
import { DeveloperApi, DeveloperApiError, type AppVersion, type CheckFailure, type DeveloperApp } from "./developer-api.ts";
import { APP_FILE, loadAppFiles } from "./manifest.ts";

/** What a command needs from where it runs; everything but the network and the clock is the CLI's own. */
export interface Context {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  place: Place;
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  /** 0 done, 1 something to fix. */
  fail: () => void;
}

/** Text from eBill, printable: no control characters, so an answer can never drive the terminal. */
export const isControl = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
};
export const plain = (text: string): string => Array.from(text, (character) => (isControl(character) ? " " : character)).join("");

export function formatCheckFailures(failures: readonly CheckFailure[]): string {
  return failures.map((failure) => `  ${plain(failure.path)}  (${plain(failure.check)})\n    ${plain(failure.reason)}\n`).join("");
}

function told(context: Context, error: unknown): void {
  if (error instanceof ApiUrlError) {
    context.stderr(`${error.message}\n`);
    context.fail();
    return;
  }
  if (!(error instanceof DeveloperApiError)) throw error;
  const reference = error.reference ? `, reference ${plain(error.reference)}` : "";
  context.stderr(`${plain(error.message)} (${plain(error.error)}${reference})\n`);
  if (error.status === 401) context.stderr('Run "ebill login" to sign in again.\n');
  context.fail();
}

/** Runs `work`, telling the developer what eBill refused. */
async function talking(context: Context, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    told(context, error);
  }
}

async function signedIn(context: Context): Promise<DeveloperApi | undefined> {
  let credentials: Awaited<ReturnType<typeof readCredentials>>;
  try {
    credentials = await readCredentials(context.place);
  } catch (error) {
    told(context, error);
    return undefined;
  }
  if (!credentials) {
    context.stderr('Not signed in to eBill. Run "ebill login" (or set EBILL_TOKEN for CI).\n');
    context.fail();
    return undefined;
  }
  return new DeveloperApi(credentials.apiUrl, context.fetch, credentials.token);
}

export async function login(context: Context): Promise<void> {
  await talking(context, async () => {
    const api = new DeveloperApi(apiUrlOf(context.place), context.fetch);
    const started = await api.startLogin();
    context.stdout(
      `To sign in, open this page in a browser where you're signed in to eBill:\n\n  ${plain(started.verificationUriComplete)}\n\n` +
        `Check it shows this code, then approve it: ${plain(started.userCode)}\n\nWaiting for you to approve it...\n`,
    );
    let interval = started.interval;
    const ends = Date.now() + started.expiresIn * 1000;
    while (Date.now() < ends) {
      await context.sleep(interval * 1000);
      const polled = await api.poll(started.deviceCode, `ebill CLI on ${hostname()}`);
      if ("token" in polled) {
        const file = await saveCredentials(context.place, { apiUrl: apiUrlOf(context.place), token: polled.token });
        context.stdout(`Signed in. Your sign-in is saved in ${file}, readable by you alone.\n`);
        return;
      }
      if (polled.error === "slow_down") interval += 5;
      else if (polled.error !== "authorization_pending") {
        const why: Record<string, string> = {
          access_denied: "The sign-in was refused in eBill.",
          expired_token: 'The code expired before it was approved. Run "ebill login" again.',
        };
        context.stderr(`${why[polled.error] ?? `eBill did not sign the CLI in (${plain(polled.error)}).`}\n`);
        context.fail();
        return;
      }
    }
    context.stderr('The code expired before it was approved. Run "ebill login" again.\n');
    context.fail();
  });
}

export async function logout(context: Context): Promise<void> {
  const forgotten = await forgetCredentials(context.place);
  context.stdout(forgotten ? `Signed out: removed ${credentialsFile(context.place)}.\n` : "Not signed in: nothing to remove.\n");
}

/** The app the folder's ebill.app.toml is, in the organisation's apps; told and undefined when it is not one. */
async function appIn(context: Context, api: DeveloperApi, dir: string): Promise<{ app: DeveloperApp; manifest: unknown; listing: unknown } | undefined> {
  const files = await loadAppFiles(dir);
  if ("failures" in files) {
    context.stderr(`${String(files.failures.length)} problem${files.failures.length === 1 ? "" : "s"} to fix first:\n\n${formatCheckFailures(files.failures)}`);
    context.fail();
    return undefined;
  }
  const said = (files.manifest as { app: { client_id: string } }).app;
  const app = (await api.apps()).find((one) => one.clientId === said.client_id);
  if (!app) {
    context.stderr(`No app with client id ${said.client_id} is your organisation's. Register it in eBill, then put its client id in ${APP_FILE}.\n`);
    context.fail();
    return undefined;
  }
  return { app: { ...app, handle: plain(app.handle), kind: plain(app.kind) }, ...files };
}

export async function deploy(context: Context, dir: string, version: string | undefined): Promise<void> {
  const api = await signedIn(context);
  if (!api) return;
  await talking(context, async () => {
    const found = await appIn(context, api, dir);
    if (!found) return;
    const inFile = (found.manifest as { app: { version: string } }).app.version;
    if (version !== undefined && version !== inFile) {
      context.stderr(`--version ${version} is not the version in ${APP_FILE} (${inFile}). Change one so they agree.\n`);
      context.fail();
      return;
    }
    const pushed = await api.push(found.app.id, found.manifest, found.listing);
    if (pushed.state === "rejected") {
      context.stderr(`eBill's checks refused ${found.app.handle} ${inFile}:\n\n${formatCheckFailures(pushed.failures)}\nFix these and deploy again.\n`);
      context.fail();
      return;
    }
    context.stdout(`Deployed ${found.app.handle} ${inFile}. It waits for eBill's review; "ebill app status" shows where it is.\n`);
  });
}

const STATES: Record<string, string> = {
  review_pending: "waiting for review",
  changes_requested: "changes requested",
  approved: "approved, not released",
  released: "released",
  superseded: "released before",
  retired: "retired",
};

const line = (version: AppVersion): string =>
  `  ${plain(version.version).padEnd(12)} ${plain(STATES[version.state] ?? version.state).padEnd(24)} ${plain(version.submittedAt.slice(0, 10))}${version.reviewNote ? `\n    ${plain(version.reviewNote)}` : ""}\n`;

export async function versions(context: Context, dir: string): Promise<void> {
  const api = await signedIn(context);
  if (!api) return;
  await talking(context, async () => {
    const found = await appIn(context, api, dir);
    if (!found) return;
    if (found.app.versions.length === 0) {
      context.stdout(`${found.app.handle} has no versions yet. Run "ebill app deploy".\n`);
      return;
    }
    context.stdout(`${found.app.handle}, newest first:\n\n${found.app.versions.map(line).join("")}`);
  });
}

/** Releases `version`; `rollback` only one released before. */
export async function release(context: Context, dir: string, version: string, rollback: boolean): Promise<void> {
  const api = await signedIn(context);
  if (!api) return;
  await talking(context, async () => {
    const found = await appIn(context, api, dir);
    if (!found) return;
    const target = found.app.versions.find((one) => one.version === version);
    if (!target) {
      context.stderr(`${found.app.handle} has no version ${version}. "ebill app versions" lists them.\n`);
      context.fail();
      return;
    }
    if (rollback && target.state !== "superseded") {
      context.stderr(`${version} was never released, so there is nothing to roll back to. Use "ebill app release" for a version eBill approved.\n`);
      context.fail();
      return;
    }
    const released = await api.release(target.id);
    const waiting =
      released.waiting > 0 ? ` ${String(released.waiting)} wait on the version they have until their organisation agrees to the new permissions.` : "";
    context.stdout(
      `Released ${found.app.handle} ${version}: ${String(released.moved)} installation${released.moved === 1 ? "" : "s"} moved to it.${waiting}\n`,
    );
  });
}

export async function status(context: Context, dir: string): Promise<void> {
  const api = await signedIn(context);
  if (!api) return;
  await talking(context, async () => {
    const found = await appIn(context, api, dir);
    if (!found) return;
    const live = found.app.versions.find((one) => one.state === "released");
    const open = found.app.versions.filter((one) => ["review_pending", "changes_requested", "approved"].includes(one.state));
    const lines = [
      `${found.app.handle} (${found.app.kind})${found.app.delistedAt ? ", delisted" : ""}`,
      `  Live: ${live ? live.version : "no version released yet"}`,
      ...(open.length === 0 ? ["  Nothing waiting."] : ["  Waiting:", ...open.map((one) => line(one).trimEnd())]),
    ];
    context.stdout(`${lines.join("\n")}\n`);
  });
}
