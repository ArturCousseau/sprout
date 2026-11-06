/** A file change relative to the first parent. `blobHash` null = file removed. */
export interface Change {
  path: string;
  blobHash: string | null;
}

/** Diff against the first parent; never a tree snapshot. */
export interface Changeset {
  /** Sequential integer assigned by the server. */
  id: number;
  /** Id of the first parent; null for the first changeset. */
  parent: number | null;
  author: string;
  message: string;
  /** ISO 8601 in UTC, assigned by the server. */
  timestamp: string;
  changes: Change[];
}
