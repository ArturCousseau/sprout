import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HarnessError } from "./harness-error.js";
import { readResult } from "./results.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";
import {
  type RunSproutScenarioOptions,
  runSproutScenario,
  type SproutFetch,
} from "./sprout-agents.js";
import {
  type SproutServer,
  type StartSproutServerOptions,
  startSproutServer,
} from "./sprout-server.js";

// Above the 10 s ready timeout, so a slow start shows up as a HarnessError and
// not as a vitest timeout (vitest's default is 5 s).
const SPROUT_TIMEOUT = 30_000;

// Written by hand with `printf 'agente N\n' | sha256sum`, not with hashContent.
const H1 = "ebf0a5cfd5f69be2c45927bf26823df03672b0aab59e77ffedaf4fec371c7161";
const H2 = "3ae6b2f9235e1e7213e554ad7abd104870f8897a2d51771002b3281f5d53ff94";

let base: string;
let started: SproutServer[];

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "sprout-demo-agents-"));
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

/**
 * The value of `promise` if it is already settled, or "pending" (does not
 * wait). When both are resolved, race takes the first one in the array.
 */
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

/** Options of a run inside `base`, silent and with the captured server. */
function options(
  scenario: Scenario,
  extra: Partial<RunSproutScenarioOptions> = {},
): RunSproutScenarioOptions {
  return {
    scenario,
    dataDir: join(base, "sprout-data"),
    resultsDir: join(base, "resultados"),
    log: () => {},
    startServer: capture,
    ...extra,
  };
}

interface Recorded {
  method: string | undefined;
  path: string;
  body: string | null;
}

/** Real fetch that records every request in `requests`. */
function recording(requests: Recorded[]): SproutFetch {
  return (url, init) => {
    requests.push({
      method: init.method,
      path: new URL(url).pathname,
      body: typeof init.body === "string" ? init.body : null,
    });
    return fetch(url, init);
  };
}

/** Real fetch, except that every `method` request gets this answer. */
function answering(method: string, status: number, body: string): SproutFetch {
  return (url, init) =>
    init.method === method
      ? Promise.resolve(new Response(body, { status }))
      : fetch(url, init);
}

describe("criterion 2: data dir", () => {
  it(
    "scenario A: data dir recreated",
    async () => {
      const dataDir = join(base, "sprout-data");
      await mkdir(dataDir, { recursive: true });
      await writeFile(join(dataDir, "sentinela.txt"), "run anterior\n");

      await runSproutScenario(options(SCENARIOS.A));

      expect(existsSync(join(dataDir, "sentinela.txt"))).toBe(false);
      expect(existsSync(join(dataDir, "sprout.db"))).toBe(true);
    },
    SPROUT_TIMEOUT,
  );
});

