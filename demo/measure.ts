import { format, resolveConfig } from "prettier";
import type { RunSummary } from "./metrics.js";
import type { System } from "./results.js";
import type { ScenarioId } from "./scenarios.js";
import { formatTimestamp, LABELS } from "./scoreboard.js";

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

/**
 * The system line (D8): `PRETTY_NAME` of `/etc/os-release` and the kernel;
 * without the file (null) or without that key, `os.type()` + `os.release()`.
 */
export function osName(
  osRelease: string | null,
  type: string,
  release: string,
): string {
  const line = osRelease
    ?.split("\n")
    .find((entry) => entry.startsWith("PRETTY_NAME="));
  if (line === undefined) return `${type} ${release}`;
  const pretty = line.slice("PRETTY_NAME=".length).replace(/^"(.*)"$/, "$1");
  return `${pretty}, kernel ${release}`;
}

/** `SQLite 3.53.4 (better-sqlite3 13.0.3)` (D9). */
export function formatSqlite(sqlite: string, betterSqlite3: string): string {
  return `SQLite ${sqlite} (better-sqlite3 ${betterSqlite3})`;
}

/** Total memory in GiB with one decimal and a comma: `18,9 GiB` (D8). */
export function formatMemory(bytes: number): string {
  return `${(bytes / 2 ** 30).toFixed(1).replace(".", ",")} GiB`;
}

/**
 * The paths of `git status --porcelain=v1 -z --no-renames` stdout: each entry
 * is `XY <path>` ending in NUL.
 */
export function changedPaths(porcelain: string): string[] {
  if (porcelain !== "" && !porcelain.endsWith("\0")) {
    throw new RangeError(
      `git status: output does not end in NUL (got ${JSON.stringify(porcelain)})`,
    );
  }
  const entries = porcelain.split("\0");
  entries.pop(); // empty: the final NUL was checked above
  return entries.map((entry) => entry.slice(3));
}

/** The generated file itself never counts as a change (D9). */
export const RESULTS_PATH = "docs/resultados.md";

