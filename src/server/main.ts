/**
 * Server entry point (`pnpm start`).
 *
 *   SPROUT_DATA_DIR  required; created if missing. Blobs are stored in
 *                    `<SPROUT_DATA_DIR>/blobs` and metadata (changesets and
 *                    the main ref) in the SQLite file `<SPROUT_DATA_DIR>/sprout.db`
 *   PORT             optional, integer from 1 to 65535, default 3000
 *
 * Listens on 127.0.0.1 only: the server has no authentication, and the demo
 * runs every agent on the same machine.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildApp } from "./app.js";
import { openDatabase } from "./db.js";
import { parsePort } from "./port.js";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;

function fail(message: string): never {
  console.error(`sprout: ${message}`);
  process.exit(1);
}

const dataDir = process.env.SPROUT_DATA_DIR;
if (!dataDir) {
  fail(
    "SPROUT_DATA_DIR is not set (it holds the blobs and the sprout.db database)",
  );
}

const portText = process.env.PORT ?? String(DEFAULT_PORT);
const port = parsePort(portText);
if (port === null) {
  fail(`PORT must be an integer from 1 to 65535, got "${portText}"`);
}

await mkdir(dataDir, { recursive: true });
const db = openDatabase(join(dataDir, "sprout.db"));
const app = buildApp({ blobDir: join(dataDir, "blobs"), db });
// main.ts opened the database, so main.ts closes it.
app.addHook("onClose", () => {
  db.close();
});
const address = await app.listen({ host: HOST, port });
console.log(`sprout server listening on ${address}`);
