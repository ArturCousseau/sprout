import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Changeset } from "../core/changeset.js";
import type { Tree } from "../core/tree.js";
import { createChangeset, openDatabase, readChangeset, type Db } from "./db.js";
import { createTreeReader } from "./tree.js";

// createChangeset does not look at the blob store, so any 64-char strings work.
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);

let db: Db;
/** Ids passed to the injected read, in call order. */
let reads: number[];
let readTree: (id: number) => Tree | undefined;

/** Creates a changeset on `head` and fails the test if main moved. */
function commit(head: number, changes: Changeset["changes"]): void {
  const result = createChangeset(db, head, {
    author: "test",
    message: "test",
    changes,
  });
  if (result.kind !== "created") {
    throw new Error("createChangeset did not create the changeset");
  }
}

beforeEach(() => {
  db = openDatabase(":memory:");
  // History, one line on top of the root (1):
  //   2 {a.txt = H1, b.txt = H2}  → tree {a: H1, b: H2}
  //   3 {a.txt = H3}              → tree {a: H3, b: H2}
  //   4 {b.txt removed}           → tree {a: H3}
  //   5 {c.txt = H1}              → tree {a: H3, c: H1}
  commit(1, [
    { path: "a.txt", blobHash: H1 },
    { path: "b.txt", blobHash: H2 },
  ]);
  commit(2, [{ path: "a.txt", blobHash: H3 }]);
  commit(3, [{ path: "b.txt", blobHash: null }]);
  commit(4, [{ path: "c.txt", blobHash: H1 }]);
  reads = [];
  readTree = createTreeReader((id) => {
    reads.push(id);
    return readChangeset(db, id);
  });
});

afterEach(() => {
  db.close();
});

describe("createTreeReader", () => {
  it("the root has an empty tree", () => {
    expect(readTree(1)).toEqual(new Map());
    expect(reads).toEqual([1]);
  });

  it("walks the whole chain on a cold cache", () => {
    expect(readTree(3)).toEqual(
      new Map([
        ["a.txt", H3],
        ["b.txt", H2],
      ]),
    );
    expect(reads).toEqual([3, 2, 1]);
  });

  it("reads only the requested changeset when the parent is cached", () => {
    readTree(4);
    reads.length = 0;

    expect(readTree(5)).toEqual(
      new Map([
        ["a.txt", H3],
        ["c.txt", H1],
      ]),
    );
    expect(reads).toEqual([5]);
  });

  it("a second read of the same id does not read the database", () => {
    const first = readTree(5);
    // Without this, a reader that always returns undefined would pass.
    expect(first).toEqual(
      new Map([
        ["a.txt", H3],
        ["c.txt", H1],
      ]),
    );
    reads.length = 0;

    const second = readTree(5);

    expect(second).toBe(first);
    expect(reads).toEqual([]);
  });

  it("the parent's tree stays the same after the child's is computed", () => {
    const parentTree = readTree(4);

    readTree(5);

    expect(parentTree).toEqual(new Map([["a.txt", H3]]));
  });

  it("unknown id → undefined", () => {
    expect(readTree(99)).toBeUndefined();
    expect(reads).toEqual([99]);
  });

  it("an id that does not exist yet is not cached", () => {
    expect(readTree(6)).toBeUndefined();

    commit(5, [{ path: "d.txt", blobHash: H2 }]);

    expect(readTree(6)).toEqual(
      new Map([
        ["a.txt", H3],
        ["c.txt", H1],
        ["d.txt", H2],
      ]),
    );
  });

  it("throws when an ancestor is missing", () => {
    // A read that knows changeset 3 but not its parent 2. The database cannot
    // get here (FK + CHECK), so this uses a fake read: that is the point of
    // injecting it.
    const orphan: Changeset = {
      id: 3,
      parent: 2,
      author: "test",
      message: "test",
      timestamp: "2026-11-10T00:00:00.000Z",
      changes: [],
    };
    const readOrphan = createTreeReader((id) =>
      id === 3 ? orphan : undefined,
    );

    expect(() => readOrphan(3)).toThrow("ancestor changeset not found: 2");
  });
});
