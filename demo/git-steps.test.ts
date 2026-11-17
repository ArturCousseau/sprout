import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stripAnsi, visibleWidth } from "./color.js";
import { gitOk } from "./git-agents.js";
import { expectFetchFirst, runGitSteps } from "./git-steps.js";
import { identityGitConfig } from "./git.js";
import { HarnessError } from "./harness-error.js";
import { SCENARIOS } from "./scenarios.js";

/** Real git and several clones: slower than the default 5 s on a busy CI. */
const GIT_TIMEOUT = 60_000;

/** Teto de colunas de uma linha, largura visível (D7 da #20; era 105 na #17). */
const MAX_COLUMNS = 111;

let base: string;
let results: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "sprout-git-steps-"));
  results = join(base, "resultados");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** Trimmed stdout of a git command that must succeed. */
async function git(args: string[]): Promise<string> {
  return (await gitOk(args)).trim();
}

/** Short hash of `rev` in the central repository, read by the test itself. */
function central(rev: string): Promise<string> {
  return git(["-C", join(base, "central.git"), "rev-parse", "--short=7", rev]);
}

/**
 * Records the event lines, and for each pause how many lines had been
 * printed when it was called. The pause itself returns at once.
 */
function recorder() {
  const events: string[] = [];
  const pausedAt: number[] = [];
  return {
    events,
    pausedAt,
    log: (line: string): void => {
      events.push(line);
    },
    pause: (): Promise<void> => {
      pausedAt.push(events.length);
      return Promise.resolve();
    },
  };
}

describe("runGitSteps: lines (#17, D3, D5)", () => {
  it(
    "scenario A: title, Enter line and the four steps, with the hashes of the central repo",
    async () => {
      const { events, log, pause } = recorder();

      await runGitSteps({
        scenario: SCENARIOS.A,
        baseDir: base,
        resultsDir: results,
        log,
        pause,
      });

      // Checked before reading the central repo, which may not exist.
      expect(events).toHaveLength(6);
      // initial commit ← agent 1 ← agent 2 (rebased)
      expect(
        await git([
          "-C",
          join(base, "central.git"),
          "rev-list",
          "--count",
          "main",
        ]),
      ).toBe("3");
      const initial = await central("main~2");
      const first = await central("main~1");
      const last = await central("main");
      // Written by hand: section 1 of the plan of #20.
      expect(events).toEqual([
        "━━ git · cenário A · passo a passo ━━",
        "[git] Enter antes de cada etapa",
        `[git] 1/4 agente 1 e agente 2 partem da main no commit ${initial}`,
        `[git] 2/4 agente 1: push                    → ✓ aceito, main = ${first}`,
        "[git] 3/4 agente 2: push                    → ✗ REJEITADO (a main andou; o git não olha os arquivos)",
        `[git] 4/4 agente 2: pull --rebase + push    → ✓ aceito, main = ${last}`,
      ]);
      expect(events.filter((line) => visibleWidth(line) > MAX_COLUMNS)).toEqual(
        [],
      );
    },
    GIT_TIMEOUT,
  );

  it(
    "scenario C: the conflict line, and agent 2's rebase aborted",
    async () => {
      const { events, log, pause } = recorder();

      await runGitSteps({
        scenario: SCENARIOS.C,
        baseDir: base,
        resultsDir: results,
        log,
        pause,
      });

      // Checked before reading the central repo, which may not exist.
      expect(events).toHaveLength(6);
      // initial commit ← agent 1; agent 2 never got in
      expect(
        await git([
          "-C",
          join(base, "central.git"),
          "rev-list",
          "--count",
          "main",
        ]),
      ).toBe("2");
      const initial = await central("main~1");
      const first = await central("main");
      // Written by hand: section 1 of the plan of #20.
      expect(events).toEqual([
        "━━ git · cenário C · passo a passo ━━",
        "[git] Enter antes de cada etapa",
        `[git] 1/4 agente 1 e agente 2 partem da main no commit ${initial}`,
        `[git] 2/4 agente 1: push                    → ✓ aceito, main = ${first}`,
        "[git] 3/4 agente 2: push                    → ✗ REJEITADO (a main andou; o git não olha os arquivos)",
        `[git] 4/4 agente 2: pull --rebase           → ✗ CONFLITO em conflito.txt; rebase --abort, main = ${first}`,
      ]);
      expect(events.filter((line) => visibleWidth(line) > MAX_COLUMNS)).toEqual(
        [],
      );
      const clone = join(base, "git-agente-2");
      expect(await git(["-C", clone, "status", "--porcelain"])).toBe("");
      expect(existsSync(join(clone, ".git", "rebase-merge"))).toBe(false);
    },
    GIT_TIMEOUT,
  );
});

