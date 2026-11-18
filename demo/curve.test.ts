import { join } from "node:path";
import { check, resolveConfig } from "prettier";
import { describe, expect, it } from "vitest";
import {
  type CurveInput,
  curvePlan,
  curveScenario,
  formatCurve,
  formatCurveProgress,
  type MeasuredCurveRun,
} from "./curve.js";
import { formatMarkdown, isDirty } from "./measure.js";
import type { System } from "./results.js";

describe("isDirty with the ignored path (#50, D5)", () => {
  it("ignores the path it is given (I1)", () => {
    expect(isDirty(["docs/curva.md"], "docs/curva.md")).toBe(false);
  });

  it("replaces the default path instead of adding to it (I2)", () => {
    expect(
      isDirty(["docs/curva.md", "docs/resultados.md"], "docs/curva.md"),
    ).toBe(true);
  });
});

describe("curveScenario (D2)", () => {
  it("is scenario B with N agents in different files (K1)", () => {
    expect(curveScenario(10)).toEqual({
      id: "B",
      agents: 10,
      sameFile: false,
    });
  });
});

describe("curvePlan (D6)", () => {
  it("has 24 runs interleaved by round, N increasing, git first (K2)", () => {
    const plan = curvePlan();

    // 4 values of N × 2 systems × 3 rounds.
    expect(plan).toHaveLength(24);
    // The 7th run is round 1, git N=20: the [7/24] git N=10 of D11 is only
    // a format example (A6 of #21).
    expect(plan.slice(0, 9)).toEqual([
      { round: 1, system: "git", n: 2 },
      { round: 1, system: "sprout", n: 2 },
      { round: 1, system: "git", n: 5 },
      { round: 1, system: "sprout", n: 5 },
      { round: 1, system: "git", n: 10 },
      { round: 1, system: "sprout", n: 10 },
      { round: 1, system: "git", n: 20 },
      { round: 1, system: "sprout", n: 20 },
      { round: 2, system: "git", n: 2 },
    ]);
    expect(plan[23]).toEqual({ round: 3, system: "sprout", n: 20 });
    expect(plan.filter((run) => run.system === "git")).toHaveLength(12);
    expect(plan.filter((run) => run.n === 20)).toHaveLength(6);
  });
});

describe("formatCurveProgress (D11)", () => {
  it("shows the run number, N and the rounded total time (K3)", () => {
    // 2864.6 rounds to 2865; Math.floor would give 2864.
    expect(formatCurveProgress(7, 24, "git", 20, 2864.6)).toBe(
      "[7/24] git N=20: 2865 ms",
    );
  });
});

// Attempts and total times of each system and N, by round, written by hand.
// git N=20 uses the 3 runs of phase 1 of issue #50
// (https://github.com/ArturCousseau/sprout/issues/50#issuecomment-6991274660):
// 177, 183, 176 attempts and 2865, 2717, 2714 ms → mean 8296 / 3 = 2765.3 →
// 2765. Sprout N=20: 190, 201, 185 ms → mean 576 / 3 = 192.
interface Base {
  attempts: number[];
  times: number[];
}
const BASES: Record<`${System} ${number}`, Base> = {
  "git 2": { attempts: [3, 3, 3], times: [140, 138, 141] },
  "sprout 2": { attempts: [2, 2, 2], times: [25, 30, 26] },
  "git 5": { attempts: [15, 15, 14], times: [480, 510, 495] },
  "sprout 5": { attempts: [5, 5, 5], times: [40, 42, 39] },
  "git 10": { attempts: [55, 55, 55], times: [1080, 1040, 1075] },
  "sprout 10": { attempts: [10, 10, 10], times: [90, 88, 97] },
  "git 20": { attempts: [177, 183, 176], times: [2865, 2717, 2714] },
  "sprout 20": { attempts: [20, 20, 20], times: [190, 201, 185] },
};

function fixtureRuns(): MeasuredCurveRun[] {
  return curvePlan().map((run) => {
    const { attempts, times } = BASES[`${run.system} ${run.n}`];
    const tries = attempts[run.round - 1];
    return {
      ...run,
      summary: {
        accepted: run.n,
        rejections: tries - run.n,
        attempts: tries,
        reparents: run.system === "git" ? null : run.n - 1,
        conflicts: 0,
        totalMs: times[run.round - 1],
      },
    };
  });
}

function fixtureInput(overrides: Partial<CurveInput> = {}): CurveInput {
  return {
    when: new Date(2026, 10, 18, 14, 30, 45),
    commit: "cb26b14",
    dirty: false,
    machine: {
      cpuModel: "AMD Ryzen 7 5700U with Radeon Graphics",
      cpuCount: 16,
      memoryBytes: 20268797952,
      system: "Omarchy 3.2, kernel 7.2.15-1-omarchy",
    },
    versions: {
      node: "v26.12.0",
      git: "git version 2.56.0",
      sqlite: "SQLite 3.53.4 (better-sqlite3 13.0.3)",
    },
    runs: fixtureRuns(),
    ...overrides,
  };
}

/** How many lines of `text` are exactly `line`. */
function countLine(text: string, line: string): number {
  return text.split("\n").filter((entry) => entry === line).length;
}

