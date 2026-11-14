import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { HarnessError } from "./harness-error.js";

/** Default wait for the "listening" line (R3, Fase 1: 732 ms at worst). */
export const READY_TIMEOUT_MS = 10_000;

/** Default wait for the server to exit after SIGTERM (P2). */
export const STOP_TIMEOUT_MS = 5_000;

const repoRoot = resolve(import.meta.dirname, "..");

// Printed by src/server/main.ts once it listens; with PORT=0 it carries the
// port the system picked.
const LISTENING_LINE = /^sprout server listening on (http:\/\/\S+)$/;

/** The program the server process runs: `file` with `args`. */
export interface SproutServerCommand {
  file: string;
  args: string[];
}

/**
 * Default command (D2, R1): one process, Node itself with tsx loaded through
 * `--import`. Node resolves the `tsx` specifier from the current directory,
 * so the process starts in the repo root.
 */
const DEFAULT_COMMAND: SproutServerCommand = {
  file: process.execPath,
  args: ["--import", "tsx", join(repoRoot, "src", "server", "main.ts")],
};

export interface StartSproutServerOptions {
  dataDir: string;
  command?: SproutServerCommand;
  /** Added to the environment last, so it can override PORT (tests). */
  env?: NodeJS.ProcessEnv;
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
}

/** How the server process ended (the arguments of the `close` event). */
export interface ServerExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface SproutServer {
  /** Base address read from the "listening" line, without a trailing slash. */
  url: string;
  pid: number;
  /** Resolves when the process has exited and its pipes are closed. */
  exited: Promise<ServerExit>;
  /**
   * SIGTERM, then SIGKILL if the process is still alive after stopTimeoutMs
   * (R5). Rejects with a HarnessError when the server had already exited
   * (R4) or needed the SIGKILL; in both cases the process is gone by then.
   */
  stop(): Promise<void>;
}

/**
 * Starts the Sprout server as a child process with PORT=0 and SPROUT_DATA_DIR
 * = `dataDir` (D2), and resolves once it printed its "listening" line (R2).
 * Any failure before that line is a HarnessError (D3), and the promise only
 * rejects after the process is gone.
 */
export function startSproutServer(
  options: StartSproutServerOptions,
): Promise<SproutServer> {
  const {
    dataDir,
    command = DEFAULT_COMMAND,
    env = {},
    readyTimeoutMs = READY_TIMEOUT_MS,
    stopTimeoutMs = STOP_TIMEOUT_MS,
  } = options;

  const child = spawn(command.file, command.args, {
    cwd: repoRoot,
    env: { ...process.env, SPROUT_DATA_DIR: dataDir, PORT: "0", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // stderr is kept only for error messages. Both pipes are read until the
  // end: a pipe nobody reads fills up, and the server would block on write.
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => (stderr += chunk));

  const exited = new Promise<ServerExit>((resolveExit) => {
    child.on("close", (code, signal) => resolveExit({ code, signal }));
  });

  function hasExited(): boolean {
    return child.exitCode !== null || child.signalCode !== null;
  }

  async function stop(): Promise<void> {
    if (hasExited()) {
      const { code, signal } = await exited;
      throw new HarnessError(
        `sprout server exited during the run (code ${code}, signal ${signal})`,
      );
    }
    child.kill("SIGTERM");
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout("timeout"), stopTimeoutMs);
    });
    const first = await Promise.race([exited, timeout]);
    clearTimeout(timer);
    if (first === "timeout") {
      child.kill("SIGKILL");
      await exited;
      throw new HarnessError(
        `sprout server did not stop after ${stopTimeoutMs} ms; killed`,
      );
    }
  }

  return new Promise((resolveStart, rejectStart) => {
    let settled = false;
    let timedOut = false;
    const readyTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL"); // the rejection comes with the close event
    }, readyTimeoutMs);

    function settle(action: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimer);
      action();
    }

    // After the "listening" line the lines keep being read and dropped (R2).
    // A line read after the ready timeout is dropped too: the SIGKILL was
    // already sent, and the close event rejects.
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const match = LISTENING_LINE.exec(line);
      if (timedOut || match === null || child.pid === undefined) return;
      const url = match[1];
      const pid = child.pid;
      settle(() => resolveStart({ url, pid, exited, stop }));
    });

    // Rejects without waiting for the close event: this is the spawn failure
    // (no process was created), so nothing can be left behind.
    child.on("error", (error) => {
      settle(() =>
        rejectStart(
          new HarnessError("cannot start the sprout server", { cause: error }),
        ),
      );
    });

    // Every rejection after a spawn waits for this event, so no process is
    // left behind when startSproutServer rejects (NV8).
    child.on("close", (code, signal) => {
      const detail = `stderr: ${stderr.trim()}`;
      settle(() =>
        rejectStart(
          new HarnessError(
            timedOut
              ? `sprout server not ready after ${readyTimeoutMs} ms; ${detail}`
              : `sprout server exited before it was ready (code ${code}, signal ${signal}); ${detail}`,
          ),
        ),
      );
    });
  });
}
