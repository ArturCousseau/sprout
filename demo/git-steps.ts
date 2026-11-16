import { join } from "node:path";
import {
  commitAgents,
  gitOk,
  type PrepareGitRunOptions,
  prepareGitRun,
  runGit,
} from "./git-agents.js";

export interface RunGitStepsOptions extends PrepareGitRunOptions {
  /** Where the step lines go. Tests record them. */
  log?: (line: string) => void;
  /** Waits for the presenter before each step (D4). Tests inject their own. */
  pause: () => Promise<void>;
}

// Column of the arrow: the longest action, "agente 2: pull --rebase + push"
// (30), plus 4 spaces, as in docs/demo.md §5.
const ACTION_WIDTH = 34;

function stepLine(action: string, result: string): string {
  return `[git] ${action.padEnd(ACTION_WIDTH)}→ ${result}`;
}

/**
 * The step-by-step mode of scenarios A and C in git (#17, docs/demo.md §5):
 * the same preparation and commits as the fast mode, then a header and, for
 * each step, a pause, the real git operation and one line. The order is
 * scripted and the agents never run at the same time. Never writes a result
 * file; the preparation deletes the old one (D6).
 */
export async function runGitSteps({
  scenario,
  baseDir,
  resultsDir,
  log = console.log,
  pause,
}: RunGitStepsOptions): Promise<void> {
  await prepareGitRun({ baseDir, resultsDir, scenario });
  const central = join(baseDir, "central.git");
  const first = join(baseDir, "git-agente-1");
  const second = join(baseDir, "git-agente-2");
  await commitAgents(scenario, [first, second]);

  // The values on the lines come from the central repo, the authority (R4).
  const main = async (): Promise<string> =>
    (await gitOk(["-C", central, "rev-parse", "--short=7", "main"])).trim();
  const push = (clone: string) =>
    runGit(["-C", clone, "push", "--porcelain", "origin", "main"]);

  log(`[git] cenário ${scenario.id}, passo a passo: Enter antes de cada etapa`);

  await pause();
  log(`[git] agente 1 e agente 2 partem da main no commit ${await main()}`);

  await pause();
  await push(first);
  log(stepLine("agente 1: push", `aceito, main = ${await main()}`));

  await pause();
  await push(second);
  log(
    stepLine(
      "agente 2: push",
      "REJEITADO (a main andou; o git não olha os arquivos)",
    ),
  );

  await pause();
  await runGit(["-C", second, "pull", "--rebase"]);
  if (!scenario.sameFile) {
    await push(second);
    log(
      stepLine(
        "agente 2: pull --rebase + push",
        `aceito, main = ${await main()}`,
      ),
    );
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
  log(
    stepLine(
      "agente 2: pull --rebase",
      `CONFLITO em ${conflicts}; rebase --abort, main = ${await main()}`,
    ),
  );
}
