import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitEnv, localGitConfig } from "./git.js";

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
