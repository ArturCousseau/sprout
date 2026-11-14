import { describe, expect, it } from "vitest";
import type { RunSummary } from "./metrics.js";
import { SCENARIOS } from "./scenarios.js";
import {
  formatColumn,
  formatSummaryLine,
  formatTable,
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
