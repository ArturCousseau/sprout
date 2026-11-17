import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Paint, painter } from "./color.js";
import {
  commitAgents,
  gitOk,
  type PrepareGitRunOptions,
  prepareGitRun,
  runGit,
} from "./git-agents.js";
import { classifyPull, classifyPush, type PushResult } from "./git.js";
import { HarnessError } from "./harness-error.js";
import { fileFor } from "./scenarios.js";
import { formatRunTitle } from "./scoreboard.js";

export interface RunGitStepsOptions extends PrepareGitRunOptions {
  /** Where the step lines go. Tests record them. */
  log?: (line: string) => void;
  /** Waits for the presenter before each step (D4). Tests inject their own. */
  pause: () => Promise<void>;
  /** Colors on the lines (D2 of #20). Off by default, as in the tests. */
  color?: boolean;
}

// Column of the arrow: the longest action, "agente 2: pull --rebase + push"
// (30), plus 4 spaces, as in docs/demo.md §5. The step counter comes before
// the padded action, so it does not change this width (P1 of #20).
const ACTION_WIDTH = 34;

/** Steps of the git script, the T of the `N/T` counter (D6 of #20). */
const STEPS = 4;

/**
 * Stops the run when a step's real result is not the script's (D3, R8): the
 * step-by-step mode never prints a step that did not happen.
 */
function expectStep(
  step: number,
  action: string,
  expected: string,
  actual: string,
): void {
  if (actual !== expected) {
    throw new HarnessError(
      `step ${step} (${action}): expected ${expected}, got ${actual}`,
    );
  }
}

/**
 * Agent 2's first push must be rejected with fetch-first: agent 1's push
 * already finished, so nothing races for the ref lock. A ref-lock here, or an
 * accepted push, is a HarnessError (R6).
 */
export function expectFetchFirst(result: PushResult): void {
  expectStep(3, "agente 2: push", "fetch-first", result);
}

/**
 * `[git] 2/4 ` plus the text: the prefix (dim) and the step counter (P1 of
 * #20). `text` may already carry painted pieces.
 */
function counted(paint: Paint, step: number, text: string): string {
  return `${paint("dim", "[git]")} ${step}/${STEPS} ${text}`;
}

/**
 * One step line. The action is padded while still plain and the arrow is
 * painted after it (R9 of #20): codes never enter the padEnd.
 */
function stepLine(
  paint: Paint,
  step: number,
  action: string,
  result: string,
): string {
  const arrow = paint("dim", "→");
  return counted(
    paint,
    step,
    `${action.padEnd(ACTION_WIDTH)}${arrow} ${result}`,
  );
}

/**
 * The step-by-step mode of scenarios A and C in git (#17, docs/demo.md §5):
 * the same preparation and commits as the fast mode, then the title and the
 * Enter line and, for each step, a pause, the real git operation, its check
 * against the script and one line. The order is scripted and the agents
 * never run at the same time. Never writes a result file; the preparation
 * deletes the old one (D6).
 */
export async function runGitSteps({
  scenario,
  baseDir,
  resultsDir,
  log = console.log,
  pause,
  color = false,
}: RunGitStepsOptions): Promise<void> {
  await prepareGitRun({ baseDir, resultsDir, scenario });
  const central = join(baseDir, "central.git");
  const first = join(baseDir, "git-agente-1");
  const second = join(baseDir, "git-agente-2");
  await commitAgents(scenario, [first, second]);

  // The values on the lines come from the central repo, the authority (R4).
  const rev = async (repo: string, name: string): Promise<string> =>
    (await gitOk(["-C", repo, "rev-parse", name])).trim();
  const main = async (): Promise<string> =>
    (await gitOk(["-C", central, "rev-parse", "--short=7", "main"])).trim();
  const push = async (clone: string): Promise<PushResult> => {
    const result = await runGit([
      "-C",
      clone,
      "push",
      "--porcelain",
      "origin",
      "main",
    ]);
    return classifyPush(result.stdout, result.code);
  };

  // Every line goes through paint (D1 of #20): plain text when color is off.
  const paint = painter(color);
  const accepted = async (): Promise<string> =>
    `${paint("green", "✓ aceito")}, main = ${paint("dim", await main())}`;

  // The title and the Enter line replace the one-line header of R9 of #17
  // (D4, R12 of #20).
  log(formatRunTitle("git", scenario.id, "passo a passo", color));
  log(`${paint("dim", "[git]")} Enter antes de cada etapa`);

  await pause();
  const start = await rev(central, "main");
  const action1 = "agente 1 e agente 2 partem da main";
  expectStep(1, action1, start, await rev(first, "HEAD~1"));
  expectStep(1, action1, start, await rev(second, "HEAD~1"));
  log(counted(paint, 1, `${action1} no commit ${paint("dim", await main())}`));

  await pause();
  expectStep(2, "agente 1: push", "accepted", await push(first));
  log(stepLine(paint, 2, "agente 1: push", await accepted()));

  await pause();
  expectFetchFirst(await push(second));
  log(
    stepLine(
      paint,
      3,
      "agente 2: push",
      `${paint("red", "✗ REJEITADO")} (a main andou; o git não olha os arquivos)`,
    ),
  );

  await pause();
  const action4 = scenario.sameFile
    ? "agente 2: pull --rebase"
    : "agente 2: pull --rebase + push";
  const pull = await runGit(["-C", second, "pull", "--rebase"]);
  const rebasing = existsSync(join(second, ".git", "rebase-merge"));
  const pulled = classifyPull(pull.code, rebasing);
  expectStep(4, action4, scenario.sameFile ? "conflict" : "rebased", pulled);
  if (!scenario.sameFile) {
    expectStep(4, action4, "accepted", await push(second));
    log(stepLine(paint, 4, action4, await accepted()));
    return;
  }
  // The conflicting paths, read from git before the abort clears them (P10).
  const conflicts = (
    await gitOk(["-C", second, "diff", "--name-only", "--diff-filter=U"])
  )
    .trim()
    .split("\n")
    .join(", ");
  await gitOk(["-C", second, "rebase", "--abort"]);
  // Checked after the abort, so a divergence never leaves the clone mid-rebase.
  expectStep(
    4,
    action4,
    `conflict in ${fileFor(scenario, 2)}`,
    `conflict in ${conflicts}`,
  );
  log(
    stepLine(
      paint,
      4,
      action4,
      `${paint("yellow", "✗ CONFLITO")} em ${conflicts}; rebase --abort, main = ${paint("dim", await main())}`,
    ),
  );
}
