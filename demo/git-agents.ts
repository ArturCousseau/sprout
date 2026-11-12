import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Barrier, createBarrier } from "./barrier.js";
import {
  checkGitAttempts,
  classifyPull,
  classifyPush,
  gitEnv,
  identityGitConfig,
  localGitConfig,
} from "./git.js";
import { HarnessError } from "./harness-error.js";
import { type AgentResult, type RejectionType, summarize } from "./metrics.js";
import { resultPath, type RunResult, writeResult } from "./results.js";
import { fileFor, type Scenario } from "./scenarios.js";

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

export interface RunGitScenarioOptions extends PrepareGitRunOptions {
  /** Where the event lines go (D7). Tests pass a silent one. */
  log?: (line: string) => void;
  /**
   * Called before each push with the run's total so far, counting that push
   * (D6). Above the ceiling it throws a HarnessError. Tests inject a smaller
   * ceiling (R5).
   */
  checkAttempts?: (totalAttempts: number, n: number) => void;
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
}: RunGitScenarioOptions): Promise<RunResult> {
  await prepareGitRun({ baseDir, resultsDir, scenario });
  const clones: string[] = [];
  for (let n = 1; n <= scenario.agents; n++) {
    clones.push(join(baseDir, `git-agente-${n}`));
  }

  // Every agent's commit, one after the other, before the barrier exists: a
  // commit that fails here throws before any agent waits, so no agent is left
  // waiting forever for an arrival that never comes.
  for (const [index, clone] of clones.entries()) {
    const agent = index + 1;
    const file = fileFor(scenario, agent);
    await writeFile(join(clone, file), `agente ${agent}\n`);
    await gitOk(["-C", clone, "add", file]);
    await gitOk(["-C", clone, "commit", "-q", "-m", `agente ${agent}`]);
  }

  // The concurrent part starts here.
  const barrier = createBarrier(scenario.agents);
  // One counter for the whole run, shared by every agent (D6).
  let total = 0;
  const countPush = (): void => {
    total += 1;
    checkAttempts(total, scenario.agents);
  };
  const runs = clones.map((clone, index) =>
    runAgent({ agent: index + 1, clone, barrier, log, countPush }),
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
  log(`[git] resumo ${JSON.stringify(summarize(agents))}`);
  return run;
}

interface AgentContext {
  agent: number;
  clone: string;
  barrier: Barrier;
  log: (line: string) => void;
  /** Counts one more push for the run; throws above the ceiling. */
  countPush: () => void;
}

/** One agent, already committed: barrier, then push → pull --rebase. */
async function runAgent({
  agent,
  clone,
  barrier,
  log,
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
      log(`[git] agente ${agent}: push → aceito`);
      return finish("accepted");
    }
    rejections[pushed] = (rejections[pushed] ?? 0) + 1;
    log(`[git] agente ${agent}: push → rejeitado (${pushed})`);

    const pull = await runGit(["-C", clone, "pull", "--rebase"]);
    const rebasing = existsSync(join(clone, ".git", "rebase-merge"));
    const pulled = withStderr(pull, () => classifyPull(pull.code, rebasing));
    if (pulled === "conflict") {
      await gitOk(["-C", clone, "rebase", "--abort"]);
      log(`[git] agente ${agent}: pull --rebase → conflito, rebase --abort`);
      return finish("conflict");
    }
    log(`[git] agente ${agent}: pull --rebase → ok`);
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
