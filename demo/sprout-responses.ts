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
