import type { RunSummary } from "./metrics.js";
import type { System } from "./results.js";

/** Row labels of the scoreboard, in the order of docs/demo.md §6 (D2). */
export const LABELS = [
  "aceitos",
  "rejeições",
  "tentativas",
  "trocas de pai",
  "conflitos reais",
  "tempo total",
] as const;

/**
 * One column of the scoreboard: one cell per label, in the same order.
 * `reparents: null` (git) is "-"; the time is whole milliseconds (D3).
 */
export function formatColumn(summary: RunSummary): string[] {
  return [
    String(summary.accepted),
    String(summary.rejections),
    String(summary.attempts),
    summary.reparents === null ? "-" : String(summary.reparents),
    String(summary.conflicts),
    `${Math.round(summary.totalMs)} ms`,
  ];
}

/**
 * The summary line each system prints at the end of a run (D6, R8), with the
 * same labels and cells as the scoreboard.
 */
export function formatSummaryLine(system: System, summary: RunSummary): string {
  const cells = formatColumn(summary);
  const pairs = LABELS.map((label, index) => `${label} ${cells[index]}`);
  return `[${system}] resumo: ${pairs.join(", ")}`;
}
