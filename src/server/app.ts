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
 * Errors use Fastify's own error shape: `{ statusCode, error, message }`.
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
import { getBlob, HASH_FORMAT, putBlob } from "./blob-store.js";
import {
  createChangeset,
  readChangeset,
  readMainHead,
  type Db,
  type NewChangeset,
} from "./db.js";

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

export const DEFAULT_BODY_LIMIT = 16 * 1024 * 1024;

/** Positive decimal integer, no leading zero. */
const CHANGESET_ID_FORMAT = /^[1-9][0-9]*$/;

type ParseResult =
  { ok: true; value: NewChangeset } | { ok: false; message: string };

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
    value: { parent, author, message, changes: normalized },
  };
}

export function buildApp({
  blobDir,
  db,
  bodyLimit = DEFAULT_BODY_LIMIT,
}: AppOptions): FastifyInstance {
  const app = Fastify({ bodyLimit });

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
    const numericId = Number(id);
    if (!CHANGESET_ID_FORMAT.test(id) || !Number.isSafeInteger(numericId)) {
      return sendError(reply, 400, `invalid changeset id: ${id}`);
    }
    const changeset = readChangeset(db, numericId);
    if (!changeset) {
      return sendError(reply, 404, `changeset not found: ${id}`);
    }
    return changeset;
  });

  app.post<{ Body: unknown }>("/changesets", (request, reply) => {
    const parsed = parseChangesetBody(request.body);
    if (!parsed.ok) {
      return sendError(reply, 400, parsed.message);
    }
    const head = readMainHead(db);
    const result = createChangeset(db, head, parsed.value);
    if (result.kind === "stale-head") {
      // Unreachable while reading the head and the compare-and-swap run in
      // one synchronous stretch (ADR 0004, decision 5): a server bug.
      return sendError(reply, 500, "main moved during the request");
    }
    return reply.code(201).send(result.changeset);
  });

  return app;
}
