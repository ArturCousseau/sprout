import { spawn } from "node:child_process";
import { gitEnv } from "./git.js";
import { HarnessError } from "./harness-error.js";

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
