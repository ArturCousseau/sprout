import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CurveCliOptions, runCurveCli } from "./curve-cli.js";
import type { RunGitScenarioOptions } from "./git-agents.js";
import { HarnessError } from "./harness-error.js";
import type { MeasureIo } from "./measure-cli.js";
import type { AgentResult } from "./metrics.js";
import type { RunResult, System } from "./results.js";
import type { RunSproutScenarioOptions } from "./sprout-agents.js";

// Fake `process`: records stdout, stderr and the exit code. exit() throws so
// that, like the real process.exit, nothing after it runs.
class ExitCalled extends Error {}

function fakeIo() {
  const out: string[] = [];
  const err: string[] = [];
  const codes: number[] = [];
  const io: MeasureIo = {
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

let root: string;
let curveFile: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sprout-curve-cli-"));
  await mkdir(join(root, "docs"));
  curveFile = join(root, "docs", "curva.md");
  await writeFile(curveFile, "antigo\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// Total time of each run, by round, written by hand. git N=2 round 1 is 140.6
// (shown 141 ms, the 1st run) and git N=20 round 1 is 2864.6 (shown 2865 ms,
// the 7th run).
const TIMES: Record<`${System} ${number}`, number[]> = {
  "git 2": [140.6, 138, 141],
  "sprout 2": [25, 30, 26],
  "git 5": [480, 510, 495],
  "sprout 5": [40, 42, 39],
  "git 10": [1080, 1040, 1075],
  "sprout 10": [90, 88, 97],
  "git 20": [2864.6, 2717, 2714],
  "sprout 20": [190, 201, 185],
};

/** One recorded call of a fake runner. */
interface Call {
  system: System;
  options: RunGitScenarioOptions | RunSproutScenarioOptions;
}

/**
 * Fake runners: each call is recorded, logs a line (which must not reach
 * stdout) and returns one agent whose endMs is the next time of its system
 * and N. `fail(n)` decides what the n-th call (1-based) throws.
 */
function fakeRunners(fail: (n: number) => Error | undefined = () => undefined) {
  const calls: Call[] = [];
  const rounds = new Map<string, number>();
  function run(system: System) {
    return (
      options: RunGitScenarioOptions | RunSproutScenarioOptions,
    ): Promise<RunResult> => {
      calls.push({ system, options });
      options.log?.("ruído");
      const error = fail(calls.length);
      if (error !== undefined) return Promise.reject(error);
      const key = `${system} ${options.scenario.agents}` as const;
      const round = (rounds.get(key) ?? 0) + 1;
      rounds.set(key, round);
      const agent: AgentResult = {
        agent: 1,
        outcome: "accepted",
        attempts: 1,
        rejections: {},
        reparented: system === "git" ? null : false,
        endMs: TIMES[key][round - 1],
      };
      return Promise.resolve({
        system,
        scenario: options.scenario.id,
        agents: [agent],
      });
    };
  }
  return { calls, runGit: run("git"), runSprout: run("sprout") };
}

function cliOptions(
  runners: ReturnType<typeof fakeRunners>,
  changed: string[] = [],
): CurveCliOptions {
  return {
    repoRoot: root,
    runGit: runners.runGit,
    runSprout: runners.runSprout,
    readMachine: () =>
      Promise.resolve({
        cpuModel: "AMD Ryzen 7 5700U with Radeon Graphics",
        cpuCount: 16,
        memoryBytes: 20268797952,
        system: "Omarchy 3.2, kernel 7.2.15-1-omarchy",
      }),
    readVersions: () =>
      Promise.resolve({
        node: "v26.12.0",
        git: "git version 2.56.0",
        sqlite: "SQLite 3.53.4 (better-sqlite3 13.0.3)",
      }),
    readTree: () => Promise.resolve({ commit: "cb26b14", changed }),
    now: () => new Date(2026, 10, 18, 14, 30, 45),
  };
}

/** The trimmed cells of a Markdown table row, without the outer pipes. */
function cells(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

describe("demo:curva arguments (D11)", () => {
  it("exits 2 with a usage line on any argument (L1)", async () => {
    const { io, err, codes } = fakeIo();
    const runners = fakeRunners();

    await expect(runCurveCli(["x"], io, cliOptions(runners))).rejects.toThrow(
      ExitCalled,
    );

    expect(codes).toEqual([2]);
    expect(err).toEqual(["usage: pnpm demo:curva (no arguments)\n"]);
    expect(runners.calls).toHaveLength(0);
    expect(await readFile(curveFile, "utf8")).toBe("antigo\n");
  });
});

describe("demo:curva runs (D6, D2, D10, D11)", () => {
  it("runs the 24 runs in the D6 order, as scenario B with N agents, and exits 0 (L2)", async () => {
    const { io, codes } = fakeIo();
    const runners = fakeRunners();

    await expect(runCurveCli([], io, cliOptions(runners))).rejects.toThrow(
      ExitCalled,
    );

    expect(codes).toEqual([0]);
    expect(runners.calls).toHaveLength(24);
    expect(
      runners.calls
        .slice(0, 9)
        .map((call) => `${call.system} ${call.options.scenario.agents}`),
    ).toEqual([
      "git 2",
      "sprout 2",
      "git 5",
      "sprout 5",
      "git 10",
      "sprout 10",
      "git 20",
      "sprout 20",
      "git 2",
    ]);
    expect(
      runners.calls.filter(
        (call) =>
          call.options.scenario.id === "B" &&
          call.options.scenario.sameFile === false,
      ),
    ).toHaveLength(24);
  });

  it("prints 24 progress lines and the file line, without color (L3)", async () => {
    const { io, out } = fakeIo();
    const runners = fakeRunners();

    await expect(runCurveCli([], io, cliOptions(runners))).rejects.toThrow(
      ExitCalled,
    );

    const lines = out.join("").split("\n");
    expect(lines.pop()).toBe(""); // the output ends in "\n"
    expect(lines).toHaveLength(25);
    expect(lines[0]).toBe("[1/24] git N=2: 141 ms");
    expect(lines[6]).toBe("[7/24] git N=20: 2865 ms");
    expect(lines[24]).toBe("curva gravada em docs/curva.md");
    expect(lines.filter((line) => line.includes("\u001b"))).toHaveLength(0);
    expect(lines.filter((line) => line.includes("ruído"))).toHaveLength(0);
  });

  it("gives every run its folders inside demo/tmp/curva (L4)", async () => {
    const { io } = fakeIo();
    const runners = fakeRunners();

    await expect(runCurveCli([], io, cliOptions(runners))).rejects.toThrow(
      ExitCalled,
    );

    const base = join(root, "demo", "tmp", "curva");
    const results = join(base, "resultados");
    const gitInside = runners.calls.filter(
      (call) =>
        call.system === "git" &&
        "baseDir" in call.options &&
        call.options.baseDir === base &&
        call.options.resultsDir === results,
    );
    const sproutInside = runners.calls.filter(
      (call) =>
        call.system === "sprout" &&
        "dataDir" in call.options &&
        call.options.dataDir === join(base, "sprout-data") &&
        call.options.resultsDir === results,
    );
    expect(gitInside).toHaveLength(12);
    expect(sproutInside).toHaveLength(12);
  });

  it("writes docs/curva.md with the N=20 row (L10)", async () => {
    const { io } = fakeIo();
    const runners = fakeRunners();

    await expect(runCurveCli([], io, cliOptions(runners))).rejects.toThrow(
      ExitCalled,
    );

    // One agent per fake run: 1 attempt in each system. git N=20: 2864.6,
    // 2717, 2714 → 8295.6 / 3 = 2765.2 → 2765; min–max rounded 2714–2865.
    // Sprout N=20: 190, 201, 185 → 192. Ceiling 20·21/2 = 210.
    const md = await readFile(curveFile, "utf8");
    expect(md).not.toBe("antigo\n");
    const expected = [
      "20",
      "210",
      "1",
      "1",
      "2765",
      "2714–2865",
      "192",
      "185–201",
    ];
    expect(
      md
        .split("\n")
        .filter(
          (line) => JSON.stringify(cells(line)) === JSON.stringify(expected),
        ),
    ).toHaveLength(1);
  });
});

describe("demo:curva failure (D8, D11)", () => {
  it("exits 1 on a HarnessError in run 2/3, git N=20, without touching the file (L5)", async () => {
    const { io, err, codes } = fakeIo();
    // A round has 4 N × 2 systems = 8 runs, so round 2 is calls 9 to 16:
    // git 2, sprout 2, git 5, sprout 5, git 10, sprout 10, git 20 (call 15).
    const runners = fakeRunners((n) =>
      n === 15 ? new HarnessError("boom") : undefined,
    );

    await expect(runCurveCli([], io, cliOptions(runners))).rejects.toThrow(
      ExitCalled,
    );

    expect(codes).toEqual([1]);
    expect(err).toEqual(["demo:curva: run 2/3, git N=20: boom\n"]);
    expect(runners.calls).toHaveLength(15);
    expect(await readFile(curveFile, "utf8")).toBe("antigo\n");
  });

  it("rethrows an error that is not a HarnessError, without touching the file (L6)", async () => {
    const { io, codes } = fakeIo();
    const bug = new Error("bug");
    const runners = fakeRunners((n) => (n === 1 ? bug : undefined));

    await expect(runCurveCli([], io, cliOptions(runners))).rejects.toBe(bug);

    expect(codes).toEqual([]);
    expect(await readFile(curveFile, "utf8")).toBe("antigo\n");
  });
});
