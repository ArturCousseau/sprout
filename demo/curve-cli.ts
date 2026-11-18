import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CURVE_PATH,
  CURVE_ROUNDS,
  curvePlan,
  curveScenario,
  formatCurve,
  formatCurveProgress,
  type MeasuredCurveRun,
} from "./curve.js";
import { HarnessError } from "./harness-error.js";
import { formatMarkdown, isDirty } from "./measure.js";
import type { MeasureCliOptions, MeasureIo, RepoTree } from "./measure-cli.js";
import { summarize } from "./metrics.js";
import type { RunResult } from "./results.js";

/**
 * Everything the curve reads or runs, injected: the same shape as the
 * measurement's options. `repoRoot` holds `demo/tmp/curva` and
 * `docs/curva.md`.
 */
export type CurveCliOptions = MeasureCliOptions;

/**
 * `demo:curva` (#50): runs the 24 runs of curvePlan, one at a time, and
 * writes docs/curva.md. Always ends with `io.exit`. 0: the 24 runs finished
 * and the file was written. 1: a HarnessError in a run, named on stderr with
 * its round, system and N, or while reading the environment (tree, machine,
 * versions); the file is not touched. With uncommitted changes (other than
 * docs/curva.md), a warning on stderr. 2: any argument. Any other error is a
 * bug and is rethrown.
 */
export async function runCurveCli(
  argv: string[],
  io: MeasureIo,
  options: CurveCliOptions,
): Promise<never> {
  if (argv.length > 0) {
    io.stderr.write("usage: pnpm demo:curva (no arguments)\n");
    return io.exit(2);
  }

  // Everything the runs touch stays in demo/tmp/curva (D10).
  const baseDir = join(options.repoRoot, "demo", "tmp", "curva");
  const resultsDir = join(baseDir, "resultados");
  const dataDir = join(baseDir, "sprout-data");
  const log = (): void => {}; // the agents' lines stay silent

  const plan = curvePlan();
  const runs: MeasuredCurveRun[] = [];
  for (const [index, planned] of plan.entries()) {
    const scenario = curveScenario(planned.n);
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
          `demo:curva: run ${planned.round}/${CURVE_ROUNDS}, ${planned.system} N=${planned.n}: ${error.message}\n`,
        );
        return io.exit(1);
      }
      throw error; // a bug, not a harness error
    }
    const summary = summarize(result.agents);
    runs.push({ ...planned, summary });
    io.stdout.write(
      `${formatCurveProgress(index + 1, plan.length, planned.system, planned.n, summary.totalMs)}\n`,
    );
  }

  // The three environment readers in one block: a HarnessError from any of
  // them stops before the file is written, without `run k/3`.
  const filepath = join(options.repoRoot, CURVE_PATH);
  let tree: RepoTree;
  let md: string;
  try {
    tree = await options.readTree();
    md = formatCurve({
      when: options.now(),
      commit: tree.commit,
      dirty: isDirty(tree.changed, CURVE_PATH),
      machine: await options.readMachine(),
      versions: await options.readVersions(),
      runs,
    });
  } catch (error) {
    if (error instanceof HarnessError) {
      io.stderr.write(`demo:curva: ${error.message}\n`);
      return io.exit(1);
    }
    throw error; // a bug, not a harness error
  }
  if (isDirty(tree.changed, CURVE_PATH)) {
    io.stderr.write(
      `demo:curva: warning: uncommitted changes; commit ${tree.commit} does not describe all the measured code\n`,
    );
  }
  await writeFile(filepath, await formatMarkdown(md, filepath));
  io.stdout.write(`curva gravada em ${CURVE_PATH}\n`);
  return io.exit(0);
}
