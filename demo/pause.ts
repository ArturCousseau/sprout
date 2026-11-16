import { createInterface } from "node:readline";
import { HarnessError } from "./harness-error.js";

/** The wait for Enter of the step-by-step mode (#17, D4). */
export interface LinePause {
  /**
   * Resolves on the next line of the input (one Enter). A line that arrived
   * while no pause was waiting is kept and ends the next pause at once (P1).
   * Rejects with a HarnessError once the input closed and no line is left.
   */
  pause(): Promise<void>;
  /** Stops reading the input. */
  close(): void;
}

/**
 * Reads Enter presses from `input` (`process.stdin` in the demo). Ctrl+C is
 * left to the terminal: there is no SIGINT handler (D7, option 1).
 */
export function createLinePause(input: NodeJS.ReadableStream): LinePause {
  // terminal: false on purpose (E3 in the Phase 1 of #17). With the default
  // (true when the output is a TTY), readline puts a real terminal in raw
  // mode: Ctrl+C becomes a key press instead of a SIGINT, and the demo hangs
  // with the Sprout server alive. With false the terminal stays in its normal
  // mode, and Ctrl+C sends SIGINT to the whole process group. No vitest test
  // can see this (stdin is never a TTY there); the manual Ctrl+C check does.
  const lines = createInterface({ input, terminal: false });

  let waiting: { resolve(): void; reject(error: Error): void } | undefined;
  let unread = 0;
  let closed = false;
  const closedError = (): HarnessError =>
    new HarnessError("stdin closed during a pause (Enter expected)");

  lines.on("line", () => {
    if (waiting === undefined) {
      unread += 1;
      return;
    }
    const current = waiting;
    waiting = undefined;
    current.resolve();
  });

  // Without this, an input that ends during a pause would leave it pending
  // forever, and the run would hang holding the server's port (E4).
  lines.on("close", () => {
    closed = true;
    const current = waiting;
    waiting = undefined;
    current?.reject(closedError());
  });

  return {
    pause() {
      if (unread > 0) {
        unread -= 1;
        return Promise.resolve();
      }
      if (closed) {
        return Promise.reject(closedError());
      }
      return new Promise((resolve, reject) => {
        waiting = { resolve, reject };
      });
    },
    close() {
      lines.close();
    },
  };
}
