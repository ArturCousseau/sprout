import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitOk, prepareGitRun, runGit } from "./git-agents.js";
import { HarnessError } from "./harness-error.js";
import { SCENARIOS } from "./scenarios.js";

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
