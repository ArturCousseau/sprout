import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { painter, stripAnsi } from "./color.js";
import {
  formatGitEvent,
  type GitEvent,
  gitOk,
  prepareGitRun,
  runGit,
  runGitScenario,
} from "./git-agents.js";
import { checkGitAttempts } from "./git.js";
import { HarnessError } from "./harness-error.js";
import { readResult, type RunResult } from "./results.js";
import { SCENARIOS, type ScenarioId } from "./scenarios.js";

const run = promisify(execFile);

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "sprout-git-agents-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(base, { recursive: true, force: true });
});

describe("runGit", () => {
  it("returns non-zero code without throwing", async () => {
    const missing = join(base, "missing");

    const result = await runGit(["-C", missing, "status"]);

    expect(result.code).toBe(128);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`cannot change to '${missing}'`);
  });
});

describe("gitOk", () => {
  it("non-zero code → HarnessError with command, code and stderr", async () => {
    const missing = join(base, "missing");

    const result = gitOk(["-C", missing, "status"]);

    await expect(result).rejects.toThrow(HarnessError);
    await expect(result).rejects.toThrow(`git -C ${missing} status`);
    await expect(result).rejects.toThrow("exit code 128");
    await expect(result).rejects.toThrow(`cannot change to '${missing}'`);
  });
});

/** Real git and several clones: slower than the default 5 s on a busy CI. */
const GIT_TIMEOUT = 60_000;

/** Trimmed stdout of a git command that must succeed. */
async function git(args: string[]): Promise<string> {
  return (await gitOk(args)).trim();
}

describe("criterion 2: fresh central and clones", () => {
  it(
    "bare central with the initial commit and one clone per agent",
    async () => {
      const results = join(base, "resultados");
      const central = join(base, "central.git");

      await prepareGitRun({
        baseDir: base,
        resultsDir: results,
        scenario: SCENARIOS.A,
      });

      expect(
        await git(["-C", central, "rev-parse", "--is-bare-repository"]),
      ).toBe("true");
      expect(await git(["-C", central, "log", "--format=%an|%s", "main"])).toBe(
        "preparacao|commit inicial",
      );
      expect(await git(["-C", central, "show", "main:README.md"])).toBe(
        "Repositório central da demo do Sprout.",
      );
      const head = await git(["-C", central, "rev-parse", "main"]);
      expect((await readdir(base)).sort()).toEqual([
        "central.git",
        "git-agente-1",
        "git-agente-2",
      ]);
      for (const n of [1, 2]) {
        const clone = join(base, `git-agente-${n}`);
        expect(await git(["-C", clone, "rev-parse", "HEAD"])).toBe(head);
        expect(
          await git(["-C", clone, "rev-parse", "--abbrev-ref", "@{upstream}"]),
        ).toBe("origin/main");
      }
    },
    GIT_TIMEOUT,
  );

  it(
    "starts from scratch: removes stale clones, sentinel and old result",
    async () => {
      const results = join(base, "resultados");
      await prepareGitRun({
        baseDir: base,
        resultsDir: results,
        scenario: SCENARIOS.A,
      });
      const sentinel = join(base, "git-agente-1", "sentinela.txt");
      await writeFile(sentinel, "execução anterior\n");
      await mkdir(join(base, "git-agente-9"));
      await writeFile(join(base, "git-agente-9", "antigo.txt"), "agente 9\n");
      await mkdir(results);
      await writeFile(join(results, "git-A.json"), "{}\n");

      await prepareGitRun({
        baseDir: base,
        resultsDir: results,
        scenario: SCENARIOS.A,
      });

      expect(existsSync(sentinel)).toBe(false);
      expect(existsSync(join(base, "git-agente-9"))).toBe(false);
      expect(existsSync(join(results, "git-A.json"))).toBe(false);
      expect(
        await git([
          "-C",
          join(base, "central.git"),
          "rev-list",
          "--count",
          "main",
        ]),
      ).toBe("1");
    },
    GIT_TIMEOUT,
  );
});