describe("criterion 5: agent cycle", () => {
  it.each([
    ["A", "agente-1.txt", "agente-2.txt"],
    ["C", "conflito.txt", "conflito.txt"],
  ] as const)(
    "scenario %s: request sequence",
    async (id, path1, path2) => {
      const requests: Recorded[] = [];

      await runSproutScenario(
        options(SCENARIOS[id], { fetch: recording(requests) }),
      );

      expect(requests.slice(0, 4)).toEqual([
        { method: "GET", path: "/refs/main", body: null },
        { method: "PUT", path: `/blobs/${H1}`, body: "agente 1\n" },
        { method: "GET", path: "/refs/main", body: null },
        { method: "PUT", path: `/blobs/${H2}`, body: "agente 2\n" },
      ]);
      // Exactly 2 POSTs, also in C where one gets a 409: no retry.
      const posts = requests.slice(4);
      expect(posts.map((r) => `${r.method} ${r.path}`)).toEqual([
        "POST /changesets",
        "POST /changesets",
      ]);
      // The agents race, so the bodies are sorted by author before comparing.
      const bodies = posts
        .map((r) => JSON.parse(r.body ?? "null") as { author: string })
        .sort((a, b) => a.author.localeCompare(b.author));
      expect(bodies).toEqual([
        {
          parent: 1,
          author: "agente-1",
          message: "agente 1",
          changes: [{ path: path1, blobHash: H1 }],
        },
        {
          parent: 1,
          author: "agente-2",
          message: "agente 2",
          changes: [{ path: path2, blobHash: H2 }],
        },
      ]);
    },
    SPROUT_TIMEOUT,
  );

  it(
    "every POST leaves before any answer",
    async () => {
      let answered = 0; // POST answers received so far
      const answeredAtSend: number[] = [];
      const countingFetch: typeof fetch = async (input, init) => {
        const seen = answered; // first statement: synchronous, before any await
        const response = await fetch(input, init);
        if (init?.method === "POST") {
          answeredAtSend.push(seen);
          answered += 1; // only after the real answer arrived
        }
        return response;
      };

      await runSproutScenario({
        scenario: SCENARIOS.A,
        dataDir: join(base, "sprout-data"),
        resultsDir: join(base, "resultados"),
        log: () => {},
        fetch: countingFetch,
        startServer: capture,
      });

      // Written by hand: both POSTs leave in the same microtask round as the
      // barrier release, before any answer (D6).
      expect(answeredAtSend).toEqual([0, 0]);
    },
    SPROUT_TIMEOUT,
  );

  it.each([
    [
      "getMain",
      "GET",
      500,
      ["sprout: unexpected status 500 for getMain (expected 200)"],
    ],
    [
      "putBlob",
      "PUT",
      202,
      ["sprout: unexpected status 202 for putBlob (expected 201 or 200)"],
    ],
    [
      "postChangesets",
      "POST",
      400,
      [
        "agente 1: sprout: unexpected status 400 for postChangesets (expected 201 or 409)",
        "agente 2: sprout: unexpected status 400 for postChangesets (expected 201 or 409)",
      ],
    ],
  ] as const)(
    "unexpected %s status → HarnessError, no JSON",
    async (_op, method, status, messages) => {
      const resultsDir = join(base, "resultados");
      const oldResult = join(resultsDir, "sprout-A.json");
      await mkdir(resultsDir, { recursive: true });
      await writeFile(oldResult, "run anterior\n");

      const running = runSproutScenario(
        options(SCENARIOS.A, { fetch: answering(method, status, "{}") }),
      );

      await expect(running).rejects.toThrow(HarnessError);
      for (const message of messages) {
        await expect(running).rejects.toThrow(message);
      }
      expect(existsSync(oldResult)).toBe(false);
    },
    SPROUT_TIMEOUT,
  );
});

describe("criterion 6: response bodies in the run", () => {
  it.each([
    ["201 {}", 201, "{}", "parent must be an integer"],
    ["201 invalid JSON", 201, "x", "not JSON"],
    [
      "409 { conflicts: [] }",
      409,
      '{"conflicts":[]}',
      "conflicts must be a non-empty array of strings",
    ],
  ] as const)(
    "bad %s body → HarnessError",
    async (_label, status, body, message) => {
      const running = runSproutScenario(
        options(SCENARIOS.A, { fetch: answering("POST", status, body) }),
      );

      await expect(running).rejects.toThrow(HarnessError);
      await expect(running).rejects.toThrow(`agente 1: sprout: postChangesets`);
      await expect(running).rejects.toThrow(message);
    },
    SPROUT_TIMEOUT,
  );
});

describe("criterion 7: result file", () => {
  it(
    "writes sprout-A.json and readResult reads it back",
    async () => {
      const resultsDir = join(base, "resultados");

      const result = await runSproutScenario(options(SCENARIOS.A));

      await expect(readResult(resultsDir, "sprout", "A")).resolves.toEqual(
        result,
      );
    },
    SPROUT_TIMEOUT,
  );
});

describe("criterion 8: scenario table (D9)", () => {
  // Written by hand from the D9 table: agents, accepted, conflicts, reparents.
  it.each([
    ["A", 2, 2, 0, 1],
    ["B", 10, 10, 0, 9],
    ["C", 2, 1, 1, 0],
  ] as const)(
    "scenario %s",
    async (id, agents, accepted, conflicts, reparents) => {
      const result = await runSproutScenario(options(SCENARIOS[id]));

      expect(result.agents).toHaveLength(agents);
      expect(result.system).toBe("sprout");
      expect(result.scenario).toBe(id);
      expect(
        result.agents.filter((a) => a.outcome === "accepted"),
      ).toHaveLength(accepted);
      expect(
        result.agents.filter((a) => a.outcome === "conflict"),
      ).toHaveLength(conflicts);
      expect(result.agents.filter((a) => a.reparented === true)).toHaveLength(
        reparents,
      );
      for (const record of result.agents) {
        expect(record.attempts).toBe(1);
        expect(record.rejections).toEqual({});
        expect(typeof record.reparented).toBe("boolean");
        expect(record.endMs).toBeGreaterThan(0);
      }
    },
    SPROUT_TIMEOUT,
  );
});

