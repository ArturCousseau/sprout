import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AgentResult, REJECTION_TYPES } from "./metrics.js";
import { SCENARIOS, type ScenarioId } from "./scenarios.js";

export type System = "git" | "sprout";

/**
 * A result file is missing, unreadable or invalid (R1 of #18). The scoreboard
 * turns only this error into exit code 1; any other error is a bug.
 */
export class ResultFileError extends Error {
  override name = "ResultFileError";
}

/** Everything one run produced; the scoreboard is computed from it (D5). */
export interface RunResult {
  system: System;
  scenario: ScenarioId;
  agents: AgentResult[];
}

/** Default results folder, relative to the repo root (inside demo/tmp). */
export const DEFAULT_RESULTS_DIR = "demo/tmp/resultados";

/** `<dir>/<system>-<scenario>.json`, e.g. `resultados/git-B.json`. */
export function resultPath(
  dir: string,
  system: System,
  scenario: ScenarioId,
): string {
  return join(dir, `${system}-${scenario}.json`);
}

/** Writes `run` as JSON, creating `dir` if needed. Returns the file path. */
export async function writeResult(
  dir: string,
  run: RunResult,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = resultPath(dir, run.system, run.scenario);
  await writeFile(path, `${JSON.stringify(run, null, 2)}\n`);
  return path;
}

/**
 * Reads `<dir>/<system>-<scenario>.json` and checks its shape by hand (like
 * the server's parseChangesetBody). Every error names the file; shape errors
 * also name the field.
 */
export async function readResult(
  dir: string,
  system: System,
  scenario: ScenarioId,
): Promise<RunResult> {
  const path = resultPath(dir, system, scenario);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ResultFileError(`result file not found: ${path}`, {
        cause: error,
      });
    }
    throw new ResultFileError(`cannot read result file ${path}`, {
      cause: error,
    });
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new ResultFileError(`invalid JSON in ${path}`, { cause: error });
  }
  const problem = checkRunResult(data, system, scenario);
  if (problem !== null) {
    throw new ResultFileError(`${path}: ${problem}`);
  }
  return data as RunResult;
}

const OUTCOMES = new Set(["accepted", "conflict"]);
const REJECTIONS = new Set<string>(REJECTION_TYPES);
// A Set, not an object with `in`: "constructor" in {} is true through the
// prototype (same reason as in the server).
const RUN_FIELDS = new Set(["system", "scenario", "agents"]);
const AGENT_FIELDS = new Set([
  "agent",
  "outcome",
  "attempts",
  "rejections",
  "reparented",
  "endMs",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Returns what is wrong with `data`, naming the field, or null if valid. */
function checkRunResult(
  data: unknown,
  system: System,
  scenario: ScenarioId,
): string | null {
  if (!isObject(data)) {
    return "must be a JSON object";
  }
  const unknownField = Object.keys(data).find((key) => !RUN_FIELDS.has(key));
  if (unknownField !== undefined) {
    return `unknown field: ${unknownField}`;
  }
  if (data.system !== system) {
    return `system must be "${system}"`;
  }
  if (data.scenario !== scenario) {
    return `scenario must be "${scenario}"`;
  }
  if (!Array.isArray(data.agents) || data.agents.length === 0) {
    return "agents must be a non-empty array";
  }
  const agents: unknown[] = data.agents;
  const expected = SCENARIOS[scenario].agents;
  if (agents.length !== expected) {
    return `agents must have exactly ${expected} entries in scenario ${scenario}, got ${agents.length}`;
  }
  const seen = new Set<number>();
  for (const [index, agent] of agents.entries()) {
    const at = `agents[${index}]`;
    if (!isObject(agent)) {
      return `${at} must be an object`;
    }
    const extra = Object.keys(agent).find((key) => !AGENT_FIELDS.has(key));
    if (extra !== undefined) {
      return `unknown field: ${at}.${extra}`;
    }
    if (!isPositiveInteger(agent.agent)) {
      return `${at}.agent must be a positive integer`;
    }
    if (seen.has(agent.agent)) {
      return `${at}.agent ${agent.agent} is repeated`;
    }
    seen.add(agent.agent);
    if (typeof agent.outcome !== "string" || !OUTCOMES.has(agent.outcome)) {
      return `${at}.outcome must be "accepted" or "conflict"`;
    }
    if (!isPositiveInteger(agent.attempts)) {
      return `${at}.attempts must be a positive integer`;
    }
    if (!isObject(agent.rejections)) {
      return `${at}.rejections must be an object`;
    }
    for (const [type, count] of Object.entries(agent.rejections)) {
      if (!REJECTIONS.has(type)) {
        return `${at}.rejections has unknown type "${type}" (expected ${REJECTION_TYPES.join(" or ")})`;
      }
      if (!isNonNegativeInteger(count)) {
        return `${at}.rejections["${type}"] must be a non-negative integer`;
      }
    }
    // git never reparents (null); Sprout always says whether it did (R4).
    if (system === "git" && agent.reparented !== null) {
      return `${at}.reparented must be null in git`;
    }
    if (system === "sprout" && typeof agent.reparented !== "boolean") {
      return `${at}.reparented must be a boolean in sprout`;
    }
    if (
      typeof agent.endMs !== "number" ||
      !Number.isFinite(agent.endMs) ||
      agent.endMs < 0
    ) {
      return `${at}.endMs must be a non-negative number`;
    }
  }
  // N entries, no repeats: a number out of 1..N leaves one of 1..N missing.
  for (let n = 1; n <= expected; n += 1) {
    if (!seen.has(n)) {
      return `agent ${n} is missing`;
    }
  }
  return null;
}
