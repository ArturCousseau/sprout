import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
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

  it("PUT with a mismatched hash responds 400 and writes nothing", async () => {
    const hash = hashContent("the content the client claims");

    const res = await put(hash, Buffer.from("the content actually sent"));

    expect(res.statusCode).toBe(400);
    expect(await readdir(blobDir)).toEqual([]);
  });
});

describe("hash format", () => {
  const body = Buffer.from("some content");
  const valid = hashContent(body);

  it.each([
    ["uppercase", valid.toUpperCase()],
    ["too short", valid.slice(0, 63)],
    ["encoded ../", "..%2Fescape"],
  ])(
    "rejects malformed hashes with 400 on PUT and GET (%s)",
    async (_case, hash) => {
      // A file next to blobDir that "../escape" would reach.
      const escapePath = join(root, "escape");
      const secret = deflateSync("secret");
      await writeFile(escapePath, secret);

      const putRes = await put(hash, body);
      const getRes = await app.inject({ method: "GET", url: `/blobs/${hash}` });

      expect(putRes.statusCode).toBe(400);
      expect(getRes.statusCode).toBe(400);
      expect((await readdir(root)).sort()).toEqual(["blobs", "escape"]);
      expect(await readFile(escapePath)).toEqual(secret);
      expect(await readdir(blobDir)).toEqual([]);
    },
  );
});

describe("content type", () => {
  it.each([
    ["empty body", Buffer.alloc(0)],
    ["non-empty body", Buffer.from("some content")],
  ])(
    "PUT without content-type responds 415 and writes nothing (%s)",
    async (_case, body) => {
      const res = await app.inject({
        method: "PUT",
        url: `/blobs/${hashContent(body)}`,
        payload: body,
      });

      expect(res.statusCode).toBe(415);
      expect(await readdir(blobDir)).toEqual([]);
    },
  );
});

describe("immutability", () => {
  it("never overwrites an existing blob file", async () => {
    const body = Buffer.from("real content");
    const hash = hashContent(body);
    const sentinel = Buffer.from("SENTINEL: must survive the PUT");
    await app.ready(); // runs onReady, which creates blobDir
    await writeFile(join(blobDir, hash), sentinel);

    const res = await put(hash, body);

    expect(await readFile(join(blobDir, hash))).toEqual(sentinel);
    expect(res.statusCode).toBe(200);
  });

  it("responds 200 to a repeated PUT of the same blob", async () => {
    const body = Buffer.from("stored twice");
    const hash = hashContent(body);

    const first = await put(hash, body);
    const second = await put(hash, body);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
  });
});

describe("concurrency", () => {
  it("20 concurrent PUTs create the blob exactly once", async () => {
    const body = Buffer.from("written by twenty agents at once");
    const hash = hashContent(body);

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => put(hash, body)),
    );
    const statuses = responses.map((res) => res.statusCode);

    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 200)).toHaveLength(19);
    const getRes = await app.inject({ method: "GET", url: `/blobs/${hash}` });
    expect(getRes.rawPayload).toEqual(body);
    expect(await readdir(blobDir)).toEqual([hash]);
  });
});

describe("body limit", () => {
  it("responds 413 above bodyLimit and writes nothing", async () => {
    const limited = buildApp({ blobDir, bodyLimit: 16 });
    try {
      const over = Buffer.alloc(17, 0x61);
      const atLimit = Buffer.alloc(16, 0x62);

      const overRes = await limited.inject({
        method: "PUT",
        url: `/blobs/${hashContent(over)}`,
        headers: { "content-type": "application/octet-stream" },
        payload: over,
      });
      expect(overRes.statusCode).toBe(413);
      expect(await readdir(blobDir)).toEqual([]);

      const atLimitRes = await limited.inject({
        method: "PUT",
        url: `/blobs/${hashContent(atLimit)}`,
        headers: { "content-type": "application/octet-stream" },
        payload: atLimit,
      });
      expect(atLimitRes.statusCode).toBe(201);
    } finally {
      await limited.close();
    }
  });

  it("defaults bodyLimit to 16 MiB", async () => {
    const twoMiB = Buffer.alloc(2 * 1024 * 1024, 0x61);
    const overDefault = Buffer.alloc(16 * 1024 * 1024 + 1, 0x62);

    const twoMiBRes = await put(hashContent(twoMiB), twoMiB);
    expect(twoMiBRes.statusCode).toBe(201);

    const overRes = await put(hashContent(overDefault), overDefault);
    expect(overRes.statusCode).toBe(413);
    expect(await readdir(blobDir)).toEqual([hashContent(twoMiB)]);
  });
});

describe("empty blob", () => {
  it("accepts the empty blob", async () => {
    const hash =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    const putRes = await put(hash, Buffer.alloc(0));
    const getRes = await app.inject({ method: "GET", url: `/blobs/${hash}` });

    expect(putRes.statusCode).toBe(201);
    expect(getRes.statusCode).toBe(200);
    expect(getRes.rawPayload).toEqual(Buffer.alloc(0));
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
