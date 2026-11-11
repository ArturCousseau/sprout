import { parseArgs } from "node:util";

export type ScenarioId = "A" | "B" | "C";

export interface Scenario {
  id: ScenarioId;
  agents: number;
  /** true: every agent writes the same file (a real conflict). */
  sameFile: boolean;
}

/** Same table as docs/demo.md §2. The mode (step by step or fast) is #17. */
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

/** Reads `--cenario A|B|C` from `argv` (arguments after the script name). */
export function parseScenario(argv: string[]): ParseResult {
  let value: string | undefined;
  try {
    const { values } = parseArgs({
      args: argv,
      options: { cenario: { type: "string" } },
      strict: true,
      allowPositionals: false,
    });
    value = values.cenario;
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
  return { ok: true, scenario: SCENARIOS[value] };
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
