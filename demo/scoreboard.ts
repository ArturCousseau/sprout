import type { RunSummary } from "./metrics.js";
import type { System } from "./results.js";
import type { Scenario } from "./scenarios.js";

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

/** `Cenário B: 10 agentes, arquivos diferentes`, from SCENARIOS (D2). */
export function scenarioTitle(scenario: Scenario): string {
  const files = scenario.sameFile ? "mesmo arquivo" : "arquivos diferentes";
  return `Cenário ${scenario.id}: ${scenario.agents} agentes, ${files}`;
}

/** Spaces between the label column and each value column (R9). */
const GAP = "    ";

/**
 * The two-column table, one string per line without "\n": a header line and
 * one line per label. Labels go left (padEnd), values right (padStart); each
 * column is as wide as its widest text, with a fixed gap between them (R9).
 */
export function formatTable(git: RunSummary, sprout: RunSummary): string[] {
  const columns = [
    ["git", ...formatColumn(git)],
    ["sprout", ...formatColumn(sprout)],
  ];
  const widths = columns.map((column) =>
    Math.max(...column.map((text) => text.length)),
  );
  const labelWidth = Math.max(...LABELS.map((label) => label.length));
  const labels = ["", ...LABELS];
  return labels.map((label, row) => {
    const values = columns.map(
      (column, index) => GAP + (column[row] ?? "").padStart(widths[index] ?? 0),
    );
    return label.padEnd(labelWidth) + values.join("");
  });
}

/**
 * `dd/mm/aaaa HH:MM` in local time, by hand with the local getters (D4: no
 * Intl). Seconds are dropped, not rounded.
 */
export function formatTimestamp(date: Date): string {
  const two = (n: number): string => String(n).padStart(2, "0");
  const day = `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()}`;
  return `${day} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export interface ScoreboardInput {
  scenario: Scenario;
  git: RunSummary;
  sprout: RunSummary;
  /** Modification time of each result file (D4). */
  gitTime: Date;
  sproutTime: Date;
}

/**
 * The whole scoreboard, ending in "\n": title, blank line, table, blank line
 * and the "resultados:" line with each file's time (D2, D4).
 */
export function formatScoreboard(input: ScoreboardInput): string {
  const times = `resultados: git ${formatTimestamp(input.gitTime)}, sprout ${formatTimestamp(input.sproutTime)}`;
  const lines = [
    scenarioTitle(input.scenario),
    "",
    ...formatTable(input.git, input.sprout),
    "",
    times,
  ];
  return `${lines.join("\n")}\n`;
}
