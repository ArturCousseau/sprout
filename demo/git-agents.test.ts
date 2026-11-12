import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitOk, runGit } from "./git-agents.js";
import { HarnessError } from "./harness-error.js";

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

describe("criterion 3: isolated git config", () => {
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
