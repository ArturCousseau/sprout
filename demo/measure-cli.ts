import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunGitScenarioOptions } from "./git-agents.js";
import { HarnessError } from "./harness-error.js";
import {
  formatMarkdown,
  formatProgress,
  formatResults,
  isDirty,
  type Machine,
  type MeasuredRun,
  measurementPlan,
  RESULTS_PATH,
  ROUNDS,
  type Versions,
} from "./measure.js";
import { summarize } from "./metrics.js";
import type { RunResult } from "./results.js";
import { type ExitIo, SCENARIOS } from "./scenarios.js";
import type { RunSproutScenarioOptions } from "./sprout-agents.js";

/** `process`-like io: ExitIo plus stdout, where the progress goes (D14). */
export interface MeasureIo extends ExitIo {
  stdout: { write(text: string): unknown };
}

/** The measured repository as the user sees it (D9). */
export interface RepoTree {
  /** Short hash of HEAD. */
  commit: string;
  /** Paths of `git status --porcelain=v1 -z --no-renames`. */
  changed: string[];
}

/** Everything the measurement reads or runs, injected (D1). */
export interface MeasureCliOptions {
  /** Repo root: `demo/tmp/medicao` and `docs/resultados.md` are under it. */
  repoRoot: string;
  /** runGitScenario in the demo. */
  runGit: (options: RunGitScenarioOptions) => Promise<RunResult>;
  /** runSproutScenario in the demo. */
  runSprout: (options: RunSproutScenarioOptions) => Promise<RunResult>;
  readMachine: () => Promise<Machine>;
  readVersions: () => Promise<Versions>;
  readTree: () => Promise<RepoTree>;
  /** The date written in the file. */
  now: () => Date;
}

/**
 * `demo:medir` (#21): runs the 30 runs of measurementPlan, one at a time,
 * and writes docs/resultados.md. Always ends with `io.exit`. 0: the 30 runs
 * finished and the file was written. 1: a HarnessError in a run, named on
 * stderr with its round, system and scenario; the file is not touched.
 * 2: any argument. Any other error is a bug and is rethrown.
 */
export async function runMeasureCli(
  argv: string[],
  io: MeasureIo,
  options: MeasureCliOptions,
): Promise<never> {
  if (argv.length > 0) {
    io.stderr.write("usage: pnpm demo:medir (no arguments)\n");
    return io.exit(2);
  }

  // Everything the runs touch stays in demo/tmp/medicao (D3).
  const baseDir = join(options.repoRoot, "demo", "tmp", "medicao");
  const resultsDir = join(baseDir, "resultados");
  const dataDir = join(baseDir, "sprout-data");
  const log = (): void => {}; // the agents' lines stay silent (D1)

  const plan = measurementPlan();
  const runs: MeasuredRun[] = [];
  for (const [index, planned] of plan.entries()) {
    const scenario = SCENARIOS[planned.scenario];
    let result: RunResult;
    try {
      result =
        planned.system === "git"
          ? await options.runGit({ scenario, baseDir, resultsDir, log })
          : await options.runSprout({ scenario, dataDir, resultsDir, log });
    } catch (error) {
      if (error instanceof HarnessError) {
        // The first harness error stops everything; the file is untouched.
        io.stderr.write(
          `demo:medir: run ${planned.round}/${ROUNDS}, ${planned.system} ${planned.scenario}: ${error.message}\n`,
        );
        return io.exit(1);
      }
      throw error; // a bug, not a harness error
    }
    const summary = summarize(result.agents);
    runs.push({ ...planned, summary });
    io.stdout.write(
      `${formatProgress(index + 1, plan.length, planned.system, planned.scenario, summary.totalMs)}\n`,
    );
  }

  const tree = await options.readTree();
  const filepath = join(options.repoRoot, RESULTS_PATH);
  const md = formatResults({
    when: options.now(),
    commit: tree.commit,
    dirty: isDirty(tree.changed),
    machine: await options.readMachine(),
    versions: await options.readVersions(),
    runs,
  });
  await writeFile(filepath, await formatMarkdown(md, filepath));
  io.stdout.write(`resultados gravados em ${RESULTS_PATH}\n`);
  return io.exit(0);
}
