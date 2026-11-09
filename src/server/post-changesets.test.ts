import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Changeset } from "../core/changeset.js";
import { hashContent } from "../core/hash.js";
import { buildApp } from "./app.js";
import { openDatabase, type Db } from "./db.js";

let root: string;
let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sprout-post-changesets-"));
  db = openDatabase(":memory:");
  app = buildApp({ blobDir: join(root, "blobs"), db });
});

afterEach(async () => {
  await app.close();
  db.close();
  await rm(root, { recursive: true, force: true });
});

const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

/** Stores a blob through the API and returns its hash. */
async function storeBlob(content: string): Promise<string> {
  const body = Buffer.from(content);
  const hash = hashContent(body);
  const res = await app.inject({
    method: "PUT",
    url: `/blobs/${hash}`,
    headers: { "content-type": "application/octet-stream" },
    payload: body,
  });
  expect(res.statusCode).toBe(201);
  return hash;
}

function post(body: unknown) {
  return app.inject({
    method: "POST",
    url: "/changesets",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
}

describe("POST /changesets", () => {
  it("creates a changeset when parent is the head of main", async () => {
    const hash = await storeBlob("new content of b.txt");

    const res = await post({
      parent: 1,
      author: "agent-1",
      message: "first change",
      changes: [
        { path: "b.txt", blobHash: hash },
        { path: "a.txt", blobHash: null },
      ],
    });

    expect(res.statusCode).toBe(201);
    const created = res.json<Changeset>();
    const { timestamp, ...rest } = created;
    expect(rest).toEqual({
      id: 2,
      parent: 1,
      author: "agent-1",
      message: "first change",
      changes: [
        { path: "a.txt", blobHash: null },
        { path: "b.txt", blobHash: hash },
      ],
    });
    expect(timestamp).toMatch(ISO_UTC);

    const head = await app.inject({ method: "GET", url: "/refs/main" });
    expect(head.json()).toEqual({ id: 2 });
    const stored = await app.inject({ method: "GET", url: "/changesets/2" });
    expect(stored.statusCode).toBe(200);
    expect(stored.json()).toEqual(created);
  });
});
