import { summarize } from "./metrics.js";
import { readMtime, readResult, resultPath } from "./results.js";
import { type ExitIo, parseScenarioOrExit } from "./scenarios.js";
import { formatScoreboard } from "./scoreboard.js";

/** `process`-like io: ExitIo plus stdout, where the scoreboard goes (R2). */
export interface ScoreboardIo extends ExitIo {
  stdout: { write(text: string): unknown };
}

export interface ScoreboardCliOptions {
  /** Folder with `git-<X>.json` and `sprout-<X>.json`. */
  resultsDir: string;
}

/**
 * `demo:placar --cenario A|B|C` (#18): reads both result files and prints the
 * scoreboard. Always ends with `io.exit`. 0: scoreboard printed. 2: missing
 * or invalid scenario (parseScenarioOrExit).
 */
export async function runScoreboardCli(
  argv: string[],
  io: ScoreboardIo,
  { resultsDir }: ScoreboardCliOptions,
): Promise<never> {
  const scenario = parseScenarioOrExit(argv, io);
  const git = await readResult(resultsDir, "git", scenario.id);
  const gitTime = await readMtime(resultPath(resultsDir, "git", scenario.id));
  const sprout = await readResult(resultsDir, "sprout", scenario.id);
  const sproutTime = await readMtime(
    resultPath(resultsDir, "sprout", scenario.id),
  );
  io.stdout.write(
    formatScoreboard({
      scenario,
      git: summarize(git.agents),
      sprout: summarize(sprout.agents),
      gitTime,
      sproutTime,
    }),
  );
  return io.exit(0);
}
