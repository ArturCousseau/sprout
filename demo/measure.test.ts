import { describe, expect, it } from "vitest";
import { median, timeStats } from "./measure.js";

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
