import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { deflate, inflate } from "node:zlib";
import { hashContent } from "../core/hash.js";

const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

const HASH_FORMAT = /^[0-9a-f]{64}$/;

export type PutResult = "created" | "exists" | "invalid-hash" | "hash-mismatch";
export type GetResult = Buffer | "invalid-hash" | "not-found";

export async function putBlob(
  blobDir: string,
  hash: string,
  content: Buffer,
): Promise<PutResult> {
  if (!HASH_FORMAT.test(hash)) {
    return "invalid-hash";
  }
  if (hashContent(content) !== hash) {
    return "hash-mismatch";
  }
  const path = join(blobDir, hash);
  try {
    await stat(path);
    return "exists";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  await writeFile(path, await deflateAsync(content));
  return "created";
}

export async function getBlob(
  blobDir: string,
  hash: string,
): Promise<GetResult> {
  if (!HASH_FORMAT.test(hash)) {
    return "invalid-hash";
  }
  let compressed: Buffer;
  try {
    compressed = await readFile(join(blobDir, hash));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "not-found";
    }
    throw error;
  }
  return inflateAsync(compressed);
}
