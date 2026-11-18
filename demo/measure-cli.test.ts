import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunGitScenarioOptions } from "./git-agents.js";
import {
  type MeasureCliOptions,
  type MeasureIo,
  runMeasureCli,
} from "./measure-cli.js";
import type { AgentResult } from "./metrics.js";
import type { RunResult, System } from "./results.js";
import type { ScenarioId } from "./scenarios.js";
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
let resultsFile: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sprout-measure-cli-"));
  await mkdir(join(root, "docs"));
  resultsFile = join(root, "docs", "resultados.md");
  await writeFile(resultsFile, "antigo\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// Total time of each run, by round, written by hand. git A round 1 is 40.6
// (shown 41 ms) and round 2 is 45.2 (shown 45 ms), the 7th run (A6).
const TIMES: Record<`${System} ${ScenarioId}`, number[]> = {
  "git A": [40.6, 45.2, 39, 40, 42],
  "sprout A": [9, 8, 10, 9, 9],
  "git B": [1213, 1250, 1180, 1300, 1222],
  "sprout B": [110, 121, 98, 130, 105],
  "git C": [60, 62, 58, 61, 59],
  "sprout C": [8, 7, 9, 8, 8],
};

/** One recorded call of a fake runner. */
interface Call {
  system: System;
  scenario: ScenarioId;
  options: RunGitScenarioOptions | RunSproutScenarioOptions;
}

/**
 * Fake runners: each call is recorded, logs a line (which must not reach
 * stdout) and returns one agent whose endMs is the next time of its scenario
 * and system. `fail(n)` decides what the n-th call (1-based) throws.
 */
function fakeRunners(fail: (n: number) => Error | undefined = () => undefined) {
  const calls: Call[] = [];
  const rounds = new Map<string, number>();
  function run(system: System) {
    return (
      options: RunGitScenarioOptions | RunSproutScenarioOptions,
    ): Promise<RunResult> => {
      const scenario = options.scenario.id;
      calls.push({ system, scenario, options });
      options.log?.("ruído");
      const error = fail(calls.length);
      if (error !== undefined) return Promise.reject(error);
      const key = `${system} ${scenario}` as const;
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
      return Promise.resolve({ system, scenario, agents: [agent] });
    };
  }
  return { calls, runGit: run("git"), runSprout: run("sprout") };
}

function cliOptions(
  runners: ReturnType<typeof fakeRunners>,
  changed: string[] = [],
): MeasureCliOptions {
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
    readTree: () => Promise.resolve({ commit: "9891810", changed }),
    now: () => new Date(2026, 10, 18, 14, 30, 45),
  };
}

describe("demo:medir arguments (D2)", () => {
  it("exits 2 with a usage line on any argument (C1)", async () => {
    const { io, err, codes } = fakeIo();
    const runners = fakeRunners();

    await expect(runMeasureCli(["x"], io, cliOptions(runners))).rejects.toThrow(
      ExitCalled,
    );

    expect(codes).toEqual([2]);
    expect(err).toEqual(["usage: pnpm demo:medir (no arguments)\n"]);
    expect(runners.calls).toHaveLength(0);
    expect(await readFile(resultsFile, "utf8")).toBe("antigo\n");
  });
});

describe("demo:medir runs (D4, D14, D3)", () => {
  it("runs the 30 runs in the D4 order and exits 0 (C2)", async () => {
    const { io, codes } = fakeIo();
    const runners = fakeRunners();

    await expect(runMeasureCli([], io, cliOptions(runners))).rejects.toThrow(
      ExitCalled,
    );

    expect(codes).toEqual([0]);
    expect(runners.calls).toHaveLength(30);
    expect(
      runners.calls
        .slice(0, 7)
        .map((call) => `${call.system} ${call.scenario}`),
    ).toEqual([
      "git A",
      "sprout A",
      "git B",
      "sprout B",
      "git C",
      "sprout C",
      "git A",
    ]);
  });

  it("prints 30 progress lines and the file line, without color (C3)", async () => {
    const { io, out } = fakeIo();
    const runners = fakeRunners();

    await expect(runMeasureCli([], io, cliOptions(runners))).rejects.toThrow(
      ExitCalled,
    );

    const lines = out.join("").split("\n");
    expect(lines.pop()).toBe(""); // the output ends in "\n"
    expect(lines).toHaveLength(31);
    expect(lines[0]).toBe("[1/30] git A: 41 ms");
    expect(lines[6]).toBe("[7/30] git A: 45 ms");
    expect(lines[30]).toBe("resultados gravados em docs/resultados.md");
    expect(lines.filter((line) => line.includes("\u001b"))).toHaveLength(0);
    expect(lines.filter((line) => line.includes("ruído"))).toHaveLength(0);
  });

  it("gives every run its folders inside demo/tmp/medicao (C4)", async () => {
    const { io } = fakeIo();
    const runners = fakeRunners();

    await expect(runMeasureCli([], io, cliOptions(runners))).rejects.toThrow(
      ExitCalled,
    );

    const base = join(root, "demo", "tmp", "medicao");
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
    expect(gitInside).toHaveLength(15);
    expect(sproutInside).toHaveLength(15);
  });
});
