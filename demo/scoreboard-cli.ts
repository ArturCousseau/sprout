import { summarize } from "./metrics.js";
import {
  ResultFileError,
  type RunResult,
  readMtime,
  readResult,
  resultPath,
  type System,
} from "./results.js";
import {
  type ExitIo,
  parseScenarioOrExit,
  type ScenarioId,
} from "./scenarios.js";
import { formatScoreboard } from "./scoreboard.js";

/** `process`-like io: ExitIo plus stdout, where the scoreboard goes (R2). */
export interface ScoreboardIo extends ExitIo {
  stdout: { write(text: string): unknown };
}

export interface ScoreboardCliOptions {
  /** Folder with `git-<X>.json` and `sprout-<X>.json`. */
  resultsDir: string;
  /** Colors on, decided by the entry point with shouldColor (D2 of #20). */
  color: boolean;
}

/** One result file, read and checked, with its modification time. */
interface Loaded {
  run: RunResult;
  mtime: Date;
}

async function loadResult(
  dir: string,
  system: System,
  scenario: ScenarioId,
): Promise<Loaded> {
  const run = await readResult(dir, system, scenario);
  const mtime = await readMtime(resultPath(dir, system, scenario));
  return { run, mtime };
}

/**
 * Reads both result files before anything is printed (R7). Every file problem
 * becomes one line naming the command that writes the file; together they are
 * one ResultFileError. Any other error is a bug and is rethrown.
 */
async function loadResults(
  dir: string,
  scenario: ScenarioId,
): Promise<{ git: Loaded; sprout: Loaded }> {
  const [git, sprout] = await Promise.allSettled([
    loadResult(dir, "git", scenario),
    loadResult(dir, "sprout", scenario),
  ]);
  const problems: string[] = [];
  for (const [system, outcome] of [
    ["git", git],
    ["sprout", sprout],
  ] as const) {
    if (outcome.status === "rejected") {
      if (!(outcome.reason instanceof ResultFileError)) {
        throw outcome.reason; // a bug, not a result file problem
      }
      problems.push(
        `${outcome.reason.message} (rode pnpm demo:${system} --cenario ${scenario})`,
      );
    }
  }
  if (git.status === "fulfilled" && sprout.status === "fulfilled") {
    return { git: git.value, sprout: sprout.value };
  }
  throw new ResultFileError(problems.join("\n"));
}

/**
 * `demo:placar --cenario A|B|C` (#18): reads both result files and prints the
 * scoreboard. Always ends with `io.exit`. 0: scoreboard printed. 1: a result
 * file is missing, unreadable or invalid; one line per file on stderr, stdout
 * empty. 2: missing or invalid scenario (parseScenarioOrExit). Any other error
 * is a bug and is rethrown.
 */
export async function runScoreboardCli(
  argv: string[],
  io: ScoreboardIo,
  { resultsDir, color }: ScoreboardCliOptions,
): Promise<never> {
  const scenario = parseScenarioOrExit(argv, io);
  // The write is inside the try (R3): a bug while printing must be rethrown,
  // not turned into exit 1.
  try {
    const { git, sprout } = await loadResults(resultsDir, scenario.id);
    io.stdout.write(
      formatScoreboard({
        scenario,
        git: summarize(git.run.agents),
        sprout: summarize(sprout.run.agents),
        gitTime: git.mtime,
        sproutTime: sprout.mtime,
        color,
      }),
    );
  } catch (error) {
    if (error instanceof ResultFileError) {
      io.stderr.write(`demo:placar: ${error.message}\n`);
      return io.exit(1);
    }
    throw error;
  }
  return io.exit(0);
}
