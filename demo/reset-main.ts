/**
 * Entry point of `pnpm demo:reset`: deletes `demo/tmp` (git repositories and
 * server data from previous runs). Exits 0 even when `demo/tmp` is missing.
 */
import { join, resolve } from "node:path";
import { resetDemoTmp } from "./reset.js";

const repoRoot = resolve(import.meta.dirname, "..");
const target = join(repoRoot, "demo/tmp");

await resetDemoTmp(repoRoot, target);
console.log("demo:reset: demo/tmp is clean");
