import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDemoTmp } from "./reset.js";

// Fake layout inside a fresh temp dir:
//   <base>/repo/            repoRoot
//   <base>/repo/root.txt    sentinel at the root
//   <base>/repo/demo/keep.txt
//   <base>/repo/demo/tmp/inside.txt
//   <base>/repo/demo/tmp2/keep.txt
//   <base>/outside/keep.txt
let base: string;
let repoRoot: string;
let demoTmp: string;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "sprout-demo-reset-"));
  repoRoot = join(base, "repo");
  demoTmp = join(repoRoot, "demo/tmp");
  await mkdir(demoTmp, { recursive: true });
  await mkdir(join(repoRoot, "demo/tmp2"));
  await mkdir(join(base, "outside"));
  await writeFile(join(repoRoot, "root.txt"), "root");
  await writeFile(join(repoRoot, "demo/keep.txt"), "demo");
  await writeFile(join(demoTmp, "inside.txt"), "tmp");
  await writeFile(join(repoRoot, "demo/tmp2/keep.txt"), "tmp2");
  await writeFile(join(base, "outside/keep.txt"), "outside");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("resetDemoTmp", () => {
  it("deletes demo/tmp and everything inside it", async () => {
    await resetDemoTmp(repoRoot, demoTmp);

    expect(await exists(demoTmp)).toBe(false);
    expect(await exists(join(repoRoot, "demo/keep.txt"))).toBe(true);
  });

  it("does not throw when demo/tmp is missing", async () => {
    await rm(demoTmp, { recursive: true });

    await expect(resetDemoTmp(repoRoot, demoTmp)).resolves.toBeUndefined();
  });

  it.each([
    ["demo", () => join(repoRoot, "demo")],
    ["the repo root", () => repoRoot],
    ["demo/tmp/..", () => join(repoRoot, "demo/tmp/..")],
    ["the sibling demo/tmp2", () => join(repoRoot, "demo/tmp2")],
    ["a path outside the repo", () => join(base, "outside")],
  ])("refuses %s and touches nothing", async (_label, target) => {
    await expect(resetDemoTmp(repoRoot, target())).rejects.toThrow(
      /refusing to delete/,
    );

    expect(await exists(join(repoRoot, "root.txt"))).toBe(true);
    expect(await exists(join(repoRoot, "demo/keep.txt"))).toBe(true);
    expect(await exists(join(demoTmp, "inside.txt"))).toBe(true);
    expect(await exists(join(repoRoot, "demo/tmp2/keep.txt"))).toBe(true);
    expect(await exists(join(base, "outside/keep.txt"))).toBe(true);
  });
});
