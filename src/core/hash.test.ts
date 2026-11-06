import { describe, expect, it } from "vitest";
import { hashContent } from "./hash.js";

// Reference values computed with `shasum -a 256`.
const SHA256_ABC =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const SHA256_EMPTY =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SHA256_00_FF_FE =
  "d590f90f7944340fb253f0c59cb89fd41d4ec255ff246f524f8f7c94f0a233e5";
// "é" as UTF-8 (bytes c3 a9).
const SHA256_E_ACUTE =
  "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c";

describe("hashContent", () => {
  it("returns the SHA-256 as 64 lowercase hex characters", () => {
    expect(hashContent("hello")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes the original content, not a compressed form", () => {
    expect(hashContent("abc")).toBe(SHA256_ABC);
  });

  it("returns the same hash for the same content", () => {
    expect(hashContent("same")).toBe(hashContent("same"));
  });

  it("returns different hashes for different content", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });

  it("hashes a string as its UTF-8 bytes", () => {
    expect(hashContent("abc")).toBe(
      hashContent(new TextEncoder().encode("abc")),
    );
  });

  it("works with empty content", () => {
    expect(hashContent(new Uint8Array())).toBe(SHA256_EMPTY);
    expect(hashContent("")).toBe(SHA256_EMPTY);
  });

  it("works with binary content that is not valid UTF-8", () => {
    expect(hashContent(new Uint8Array([0x00, 0xff, 0xfe]))).toBe(
      SHA256_00_FF_FE,
    );
  });

  it("hashes a non-ASCII string as its UTF-8 bytes", () => {
    expect(hashContent("é")).toBe(SHA256_E_ACUTE);
  });

  it("hashes a lone surrogate as U+FFFD", () => {
    expect(hashContent("\ud800")).toBe(hashContent("�"));
  });

  it("hashes only the bytes of a subarray view", () => {
    const backing = new Uint8Array([0x61, 0x62, 0x63, 0x64]);
    const view = backing.subarray(1, 3);
    expect(view.byteOffset).not.toBe(0);
    expect(hashContent(view)).toBe(hashContent(new Uint8Array([0x62, 0x63])));
  });
});