describe("criterion 3: isolated git config", () => {
  it(
    "each clone has its agent's local config; central has gc.auto=0",
    async () => {
      const central = join(base, "central.git");

      await prepareGitRun({
        baseDir: base,
        resultsDir: join(base, "resultados"),
        scenario: SCENARIOS.A,
      });

      expect(await git(["-C", central, "config", "--local", "gc.auto"])).toBe(
        "0",
      );
      // Written by hand, not taken from localGitConfig: a key dropped from
      // that list must make this test fail, not vanish from it.
      const expected: [clone: string, key: string, value: string][] = [
        ["git-agente-1", "user.name", "agente-1"],
        ["git-agente-1", "user.email", "agente-1@example.invalid"],
        ["git-agente-1", "commit.gpgsign", "false"],
        ["git-agente-1", "gc.auto", "0"],
        ["git-agente-2", "user.name", "agente-2"],
        ["git-agente-2", "user.email", "agente-2@example.invalid"],
        ["git-agente-2", "commit.gpgsign", "false"],
        ["git-agente-2", "gc.auto", "0"],
      ];
      for (const [clone, key, value] of expected) {
        expect(
          await git(["-C", join(base, clone), "config", "--local", key]),
        ).toBe(value);
      }
    },
    GIT_TIMEOUT,
  );

  // Same counterproof as the gitEnv test in git.test.ts, but through runGit:
  // process.env points git at fake system and global files. Plain git sees
  // them; runGit must not.
  it("runGit applies gitEnv (fake global config is hidden)", async () => {
    const repo = join(base, "repo");
    const system = join(base, "system.gitconfig");
    const global = join(base, "global.gitconfig");
    await writeFile(system, "[core]\n\tpager = less\n");
    await writeFile(global, "[alias]\n\tst = status\n");
    await gitOk(["init", "-q", repo]);
    vi.stubEnv("GIT_CONFIG_SYSTEM", system);
    vi.stubEnv("GIT_CONFIG_GLOBAL", global);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", undefined);
    const args = [
      "-C",
      repo,
      "config",
      "--list",
      "--show-scope",
      "--name-only",
    ];
    const scopes = (stdout: string) =>
      stdout
        .trim()
        .split("\n")
        .map((line) => line.split("\t")[0]);

    const plain = scopes((await run("git", args, { env: process.env })).stdout);
    const viaRunGit = scopes((await runGit(args)).stdout);

    expect(plain).toContain("system");
    expect(plain).toContain("global");
    expect(viaRunGit).not.toContain("system");
    expect(viaRunGit).not.toContain("global");
  });
});

// Written by hand: the fast-mode title of scenario A and its separator, 35 ━
// (section 1 of the plan of #20).
const TITLE_A = "━━ git · cenário A · modo rápido ━━";
const SEPARATOR_A = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

/** Runs a scenario in `base` with the event lines silenced. */
function runScenario(id: ScenarioId): Promise<RunResult> {
  return runGitScenario({
    scenario: SCENARIOS[id],
    baseDir: base,
    resultsDir: join(base, "resultados"),
    log: () => {},
  });
}

describe("criterion 4: agent cycle", () => {
  it(
    "scenario A: main is linear and has each agent's file, content and author",
    async () => {
      const central = join(base, "central.git");

      await runScenario("A");

      expect(await git(["-C", central, "rev-list", "--count", "main"])).toBe(
        "3",
      );
      expect(await git(["-C", central, "rev-list", "--merges", "main"])).toBe(
        "",
      );
      expect(await git(["-C", central, "ls-tree", "--name-only", "main"])).toBe(
        "README.md\nagente-1.txt\nagente-2.txt",
      );
      for (const n of [1, 2]) {
        const file = `agente-${n}.txt`;
        expect(await git(["-C", central, "show", `main:${file}`])).toBe(
          `agente ${n}`,
        );
        expect(
          await git([
            "-C",
            central,
            "log",
            "--format=%an|%s",
            "main",
            "--",
            file,
          ]),
        ).toBe(`agente-${n}|agente ${n}`);
      }
    },
    GIT_TIMEOUT,
  );
});

