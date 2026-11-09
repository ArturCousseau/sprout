import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashContent } from "../core/hash.js";
import { hasBlob, putBlob } from "./blob-store.js";

let root: string;
let blobDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sprout-blob-store-"));
  blobDir = join(root, "blobs");
  await mkdir(blobDir);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("hasBlob", () => {
  it("hasBlob: true for a stored blob", async () => {
    const body = Buffer.from("stored content");
    const hash = hashContent(body);
    await putBlob(blobDir, hash, body);

    expect(await hasBlob(blobDir, hash)).toBe(true);
  });

  it("hasBlob: false for a missing blob", async () => {
    expect(await hasBlob(blobDir, hashContent("never stored"))).toBe(false);
  });

  it("hasBlob: does not inflate the file", async () => {
    // Not zlib data: getBlob would fail to inflate it.
    const hash = hashContent("some content");
    await writeFile(join(blobDir, hash), "not zlib data");

    expect(await hasBlob(blobDir, hash)).toBe(true);
  });
});
