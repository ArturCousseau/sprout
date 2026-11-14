import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentResult } from "./metrics.js";
import { resultPath, type RunResult, writeResult } from "./results.js";
import { runScoreboardCli, type ScoreboardIo } from "./scoreboard-cli.js";

// Fake `process`: records stdout, stderr and the exit code. exit() throws so
// that, like the real process.exit, nothing after it runs.
class ExitCalled extends Error {}

function fakeIo() {
  const out: string[] = [];
  const err: string[] = [];
  const codes: number[] = [];
  const io: ScoreboardIo = {
    stdout: {
      write(text: string) {
        out.push(text);
        return true;
      },
    },
    stderr: {
      write(text: string) {
        err.push(text);
        return true;
      },
    },
    exit(code: number): never {
      codes.push(code);
      throw new ExitCalled(`exit(${code})`);
    },
  };
  return { io, out, err, codes };
}

let base: string;
let results: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "sprout-scoreboard-cli-"));
  results = join(base, "resultados");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

// git B, written by hand: agent k is accepted on push k after k - 1 ref-lock
// rejections, ending at 121.25 * k ms. Sums: 10 accepted, 45 rejections,
// 55 attempts, 0 conflicts, 1212.5 ms (→ 1213 ms).
const gitB: RunResult = {
  system: "git",
  scenario: "B",
  agents: Array.from({ length: 10 }, (_, i): AgentResult => {
    const k = i + 1;
    return {
      agent: k,
      outcome: "accepted",
      attempts: k,
      rejections: k > 1 ? { "ref-lock": k - 1 } : {},
      reparented: null,
      endMs: 121.25 * k,
    };
  }),
};

// Sprout B, written by hand: one request each, every agent but the first
// reparented, ending at 11 * k + 0.4 ms. Sums: 10 accepted, 0 rejections,
// 10 attempts, 9 reparents, 0 conflicts, 110.4 ms (→ 110 ms).
const sproutB: RunResult = {
  system: "sprout",
  scenario: "B",
  agents: Array.from({ length: 10 }, (_, i): AgentResult => {
    const k = i + 1;
    return {
      agent: k,
      outcome: "accepted",
      attempts: 1,
      rejections: {},
      reparented: k > 1,
      endMs: 11 * k + 0.4,
    };
  }),
};

// Scenarios A and C, two agents each, written by hand.
const gitA: RunResult = {
  system: "git",
  scenario: "A",
  agents: [
    {
      agent: 1,
      outcome: "accepted",
      attempts: 1,
      rejections: {},
      reparented: null,
      endMs: 40,
    },
    {
      agent: 2,
      outcome: "accepted",
      attempts: 2,
      rejections: { "ref-lock": 1 },
      reparented: null,
      endMs: 90,
    },
  ],
};

const sproutA: RunResult = {
  system: "sprout",
  scenario: "A",
  agents: [
    {
      agent: 1,
      outcome: "accepted",
      attempts: 1,
      rejections: {},
      reparented: false,
      endMs: 10,
    },
    {
      agent: 2,
      outcome: "accepted",
      attempts: 1,
      rejections: {},
      reparented: true,
      endMs: 12,
    },
  ],
};

const gitC: RunResult = {
  system: "git",
  scenario: "C",
  agents: [
    {
      agent: 1,
      outcome: "accepted",
      attempts: 1,
      rejections: {},
      reparented: null,
      endMs: 30,
    },
    {
      agent: 2,
      outcome: "conflict",
      attempts: 1,
      rejections: { "fetch-first": 1 },
      reparented: null,
      endMs: 40.5,
    },
  ],
};

const sproutC: RunResult = {
  system: "sprout",
  scenario: "C",
  agents: [
    {
      agent: 1,
      outcome: "accepted",
      attempts: 1,
      rejections: {},
      reparented: false,
      endMs: 4,
    },
    {
      agent: 2,
      outcome: "conflict",
      attempts: 1,
      rejections: {},
      reparented: false,
      endMs: 5,
    },
  ],
};

// Local constructor, like the scoreboard reads them (R6).
const GIT_TIME = new Date(2026, 10, 12, 23, 44);
const SPROUT_TIME = new Date(2026, 10, 13, 23, 31);

/** Writes both runs and sets each file's modification time. */
async function plant(git: RunResult, sprout: RunResult): Promise<void> {
  const gitPath = await writeResult(results, git);
  const sproutPath = await writeResult(results, sprout);
  await utimes(gitPath, GIT_TIME, GIT_TIME);
  await utimes(sproutPath, SPROUT_TIME, SPROUT_TIME);
}

