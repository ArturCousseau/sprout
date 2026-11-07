/**
 * Server entry point (`pnpm start`).
 *
 *   SPROUT_DATA_DIR  required; blobs are stored in `<SPROUT_DATA_DIR>/blobs`
 *   PORT             optional, integer from 1 to 65535, default 3000
 *
 * Listens on 127.0.0.1 only: the server has no authentication, and the demo
 * runs every agent on the same machine.
 */
import { join } from "node:path";
import { buildApp } from "./app.js";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;

function fail(message: string): never {
  console.error(`sprout: ${message}`);
  process.exit(1);
}

const dataDir = process.env.SPROUT_DATA_DIR;
if (!dataDir) {
  fail("SPROUT_DATA_DIR is not set (blobs go to <SPROUT_DATA_DIR>/blobs)");
}

const portText = process.env.PORT ?? String(DEFAULT_PORT);
const port = Number(portText);
if (!/^\d+$/.test(portText) || port < 1 || port > 65535) {
  fail(`PORT must be an integer from 1 to 65535, got "${portText}"`);
}

const app = buildApp({ blobDir: join(dataDir, "blobs") });
const address = await app.listen({ host: HOST, port });
console.log(`sprout server listening on ${address}`);
