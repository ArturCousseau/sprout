import { parseArgs } from "node:util";

export type ScenarioId = "A" | "B" | "C";

export interface Scenario {
  id: ScenarioId;
  agents: number;
  /** true: every agent writes the same file (a real conflict). */
  sameFile: boolean;
}

/**
 * Same table as docs/demo.md §2. The mode comes from `--passo`
 * (parseRunArgs): A and C run step by step or fast, B only fast (#17, R2).
 */
export const SCENARIOS: Record<ScenarioId, Scenario> = {
  A: { id: "A", agents: 2, sameFile: false },
  B: { id: "B", agents: 10, sameFile: false },
  C: { id: "C", agents: 2, sameFile: true },
};

/** File written by `agent` (1-based): `agente-N.txt`, or `conflito.txt` in C. */
export function fileFor(scenario: Scenario, agent: number): string {
  if (!Number.isInteger(agent) || agent < 1 || agent > scenario.agents) {
    throw new RangeError(
      `agent must be an integer from 1 to ${scenario.agents} in scenario ${scenario.id}, got ${agent}`,
    );
  }
  return scenario.sameFile ? "conflito.txt" : `agente-${agent}.txt`;
}

export type ParseResult =
  { ok: true; scenario: Scenario } | { ok: false; message: string };

function isScenarioId(value: string): value is ScenarioId {
  return Object.hasOwn(SCENARIOS, value);
}

export type RunArgsResult =
  | { ok: true; scenario: Scenario; step: boolean }
  | { ok: false; message: string };

/**
 * The strict parse shared by both entry points: `--cenario` always, and
 * `--passo` only when `allowStep`. Any other option, a positional argument or
 * a missing or invalid scenario is an error.
 */
function parseOptions(argv: string[], allowStep: boolean): RunArgsResult {
  let value: string | undefined;
  let step: boolean;
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        cenario: { type: "string" },
        ...(allowStep && { passo: { type: "boolean" } }),
      },
      strict: true,
      allowPositionals: false,
    });
    value = values.cenario;
    step = values.passo === true;
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  if (value === undefined) {
    return { ok: false, message: "--cenario is required (A, B or C)" };
  }
  if (!isScenarioId(value)) {
    return {
      ok: false,
      message: `--cenario must be A, B or C, got "${value}"`,
    };
  }
  return { ok: true, scenario: SCENARIOS[value], step };
}

/**
 * Reads `--cenario A|B|C` from `argv` (arguments after the script name).
 * Strict: `--passo` is refused like any unknown option. The scoreboard uses
 * it (#17, R1).
 */
export function parseScenario(argv: string[]): ParseResult {
  const result = parseOptions(argv, false);
  return result.ok ? { ok: true, scenario: result.scenario } : result;
}

/**
 * Reads `--cenario A|B|C` and the optional `--passo` (step-by-step mode) for
 * `demo:git` and `demo:sprout` (#17, R1). The step-by-step mode only exists
 * in scenarios A and C (R2).
 */
export function parseRunArgs(argv: string[]): RunArgsResult {
  const result = parseOptions(argv, true);
  if (result.ok && result.step && result.scenario.id === "B") {
    return { ok: false, message: "--passo só existe nos cenários A e C" };
  }
  return result;
}

export interface ExitIo {
  stderr: { write(text: string): unknown };
  exit(code: number): never;
}

/**
 * Like parseScenario, but on error writes the message to `io.stderr` and
 * exits with code 2. Entry points pass `process` as `io`.
 */
export function parseScenarioOrExit(argv: string[], io: ExitIo): Scenario {
  const result = parseScenario(argv);
  if (!result.ok) {
    io.stderr.write(`${result.message}\n`);
    return io.exit(2);
  }
  return result.scenario;
}

/** Like parseRunArgs, but on error writes to `io.stderr` and exits with 2. */
export function parseRunArgsOrExit(
  argv: string[],
  io: ExitIo,
): { scenario: Scenario; step: boolean } {
  const result = parseRunArgs(argv);
  if (!result.ok) {
    io.stderr.write(`${result.message}\n`);
    return io.exit(2);
  }
  return { scenario: result.scenario, step: result.step };
}
