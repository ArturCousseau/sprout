/**
 * Blob store on disk. Does not know about HTTP.
 *
 * Layout: one flat directory. Each blob is the file `<blobDir>/<hash>`, where
 * `<hash>` is the SHA-256 of the original content (64 lowercase hex chars) and
 * the file holds that content compressed with zlib (deflate). Files named
 * `.tmp-<uuid>` are temporary writes in progress; they never match the hash
 * format, so they are never served as blobs.
 *
 * Publishing never overwrites (objects are immutable) and never exposes a
 * partial file: the compressed content is written to a `.tmp-` file first and
 * then hard-linked to `<blobDir>/<hash>`. `link` fails with EEXIST when the
 * destination exists, atomically, so exactly one concurrent writer creates the
 * blob and the others see "exists". `rename` would not do: it silently
 * replaces an existing destination. The temporary file lives in `blobDir`
 * because `link` cannot cross file systems (EXDEV).
 */
import { randomUUID } from "node:crypto";
import { access, link, readFile, rm, writeFile } from "node:fs/promises";
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
  const compressed = await deflateAsync(content);
  const tmp = join(blobDir, `.tmp-${randomUUID()}`);
  try {
    await writeFile(tmp, compressed, { flag: "wx" });
    try {
      await link(tmp, join(blobDir, hash));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return "exists";
      }
      throw error;
    }
    return "created";
  } finally {
    await rm(tmp, { force: true });
  }
}

/** true when <blobDir>/<hash> exists. Never reads or inflates the file. */
export async function hasBlob(blobDir: string, hash: string): Promise<boolean> {
  try {
    await access(join(blobDir, hash));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
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
