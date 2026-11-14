import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ResultFileError,
  type RunResult,
  readMtime,
  readResult,
  resultPath,
  writeResult,
} from "./results.js";

let base: string;
let dir: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "sprout-demo-results-"));
  // Not created here: writeResult must create it.
  dir = join(base, "resultados");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

// Scenario A has exactly 2 agents (SCENARIOS.A).
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
      endMs: 812.5,
    },
    {
      agent: 2,
      outcome: "accepted",
      attempts: 3,
      rejections: { "fetch-first": 1, "ref-lock": 1 },
      reparented: null,
      endMs: 2031.25,
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
      endMs: 15,
    },
    {
      agent: 2,
      outcome: "conflict",
      attempts: 1,
      rejections: {},
      reparented: false,
      endMs: 17,
    },
  ],
};

// Writes `text` as the file readResult(dir, "git", "A") will look for.
async function plantGitA(text: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = resultPath(dir, "git", "A");
  await writeFile(path, text);
  return path;
}

// gitA with agents[1] changed by `edit` (a deep copy; gitA stays intact).
function gitAWithAgent1(edit: (agent: Record<string, unknown>) => void) {
  const copy = structuredClone(gitA) as unknown as {
    agents: Record<string, unknown>[];
  };
  edit(copy.agents[1]);
  return copy;
}

// sproutC with agents[1] changed by `edit` (a deep copy; sproutC stays intact).
function sproutCWithAgent1(edit: (agent: Record<string, unknown>) => void) {
  const copy = structuredClone(sproutC) as unknown as {
    agents: Record<string, unknown>[];
  };
  edit(copy.agents[1]);
  return copy;
}

describe("writeResult / readResult", () => {
  it.each([
    ["git-A.json", gitA],
    ["sprout-C.json", sproutC],
  ])("round trip through %s gives back the same run", async (name, run) => {
    const path = await writeResult(dir, run);

    expect(path).toBe(join(dir, name));
    expect(await readResult(dir, run.system, run.scenario)).toEqual(run);
  });

  it("missing file → error with the path", async () => {
    const path = resultPath(dir, "git", "A");

    await expect(readResult(dir, "git", "A")).rejects.toThrow(
      `result file not found: ${path}`,
    );
  });

  it("other read error → error with the path and the cause", async () => {
    // A directory where the file should be: readFile fails with EISDIR.
    const path = resultPath(dir, "git", "A");
    await mkdir(path, { recursive: true });

    const error = await readResult(dir, "git", "A").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(`cannot read result file ${path}`);
    expect(((error as Error).cause as NodeJS.ErrnoException).code).toBe(
      "EISDIR",
    );
  });

  it("broken JSON → invalid JSON error with the path", async () => {
    const path = await plantGitA('{"system": "git", ');

    await expect(readResult(dir, "git", "A")).rejects.toThrow(
      `invalid JSON in ${path}`,
    );
  });

  it.each([
    ["not an object", [], "must be a JSON object"],
    ["unknown field in the run", { ...gitA, extra: 1 }, "unknown field: extra"],
    ["system missing", { ...gitA, system: undefined }, "system must be"],
    ["other system", { ...gitA, system: "sprout" }, 'system must be "git"'],
    ["other scenario", { ...gitA, scenario: "B" }, 'scenario must be "A"'],
    ["agents not an array", { ...gitA, agents: {} }, "agents must be"],
    ["agents empty", { ...gitA, agents: [] }, "agents must be"],
    [
      "fewer agents than the scenario",
      { ...gitA, agents: [gitA.agents[0]] },
      "agents must have exactly 2 entries in scenario A, got 1",
    ],
    [
      "more agents than the scenario",
      { ...gitA, agents: [...gitA.agents, { ...gitA.agents[1], agent: 3 }] },
      "agents must have exactly 2 entries in scenario A, got 3",
    ],
    [
      "unknown field in an agent",
      gitAWithAgent1((a) => (a.extra = 1)),
      "unknown field: agents[1].extra",
    ],
    [
      "agent missing",
      gitAWithAgent1((a) => delete a.agent),
      "agents[1].agent must be",
    ],
    [
      "agent fractional",
      gitAWithAgent1((a) => (a.agent = 1.5)),
      "agents[1].agent must be a positive integer",
    ],
    [
      "agent number repeated",
      gitAWithAgent1((a) => (a.agent = 1)),
      "agents[1].agent 1 is repeated",
    ],
    [
      "agent number missing (3 instead of 2)",
      gitAWithAgent1((a) => (a.agent = 3)),
      "agent 2 is missing",
    ],
    [
      "outcome unknown",
      gitAWithAgent1((a) => (a.outcome = "rejected")),
      "agents[1].outcome must be",
    ],
    [
      "attempts as a string",
      gitAWithAgent1((a) => (a.attempts = "3")),
      "agents[1].attempts must be",
    ],
    [
      "attempts zero",
      gitAWithAgent1((a) => (a.attempts = 0)),
      "agents[1].attempts must be a positive integer",
    ],
    [
      "rejections as an array",
      gitAWithAgent1((a) => (a.rejections = [])),
      "agents[1].rejections must be",
    ],
    [
      "unknown rejection type",
      gitAWithAgent1((a) => (a.rejections = { "fetch first": 1 })),
      'agents[1].rejections has unknown type "fetch first"',
    ],
    [
      "rejection type from the prototype",
      gitAWithAgent1((a) => (a.rejections = { constructor: 1 })),
      'agents[1].rejections has unknown type "constructor"',
    ],
    [
      "rejection count as a string",
      gitAWithAgent1((a) => (a.rejections = { "ref-lock": "1" })),
      'agents[1].rejections["ref-lock"] must be',
    ],
    [
      "reparented missing",
      gitAWithAgent1((a) => delete a.reparented),
      "agents[1].reparented must be",
    ],
    [
      "reparented as a string",
      gitAWithAgent1((a) => (a.reparented = "yes")),
      "agents[1].reparented must be null in git",
    ],
    [
      "endMs negative",
      gitAWithAgent1((a) => (a.endMs = -1)),
      "agents[1].endMs must be",
    ],
    [
      "endMs null",
      gitAWithAgent1((a) => (a.endMs = null)),
      "agents[1].endMs must be a non-negative number",
    ],
    [
      "endMs as a string",
      gitAWithAgent1((a) => (a.endMs = "10")),
      "agents[1].endMs must be a non-negative number",
    ],
  ])("%s → error naming the problem", async (_label, data, problem) => {
    const path = await plantGitA(JSON.stringify(data));

    const read = readResult(dir, "git", "A");

    await expect(read).rejects.toThrow(`${path}: `);
    await expect(read).rejects.toThrow(problem);
  });
});

