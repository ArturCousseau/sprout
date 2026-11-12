import { spawn } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gitEnv, identityGitConfig, localGitConfig } from "./git.js";
import { HarnessError } from "./harness-error.js";
import { resultPath } from "./results.js";
import type { Scenario } from "./scenarios.js";

/** What one git command produced. */
export interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs `git <args>` with gitEnv (D7). This is the only place in the demo that
 * starts a git process. A non-zero exit code is returned, not thrown: the
 * push and the pull read it to classify the result. A git that cannot start
 * or is killed by a signal is a HarnessError.
 */
export function runGit(args: string[], cwd?: string): Promise<GitRun> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: gitEnv(process.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => {
      reject(
        new HarnessError(`${describe(args)}: cannot start git`, {
          cause: error,
        }),
      );
    });
    child.on("close", (code, signal) => {
      if (code === null) {
        reject(new HarnessError(`${describe(args)}: killed by ${signal}`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Like runGit, for commands that must succeed (preparation, add, commit,
 * rebase --abort). A non-zero code is a HarnessError whose message carries
 * git's stderr, the only place stderr is shown (R9). Returns stdout.
 */
export async function gitOk(args: string[], cwd?: string): Promise<string> {
  const result = await runGit(args, cwd);
  if (result.code !== 0) {
    throw new HarnessError(
      `${describe(args)}: exit code ${result.code}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

function describe(args: string[]): string {
  return `git ${args.join(" ")}`;
}

export interface PrepareGitRunOptions {
  /** Folder of the git repositories (`demo/tmp` in the demo). */
  baseDir: string;
  /** Folder of the result JSON files. */
  resultsDir: string;
  scenario: Scenario;
}

const README = "Repositório central da demo do Sprout.\n";
const AGENT_CLONE = /^git-agente-\d+$/;

/**
 * Builds a fresh run in `baseDir` (D2): deletes the previous central repo,
 * clones and result file (R2), creates the bare `central.git` with one
 * initial commit (R3), and clones it once per agent with that agent's config.
 */
export async function prepareGitRun({
  baseDir,
  resultsDir,
  scenario,
}: PrepareGitRunOptions): Promise<void> {
  const central = join(baseDir, "central.git");
  const preparation = join(baseDir, "git-preparacao");

  await mkdir(baseDir, { recursive: true });
  const stale = (await readdir(baseDir)).filter((name) =>
    AGENT_CLONE.test(name),
  );
  for (const path of [
    central,
    preparation,
    ...stale.map((name) => join(baseDir, name)),
    resultPath(resultsDir, "git", scenario.id),
  ]) {
    await rm(path, { recursive: true, force: true });
  }

  await gitOk(["init", "-q", "--bare", "-b", "main", central]);
  await gitOk(["-C", central, "config", "gc.auto", "0"]);

  await gitOk(["clone", "-q", central, preparation]);
  await configure(preparation, identityGitConfig("preparacao"));
  await writeFile(join(preparation, "README.md"), README);
  await gitOk(["-C", preparation, "add", "README.md"]);
  await gitOk(["-C", preparation, "commit", "-q", "-m", "commit inicial"]);
  await gitOk([
    "-C",
    preparation,
    "push",
    "-q",
    "origin",
    "HEAD:refs/heads/main",
  ]);
  await rm(preparation, { recursive: true, force: true });

  for (let n = 1; n <= scenario.agents; n++) {
    const clone = join(baseDir, `git-agente-${n}`);
    await gitOk(["clone", "-q", central, clone]);
    await configure(clone, localGitConfig(n));
  }
}

async function configure(
  repo: string,
  entries: [key: string, value: string][],
): Promise<void> {
  for (const [key, value] of entries) {
    await gitOk(["-C", repo, "config", key, value]);
  }
}
