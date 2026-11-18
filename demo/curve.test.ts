import { describe, expect, it } from "vitest";
import { curvePlan, curveScenario, formatCurveProgress } from "./curve.js";
import { isDirty } from "./measure.js";

describe("isDirty with the ignored path (#50, D5)", () => {
  it("ignores the path it is given (I1)", () => {
    expect(isDirty(["docs/curva.md"], "docs/curva.md")).toBe(false);
  });

  it("replaces the default path instead of adding to it (I2)", () => {
    expect(
      isDirty(["docs/curva.md", "docs/resultados.md"], "docs/curva.md"),
    ).toBe(true);
  });
});

describe("curveScenario (D2)", () => {
  it("is scenario B with N agents in different files (K1)", () => {
    expect(curveScenario(10)).toEqual({
      id: "B",
      agents: 10,
      sameFile: false,
    });
  });
});

describe("curvePlan (D6)", () => {
  it("has 24 runs interleaved by round, N increasing, git first (K2)", () => {
    const plan = curvePlan();

    // 4 values of N × 2 systems × 3 rounds.
    expect(plan).toHaveLength(24);
    // The 7th run is round 1, git N=20: the [7/24] git N=10 of D11 is only
    // a format example (A6 of #21).
    expect(plan.slice(0, 9)).toEqual([
      { round: 1, system: "git", n: 2 },
      { round: 1, system: "sprout", n: 2 },
      { round: 1, system: "git", n: 5 },
      { round: 1, system: "sprout", n: 5 },
      { round: 1, system: "git", n: 10 },
      { round: 1, system: "sprout", n: 10 },
      { round: 1, system: "git", n: 20 },
      { round: 1, system: "sprout", n: 20 },
      { round: 2, system: "git", n: 2 },
    ]);
    expect(plan[23]).toEqual({ round: 3, system: "sprout", n: 20 });
    expect(plan.filter((run) => run.system === "git")).toHaveLength(12);
    expect(plan.filter((run) => run.n === 20)).toHaveLength(6);
  });
});

describe("formatCurveProgress (D11)", () => {
  it("shows the run number, N and the rounded total time (K3)", () => {
    // 2864.6 rounds to 2865; Math.floor would give 2864.
    expect(formatCurveProgress(7, 24, "git", 20, 2864.6)).toBe(
      "[7/24] git N=20: 2865 ms",
    );
  });
});