describe("runGitSteps: lines with color (#20, D9)", () => {
  it(
    "scenario A: the codes of D1 on every line, written by hand, and the same text without them",
    async () => {
      const { events, log, pause } = recorder();

      await runGitSteps({
        scenario: SCENARIOS.A,
        baseDir: base,
        resultsDir: results,
        log,
        pause,
        color: true,
      });

      // Checked before reading the central repo, which may not exist.
      expect(events).toHaveLength(6);
      const initial = await central("main~2");
      const first = await central("main~1");
      const last = await central("main");
      // Written by hand: section 2 of the plan of #20.
      expect(events).toEqual([
        "\x1b[2m━━\x1b[22m \x1b[1mgit · cenário A · passo a passo\x1b[22m \x1b[2m━━\x1b[22m",
        "\x1b[2m[git]\x1b[22m Enter antes de cada etapa",
        `\x1b[2m[git]\x1b[22m 1/4 agente 1 e agente 2 partem da main no commit \x1b[2m${initial}\x1b[22m`,
        `\x1b[2m[git]\x1b[22m 2/4 agente 1: push                    \x1b[2m→\x1b[22m \x1b[32m✓ aceito\x1b[39m, main = \x1b[2m${first}\x1b[22m`,
        "\x1b[2m[git]\x1b[22m 3/4 agente 2: push                    \x1b[2m→\x1b[22m \x1b[31m✗ REJEITADO\x1b[39m (a main andou; o git não olha os arquivos)",
        `\x1b[2m[git]\x1b[22m 4/4 agente 2: pull --rebase + push    \x1b[2m→\x1b[22m \x1b[32m✓ aceito\x1b[39m, main = \x1b[2m${last}\x1b[22m`,
      ]);
      // Without the codes, the plain lines of section 1 (R15).
      expect(events.map(stripAnsi)).toEqual([
        "━━ git · cenário A · passo a passo ━━",
        "[git] Enter antes de cada etapa",
        `[git] 1/4 agente 1 e agente 2 partem da main no commit ${initial}`,
        `[git] 2/4 agente 1: push                    → ✓ aceito, main = ${first}`,
        "[git] 3/4 agente 2: push                    → ✗ REJEITADO (a main andou; o git não olha os arquivos)",
        `[git] 4/4 agente 2: pull --rebase + push    → ✓ aceito, main = ${last}`,
      ]);
      expect(events.filter((line) => visibleWidth(line) > MAX_COLUMNS)).toEqual(
        [],
      );
    },
    GIT_TIMEOUT,
  );

  it(
    "scenario C: the conflict line in yellow",
    async () => {
      const { events, log, pause } = recorder();

      await runGitSteps({
        scenario: SCENARIOS.C,
        baseDir: base,
        resultsDir: results,
        log,
        pause,
        color: true,
      });

      // Checked before reading the central repo, which may not exist.
      expect(events).toHaveLength(6);
      const first = await central("main");
      // Written by hand: section 2 of the plan of #20.
      expect(events.at(-1)).toBe(
        `\x1b[2m[git]\x1b[22m 4/4 agente 2: pull --rebase           \x1b[2m→\x1b[22m \x1b[33m✗ CONFLITO\x1b[39m em conflito.txt; rebase --abort, main = \x1b[2m${first}\x1b[22m`,
      );
    },
    GIT_TIMEOUT,
  );
});

describe("runGitSteps: pauses (#17, D4, R9)", () => {
  it.each(["A", "C"] as const)(
    "scenario %s: one pause before each step, the first included, none after the last",
    async (id) => {
      const { pausedAt, log, pause } = recorder();

      await runGitSteps({
        scenario: SCENARIOS[id],
        baseDir: base,
        resultsDir: results,
        log,
        pause,
      });

      // Lines already printed at each pause: the title and the Enter line
      // (D4 of #20), then one per step.
      expect(pausedAt).toEqual([2, 3, 4, 5]);
    },
    GIT_TIMEOUT,
  );
});

