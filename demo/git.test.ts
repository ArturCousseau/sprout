import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkGitAttempts,
  classifyPush,
  gitEnv,
  identityGitConfig,
  localGitConfig,
  maxGitAttempts,
} from "./git.js";
import { HarnessError } from "./harness-error.js";

const run = promisify(execFile);

describe("gitEnv", () => {
  it("adds the three variables and keeps the base", () => {
    const env = gitEnv({ PATH: "/usr/bin", HOME: "/home/x" });

    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/x",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    });
  });

  it("overrides the variables if the base already has them", () => {
    const env = gitEnv({
      GIT_CONFIG_GLOBAL: "/tmp/other",
      GIT_CONFIG_NOSYSTEM: "0",
    });

    expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
  });

  it("does not change the base object", () => {
    const base = { PATH: "/usr/bin" };

    gitEnv(base);

    expect(base).toEqual({ PATH: "/usr/bin" });
  });
});

describe("identityGitConfig", () => {
  it("lists name, email, gpgsign and gc.auto for preparacao", () => {
    expect(identityGitConfig("preparacao")).toEqual([
      ["user.name", "preparacao"],
      ["user.email", "preparacao@example.invalid"],
      ["commit.gpgsign", "false"],
      ["gc.auto", "0"],
    ]);
  });
});

describe("localGitConfig", () => {
  it("lists name, email, gpgsign and gc.auto for the agent", () => {
    expect(localGitConfig(7)).toEqual([
      ["user.name", "agente-7"],
      ["user.email", "agente-7@example.invalid"],
      ["commit.gpgsign", "false"],
      ["gc.auto", "0"],
    ]);
  });
});

describe("git config isolation (integration, reproduces E4)", () => {
  // <base>/repo is the agent's repository; <base>/system.gitconfig and
  // <base>/global.gitconfig stand in for /etc/gitconfig and ~/.gitconfig.
  let base: string;
  let repo: string;
  let fakeConfigEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "sprout-demo-git-"));
    repo = join(base, "repo");
    const system = join(base, "system.gitconfig");
    const global = join(base, "global.gitconfig");
    await writeFile(system, "[core]\n\tpager = less\n");
    await writeFile(global, "[alias]\n\tst = status\n");
    // Without gitEnv, git reads these two files instead of the machine's
    // real system and global config.
    fakeConfigEnv = {
      ...process.env,
      GIT_CONFIG_SYSTEM: system,
      GIT_CONFIG_GLOBAL: global,
    };
    delete fakeConfigEnv.GIT_CONFIG_NOSYSTEM;
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  async function initAgentRepo(): Promise<void> {
    const env = gitEnv(process.env);
    await run("git", ["init", "-q", repo], { env });
    for (const [key, value] of localGitConfig(1)) {
      await run("git", ["-C", repo, "config", key, value], { env });
    }
  }

  // Scope of each config line git sees in `repo` (names only, no values).
  async function scopes(env: NodeJS.ProcessEnv): Promise<string[]> {
    const { stdout } = await run(
      "git",
      ["-C", repo, "config", "--list", "--show-scope", "--name-only"],
      { env },
    );
    return stdout
      .trim()
      .split("\n")
      .map((line) => line.split("\t")[0]);
  }

  it("with gitEnv, git sees only local config", async () => {
    await initAgentRepo();
    const env = gitEnv(process.env);

    const { stdout } = await run(
      "git",
      ["-C", repo, "config", "--list", "--show-scope"],
      { env },
    );
    const lines = stdout.trim().split("\n");

    expect(lines.filter((line) => !line.startsWith("local\t"))).toEqual([]);
    expect(lines).toEqual(
      expect.arrayContaining([
        "local\tuser.name=agente-1",
        "local\tuser.email=agente-1@example.invalid",
        "local\tcommit.gpgsign=false",
        "local\tgc.auto=0",
      ]),
    );
  });

  // Counterproof with fake files: without gitEnv the same base env shows
  // system and global lines, so the zero with gitEnv comes from
  // GIT_CONFIG_NOSYSTEM and GIT_CONFIG_GLOBAL. Covers what E4 could not check
  // (no /etc/gitconfig there).
  it("hides fake system and global config that git sees without it", async () => {
    await initAgentRepo();

    const without = await scopes(fakeConfigEnv);
    const withGitEnv = await scopes(gitEnv(fakeConfigEnv));

    expect(without.filter((s) => s === "system").length).toBeGreaterThan(0);
    expect(without.filter((s) => s === "global").length).toBeGreaterThan(0);
    expect(withGitEnv.filter((s) => s === "system")).toEqual([]);
    expect(withGitEnv.filter((s) => s === "global")).toEqual([]);
  });
});

