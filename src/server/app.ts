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
import { getBlob, putBlob } from "./blob-store.js";
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

  app.post<{ Body: NewChangeset }>("/changesets", (request, reply) => {
    const { parent, author, message } = request.body;
    const changes: Change[] = [];
    for (const change of request.body.changes) {
      try {
        changes.push({ ...change, path: normalizePath(change.path) });
      } catch (error) {
        if (error instanceof InvalidPathError) {
          return sendError(
            reply,
            400,
            `invalid path "${change.path}": ${error.message}`,
          );
        }
        throw error;
      }
    }
    const head = readMainHead(db);
    const result = createChangeset(db, head, {
      parent,
      author,
      message,
      changes,
    });
    if (result.kind === "stale-head") {
      // Unreachable while reading the head and the compare-and-swap run in
      // one synchronous stretch (ADR 0004, decision 5): a server bug.
      return sendError(reply, 500, "main moved during the request");
    }
    return reply.code(201).send(result.changeset);
  });

  return app;
}
