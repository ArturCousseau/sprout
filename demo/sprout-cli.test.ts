import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExitIo } from "./scenarios.js";
import type { SproutFetch } from "./sprout-agents.js";
import { type SproutCliOptions, runSproutCli } from "./sprout-cli.js";
import {
  type SproutServer,
  type StartSproutServerOptions,
  startSproutServer,
} from "./sprout-server.js";

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

// Above the 10 s ready timeout, so a slow start shows up as a HarnessError and
// not as a vitest timeout (vitest's default is 5 s).
const SPROUT_TIMEOUT = 30_000;

let base: string;
let started: SproutServer[];

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "sprout-demo-cli-"));
  started = [];
});

// A red test must not leave a server running: every captured server that has
// not exited yet is killed, and the close is awaited.
afterEach(async () => {
  for (const server of started) {
    // pid 0 or -1 would signal the process group or every process of the
    // user, so only positive pids are killed.
    if (server.pid > 0 && (await settledValue(server.exited)) === "pending") {
      process.kill(server.pid, "SIGKILL");
      await server.exited;
    }
  }
  await rm(base, { recursive: true, force: true });
});

/** The value of `promise` if it is already settled, or "pending" (no wait). */
function settledValue<T>(promise: Promise<T>): Promise<T | "pending"> {
  return Promise.race([promise, Promise.resolve("pending" as const)]);
}

/** startSproutServer that keeps the server for the afterEach. */
async function capture(
  options: StartSproutServerOptions,
): Promise<SproutServer> {
  const server = await startSproutServer(options);
  started.push(server);
  return server;
}

/** CLI options inside `base`, silent and with the captured server. */
function options(extra: Partial<SproutCliOptions> = {}): SproutCliOptions {
  return {
    dataDir: join(base, "sprout-data"),
    resultsDir: join(base, "resultados"),
    log: () => {},
    startServer: capture,
    ...extra,
  };
}

/** Real fetch, except that every GET gets a 500. */
const failingGet: SproutFetch = (url, init) =>
  init.method === "GET"
    ? Promise.resolve(new Response("{}", { status: 500 }))
    : fetch(url, init);

describe("criterion 1: demo:sprout exit codes", () => {
  it(
    "scenario A exits 0",
    async () => {
      const { io, written, codes } = fakeIo();

      const running = runSproutCli(["--cenario", "A"], io, options());

      await expect(running).rejects.toThrow(ExitCalled);
      expect(codes).toEqual([0]);
      expect(written).toEqual([]);
      expect(existsSync(join(base, "resultados", "sprout-A.json"))).toBe(true);
    },
    SPROUT_TIMEOUT,
  );

  it.each([
    ["missing", []],
    ["X", ["--cenario", "X"]],
  ])("%s → stderr and exit 2", async (_label, argv) => {
    const { io, written, codes } = fakeIo();

    const running = runSproutCli(argv, io, options());

    await expect(running).rejects.toThrow(ExitCalled);
    expect(codes).toEqual([2]);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/--cenario/);
    // Nothing ran: no server was started and no folder was created.
    expect(started).toEqual([]);
    expect(await readdir(base)).toEqual([]);
  });

  it(
    "HarnessError → stderr and exit 1",
    async () => {
      const { io, written, codes } = fakeIo();

      const running = runSproutCli(
        ["--cenario", "A"],
        io,
        options({ fetch: failingGet }),
      );

      await expect(running).rejects.toThrow(ExitCalled);
      expect(codes).toEqual([1]);
      expect(written).toHaveLength(1);
      expect(written[0]).toContain("demo:sprout: ");
      expect(written[0]).toContain("unexpected status 500 for getMain");
      expect(existsSync(join(base, "resultados", "sprout-A.json"))).toBe(false);
    },
    SPROUT_TIMEOUT,
  );
});
