import { once } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { HarnessError } from "./harness-error.js";
import { createLinePause } from "./pause.js";

// Written by hand: the message of a pause that can never end (E4, D7).
const CLOSED = "stdin closed during a pause (Enter expected)";

/** The value of `promise` if it is already settled, or "pending" (no wait). */
function settledValue<T>(promise: Promise<T>): Promise<T | "pending"> {
  return Promise.race([promise, Promise.resolve("pending" as const)]);
}

/** Lets pending stream events and callbacks run. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// The input is always a PassThrough: no test reads the real stdin (D8).
describe("createLinePause (#17, D4, D7)", () => {
  it("a line written before the pause → the pause resolves", async () => {
    const input = new PassThrough();
    const lines = createLinePause(input);

    input.write("\n");

    await expect(lines.pause()).resolves.toBeUndefined();
    lines.close();
  });

  it("a pending pause resolves on the next line, not before", async () => {
    const input = new PassThrough();
    const lines = createLinePause(input);

    const waiting = lines.pause();
    await tick();
    expect(await settledValue(waiting)).toBe("pending");

    input.write("\n");

    await expect(waiting).resolves.toBeUndefined();
    lines.close();
  });

  it("input ends during a pause → HarnessError (E4)", async () => {
    const input = new PassThrough();
    const lines = createLinePause(input);

    const waiting = lines.pause();
    input.end();

    await expect(waiting).rejects.toBeInstanceOf(HarnessError);
    await expect(waiting).rejects.toThrow(CLOSED);
  });

  it("pause after the input ended, no line left → HarnessError", async () => {
    const input = new PassThrough();
    const lines = createLinePause(input);

    // A stream only emits "end" once it is read to the end; resume() reads it
    // even when nothing else does. No data was written, so no line is lost.
    input.resume();
    input.end();
    await once(input, "end");

    const waiting = lines.pause();

    await expect(waiting).rejects.toBeInstanceOf(HarnessError);
    await expect(waiting).rejects.toThrow(CLOSED);
  });

  it("two lines at once count as two pauses (P1)", async () => {
    const input = new PassThrough();
    const lines = createLinePause(input);

    input.write("\n\n");

    await expect(lines.pause()).resolves.toBeUndefined();
    await expect(lines.pause()).resolves.toBeUndefined();
    lines.close();
  });
});
