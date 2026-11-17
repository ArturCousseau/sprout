import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stripAnsi, visibleWidth } from "./color.js";
import { HarnessError } from "./harness-error.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";
import {
  type SproutServer,
  type StartSproutServerOptions,
  startSproutServer,
} from "./sprout-server.js";
import { type RunSproutStepsOptions, runSproutSteps } from "./sprout-steps.js";

// Above the 10 s ready timeout, so a slow start shows up as a HarnessError and
// not as a vitest timeout (vitest's default is 5 s).
const SPROUT_TIMEOUT = 30_000;

/** Teto de colunas de uma linha, largura visível (D7 da #20; era 105 na #17). */
const MAX_COLUMNS = 111;

const STOPPED_BY_SIGTERM = { code: null, signal: "SIGTERM" };

// Written by hand with `printf 'intruso\n' | sha256sum`, not with hashContent.
const H_INTRUSO =
  "0e887d039f4d1e14760d8eb7eb891f53e52495b5ca9a649d24f4bd1dc8a364ec";

let base: string;
let started: SproutServer[];

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "sprout-steps-"));
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

/** The one server the run started. */
function onlyServer(): SproutServer {
  expect(started).toHaveLength(1);
  return started[0];
}

/**
 * Records the event lines, and for each pause how many lines had been
 * printed when it was called. The pause itself returns at once.
 */
function recorder() {
  const events: string[] = [];
  const pausedAt: number[] = [];
  return {
    events,
    pausedAt,
    log: (line: string): void => {
      events.push(line);
    },
    pause: (): Promise<void> => {
      pausedAt.push(events.length);
      return Promise.resolve();
    },
  };
}

/** Options of a run inside `base`, with the captured server. */
function options(
  scenario: Scenario,
  extra: Pick<RunSproutStepsOptions, "log" | "pause" | "color">,
): RunSproutStepsOptions {
  return {
    scenario,
    dataDir: join(base, "sprout-data"),
    resultsDir: join(base, "resultados"),
    startServer: capture,
    ...extra,
  };
}

describe("runSproutSteps: lines (#17, D3, D5)", () => {
  it(
    "scenario A: title, Enter line and the three steps, agent 2 reparented",
    async () => {
      const { events, log, pause } = recorder();

      await runSproutSteps(options(SCENARIOS.A, { log, pause }));

      // Written by hand: section 1 of the plan of #20.
      expect(events).toEqual([
        "━━ sprout · cenário A · passo a passo ━━",
        "[sprout] Enter antes de cada etapa",
        "[sprout] 1/3 agente 1 e agente 2 partem da main no changeset 1",
        "[sprout] 2/3 agente 1: envia changeset (pai = 1)    → ✓ aceito, main = 2",
        "[sprout] 3/3 agente 2: envia changeset (pai = 1)    → ✓ aceito, pai trocado para 2 (outro arquivo), main = 3",
      ]);
      expect(events.filter((line) => visibleWidth(line) > MAX_COLUMNS)).toEqual(
        [],
      );
    },
    SPROUT_TIMEOUT,
  );

  it(
    "scenario C: the conflict line, main still 2",
    async () => {
      const { events, log, pause } = recorder();

      await runSproutSteps(options(SCENARIOS.C, { log, pause }));

      // Written by hand: section 1 of the plan of #20.
      expect(events).toEqual([
        "━━ sprout · cenário C · passo a passo ━━",
        "[sprout] Enter antes de cada etapa",
        "[sprout] 1/3 agente 1 e agente 2 partem da main no changeset 1",
        "[sprout] 2/3 agente 1: envia changeset (pai = 1)    → ✓ aceito, main = 2",
        "[sprout] 3/3 agente 2: envia changeset (pai = 1)    → ✗ CONFLITO (conflito.txt mudou depois do pai 1), main = 2",
      ]);
      expect(events.filter((line) => visibleWidth(line) > MAX_COLUMNS)).toEqual(
        [],
      );
    },
    SPROUT_TIMEOUT,
  );
});

describe("runSproutSteps: lines with color (#20, D9)", () => {
  it(
    "scenario A: the codes of D1 on every line, written by hand, and the same text without them",
    async () => {
      const { events, log, pause } = recorder();

      await runSproutSteps(options(SCENARIOS.A, { log, pause, color: true }));

      // Written by hand: section 2 of the plan of #20.
      expect(events).toEqual([
        "\x1b[2m━━\x1b[22m \x1b[1msprout · cenário A · passo a passo\x1b[22m \x1b[2m━━\x1b[22m",
        "\x1b[2m[sprout]\x1b[22m Enter antes de cada etapa",
        "\x1b[2m[sprout]\x1b[22m 1/3 agente 1 e agente 2 partem da main no changeset 1",
        "\x1b[2m[sprout]\x1b[22m 2/3 agente 1: envia changeset \x1b[2m(pai = 1)\x1b[22m    \x1b[2m→\x1b[22m \x1b[32m✓ aceito\x1b[39m, main = 2",
        "\x1b[2m[sprout]\x1b[22m 3/3 agente 2: envia changeset \x1b[2m(pai = 1)\x1b[22m    \x1b[2m→\x1b[22m \x1b[32m✓ aceito\x1b[39m, \x1b[34mpai trocado\x1b[39m para 2 (outro arquivo), main = 3",
      ]);
      // Without the codes, the plain lines of section 1 (R15).
      expect(events.map(stripAnsi)).toEqual([
        "━━ sprout · cenário A · passo a passo ━━",
        "[sprout] Enter antes de cada etapa",
        "[sprout] 1/3 agente 1 e agente 2 partem da main no changeset 1",
        "[sprout] 2/3 agente 1: envia changeset (pai = 1)    → ✓ aceito, main = 2",
        "[sprout] 3/3 agente 2: envia changeset (pai = 1)    → ✓ aceito, pai trocado para 2 (outro arquivo), main = 3",
      ]);
      expect(events.filter((line) => visibleWidth(line) > MAX_COLUMNS)).toEqual(
        [],
      );
    },
    SPROUT_TIMEOUT,
  );

  it(
    "scenario C: the conflict line in yellow",
    async () => {
      const { events, log, pause } = recorder();

      await runSproutSteps(options(SCENARIOS.C, { log, pause, color: true }));

      expect(events).toHaveLength(5);
      // Written by hand: section 2 of the plan of #20.
      expect(events.at(-1)).toBe(
        "\x1b[2m[sprout]\x1b[22m 3/3 agente 2: envia changeset \x1b[2m(pai = 1)\x1b[22m    \x1b[2m→\x1b[22m \x1b[33m✗ CONFLITO\x1b[39m (conflito.txt mudou depois do pai 1), main = 2",
      );
    },
    SPROUT_TIMEOUT,
  );
});

