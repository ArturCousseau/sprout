import { HarnessError } from "./harness-error.js";

/**
 * The server calls a Sprout agent makes in one cycle (docs/demo.md §4, "O
 * ciclo de um agente"), plus getTree, which the harness makes once at the end
 * of a fast run to check the main (#19).
 */
export type SproutOperation =
  "getMain" | "putBlob" | "postChangesets" | "getTree";

/**
 * HTTP statuses a Sprout agent expects from each call; anything else is a
 * HarnessError, not a metric. Taken from src/server/app.ts, from the status
 * list in its top comment and from the route handlers in buildApp:
 * - getMain, GET /refs/main: 200. The handler only returns readMainHead and
 *   has no error path.
 * - putBlob, PUT /blobs/:hash: 201 created, 200 already existed, from the
 *   result of putBlob ("created" or not). 400, 413 and 415 mean the agent
 *   sent a bad request.
 * - postChangesets, POST /changesets: 201 accepted (maybe reparented), 409
 *   real conflict (sent by sendConflict). Any other status (400, 404, 415
 *   and 500 among them) means a bad request or a server bug.
 * - getTree, GET /changesets/:id/tree: 200. The id comes from GET /refs/main,
 *   so 404 (no such changeset) and 400 (bad id) mean a server bug.
 * A Sprout agent never retries, so its `rejections` is always `{}`.
 */
export const EXPECTED_STATUS: Record<SproutOperation, readonly number[]> = {
  getMain: [200],
  putBlob: [201, 200],
  postChangesets: [201, 409],
  getTree: [200],
};

/** Throws a HarnessError when `status` is not expected for `op`. */
export function checkStatus(op: SproutOperation, status: number): void {
  const expected = EXPECTED_STATUS[op];
  if (!expected.includes(status)) {
    throw new HarnessError(
      `sprout: unexpected status ${status} for ${op} (expected ${expected.join(" or ")})`,
    );
  }
}

// The parse* functions below take the already decoded JSON body (`unknown`,
// since the server is not trusted to be right) and return only the field the
// agent uses. A body outside the format is a HarnessError, not a metric.

/** Reads a field of a JSON object; undefined when `body` is not an object. */
function field(body: unknown, name: string): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  return (body as Record<string, unknown>)[name];
}

/** GET /refs/main 200 → `{ id }`: returns the head changeset id. */
export function parseMainRef(body: unknown): number {
  const id = field(body, "id");
  if (typeof id !== "number" || !Number.isInteger(id)) {
    throw new HarnessError(
      `sprout: getMain body: id must be an integer (got ${JSON.stringify(body)})`,
    );
  }
  return id;
}

/**
 * POST /changesets 201 → the created changeset: returns its `parent`, which
 * the agent compares with the parent it sent to detect a reparent.
 */
export function parseAccepted(body: unknown): number {
  const parent = field(body, "parent");
  if (typeof parent !== "number" || !Number.isInteger(parent)) {
    throw new HarnessError(
      `sprout: postChangesets 201 body: parent must be an integer (got ${JSON.stringify(body)})`,
    );
  }
  return parent;
}

/** POST /changesets 409 → `{ conflicts }`: returns the conflicting paths. */
export function parseConflicts(body: unknown): string[] {
  const conflicts = field(body, "conflicts");
  if (
    !Array.isArray(conflicts) ||
    conflicts.length === 0 ||
    !conflicts.every((path) => typeof path === "string")
  ) {
    throw new HarnessError(
      `sprout: postChangesets 409 body: conflicts must be a non-empty array of strings (got ${JSON.stringify(body)})`,
    );
  }
  return conflicts;
}

/**
 * GET /changesets/:id/tree 200 → `{ id, entries: [{ path, blobHash }] }`:
 * returns path → blobHash (#19, D6). The body's `id` must be the one asked
 * for, every entry needs a string `path` and `blobHash`, and a path may not
 * repeat (A10): a Map would silently keep only the last one.
 */
export function parseTree(
  body: unknown,
  id: number,
): ReadonlyMap<string, string> {
  const got = `(got ${JSON.stringify(body)})`;
  if (field(body, "id") !== id) {
    throw new HarnessError(`sprout: getTree body: id must be ${id} ${got}`);
  }
  const entries = field(body, "entries");
  if (
    !Array.isArray(entries) ||
    !entries.every(
      (entry) =>
        typeof field(entry, "path") === "string" &&
        typeof field(entry, "blobHash") === "string",
    )
  ) {
    throw new HarnessError(
      `sprout: getTree body: entries must be an array of { path, blobHash } strings ${got}`,
    );
  }
  const tree = new Map<string, string>();
  for (const entry of entries as { path: string; blobHash: string }[]) {
    if (tree.has(entry.path)) {
      throw new HarnessError(
        `sprout: getTree body: duplicate path ${entry.path} ${got}`,
      );
    }
    tree.set(entry.path, entry.blobHash);
  }
  return tree;
}
