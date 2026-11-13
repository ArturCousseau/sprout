import { describe, expect, it } from "vitest";
import { parsePort } from "./port.js";

describe("criterion 3: parsePort", () => {
  // Written by hand, not derived from parsePort.
  it.each([
    ["1", 1],
    ["3000", 3000],
    ["65535", 65535],
  ])("%s → %d", (text, expected) => {
    expect(parsePort(text)).toBe(expected);
  });

  it.each([
    ["65536"],
    ["99999999999999999999"],
    ["-1"],
    [""],
    ["abc"],
    ["1.5"],
    ["1e3"],
    [" 80"],
    ["80 "],
    ["0x50"],
    ["+80"],
  ])("%j → null", (text) => {
    expect(parsePort(text)).toBeNull();
  });
});
