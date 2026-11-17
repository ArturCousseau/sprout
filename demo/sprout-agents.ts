import { rm } from "node:fs/promises";
import { hashContent } from "../src/core/hash.js";
import { type Barrier, createBarrier } from "./barrier.js";
import { type Paint, painter } from "./color.js";
import { HarnessError } from "./harness-error.js";
import {
  checkMain,
  expectedMain,
  formatMainLine,
  type MainState,
} from "./main-check.js";
import { type AgentResult, summarize } from "./metrics.js";
import { resultPath, type RunResult, writeResult } from "./results.js";
import { fileFor, type Scenario } from "./scenarios.js";
import {
  formatRunTitle,
  formatSeparator,
  formatSummaryLine,
} from "./scoreboard.js";
import {
  checkStatus,
  parseAccepted,
  parseConflicts,
  parseMainRef,
  parseTree,
} from "./sprout-responses.js";
import {
  type SproutServer,
  type StartSproutServerOptions,
  startSproutServer,
} from "./sprout-server.js";

/** The part of `fetch` the agents use: always a string URL and an init. */
export type SproutFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface RunSproutScenarioOptions {
  scenario: Scenario;
  /** Server data folder; deleted first, the server creates it again. */
  dataDir: string;
  /** Folder of the result JSON files. */
  resultsDir: string;
  /** Where the event lines go (D8). Tests pass a silent one. */
  log?: (line: string) => void;
  /** Every request to the server goes through it. Tests record or replace. */
  fetch?: SproutFetch;
  /** Starts the server. Tests keep the SproutServer to check it exited. */
  startServer?: (options: StartSproutServerOptions) => Promise<SproutServer>;
  /** Colors on the lines (D2 of #20). Off by default, as in the tests. */
  color?: boolean;
}

/**
 * Runs one scenario (docs/demo.md §4): a fresh server as a child process, the
 * agents' GET and PUT one after the other, then the N POSTs in parallel from
 * the barrier. Only a run where every agent finished is written and
 * summarized; otherwise it throws one HarnessError with every failed agent's
 * message.
 */
export async function runSproutScenario({
  scenario,
  dataDir,
  resultsDir,
  log = console.log,
  fetch: send = globalThis.fetch,
  startServer = startSproutServer,
  color = false,
}: RunSproutScenarioOptions): Promise<RunResult> {
  for (const path of [dataDir, resultPath(resultsDir, "sprout", scenario.id)]) {
    await rm(path, { recursive: true, force: true });
  }
  const server = await startServer({ dataDir });

  // The server is stopped on every path (R5): after an error too, and before
  // the result is written, so a server that fails to stop leaves no JSON.
  let agents: AgentResult[];
  try {
    agents = await runAgents(scenario, server.url, send, log, color);
    // The main check (#19), inside the try: the server must still answer,
    // and a divergence goes through the catch below, which stops it (D4).
    // After allSettled (inside runAgents), so outside the measured time (D3).
    const expected = expectedMain(scenario, agents, new Map(), hashContent);
    checkMain(expected, await readSproutMain(send, server.url));
    log(formatMainLine("sprout", summarize(agents).accepted, color));
  } catch (error) {
    // P1: the first error wins. stop() only rejects after the child closed
    // (SIGKILL), so ignoring its error here never leaves a process behind.
    await server.stop().catch(() => {});
    throw error;
  }
  await server.stop(); // here a failure is the run's only error: thrown

  const run: RunResult = { system: "sprout", scenario: scenario.id, agents };
  await writeResult(resultsDir, run);
  log(formatSeparator("sprout", scenario.id, color));
  log(formatSummaryLine("sprout", summarize(agents), color));
  return run;
}

/**
 * The agents of one run against the server at `url`: preparation in
 * sequence, then the barrier and the POSTs in parallel. Throws one
 * HarnessError with every failed agent's message, or rethrows a bug.
 */
