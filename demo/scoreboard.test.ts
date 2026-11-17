import { describe, expect, it } from "vitest";
import { visibleWidth } from "./color.js";
import type { RunSummary } from "./metrics.js";
import { SCENARIOS } from "./scenarios.js";
import {
  formatColumn,
  formatRunTitle,
  formatScoreboard,
  formatSeparator,
  formatSummaryLine,
  formatTable,
  formatTimestamp,
  scenarioTitle,
} from "./scoreboard.js";

// Written by hand: a git B run (55 attempts, 45 rejections) and a Sprout B
// run (9 reparents). The times end in .5 and .4 to pin the rounding (C3).
const gitB: RunSummary = {
  accepted: 10,
  rejections: 45,
  attempts: 55,
  reparents: null,
  conflicts: 0,
  totalMs: 1212.5,
};

const sproutB: RunSummary = {
  accepted: 10,
  rejections: 0,
  attempts: 10,
  reparents: 9,
  conflicts: 0,
  totalMs: 110.4,
};

// Written by hand: scenario C. git agent 2 is rejected once, hits the conflict
// in the rebase and gives up without a second push (D5 of #15): 2 attempts.
const gitC: RunSummary = {
  accepted: 1,
  rejections: 1,
  attempts: 2,
  reparents: null,
  conflicts: 1,
  totalMs: 40.5,
};

const sproutC: RunSummary = {
  accepted: 1,
  rejections: 0,
  attempts: 2,
  reparents: 0,
  conflicts: 1,
  totalMs: 5,
};

describe("formatColumn", () => {
  it("git: reparents null is '-', time rounded up from .5 (C3, C4)", () => {
    expect(formatColumn(gitB)).toEqual(["10", "45", "55", "-", "0", "1213 ms"]);
  });

  it("sprout: reparents is a number, time rounded down from .4 (C4)", () => {
    expect(formatColumn(sproutB)).toEqual([
      "10",
      "0",
      "10",
      "9",
      "0",
      "110 ms",
    ]);
  });

  it.each([
    [0, "0 ms"],
    [110.4, "110 ms"],
    [110.5, "111 ms"],
    [1212.5, "1213 ms"],
    [12345.6, "12346 ms"],
  ])("totalMs %d → %s (whole ms, no thousands separator)", (totalMs, cell) => {
    expect(formatColumn({ ...sproutB, totalMs }).at(-1)).toBe(cell);
  });
});

describe("formatSummaryLine (R8)", () => {
  it("git", () => {
    expect(formatSummaryLine("git", gitB)).toBe(
      "[git] resumo: aceitos 10, rejeições 45, tentativas 55, trocas de pai -, conflitos reais 0, tempo total 1213 ms",
    );
  });

  it("sprout", () => {
    expect(formatSummaryLine("sprout", sproutB)).toBe(
      "[sprout] resumo: aceitos 10, rejeições 0, tentativas 10, trocas de pai 9, conflitos reais 0, tempo total 110 ms",
    );
  });

  // Guard R7 of #20: the worst case that still fits the 111-column ceiling,
  // git up to 9999 ms and Sprout up to 999 ms. Green when written; its red
  // is checked by mutation M9.
  it.each([
    [
      "git",
      { ...gitB, totalMs: 9999 },
      "[git] resumo: aceitos 10, rejeições 45, tentativas 55, trocas de pai -, conflitos reais 0, tempo total 9999 ms",
    ],
    [
      "sprout",
      { ...sproutB, totalMs: 999 },
      "[sprout] resumo: aceitos 10, rejeições 0, tentativas 10, trocas de pai 9, conflitos reais 0, tempo total 999 ms",
    ],
  ] as const)(
    "R7 worst case, %s: fits 111 columns",
    (system, summary, line) => {
      const summaryLine = formatSummaryLine(system, summary);

      expect(summaryLine).toBe(line);
      expect(visibleWidth(summaryLine)).toBeLessThanOrEqual(111);
    },
  );
});

describe("scenarioTitle (D2, C2)", () => {
  it.each([
    ["A", "Cenário A: 2 agentes, arquivos diferentes"],
    ["B", "Cenário B: 10 agentes, arquivos diferentes"],
    ["C", "Cenário C: 2 agentes, mesmo arquivo"],
  ] as const)("scenario %s", (id, title) => {
    expect(scenarioTitle(SCENARIOS[id])).toBe(title);
  });
});

