import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Barrier, createBarrier } from "./barrier.js";
import { type Paint, painter } from "./color.js";
import {
  checkGitAttempts,
  classifyPull,
  classifyPush,
  gitEnv,
  identityGitConfig,
  localGitConfig,
} from "./git.js";
import { HarnessError } from "./harness-error.js";
import type { MainState } from "./main-check.js";
import { type AgentResult, type RejectionType, summarize } from "./metrics.js";
import { resultPath, type RunResult, writeResult } from "./results.js";
import { fileFor, type Scenario } from "./scenarios.js";
import {
  formatRunTitle,
  formatSeparator,
  formatSummaryLine,
} from "./scoreboard.js";

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

export const README = "Repositório central da demo do Sprout.\n";
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

/** One file of `git ls-tree -r -z`: its path and its blob id. */
export interface LsTreeEntry {
  path: string;
  id: string;
}

/** `<mode> blob <id>\t<path>`: a regular file; the id is SHA-1 or SHA-256. */
const LS_TREE_BLOB = /^\d{6} blob ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/s;

/**
 * The files of `git ls-tree -r -z` stdout: `<mode> blob <id>\t<path>`, each
 * entry ending in NUL. With `-r` the demo's main has only blobs, so any other
 * entry (a tree, a submodule) or a malformed one is a HarnessError (#19).
 * An output that does not end in NUL is cut short: also a HarnessError (A8).
 * An empty output (no files) gives no entries.
 */
export function parseLsTree(stdout: string): LsTreeEntry[] {
  // Every entry ends in NUL, so the last piece after the split must be empty.
  const pieces = stdout.split("\u0000");
  if (pieces.pop() !== "") {
    throw new HarnessError(
      `git ls-tree: output does not end in NUL (got ${JSON.stringify(stdout)})`,
    );
  }
  return pieces.map((entry) => {
    const match = LS_TREE_BLOB.exec(entry);
    if (match === null) {
      throw new HarnessError(
        `git ls-tree: unexpected entry (got ${JSON.stringify(entry)})`,
      );
    }
    const [, id, path] = match;
    return { path, id };
  });
}

/**
 * The commit count of `git rev-list --count` stdout: digits and one "\n".
 * Anything else (empty, not a number, no newline) is a HarnessError (A9).
 */
export function parseRevListCount(stdout: string): number {
  if (!/^\d+\n$/.test(stdout)) {
    throw new HarnessError(
      `git rev-list --count: not a count (got ${JSON.stringify(stdout)})`,
    );
  }
  return Number(stdout);
}

/**
 * The main of the central repo (#19, D2, D7): each file's content read with
 * `git cat-file blob`, so git's object format is never rebuilt in Node, and
 * the commit count of `git rev-list --count main`. One `ls-tree`, one
 * `cat-file` per file and one `rev-list`, all through runGit, after the
 * measured time.
 */
export async function readGitMain(central: string): Promise<MainState> {
  const entries = parseLsTree(
    await gitOk(["-C", central, "ls-tree", "-r", "-z", "main"]),
  );
  const files = new Map<string, string>();
  for (const { path, id } of entries) {
    files.set(path, await gitOk(["-C", central, "cat-file", "blob", id]));
  }
  const commits = parseRevListCount(
    await gitOk(["-C", central, "rev-list", "--count", "main"]),
  );
  return { files, commits };
}

async function configure(
  repo: string,
  entries: [key: string, value: string][],
): Promise<void> {
  for (const [key, value] of entries) {
    await gitOk(["-C", repo, "config", key, value]);
  }
}

/**
 * Each agent writes its file (`fileFor`) with "agente N" and commits it in
 * its clone, one agent after the other. `clones[i]` is agent i + 1's clone.
 * Used by the fast mode and by the step-by-step mode (#17).
 */
export async function commitAgents(
  scenario: Scenario,
  clones: string[],
): Promise<void> {
  for (const [index, clone] of clones.entries()) {
    const agent = index + 1;
    const file = fileFor(scenario, agent);
    await writeFile(join(clone, file), `agente ${agent}\n`);
    await gitOk(["-C", clone, "add", file]);
    await gitOk(["-C", clone, "commit", "-q", "-m", `agente ${agent}`]);
  }
}

export interface RunGitScenarioOptions extends PrepareGitRunOptions {
  /** Where the event lines go (D7). Tests pass a silent one. */
  log?: (line: string) => void;
  /**
   * Called before each push with the run's total so far, counting that push
   * (D6). Above the ceiling it throws a HarnessError. Tests inject a smaller
   * ceiling (R5).
   */
  checkAttempts?: (totalAttempts: number, n: number) => void;
  /** Colors on the lines (D2 of #20). Off by default, as in the tests. */
  color?: boolean;
}

/**
 * Runs one scenario (docs/demo.md §3): prepares the repos, starts the N
 * agents in parallel and waits for all of them, even when one fails (R1).
 * Only a run where every agent finished is written and summarized; otherwise
 * it throws one HarnessError with every failed agent's message.
 */
