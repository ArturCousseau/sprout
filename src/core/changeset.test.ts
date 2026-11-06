import { describe, expectTypeOf, it } from "vitest";
import type { Change, Changeset } from "./changeset.js";

describe("Change", () => {
  it("has a path and a nullable blob hash", () => {
    expectTypeOf<Change>().toEqualTypeOf<{
      path: string;
      blobHash: string | null;
    }>();
  });

  it("uses null to mean a removed file", () => {
    const removed: Change = { path: "a/b.txt", blobHash: null };
    expectTypeOf(removed.blobHash).toEqualTypeOf<string | null>();
  });
});

describe("Changeset", () => {
  it("has exactly the diff fields, with no tree snapshot", () => {
    expectTypeOf<Changeset>().toEqualTypeOf<{
      id: number;
      parent: number | null;
      author: string;
      message: string;
      timestamp: string;
      changes: Change[];
    }>();
  });

  it("accepts a null parent for the first changeset", () => {
    expectTypeOf<Changeset["parent"]>().toEqualTypeOf<number | null>();
  });
});
