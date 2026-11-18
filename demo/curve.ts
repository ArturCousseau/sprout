import type { System } from "./results.js";
import type { Scenario } from "./scenarios.js";

/** The agent counts of the curve, in increasing order (D7). */
export const CURVE_N = [2, 5, 10, 20] as const;

/** Rounds of the curve (D6). */
export const CURVE_ROUNDS = 3;

/** The generated file; it never counts as a change (D5). */
export const CURVE_PATH = "docs/curva.md";

/** One run of the curve: which round, system and agent count. */
export interface PlannedCurveRun {
  /** 1-based round. */
  round: number;
  system: System;
  n: number;
}

/**
 * The scenario of one curve run (D2): scenario B with `n` agents, each in its
 * own file. The id stays "B" so that ScenarioId, SCENARIOS, scenarios.ts,
 * results.ts and scoreboard.ts do not change. Two side effects, both harmless:
 * the run's internal title says "cenário B" (silenced by the curve's `log`),
 * and the runners write `git-B.json` and `sprout-B.json` in
 * `demo/tmp/curva/resultados/`, which nothing reads (readResult would refuse
 * them, since B has 10 agents).
 */
export function curveScenario(n: number): Scenario {
  return { id: "B", agents: n, sameFile: false };
}

/**
 * The 24 runs in order (D6): in each round, N increasing and, for each N, git
 * then Sprout.
 */
export function curvePlan(): PlannedCurveRun[] {
  const systems: System[] = ["git", "sprout"];
  const plan: PlannedCurveRun[] = [];
  for (let round = 1; round <= CURVE_ROUNDS; round++) {
    for (const n of CURVE_N) {
      for (const system of systems) {
        plan.push({ round, system, n });
      }
    }
  }
  return plan;
}

/** `[7/24] git N=20: 2865 ms`: one progress line, total time rounded (D11). */
export function formatCurveProgress(
  index: number,
  total: number,
  system: System,
  n: number,
  totalMs: number,
): string {
  return `[${index}/${total}] ${system} N=${n}: ${Math.round(totalMs)} ms`;
}
