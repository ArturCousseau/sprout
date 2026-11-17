import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGitCli } from "./git-cli.js";
import { HarnessError } from "./harness-error.js";
import type { ExitIo } from "./scenarios.js";
import { runScoreboardCli } from "./scoreboard-cli.js";

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
        color: false,
        log: () => {},
        input: new PassThrough(),
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
      color: false,
      log: () => {},
      input: new PassThrough(),
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
        color: false,
        log: () => {},
        input: new PassThrough(),
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

  it(
    "GC1 main check divergence → stderr and exit 1, no JSON (#19)",
    async () => {
      const { io, written, codes } = fakeIo();

      // Written by hand: a scenario A main without agente-2.txt.
      const running = runGitCli(["--cenario", "A"], io, {
        baseDir: base,
        resultsDir: results,
        color: false,
        log: () => {},
        input: new PassThrough(),
        readMain: () =>
          Promise.resolve({
            files: new Map([
              ["README.md", "Repositório central da demo do Sprout.\n"],
              ["agente-1.txt", "agente 1\n"],
            ]),
            commits: 3,
          }),
      });

      await expect(running).rejects.toThrow(ExitCalled);
      expect(codes).toEqual([1]);
      expect(written).toEqual(["demo:git: main check: missing agente-2.txt\n"]);
      expect(existsSync(join(results, "git-A.json"))).toBe(false);
    },
    GIT_TIMEOUT,
  );
});

/** An input with `text` already written and still open, like a terminal. */
function typed(text: string): PassThrough {
  const input = new PassThrough();
  input.write(text);
  return input;
}

describe("demo:git --passo (#17)", () => {
  it(
    "A --passo after a fast A → exit 0, no JSON, and the scoreboard asks for demo:git (D6)",
    async () => {
      const fast = fakeIo();
      await expect(
        runGitCli(["--cenario", "A"], fast.io, {
          baseDir: base,
          resultsDir: results,
          color: false,
          log: () => {},
          input: new PassThrough(),
        }),
      ).rejects.toThrow(ExitCalled);
      expect(fast.codes).toEqual([0]);
      expect(existsSync(join(results, "git-A.json"))).toBe(true);

      const { io, written, codes } = fakeIo();
      const running = runGitCli(["--cenario", "A", "--passo"], io, {
        baseDir: base,
        resultsDir: results,
        color: false,
        log: () => {},
        input: typed("\n".repeat(4)),
      });

      await expect(running).rejects.toThrow(ExitCalled);
      expect(codes).toEqual([0]);
      expect(written).toEqual([]);
      expect(existsSync(join(results, "git-A.json"))).toBe(false);

      const board = fakeIo();
      const out: string[] = [];
      const scoreboard = runScoreboardCli(
        ["--cenario", "A"],
        {
          ...board.io,
          stdout: {
            write(text: string) {
              out.push(text);
              return true;
            },
          },
        },
        { resultsDir: results, color: false },
      );
      await expect(scoreboard).rejects.toThrow(ExitCalled);
      expect(board.codes).toEqual([1]);
      expect(board.written.join("")).toContain("git-A.json");
      expect(out).toEqual([]);
    },
    GIT_TIMEOUT,
  );

  it(
    "C --passo → exit 0",
    async () => {
      const { io, written, codes } = fakeIo();

      const running = runGitCli(["--cenario", "C", "--passo"], io, {
        baseDir: base,
        resultsDir: results,
        color: false,
        log: () => {},
        input: typed("\n".repeat(4)),
      });

      await expect(running).rejects.toThrow(ExitCalled);
      expect(codes).toEqual([0]);
      expect(written).toEqual([]);
    },
    GIT_TIMEOUT,
  );

  it("B --passo → exit 2 with the R2 message, nothing ran", async () => {
    const { io, written, codes } = fakeIo();

    const running = runGitCli(["--cenario", "B", "--passo"], io, {
      baseDir: base,
      resultsDir: results,
      color: false,
      log: () => {},
      input: new PassThrough(),
    });

    await expect(running).rejects.toThrow(ExitCalled);
    expect(codes).toEqual([2]);
    expect(written).toEqual(["--passo só existe nos cenários A e C\n"]);
    expect(await readdir(base)).toEqual([]);
  });

  it(
    "input already closed → exit 1 with the pause's HarnessError (D7)",
    async () => {
      const { io, written, codes } = fakeIo();
      const input = new PassThrough();
      input.end();

      const running = runGitCli(["--cenario", "A", "--passo"], io, {
        baseDir: base,
        resultsDir: results,
        color: false,
        log: () => {},
        input,
      });

      await expect(running).rejects.toThrow(ExitCalled);
      expect(codes).toEqual([1]);
      expect(written).toEqual([
        "demo:git: stdin closed during a pause (Enter expected)\n",
      ]);
    },
    GIT_TIMEOUT,
  );
});

describe("demo:git with color (#20, D2)", () => {
  // Written by hand: the colored titles of section 2 of the plan of #20.
  it.each([
    [
      "A --passo",
      ["--cenario", "A", "--passo"],
      "\x1b[2m━━\x1b[22m \x1b[1mgit · cenário A · passo a passo\x1b[22m \x1b[2m━━\x1b[22m",
    ],
    [
      "A fast",
      ["--cenario", "A"],
      "\x1b[2m━━\x1b[22m \x1b[1mgit · cenário A · modo rápido\x1b[22m \x1b[2m━━\x1b[22m",
    ],
  ])(
    "%s: color reaches the run, the first line is the colored title",
    async (_label, argv, title) => {
      const { io, codes } = fakeIo();
      const lines: string[] = [];

      const running = runGitCli(argv, io, {
        baseDir: base,
        resultsDir: results,
        log: (line) => lines.push(line),
        input: typed("\n".repeat(4)),
        color: true,
      });

      await expect(running).rejects.toThrow(ExitCalled);
      expect(codes).toEqual([0]);
      expect(lines[0]).toBe(title);
    },
    GIT_TIMEOUT,
  );
});
