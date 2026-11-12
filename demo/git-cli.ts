import { type RunGitScenarioOptions, runGitScenario } from "./git-agents.js";
import { HarnessError } from "./harness-error.js";
import { type ExitIo, parseScenarioOrExit } from "./scenarios.js";

/** Everything runGitScenario takes except the scenario, which comes from argv. */
export type GitCliOptions = Omit<RunGitScenarioOptions, "scenario">;

/**
 * `demo:git --cenario A|B|C` (#15): runs the scenario and always ends with
 * `io.exit`. 0: the run finished. 1: a HarnessError, whose message goes to
 * stderr (R1). 2: missing or invalid scenario (parseScenarioOrExit). Any other
 * error is a bug and is rethrown.
 */
export async function runGitCli(
  argv: string[],
  io: ExitIo,
  options: GitCliOptions,
): Promise<never> {
  const scenario = parseScenarioOrExit(argv, io);
  try {
    await runGitScenario({ ...options, scenario });
  } catch (error) {
    if (error instanceof HarnessError) {
      io.stderr.write(`demo:git: ${error.message}\n`);
      return io.exit(1);
    }
    throw error;
  }
  return io.exit(0);
}
