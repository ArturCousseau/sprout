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
    changes: db.prepare("SELECT count(*) FROM changes").pluck().get(),
    main: readMainHead(db),
  };
}

let contentCounter = 0;

/**
 * Creates a changeset on the head of main through the API, as another agent
 * would, so the history stays one line. "change" stores new content for the
 * path; "remove" sends `blobHash: null`.
 */
async function commitOnHead(
  files: Record<string, "change" | "remove">,
): Promise<Changeset> {
  const changes = [];
  for (const [path, kind] of Object.entries(files)) {
    contentCounter += 1;
    const blobHash =
      kind === "remove" ? null : await storeBlob(`content ${contentCounter}`);
    changes.push({ path, blobHash });
  }
  const res = await post({
    parent: readMainHead(db),
    author: "other-agent",
    message: "on the head",
    changes,
  });
  expect(res.statusCode).toBe(201);
  return res.json<Changeset>();
}

/** The body of a 409 for these conflicting paths. */
function conflictBody(conflicts: string[]) {
  return {
    statusCode: 409,
    error: "Conflict",
    message: "paths changed since parent",
    conflicts,
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

  it.each<[string, unknown]>([
    ["id", { ...valid, id: 99 }],
    ["timestamp", { ...valid, timestamp: "2026-11-09T00:00:00.000Z" }],
    ["unknown top-level field", { ...valid, foo: "bar" }],
    // "constructor" in {} is true through the prototype.
    ["constructor at the top level", { ...valid, constructor: "x" }],
    [
      "unknown field in an item",
      withChange({ path: "a.txt", blobHash: null, mode: "100644" }),
    ],
  ])("rejects server-assigned and unknown fields (%s)", async (_case, body) => {
    const before = snapshot();

    const res = await post(body);

    expect(res.statusCode).toBe(400);
    const json = res.json<Record<string, unknown>>();
    expect(json.statusCode).toBe(400);
    expect(json.error).toBe("Bad Request");
    expect(snapshot()).toEqual(before);
  });

  it.each([
    ["a.txt", "a.txt"],
    ["a.txt", "./a.txt"],
  ])("rejects a repeated path (%s and %s)", async (first, second) => {
    const before = snapshot();

    const res = await post({
      ...valid,
      changes: [
        { path: first, blobHash: null },
        { path: second, blobHash: null },
      ],
    });

    expect(res.statusCode).toBe(400);
    const json = res.json<Record<string, unknown>>();
    expect(json.statusCode).toBe(400);
    expect(json.error).toBe("Bad Request");
    expect(json.message).toContain("a.txt");
    expect(snapshot()).toEqual(before);
  });

  it("lists every missing blob", async () => {
    const present = await storeBlob("stored content");
    const missingA = hashContent("never stored A");
    const missingB = hashContent("never stored B");
    const before = snapshot();

    const res = await post({
      ...valid,
      changes: [
        { path: "present.txt", blobHash: present },
        { path: "a1.txt", blobHash: missingA },
        { path: "b.txt", blobHash: missingB },
        // Same missing blob on a second path: listed once.
        { path: "a2.txt", blobHash: missingA },
      ],
    });

    expect(res.statusCode).toBe(400);
    const json = res.json<{
      statusCode: number;
      error: string;
      message: string;
    }>();
    expect(json.statusCode).toBe(400);
    expect(json.error).toBe("Bad Request");
    expect(json.message).toContain(missingB);
    expect(json.message.split(missingA)).toHaveLength(2);
    expect(json.message).not.toContain(present);
    expect(snapshot()).toEqual(before);
  });

  it.each([
    ["99", 99],
    // The next id on a database with only the root: without the check, the
    // foreign key accepts a changeset that is its own parent.
    ["2, the next id", 2],
  ])("responds 404 when parent does not exist (%s)", async (_case, parent) => {
    const before = snapshot();

    const res = await post({ ...valid, parent });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      statusCode: 404,
      error: "Not Found",
      message: `changeset not found: ${parent}`,
    });
    expect(snapshot()).toEqual(before);
  });

  it("reparents onto the head when no path conflicts", async () => {
    // Another agent's changeset 2 changed a.txt; this request changes b.txt.
    await commitOnHead({ "a.txt": "change" });
    const hash = await storeBlob("new content of b.txt");

    const res = await post({
      ...valid,
      parent: 1,
      changes: [{ path: "b.txt", blobHash: hash }],
    });

    expect(res.statusCode).toBe(201);
    const created = res.json<Changeset>();
    expect(created.id).toBe(3);
    expect(created.parent).toBe(2);
    expect(created.changes).toEqual([{ path: "b.txt", blobHash: hash }]);
    expect(readMainHead(db)).toBe(3);
    const stored = await app.inject({ method: "GET", url: "/changesets/3" });
    expect(stored.statusCode).toBe(200);
    expect(stored.json()).toEqual(created);
  });

  it("reparents straight to the head in one jump", async () => {
    await commitOnHead({ "a.txt": "change" });
    await commitOnHead({ "c.txt": "change" });
    await commitOnHead({ "d.txt": "change" });
    const hash = await storeBlob("new content of b.txt");

    const res = await post({
      ...valid,
      parent: 1,
      changes: [{ path: "b.txt", blobHash: hash }],
    });

    expect(res.statusCode).toBe(201);
    const created = res.json<Changeset>();
    // One swap, straight to 4: no changeset on top of 2 or 3 is created.
    expect(created.id).toBe(5);
    expect(created.parent).toBe(4);
    expect(snapshot()).toEqual({ changesets: 5, changes: 4, main: 5 });
  });

  it("limit: a change in the parent itself does not conflict", async () => {
    await commitOnHead({ "a.txt": "change" });
    await commitOnHead({ "b.txt": "change" });
    await commitOnHead({ "c.txt": "change" });

    // Parent 3 is in the middle of the history and changed b.txt itself.
    const res = await post({
      ...valid,
      parent: 3,
      changes: [{ path: "b.txt", blobHash: null }],
    });

    expect(res.statusCode).toBe(201);
    const created = res.json<Changeset>();
    expect(created.id).toBe(5);
    expect(created.parent).toBe(4);
    expect(readMainHead(db)).toBe(5);
  });

  it("responds 409 with the conflicting paths", async () => {
    await commitOnHead({ "c.txt": "change", "a.txt": "change" });
    const hash = await storeBlob("request content");
    const before = snapshot();

    const res = await post({
      ...valid,
      parent: 1,
      changes: [
        { path: "./c.txt", blobHash: hash },
        { path: "z.txt", blobHash: hash },
        { path: "a.txt", blobHash: null },
      ],
    });

    expect(res.statusCode).toBe(409);
    // Unique, sorted and normalized ("./c.txt" is "c.txt"); z.txt was not
    // changed after the parent.
    expect(res.json()).toEqual(conflictBody(["a.txt", "c.txt"]));
    expect(snapshot()).toEqual(before);
  });

  it.each<[string, "change" | "remove", "change" | "remove"]>([
    ["removed by the request", "change", "remove"],
    ["removed after the parent", "remove", "change"],
  ])(
    "a removal conflicts with a change on the other side (%s)",
    async (_case, onHead, inRequest) => {
      await commitOnHead({ "a.txt": onHead });
      const blobHash =
        inRequest === "remove" ? null : await storeBlob("request content");
      const before = snapshot();

      const res = await post({
        ...valid,
        parent: 1,
        changes: [{ path: "a.txt", blobHash }],
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual(conflictBody(["a.txt"]));
      expect(snapshot()).toEqual(before);
    },
  );

  it("limit: a change in the head conflicts", async () => {
    await commitOnHead({ "a.txt": "change" });
    await commitOnHead({ "b.txt": "change" });
    await commitOnHead({ "c.txt": "change" });
    const before = snapshot();

    // Parent 3 is in the middle of the history; c.txt changed in 4, the head.
    const res = await post({
      ...valid,
      parent: 3,
      changes: [{ path: "c.txt", blobHash: null }],
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(conflictBody(["c.txt"]));
    expect(snapshot()).toEqual(before);
  });

  it("lists a path changed by several changesets once", async () => {
    await commitOnHead({ "a.txt": "change" });
    await commitOnHead({ "a.txt": "change" });
    await commitOnHead({ "b.txt": "change" });
    const before = snapshot();

    const res = await post({
      ...valid,
      parent: 1,
      changes: [{ path: "a.txt", blobHash: null }],
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(conflictBody(["a.txt"]));
    expect(snapshot()).toEqual(before);
  });

  it("lists conflicts in ascending order across changesets", async () => {
    // z.txt changed before a.txt, and the request lists z.txt first: only
    // sorting puts a.txt first.
    await commitOnHead({ "z.txt": "change" });
    await commitOnHead({ "a.txt": "change" });
    const before = snapshot();

    const res = await post({
      ...valid,
      parent: 1,
      changes: [
        { path: "z.txt", blobHash: null },
        { path: "a.txt", blobHash: null },
      ],
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(conflictBody(["a.txt", "z.txt"]));
    expect(snapshot()).toEqual(before);
  });

  it("10 concurrent POSTs on the same path: one 201, nine 409", async () => {
    const hash = await storeBlob("shared content");

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, n) =>
        post({
          ...valid,
          message: `agent ${n}`,
          changes: [{ path: "same.txt", blobHash: hash }],
        }),
      ),
    );

    const statuses = responses.map((res) => res.statusCode).sort();
    expect(statuses).toEqual([
      201, 409, 409, 409, 409, 409, 409, 409, 409, 409,
    ]);
    const rejected = responses
      .filter((res) => res.statusCode === 409)
      .map((res) => res.json<unknown>());
    expect(rejected).toEqual(
      Array.from({ length: 9 }, () => conflictBody(["same.txt"])),
    );
    expect(readMainHead(db)).toBe(2);
    expect(snapshot()).toEqual({ changesets: 2, changes: 1, main: 2 });
  });

  it("10 concurrent POSTs on different paths form one chain", async () => {
    // A non-null blobHash, so every request really awaits hasBlob before
    // reading the head.
    const hash = await storeBlob("shared content");

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, n) =>
        post({
          ...valid,
          message: `agent ${n}`,
          changes: [{ path: `f${n}.txt`, blobHash: hash }],
        }),
      ),
    );

    const statuses = responses.map((res) => res.statusCode);
    expect(statuses).toEqual(Array.from({ length: 10 }, () => 201));
    const created = responses
      .map((res) => res.json<Changeset>())
      .sort((a, b) => a.id - b.id);
    // One chain: ids 2..11, each one's parent is the changeset before it.
    expect(created.map((changeset) => changeset.id)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(created.map((changeset) => changeset.parent)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    // All sent parent 1; only the first one kept it.
    expect(created.filter((changeset) => changeset.parent !== 1)).toHaveLength(
      9,
    );
    expect(snapshot()).toEqual({ changesets: 11, changes: 10, main: 11 });
  });

  it("responds 415 to a body sent as application/octet-stream", async () => {
    // The octet-stream parser registered for PUT /blobs applies to every
    // route, so without a check this body reaches the handler as a Buffer.
    const before = snapshot();

    const res = await app.inject({
      method: "POST",
      url: "/changesets",
      headers: { "content-type": "application/octet-stream" },
      payload: JSON.stringify(valid),
    });

    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({
      statusCode: 415,
      error: "Unsupported Media Type",
      message: "content-type must be application/json",
    });
    expect(snapshot()).toEqual(before);
  });

  it("precedence: a missing parent answers 404 before missing blobs", async () => {
    const before = snapshot();

    const res = await post({
      ...valid,
      parent: 99,
      changes: [{ path: "a.txt", blobHash: hashContent("never stored") }],
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      statusCode: 404,
      error: "Not Found",
      message: "changeset not found: 99",
    });
    expect(snapshot()).toEqual(before);
  });

  it("precedence: missing blobs answer 400 before a stale parent's 409", async () => {
    // Another agent's changeset 2 changed a.txt, the path of the request, so
    // without the missing blob the answer would be a 409, not a reparent.
    await commitOnHead({ "a.txt": "change" });
    const missing = hashContent("never stored");
    const before = snapshot();

    const res = await post({
      ...valid,
      parent: 1,
      changes: [{ path: "a.txt", blobHash: missing }],
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      statusCode: 400,
      error: "Bad Request",
      message: `missing blobs: ${missing}`,
    });
    expect(snapshot()).toEqual(before);
  });
});
