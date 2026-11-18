import { describe, expect, it } from "vitest";
import { hashContent } from "../src/core/hash.js";
import { visibleWidth } from "./color.js";
import { HarnessError } from "./harness-error.js";
import {
  checkMain,
  expectedMain,
  formatMainLine,
  type MainState,
} from "./main-check.js";
import type { AgentResult } from "./metrics.js";
import { SCENARIOS } from "./scenarios.js";

// Written by hand: the README of the git initial commit (git-agents.ts).
const README = "Repositório central da demo do Sprout.\n";

// Written by hand with `printf 'agente N\n' | sha256sum`, not with hashContent
// (the same values as sprout-agents.test.ts).
const H1 = "ebf0a5cfd5f69be2c45927bf26823df03672b0aab59e77ffedaf4fec371c7161";
const H2 = "3ae6b2f9235e1e7213e554ad7abd104870f8897a2d51771002b3281f5d53ff94";

const GIT_BASE: ReadonlyMap<string, string> = new Map([["README.md", README]]);
const SPROUT_BASE: ReadonlyMap<string, string> = new Map();
const plain = (content: string): string => content;

/** One agent's record; only `agent` and `outcome` matter here. */
function agent(n: number, outcome: AgentResult["outcome"]): AgentResult {
  return {
    agent: n,
    outcome,
    attempts: 1,
    rejections: {},
    reparented: null,
    endMs: 1,
  };
}

