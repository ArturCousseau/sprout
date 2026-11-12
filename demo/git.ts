import { HarnessError } from "./harness-error.js";
import type { RejectionType } from "./metrics.js";

/**
 * Environment for every git command of the demo (D7): `base` plus variables
 * that hide the user's global and system config, and that make git fail
 * instead of waiting for a password or confirmation on the terminal.
 */
export function gitEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

/**
 * Config written into a clone (`git config <key> <value>`) so commits work
 * without any global config (D7), with `name` as the commit author.
 * `gc.auto=0` keeps git from starting a garbage collection in the middle of a
 * run. Used as is by the preparation clone, which is not an agent.
 */
export function identityGitConfig(
  name: string,
): [key: string, value: string][] {
  return [
    ["user.name", name],
    ["user.email", `${name}@example.invalid`],
    ["commit.gpgsign", "false"],
    ["gc.auto", "0"],
  ];
}

/** Config written into each agent's clone: author `agente-N`. */
export function localGitConfig(agent: number): [key: string, value: string][] {
  return identityGitConfig(`agente-${agent}`);
}

/** D9 ceiling, per run: the pushes of all `n` agents add up to at most 3n. */
export function maxGitAttempts(n: number): number {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`n must be a positive integer, got ${n}`);
  }
  return 3 * n;
}

/**
 * Called by the git agents before each new push, with the run's total so far
 * (counting that push). Above the ceiling the run stops with a HarnessError:
 * by D9 it is a harness failure, not a metric.
 */
export function checkGitAttempts(totalAttempts: number, n: number): void {
  const max = maxGitAttempts(n); // also rejects an invalid n
  if (!Number.isInteger(totalAttempts) || totalAttempts < 0) {
    throw new RangeError(
      `totalAttempts must be a non-negative integer, got ${totalAttempts}`,
    );
  }
  if (totalAttempts > max) {
    throw new HarnessError(
      `git: ${totalAttempts} attempts in the run, above the ceiling of ${max} (3 × ${n} agents, D9)`,
    );
  }
}

export type PushResult = "accepted" | RejectionType;

// Summary column of a rejected push → rejection type. A Map, not an object:
// a summary like "constructor" must not match through the prototype.
const REJECTION_SUMMARIES = new Map<string, RejectionType>([
  ["[rejected] (fetch first)", "fetch-first"],
  ["[remote rejected] (incorrect old value provided)", "ref-lock"],
]);

// `<flag>\t<from>:refs/heads/main\t<summary>`, the status line of
// `git push --porcelain` for main.
const MAIN_STATUS_LINE = /^(.)\t[^\t]+:refs\/heads\/main\t([^\t]+)$/;

// Flags that mean the ref was updated: fast-forward, forced, new ref.
const ACCEPTED_FLAGS = new Set([" ", "+", "*"]);

/**
 * Classifies one `git push --porcelain origin main` from its stdout and exit
 * code. Anything unexpected (no status line, more than one, another ref, an
 * unknown summary, an exit code that contradicts the flag) is a HarnessError,
 * never a guess. stderr is not read here: the agent only logs it.
 */
export function classifyPush(stdout: string, exitCode: number): PushResult {
  const statusLines = stdout.split("\n").filter((line) => line.includes("\t"));
  if (statusLines.length !== 1) {
    throw new HarnessError(
      `push: expected 1 status line, got ${statusLines.length}: ${JSON.stringify(stdout)}`,
    );
  }
  const line = statusLines[0];
  const match = MAIN_STATUS_LINE.exec(line);
  if (match === null) {
    throw new HarnessError(
      `push: status line is not for main: ${JSON.stringify(line)}`,
    );
  }
  const [, flag, summary] = match;
  if (ACCEPTED_FLAGS.has(flag)) {
    if (exitCode !== 0) {
      throw new HarnessError(
        `push: accepted line with exit code ${exitCode}: ${JSON.stringify(line)}`,
      );
    }
    return "accepted";
  }
  if (flag === "!") {
    if (exitCode !== 1) {
      throw new HarnessError(
        `push: rejected line with exit code ${exitCode}: ${JSON.stringify(line)}`,
      );
    }
    const type = REJECTION_SUMMARIES.get(summary);
    if (type === undefined) {
      throw new HarnessError(
        `push: unknown rejection: ${JSON.stringify(summary)}`,
      );
    }
    return type;
  }
  throw new HarnessError(
    `push: unknown flag ${JSON.stringify(flag)}: ${JSON.stringify(line)}`,
  );
}

export type PullResult = "rebased" | "conflict";

/**
 * Classifies one `git pull --rebase` from its exit code and whether
 * `.git/rebase-merge` exists afterwards (D5): the code alone does not separate
 * the cases (Phase 1 of #14, E2). Code 0 with no rebase in progress → back to
 * the push; code 1 with a rebase in progress → real conflict. Any other
 * combination is a HarnessError, never a guess.
 */
export function classifyPull(
  exitCode: number,
  rebaseInProgress: boolean,
): PullResult {
  if (exitCode === 0 && !rebaseInProgress) {
    return "rebased";
  }
  if (exitCode === 1 && rebaseInProgress) {
    return "conflict";
  }
  throw new HarnessError(
    `pull --rebase: exit code ${exitCode} with rebase-merge ${rebaseInProgress ? "present" : "absent"}`,
  );
}