describe("formatRunTitle (#20, D4)", () => {
  // Written by hand: the titles of section 1 of the plan of #20.
  it.each([
    ["git", "A", "passo a passo", "━━ git · cenário A · passo a passo ━━"],
    [
      "sprout",
      "C",
      "passo a passo",
      "━━ sprout · cenário C · passo a passo ━━",
    ],
    ["git", "B", "modo rápido", "━━ git · cenário B · modo rápido ━━"],
    ["sprout", "B", "modo rápido", "━━ sprout · cenário B · modo rápido ━━"],
  ] as const)("%s %s %s, no color", (system, scenario, mode, title) => {
    expect(formatRunTitle(system, scenario, mode)).toBe(title);
  });

  it("with color: dim ━━ and bold text, side by side, never nested", () => {
    expect(formatRunTitle("git", "A", "passo a passo", true)).toBe(
      "\x1b[2m━━\x1b[22m \x1b[1mgit · cenário A · passo a passo\x1b[22m \x1b[2m━━\x1b[22m",
    );
  });
});

describe("formatSeparator (#20, D4)", () => {
  // Written by hand: as wide as the fast-mode title of the same system.
  it("git: 35 ━, the width of its title", () => {
    expect(formatSeparator("git", "B")).toBe(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    );
  });

  it("sprout: 38 ━, the width of its title", () => {
    expect(formatSeparator("sprout", "B")).toBe(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    );
  });

  it("with color: the whole separator dim", () => {
    expect(formatSeparator("git", "B", true)).toBe(
      "\x1b[2m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[22m",
    );
  });
});

describe("formatTable (D2, R9)", () => {
  // Written by hand. Labels padded to 15 ("conflitos reais"), a 4-space gap,
  // each value column as wide as its widest text, aligned right.
  it("scenario B: git column set by '1213 ms', sprout by 'sprout'", () => {
    expect(formatTable(gitB, sproutB)).toEqual([
      "                       git    sprout",
      "aceitos                 10        10",
      "rejeições               45         0",
      "tentativas              55        10",
      "trocas de pai            -         9",
      "conflitos reais          0         0",
      "tempo total        1213 ms    110 ms",
    ]);
  });

  it("scenario C: narrower git column, sprout set by its header", () => {
    expect(formatTable(gitC, sproutC)).toEqual([
      "                     git    sprout",
      "aceitos                1         1",
      "rejeições              1         0",
      "tentativas             2         2",
      "trocas de pai          -         0",
      "conflitos reais        1         1",
      "tempo total        41 ms      5 ms",
    ]);
  });
});

describe("formatTimestamp (D4, C5)", () => {
  // Dates built with the local constructor and read with the local getters:
  // the same in any time zone (R6). Neither falls on a DST change.
  it("dd/mm/aaaa HH:MM", () => {
    expect(formatTimestamp(new Date(2026, 10, 12, 23, 44))).toBe(
      "12/11/2026 23:44",
    );
  });

  it("pads with zeros and drops the seconds without rounding", () => {
    expect(formatTimestamp(new Date(2026, 0, 5, 7, 3, 59))).toBe(
      "05/01/2026 07:03",
    );
  });
});

describe("formatScoreboard (D2, D4)", () => {
  it("scenario B: title, table and the time of each file", () => {
    const text = formatScoreboard({
      scenario: SCENARIOS.B,
      git: gitB,
      sprout: sproutB,
      gitTime: new Date(2026, 10, 12, 23, 44),
      sproutTime: new Date(2026, 10, 13, 23, 31),
    });

    // Written by hand: the scoreboard B of the plan of #18.
    expect(text).toBe(
      [
        "Cenário B: 10 agentes, arquivos diferentes",
        "",
        "                       git    sprout",
        "aceitos                 10        10",
        "rejeições               45         0",
        "tentativas              55        10",
        "trocas de pai            -         9",
        "conflitos reais          0         0",
        "tempo total        1213 ms    110 ms",
        "",
        "resultados: git 12/11/2026 23:44, sprout 13/11/2026 23:31",
        "",
      ].join("\n"),
    );
  });
});