describe("runSproutSteps: pauses (#17, D4, R9)", () => {
  it.each(["A", "C"] as const)(
    "scenario %s: one pause before each step, the first included, none after the last",
    async (id) => {
      const { pausedAt, log, pause } = recorder();

      await runSproutSteps(options(SCENARIOS[id], { log, pause }));

      // Lines already printed at each pause: the title and the Enter line
      // (D4 of #20), then one per step.
      expect(pausedAt).toEqual([2, 3, 4]);
    },
    SPROUT_TIMEOUT,
  );
});

describe("runSproutSteps: success (#17, D6, R5 of #16)", () => {
  it(
    "server stopped, the old sprout-A.json deleted and no new one written",
    async () => {
      const { log, pause } = recorder();
      const results = join(base, "resultados");
      await mkdir(results);
      const json = join(results, "sprout-A.json");
      await writeFile(json, "{}\n");

      await runSproutSteps(options(SCENARIOS.A, { log, pause }));

      const server = onlyServer();
      expect(await settledValue(server.exited)).toEqual(STOPPED_BY_SIGTERM);
      await expect(fetch(`${server.url}/refs/main`)).rejects.toThrow(
        "fetch failed",
      );
      expect(existsSync(json)).toBe(false);
    },
    SPROUT_TIMEOUT,
  );
});

describe("runSproutSteps: checked against the script (#17, D3, R8)", () => {
  it(
    "another changeset before step 2 → HarnessError, no step 2 line, server stopped (D8)",
    async () => {
      const events: string[] = [];
      let calls = 0;
      // The second pause sends, as another author, a changeset on parent 1
      // before it lets step 2 go: agent 1's changeset then really is
      // reparented.
      const pause = async (): Promise<void> => {
        calls += 1;
        if (calls !== 2) return;
        const { url } = onlyServer();
        const put = await fetch(`${url}/blobs/${H_INTRUSO}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: "intruso\n",
        });
        expect(put.status).toBe(201);
        const post = await fetch(`${url}/changesets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            parent: 1,
            author: "intruso",
            message: "intruso",
            changes: [{ path: "intruso.txt", blobHash: H_INTRUSO }],
          }),
        });
        expect(post.status).toBe(201);
      };

      const running = runSproutSteps(
        options(SCENARIOS.A, { log: (line) => events.push(line), pause }),
      );

      await expect(running).rejects.toBeInstanceOf(HarnessError);
      await expect(running).rejects.toThrow(
        "step 2 (agente 1: envia changeset): expected accepted on parent 1, got parent changed to 2",
      );
      expect(events).toHaveLength(3); // title, Enter line and step 1, nothing of step 2
      expect(calls).toBe(2);
      const server = onlyServer();
      expect(await settledValue(server.exited)).toEqual(STOPPED_BY_SIGTERM);
      await expect(fetch(`${server.url}/refs/main`)).rejects.toThrow(
        "fetch failed",
      );
    },
    SPROUT_TIMEOUT,
  );

  it(
    "another agente-2.txt before step 3 in A → HarnessError, no step 3 line, server stopped",
    async () => {
      const events: string[] = [];
      let calls = 0;
      // The third pause sends, as another author, a changeset on parent 1
      // that changes agente-2.txt: agent 2's changeset then really conflicts
      // in A.
      const pause = async (): Promise<void> => {
        calls += 1;
        if (calls !== 3) return;
        const { url } = onlyServer();
        const put = await fetch(`${url}/blobs/${H_INTRUSO}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: "intruso\n",
        });
        expect(put.status).toBe(201);
        const post = await fetch(`${url}/changesets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            parent: 1,
            author: "intruso",
            message: "intruso",
            changes: [{ path: "agente-2.txt", blobHash: H_INTRUSO }],
          }),
        });
        expect(post.status).toBe(201);
      };

      const running = runSproutSteps(
        options(SCENARIOS.A, { log: (line) => events.push(line), pause }),
      );

      await expect(running).rejects.toBeInstanceOf(HarnessError);
      await expect(running).rejects.toThrow(
        "step 3 (agente 2: envia changeset): expected parent changed to 2, got conflict",
      );
      expect(events).toHaveLength(4); // title, Enter line and steps 1-2, nothing of step 3
      expect(calls).toBe(3);
      const server = onlyServer();
      expect(await settledValue(server.exited)).toEqual(STOPPED_BY_SIGTERM);
      await expect(fetch(`${server.url}/refs/main`)).rejects.toThrow(
        "fetch failed",
      );
    },
    SPROUT_TIMEOUT,
  );
});
