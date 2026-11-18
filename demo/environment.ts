/**
 * The real readers of the measured machine and versions (#21 D8, D9), shared
 * by `demo:medir` and `demo:curva` (#50, D4). Not tested: they read the real
 * machine; the commands' manual checks compare them with the terminal.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import Database from "better-sqlite3";
import { gitOk } from "./git-agents.js";
import {
  formatSqlite,
  type Machine,
  osName,
  type Versions,
} from "./measure.js";

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

/** The measured machine (D8): processor, CPUs, memory and system. */
export async function readMachine(): Promise<Machine> {
  return {
    cpuModel: os.cpus()[0].model,
    cpuCount: os.cpus().length,
    memoryBytes: os.totalmem(),
    system: osName(await readOsRelease(), os.type(), os.release()),
  };
}

/** The versions (D9): Node, git and SQLite. */
export async function readVersions(): Promise<Versions> {
  return {
    node: process.version,
    git: (await gitOk(["--version"])).trim(),
    sqlite: formatSqlite(
      sqliteVersion(),
      (require("better-sqlite3/package.json") as { version: string }).version,
    ),
  };
}