describe("criterion 5: attempt ceiling", () => {
  it(
    "checkAttempts sees 1..total, once per push",
    async () => {
      const calls: [total: number, n: number][] = [];
      const events: string[] = [];
      // How many "push →" lines were logged when each check ran.
      const pushLinesSeen: number[] = [];

      await runGitScenario({
        scenario: SCENARIOS.A,
        baseDir: base,
        resultsDir: join(base, "resultados"),
        log: (line) => events.push(line),
        checkAttempts: (total, n) => {
          calls.push([total, n]);
          pushLinesSeen.push(
            events.filter((line) => line.includes("push →")).length,
          );
          checkGitAttempts(total, n);
        },
      });

      // Written by hand: scenario A always takes 3 pushes (one accepted at
      // once; the other rejected once, clean rebase, accepted).
      expect(calls).toEqual([
        [1, 2],
        [2, 2],
        [3, 2],
      ]);
      // Both start checks run in the same microtask round, before any push
      // finishes. The third depends on the race, so it is not asserted.
      expect(pushLinesSeen.slice(0, 2)).toEqual([0, 0]);
    },
    GIT_TIMEOUT,
  );

  it(
    "ceiling 1: HarnessError only after the in-flight agent settles, no JSON",
    async () => {
      const results = join(base, "resultados");
      const events: string[] = [];
      let snapshot: string[] = [];

      // Both agents leave the barrier in the same microtask round: the first
      // passes the check and starts its push, the second throws at once.
      const running = runGitScenario({
        scenario: SCENARIOS.A,
        baseDir: base,
        resultsDir: results,
        log: (line) => events.push(line),
        checkAttempts: (total) => {
          if (total > 1) throw new HarnessError("ceiling 1");
        },
      }).finally(() => {
        snapshot = [...events];
      });

      await expect(running).rejects.toThrow(HarnessError);
      await expect(running).rejects.toThrow("ceiling 1");
      // The run waited for the push in flight (allSettled, R1).
      const pushes = snapshot.filter((line) => line.includes("push →"));
      expect(pushes.length).toBe(1);
      expect(pushes[0]).toContain("push → ✓ aceito");
      // The separator only comes with the summary (P3 of #20).
      expect(snapshot).not.toContain(SEPARATOR_A);
      expect(existsSync(join(results, "git-A.json"))).toBe(false);
    },
    GIT_TIMEOUT,
  );
});

describe("non-HarnessError errors (decision 7)", () => {
  it(
    "a plain Error from an agent is rethrown as is, no JSON",
    async () => {
      const results = join(base, "resultados");

      // Same setup as "ceiling 1", but the second check throws a plain Error,
      // standing in for a bug: it must not be reported as a harness error.
      const error: unknown = await runGitScenario({
        scenario: SCENARIOS.A,
        baseDir: base,
        resultsDir: results,
        log: () => {},
        checkAttempts: (total) => {
          if (total > 1) throw new Error("plain bug");
        },
      }).catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(HarnessError);
      expect((error as Error).message).toBe("plain bug");
      expect(existsSync(join(results, "git-A.json"))).toBe(false);
    },
    GIT_TIMEOUT,
  );
});

describe("criterion 6: real conflict", () => {
  it(
    "scenario C: loser aborts the rebase, ends in conflict with a clean clone",
    async () => {
      const central = join(base, "central.git");

      const result = await runScenario("C");

      const winner = result.agents.find((a) => a.outcome === "accepted");
      const loser = result.agents.find((a) => a.outcome === "conflict");
      expect(winner).toBeDefined();
      expect(loser).toBeDefined();
      const clone = join(base, `git-agente-${loser?.agent}`);
      expect(existsSync(join(clone, ".git", "rebase-merge"))).toBe(false);
      expect(await git(["-C", clone, "status", "--porcelain"])).toBe("");
      expect(await git(["-C", clone, "log", "-1", "--format=%an"])).toBe(
        `agente-${loser?.agent}`,
      );
      expect(await git(["-C", central, "show", "main:conflito.txt"])).toBe(
        `agente ${winner?.agent}`,
      );
      expect(await git(["-C", central, "rev-list", "--count", "main"])).toBe(
        "2",
      );
    },
    GIT_TIMEOUT,
  );
});

