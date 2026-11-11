import { rm } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Deletes `target` (recursively) only when it is exactly `<repoRoot>/demo/tmp`.
 * Any other path throws before anything is touched. A missing `demo/tmp` is
 * not an error.
 * The comparison uses path.resolve and does not follow symlinks; demo/tmp is
 * created by the demo and listed in .gitignore.
 */
export async function resetDemoTmp(
  repoRoot: string,
  target: string,
): Promise<void> {
  const expected = resolve(repoRoot, "demo/tmp");
  const actual = resolve(target);
  if (actual !== expected) {
    throw new Error(
      `refusing to delete "${actual}": only "${expected}" may be reset`,
    );
  }
  await rm(actual, { recursive: true, force: true });
}
