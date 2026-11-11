/**
 * HTTP API of the server: blobs, the main ref and changesets. The database
 * connection comes from the caller (`db` option), which also closes it.
 * Status codes:
 *
 * PUT /blobs/:hash — body is the raw blob; the request must send
 * `content-type: application/octet-stream`.
 *   201  blob created (no body)
 *   200  blob already existed; the stored file is left untouched (no body)
 *   400  :hash is not 64 lowercase hex chars, or the body does not hash to :hash
 *   413  body larger than `bodyLimit` (option of buildApp, default
 *        DEFAULT_BODY_LIMIT = 16 MiB; Fastify's own default would be 1 MiB).
 *        Fastify answers this itself, before the handler runs.
 *   415  no `content-type: application/octet-stream`. Fastify answers this
 *        itself when there is a body; with an empty body and no content-type
 *        it skips the parser and hands us `body === undefined`, so the
 *        handler checks for a Buffer and answers 415 before looking at :hash.
 *
 * GET /blobs/:hash
 *   200  raw blob, `content-type: application/octet-stream`
 *   400  :hash is not 64 lowercase hex chars
 *   404  no blob with this hash
 *
 * GET /refs/main
 *   200  `{ id }`, the id of the changeset main points at
 *
 * GET /changesets/:id
 *   200  the changeset in the core `Changeset` shape, changes sorted by path
 *   400  :id is not a positive decimal integer without a leading zero, or is
 *        above Number.MAX_SAFE_INTEGER
 *   404  no changeset with this id
 *   414  :id longer than Fastify's maxParamLength (100 chars). Fastify answers
 *        this itself, before the handler runs.
 *
 * POST /changesets — body is JSON `{ parent, author, message, changes }`,
 * with `changes: [{ path, blobHash }]` (`blobHash: null` = file removed).
 *   201  changeset created and main moved to it; body is the core
 *        `Changeset`, the same as GET /changesets/:id returns. Its parent is
 *        always the head of main: when `parent` is stale and no path of the
 *        request was changed after it, the server reparents the changeset
 *        onto the head, in one jump (ADR 0003). The client sees the reparent
 *        by comparing the `parent` of the answer with the one it sent.
 *   400  invalid body: not a JSON object, a missing or wrongly typed field,
 *        `id` or `timestamp` sent (the server assigns them), an unknown
 *        field, a path normalizePath refuses, or the same path twice after
 *        normalization
 *   404  `parent` does not exist
 *   400  some non-null blobHash is not in the blob store; the message lists
 *        the missing hashes
 *   409  some path of the request was changed by a changeset after `parent`,
 *        up to the head of main (inclusive). Body:
 *        `{ statusCode, error, message: "paths changed since parent",
 *        conflicts }`, with `conflicts` = those paths, normalized, unique and
 *        sorted.
 *   415  body sent as `application/octet-stream`. The parser registered for
 *        PUT /blobs applies to every route, so it reaches the handler as a
 *        Buffer; the handler answers "content-type must be application/json".
 *   500  "main moved during the request": the compare-and-swap found main
 *        changed. Unreachable while reading the head and the compare-and-swap
 *        run in one synchronous stretch (ADR 0004, decision 5), so it means a
 *        server bug.
 *   Precedence: the first failing check answers, in this order: 415
 *   octet-stream → 400 invalid body → 404 parent → 400 missing blobs → 409
 *   conflicts.
 *   Nothing is written unless the answer is 201.
 *   Answered by Fastify itself, before the handler runs (body with Fastify's
 *   extra `code` field):
 *   400  `content-type: application/json` with an empty or invalid JSON body
 *   413  body larger than `bodyLimit` (same limit as PUT /blobs)
 *   415  a body with no content-type, or with a content-type that has no
 *        parser (e.g. application/xml). `text/plain` has a parser, so it
 *        reaches the handler as a string and gets the 400 above;
 *        `application/octet-stream` gets the handler's own 415 above.
 *
 * Errors use Fastify's own error shape: `{ statusCode, error, message }`; the
 * 409 of POST /changesets adds `conflicts`.
 *
 * A literal `../` in the URL (`/blobs/../x`) never reaches these handlers: the
 * router resolves the path first (`/x`) and answers 404 by itself. An encoded
 * `..%2F` does reach them as part of :hash and is rejected by the hash format.
 */
import { mkdir } from "node:fs/promises";
import { STATUS_CODES } from "node:http";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { Change } from "../core/changeset.js";
import { InvalidPathError, normalizePath } from "../core/path.js";
import { treeEntries } from "../core/tree.js";
import { getBlob, HASH_FORMAT, hasBlob, putBlob } from "./blob-store.js";
import {
  createChangeset,
  readChangedPaths,
  readChangeset,
  readMainHead,
  type Db,
  type NewChangeset,
} from "./db.js";
import { createTreeReader } from "./tree.js";

