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
  root = await mkdtemp(join(tmpdir(), "sprout-get-tree-"));
  db = openDatabase(":memory:");
  app = buildApp({ blobDir: join(root, "blobs"), db });
});

afterEach(async () => {
  await app.close();
  db.close();
  await rm(root, { recursive: true, force: true });
});

/** Hash of a text content, as the blob store computes it. */
function hashOf(content: string): string {
  return hashContent(Buffer.from(content));
}

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
  // 200 when another path already stored the same content.
  expect([200, 201]).toContain(res.statusCode);
  return hash;
}

/** POSTs `body` as JSON. */
function post(body: unknown) {
  return app.inject({
    method: "POST",
    url: "/changesets",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
}

/**
 * Creates a changeset on the head of main through the API. Each path maps to
 * its new content, or to null for a removal.
 */
async function commit(files: Record<string, string | null>): Promise<number> {
  const changes = [];
  for (const [path, content] of Object.entries(files)) {
    const blobHash = content === null ? null : await storeBlob(content);
    changes.push({ path, blobHash });
  }
  const res = await post({
    parent: readMainHead(db),
    author: "test",
    message: "test",
    changes,
  });
  expect(res.statusCode).toBe(201);
  return res.json<Changeset>().id;
}

function getTree(id: string | number) {
  return app.inject({ method: "GET", url: `/changesets/${id}/tree` });
}

/** The expected entries for [path, content] pairs, already in order. */
function entries(files: [string, string][]) {
  return files.map(([path, content]) => ({ path, blobHash: hashOf(content) }));
}

describe("GET /changesets/:id/tree", () => {
  it("responds 200 with the entries sorted by path", async () => {
    // a.txt is added after b.txt, so the tree's Map has b before a: only the
    // sort puts a first. c.txt is removed and must not appear.
    await commit({ "b.txt": "B", "c.txt": "C" });
    const id = await commit({ "a.txt": "A", "c.txt": null });

    const res = await getTree(id);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id,
      entries: entries([
        ["a.txt", "A"],
        ["b.txt", "B"],
      ]),
    });
  });

  it("GET /changesets/1/tree has no entries", async () => {
    const res = await getTree(1);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 1, entries: [] });
  });

  it.each<
    [
      string,
      Record<string, string | null>,
      Record<string, string | null>,
      [string, string][],
    ]
  >([
    [
      "add",
      { "a.txt": "one" },
      { "b.txt": "two" },
      [
        ["a.txt", "one"],
        ["b.txt", "two"],
      ],
    ],
    ["overwrite", { "a.txt": "one" }, { "a.txt": "two" }, [["a.txt", "two"]]],
    [
      "remove",
      { "a.txt": "one", "b.txt": "two" },
      { "a.txt": null },
      [["b.txt", "two"]],
    ],
  ])(
    "the tree applies the changes over the parent's (%s)",
    async (_case, parentFiles, childFiles, expected) => {
      await commit(parentFiles);
      const id = await commit(childFiles);

      const res = await getTree(id);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id, entries: entries(expected) });
    },
  );

  it("a removal of a path that never existed leaves the tree as it was", async () => {
    // The scenario of experiment E1: the POST accepts this removal (D3).
    const parent = await commit({ "a.txt": "A" });
    const id = await commit({ "never-existed.txt": null });

    const parentRes = await getTree(parent);
    const res = await getTree(id);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id, entries: entries([["a.txt", "A"]]) });
    expect(res.json<{ entries: unknown }>().entries).toEqual(
      parentRes.json<{ entries: unknown }>().entries,
    );
  });

  it.each<[string, number, unknown]>([
    ...["abc", "0", "-1", "1.5", "01", "1e3", "9007199254740992"].map(
      (id): [string, number, unknown] => [
        id,
        400,
        {
          statusCode: 400,
          error: "Bad Request",
          message: `invalid changeset id: ${id}`,
        },
      ],
    ),
    // The 414 comes from the router, not from the handler: maxParamLength
    // (100) is checked on the :id node shared with /changesets/:id. No
    // mutation of the route's handler can break this case.
    [
      "1".repeat(101),
      414,
      {
        error: "Bad Request",
        code: "FST_ERR_MAX_PARAM_LENGTH",
        message: `'/changesets/${"1".repeat(101)}/tree' is exceeding the max param length`,
        statusCode: 414,
      },
    ],
  ])("GET /changesets/%s/tree responds %i", async (id, status, body) => {
    const res = await getTree(id);

    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual(body);
  });

  it.each(["2", "9007199254740991"])(
    "GET /changesets/%s/tree responds 404",
    async (id) => {
      const res = await getTree(id);

      expect(res.statusCode).toBe(404);
      // The body is what tells "changeset not found" from Fastify's 404 for a
      // route that does not exist; the status alone is the same.
      expect(res.json()).toEqual({
        statusCode: 404,
        error: "Not Found",
        message: `changeset not found: ${id}`,
      });
    },
  );

  it("after 10 concurrent commits on different paths, the head's tree has the 10 files", async () => {
    // All ten send parent 1, so nine of them are reparented (ADR 0003).
    const hash = await storeBlob("shared content");
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, n) =>
        post({
          parent: 1,
          author: `agent ${n}`,
          message: `agent ${n}`,
          changes: [{ path: `f${n}.txt`, blobHash: hash }],
        }),
      ),
    );
    expect(responses.map((res) => res.statusCode)).toEqual(
      Array.from({ length: 10 }, () => 201),
    );
    const head = readMainHead(db);
    expect(head).toBe(11);

    const res = await getTree(head);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: 11,
      entries: Array.from({ length: 10 }, (_, n) => ({
        path: `f${n}.txt`,
        blobHash: hash,
      })),
    });
  });
});
