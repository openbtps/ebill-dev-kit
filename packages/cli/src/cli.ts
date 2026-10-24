import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { deploy, dev, login, logout, release, status, versions, type Context } from "./commands.ts";
import { INIT_FILES, InitConflictError, initApp } from "./init.ts";
import { APP_FILE, LISTING_FILE, SKIPPED_CHECKS, validateApp, type Failure } from "./manifest.ts";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  /** Default: the process's. EBILL_API_URL, EBILL_TOKEN and XDG_CONFIG_HOME are read from it. */
  env?: Record<string, string | undefined>;
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Where the sign-in is kept. Default: $XDG_CONFIG_HOME/ebill, or ~/.config/ebill. */
  configDir?: string;
  /** Default: a timer. Tests pass one that does not wait. */
  sleep?: (ms: number) => Promise<void>;
}

/** Exit codes: 0 done, 1 something to fix (or bad usage), 2 needs something eBill does not have yet. */
export const EXIT = { ok: 0, failed: 1, unavailable: 2 } as const;

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function cliVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const version = typeof pkg === "object" && pkg !== null && "version" in pkg ? pkg.version : undefined;
  return typeof version === "string" ? version : "0.0.0";
}

function parseVersion(value: string): string {
  if (!VERSION.test(value)) throw new InvalidArgumentError("Use x.y.z with no leading zeros and no pre-release part, for example 1.2.0.");
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new InvalidArgumentError("Use a port number from 1 to 65535.");
  return port;
}

export function formatFailures(failures: Failure[]): string {
  return failures.map((failure) => `  ${failure.path}  (${failure.check})\n    ${failure.reason}\n`).join("");
}

function skippedNote(): string {
  return `Not checked here, because they need the network (eBill checks them when you deploy): ${SKIPPED_CHECKS.join(", ")}.\n`;
}

export function buildProgram(io: Io, setExit: (code: number) => void): Command {
  const program = new Command("ebill")
    .description("Build apps and templates for the eBillAddress Marketplace.")
    .version(cliVersion(), "-v, --version", "Print the CLI version.")
    .enablePositionalOptions()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .exitOverride();

  const context: Context = {
    stdout: io.stdout,
    stderr: io.stderr,
    place: { env: io.env ?? process.env, configDir: io.configDir },
    fetch: io.fetch ?? globalThis.fetch.bind(globalThis),
    sleep: io.sleep ?? ((ms: number) => wait(ms)),
    fail: () => {
      setExit(EXIT.failed);
    },
  };
  const folder = (dir: string): string => resolve(io.cwd, dir);

  const runValidation = async (dir: string): Promise<boolean> => {
    const failures = await validateApp(dir);
    const where = relative(io.cwd, dir) || ".";
    if (failures.length === 0) {
      io.stdout(`${APP_FILE} and ${LISTING_FILE} in ${where}: no problems found.\n`);
    } else {
      io.stderr(`${String(failures.length)} problem${failures.length === 1 ? "" : "s"} in ${where}:\n\n${formatFailures(failures)}\n`);
    }
    io.stdout(skippedNote());
    return failures.length === 0;
  };

  program
    .command("login")
    .description("Sign in to eBill as your organisation: you approve a code in eBill's web app.")
    .action(() => login(context));
  program
    .command("logout")
    .description("Forget the sign-in kept on this computer.")
    .action(() => logout(context));

  const app = program.command("app").description("Create, check and ship an app.").enablePositionalOptions();

  app
    .command("init")
    .description(`Create ${INIT_FILES.join(", ")} in a folder.`)
    .argument("[dir]", "folder to create the app in", ".")
    .option("--handle <handle>", "app handle (default: from the folder name)")
    .option("--template", "a template app: a starter template.json in place of the server")
    .action(async (dir: string, options: { handle?: string; template?: boolean }) => {
      try {
        const result = await initApp(folder(dir), options);
        const where = relative(io.cwd, result.dir) || ".";
        io.stdout(
          `Created in ${where}:\n${result.files.map((file) => `  ${file}\n`).join("")}\nNext: put your client id in ${APP_FILE}, then run "ebill app validate".\n`,
        );
      } catch (error) {
        if (error instanceof InitConflictError || error instanceof TypeError) {
          io.stderr(`${error.message}\nNothing was written.\n`);
          setExit(EXIT.failed);
          return;
        }
        throw error;
      }
    });

  app
    .command("validate")
    .description(`Check ${APP_FILE} and ${LISTING_FILE}.`)
    .argument("[dir]", "app folder", ".")
    .option("--json", "print the result as JSON")
    .action(async (dir: string, options: { json?: boolean }) => {
      const target = folder(dir);
      if (options.json) {
        const failures = await validateApp(target);
        io.stdout(`${JSON.stringify({ ok: failures.length === 0, failures, skipped: SKIPPED_CHECKS }, null, 2)}\n`);
        if (failures.length > 0) setExit(EXIT.failed);
        return;
      }
      if (!(await runValidation(target))) setExit(EXIT.failed);
    });

  app
    .command("dev")
    .description("Install the folder's app, checked but not reviewed, in your sandbox organisation, and sign its server in.")
    .option("--dir <dir>", "app folder", ".")
    .option("--port <port>", "port your local server listens on, for the tunnel eBill reaches it through", parsePort, 3000)
    .action((options: { dir: string; port: number }) => dev(context, folder(options.dir), options.port));

  app
    .command("deploy")
    .description("Push the version in ebill.app.toml through eBill's checks. It waits for review, and is not released until you run release.")
    .option("--version <version>", "the version you mean to push: refused unless ebill.app.toml says the same", parseVersion)
    .option("--dir <dir>", "app folder", ".")
    .action(async (options: { version?: string; dir: string }) => {
      if (!(await runValidation(folder(options.dir)))) {
        setExit(EXIT.failed);
        return;
      }
      await deploy(context, folder(options.dir), options.version);
    });

  app
    .command("versions")
    .description("List the app's versions and where review has them.")
    .option("--dir <dir>", "app folder", ".")
    .action((options: { dir: string }) => versions(context, folder(options.dir)));

  app
    .command("release")
    .description("Release a version eBill approved. Installations move to it unless it asks for more than they granted.")
    .argument("<version>", "approved version, x.y.z", parseVersion)
    .option("--dir <dir>", "app folder", ".")
    .action((version: string, options: { dir: string }) => release(context, folder(options.dir), version, false));

  app
    .command("rollback")
    .description("Release an earlier version again, one that was released before.")
    .argument("<version>", "version released before, x.y.z", parseVersion)
    .option("--dir <dir>", "app folder", ".")
    .action((version: string, options: { dir: string }) => release(context, folder(options.dir), version, true));

  app
    .command("status")
    .description("Show the live version and what waits for review.")
    .option("--dir <dir>", "app folder", ".")
    .action((options: { dir: string }) => status(context, folder(options.dir)));

  return program;
}

/** Run the CLI with arguments after the command name. Resolves to the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  let code: number = EXIT.ok;
  const program = buildProgram(io, (next) => (code = next));
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode;
    throw error;
  }
  return code;
}
