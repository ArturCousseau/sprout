/**
 * Trees of changesets, computed on demand and cached (ADR 0005). No SQL here:
 * the caller injects how a changeset is read.
 */
import type { Changeset } from "../core/changeset.js";
import { applyChanges, type Tree } from "../core/tree.js";

/** Reads one changeset; undefined when the id does not exist. */
export type ReadChangeset = (id: number) => Changeset | undefined;

/**
 * Returns readTree(id): the tree of changeset `id`, or undefined when the id
 * does not exist. The tree of a changeset is its parent's tree with its
 * changes applied (principle 5), computed with a loop, not recursion: walk up
 * the parents to the first one already cached (or past the root), then apply
 * the changes walking down. Every tree computed on the way is cached, and the
 * cache is never invalidated, because changesets never change (ADR 0005).
 *
 * An id that does not exist is not cached, so it is found once it is created.
 * A missing ancestor of an existing changeset throws: the schema's foreign key
 * and `CHECK (parent < id)` make it impossible.
 */
export function createTreeReader(
  read: ReadChangeset,
): (id: number) => Tree | undefined {
  const cache = new Map<number, Tree>();

  return (id) => {
    const cached = cache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const requested = read(id);
    if (requested === undefined) {
      return undefined;
    }

    // Walk up: collect the changesets without a cached tree, newest first.
    const pending: Changeset[] = [requested];
    let base: Tree = new Map();
    let parent = requested.parent;
    while (parent !== null) {
      const parentTree = cache.get(parent);
      if (parentTree !== undefined) {
        base = parentTree;
        break;
      }
      const changeset = read(parent);
      if (changeset === undefined) {
        throw new Error(`ancestor changeset not found: ${parent}`);
      }
      pending.push(changeset);
      parent = changeset.parent;
    }

    // Walk down: oldest first, caching each tree.
    let tree = base;
    for (const changeset of pending.reverse()) {
      tree = applyChanges(tree, changeset.changes);
      cache.set(changeset.id, tree);
    }
    return tree;
  };
}
