import { HarnessError } from "./harness-error.js";
import { type ExitIo, parseScenarioOrExit } from "./scenarios.js";
import {
  type RunSproutScenarioOptions,
  runSproutScenario,
} from "./sprout-agents.js";

/** Everything runSproutScenario takes except the scenario, from argv. */
export type SproutCliOptions = Omit<RunSproutScenarioOptions, "scenario">;

/**
 * `demo:sprout --cenario A|B|C` (#16): runs the scenario and always ends with
 * `io.exit`. 0: the run finished. 1: a HarnessError, whose message goes to
 * stderr (D7). 2: missing or invalid scenario (parseScenarioOrExit). Any other
 * error is a bug and is rethrown.
 */
export async function runSproutCli(
  argv: string[],
  io: ExitIo,
  options: SproutCliOptions,
): Promise<never> {
  const scenario = parseScenarioOrExit(argv, io);
  try {
    await runSproutScenario({ ...options, scenario });
  } catch (error) {
    if (error instanceof HarnessError) {
      io.stderr.write(`demo:sprout: ${error.message}\n`);
      return io.exit(1);
    }
    throw error;
  }
  return io.exit(0);
}