describe("git attempt ceiling (D9, per run)", () => {
  it.each([
    [2, 6],
    [10, 30],
  ])("N = %i → ceiling %i", (n, max) => {
    expect(maxGitAttempts(n)).toBe(max);
  });

  it.each([2, 10])("N = %i: total 3N passes", (n) => {
    expect(() => checkGitAttempts(3 * n, n)).not.toThrow();
  });

  it.each([2, 10])("N = %i: total 3N + 1 → HarnessError", (n) => {
    expect(() => checkGitAttempts(3 * n + 1, n)).toThrow(HarnessError);
    expect(() => checkGitAttempts(3 * n + 1, n)).toThrow(
      `${3 * n + 1} attempts in the run, above the ceiling of ${3 * n}`,
    );
  });

  it.each([0, -1, 1.5])("maxGitAttempts: n = %d → RangeError", (n) => {
    expect(() => maxGitAttempts(n)).toThrow(RangeError);
    expect(() => maxGitAttempts(n)).toThrow(
      `n must be a positive integer, got ${n}`,
    );
  });

  it.each([0, -1, 1.5])("checkGitAttempts: n = %d → RangeError", (n) => {
    expect(() => checkGitAttempts(0, n)).toThrow(RangeError);
    expect(() => checkGitAttempts(0, n)).toThrow(
      `n must be a positive integer, got ${n}`,
    );
  });

  it.each([-1, 2.5])("checkGitAttempts: total = %d → RangeError", (total) => {
    expect(() => checkGitAttempts(total, 2)).toThrow(RangeError);
    expect(() => checkGitAttempts(total, 2)).toThrow(
      `totalAttempts must be a non-negative integer, got ${total}`,
    );
  });
});

describe("classifyPush", () => {
  // Real stdout of `git push --porcelain` from Phase 1 (~/notas-sprout/14/),
  // with only the path of the `To` line replaced by <central>:
  //   accepted.txt    ← e1/porcelain-1/out2 (exit code 0)
  //   fetch-first.txt ← e3/round-1/out5     (exit code 1)
  //   ref-lock.txt    ← e1/porcelain-1/out1 (exit code 1)
  async function fixture(name: string): Promise<string> {
    return readFile(
      join(import.meta.dirname, "fixtures", "porcelain", `${name}.txt`),
      "utf8",
    );
  }

  it("real accepted push (code 0) → accepted", async () => {
    expect(classifyPush(await fixture("accepted"), 0)).toBe("accepted");
  });

  it("real fetch first (code 1) → fetch-first", async () => {
    expect(classifyPush(await fixture("fetch-first"), 1)).toBe("fetch-first");
  });

  it("real lost ref race (code 1) → ref-lock", async () => {
    expect(classifyPush(await fixture("ref-lock"), 1)).toBe("ref-lock");
  });

  // Synthetic from here on: built by hand, not captured from git.
  const line = (flag: string, summary: string, ref = "refs/heads/main") =>
    `To <central>\n${flag}\trefs/heads/main:${ref}\t${summary}\nDone\n`;

  it.each([
    ["+", "f411491...4f2287d (forced update)"],
    ["*", "[new branch]"],
  ])("synthetic: flag %j with code 0 → accepted", (flag, summary) => {
    expect(classifyPush(line(flag, summary), 0)).toBe("accepted");
  });

  it.each([
    [
      "no status line",
      "To <central>\nDone\n",
      1,
      "expected 1 status line, got 0",
    ],
    ["empty stdout", "", 1, "expected 1 status line, got 0"],
    [
      "two status lines",
      line("!", "[rejected] (fetch first)") +
        "!\trefs/heads/x:refs/heads/x\t[rejected] (fetch first)\n",
      1,
      "expected 1 status line, got 2",
    ],
    [
      "another ref",
      line(" ", "f411491..4f2287d", "refs/heads/dev"),
      0,
      "status line is not for main",
    ],
    [
      "unknown rejection",
      line("!", "[rejected] (non-fast-forward)"),
      1,
      'unknown rejection: "[rejected] (non-fast-forward)"',
    ],
    [
      "summary from the prototype",
      line("!", "constructor"),
      1,
      'unknown rejection: "constructor"',
    ],
    [
      "unknown flag (= up to date)",
      line("=", "[up to date]"),
      0,
      'unknown flag "="',
    ],
    [
      "accepted line with code 1",
      line(" ", "f411491..4f2287d"),
      1,
      "accepted line with exit code 1",
    ],
    [
      "accepted line with code 128",
      line(" ", "f411491..4f2287d"),
      128,
      "accepted line with exit code 128",
    ],
    [
      "rejected flag with an accepted summary",
      line("!", "f411491..4f2287d"),
      1,
      'unknown rejection: "f411491..4f2287d"',
    ],
    [
      "rejected line with code 0",
      line("!", "[rejected] (fetch first)"),
      0,
      "rejected line with exit code 0",
    ],
    [
      "rejected line with code 128",
      line("!", "[remote rejected] (incorrect old value provided)"),
      128,
      "rejected line with exit code 128",
    ],
  ])("synthetic: %s → HarnessError", (_label, stdout, code, message) => {
    expect(() => classifyPush(stdout, code)).toThrow(HarnessError);
    expect(() => classifyPush(stdout, code)).toThrow(message);
  });
});