describe("criterion 8: result file", () => {
  it(
    "writes git-A.json and readResult reads it back",
    async () => {
      const result = await runScenario("A");

      expect(await readResult(join(base, "resultados"), "git", "A")).toEqual(
        result,
      );
    },
    GIT_TIMEOUT,
  );
});

describe("criterion 9: invariants", () => {
  // D8: invariants only, never how many rejections (that depends on the race).
  // [scenario, accepted, conflicts, attempt ceiling], written by hand.
  it.each([
    ["A", 2, 0, 3],
    ["B", 10, 0, 55],
    ["C", 1, 1, 3],
  ] as const)(
    "scenario %s",
    async (id, acceptedCount, conflictCount, ceiling) => {
      const result = await runScenario(id);

      const accepted = result.agents.filter((a) => a.outcome === "accepted");
      const conflicts = result.agents.filter((a) => a.outcome === "conflict");
      expect(accepted).toHaveLength(acceptedCount);
      expect(conflicts).toHaveLength(conflictCount);
      let total = 0;
      for (const a of result.agents) {
        const rejected = Object.values(a.rejections).reduce(
          (sum, count) => sum + (count ?? 0),
          0,
        );
        expect(a.attempts).toBe(
          a.outcome === "accepted" ? rejected + 1 : rejected,
        );
        expect(a.reparented).toBeNull();
        expect(a.endMs).toBeGreaterThan(0);
        total += a.attempts;
      }
      expect(total).toBeLessThanOrEqual(ceiling);
    },
    GIT_TIMEOUT,
  );
});

describe("summary line (#18, R11)", () => {
  it(
    "scenario A: the last line is the formatted summary",
    async () => {
      const events: string[] = [];

      await runGitScenario({
        scenario: SCENARIOS.A,
        baseDir: base,
        resultsDir: join(base, "resultados"),
        log: (line) => events.push(line),
      });

      // Written by hand: scenario A always gives 2 accepted, 1 rejection,
      // 3 attempts (plan of #18, R11 argument). Only the time varies.
      expect(events.at(-1)).toMatch(
        /^\[git\] resumo: aceitos 2, rejeições 1, tentativas 3, trocas de pai -, conflitos reais 0, tempo total \d+ ms$/,
      );
      expect(events.filter((line) => line.includes("resumo"))).toHaveLength(1);
    },
    GIT_TIMEOUT,
  );
});

describe("formatGitEvent (#20, D4)", () => {
  // Written by hand: one line of each kind from section 1 of the plan of #20,
  // agent 10 as the worst case of digits.
  it.each<[number, GitEvent, string]>([
    [3, { kind: "accepted" }, "[git] agente 3: push → ✓ aceito"],
    [
      7,
      { kind: "rejected", type: "fetch-first" },
      "[git] agente 7: push → ✗ rejeitado (fetch-first)",
    ],
    [
      10,
      { kind: "rejected", type: "ref-lock" },
      "[git] agente 10: push → ✗ rejeitado (ref-lock)",
    ],
    [7, { kind: "rebased" }, "[git] agente 7: pull --rebase → ok"],
    [
      2,
      { kind: "conflict" },
      "[git] agente 2: pull --rebase → ✗ conflito, rebase --abort",
    ],
  ])("agent %d, %o", (agent, event, line) => {
    expect(formatGitEvent(agent, event)).toBe(line);
  });

  // Written by hand: the colored lines of section 2 of the plan of #20; the
  // ref-lock one follows the fetch-first one.
  it.each<[number, GitEvent, string]>([
    [
      3,
      { kind: "accepted" },
      "\x1b[2m[git]\x1b[22m agente 3: push \x1b[2m→\x1b[22m \x1b[32m✓ aceito\x1b[39m",
    ],
    [
      7,
      { kind: "rejected", type: "fetch-first" },
      "\x1b[2m[git]\x1b[22m agente 7: push \x1b[2m→\x1b[22m \x1b[31m✗ rejeitado\x1b[39m \x1b[2m(fetch-first)\x1b[22m",
    ],
    [
      10,
      { kind: "rejected", type: "ref-lock" },
      "\x1b[2m[git]\x1b[22m agente 10: push \x1b[2m→\x1b[22m \x1b[31m✗ rejeitado\x1b[39m \x1b[2m(ref-lock)\x1b[22m",
    ],
    [
      7,
      { kind: "rebased" },
      "\x1b[2m[git]\x1b[22m agente 7: pull --rebase \x1b[2m→\x1b[22m ok",
    ],
    [
      2,
      { kind: "conflict" },
      "\x1b[2m[git]\x1b[22m agente 2: pull --rebase \x1b[2m→\x1b[22m \x1b[33m✗ conflito\x1b[39m, rebase --abort",
    ],
  ])("with color: agent %d, %o", (agent, event, line) => {
    expect(formatGitEvent(agent, event, painter(true))).toBe(line);
  });
});

