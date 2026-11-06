import { describe, expect, it } from "vitest";
import { InvalidPathError, normalizePath } from "./path.js";

function expectInvalid(path: string, rule: string): void {
  expect(() => normalizePath(path)).toThrow(InvalidPathError);
  expect(() => normalizePath(path)).toThrow(rule);
}

describe("InvalidPathError", () => {
  it("is named InvalidPathError", () => {
    expect(new InvalidPathError("x").name).toBe("InvalidPathError");
  });
});

describe("normalizePath", () => {
  describe("separator", () => {
    it("accepts / as separator", () => {
      expect(normalizePath("a/b/c")).toBe("a/b/c");
    });

    it("rejects a backslash", () => {
      expectInvalid("a\\b", "backslash");
    });
  });

  describe("empty path", () => {
    it("accepts a single segment", () => {
      expect(normalizePath("a")).toBe("a");
    });

    it("rejects an empty path", () => {
      expectInvalid("", "empty path");
    });
  });

  describe("absolute path", () => {
    it("accepts a relative path", () => {
      expect(normalizePath("a/b")).toBe("a/b");
    });

    it("rejects a leading slash", () => {
      expectInvalid("/a", "absolute path");
      expectInvalid("/", "absolute path");
    });

    it("rejects a drive letter", () => {
      expectInvalid("C:/a", "absolute path");
      expectInvalid("c:a", "absolute path");
      expectInvalid("a:b", "absolute path");
    });
  });

  describe("parent segment", () => {
    it("accepts a segment that only starts with ..", () => {
      expect(normalizePath("a/..b")).toBe("a/..b");
    });

    it("accepts a ... segment", () => {
      expect(normalizePath("a/...")).toBe("a/...");
    });

    it("rejects a .. segment", () => {
      expectInvalid("..", "parent segment");
      expectInvalid("a/../b", "parent segment");
    });
  });

  describe("empty segment", () => {
    it("accepts segments separated by a single slash", () => {
      expect(normalizePath("a/b")).toBe("a/b");
    });

    it("rejects an empty segment", () => {
      expectInvalid("a//b", "empty segment");
      expectInvalid("a/b//", "empty segment");
    });
  });

  describe("current directory segment", () => {
    it("removes every . segment", () => {
      expect(normalizePath("./a/b")).toBe("a/b");
      expect(normalizePath("a/./b")).toBe("a/b");
      expect(normalizePath("a/.")).toBe("a");
    });

    it("rejects a path with only . segments", () => {
      expectInvalid(".", "empty path");
      expectInvalid("./", "empty path");
    });
  });

  describe("trailing slash", () => {
    it("removes one trailing slash", () => {
      expect(normalizePath("a/b/")).toBe("a/b");
    });

    it("removes a trailing . segment", () => {
      expect(normalizePath("a/b/.")).toBe("a/b");
    });
  });

  describe("idempotence", () => {
    it.each(["a", "a/b/c", "./a/b", "a/./b/", "a/..b", "a/..."])(
      "normalizes %s to a fixed point",
      (input) => {
        const once = normalizePath(input);
        expect(normalizePath(once)).toBe(once);
      },
    );
  });
});