async function runAgents(
  scenario: Scenario,
  url: string,
  send: SproutFetch,
  log: (line: string) => void,
  color: boolean,
): Promise<AgentResult[]> {
  // Every agent's GET, hash and PUT, one after the other, before the barrier
  // exists (D5): a request that fails here throws before any agent waits, so
  // no agent is left waiting forever for an arrival that never comes.
  const prepared = await prepareAgents(scenario, url, send);

  // The title comes after the preparation and before the barrier exists, so
  // it is never inside the measured time (P3 of #20).
  log(formatRunTitle("sprout", scenario.id, "modo rápido", color));

  // The concurrent part starts here.
  const barrier = createBarrier(scenario.agents);
  const paint = painter(color);
  const runs = prepared.map((agent) =>
    runAgent({ ...agent, url, send, barrier, log, paint }),
  );

  const settled = await Promise.allSettled(runs);

  const agents: AgentResult[] = [];
  const failures: string[] = [];
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") {
      agents.push(outcome.value);
    } else if (outcome.reason instanceof HarnessError) {
      failures.push(`agente ${index + 1}: ${outcome.reason.message}`);
    } else {
      throw outcome.reason; // a bug, not a harness error
    }
  }
  if (failures.length > 0) {
    throw new HarnessError(failures.join("\n"));
  }
  return agents;
}

/**
 * The head of `main` read by `GET /refs/main` on the server at `url`. Used by
 * the fast mode and by the step-by-step mode (#17).
 */
export async function getMain(send: SproutFetch, url: string): Promise<number> {
  const head = await request(send, "GET", `${url}/refs/main`);
  checkStatus("getMain", head.status);
  return parseMainRef(await readJson(head, "getMain"));
}

/**
 * The tree of changeset `id`, path → blobHash, read by
 * `GET /changesets/:id/tree` on the server at `url` (#19, D6).
 */
export async function getTree(
  send: SproutFetch,
  url: string,
  id: number,
): Promise<ReadonlyMap<string, string>> {
  const tree = await request(send, "GET", `${url}/changesets/${id}/tree`);
  checkStatus("getTree", tree.status);
  return parseTree(await readJson(tree, "getTree"), id);
}

/**
 * The main of the server at `url` for the check at the end of a fast run
 * (#19): the head read by `GET /refs/main` and its tree. The head id stands
 * for the commit count (D7): the root is 1 and every accepted changeset
 * takes the next id, so a head of 1 + accepted means no accepted changeset
 * is missing.
 *
 * Sequential ids with no gap are an unverified premise (D7 of #19): they
 * rest on SQLite's rule for an INTEGER PRIMARY KEY without AUTOINCREMENT
 * (the next id is the largest one + 1), not on anything this repo checks.
 * If the premise fails, the check throws a HarnessError instead of passing.
 */
export async function readSproutMain(
  send: SproutFetch,
  url: string,
): Promise<MainState> {
  const head = await getMain(send, url);
  return { files: await getTree(send, url, head), commits: head };
}

/**
 * Each agent's GET, hash and PUT against the server at `url`, one agent after
 * the other; the POST body is built but not sent. Element i is agent i + 1.
 * Used by the fast mode and by the step-by-step mode (#17).
 */
export async function prepareAgents(
  scenario: Scenario,
  url: string,
  send: SproutFetch,
): Promise<Prepared[]> {
  const prepared: Prepared[] = [];
  for (let agent = 1; agent <= scenario.agents; agent++) {
    const parent = await getMain(send, url);

    const content = `agente ${agent}\n`;
    const hash = hashContent(content);
    const put = await request(send, "PUT", `${url}/blobs/${hash}`, {
      headers: { "content-type": "application/octet-stream" },
      body: content,
    });
    checkStatus("putBlob", put.status);
    await put.arrayBuffer(); // read and dropped, so undici frees the connection

    const body = JSON.stringify({
      parent,
      author: `agente-${agent}`,
      message: `agente ${agent}`,
      changes: [{ path: fileFor(scenario, agent), blobHash: hash }],
    });
    prepared.push({ agent, parent, body });
  }
  return prepared;
}