/** The lines of `text` from the `start` heading up to the next heading. */
function section(text: string, start: string): string[] {
  const lines = text.split("\n");
  const from = lines.indexOf(start);
  const rest = lines.slice(from + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

const DATA_ROW = /^\| \d+ \|/;

describe("formatCurve (D9)", () => {
  it("has one row per N, in increasing order, with the ceiling (K4)", () => {
    const md = formatCurve(fixtureInput());

    expect(
      countLine(
        md,
        "| 20 | 210 | 176–183 (177, 183, 176) | 20 | 2765 | 2714–2865 | 192 | 185–201 |",
      ),
    ).toBe(1);
    // git 480, 510, 495 → 495; Sprout 40, 42, 39 → 121 / 3 = 40.3 → 40.
    expect(
      countLine(
        md,
        "| 5 | 15 | 14–15 (15, 15, 14) | 5 | 495 | 480–510 | 40 | 39–42 |",
      ),
    ).toBe(1);
    // N and the ceiling N(N+1)/2: 2·3/2, 5·6/2, 10·11/2, 20·21/2.
    const rows = section(md, "## Curva").filter((line) => DATA_ROW.test(line));
    expect(rows.map((row) => row.split(" | ").slice(0, 2).join(" | "))).toEqual(
      ["| 2 | 3", "| 5 | 15", "| 10 | 55", "| 20 | 210"],
    );
  });

  it("shows the date and the commit, without warning on a clean tree (K5)", () => {
    const md = formatCurve(fixtureInput());

    expect(countLine(md, "Medido em 18/11/2026 14:30.")).toBe(1);
    expect(countLine(md, "Commit medido: `cb26b14`.")).toBe(1);
    expect(
      md.split("\n").filter((line) => line.startsWith("> Aviso:")),
    ).toHaveLength(0);
  });

  it("shows the warning on a dirty tree (K5)", () => {
    const md = formatCurve(fixtureInput({ dirty: true }));

    expect(
      countLine(
        md,
        "> Aviso: a árvore tinha mudanças não commitadas; o commit `cb26b14` não descreve todo o código medido.",
      ),
    ).toBe(1);
  });

  it("lists the machine and versions, without hostname (K5)", () => {
    const md = formatCurve(fixtureInput());

    for (const line of [
      "- Processador: AMD Ryzen 7 5700U with Radeon Graphics (16 CPUs)",
      "- Memória: 18,9 GiB",
      "- Sistema: Omarchy 3.2, kernel 7.2.15-1-omarchy",
      "- Node: v26.12.0",
      "- Git: git version 2.56.0",
      "- SQLite 3.53.4 (better-sqlite3 13.0.3)",
    ]) {
      expect(countLine(md, line), line).toBe(1);
    }
    expect(
      section(md, "## Máquina e versões").filter((line) =>
        line.startsWith("- "),
      ),
    ).toHaveLength(6);
  });

  it("lists the 10 caveats of the issue (K6)", () => {
    const md = formatCurve(fixtureInput());

    const caveats = [
      "- O repositório central do git roda na mesma máquina, sem rede, o que favorece o git no tempo.",
      "- Uma máquina só; os números não valem para outra máquina.",
      "- Todas as execuções rodam num processo só. O servidor do Sprout é um processo filho novo a cada execução e o trabalho do git é feito por processos `git`; só o código do lado do cliente (os agentes) fica aquecido depois da primeira execução. Nenhuma execução foi descartada.",
      "- O teto N(N+1)/2 é o pior caso legítimo do git, não o valor esperado: uma execução pode ficar abaixo dele (`docs/demo.md` §3).",
      "- No Sprout, as tentativas são estruturais: cada agente faz um único pedido, sem nova tentativa, então o valor é sempre N.",
      "- O tempo total vai da liberação da barreira até o último agente terminar. No git, inclui o lançamento dos processos `git push`, um depois do outro, cerca de 3,7 ms cada (`docs/demo.md` §3); no Sprout, o pedido HTTP local até o corpo da resposta lido.",
      "- A preparação, o título e a conferência da `main` ficam fora do tempo medido.",
      "- Com 3 amostras por N e sistema, a variação é dada pelo mínimo–máximo, sem desvio padrão; a média é arredondada só no fim.",
      '- Cada execução é o cenário B com N agentes: por dentro, o título diz "cenário B" e os JSON se chamam `git-B.json` e `sprout-B.json`, em `demo/tmp/curva/resultados/`. Nada disso aparece na saída nem é lido.',
      "- Os agentes são rotinas com roteiro fixo, não modelos de IA.",
    ];
    for (const caveat of caveats) {
      expect(countLine(md, caveat), caveat).toBe(1);
    }
    expect(
      section(md, "## Ressalvas").filter((line) => line.startsWith("- ")),
    ).toHaveLength(10);
  });
});

describe("formatCurve with formatMarkdown (D12)", () => {
  it("gives Markdown that prettier's check accepts with the repo config (K7)", async () => {
    const filepath = join(import.meta.dirname, "..", "docs", "curva.md");

    const formatted = await formatMarkdown(
      formatCurve(fixtureInput()),
      filepath,
    );

    const config = await resolveConfig(filepath);
    expect(await check(formatted, { ...config, filepath })).toBe(true);
  });
});
