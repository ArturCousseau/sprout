import { describe, expect, it } from "vitest";
import { applyChanges } from "./tree.js";

// Any 64-char strings work: applyChanges does not look inside the hashes.
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);

describe("applyChanges", () => {
  it("adds a new path", () => {
    const parent = new Map([["a.txt", H1]]);

    const tree = applyChanges(parent, [{ path: "b.txt", blobHash: H2 }]);

    expect(tree).toEqual(
      new Map([
        ["a.txt", H1],
        ["b.txt", H2],
      ]),
    );
  });

  it("overwrites an existing path", () => {
    const parent = new Map([["a.txt", H1]]);

    const tree = applyChanges(parent, [{ path: "a.txt", blobHash: H2 }]);

    expect(tree).toEqual(new Map([["a.txt", H2]]));
  });

  it("removes an existing path", () => {
    const parent = new Map([
      ["a.txt", H1],
      ["b.txt", H2],
    ]);

    const tree = applyChanges(parent, [{ path: "a.txt", blobHash: null }]);

    expect(tree).toEqual(new Map([["b.txt", H2]]));
  });

  it("ignores the removal of a path that is not in the tree", () => {
    // D3: the server accepts this removal (ADR 0005), so it must be a no-op.
    const parent = new Map([["a.txt", H1]]);

    const tree = applyChanges(parent, [
      { path: "never-existed.txt", blobHash: null },
    ]);

    expect(tree).toEqual(new Map([["a.txt", H1]]));
  });

  it("does not change the input tree", () => {
    // The parent's tree is shared through the cache: computing a child must
    // leave it as it was.
    const parent = new Map([
      ["a.txt", H1],
      ["b.txt", H2],
    ]);

    applyChanges(parent, [
      { path: "a.txt", blobHash: H3 },
      { path: "b.txt", blobHash: null },
      { path: "c.txt", blobHash: H3 },
    ]);

    expect(parent).toEqual(
      new Map([
        ["a.txt", H1],
        ["b.txt", H2],
      ]),
    );
  });

  it("applies several changes at once", () => {
    const parent = new Map([
      ["a.txt", H1],
      ["b.txt", H2],
    ]);

    const tree = applyChanges(parent, [
      { path: "a.txt", blobHash: H3 },
      { path: "b.txt", blobHash: null },
      { path: "c.txt", blobHash: H1 },
      { path: "ghost.txt", blobHash: null },
    ]);

    expect(tree).toEqual(
      new Map([
        ["a.txt", H3],
        ["c.txt", H1],
      ]),
    );
  });
});
