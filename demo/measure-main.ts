/**
 * Entry point of `pnpm demo:medir`: runs each scenario 5 times in both
 * systems, in `demo/tmp/medicao`, and writes `docs/resultados.md` (#21).
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { gitOk, runGitScenario } from "./git-agents.js";
import { formatSqlite, osName } from "./measure.js";
import { readRepoTree, runMeasureCli } from "./measure-cli.js";
import { runSproutScenario } from "./sprout-agents.js";

const repoRoot = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);

/** `/etc/os-release`, or null where it does not exist (D8). */
async function readOsRelease(): Promise<string | null> {
  try {
    return await readFile("/etc/os-release", "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The SQLite version of better-sqlite3, from an in-memory database (D9). */
function sqliteVersion(): string {
  const db = new Database(":memory:");
  try {
    const row = db.prepare("SELECT sqlite_version() AS version").get() as {
      version: string;
    };
    return row.version;
  } finally {
    db.close();
  }
}

await runMeasureCli(process.argv.slice(2), process, {
  repoRoot,
  runGit: runGitScenario,
  runSprout: runSproutScenario,
  readMachine: async () => ({
    cpuModel: os.cpus()[0].model,
    cpuCount: os.cpus().length,
    memoryBytes: os.totalmem(),
    system: osName(await readOsRelease(), os.type(), os.release()),
  }),
  readVersions: async () => ({
    node: process.version,
    git: (await gitOk(["--version"])).trim(),
    sqlite: formatSqlite(
      sqliteVersion(),
      (require("better-sqlite3/package.json") as { version: string }).version,
    ),
  }),
  readTree: () => readRepoTree(repoRoot),
  now: () => new Date(),
});
