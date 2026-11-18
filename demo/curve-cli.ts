import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CURVE_PATH,
  curvePlan,
  curveScenario,
  formatCurve,
  formatCurveProgress,
  type MeasuredCurveRun,
} from "./curve.js";
import { formatMarkdown, isDirty } from "./measure.js";
import type { MeasureCliOptions, MeasureIo } from "./measure-cli.js";
import { summarize } from "./metrics.js";

/**
 * Everything the curve reads or runs, injected: the same shape as the
 * measurement's options. `repoRoot` holds `demo/tmp/curva` and
 * `docs/curva.md`.
 */
export type CurveCliOptions = MeasureCliOptions;

/**
 * `demo:curva` (#50): runs the 24 runs of curvePlan, one at a time, and
 * writes docs/curva.md. Always ends with `io.exit`. 0: the 24 runs finished
 * and the file was written. 2: any argument.
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
    const result =
      planned.system === "git"
        ? await options.runGit({ scenario, baseDir, resultsDir, log })
        : await options.runSprout({ scenario, dataDir, resultsDir, log });
    const summary = summarize(result.agents);
    runs.push({ ...planned, summary });
    io.stdout.write(
      `${formatCurveProgress(index + 1, plan.length, planned.system, planned.n, summary.totalMs)}\n`,
    );
  }

  const filepath = join(options.repoRoot, CURVE_PATH);
  const tree = await options.readTree();
  const md = formatCurve({
    when: options.now(),
    commit: tree.commit,
    dirty: isDirty(tree.changed, CURVE_PATH),
    machine: await options.readMachine(),
    versions: await options.readVersions(),
    runs,
  });
  await writeFile(filepath, await formatMarkdown(md, filepath));
  io.stdout.write(`curva gravada em ${CURVE_PATH}\n`);
  return io.exit(0);
}
