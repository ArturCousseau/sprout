import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HarnessError } from "./harness-error.js";
import {
  type SproutServer,
  type StartSproutServerOptions,
  startSproutServer,
} from "./sprout-server.js";

// Above the 10 s ready timeout, so a slow start shows up as a HarnessError and
// not as a vitest timeout (vitest's default is 5 s).
const SPROUT_TIMEOUT = 30_000;

// Fake servers (`node -e`): they print the line the real one prints.
const IGNORES_SIGTERM = `
process.on("SIGTERM", () => {});
console.log("sprout server listening on http://127.0.0.1:1");
setInterval(() => {}, 1000);
`;
const NEVER_READY = "setInterval(() => {}, 1000);";

let base: string;
let started: SproutServer[];

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "sprout-demo-server-"));
  started = [];
});

// A red test must not leave a server running: every captured server that has
// not exited yet is killed, and the close is awaited.
afterEach(async () => {
  for (const server of started) {
    // pid 0 or -1 would signal the process group or every process of the
    // user (a skeleton could return one), so only positive pids are killed.
    if (server.pid > 0 && (await settledValue(server.exited)) === "pending") {
      process.kill(server.pid, "SIGKILL");
      await server.exited;
    }
  }
  await rm(base, { recursive: true, force: true });
});

/** startSproutServer that keeps the server for the afterEach. */
async function start(options: StartSproutServerOptions): Promise<SproutServer> {
  const server = await startSproutServer(options);
  started.push(server);
  return server;
}

/**
 * The value of `promise` if it is already settled, or "pending" (does not
 * wait). When both are resolved, race takes the first one in the array.
 */
function settledValue<T>(promise: Promise<T>): Promise<T | "pending"> {
  return Promise.race([promise, Promise.resolve("pending" as const)]);
}

function fakeServer(script: string): StartSproutServerOptions["command"] {
  return { file: process.execPath, args: ["-e", script] };
}

describe("criterion 2: server as a child process", () => {
  it(
    "starts the real server and stop() ends it (exit observed, port refused)",
    async () => {
      const dataDir = join(base, "sprout-data");

      const server = await start({ dataDir });

      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const response = await fetch(`${server.url}/refs/main`);
      expect(await response.json()).toEqual({ id: 1 });
      expect(existsSync(join(dataDir, "sprout.db"))).toBe(true);

      await server.stop();

      // Written by hand (NV4): a process that dies by SIGTERM has no exit code.
      expect(await settledValue(server.exited)).toEqual({
        code: null,
        signal: "SIGTERM",
      });
      await expect(fetch(`${server.url}/refs/main`)).rejects.toThrow(
        "fetch failed",
      );
    },
    SPROUT_TIMEOUT,
  );

  it(
    "two servers at once get different ports",
    async () => {
      const [first, second] = await Promise.all([
        start({ dataDir: join(base, "data-1") }),
        start({ dataDir: join(base, "data-2") }),
      ]);

      expect(first.url).not.toBe(second.url);
      expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(second.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      await Promise.all([first.stop(), second.stop()]);
    },
    SPROUT_TIMEOUT,
  );

  it(
    "ignores SIGTERM → SIGKILL after stopTimeoutMs, HarnessError",
    async () => {
      const server = await start({
        dataDir: join(base, "sprout-data"),
        command: fakeServer(IGNORES_SIGTERM),
        stopTimeoutMs: 200,
      });

      const stopping = server.stop();

      await expect(stopping).rejects.toThrow(HarnessError);
      await expect(stopping).rejects.toThrow("did not stop after 200 ms");
      expect(await settledValue(server.exited)).toEqual({
        code: null,
        signal: "SIGKILL",
      });
    },
    SPROUT_TIMEOUT,
  );
});

describe("criterion 4: server that does not get ready", () => {
  it(
    "exits before ready (PORT=abc) → HarnessError with stderr",
    async () => {
      const starting = start({
        dataDir: join(base, "sprout-data"),
        env: { PORT: "abc" },
      });

      await expect(starting).rejects.toThrow(HarnessError);
      await expect(starting).rejects.toThrow("exited before it was ready");
      await expect(starting).rejects.toThrow(
        "PORT must be an integer from 0 to 65535",
      );
    },
    SPROUT_TIMEOUT,
  );

  it(
    "never ready → HarnessError after readyTimeoutMs, child killed",
    async () => {
      const starting = start({
        dataDir: join(base, "sprout-data"),
        command: fakeServer(NEVER_READY),
        readyTimeoutMs: 200,
      });

      await expect(starting).rejects.toThrow(HarnessError);
      await expect(starting).rejects.toThrow("not ready after 200 ms");
    },
    SPROUT_TIMEOUT,
  );
});

describe("startSproutServer: other failures", () => {
  it(
    "spawn error → HarnessError",
    async () => {
      const starting = start({
        dataDir: join(base, "sprout-data"),
        command: { file: join(base, "missing"), args: [] },
      });

      await expect(starting).rejects.toThrow(HarnessError);
      await expect(starting).rejects.toThrow("cannot start the sprout server");
    },
    SPROUT_TIMEOUT,
  );

  it(
    "stop() after the server died → HarnessError",
    async () => {
      const server = await start({ dataDir: join(base, "sprout-data") });
      expect(server.pid).toBeGreaterThan(0);

      process.kill(server.pid, "SIGKILL");
      await server.exited;

      const stopping = server.stop();
      await expect(stopping).rejects.toThrow(HarnessError);
      await expect(stopping).rejects.toThrow("exited during the run");
    },
    SPROUT_TIMEOUT,
  );
});