describe("runGitSteps: no result file (#17, D6)", () => {
  it(
    "the old git-A.json is deleted and no new one is written",
    async () => {
      const { log, pause } = recorder();
      await mkdir(results);
      const json = join(results, "git-A.json");
      await writeFile(json, "{}\n");

      await runGitSteps({
        scenario: SCENARIOS.A,
        baseDir: base,
        resultsDir: results,
        log,
        pause,
      });

      expect(existsSync(json)).toBe(false);
    },
    GIT_TIMEOUT,
  );
});

describe("runGitSteps: checked against the script (#17, D3, R8)", () => {
  it(
    "another push before step 2 → HarnessError, no step 2 line (D8)",
    async () => {
      const events: string[] = [];
      let calls = 0;
      // The second pause runs a real push from a third clone before it lets
      // step 2 go: agent 1's push then really is rejected.
      const pause = async (): Promise<void> => {
        calls += 1;
        if (calls !== 2) return;
        const intruder = join(base, "intruso");
        await gitOk(["clone", "-q", join(base, "central.git"), intruder]);
        for (const [key, value] of identityGitConfig("intruso")) {
          await gitOk(["-C", intruder, "config", key, value]);
        }
        await writeFile(join(intruder, "intruso.txt"), "intruso\n");
        await gitOk(["-C", intruder, "add", "intruso.txt"]);
        await gitOk(["-C", intruder, "commit", "-q", "-m", "intruso"]);
        await gitOk(["-C", intruder, "push", "-q", "origin", "main"]);
      };

      const running = runGitSteps({
        scenario: SCENARIOS.A,
        baseDir: base,
        resultsDir: results,
        log: (line) => events.push(line),
        pause,
      });

      await expect(running).rejects.toBeInstanceOf(HarnessError);
      await expect(running).rejects.toThrow(
        "step 2 (agente 1: push): expected accepted, got fetch-first",
      );
      expect(events).toHaveLength(3); // title, Enter line and step 1, nothing of step 2
      expect(calls).toBe(2);
    },
    GIT_TIMEOUT,
  );

  it(
    "another agente-2.txt before step 4 in A → HarnessError, no step 4 line",
    async () => {
      const events: string[] = [];
      let calls = 0;
      // The fourth pause pushes, from a third clone, an agente-2.txt with
      // other content: agent 2's pull --rebase then really conflicts in A.
      const pause = async (): Promise<void> => {
        calls += 1;
        if (calls !== 4) return;
        const intruder = join(base, "intruso");
        await gitOk(["clone", "-q", join(base, "central.git"), intruder]);
        for (const [key, value] of identityGitConfig("intruso")) {
          await gitOk(["-C", intruder, "config", key, value]);
        }
        await writeFile(join(intruder, "agente-2.txt"), "intruso\n");
        await gitOk(["-C", intruder, "add", "agente-2.txt"]);
        await gitOk(["-C", intruder, "commit", "-q", "-m", "intruso"]);
        await gitOk(["-C", intruder, "push", "-q", "origin", "main"]);
      };

      const running = runGitSteps({
        scenario: SCENARIOS.A,
        baseDir: base,
        resultsDir: results,
        log: (line) => events.push(line),
        pause,
      });

      await expect(running).rejects.toBeInstanceOf(HarnessError);
      await expect(running).rejects.toThrow(
        "step 4 (agente 2: pull --rebase + push): expected rebased, got conflict",
      );
      expect(events).toHaveLength(5); // title, Enter line and steps 1-3, nothing of step 4
      expect(calls).toBe(4);
    },
    GIT_TIMEOUT,
  );
});

describe("expectFetchFirst: agent 2's push (#17, R6)", () => {
  it.each(["ref-lock", "accepted"] as const)("%s → HarnessError", (result) => {
    expect(() => expectFetchFirst(result)).toThrow(HarnessError);
    expect(() => expectFetchFirst(result)).toThrow(
      `step 3 (agente 2: push): expected fetch-first, got ${result}`,
    );
  });

  it("fetch-first → no error", () => {
    expect(() => expectFetchFirst("fetch-first")).not.toThrow();
  });
});
