import { describe, expect, it } from "vitest";
import {
  changedPaths,
  formatCount,
  formatMemory,
  formatProgress,
  formatSqlite,
  isDirty,
  measurementPlan,
  median,
  osName,
  timeStats,
} from "./measure.js";

describe("median", () => {
  it("is the middle value of an odd count", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("is the mean of the two middle values of an even count", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("timeStats (D6)", () => {
  it("rounds the mean only at the end", () => {
    // Raw mean 10.8 → 11; the mean of the rounded values would be 10.4 → 10.
    expect(timeStats([10.4, 10.4, 10.4, 10.4, 12.4])).toEqual({
      values: [10, 10, 10, 10, 12],
      mean: 11,
      median: 10,
      min: 10,
      max: 12,
    });
  });

  it("refuses an empty list", () => {
    expect(() => timeStats([])).toThrow(RangeError);
  });
});

describe("formatCount (D7)", () => {
  it("shows one value when the 5 runs agree", () => {
    expect(formatCount([10, 10, 10, 10, 10])).toBe("10");
  });

  it("shows min–max and the 5 values when the runs differ", () => {
    expect(formatCount([45, 44, 45, 45, 43])).toBe(
      "43–45 (45, 44, 45, 45, 43)",
    );
  });

  it("shows - when every value is null (git reparents)", () => {
    expect(formatCount([null, null, null, null, null])).toBe("-");
  });

  it("refuses a list mixing null and numbers", () => {
    expect(() => formatCount([null, 1, 1, 1, 1])).toThrow(RangeError);
  });
});

describe("measurementPlan (D4)", () => {
  it("has 30 runs interleaved by round", () => {
    const plan = measurementPlan();

    expect(plan).toHaveLength(30);
    expect(plan.slice(0, 7)).toEqual([
      { round: 1, system: "git", scenario: "A" },
      { round: 1, system: "sprout", scenario: "A" },
      { round: 1, system: "git", scenario: "B" },
      { round: 1, system: "sprout", scenario: "B" },
      { round: 1, system: "git", scenario: "C" },
      { round: 1, system: "sprout", scenario: "C" },
      { round: 2, system: "git", scenario: "A" },
    ]);
    expect(plan[29]).toEqual({ round: 5, system: "sprout", scenario: "C" });
    expect(plan.filter((run) => run.system === "git")).toHaveLength(15);
  });
});

describe("formatProgress (D14)", () => {
  it("shows the run number and the rounded total time", () => {
    expect(formatProgress(7, 30, "git", "B", 1231.6)).toBe(
      "[7/30] git B: 1232 ms",
    );
  });
});

describe("osName (D8)", () => {
  it("uses PRETTY_NAME and the kernel", () => {
    expect(
      osName(
        'NAME="Arch Linux"\nPRETTY_NAME="Omarchy 3.2"\n',
        "Linux",
        "7.2.15-1-omarchy",
      ),
    ).toBe("Omarchy 3.2, kernel 7.2.15-1-omarchy");
  });

  it("falls back to os.type() and os.release() without /etc/os-release", () => {
    expect(osName(null, "Darwin", "25.1.0")).toBe("Darwin 25.1.0");
  });
});

describe("formatSqlite (D9)", () => {
  it("shows the SQLite version and the better-sqlite3 version", () => {
    expect(formatSqlite("3.53.4", "13.0.3")).toBe(
      "SQLite 3.53.4 (better-sqlite3 13.0.3)",
    );
  });
});

describe("formatMemory (D8)", () => {
  it("shows GiB with one decimal and a comma", () => {
    expect(formatMemory(20268797952)).toBe("18,9 GiB");
  });
});

describe("changedPaths (D9)", () => {
  it("reads the paths of git status --porcelain=v1 -z", () => {
    expect(changedPaths("M  demo/x.ts\0?? docs/resultados.md\0")).toEqual([
      "demo/x.ts",
      "docs/resultados.md",
    ]);
    expect(changedPaths("")).toEqual([]);
  });

  it("refuses an output that does not end in NUL", () => {
    expect(() => changedPaths("M  demo/x.ts")).toThrow(RangeError);
  });
});

describe("isDirty (D9)", () => {
  it("ignores docs/resultados.md", () => {
    expect(isDirty(["docs/resultados.md"])).toBe(false);
  });

  it("is true with another changed file", () => {
    expect(isDirty(["docs/resultados.md", "demo/x.ts"])).toBe(true);
  });
});
