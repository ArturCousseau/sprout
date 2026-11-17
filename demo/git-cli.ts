import { type RunGitScenarioOptions, runGitScenario } from "./git-agents.js";
import { runGitSteps } from "./git-steps.js";
import { HarnessError } from "./harness-error.js";
import { createLinePause } from "./pause.js";
import { type ExitIo, parseRunArgsOrExit } from "./scenarios.js";

/**
 * Everything runGitScenario takes except the scenario, which comes from argv,
 * plus the input the step-by-step mode reads Enter from.
 */
export interface GitCliOptions extends Omit<RunGitScenarioOptions, "scenario"> {
  /** `process.stdin` in the demo; only read with `--passo` (#17, P5). */
  input: NodeJS.ReadableStream;
  /** Colors on, decided by the entry point with shouldColor (D2 of #20). */
  color: boolean;
}

/**
 * `demo:git --cenario A|B|C [--passo]` (#15, #17): runs the scenario, fast or
 * step by step, and always ends with `io.exit`. 0: the run finished. 1: a
 * HarnessError, whose message goes to stderr (R1); with `--passo`, also stdin
 * closed during a pause. 2: missing or invalid scenario, or `B --passo`
 * (parseRunArgsOrExit). Any other error is a bug and is rethrown.
 */
export async function runGitCli(
  argv: string[],
  io: ExitIo,
  { input, ...options }: GitCliOptions,
): Promise<never> {
  const { scenario, step } = parseRunArgsOrExit(argv, io);
  try {
    if (step) {
      // stdin is only read in the step-by-step mode, and always let go after.
      const lines = createLinePause(input);
      try {
        await runGitSteps({
          scenario,
          baseDir: options.baseDir,
          resultsDir: options.resultsDir,
          log: options.log,
          pause: () => lines.pause(),
          color: options.color,
        });
      } finally {
        lines.close();
      }
    } else {
      await runGitScenario({ ...options, scenario });
    }
  } catch (error) {
    if (error instanceof HarnessError) {
      io.stderr.write(`demo:git: ${error.message}\n`);
      return io.exit(1);
    }
    throw error;
  }
  return io.exit(0);
}
