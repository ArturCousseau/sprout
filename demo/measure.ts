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
