/**
 * The demo itself broke or met something it does not expect (an unknown push
 * result, a response outside the expected list, too many attempts). It is a
 * harness error, not a metric: the run stops instead of counting it (D9).
 */
export class HarnessError extends Error {
  override name = "HarnessError";
}
