/**
 * Entry point of `pnpm demo:placar --cenario A|B|C`: reads
 * `demo/tmp/resultados/git-<id>.json` and `sprout-<id>.json` and prints both
 * side by side. Runs nothing and writes nothing (D1).
 */
import { join, resolve } from "node:path";
import { DEFAULT_RESULTS_DIR } from "./results.js";
import { runScoreboardCli } from "./scoreboard-cli.js";

const repoRoot = resolve(import.meta.dirname, "..");

await runScoreboardCli(process.argv.slice(2), process, {
  resultsDir: join(repoRoot, DEFAULT_RESULTS_DIR),
});
