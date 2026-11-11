/**
 * File tree of a changeset: path → blobHash. Derived data (ADR 0005): computed
 * from the parent's tree and the changeset's changes, never stored.
 */
import type { Change } from "./changeset.js";

export type Tree = ReadonlyMap<string, string>;

/** One file of a tree, as the API returns it. */
export interface TreeEntry {
  path: string;
  blobHash: string;
}

/**
 * Parent tree + changes. Returns a new Map and never changes `tree`, which may
 * be shared through a cache. A removal (`blobHash` null) of a path that is not
 * in `tree` is ignored (ADR 0005).
 */
export function applyChanges(tree: Tree, changes: readonly Change[]): Tree {
  const result = new Map(tree);
  for (const { path, blobHash } of changes) {
    if (blobHash === null) {
      result.delete(path);
    } else {
      result.set(path, blobHash);
    }
  }
  return result;
}

/**
 * The entries of `tree`, sorted by path. `<` compares UTF-16 code units, not
 * the locale (no localeCompare), so the order is the same on every machine.
 */
export function treeEntries(tree: Tree): TreeEntry[] {
  return [...tree]
    .map(([path, blobHash]) => ({ path, blobHash }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
