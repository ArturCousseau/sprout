/**
 * Entry point of `pnpm demo:git --cenario A|B|C [--passo]`: runs one scenario
 * with the git agents in `demo/tmp` and writes
 * `demo/tmp/resultados/git-<id>.json`; with `--passo`, step by step and
 * without a result file.
 */
import { join, resolve } from "node:path";
import { shouldColor } from "./color.js";
import { runGitCli } from "./git-cli.js";
import { DEFAULT_RESULTS_DIR } from "./results.js";

const repoRoot = resolve(import.meta.dirname, "..");

await runGitCli(process.argv.slice(2), process, {
  baseDir: join(repoRoot, "demo/tmp"),
  resultsDir: join(repoRoot, DEFAULT_RESULTS_DIR),
  input: process.stdin,
  color: shouldColor(process.stdout.isTTY, process.env),
});
