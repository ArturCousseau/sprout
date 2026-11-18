import type { System } from "./results.js";
import type { ScenarioId } from "./scenarios.js";

/** One run of the measurement: which round, system and scenario. */
export interface PlannedRun {
  /** 1-based round. */
  round: number;
  system: System;
  scenario: ScenarioId;
}

/** Rounds of the measurement (D4). */
export const ROUNDS = 5;

/**
 * The 30 runs in order (D4): in each round, A git, A sprout, B git,
 * B sprout, C git, C sprout.
 */
export function measurementPlan(): PlannedRun[] {
  const scenarios: ScenarioId[] = ["A", "B", "C"];
  const systems: System[] = ["git", "sprout"];
  const plan: PlannedRun[] = [];
  for (let round = 1; round <= ROUNDS; round++) {
    for (const scenario of scenarios) {
      for (const system of systems) {
        plan.push({ round, system, scenario });
      }
    }
  }
  return plan;
}

/** `[7/30] git B: 1232 ms`: one progress line, total time rounded (D14). */
export function formatProgress(
  index: number,
  total: number,
  system: System,
  scenario: ScenarioId,
  totalMs: number,
): string {
  return `[${index}/${total}] ${system} ${scenario}: ${Math.round(totalMs)} ms`;
}

/** The time statistics of one scenario and system over the rounds (D6). */
export interface TimeStats {
  /** Each run's time, in whole milliseconds, in run order. */
  values: number[];
  /** Mean of the raw values, rounded only at the end. */
  mean: number;
  /** Median of the raw values, rounded only at the end. */
  median: number;
  min: number;
  max: number;
}

/** The median of `values`: the middle one, or the mean of the two middle. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Statistics of the runs' total times (D6): mean and median over the raw
 * values, rounded to whole milliseconds only at the end; the values and the
 * minimum and maximum, rounded each. An empty list is a RangeError.
 */
export function timeStats(totalsMs: number[]): TimeStats {
  if (totalsMs.length === 0) {
    throw new RangeError("cannot compute statistics of no runs");
  }
  const sum = totalsMs.reduce((total, value) => total + value, 0);
  return {
    values: totalsMs.map((value) => Math.round(value)),
    mean: Math.round(sum / totalsMs.length),
    median: Math.round(median(totalsMs)),
    min: Math.round(Math.min(...totalsMs)),
    max: Math.round(Math.max(...totalsMs)),
  };
}

/**
 * One count of one scenario and system over the rounds (D7): equal in every
 * run → that value; different → `min–max (v1, v2, …)`; every value null (git
 * reparents) → "-". A list mixing null and numbers is a RangeError.
 */
export function formatCount(values: (number | null)[]): string {
  const numbers = values.filter((value): value is number => value !== null);
  if (numbers.length > 0 && numbers.length < values.length) {
    throw new RangeError("a count must be null in every run or in none");
  }
  if (numbers.length === 0) return "-";
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  if (min === max) return String(min);
  return `${min}–${max} (${numbers.join(", ")})`;
}
