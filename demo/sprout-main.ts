/**
 * Entry point of `pnpm demo:sprout --cenario A|B|C`: runs one scenario with
 * the Sprout agents against a server in `demo/tmp/sprout-data` and writes
 * `demo/tmp/resultados/sprout-<id>.json`.
 */
import { join, resolve } from "node:path";
import { DEFAULT_RESULTS_DIR } from "./results.js";
import { runSproutCli } from "./sprout-cli.js";

const repoRoot = resolve(import.meta.dirname, "..");

await runSproutCli(process.argv.slice(2), process, {
  dataDir: join(repoRoot, "demo/tmp/sprout-data"),
  resultsDir: join(repoRoot, DEFAULT_RESULTS_DIR),
});
