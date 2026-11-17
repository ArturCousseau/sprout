import { describe, expect, it } from "vitest";
import { painter, shouldColor, stripAnsi, visibleWidth } from "./color.js";

// The step-by-step title of the plan of #20 (section 2), codes written by hand.
const COLORED_TITLE =
  "\x1b[2m━━\x1b[22m \x1b[1mgit · cenário A · passo a passo\x1b[22m \x1b[2m━━\x1b[22m";

describe("shouldColor (D2, R10)", () => {
  it.each([
    ["TTY, NO_COLOR absent", true, {}, true],
    ["TTY, NO_COLOR empty (counts as absent)", true, { NO_COLOR: "" }, true],
    ["TTY, NO_COLOR=1", true, { NO_COLOR: "1" }, false],
    ["TTY, NO_COLOR=0 (any value)", true, { NO_COLOR: "0" }, false],
    ["not a TTY", false, {}, false],
    ["isTTY undefined (file or pipe)", undefined, {}, false],
  ] as const)("%s", (_label, isTTY, env, expected) => {
    expect(shouldColor(isTTY, env)).toBe(expected);
  });
});

describe("painter (D1, D9)", () => {
  it.each([
    ["green", "\x1b[32m✓ aceito\x1b[39m"],
    ["red", "\x1b[31m✓ aceito\x1b[39m"],
    ["yellow", "\x1b[33m✓ aceito\x1b[39m"],
    ["blue", "\x1b[34m✓ aceito\x1b[39m"],
    ["dim", "\x1b[2m✓ aceito\x1b[22m"],
    ["bold", "\x1b[1m✓ aceito\x1b[22m"],
  ] as const)("color on, %s: open and close codes", (style, expected) => {
    expect(painter(true)(style, "✓ aceito")).toBe(expected);
  });

  it.each(["green", "red", "yellow", "blue", "dim", "bold"] as const)(
    "color off, %s: the text unchanged",
    (style) => {
      expect(painter(false)(style, "✓ aceito")).toBe("✓ aceito");
    },
  );
});

describe("stripAnsi and visibleWidth (D7, D9)", () => {
  it("stripAnsi removes every code of the colored title", () => {
    expect(stripAnsi(COLORED_TITLE)).toBe(
      "━━ git · cenário A · passo a passo ━━",
    );
  });

  it("stripAnsi leaves plain text unchanged", () => {
    expect(stripAnsi("[git] agente 7: pull --rebase → ok")).toBe(
      "[git] agente 7: pull --rebase → ok",
    );
  });

  it("visibleWidth of the colored title is 37, without the codes", () => {
    expect(visibleWidth(COLORED_TITLE)).toBe(37);
  });

  it("visibleWidth counts ✓ ✗ ━ · as one column each", () => {
    expect(visibleWidth("✓ ✗ ━ ·")).toBe(7);
  });
});