/** The one server the run started. */
function onlyServer(): SproutServer {
  expect(started).toHaveLength(1);
  return started[0];
}

/** Like capture, but its stop() stops the real server and then fails. */
async function captureFailingStop(
  options: StartSproutServerOptions,
): Promise<SproutServer> {
  const server = await capture(options);
  return {
    ...server,
    stop: async () => {
      await server.stop();
      throw new HarnessError("stop failed");
    },
  };
}

// Written by hand (NV4): a process that dies by SIGTERM has no exit code.
const STOPPED_BY_SIGTERM = { code: null, signal: "SIGTERM" };

describe("criterion 2: server stopped on every path", () => {
  it(
    "success: server stopped",
    async () => {
      await runSproutScenario(options(SCENARIOS.A));

      const server = onlyServer();
      expect(await settledValue(server.exited)).toEqual(STOPPED_BY_SIGTERM);
      await expect(fetch(`${server.url}/refs/main`)).rejects.toThrow(
        "fetch failed",
      );
    },
    SPROUT_TIMEOUT,
  );

  it(
    "HarnessError before the barrier: server stopped",
    async () => {
      const running = runSproutScenario(
        options(SCENARIOS.A, { fetch: answering("PUT", 202, "{}") }),
      );

      await expect(running).rejects.toThrow(HarnessError);
      expect(await settledValue(onlyServer().exited)).toEqual(
        STOPPED_BY_SIGTERM,
      );
    },
    SPROUT_TIMEOUT,
  );

  it(
    "bug after the barrier: rethrown, server stopped",
    async () => {
      // The first event line comes after the barrier, from an agent.
      const log = (): void => {
        throw new Error("plain bug");
      };

      const running = runSproutScenario(options(SCENARIOS.A, { log }));

      await expect(running).rejects.toThrow("plain bug");
      await expect(running).rejects.not.toBeInstanceOf(HarnessError);
      expect(await settledValue(onlyServer().exited)).toEqual(
        STOPPED_BY_SIGTERM,
      );
    },
    SPROUT_TIMEOUT,
  );

  it(
    "stop fails after a good run: HarnessError, no JSON",
    async () => {
      const running = runSproutScenario(
        options(SCENARIOS.A, { startServer: captureFailingStop }),
      );

      await expect(running).rejects.toThrow(HarnessError);
      await expect(running).rejects.toThrow("stop failed");
      expect(existsSync(join(base, "resultados", "sprout-A.json"))).toBe(false);
    },
    SPROUT_TIMEOUT,
  );

  it(
    "error in flight and stop fails: first error wins",
    async () => {
      const running = runSproutScenario(
        options(SCENARIOS.A, {
          fetch: answering("PUT", 202, "{}"),
          startServer: captureFailingStop,
        }),
      );

      await expect(running).rejects.toThrow("unexpected status 202");
      await expect(running).rejects.not.toThrow("stop failed");
    },
    SPROUT_TIMEOUT,
  );
});

describe("decision 3: server dies during the run", () => {
  it(
    "server killed before the agents → HarnessError cannot reach",
    async () => {
      // Starts the real server and kills it before handing it over.
      const startKilled = async (
        startOptions: StartSproutServerOptions,
      ): Promise<SproutServer> => {
        const server = await capture(startOptions);
        expect(server.pid).toBeGreaterThan(0);
        process.kill(server.pid, "SIGKILL");
        await server.exited;
        return server;
      };

      const running = runSproutScenario(
        options(SCENARIOS.A, { startServer: startKilled }),
      );

      await expect(running).rejects.toBeInstanceOf(HarnessError);
      await expect(running).rejects.toThrow(
        "sprout: GET /refs/main: cannot reach the server",
      );
    },
    SPROUT_TIMEOUT,
  );
});
