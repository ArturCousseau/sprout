import { painter } from "./color.js";
import { HarnessError } from "./harness-error.js";
import type { AgentResult } from "./metrics.js";
import type { System } from "./results.js";
import { fileFor, type Scenario } from "./scenarios.js";

/**
 * The state of `main` at the end of a run (#19).
 * - `files`: path → content (git) or path → blobHash (Sprout).
 * - `commits`: git, `rev-list --count main`; Sprout, the head id (D7).
 */
export interface MainState {
  files: ReadonlyMap<string, string>;
  commits: number;
}

/**
 * The `main` a run must end with (D1, D2, D7): `base` (the git README, or
 * nothing in the Sprout) plus, for each accepted agent, its file
 * (`fileFor`) with `encode("agente N\n")`, and 1 + accepted commits (the
 * initial commit or root changeset, then one per accepted agent).
 *
 * The number of accepted agents is checked first: every agent in A and B,
 * exactly one in C. Any other number is a HarnessError, so an agent wrongly
 * marked "conflict" cannot take its own file out of the expected set.
 */
export function expectedMain(
  scenario: Scenario,
  agents: readonly AgentResult[],
  base: ReadonlyMap<string, string>,
  encode: (content: string) => string = (content) => content,
): MainState {
  const accepted = agents.filter((a) => a.outcome === "accepted");
  const expectedAccepted = scenario.sameFile ? 1 : scenario.agents;
  if (accepted.length !== expectedAccepted) {
    throw new HarnessError(
      `main check: accepted agents: expected ${expectedAccepted}, got ${accepted.length}`,
    );
  }
  const files = new Map(base);
  for (const { agent } of accepted) {
    files.set(fileFor(scenario, agent), encode(`agente ${agent}\n`));
  }
  return { files, commits: 1 + accepted.length };
}

/** Sorted with `<` (UTF-16 code units), like treeEntries in src/core/tree.ts. */
function sorted(paths: string[]): string[] {
  return paths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Throws a HarnessError when `actual` is not `expected` (D4, D8). One message
 * lists every problem, in this order: missing paths, extra paths, paths whose
 * content differs, then the commit count.
 */
export function checkMain(expected: MainState, actual: MainState): void {
  const missing: string[] = [];
  const differs: string[] = [];
  for (const [path, value] of expected.files) {
    const found = actual.files.get(path);
    if (found === undefined) {
      missing.push(path);
    } else if (found !== value) {
      differs.push(path);
    }
  }
  const extra = [...actual.files.keys()].filter(
    (path) => !expected.files.has(path),
  );

  const problems: string[] = [];
  if (missing.length > 0) {
    problems.push(`missing ${sorted(missing).join(", ")}`);
  }
  if (extra.length > 0) {
    problems.push(`extra ${sorted(extra).join(", ")}`);
  }
  if (differs.length > 0) {
    problems.push(`content differs: ${sorted(differs).join(", ")}`);
  }
  if (actual.commits !== expected.commits) {
    problems.push(
      `commits: expected ${expected.commits}, got ${actual.commits}`,
    );
  }
  if (problems.length > 0) {
    throw new HarnessError(`main check: ${problems.join("; ")}`);
  }
}

/**
 * The line a fast run prints once its main passed the check, before the
 * separator (D5): the accepted commits, singular for 1. With color, the
 * prefix and the arrow are dim and the whole result green, like `✓ aceito`
 * in the event lines; "na main" and the parentheses have no color (A6).
 */
export function formatMainLine(
  system: System,
  accepted: number,
  color = false,
): string {
  const paint = painter(color);
  const commits =
    accepted === 1 ? "1 commit aceito" : `${accepted} commits aceitos`;
  return `${paint("dim", `[${system}]`)} main conferida ${paint("dim", "→")} ${paint("green", `✓ ${commits}`)} na main (arquivos, conteúdo e contagem)`;
}
