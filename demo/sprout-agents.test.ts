import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { painter, stripAnsi } from "./color.js";
import { HarnessError } from "./harness-error.js";
import { readResult } from "./results.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";
import {
  formatSproutEvent,
  type RunSproutScenarioOptions,
  runSproutScenario,
  type SproutFetch,
  type SproutOutcome,
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
  // Written by hand: the head after the run (A: root + 2 accepted = 3; C:
  // root + 1 accepted = 2), whose tree the main check reads (#19).
  it.each([
    ["A", "agente-1.txt", "agente-2.txt", 3],
    ["C", "conflito.txt", "conflito.txt", 2],
  ] as const)(
    "scenario %s: request sequence",
    async (id, path1, path2, head) => {
      const requests: Recorded[] = [];

      await runSproutScenario(
        options(SCENARIOS[id], { fetch: recording(requests) }),
      );

      // 4 of preparation, 2 POSTs and 2 of the main check (#19).
      expect(requests).toHaveLength(8);
      expect(requests.slice(0, 4)).toEqual([
        { method: "GET", path: "/refs/main", body: null },
        { method: "PUT", path: `/blobs/${H1}`, body: "agente 1\n" },
        { method: "GET", path: "/refs/main", body: null },
        { method: "PUT", path: `/blobs/${H2}`, body: "agente 2\n" },
      ]);
      expect(requests.slice(6)).toEqual([
        { method: "GET", path: "/refs/main", body: null },
        { method: "GET", path: `/changesets/${head}/tree`, body: null },
      ]);
      // Exactly 2 POSTs, also in C where one gets a 409: no retry.
      const posts = requests.slice(4, 6);
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

      // Written by hand: every POST leaves before any answer arrives (D6).
      // A delay of only microtasks between the barrier and the POST is the
      // same for every agent and is not caught (mutation M7); the "no await"
      // rule in runAgent is kept by reading the code.
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

describe("summary line (#18, R11)", () => {
  it(
    "scenario A: the last line is the formatted summary",
    async () => {
      const events: string[] = [];
      const log = (line: string): void => {
        events.push(line);
      };

      await runSproutScenario(options(SCENARIOS.A, { log }));

      // Written by hand: scenario A always gives 2 accepted, 0 rejections,
      // 2 attempts, 1 reparent (plan of #18, R11 argument). Only the time
      // varies.
      expect(events.at(-1)).toMatch(
        /^\[sprout\] resumo: aceitos 2, rejeições 0, tentativas 2, trocas de pai 1, conflitos reais 0, tempo total \d+ ms$/,
      );
      expect(events.filter((line) => line.includes("resumo"))).toHaveLength(1);
    },
    SPROUT_TIMEOUT,
  );
});

describe("formatSproutEvent (#20, D4)", () => {
  // Written by hand: the lines of section 1 of the plan of #20, agent 10 as
  // the worst case of digits.
  it.each<[number, number, SproutOutcome, string]>([
    [
      1,
      1,
      { kind: "accepted", newParent: 1 },
      "[sprout] agente 1: changeset (pai 1) → ✓ aceito",
    ],
    [
      10,
      1,
      { kind: "accepted", newParent: 10 },
      "[sprout] agente 10: changeset (pai 1) → ✓ aceito, pai trocado para 10",
    ],
    [
      2,
      1,
      { kind: "conflict", conflicts: ["conflito.txt"] },
      "[sprout] agente 2: changeset (pai 1) → ✗ conflito (conflito.txt)",
    ],
  ])("agent %d, parent %d, %o", (agent, parent, outcome, line) => {
    expect(formatSproutEvent(agent, parent, outcome)).toBe(line);
  });

  // Written by hand: the colored lines of section 2 of the plan of #20.
  it.each<[number, number, SproutOutcome, string]>([
    [
      1,
      1,
      { kind: "accepted", newParent: 1 },
      "\x1b[2m[sprout]\x1b[22m agente 1: changeset \x1b[2m(pai 1)\x1b[22m \x1b[2m→\x1b[22m \x1b[32m✓ aceito\x1b[39m",
    ],
    [
      10,
      1,
      { kind: "accepted", newParent: 10 },
      "\x1b[2m[sprout]\x1b[22m agente 10: changeset \x1b[2m(pai 1)\x1b[22m \x1b[2m→\x1b[22m \x1b[32m✓ aceito\x1b[39m, \x1b[34mpai trocado\x1b[39m para 10",
    ],
    [
      2,
      1,
      { kind: "conflict", conflicts: ["conflito.txt"] },
      "\x1b[2m[sprout]\x1b[22m agente 2: changeset \x1b[2m(pai 1)\x1b[22m \x1b[2m→\x1b[22m \x1b[33m✗ conflito\x1b[39m (conflito.txt)",
    ],
  ])("with color: agent %d, parent %d, %o", (agent, parent, outcome, line) => {
    expect(formatSproutEvent(agent, parent, outcome, painter(true))).toBe(line);
  });
});

// Written by hand: the fast-mode title of scenario A and its separator, 38 ━
// (section 1 of the plan of #20).
const TITLE_A = "━━ sprout · cenário A · modo rápido ━━";
const SEPARATOR_A = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

describe("fast-mode title and separator (#20, D4, P3)", () => {
  it(
    "scenario A: title first, separator before the summary, known lines between",
    async () => {
      const events: string[] = [];
      const log = (line: string): void => {
        events.push(line);
      };

      await runSproutScenario(options(SCENARIOS.A, { log }));

      // Written by hand: every line an agent of scenario A can print. The
      // winner gets changeset 2 and the other agent is moved onto it; which
      // one wins depends on the race, so only membership is checked.
      const possible = [
        "[sprout] agente 1: changeset (pai 1) → ✓ aceito",
        "[sprout] agente 1: changeset (pai 1) → ✓ aceito, pai trocado para 2",
        "[sprout] agente 2: changeset (pai 1) → ✓ aceito",
        "[sprout] agente 2: changeset (pai 1) → ✓ aceito, pai trocado para 2",
      ];
      expect(events[0]).toBe(TITLE_A);
      expect(events.at(-3)).toBe(
        "[sprout] main conferida → ✓ 2 commits aceitos na main (arquivos, conteúdo e contagem)",
      );
      expect(events.at(-2)).toBe(SEPARATOR_A);
      const middle = events.slice(1, -3);
      expect(middle.filter((line) => !possible.includes(line))).toEqual([]);
      // Written by hand: the counts of scenario A are fixed (R11 of #18: 2
      // accepted, 1 reparent); only the order varies. Title, 2 events, main
      // check (#19), separator and summary: 6 lines, and exactly one parent
      // change.
      expect(events).toHaveLength(6);
      expect(
        middle.filter((line) => line.endsWith(", pai trocado para 2")).length,
      ).toBe(1);
    },
    SPROUT_TIMEOUT,
  );

  it(
    "scenario A with color: colored title and separator, known lines between",
    async () => {
      const events: string[] = [];
      const log = (line: string): void => {
        events.push(line);
      };

      await runSproutScenario(options(SCENARIOS.A, { log, color: true }));

      // Written by hand, as in the test without color.
      const possible = [
        "[sprout] agente 1: changeset (pai 1) → ✓ aceito",
        "[sprout] agente 1: changeset (pai 1) → ✓ aceito, pai trocado para 2",
        "[sprout] agente 2: changeset (pai 1) → ✓ aceito",
        "[sprout] agente 2: changeset (pai 1) → ✓ aceito, pai trocado para 2",
      ];
      expect(events[0]).toBe(
        "\x1b[2m━━\x1b[22m \x1b[1msprout · cenário A · modo rápido\x1b[22m \x1b[2m━━\x1b[22m",
      );
      expect(events.at(-3)).toBe(
        "\x1b[2m[sprout]\x1b[22m main conferida \x1b[2m→\x1b[22m \x1b[32m✓ 2 commits aceitos\x1b[39m na main (arquivos, conteúdo e contagem)",
      );
      expect(events.at(-2)).toBe(`\x1b[2m${SEPARATOR_A}\x1b[22m`);
      expect(events).toHaveLength(6);
      expect(
        events
          .slice(1, -3)
          .map(stripAnsi)
          .filter((line) => !possible.includes(line)),
      ).toEqual([]);
    },
    SPROUT_TIMEOUT,
  );

  it(
    "failure after the preparation: title printed, no separator",
    async () => {
      const events: string[] = [];
      const log = (line: string): void => {
        events.push(line);
      };

      const running = runSproutScenario(
        options(SCENARIOS.A, { fetch: answering("POST", 500, "{}"), log }),
      );

      await expect(running).rejects.toThrow(HarnessError);
      expect(events).toContain(TITLE_A);
      expect(events).not.toContain(SEPARATOR_A);
    },
    SPROUT_TIMEOUT,
  );
});

/** Matches exactly `message`, not a part of it. */
function exactly(message: string): RegExp {
  return new RegExp(`^${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

/** One fake answer: the `nth` request with this method and path gets it. */
interface Fake {
  method: string;
  path: string;
  nth: number;
  status: number;
  body: string;
}

/**
 * Real fetch, except the requests named in `fakes`, counted per method and
 * path (#19). Unlike `answering`, the agents' own GET /refs/main still reach
 * the server: only the check's request is replaced.
 */
function withFakes(fakes: Fake[]): SproutFetch {
  const seen = new Map<string, number>();
  return (url, init) => {
    const key = `${init.method} ${new URL(url).pathname}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    const fake = fakes.find(
      (f) => `${f.method} ${f.path}` === key && f.nth === count,
    );
    return fake === undefined
      ? fetch(url, init)
      : Promise.resolve(new Response(fake.body, { status: fake.status }));
  };
}

// Written by hand: a blob hash for the intruder (its value does not matter).
const HI = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("main check at the end of a fast run (#19)", () => {
  // Written by hand. A good scenario A ends at head 3 with agente-1.txt → H1
  // and agente-2.txt → H2. The 3rd GET /refs/main is the check's (the first
  // two are the agents' preparation).
  it.each([
    [
      "missing",
      [
        {
          method: "GET",
          path: "/changesets/3/tree",
          nth: 1,
          status: 200,
          body: `{"id":3,"entries":[{"path":"agente-1.txt","blobHash":"${H1}"}]}`,
        },
      ],
      "main check: missing agente-2.txt",
    ],
    [
      "extra",
      [
        {
          method: "GET",
          path: "/changesets/3/tree",
          nth: 1,
          status: 200,
          body: `{"id":3,"entries":[{"path":"agente-1.txt","blobHash":"${H1}"},{"path":"agente-2.txt","blobHash":"${H2}"},{"path":"intruso.txt","blobHash":"${HI}"}]}`,
        },
      ],
      "main check: extra intruso.txt",
    ],
    [
      "content",
      [
        {
          method: "GET",
          path: "/changesets/3/tree",
          nth: 1,
          status: 200,
          body: `{"id":3,"entries":[{"path":"agente-1.txt","blobHash":"${H1}"},{"path":"agente-2.txt","blobHash":"${H1}"}]}`,
        },
      ],
      "main check: content differs: agente-2.txt",
    ],
    [
      "commits",
      [
        {
          method: "GET",
          path: "/refs/main",
          nth: 3,
          status: 200,
          body: '{"id":2}',
        },
        {
          method: "GET",
          path: "/changesets/2/tree",
          nth: 1,
          status: 200,
          body: `{"id":2,"entries":[{"path":"agente-1.txt","blobHash":"${H1}"},{"path":"agente-2.txt","blobHash":"${H2}"}]}`,
        },
      ],
      "main check: commits: expected 3, got 2",
    ],
  ])(
    "SX1 scenario A, %s → HarnessError, no JSON, server stopped",
    async (_label, fakes, message) => {
      const running = runSproutScenario(
        options(SCENARIOS.A, { fetch: withFakes(fakes) }),
      );

      await expect(running).rejects.toThrow(HarnessError);
      await expect(running).rejects.toThrow(exactly(message));
      expect(existsSync(join(base, "resultados", "sprout-A.json"))).toBe(false);
      expect(await settledValue(onlyServer().exited)).toEqual(
        STOPPED_BY_SIGTERM,
      );
    },
    SPROUT_TIMEOUT,
  );

  it.each([
    [
      "status 404",
      {
        method: "GET",
        path: "/changesets/3/tree",
        nth: 1,
        status: 404,
        body: '{"statusCode":404,"error":"Not Found","message":"changeset not found: 3"}',
      },
      "sprout: unexpected status 404 for getTree (expected 200)",
    ],
    [
      "body with id 2",
      {
        method: "GET",
        path: "/changesets/3/tree",
        nth: 1,
        status: 200,
        body: `{"id":2,"entries":[{"path":"agente-1.txt","blobHash":"${H1}"},{"path":"agente-2.txt","blobHash":"${H2}"}]}`,
      },
      `sprout: getTree body: id must be 3 (got {"id":2,"entries":[{"path":"agente-1.txt","blobHash":"${H1}"},{"path":"agente-2.txt","blobHash":"${H2}"}]})`,
    ],
  ])(
    "SX2 scenario A, getTree %s → HarnessError, server stopped",
    async (_label, fake, message) => {
      const running = runSproutScenario(
        options(SCENARIOS.A, { fetch: withFakes([fake]) }),
      );

      await expect(running).rejects.toThrow(HarnessError);
      await expect(running).rejects.toThrow(exactly(message));
      expect(await settledValue(onlyServer().exited)).toEqual(
        STOPPED_BY_SIGTERM,
      );
    },
    SPROUT_TIMEOUT,
  );

  it(
    "SX3 scenario C with agent 2 winning: the check expects agent 2's content",
    async () => {
      const events: string[] = [];
      const log = (line: string): void => {
        events.push(line);
      };
      // Agent 1's POST gets a 409 written by hand and never reaches the
      // server, so agent 2's changeset is the only one: it wins.
      const agent2Wins: SproutFetch = (url, init) =>
        init.method === "POST" &&
        typeof init.body === "string" &&
        init.body.includes('"author":"agente-1"')
          ? Promise.resolve(
              new Response(
                '{"statusCode":409,"error":"Conflict","message":"paths changed since parent","conflicts":["conflito.txt"]}',
                { status: 409 },
              ),
            )
          : fetch(url, init);

      const result = await runSproutScenario(
        options(SCENARIOS.C, { fetch: agent2Wins, log }),
      );

      expect(result.agents.map((a) => [a.agent, a.outcome])).toEqual([
        [1, "conflict"],
        [2, "accepted"],
      ]);
      expect(events.at(-3)).toBe(
        "[sprout] main conferida → ✓ 1 commit aceito na main (arquivos, conteúdo e contagem)",
      );
      expect(existsSync(join(base, "resultados", "sprout-C.json"))).toBe(true);
    },
    SPROUT_TIMEOUT,
  );

  // Written by hand. The separator of B and C is SEPARATOR_A: the titles
  // differ only in the scenario letter, so they are as wide.
  it.each([
    [
      "B",
      "[sprout] main conferida → ✓ 10 commits aceitos na main (arquivos, conteúdo e contagem)",
    ],
    [
      "C",
      "[sprout] main conferida → ✓ 1 commit aceito na main (arquivos, conteúdo e contagem)",
    ],
  ] as const)(
    "SX4 scenario %s: the main check line right before the separator",
    async (id, line) => {
      const events: string[] = [];
      const log = (event: string): void => {
        events.push(event);
      };

      await runSproutScenario(options(SCENARIOS[id], { log }));

      expect(events.at(-3)).toBe(line);
      expect(events.at(-2)).toBe(SEPARATOR_A);
      expect(
        events.filter((event) => event.includes("main conferida")),
      ).toHaveLength(1);
    },
    SPROUT_TIMEOUT,
  );
});