export interface AppOptions {
  blobDir: string;
  db: Db;
  bodyLimit?: number;
}

function sendError(reply: FastifyReply, statusCode: number, message: string) {
  return reply
    .code(statusCode)
    .send({ statusCode, error: STATUS_CODES[statusCode], message });
}

/** 409 in Fastify's error shape, plus the paths in conflict. */
function sendConflict(reply: FastifyReply, conflicts: string[]) {
  return reply.code(409).send({
    statusCode: 409,
    error: STATUS_CODES[409],
    message: "paths changed since parent",
    conflicts,
  });
}

export const DEFAULT_BODY_LIMIT = 16 * 1024 * 1024;

/** Positive decimal integer, no leading zero. */
const CHANGESET_ID_FORMAT = /^[1-9][0-9]*$/;

/**
 * The `:id` of a changeset route as a number, or undefined when it is not a
 * positive decimal integer without a leading zero, or is above
 * Number.MAX_SAFE_INTEGER.
 */
function parseChangesetId(id: string): number | undefined {
  const numericId = Number(id);
  if (!CHANGESET_ID_FORMAT.test(id) || !Number.isSafeInteger(numericId)) {
    return undefined;
  }
  return numericId;
}

/**
 * A valid body: the parent the client started from and the changeset to
 * create. The parent stays out of the changeset, because createChangeset
 * uses the head of main as the parent.
 */
interface ChangesetRequest {
  parent: number;
  changeset: NewChangeset;
}

type ParseResult =
  { ok: true; value: ChangesetRequest } | { ok: false; message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isBlobHash(value: unknown): value is string | null {
  return (
    value === null || (typeof value === "string" && HASH_FORMAT.test(value))
  );
}

// A Set, not an object with `in`: "constructor" in {} is true through the
// prototype.
const BODY_FIELDS = new Set(["parent", "author", "message", "changes"]);
const CHANGE_FIELDS = new Set(["path", "blobHash"]);
/** Fields the server assigns (principle 3); the client may not send them. */
const SERVER_FIELDS = new Set(["id", "timestamp"]);

/**
 * Checks a POST /changesets body by hand (no Fastify schema: its default Ajv
 * options coerce "2" to 2 and silently drop unknown fields) and normalizes
 * the paths.
 */
function parseChangesetBody(body: unknown): ParseResult {
  const fail = (message: string): ParseResult => ({ ok: false, message });
  if (!isObject(body)) {
    return fail("body must be a JSON object");
  }
  for (const key of Object.keys(body)) {
    if (SERVER_FIELDS.has(key)) {
      return fail(`${key} is assigned by the server`);
    }
    if (!BODY_FIELDS.has(key)) {
      return fail(`unknown field: ${key}`);
    }
  }
  const { parent, author, message, changes } = body;
  if (
    typeof parent !== "number" ||
    !Number.isSafeInteger(parent) ||
    parent < 1
  ) {
    return fail("parent must be a positive safe integer");
  }
  if (!isNonEmptyString(author)) {
    return fail("author must be a non-empty string");
  }
  if (!isNonEmptyString(message)) {
    return fail("message must be a non-empty string");
  }
  if (!Array.isArray(changes) || changes.length === 0) {
    return fail("changes must be a non-empty array");
  }
  const items: unknown[] = changes;
  const normalized: Change[] = [];
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (!isObject(item)) {
      return fail(`changes[${index}] must be an object`);
    }
    const unknown = Object.keys(item).find((key) => !CHANGE_FIELDS.has(key));
    if (unknown !== undefined) {
      return fail(`unknown field: changes[${index}].${unknown}`);
    }
    const { path, blobHash } = item;
    if (typeof path !== "string") {
      return fail(`changes[${index}].path must be a string`);
    }
    if (!isBlobHash(blobHash)) {
      return fail(
        `changes[${index}].blobHash must be null or 64 lowercase hex chars`,
      );
    }
    let normalizedPath: string;
    try {
      normalizedPath = normalizePath(path);
    } catch (error) {
      if (error instanceof InvalidPathError) {
        return fail(`invalid path "${path}": ${error.message}`);
      }
      throw error;
    }
    if (seen.has(normalizedPath)) {
      return fail(`duplicate path after normalization: ${normalizedPath}`);
    }
    seen.add(normalizedPath);
    normalized.push({ path: normalizedPath, blobHash });
  }
  return {
    ok: true,
    value: { parent, changeset: { author, message, changes: normalized } },
  };
}

