/**
 * Entry point of `pnpm demo:git --cenario A|B|C`: runs one scenario with the
 * git agents in `demo/tmp` and writes `demo/tmp/resultados/git-<id>.json`.
 */
import { join, resolve } from "node:path";
import { runGitCli } from "./git-cli.js";
import { DEFAULT_RESULTS_DIR } from "./results.js";

const repoRoot = resolve(import.meta.dirname, "..");

await runGitCli(process.argv.slice(2), process, {
  baseDir: join(repoRoot, "demo/tmp"),
  resultsDir: join(repoRoot, DEFAULT_RESULTS_DIR),
});
