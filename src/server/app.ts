/**
 * HTTP API of the blob store. Status codes:
 *
 * PUT /blobs/:hash — body is the raw blob; the request must send
 * `content-type: application/octet-stream`.
 *   201  blob created (no body)
 *   400  :hash is not 64 lowercase hex chars, or the body does not hash to :hash
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
 * Errors use Fastify's own error shape: `{ statusCode, error, message }`.
 *
 * A literal `../` in the URL (`/blobs/../x`) never reaches these handlers: the
 * router resolves the path first (`/x`) and answers 404 by itself. An encoded
 * `..%2F` does reach them as part of :hash and is rejected by the hash format.
 */
import { mkdir } from "node:fs/promises";
import { STATUS_CODES } from "node:http";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { getBlob, putBlob } from "./blob-store.js";

export interface AppOptions {
  blobDir: string;
  bodyLimit?: number;
}

function sendError(reply: FastifyReply, statusCode: number, message: string) {
  return reply
    .code(statusCode)
    .send({ statusCode, error: STATUS_CODES[statusCode], message });
}

export function buildApp({ blobDir }: AppOptions): FastifyInstance {
  const app = Fastify();

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
      return reply.code(201).send();
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

  return app;
}
