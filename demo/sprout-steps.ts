import { rm } from "node:fs/promises";
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
 * The step-by-step mode of scenarios A and C in Sprout (#17, docs/demo.md
 * §5): a fresh server and the same preparation as the fast mode (GET, hash,
 * PUT), then a header and, for each step, a pause, the real request and one
 * line with the head of main read from the server. The order is scripted and
 * the agents never send at the same time. Never writes a result file; the
 * old one is deleted first (D6).
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
  const { url } = server;

  const [first, second] = await prepareAgents(scenario, url, send);
  /** One agent's POST /changesets (201 or 409); returns the decoded body. */
  const post = async (agent: Prepared): Promise<unknown> => {
    const response = await request(send, "POST", `${url}/changesets`, {
      headers: { "content-type": "application/json" },
      body: agent.body,
    });
    checkStatus("postChangesets", response.status);
    return readJson(response, `postChangesets ${response.status}`);
  };
  const sends = (agent: Prepared): string =>
    `agente ${agent.agent}: envia changeset (pai = ${agent.parent})`;

  log(
    `[sprout] cenário ${scenario.id}, passo a passo: Enter antes de cada etapa`,
  );

  await pause();
  log(
    `[sprout] agente 1 e agente 2 partem da main no changeset ${await getMain(send, url)}`,
  );

  await pause();
  parseAccepted(await post(first));
  log(stepLine(sends(first), `aceito, main = ${await getMain(send, url)}`));

  await pause();
  const answer = await post(second);
  if (scenario.sameFile) {
    const conflicts = parseConflicts(answer);
    log(
      stepLine(
        sends(second),
        `CONFLITO (${conflicts.join(", ")} mudou depois do pai ${second.parent}), main = ${await getMain(send, url)}`,
      ),
    );
  } else {
    const newParent = parseAccepted(answer);
    log(
      stepLine(
        sends(second),
        `aceito, pai trocado para ${newParent} (outro arquivo), main = ${await getMain(send, url)}`,
      ),
    );
  }

  await server.stop();
}
