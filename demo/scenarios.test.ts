import { describe, expect, it } from "vitest";
import {
  type ExitIo,
  SCENARIOS,
  fileFor,
  parseScenario,
  parseScenarioOrExit,
} from "./scenarios.js";

// Fake `process`: records what was written and the exit code. exit() throws so
// that, like the real process.exit, nothing after it runs.
class ExitCalled extends Error {}

function fakeIo() {
  const written: string[] = [];
  const codes: number[] = [];
  const io: ExitIo = {
    stderr: {
      write(text: string) {
        written.push(text);
        return true;
      },
    },
    exit(code: number): never {
      codes.push(code);
      throw new ExitCalled(`exit(${code})`);
    },
  };
  return { io, written, codes };
}

describe("SCENARIOS", () => {
  it("matches the table in docs/demo.md §2", () => {
    expect(SCENARIOS).toEqual({
      A: { id: "A", agents: 2, sameFile: false },
      B: { id: "B", agents: 10, sameFile: false },
      C: { id: "C", agents: 2, sameFile: true },
    });
  });
});

describe("fileFor", () => {
  it("gives each agent its own file in A and B", () => {
    expect(fileFor(SCENARIOS.A, 1)).toBe("agente-1.txt");
    expect(fileFor(SCENARIOS.A, 2)).toBe("agente-2.txt");
    expect(fileFor(SCENARIOS.B, 10)).toBe("agente-10.txt");
  });

  it("gives every agent conflito.txt in C", () => {
    expect(fileFor(SCENARIOS.C, 1)).toBe("conflito.txt");
    expect(fileFor(SCENARIOS.C, 2)).toBe("conflito.txt");
  });

  it.each([0, 3, 1.5])("rejects agent %s in A", (agent) => {
    expect(() => fileFor(SCENARIOS.A, agent)).toThrow(RangeError);
  });
});

describe("parseScenario", () => {
  it.each(["A", "B", "C"] as const)("accepts --cenario %s", (id) => {
    expect(parseScenario(["--cenario", id])).toEqual({
      ok: true,
      scenario: SCENARIOS[id],
    });
  });

  it("accepts --cenario=B", () => {
    expect(parseScenario(["--cenario=B"])).toEqual({
      ok: true,
      scenario: SCENARIOS.B,
    });
  });
});

describe("parseScenarioOrExit", () => {
  it("returns the scenario without writing or exiting", () => {
    const { io, written, codes } = fakeIo();

    expect(parseScenarioOrExit(["--cenario", "C"], io)).toBe(SCENARIOS.C);
    expect(written).toEqual([]);
    expect(codes).toEqual([]);
  });

  it.each([
    ["missing", [], /--cenario is required/],
    ["D", ["--cenario", "D"], /must be A, B or C, got "D"/],
    ["lowercase", ["--cenario", "a"], /must be A, B or C, got "a"/],
    ["unknown option", ["--cenario", "A", "--extra"], /--extra/],
  ])("%s → message on stderr and exit code 2", (_label, argv, message) => {
    const { io, written, codes } = fakeIo();

    expect(() => parseScenarioOrExit(argv, io)).toThrow(ExitCalled);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(message);
    expect(codes).toEqual([2]);
  });
});
