import { HarnessError } from "./harness-error.js";

/**
 * The server calls a Sprout agent makes in one cycle (docs/demo.md §4, "O
 * ciclo de um agente").
 */
export type SproutOperation = "getMain" | "putBlob" | "postChangesets";

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
 * A Sprout agent never retries, so its `rejections` is always `{}`.
 */
export const EXPECTED_STATUS: Record<SproutOperation, readonly number[]> = {
  getMain: [200],
  putBlob: [201, 200],
  postChangesets: [201, 409],
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