describe("demo:placar, exit 0 (C1, C2, C4, C5)", () => {
  it("scenario B: prints the whole scoreboard", async () => {
    await plant(gitB, sproutB);
    const { io, out, err, codes } = fakeIo();

    const running = runScoreboardCli(["--cenario", "B"], io, {
      resultsDir: results,
    });

    await expect(running).rejects.toThrow(ExitCalled);
    expect(codes).toEqual([0]);
    expect(err).toEqual([]);
    // Written by hand: the scoreboard B of the plan of #18.
    expect(out.join("")).toBe(
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

  it.each([
    ["A", gitA, sproutA, "Cenário A: 2 agentes, arquivos diferentes"],
    ["C", gitC, sproutC, "Cenário C: 2 agentes, mesmo arquivo"],
  ] as const)(
    "scenario %s: exit 0 and the title from SCENARIOS",
    async (id, git, sprout, title) => {
      await plant(git, sprout);
      const { io, out, err, codes } = fakeIo();

      const running = runScoreboardCli(["--cenario", id], io, {
        resultsDir: results,
      });

      await expect(running).rejects.toThrow(ExitCalled);
      expect(codes).toEqual([0]);
      expect(err).toEqual([]);
      expect(out.join("").split("\n")[0]).toBe(title);
    },
  );
});

describe("demo:placar, exit 2 (C7)", () => {
  it.each([
    ["missing", [], "--cenario is required (A, B or C)\n"],
    ["D", ["--cenario", "D"], '--cenario must be A, B or C, got "D"\n'],
  ])("%s → stderr and exit 2, stdout empty", async (_label, argv, message) => {
    const { io, out, err, codes } = fakeIo();

    const running = runScoreboardCli(argv, io, { resultsDir: results });

    await expect(running).rejects.toThrow(ExitCalled);
    expect(codes).toEqual([2]);
    expect(err).toEqual([message]);
    expect(out).toEqual([]);
  });
});

describe("demo:placar, exit 1 (C6, R7)", () => {
  /** Runs `--cenario B` and checks exit 1, the exact stderr and no stdout. */
  async function expectExit1(stderr: string): Promise<void> {
    const { io, out, err, codes } = fakeIo();

    const running = runScoreboardCli(["--cenario", "B"], io, {
      resultsDir: results,
    });

    await expect(running).rejects.toThrow(ExitCalled);
    expect(codes).toEqual([1]);
    expect(err).toEqual([stderr]);
    expect(out).toEqual([]);
  }

  /** Writes `text` where the git B result should be. */
  async function plantGitText(text: string): Promise<string> {
    await mkdir(results, { recursive: true });
    const path = resultPath(results, "git", "B");
    await writeFile(path, text);
    return path;
  }

  it("git file missing → its path and demo:git", async () => {
    await writeResult(results, sproutB);
    const gitPath = resultPath(results, "git", "B");

    await expectExit1(
      `demo:placar: result file not found: ${gitPath} (rode pnpm demo:git --cenario B)\n`,
    );
  });

  it("sprout file missing → its path and demo:sprout", async () => {
    await writeResult(results, gitB);
    const sproutPath = resultPath(results, "sprout", "B");

    await expectExit1(
      `demo:placar: result file not found: ${sproutPath} (rode pnpm demo:sprout --cenario B)\n`,
    );
  });

  it("both missing → one line per file, prefix once (R7, P1)", async () => {
    const gitPath = resultPath(results, "git", "B");
    const sproutPath = resultPath(results, "sprout", "B");

    await expectExit1(
      `demo:placar: result file not found: ${gitPath} (rode pnpm demo:git --cenario B)\n` +
        `result file not found: ${sproutPath} (rode pnpm demo:sprout --cenario B)\n`,
    );
  });

  it.each([
    [
      "broken JSON",
      '{"system": "git", ',
      (path: string) => `invalid JSON in ${path}`,
    ],
    [
      "wrong system",
      JSON.stringify({ ...gitB, system: "sprout" }),
      (path: string) => `${path}: system must be "git"`,
    ],
    [
      "reparented true in git (R4)",
      JSON.stringify({
        ...gitB,
        agents: gitB.agents.map((a) =>
          a.agent === 1 ? { ...a, reparented: true } : a,
        ),
      }),
      (path: string) => `${path}: agents[0].reparented must be null in git`,
    ],
  ])(
    "invalid git file (%s) → readResult's message",
    async (_label, text, message) => {
      await writeResult(results, sproutB);
      const gitPath = await plantGitText(text);

      await expectExit1(
        `demo:placar: ${message(gitPath)} (rode pnpm demo:git --cenario B)\n`,
      );
    },
  );

  it("unreadable git file (EISDIR) → readResult's message", async () => {
    await writeResult(results, sproutB);
    const gitPath = resultPath(results, "git", "B");
    await mkdir(gitPath, { recursive: true });

    await expectExit1(
      `demo:placar: cannot read result file ${gitPath} (rode pnpm demo:git --cenario B)\n`,
    );
  });
});

describe("demo:placar, other errors (C8, R3)", () => {
  it("an error that is not a ResultFileError is rethrown, not exit 1", async () => {
    await plant(gitB, sproutB);
    const { io, err, codes } = fakeIo();
    // A plain Error standing in for a bug, thrown inside the guarded stretch.
    io.stdout.write = () => {
      throw new Error("stdout broke");
    };

    const running = runScoreboardCli(["--cenario", "B"], io, {
      resultsDir: results,
    });

    await expect(running).rejects.toThrow("stdout broke");
    await expect(running).rejects.not.toBeInstanceOf(ExitCalled);
    expect(codes).toEqual([]);
    expect(err).toEqual([]);
  });
});