export async function runGitScenario({
  scenario,
  baseDir,
  resultsDir,
  log = console.log,
  checkAttempts = checkGitAttempts,
  color = false,
}: RunGitScenarioOptions): Promise<RunResult> {
  await prepareGitRun({ baseDir, resultsDir, scenario });
  const clones: string[] = [];
  for (let n = 1; n <= scenario.agents; n++) {
    clones.push(join(baseDir, `git-agente-${n}`));
  }

  // Every agent's commit, one after the other, before the barrier exists: a
  // commit that fails here throws before any agent waits, so no agent is left
  // waiting forever for an arrival that never comes.
  await commitAgents(scenario, clones);

  // The title comes after the preparation and before the barrier exists, so
  // it is never inside the measured time (P3 of #20).
  log(formatRunTitle("git", scenario.id, "modo rápido", color));

  // The concurrent part starts here.
  const barrier = createBarrier(scenario.agents);
  // One counter for the whole run, shared by every agent (D6).
  let total = 0;
  const countPush = (): void => {
    total += 1;
    checkAttempts(total, scenario.agents);
  };
  const paint = painter(color);
  const runs = clones.map((clone, index) =>
    runAgent({ agent: index + 1, clone, barrier, log, paint, countPush }),
  );

  const settled = await Promise.allSettled(runs);

  const agents: AgentResult[] = [];
  const failures: string[] = [];
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") {
      agents.push(outcome.value);
    } else if (outcome.reason instanceof HarnessError) {
      failures.push(`agente ${index + 1}: ${outcome.reason.message}`);
    } else {
      throw outcome.reason; // a bug, not a harness error
    }
  }
  if (failures.length > 0) {
    throw new HarnessError(failures.join("\n"));
  }
  const run: RunResult = { system: "git", scenario: scenario.id, agents };
  await writeResult(resultsDir, run);
  log(formatSeparator("git", scenario.id, color));
  log(formatSummaryLine("git", summarize(agents), color));
  return run;
}

interface AgentContext {
  agent: number;
  clone: string;
  barrier: Barrier;
  log: (line: string) => void;
  /** The run's Paint: plain text when color is off. */
  paint: Paint;
  /** Counts one more push for the run; throws above the ceiling. */
  countPush: () => void;
}

/** One agent, already committed: barrier, then push → pull --rebase. */
async function runAgent({
  agent,
  clone,
  barrier,
  log,
  paint,
  countPush,
}: AgentContext): Promise<AgentResult> {
  const release = await barrier.arrive();
  let attempts = 0;
  const rejections: Partial<Record<RejectionType, number>> = {};
  const finish = (outcome: AgentResult["outcome"]): AgentResult => ({
    agent,
    outcome,
    attempts,
    rejections,
    reparented: null,
    endMs: performance.now() - release,
  });

  for (;;) {
    // Before each push (D6). No await may come between the barrier release
    // above and this call: all agents then count their first push in the same
    // microtask round, before any push can finish.
    countPush();
    attempts += 1;
    const push = await runGit([
      "-C",
      clone,
      "push",
      "--porcelain",
      "origin",
      "main",
    ]);
    const pushed = withStderr(push, () => classifyPush(push.stdout, push.code));
    if (pushed === "accepted") {
      log(formatGitEvent(agent, { kind: "accepted" }, paint));
      return finish("accepted");
    }
    rejections[pushed] = (rejections[pushed] ?? 0) + 1;
    log(formatGitEvent(agent, { kind: "rejected", type: pushed }, paint));

    const pull = await runGit(["-C", clone, "pull", "--rebase"]);
    const rebasing = existsSync(join(clone, ".git", "rebase-merge"));
    const pulled = withStderr(pull, () => classifyPull(pull.code, rebasing));
    if (pulled === "conflict") {
      await gitOk(["-C", clone, "rebase", "--abort"]);
      log(formatGitEvent(agent, { kind: "conflict" }, paint));
      return finish("conflict");
    }
    log(formatGitEvent(agent, { kind: "rebased" }, paint));
  }
}

/** One fast-mode event of a git agent: a push or a pull --rebase result. */
export type GitEvent =
  | { kind: "accepted" }
  | { kind: "rejected"; type: RejectionType }
  | { kind: "rebased" }
  | { kind: "conflict" };

/**
 * The event line of `agent` in the fast mode (docs/demo.md §3). With a
 * coloring `paint`, the prefix, the arrow and the rejection type are dim and
 * the result word takes its color, in pieces side by side (D1 of #20).
 */
export function formatGitEvent(
  agent: number,
  event: GitEvent,
  paint: Paint = painter(false),
): string {
  const prefix = `${paint("dim", "[git]")} agente ${agent}:`;
  const arrow = paint("dim", "→");
  switch (event.kind) {
    case "accepted":
      return `${prefix} push ${arrow} ${paint("green", "✓ aceito")}`;
    case "rejected":
      return `${prefix} push ${arrow} ${paint("red", "✗ rejeitado")} ${paint("dim", `(${event.type})`)}`;
    case "rebased":
      return `${prefix} pull --rebase ${arrow} ok`;
    case "conflict":
      return `${prefix} pull --rebase ${arrow} ${paint("yellow", "✗ conflito")}, rebase --abort`;
  }
}

/** Runs a classifier; its HarnessError gets git's stderr appended (R9). */
function withStderr<T>(result: GitRun, classify: () => T): T {
  try {
    return classify();
  } catch (error) {
    if (error instanceof HarnessError) {
      throw new HarnessError(
        `${error.message}; git stderr: ${result.stderr.trim()}`,
        { cause: error },
      );
    }
    throw error;
  }
}
