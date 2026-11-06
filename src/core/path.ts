export class InvalidPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPathError";
  }
}

/**
 * Returns the canonical form of a repository path: relative, `/`-separated,
 * without `.` segments or a trailing slash. Throws InvalidPathError otherwise.
 */
export function normalizePath(path: string): string {
  if (path === "") {
    throw new InvalidPathError("empty path");
  }
  if (path.includes("\\")) {
    throw new InvalidPathError(`backslash not allowed, use /: ${path}`);
  }
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new InvalidPathError(`absolute path: ${path}`);
  }

  const withoutTrailingSlash = path.endsWith("/") ? path.slice(0, -1) : path;
  const segments = withoutTrailingSlash.split("/");
  if (segments.includes("")) {
    throw new InvalidPathError(`empty segment: ${path}`);
  }
  if (segments.includes("..")) {
    throw new InvalidPathError(`parent segment (..): ${path}`);
  }

  const kept = segments.filter((segment) => segment !== ".");
  if (kept.length === 0) {
    throw new InvalidPathError(`empty path: ${path}`);
  }
  return kept.join("/");
}
