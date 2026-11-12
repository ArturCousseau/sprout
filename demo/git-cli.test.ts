import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGitCli } from "./git-cli.js";
import { HarnessError } from "./harness-error.js";
import type { ExitIo } from "./scenarios.js";

// Fake `process`: records what was written and the exit code. exit() throws so
// that, like the real process.exit, nothing after it runs.
class ExitCalled extends Error {}

function fakeIo() {
  const written: string[] = [];
  const codes: number[] = [];
  const io: ExitIo = {
    stderr: {
      write(text: string) {
        written.push(text);
        return true;
      },
    },
    exit(code: number): never {
      codes.push(code);
      throw new ExitCalled(`exit(${code})`);
    },
  };
  return { io, written, codes };
}

/** Real git and several clones: slower than the default 5 s on a busy CI. */
const GIT_TIMEOUT = 60_000;

let base: string;
let results: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "sprout-git-cli-"));
  results = join(base, "resultados");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("criterion 1: demo:git exit codes", () => {
  it(
    "scenario A exits 0",
    async () => {
      const { io, written, codes } = fakeIo();

      const running = runGitCli(["--cenario", "A"], io, {
        baseDir: base,
        resultsDir: results,
        log: () => {},
      });

      await expect(running).rejects.toThrow(ExitCalled);
      expect(codes).toEqual([0]);
      expect(written).toEqual([]);
      expect(existsSync(join(results, "git-A.json"))).toBe(true);
    },
    GIT_TIMEOUT,
  );

  it.each([
    ["missing", []],
    ["X", ["--cenario", "X"]],
  ])("%s → stderr and exit 2", async (_label, argv) => {
    const { io, written, codes } = fakeIo();

    const running = runGitCli(argv, io, {
      baseDir: base,
      resultsDir: results,
      log: () => {},
    });

    await expect(running).rejects.toThrow(ExitCalled);
    expect(codes).toEqual([2]);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/--cenario/);
    // Nothing ran: no repository was created.
    expect(await readdir(base)).toEqual([]);
  });

  it(
    "HarnessError → stderr and exit 1",
    async () => {
      const { io, written, codes } = fakeIo();

      const running = runGitCli(["--cenario", "A"], io, {
        baseDir: base,
        resultsDir: results,
        log: () => {},
        checkAttempts: () => {
          throw new HarnessError("ceiling 0");
        },
      });

      await expect(running).rejects.toThrow(ExitCalled);
      expect(codes).toEqual([1]);
      expect(written).toHaveLength(1);
      expect(written[0]).toContain("agente 1: ceiling 0");
      expect(written[0]).toContain("agente 2: ceiling 0");
      expect(existsSync(join(results, "git-A.json"))).toBe(false);
    },
    GIT_TIMEOUT,
  );
});
