import { rm } from "node:fs/promises";
import { HarnessError } from "./harness-error.js";
import { resultPath } from "./results.js";
import type { Scenario } from "./scenarios.js";
import {
  getMain,
  type Prepared,
  prepareAgents,
  readJson,
  request,
  type SproutFetch,
} from "./sprout-agents.js";
import {
  checkStatus,
  parseAccepted,
  parseConflicts,
} from "./sprout-responses.js";
import {
  type SproutServer,
  type StartSproutServerOptions,
  startSproutServer,
} from "./sprout-server.js";

export interface RunSproutStepsOptions {
  scenario: Scenario;
  /** Server data folder; deleted first, the server creates it again. */
  dataDir: string;
  /** Folder of the result JSON files; the scenario's old one is deleted. */
  resultsDir: string;
  /** Where the step lines go. Tests record them. */
  log?: (line: string) => void;
  /** Every request to the server goes through it. Tests record or replace. */
  fetch?: SproutFetch;
  /** Starts the server. Tests keep the SproutServer to check it exited. */
  startServer?: (options: StartSproutServerOptions) => Promise<SproutServer>;
  /** Waits for the presenter before each step (D4). Tests inject their own. */
  pause: () => Promise<void>;
}

// Column of the arrow: the longest action, "agente 2: envia changeset (pai =
// 1)" (35), plus 4 spaces, as in docs/demo.md §5.
const ACTION_WIDTH = 39;

function stepLine(action: string, result: string): string {
  return `[sprout] ${action.padEnd(ACTION_WIDTH)}→ ${result}`;
}

/**
 * Stops the run when a step's real result is not the script's (D3, R8): the
 * step-by-step mode never prints a step that did not happen.
 */
function expectStep(
  step: number,
  action: string,
  expected: string,
  actual: string,
): void {
  if (actual !== expected) {
    throw new HarnessError(
      `step ${step} (${action}): expected ${expected}, got ${actual}`,
    );
  }
}

/** The server's answer to one POST /changesets, already parsed. */
type Answer =
  { status: 201; parent: number } | { status: 409; conflicts: string[] };

/** An answer in the words of the divergence messages. */
function describe(answer: Answer, sentParent: number): string {
  if (answer.status === 409) return "conflict";
  return answer.parent === sentParent
    ? `accepted on parent ${answer.parent}`
    : `parent changed to ${answer.parent}`;
}

/**
 * The step-by-step mode of scenarios A and C in Sprout (#17, docs/demo.md
 * §5): a fresh server and the same preparation as the fast mode (GET, hash,
 * PUT), then a header and, for each step, a pause, the real request, its
 * check against the script and one line with the head of main read from the
 * server. The order is scripted and the agents never send at the same time.
 * Never writes a result file; the old one is deleted first (D6).
 */
export async function runSproutSteps({
  scenario,
  dataDir,
  resultsDir,
  log = console.log,
  fetch: send = globalThis.fetch,
  startServer = startSproutServer,
  pause,
}: RunSproutStepsOptions): Promise<void> {
  for (const path of [dataDir, resultPath(resultsDir, "sprout", scenario.id)]) {
    await rm(path, { recursive: true, force: true });
  }
  const server = await startServer({ dataDir });

  // The server is stopped on every path, as in the fast mode (R5 of #16).
  try {
    await runSteps(scenario, server.url, send, log, pause);
  } catch (error) {
    // The first error wins. stop() only rejects after the child closed
    // (SIGKILL), so ignoring its error here never leaves a process behind.
    await server.stop().catch(() => {});
    throw error;
  }
  await server.stop(); // here a failure is the run's only error: thrown
}

/** The header and the three steps against the server at `url`. */
async function runSteps(
  scenario: Scenario,
  url: string,
  send: SproutFetch,
  log: (line: string) => void,
  pause: () => Promise<void>,
): Promise<void> {
  const [first, second] = await prepareAgents(scenario, url, send);
  /** One agent's POST /changesets (201 or 409), with its body parsed. */
  const post = async (agent: Prepared): Promise<Answer> => {
    const response = await request(send, "POST", `${url}/changesets`, {
      headers: { "content-type": "application/json" },
      body: agent.body,
    });
    checkStatus("postChangesets", response.status);
    const body = await readJson(response, `postChangesets ${response.status}`);
    return response.status === 201
      ? { status: 201, parent: parseAccepted(body) }
      : { status: 409, conflicts: parseConflicts(body) };
  };
  const sends = (agent: Prepared): string =>
    `agente ${agent.agent}: envia changeset (pai = ${agent.parent})`;
  const action = (agent: Prepared): string =>
    `agente ${agent.agent}: envia changeset`;

  log(
    `[sprout] cenário ${scenario.id}, passo a passo: Enter antes de cada etapa`,
  );

  await pause();
  const start = await getMain(send, url);
  const action1 = "agente 1 e agente 2 partem da main";
  for (const agent of [first, second]) {
    expectStep(1, action1, `parent ${start}`, `parent ${agent.parent}`);
  }
  log(`[sprout] ${action1} no changeset ${start}`);

  await pause();
  const answer1 = await post(first);
  expectStep(
    2,
    action(first),
    `accepted on parent ${first.parent}`,
    describe(answer1, first.parent),
  );
  const afterFirst = await getMain(send, url);
  log(stepLine(sends(first), `aceito, main = ${afterFirst}`));

  await pause();
  const answer2 = await post(second);
  expectStep(
    3,
    action(second),
    scenario.sameFile ? "conflict" : `parent changed to ${afterFirst}`,
    describe(answer2, second.parent),
  );
  const result =
    answer2.status === 409
      ? `CONFLITO (${answer2.conflicts.join(", ")} mudou depois do pai ${second.parent})`
      : `aceito, pai trocado para ${answer2.parent} (outro arquivo)`;
  log(stepLine(sends(second), `${result}, main = ${await getMain(send, url)}`));
}