/** Whether the tree has a change other than `docs/resultados.md` (D9). */
export function isDirty(paths: string[]): boolean {
  return paths.some((path) => path !== RESULTS_PATH);
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

/** One finished run of the measurement and its summary. */
export interface MeasuredRun extends PlannedRun {
  summary: RunSummary;
}

/** The measured machine (D8); no hostname. */
export interface Machine {
  cpuModel: string;
  cpuCount: number;
  memoryBytes: number;
  /** Already built by osName. */
  system: string;
}

/** The versions (D9), each already as shown. */
export interface Versions {
  /** `process.version`, e.g. `v26.12.0`. */
  node: string;
  /** `git --version` without the newline, e.g. `git version 2.56.0`. */
  git: string;
  /** Built by formatSqlite. */
  sqlite: string;
}

/** Everything docs/resultados.md is built from. */
export interface ResultsInput {
  /** When the measurement ended (local time). */
  when: Date;
  /** Short hash of HEAD. */
  commit: string;
  /** The tree had changes other than docs/resultados.md (isDirty). */
  dirty: boolean;
  machine: Machine;
  versions: Versions;
  /** The 30 runs, in any order. */
  runs: MeasuredRun[];
}

/**
 * docs/resultados.md before prettier: header with date and commit (and the
 * warning), machine and versions, time table, count table and caveats.
 */
export function formatResults(input: ResultsInput): string {
  const { when, commit, dirty, machine, versions } = input;
  const groups = groupRuns(input.runs);

  const timeRows = groups.map(({ scenario, system, summaries }) => {
    const stats = timeStats(summaries.map((summary) => summary.totalMs));
    return `| ${scenario} | ${system} | ${stats.values.join(", ")} | ${stats.mean} | ${stats.median} | ${stats.min}–${stats.max} |`;
  });

  const countRows = groups.map(({ scenario, system, summaries }) => {
    const cells = [
      formatCount(summaries.map((summary) => summary.accepted)),
      formatCount(summaries.map((summary) => summary.rejections)),
      formatCount(summaries.map((summary) => summary.attempts)),
      formatCount(summaries.map((summary) => summary.reparents)),
      formatCount(summaries.map((summary) => summary.conflicts)),
    ];
    return `| ${scenario} | ${system} | ${cells.join(" | ")} |`;
  });

  const countLabels = LABELS.filter((label) => label !== "tempo total");

  const lines = [
    "# Resultados da medição",
    "",
    "<!-- Gerado por `pnpm demo:medir`; não edite à mão. Para refazer, rode `pnpm demo:medir`. -->",
    "",
    `Medido em ${formatTimestamp(when)}.`,
    "",
    `Commit medido: \`${commit}\`.`,
    ...(dirty
      ? [
          "",
          `> Aviso: a árvore tinha mudanças não commitadas; o commit \`${commit}\` não descreve todo o código medido.`,
        ]
      : []),
    "",
    "## Máquina e versões",
    "",
    `- Processador: ${machine.cpuModel} (${machine.cpuCount} CPUs)`,
    `- Memória: ${formatMemory(machine.memoryBytes)}`,
    `- Sistema: ${machine.system}`,
    `- Node: ${versions.node}`,
    `- Git: ${versions.git}`,
    `- ${versions.sqlite}`,
    "",
    "## Tempo total",
    "",
    `Cada cenário rodou ${ROUNDS} vezes em cada sistema, no modo rápido, em rodadas intercaladas. O tempo de cada execução, em ms, vai da liberação da barreira até o último agente terminar.`,
    "",
    "Média e mediana são calculadas sobre os valores brutos e arredondadas para ms inteiros só no fim; os valores de cada execução e o mínimo–máximo aparecem arredondados um a um.",
    "",
    "| Cenário | Sistema | Execuções (ms) | Média | Mediana | Mínimo–máximo |",
    "| --- | --- | --- | ---: | ---: | --- |",
    ...timeRows,
    "",
    "## Contagens",
    "",
    `Um valor quando as ${ROUNDS} execuções concordam; senão, o mínimo–máximo e os ${ROUNDS} valores, na ordem das rodadas.`,
    "",
    `| Cenário | Sistema | ${countLabels.join(" | ")} |`,
    `| --- | --- |${" ---: |".repeat(countLabels.length)}`,
    ...countRows,
    "",
    "## Ressalvas",
    "",
    ...CAVEATS.map((caveat) => `- ${caveat}`),
    "",
  ];
  return lines.join("\n");
}

/** The caveats of issue #21, one per bullet. */
const CAVEATS = [
  "O repositório central do git roda na mesma máquina, sem rede, o que favorece o git no tempo.",
  "Uma máquina só; os números não valem para outra máquina.",
  "As 30 execuções rodam num processo só. O servidor do Sprout é um processo filho novo a cada execução e o trabalho do git é feito por processos `git`; só o código do lado do cliente (os agentes) fica aquecido depois da primeira execução. Nenhuma execução foi descartada.",
  "O tempo total vai da liberação da barreira até o último agente terminar. No git, inclui o lançamento dos processos `git push`, que se espalha por cerca de 30 ms (`docs/demo.md` §3); no Sprout, o pedido HTTP local até o corpo da resposta lido.",
  "A preparação, o título e a conferência da `main` ficam fora do tempo medido.",
  "Com 5 amostras, a variação é dada pelo mínimo–máximo, sem desvio padrão; média e mediana são arredondadas só no fim.",
  "Os agentes são rotinas com roteiro fixo, não modelos de IA.",
];

/**
 * `md` formatted by prettier with the repo config for `filepath` (D10), so
 * the written file passes `pnpm format:check` as is.
 */
export async function formatMarkdown(
  md: string,
  filepath: string,
): Promise<string> {
  const config = await resolveConfig(filepath);
  return format(md, { ...config, filepath });
}

/** The runs of one scenario and system, by round. */
interface RunGroup {
  scenario: ScenarioId;
  system: System;
  summaries: RunSummary[];
}

/** The runs grouped in table order (A git, A sprout, …), each by round. */
function groupRuns(runs: MeasuredRun[]): RunGroup[] {
  const groups: RunGroup[] = [];
  for (const scenario of ["A", "B", "C"] as const) {
    for (const system of ["git", "sprout"] as const) {
      const summaries = runs
        .filter((run) => run.scenario === scenario && run.system === system)
        .sort((a, b) => a.round - b.round)
        .map((run) => run.summary);
      groups.push({ scenario, system, summaries });
    }
  }
  return groups;
}