/** What an agent has ready before the barrier. */
export interface Prepared {
  agent: number;
  /** The head read by the GET, sent as the changeset's parent. */
  parent: number;
  /** The POST /changesets body, already as JSON text. */
  body: string;
}

interface AgentContext extends Prepared {
  url: string;
  send: SproutFetch;
  barrier: Barrier;
  log: (line: string) => void;
  /** The run's Paint: plain text when color is off. */
  paint: Paint;
}

/** One agent, already prepared: barrier, then one POST, no retry (D6). */
async function runAgent({
  agent,
  parent,
  body,
  url,
  send,
  barrier,
  log,
  paint,
}: AgentContext): Promise<AgentResult> {
  const release = await barrier.arrive();
  // No await may come between the barrier release above and this call: all
  // POSTs then leave in the same microtask round, before any answer (D6).
  const response = await request(send, "POST", `${url}/changesets`, {
    headers: { "content-type": "application/json" },
    body,
  });
  checkStatus("postChangesets", response.status);

  const result = {
    agent,
    attempts: 1, // one POST, never retried
    rejections: {}, // a Sprout agent is never rejected and tried again
  };
  if (response.status === 201) {
    const newParent = parseAccepted(
      await readJson(response, "postChangesets 201"),
    );
    const endMs = performance.now() - release; // after the body is read (R12)
    const reparented = newParent !== parent;
    log(
      formatSproutEvent(agent, parent, { kind: "accepted", newParent }, paint),
    );
    return { ...result, outcome: "accepted", reparented, endMs };
  }
  const conflicts = parseConflicts(
    await readJson(response, "postChangesets 409"),
  );
  const endMs = performance.now() - release;
  log(formatSproutEvent(agent, parent, { kind: "conflict", conflicts }, paint));
  return { ...result, outcome: "conflict", reparented: false, endMs };
}

/** The server's answer to one agent's POST in the fast mode. */
export type SproutOutcome =
  | { kind: "accepted"; newParent: number }
  | { kind: "conflict"; conflicts: string[] };

/**
 * The event line of `agent`, which sent `parent`, in the fast mode
 * (docs/demo.md §4). An accepted changeset whose parent changed says so.
 * With a coloring `paint`, the prefix, `(pai N)` and the arrow are dim and
 * the result words take their colors, in pieces side by side (D1 of #20).
 */
export function formatSproutEvent(
  agent: number,
  parent: number,
  outcome: SproutOutcome,
  paint: Paint = painter(false),
): string {
  const prefix = `${paint("dim", "[sprout]")} agente ${agent}: changeset ${paint("dim", `(pai ${parent})`)} ${paint("dim", "→")}`;
  if (outcome.kind === "conflict") {
    return `${prefix} ${paint("yellow", "✗ conflito")} (${outcome.conflicts.join(", ")})`;
  }
  const reparented = outcome.newParent !== parent;
  return (
    `${prefix} ${paint("green", "✓ aceito")}` +
    (reparented
      ? `, ${paint("blue", "pai trocado")} para ${outcome.newParent}`
      : "")
  );
}

/**
 * Every request to the server goes through here. A fetch that fails (the
 * connection was refused or reset) is a HarnessError (R4). The call to `send`
 * is the first thing it does, with no await before it: an async function runs
 * without pausing until its first await, so a POST called right after the
 * barrier release leaves in that same microtask round (D6).
 */
export async function request(
  send: SproutFetch,
  method: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await send(url, { ...init, method });
  } catch (error) {
    throw new HarnessError(
      `sprout: ${method} ${new URL(url).pathname}: cannot reach the server`,
      { cause: error },
    );
  }
}

/** The decoded JSON body; a body that is not JSON is a HarnessError (R10). */
export async function readJson(
  response: Response,
  what: string,
): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new HarnessError(
      `sprout: ${what} body: not JSON (got ${JSON.stringify(text)})`,
      { cause: error },
    );
  }
}