describe("fast-mode title and separator (#20, D4, P3)", () => {
  it(
    "scenario A: title first, separator before the summary, known lines between",
    async () => {
      const events: string[] = [];

      await runGitScenario({
        scenario: SCENARIOS.A,
        baseDir: base,
        resultsDir: join(base, "resultados"),
        log: (line) => events.push(line),
      });

      // Written by hand: every line an agent of scenario A can print. Which
      // ones show up depends on the race, so only membership is checked.
      const possible = [
        "[git] agente 1: push → ✓ aceito",
        "[git] agente 1: push → ✗ rejeitado (fetch-first)",
        "[git] agente 1: push → ✗ rejeitado (ref-lock)",
        "[git] agente 1: pull --rebase → ok",
        "[git] agente 2: push → ✓ aceito",
        "[git] agente 2: push → ✗ rejeitado (fetch-first)",
        "[git] agente 2: push → ✗ rejeitado (ref-lock)",
        "[git] agente 2: pull --rebase → ok",
      ];
      expect(events[0]).toBe(TITLE_A);
      expect(events.at(-2)).toBe(SEPARATOR_A);
      const middle = events.slice(1, -2);
      expect(middle.filter((line) => !possible.includes(line))).toEqual([]);
      // Written by hand: the counts of scenario A are fixed (R11 of #18: 2
      // accepted, 1 rejection, 3 attempts); only the order varies. Title, 2
      // accepted, 1 rejected, 1 rebase, separator and summary: 7 lines.
      expect(events).toHaveLength(7);
      expect(
        middle.filter((line) => line.endsWith("push → ✓ aceito")).length,
      ).toBe(2);
      expect(
        middle.filter((line) => line.includes("push → ✗ rejeitado")).length,
      ).toBe(1);
      expect(
        middle.filter((line) => line.endsWith("pull --rebase → ok")).length,
      ).toBe(1);
    },
    GIT_TIMEOUT,
  );

  it(
    "scenario A with color: colored title and separator, known lines between",
    async () => {
      const events: string[] = [];

      await runGitScenario({
        scenario: SCENARIOS.A,
        baseDir: base,
        resultsDir: join(base, "resultados"),
        log: (line) => events.push(line),
        color: true,
      });

      // Written by hand, as in the test without color.
      const possible = [
        "[git] agente 1: push → ✓ aceito",
        "[git] agente 1: push → ✗ rejeitado (fetch-first)",
        "[git] agente 1: push → ✗ rejeitado (ref-lock)",
        "[git] agente 1: pull --rebase → ok",
        "[git] agente 2: push → ✓ aceito",
        "[git] agente 2: push → ✗ rejeitado (fetch-first)",
        "[git] agente 2: push → ✗ rejeitado (ref-lock)",
        "[git] agente 2: pull --rebase → ok",
      ];
      expect(events[0]).toBe(
        "\x1b[2m━━\x1b[22m \x1b[1mgit · cenário A · modo rápido\x1b[22m \x1b[2m━━\x1b[22m",
      );
      expect(events.at(-2)).toBe(`\x1b[2m${SEPARATOR_A}\x1b[22m`);
      expect(events).toHaveLength(7);
      expect(
        events
          .slice(1, -2)
          .map(stripAnsi)
          .filter((line) => !possible.includes(line)),
      ).toEqual([]);
    },
    GIT_TIMEOUT,
  );
});
