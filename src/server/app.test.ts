import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashContent } from "../core/hash.js";
import { buildApp } from "./app.js";

let root: string;
let blobDir: string;
let app: FastifyInstance;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sprout-blobs-"));
  blobDir = join(root, "blobs");
  app = buildApp({ blobDir });
});

afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

function put(hash: string, body: Buffer) {
  return app.inject({
    method: "PUT",
    url: `/blobs/${hash}`,
    headers: { "content-type": "application/octet-stream" },
    payload: body,
  });
}

describe("PUT /blobs/:hash", () => {
  it("PUT stores a blob whose hash matches the body", async () => {
    const body = Buffer.from("hello sprout");
    const hash = hashContent(body);

    const res = await put(hash, body);

    expect(res.statusCode).toBe(201);
    expect(app.server.listening).toBe(false);
    expect(await readdir(blobDir)).toEqual([hash]);
  });
});

describe("GET /blobs/:hash", () => {
  it("GET returns the exact bytes for all 256 byte values", async () => {
    const body = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const hash = hashContent(body);
    await put(hash, body);

    const res = await app.inject({ method: "GET", url: `/blobs/${hash}` });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.rawPayload).toEqual(body);
  });

  it("GET of a missing blob responds 404", async () => {
    const hash = hashContent("never stored");

    const res = await app.inject({ method: "GET", url: `/blobs/${hash}` });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      statusCode: 404,
      error: "Not Found",
      message: `blob not found: ${hash}`,
    });
  });
});

describe("blob file on disk", () => {
  it("stores the blob zlib-compressed under the hash of the original", async () => {
    const body = Buffer.alloc(10 * 1024, 0x61);
    const hash = hashContent(body);

    await put(hash, body);

    expect(await readdir(blobDir)).toEqual([hash]);
    const file = await readFile(join(blobDir, hash));
    expect(file.length).toBeLessThan(body.length);
    expect(inflateSync(file)).toEqual(body);
  });
});
