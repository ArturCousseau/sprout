/**
 * The colors of the demo's output (#20, D1), written by hand: no dependency.
 * Each style is an ANSI SGR pair, an open code and the code that turns only
 * that kind of style off: 39 is the default text color, 22 the normal
 * intensity (it ends both bold and dim).
 */
export type Style = "green" | "red" | "yellow" | "blue" | "dim" | "bold";

const CODES: Record<Style, readonly [open: string, close: string]> = {
  green: ["\x1b[32m", "\x1b[39m"],
  red: ["\x1b[31m", "\x1b[39m"],
  yellow: ["\x1b[33m", "\x1b[39m"],
  blue: ["\x1b[34m", "\x1b[39m"],
  dim: ["\x1b[2m", "\x1b[22m"],
  bold: ["\x1b[1m", "\x1b[22m"],
};

/**
 * Wraps `text` in one style. `text` is always plain (no codes inside): the
 * styled pieces sit side by side and never nest, so a 22 that ends a dim
 * piece never turns off a bold one around it.
 */
export type Paint = (style: Style, text: string) => string;

/** The Paint of a run: with `color` false, the text comes back unchanged. */
export function painter(color: boolean): Paint {
  if (!color) {
    return (_style, text) => text;
  }
  return (style, text) => {
    const [open, close] = CODES[style];
    return `${open}${text}${close}`;
  };
}

/** `text` without its SGR codes (`ESC [ … m`). */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- ESC is what this matches
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Columns `text` takes in the terminal. Every character the demo prints is
 * one column and one UTF-16 unit (NFC, no surrogate pairs), so the length
 * without the codes is the width (D7).
 */
export function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

/**
 * Whether the output gets colors (D2): only when it goes to a terminal and
 * NO_COLOR is absent or empty. Per no-color.org, an empty NO_COLOR does not
 * turn the colors off (R10).
 */
export function shouldColor(
  isTTY: boolean | undefined,
  env: { NO_COLOR?: string },
): boolean {
  return isTTY === true && (env.NO_COLOR === undefined || env.NO_COLOR === "");
}
