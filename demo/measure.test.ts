import { describe, expect, it } from "vitest";
import { formatCount, median, timeStats } from "./measure.js";

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
