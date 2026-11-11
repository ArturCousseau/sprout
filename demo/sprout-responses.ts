import { HarnessError } from "./harness-error.js";

/** The server calls a Sprout agent makes in one cycle (docs/demo.md:87-93). */
export type SproutOperation = "getMain" | "putBlob" | "postChangesets";

/**
 * HTTP statuses a Sprout agent expects from each call; anything else is a
 * HarnessError, not a metric. Taken from src/server/app.ts:
 * - getMain, GET /refs/main: 200 (contract :24-25; handler :318 has no error
 *   path).
 * - putBlob, PUT /blobs/:hash: 201 created, 200 already existed (contract
 *   :6-17; handler :281-301, `201 : 200` at :299). 400, 413 and 415 mean the
 *   agent sent a bad request.
 * - postChangesets, POST /changesets: 201 accepted (maybe reparented), 409
 *   real conflict (contract :44-74; 409 at :396, 201 at :408).
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
