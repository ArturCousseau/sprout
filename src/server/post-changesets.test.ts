import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Changeset } from "../core/changeset.js";
import { hashContent } from "../core/hash.js";
import { buildApp } from "./app.js";
import { openDatabase, readMainHead, type Db } from "./db.js";

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

/** What a rejected request must leave untouched. */
function snapshot() {
  return {
    changesets: db.prepare("SELECT count(*) FROM changesets").pluck().get(),
    main: readMainHead(db),
  };
}

/** POSTs `body` as JSON; `undefined` sends no body and no content-type. */
function post(body: unknown) {
  if (body === undefined) {
    return app.inject({ method: "POST", url: "/changesets" });
  }
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

  it("stores and returns normalized paths", async () => {
    const res = await post({
      parent: 1,
      author: "agent-1",
      message: "dot segment",
      changes: [{ path: "src/./a.ts", blobHash: null }],
    });

    expect(res.statusCode).toBe(201);
    expect(res.json<Changeset>().changes).toEqual([
      { path: "src/a.ts", blobHash: null },
    ]);
    const stored = await app.inject({ method: "GET", url: "/changesets/2" });
    expect(stored.json<Changeset>().changes).toEqual([
      { path: "src/a.ts", blobHash: null },
    ]);
  });

  it.each(["../x", "/abs", "a\\b", ""])(
    "rejects a path normalizePath refuses (%s)",
    async (path) => {
      const before = snapshot();

      const res = await post({
        parent: 1,
        author: "agent-1",
        message: "bad path",
        changes: [{ path, blobHash: null }],
      });

      expect(res.statusCode).toBe(400);
      const body = res.json<Record<string, unknown>>();
      expect(body.statusCode).toBe(400);
      expect(body.error).toBe("Bad Request");
      expect(body.message).toContain(`invalid path "${path}"`);
      expect(snapshot()).toEqual(before);
    },
  );

  const valid = {
    parent: 1,
    author: "agent-1",
    message: "valid message",
    changes: [{ path: "a.txt", blobHash: null }],
  };
  const hash = hashContent("some content");
  const withChange = (change: unknown) => ({ ...valid, changes: [change] });
  const without = (key: keyof typeof valid) => {
    const copy: Record<string, unknown> = { ...valid };
    delete copy[key];
    return copy;
  };

  it.each<[string, unknown]>([
    ["no body", undefined],
    ["null body", null],
    ["array body", []],
    ["string body", "s"],
    ["number body", 5],
    ['parent "2" (string)', { ...valid, parent: "2" }],
    ["parent 0", { ...valid, parent: 0 }],
    ["parent 1.5", { ...valid, parent: 1.5 }],
    ["parent null", { ...valid, parent: null }],
    ["parent -1", { ...valid, parent: -1 }],
    ["parent 2**53", { ...valid, parent: 2 ** 53 }],
    ["parent missing", without("parent")],
    ["author 7", { ...valid, author: 7 }],
    ['author ""', { ...valid, author: "" }],
    ["author missing", without("author")],
    ["message 7", { ...valid, message: 7 }],
    ['message ""', { ...valid, message: "" }],
    ["message missing", without("message")],
    [
      "changes object",
      { ...valid, changes: { path: "a.txt", blobHash: null } },
    ],
    ["changes empty", { ...valid, changes: [] }],
    ["changes missing", without("changes")],
    ["item not an object", withChange("a.txt")],
    ["item without path", withChange({ blobHash: null })],
    ["item path 5", withChange({ path: 5, blobHash: null })],
    ["blobHash missing", withChange({ path: "a.txt" })],
    [
      "blobHash uppercase",
      withChange({ path: "a.txt", blobHash: hash.toUpperCase() }),
    ],
    [
      "blobHash 63 chars",
      withChange({ path: "a.txt", blobHash: hash.slice(0, 63) }),
    ],
    ["blobHash 5", withChange({ path: "a.txt", blobHash: 5 })],
  ])("rejects an invalid body with 400 (%s)", async (_case, body) => {
    const before = snapshot();

    const res = await post(body);

    expect(res.statusCode).toBe(400);
    const json = res.json<Record<string, unknown>>();
    expect(Object.keys(json).sort()).toEqual([
      "error",
      "message",
      "statusCode",
    ]);
    expect(json.statusCode).toBe(400);
    expect(json.error).toBe("Bad Request");
    expect(typeof json.message).toBe("string");
    expect(json.message).not.toBe("");
    expect(snapshot()).toEqual(before);
  });
});
