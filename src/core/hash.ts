import { createHash } from "node:crypto";

/**
 * SHA-256 of the original (uncompressed) content, as 64 lowercase hex chars.
 * Strings are encoded as UTF-8; lone surrogates become U+FFFD.
 */
export function hashContent(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}
