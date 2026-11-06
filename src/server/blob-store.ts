import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { deflate, inflate } from "node:zlib";

const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

export async function putBlob(
  blobDir: string,
  hash: string,
  content: Buffer,
): Promise<void> {
  await writeFile(join(blobDir, hash), await deflateAsync(content));
}

/** Returns the blob content, or undefined if no blob has this hash. */
export async function getBlob(
  blobDir: string,
  hash: string,
): Promise<Buffer | undefined> {
  let compressed: Buffer;
  try {
    compressed = await readFile(join(blobDir, hash));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  return inflateAsync(compressed);
}
