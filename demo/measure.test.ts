import { describe, expect, it } from "vitest";
import type { RunSummary } from "./metrics.js";
import {
  changedPaths,
  formatCount,
  formatMemory,
  formatProgress,
  formatResults,
  formatSqlite,
  isDirty,
  type MeasuredRun,
  measurementPlan,
  median,
  osName,
  type ResultsInput,
  timeStats,
} from "./measure.js";
import type { System } from "./results.js";
import type { ScenarioId } from "./scenarios.js";

describe("median", () => {
  it("is the middle value of an odd count", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("is the mean of the two middle values of an even count", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("timeStats (D6)", () => {
  it("rounds the mean only at the end", () => {
    // Raw mean 10.8 → 11; the mean of the rounded values would be 10.4 → 10.
    expect(timeStats([10.4, 10.4, 10.4, 10.4, 12.4])).toEqual({
      values: [10, 10, 10, 10, 12],
      mean: 11,
      median: 10,
      min: 10,
      max: 12,
    });
  });

  it("refuses an empty list", () => {
    expect(() => timeStats([])).toThrow(RangeError);
  });
});

describe("formatCount (D7)", () => {
  it("shows one value when the 5 runs agree", () => {
    expect(formatCount([10, 10, 10, 10, 10])).toBe("10");
  });

  it("shows min–max and the 5 values when the runs differ", () => {
    expect(formatCount([45, 44, 45, 45, 43])).toBe(
      "43–45 (45, 44, 45, 45, 43)",
    );
  });

  it("shows - when every value is null (git reparents)", () => {
    expect(formatCount([null, null, null, null, null])).toBe("-");
  });

  it("refuses a list mixing null and numbers", () => {
    expect(() => formatCount([null, 1, 1, 1, 1])).toThrow(RangeError);
  });
});

describe("measurementPlan (D4)", () => {
  it("has 30 runs interleaved by round", () => {
    const plan = measurementPlan();

    expect(plan).toHaveLength(30);
    expect(plan.slice(0, 7)).toEqual([
      { round: 1, system: "git", scenario: "A" },
      { round: 1, system: "sprout", scenario: "A" },
      { round: 1, system: "git", scenario: "B" },
      { round: 1, system: "sprout", scenario: "B" },
      { round: 1, system: "git", scenario: "C" },
      { round: 1, system: "sprout", scenario: "C" },
      { round: 2, system: "git", scenario: "A" },
    ]);
    expect(plan[29]).toEqual({ round: 5, system: "sprout", scenario: "C" });
    expect(plan.filter((run) => run.system === "git")).toHaveLength(15);
  });
});

describe("formatProgress (D14)", () => {
  it("shows the run number and the rounded total time", () => {
    expect(formatProgress(7, 30, "git", "B", 1231.6)).toBe(
      "[7/30] git B: 1232 ms",
    );
  });
});

describe("osName (D8)", () => {
  it("uses PRETTY_NAME and the kernel", () => {
    expect(
      osName(
        'NAME="Arch Linux"\nPRETTY_NAME="Omarchy 3.2"\n',
        "Linux",
        "7.2.15-1-omarchy",
      ),
    ).toBe("Omarchy 3.2, kernel 7.2.15-1-omarchy");
  });

  it("falls back to os.type() and os.release() without /etc/os-release", () => {
    expect(osName(null, "Darwin", "25.1.0")).toBe("Darwin 25.1.0");
  });
});

describe("formatSqlite (D9)", () => {
  it("shows the SQLite version and the better-sqlite3 version", () => {
    expect(formatSqlite("3.53.4", "13.0.3")).toBe(
      "SQLite 3.53.4 (better-sqlite3 13.0.3)",
    );
  });
});

describe("formatMemory (D8)", () => {
  it("shows GiB with one decimal and a comma", () => {
    expect(formatMemory(20268797952)).toBe("18,9 GiB");
  });
});

describe("changedPaths (D9)", () => {
  it("reads the paths of git status --porcelain=v1 -z", () => {
    expect(changedPaths("M  demo/x.ts\0?? docs/resultados.md\0")).toEqual([
      "demo/x.ts",
      "docs/resultados.md",
    ]);
    expect(changedPaths("")).toEqual([]);
  });

  it("refuses an output that does not end in NUL", () => {
    expect(() => changedPaths("M  demo/x.ts")).toThrow(RangeError);
  });
});

describe("isDirty (D9)", () => {
  it("ignores docs/resultados.md", () => {
    expect(isDirty(["docs/resultados.md"])).toBe(false);
  });

  it("is true with another changed file", () => {
    expect(isDirty(["docs/resultados.md", "demo/x.ts"])).toBe(true);
  });
});

// Counts and the 5 total times of each scenario and system, written by hand.
// git B: 1213, 1250, 1180, 1300, 1222 → mean 6165 / 5 = 1233, median 1222.
type Base = Omit<RunSummary, "totalMs"> & { times: number[] };
const BASES: Record<`${System} ${ScenarioId}`, Base> = {
  "git A": {
    accepted: 2,
    rejections: 1,
    attempts: 3,
    reparents: null,
    conflicts: 0,
    times: [41, 45, 39, 40, 42],
  },
  "sprout A": {
    accepted: 2,
    rejections: 0,
    attempts: 2,
    reparents: 1,
    conflicts: 0,
    times: [9, 8, 10, 9, 9],
  },
  "git B": {
    accepted: 10,
    rejections: 45,
    attempts: 55,
    reparents: null,
    conflicts: 0,
    times: [1213, 1250, 1180, 1300, 1222],
  },
  "sprout B": {
    accepted: 10,
    rejections: 0,
    attempts: 10,
    reparents: 9,
    conflicts: 0,
    times: [110, 121, 98, 130, 105],
  },
  "git C": {
    accepted: 1,
    rejections: 1,
    attempts: 3,
    reparents: null,
    conflicts: 1,
    times: [60, 62, 58, 61, 59],
  },
  "sprout C": {
    accepted: 1,
    rejections: 0,
    attempts: 2,
    reparents: 0,
    conflicts: 1,
    times: [8, 7, 9, 8, 8],
  },
};

function fixtureRuns(): MeasuredRun[] {
  return measurementPlan().map((run) => {
    const { times, ...counts } = BASES[`${run.system} ${run.scenario}`];
    return {
      ...run,
      summary: { ...counts, totalMs: times[run.round - 1] },
    };
  });
}

function fixtureInput(overrides: Partial<ResultsInput> = {}): ResultsInput {
  return {
    when: new Date(2026, 10, 18, 14, 30, 45),
    commit: "9891810",
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

const ROW = /^\| [ABC] \| (git|sprout) \|/;

describe("formatResults", () => {
  it("has one time row per scenario and system (T17)", () => {
    const md = formatResults(fixtureInput());

    expect(
      countLine(
        md,
        "| B | git | 1213, 1250, 1180, 1300, 1222 | 1233 | 1222 | 1180–1300 |",
      ),
    ).toBe(1);
    expect(
      section(md, "## Tempo total").filter((line) => ROW.test(line)),
    ).toHaveLength(6);
  });

  it("has one count row per scenario and system (T18)", () => {
    const md = formatResults(fixtureInput());

    expect(countLine(md, "| B | git | 10 | 45 | 55 | - | 0 |")).toBe(1);
    expect(
      section(md, "## Contagens").filter((line) => ROW.test(line)),
    ).toHaveLength(6);

    // git B with 44 rejections in round 2 only.
    const runs = fixtureRuns().map((run) =>
      run.round === 2 && run.system === "git" && run.scenario === "B"
        ? { ...run, summary: { ...run.summary, rejections: 44 } }
        : run,
    );
    const differing = formatResults(fixtureInput({ runs }));
    expect(
      countLine(
        differing,
        "| B | git | 10 | 44–45 (45, 44, 45, 45, 45) | 55 | - | 0 |",
      ),
    ).toBe(1);
  });

  it("lists the machine and versions, without hostname (T19)", () => {
    const md = formatResults(fixtureInput());

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

  it("shows the commit without warning on a clean tree (T20)", () => {
    const md = formatResults(fixtureInput());

    expect(countLine(md, "Commit medido: `9891810`.")).toBe(1);
    expect(
      md.split("\n").filter((line) => line.startsWith("> Aviso:")),
    ).toHaveLength(0);
  });

  it("shows the warning on a dirty tree (T21)", () => {
    const md = formatResults(fixtureInput({ dirty: true }));

    expect(
      countLine(
        md,
        "> Aviso: a árvore tinha mudanças não commitadas; o commit `9891810` não descreve todo o código medido.",
      ),
    ).toBe(1);
  });

  it("explains the rounding and lists the 7 caveats (T22)", () => {
    const md = formatResults(fixtureInput());

    expect(
      countLine(
        md,
        "Média e mediana são calculadas sobre os valores brutos e arredondadas para ms inteiros só no fim; os valores de cada execução e o mínimo–máximo aparecem arredondados um a um.",
      ),
    ).toBe(1);
    expect(
      section(md, "## Ressalvas").filter((line) => line.startsWith("- ")),
    ).toHaveLength(7);
  });

  it("shows the date and time of the measurement (T24)", () => {
    const md = formatResults(fixtureInput());

    expect(countLine(md, "Medido em 18/11/2026 14:30.")).toBe(1);
  });
});
