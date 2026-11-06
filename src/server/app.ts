import { mkdir } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import { getBlob, putBlob } from "./blob-store.js";

export interface AppOptions {
  blobDir: string;
  bodyLimit?: number;
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

  app.put<{ Params: { hash: string }; Body: Buffer }>(
    "/blobs/:hash",
    async (request, reply) => {
      await putBlob(blobDir, request.params.hash, request.body);
      return reply.code(201).send();
    },
  );

  app.get<{ Params: { hash: string } }>(
    "/blobs/:hash",
    async (request, reply) => {
      const content = await getBlob(blobDir, request.params.hash);
      if (content === undefined) {
        return reply.code(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `blob not found: ${request.params.hash}`,
        });
      }
      return reply.type("application/octet-stream").send(content);
    },
  );

  return app;
}
