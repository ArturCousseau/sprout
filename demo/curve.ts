import { maxGitAttempts } from "./git.js";
import {
  formatCount,
  formatMemory,
  type Machine,
  timeStats,
  type Versions,
} from "./measure.js";
import type { RunSummary } from "./metrics.js";
import type { System } from "./results.js";
import type { Scenario } from "./scenarios.js";
import { formatTimestamp } from "./scoreboard.js";

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

/** One finished run of the curve and its summary. */
export interface MeasuredCurveRun extends PlannedCurveRun {
  summary: RunSummary;
}

/** Everything docs/curva.md is built from. */
export interface CurveInput {
  /** When the curve ended (local time). */
  when: Date;
  /** Short hash of HEAD. */
  commit: string;
  /** The tree had changes other than docs/curva.md (isDirty). */
  dirty: boolean;
  machine: Machine;
  versions: Versions;
  /** The 24 runs, in any order. */
  runs: MeasuredCurveRun[];
}

/**
 * docs/curva.md before prettier: header with date and commit (and the
 * warning), machine and versions, the curve table and the caveats.
 */
export function formatCurve(input: CurveInput): string {
  const { when, commit, dirty, machine, versions } = input;

  const rows = CURVE_N.map((n) => {
    const git = summariesOf(input.runs, "git", n);
    const sprout = summariesOf(input.runs, "sprout", n);
    const gitTime = timeStats(git.map((summary) => summary.totalMs));
    const sproutTime = timeStats(sprout.map((summary) => summary.totalMs));
    const cells = [
      String(n),
      String(maxGitAttempts(n)),
      formatCount(git.map((summary) => summary.attempts)),
      formatCount(sprout.map((summary) => summary.attempts)),
      String(gitTime.mean),
      `${gitTime.min}–${gitTime.max}`,
      String(sproutTime.mean),
      `${sproutTime.min}–${sproutTime.max}`,
    ];
    return `| ${cells.join(" | ")} |`;
  });

  const lines = [
    "# Curva N × tentativas",
    "",
    "<!-- Gerado por `pnpm demo:curva`; não edite à mão. Para refazer, rode `pnpm demo:curva`. -->",
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
    "## Curva",
    "",
    `Cada N rodou ${CURVE_ROUNDS} vezes em cada sistema, no modo rápido, com cada agente no seu próprio arquivo, em rodadas intercaladas. O tempo de cada execução, em ms, vai da liberação da barreira até o último agente terminar.`,
    "",
    `Tentativas: um valor quando as ${CURVE_ROUNDS} execuções concordam; senão, o mínimo–máximo e os ${CURVE_ROUNDS} valores, na ordem das rodadas.`,
    "",
    "| N | Teto do git | Tentativas no git | Tentativas no Sprout | Tempo do git (média) | Tempo do git (mínimo–máximo) | Tempo do Sprout (média) | Tempo do Sprout (mínimo–máximo) |",
    "| ---: | ---: | --- | ---: | ---: | --- | ---: | --- |",
    ...rows,
    "",
    "## Ressalvas",
    "",
    ...CAVEATS.map((caveat) => `- ${caveat}`),
    "",
  ];
  return lines.join("\n");
}

/** The caveats of issue #50, one per bullet. */
const CAVEATS = [
  "O repositório central do git roda na mesma máquina, sem rede, o que favorece o git no tempo.",
  "Uma máquina só; os números não valem para outra máquina.",
  "Todas as execuções rodam num processo só. O servidor do Sprout é um processo filho novo a cada execução e o trabalho do git é feito por processos `git`; só o código do lado do cliente (os agentes) fica aquecido depois da primeira execução. Nenhuma execução foi descartada.",
  "O teto N(N+1)/2 é o pior caso legítimo do git, não o valor esperado: uma execução pode ficar abaixo dele (`docs/demo.md` §3).",
  "No Sprout, as tentativas são estruturais: cada agente faz um único pedido, sem nova tentativa, então o valor é sempre N.",
  "O tempo total vai da liberação da barreira até o último agente terminar. No git, inclui o lançamento dos processos `git push`, um depois do outro, cerca de 3,7 ms cada (`docs/demo.md` §3); no Sprout, o pedido HTTP local até o corpo da resposta lido.",
  "A preparação, o título e a conferência da `main` ficam fora do tempo medido.",
  "Com 3 amostras por N e sistema, a variação é dada pelo mínimo–máximo, sem desvio padrão; a média é arredondada só no fim.",
  'Cada execução é o cenário B com N agentes: por dentro, o título diz "cenário B" e os JSON se chamam `git-B.json` e `sprout-B.json`, em `demo/tmp/curva/resultados/`. Nada disso aparece na saída nem é lido.',
  "Os agentes são rotinas com roteiro fixo, não modelos de IA.",
];

/** The summaries of one system and N, by round. */
function summariesOf(
  runs: MeasuredCurveRun[],
  system: System,
  n: number,
): RunSummary[] {
  return runs
    .filter((run) => run.system === system && run.n === n)
    .sort((a, b) => a.round - b.round)
    .map((run) => run.summary);
}
