/**
 * Entry point of `pnpm demo:medir`: runs each scenario 5 times in both
 * systems, in `demo/tmp/medicao`, and writes `docs/resultados.md` (#21).
 */
import { resolve } from "node:path";
import { readMachine, readVersions } from "./environment.js";
import { runGitScenario } from "./git-agents.js";
import { readRepoTree, runMeasureCli } from "./measure-cli.js";
import { runSproutScenario } from "./sprout-agents.js";

const repoRoot = resolve(import.meta.dirname, "..");

await runMeasureCli(process.argv.slice(2), process, {
  repoRoot,
  runGit: runGitScenario,
  runSprout: runSproutScenario,
  readMachine,
  readVersions,
  readTree: () => readRepoTree(repoRoot),
  now: () => new Date(),
});