export function buildApp({
  blobDir,
  db,
  bodyLimit = DEFAULT_BODY_LIMIT,
}: AppOptions): FastifyInstance {
  const app = Fastify({ bodyLimit });
  // One cache per app, so one per server process (ADR 0005). Only the
  // GET /changesets/:id/tree handler uses it: trees are computed on demand,
  // never when a changeset is created.
  const readTree = createTreeReader((id) => readChangeset(db, id));

  app.addHook("onReady", async () => {
    await mkdir(blobDir, { recursive: true });
  });

  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.put<{ Params: { hash: string }; Body: Buffer | undefined }>(
    "/blobs/:hash",
    async (request, reply) => {
      const { hash } = request.params;
      if (!Buffer.isBuffer(request.body)) {
        return sendError(
          reply,
          415,
          "content-type must be application/octet-stream",
        );
      }
      const result = await putBlob(blobDir, hash, request.body);
      if (result === "invalid-hash") {
        return sendError(reply, 400, `invalid hash: ${hash}`);
      }
      if (result === "hash-mismatch") {
        return sendError(reply, 400, `body does not match hash: ${hash}`);
      }
      return reply.code(result === "created" ? 201 : 200).send();
    },
  );

  app.get<{ Params: { hash: string } }>(
    "/blobs/:hash",
    async (request, reply) => {
      const { hash } = request.params;
      const result = await getBlob(blobDir, hash);
      if (result === "invalid-hash") {
        return sendError(reply, 400, `invalid hash: ${hash}`);
      }
      if (result === "not-found") {
        return sendError(reply, 404, `blob not found: ${hash}`);
      }
      return reply.type("application/octet-stream").send(result);
    },
  );

  app.get("/refs/main", () => ({ id: readMainHead(db) }));

  app.get<{ Params: { id: string } }>("/changesets/:id", (request, reply) => {
    const { id } = request.params;
    const numericId = parseChangesetId(id);
    if (numericId === undefined) {
      return sendError(reply, 400, `invalid changeset id: ${id}`);
    }
    const changeset = readChangeset(db, numericId);
    if (!changeset) {
      return sendError(reply, 404, `changeset not found: ${id}`);
    }
    return changeset;
  });

  app.get<{ Params: { id: string } }>(
    "/changesets/:id/tree",
    (request, reply) => {
      const { id } = request.params;
      const numericId = parseChangesetId(id);
      if (numericId === undefined) {
        return sendError(reply, 400, `invalid changeset id: ${id}`);
      }
      const tree = readTree(numericId);
      if (!tree) {
        return sendError(reply, 404, `changeset not found: ${id}`);
      }
      // treeEntries, never the Map itself: JSON.stringify turns a Map into {}.
      return { id: numericId, entries: treeEntries(tree) };
    },
  );

  app.post<{ Body: unknown }>("/changesets", async (request, reply) => {
    // The octet-stream parser registered above for PUT /blobs applies to every
    // route, so such a body reaches this handler as a Buffer.
    if (Buffer.isBuffer(request.body)) {
      return sendError(reply, 415, "content-type must be application/json");
    }
    const parsed = parseChangesetBody(request.body);
    if (!parsed.ok) {
      return sendError(reply, 400, parsed.message);
    }
    const { parent, changeset: input } = parsed.value;
    if (!readChangeset(db, parent)) {
      return sendError(reply, 404, `changeset not found: ${parent}`);
    }

    // Each blob is checked once, even when several paths share it. Removals
    // (blobHash null) do not touch the blob store.
    const hashes = new Set<string>();
    for (const change of input.changes) {
      if (change.blobHash !== null) {
        hashes.add(change.blobHash);
      }
    }
    const found = await Promise.all(
      [...hashes].map((hash) => hasBlob(blobDir, hash)),
    );
    const missing = [...hashes].filter((_hash, index) => !found[index]);
    if (missing.length > 0) {
      return sendError(reply, 400, `missing blobs: ${missing.join(", ")}`);
    }

    // From here to the compare-and-swap there is no await, so no other
    // request runs in between (ADR 0004, decision 5). Reading the head,
    // finding the conflicts, deciding and creating the changeset all happen
    // in this one synchronous stretch (ADR 0003). All asynchronous checks
    // must finish above this line.
    const head = readMainHead(db);
    // Paths of the request that a changeset after the parent, up to the head,
    // also changed. Both sides are normalized: the request's by
    // parseChangesetBody, the stored ones because they went through it too.
    // The order is readChangedPaths' (ORDER BY path).
    const requested = new Set(input.changes.map((change) => change.path));
    const conflicts = readChangedPaths(db, parent, head).filter((path) =>
      requested.has(path),
    );
    if (conflicts.length > 0) {
      return sendConflict(reply, conflicts);
    }
    // No conflict: the changeset goes on top of the head. When `parent` is
    // stale, this is the reparent, a single jump straight to the head; when
    // it is the head, nothing changes. createChangeset takes the parent from
    // `head`, never from the request.
    const result = createChangeset(db, head, input);
    if (result.kind === "stale-head") {
      // Unreachable while reading the head and the compare-and-swap run in
      // one synchronous stretch (ADR 0004, decision 5): a server bug.
      return sendError(reply, 500, "main moved during the request");
    }
    return reply.code(201).send(result.changeset);
  });

  return app;
}
