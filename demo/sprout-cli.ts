import { HarnessError } from "./harness-error.js";
import { createLinePause } from "./pause.js";
import { type ExitIo, parseRunArgsOrExit } from "./scenarios.js";
import {
  type RunSproutScenarioOptions,
  runSproutScenario,
} from "./sprout-agents.js";
import { runSproutSteps } from "./sprout-steps.js";

/**
 * Everything runSproutScenario takes except the scenario, from argv, plus the
 * input the step-by-step mode reads Enter from.
 */
export interface SproutCliOptions extends Omit<
  RunSproutScenarioOptions,
  "scenario"
> {
  /** `process.stdin` in the demo; only read with `--passo` (#17, P5). */
  input: NodeJS.ReadableStream;
  /** Colors on, decided by the entry point with shouldColor (D2 of #20). */
  color: boolean;
}

/**
 * `demo:sprout --cenario A|B|C [--passo]` (#16, #17): runs the scenario, fast
 * or step by step, and always ends with `io.exit`. 0: the run finished. 1: a
 * HarnessError, whose message goes to stderr (D7); with `--passo`, also stdin
 * closed during a pause. 2: missing or invalid scenario, or `B --passo`
 * (parseRunArgsOrExit). Any other error is a bug and is rethrown.
 */
export async function runSproutCli(
  argv: string[],
  io: ExitIo,
  { input, ...options }: SproutCliOptions,
): Promise<never> {
  const { scenario, step } = parseRunArgsOrExit(argv, io);
  try {
    if (step) {
      // stdin is only read in the step-by-step mode, and always let go after.
      const lines = createLinePause(input);
      try {
        await runSproutSteps({
          ...options,
          scenario,
          pause: () => lines.pause(),
        });
      } finally {
        lines.close();
      }
    } else {
      await runSproutScenario({ ...options, scenario });
    }
  } catch (error) {
    if (error instanceof HarnessError) {
      io.stderr.write(`demo:sprout: ${error.message}\n`);
      return io.exit(1);
    }
    throw error;
  }
  return io.exit(0);
}