/** Matches exactly `message`, not a part of it. */
function exactly(message: string): RegExp {
  return new RegExp(`^${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

describe("expectedMain (D1, D2, D7)", () => {
  it("MC1 git A: README and both agents' files, 3 commits", () => {
    const agents = [agent(1, "accepted"), agent(2, "accepted")];

    expect(expectedMain(SCENARIOS.A, agents, GIT_BASE)).toEqual({
      files: new Map([
        ["README.md", README],
        ["agente-1.txt", "agente 1\n"],
        ["agente-2.txt", "agente 2\n"],
      ]),
      commits: 3,
    });
  });

  it("MC2 git B: README and the 10 agents' files, 11 commits", () => {
    const agents = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) =>
      agent(n, "accepted"),
    );

    expect(expectedMain(SCENARIOS.B, agents, GIT_BASE)).toEqual({
      files: new Map([
        ["README.md", README],
        ["agente-1.txt", "agente 1\n"],
        ["agente-2.txt", "agente 2\n"],
        ["agente-3.txt", "agente 3\n"],
        ["agente-4.txt", "agente 4\n"],
        ["agente-5.txt", "agente 5\n"],
        ["agente-6.txt", "agente 6\n"],
        ["agente-7.txt", "agente 7\n"],
        ["agente-8.txt", "agente 8\n"],
        ["agente-9.txt", "agente 9\n"],
        ["agente-10.txt", "agente 10\n"],
      ]),
      commits: 11,
    });
  });

  it.each([
    [
      "git, winner 1",
      [agent(1, "accepted"), agent(2, "conflict")],
      GIT_BASE,
      plain,
      [
        ["README.md", README],
        ["conflito.txt", "agente 1\n"],
      ],
    ],
    [
      "git, winner 2",
      [agent(1, "conflict"), agent(2, "accepted")],
      GIT_BASE,
      plain,
      [
        ["README.md", README],
        ["conflito.txt", "agente 2\n"],
      ],
    ],
    [
      "sprout, winner 1",
      [agent(1, "accepted"), agent(2, "conflict")],
      SPROUT_BASE,
      hashContent,
      [["conflito.txt", H1]],
    ],
    [
      "sprout, winner 2",
      [agent(1, "conflict"), agent(2, "accepted")],
      SPROUT_BASE,
      hashContent,
      [["conflito.txt", H2]],
    ],
  ] as const)(
    "MC3 C, %s: the winner's content, 2 commits",
    (_label, agents, base, encode, files) => {
      expect(expectedMain(SCENARIOS.C, agents, base, encode)).toEqual({
        files: new Map(files),
        commits: 2,
      });
    },
  );

  it("MC4 sprout A: hashes of both agents, no README, 3 commits", () => {
    const agents = [agent(1, "accepted"), agent(2, "accepted")];

    expect(expectedMain(SCENARIOS.A, agents, SPROUT_BASE, hashContent)).toEqual(
      {
        files: new Map([
          ["agente-1.txt", H1],
          ["agente-2.txt", H2],
        ]),
        commits: 3,
      },
    );
  });

  it.each([
    [
      "A with 1 accepted",
      SCENARIOS.A,
      [agent(1, "accepted"), agent(2, "conflict")],
      "main check: accepted agents: expected 2, got 1",
    ],
    [
      "B with 9 accepted",
      SCENARIOS.B,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) =>
        agent(n, n === 10 ? "conflict" : "accepted"),
      ),
      "main check: accepted agents: expected 10, got 9",
    ],
    [
      "C with 2 accepted",
      SCENARIOS.C,
      [agent(1, "accepted"), agent(2, "accepted")],
      "main check: accepted agents: expected 1, got 2",
    ],
    [
      "C with 0 accepted",
      SCENARIOS.C,
      [agent(1, "conflict"), agent(2, "conflict")],
      "main check: accepted agents: expected 1, got 0",
    ],
  ])("MC5 %s → HarnessError", (_label, scenario, agents, message) => {
    expect(() => expectedMain(scenario, agents, GIT_BASE)).toThrow(
      HarnessError,
    );
    expect(() => expectedMain(scenario, agents, GIT_BASE)).toThrow(
      exactly(message),
    );
  });
});

// Written by hand: the main a good git A run ends with.
const GOOD_A: MainState = {
  files: new Map([
    ["README.md", README],
    ["agente-1.txt", "agente 1\n"],
    ["agente-2.txt", "agente 2\n"],
  ]),
  commits: 3,
};

describe("checkMain (D4, D8)", () => {
  it("MC6 the same state → no error", () => {
    const actual: MainState = {
      files: new Map([
        ["README.md", README],
        ["agente-1.txt", "agente 1\n"],
        ["agente-2.txt", "agente 2\n"],
      ]),
      commits: 3,
    };

    expect(() => checkMain(GOOD_A, actual)).not.toThrow();
  });

  it.each([
    [
      "missing",
      GOOD_A,
      {
        files: new Map([
          ["README.md", README],
          ["agente-1.txt", "agente 1\n"],
        ]),
        commits: 3,
      },
      "main check: missing agente-2.txt",
    ],
    [
      "extra",
      GOOD_A,
      {
        files: new Map([
          ["README.md", README],
          ["agente-1.txt", "agente 1\n"],
          ["agente-2.txt", "agente 2\n"],
          ["intruso.txt", "intruso\n"],
        ]),
        commits: 3,
      },
      "main check: extra intruso.txt",
    ],
    [
      "content",
      GOOD_A,
      {
        files: new Map([
          ["README.md", README],
          ["agente-1.txt", "agente 1\n"],
          ["agente-2.txt", "agente 1\n"],
        ]),
        commits: 3,
      },
      "main check: content differs: agente-2.txt",
    ],
    [
      "commits",
      GOOD_A,
      {
        files: new Map([
          ["README.md", README],
          ["agente-1.txt", "agente 1\n"],
          ["agente-2.txt", "agente 2\n"],
        ]),
        commits: 4,
      },
      "main check: commits: expected 3, got 4",
    ],
    [
      // Inserted as agente-2 then agente-10: only sorting with `<` puts
      // agente-10.txt first ("1" < "2"), so the order proves the sort (A7).
      "missing, sorted with <",
      {
        files: new Map([
          ["agente-2.txt", "agente 2\n"],
          ["agente-10.txt", "agente 10\n"],
        ]),
        commits: 3,
      },
      { files: new Map<string, string>(), commits: 3 },
      "main check: missing agente-10.txt, agente-2.txt",
    ],
  ])(
    "MC7 one problem, %s → HarnessError",
    (_label, expected, actual, message) => {
      expect(() => checkMain(expected, actual)).toThrow(HarnessError);
      expect(() => checkMain(expected, actual)).toThrow(exactly(message));
    },
  );

  it("MC8 every problem in one message, in order", () => {
    const actual: MainState = {
      files: new Map([
        ["README.md", "outro\n"],
        ["intruso.txt", "intruso\n"],
      ]),
      commits: 2,
    };

    expect(() => checkMain(GOOD_A, actual)).toThrow(HarnessError);
    expect(() => checkMain(GOOD_A, actual)).toThrow(
      exactly(
        "main check: missing agente-1.txt, agente-2.txt; extra intruso.txt; content differs: README.md; commits: expected 3, got 2",
      ),
    );
  });
});

// Written by hand, byte by byte, from the text approved in the plan (A5):
// [system, accepted, line]. A, B and C in both systems; C is the singular.
const LINES = [
  [
    "git",
    2,
    "[git] main conferida → ✓ 2 commits aceitos na main (arquivos, conteúdo e contagem)",
  ],
  [
    "git",
    10,
    "[git] main conferida → ✓ 10 commits aceitos na main (arquivos, conteúdo e contagem)",
  ],
  [
    "git",
    1,
    "[git] main conferida → ✓ 1 commit aceito na main (arquivos, conteúdo e contagem)",
  ],
  [
    "sprout",
    2,
    "[sprout] main conferida → ✓ 2 commits aceitos na main (arquivos, conteúdo e contagem)",
  ],
  [
    "sprout",
    10,
    "[sprout] main conferida → ✓ 10 commits aceitos na main (arquivos, conteúdo e contagem)",
  ],
  [
    "sprout",
    1,
    "[sprout] main conferida → ✓ 1 commit aceito na main (arquivos, conteúdo e contagem)",
  ],
] as const;

describe("formatMainLine (D5)", () => {
  it.each(LINES)("ML1 %s, %i accepted: the exact line", (system, n, line) => {
    expect(formatMainLine(system, n)).toBe(line);
  });

  // Written by hand (A6): prefix and arrow dim, the whole result green,
  // "na main" and the parentheses without color.
  it.each([
    [
      "git",
      2,
      "\x1b[2m[git]\x1b[22m main conferida \x1b[2m→\x1b[22m \x1b[32m✓ 2 commits aceitos\x1b[39m na main (arquivos, conteúdo e contagem)",
    ],
    [
      "sprout",
      1,
      "\x1b[2m[sprout]\x1b[22m main conferida \x1b[2m→\x1b[22m \x1b[32m✓ 1 commit aceito\x1b[39m na main (arquivos, conteúdo e contagem)",
    ],
  ] as const)("ML2 %s, %i accepted, with color", (system, n, line) => {
    expect(formatMainLine(system, n, true)).toBe(line);
  });

  // A guard: green on the skeleton too (an empty line is 0 columns), see the
  // plan's "guardas sem prova por mutação" (A4).
  it.each(
    LINES.flatMap(([system, n]) =>
      [false, true].map((color) => [system, n, color] as const),
    ),
  )("ML3 %s, %i accepted, color %s: fits 111 columns", (system, n, color) => {
    expect(visibleWidth(formatMainLine(system, n, color))).toBeLessThanOrEqual(
      111,
    );
  });
});