describe("ResultFileError (R1)", () => {
  // Each case leaves a bad git-A.json (or none) and gives the message, written
  // by hand from the path.
  it.each([
    [
      "missing file",
      async () => {},
      (path: string) => `result file not found: ${path}`,
    ],
    [
      "unreadable file (EISDIR)",
      async () => {
        await mkdir(resultPath(dir, "git", "A"), { recursive: true });
      },
      (path: string) => `cannot read result file ${path}`,
    ],
    [
      "broken JSON",
      async () => {
        await plantGitA('{"system": "git", ');
      },
      (path: string) => `invalid JSON in ${path}`,
    ],
    [
      "wrong shape",
      async () => {
        await plantGitA(JSON.stringify({ ...gitA, system: "sprout" }));
      },
      (path: string) => `${path}: system must be "git"`,
    ],
  ])("%s → ResultFileError", async (_label, plant, message) => {
    await plant();

    const error = await readResult(dir, "git", "A").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ResultFileError);
    expect((error as Error).message).toBe(message(resultPath(dir, "git", "A")));
  });
});

describe("readMtime (R5)", () => {
  it("gives the file's modification time", async () => {
    const path = await writeResult(dir, gitA);
    // Built with the local constructor, like the scoreboard reads it (R6).
    const date = new Date(2026, 10, 12, 23, 44);
    await utimes(path, date, date);

    const mtime = await readMtime(path);

    expect(mtime.getTime()).toBe(date.getTime());
  });

  it("missing file → ResultFileError with the path and the cause", async () => {
    const path = resultPath(dir, "git", "A");

    const error = await readMtime(path).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ResultFileError);
    expect((error as Error).message).toBe(
      `cannot read modification time of ${path}`,
    );
    expect(((error as Error).cause as NodeJS.ErrnoException).code).toBe(
      "ENOENT",
    );
  });
});

describe("reparented per system (R4)", () => {
  // Messages written by hand: git only takes null, Sprout only booleans.
  it.each([
    [
      "git with reparented true",
      "git",
      "A",
      gitAWithAgent1((a) => (a.reparented = true)),
      "agents[1].reparented must be null in git",
    ],
    [
      "sprout with reparented null",
      "sprout",
      "C",
      sproutCWithAgent1((a) => (a.reparented = null)),
      "agents[1].reparented must be a boolean in sprout",
    ],
    [
      "sprout with reparented as a string",
      "sprout",
      "C",
      sproutCWithAgent1((a) => (a.reparented = "yes")),
      "agents[1].reparented must be a boolean in sprout",
    ],
  ] as const)(
    "%s → ResultFileError naming the field",
    async (_label, system, scenario, data, problem) => {
      await mkdir(dir, { recursive: true });
      const path = resultPath(dir, system, scenario);
      await writeFile(path, JSON.stringify(data));

      const error = await readResult(dir, system, scenario).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(ResultFileError);
      expect((error as Error).message).toBe(`${path}: ${problem}`);
    },
  );
});
