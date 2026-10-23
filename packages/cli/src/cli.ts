import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { INIT_FILES, InitConflictError, initApp } from "./init.ts";
import { APP_FILE, LISTING_FILE, SKIPPED_CHECKS, validateApp, type Failure } from "./manifest.ts";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
}

/** Exit codes: 0 done, 1 something to fix (or bad usage), 2 needs the eBill developer API, which is not available yet. */
export const EXIT = { ok: 0, failed: 1, unavailable: 2 } as const;

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function cliVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const version = typeof pkg === "object" && pkg !== null && "version" in pkg ? pkg.version : undefined;
  return typeof version === "string" ? version : "0.0.0";
}

function parseVersion(value: string): string {
  if (!VERSION.test(value)) throw new InvalidArgumentError("Use x.y.z with no leading zeros and no pre-release part, for example 1.2.0.");
  return value;
}

function parseInstant(value: string): string {
  if (!ISO_WITH_ZONE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new InvalidArgumentError("Use an ISO 8601 time with a zone, for example 2027-03-01T09:00:00Z.");
  }
  return new Date(value).toISOString();
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

  const pending = (command: string) => (): void => {
    io.stderr(`"ebill ${command}" needs the eBill developer API, which is coming soon. Nothing was sent.\n`);
    setExit(EXIT.unavailable);
  };

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

  program.command("login").description("Sign in to your eBill developer account.").action(pending("login"));

  const app = program.command("app").description("Create, check and ship an app.").enablePositionalOptions();

  app
    .command("init")
    .description(`Create ${INIT_FILES.join(", ")} in a folder.`)
    .argument("[dir]", "folder to create the app in", ".")
    .option("--handle <handle>", "app handle (default: from the folder name)")
    .action(async (dir: string, options: { handle?: string }) => {
      try {
        const result = await initApp(resolve(io.cwd, dir), options);
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
      const target = resolve(io.cwd, dir);
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
    .description("Run your app against eBill while you develop it.")
    .option("--dir <dir>", "app folder", ".")
    .option("--port <port>", "port your local server listens on", parsePort, 3000)
    .action(pending("app dev"));

  app
    .command("deploy")
    .description("Upload a new version of the app. It is not released until you run release.")
    .requiredOption("--version <version>", "version to deploy, x.y.z", parseVersion)
    .requiredOption("--message <message>", "what changed, for your version history")
    .option("--dir <dir>", "app folder", ".")
    .action(async (options: { version: string; message: string; dir: string }) => {
      if (!(await runValidation(resolve(io.cwd, options.dir)))) {
        setExit(EXIT.failed);
        return;
      }
      pending("app deploy")();
    });

  app.command("versions").description("List deployed versions.").option("--dir <dir>", "app folder", ".").action(pending("app versions"));

  app
    .command("release")
    .description("Release a deployed version to every installation, now or at a set time.")
    .argument("<version>", "deployed version, x.y.z", parseVersion)
    .option("--at <time>", "when to release, ISO 8601 with a zone", parseInstant)
    .option("--dir <dir>", "app folder", ".")
    .action(pending("app release"));

  app
    .command("rollback")
    .description("Put every installation back on an earlier released version.")
    .argument("<version>", "released version, x.y.z", parseVersion)
    .option("--dir <dir>", "app folder", ".")
    .action(pending("app rollback"));

  app
    .command("status")
    .description("Show the live version, any scheduled release, and review state.")
    .option("--dir <dir>", "app folder", ".")
    .action(pending("app status"));

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
