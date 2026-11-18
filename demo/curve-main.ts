/**
 * Entry point of `pnpm demo:curva`: runs N = 2, 5, 10 and 20 agents in both
 * systems, 3 rounds, in `demo/tmp/curva`, and writes `docs/curva.md` (#50).
 */
import { resolve } from "node:path";
import { runCurveCli } from "./curve-cli.js";
import { readMachine, readVersions } from "./environment.js";
import { runGitScenario } from "./git-agents.js";
import { readRepoTree } from "./measure-cli.js";
import { runSproutScenario } from "./sprout-agents.js";

const repoRoot = resolve(import.meta.dirname, "..");

await runCurveCli(process.argv.slice(2), process, {
  repoRoot,
  runGit: runGitScenario,
  runSprout: runSproutScenario,
  readMachine,
  readVersions,
  readTree: () => readRepoTree(repoRoot),
  now: () => new Date(),
});
