/**
 * SQLite metadata: changesets, their changes and the main ref. Does not know
 * about HTTP. All of the project's SQL lives here, and every query takes its
 * values as `?` parameters. Design notes in docs/adr/0004.
 *
 * Tables: `changesets` (diff against the first parent, never a tree),
 * `changes` (one row per changed path; `blob_hash` NULL = file removed) and
 * `refs` (only `main`).
 */
import Database from "better-sqlite3";
import type { Change, Changeset } from "../core/changeset.js";

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS changesets (
  id        INTEGER PRIMARY KEY,
  parent    INTEGER REFERENCES changesets (id),
  author    TEXT NOT NULL,
  message   TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS changes (
  changeset_id INTEGER NOT NULL REFERENCES changesets (id),
  path         TEXT NOT NULL,
  blob_hash    TEXT,
  PRIMARY KEY (changeset_id, path)
);

CREATE TABLE IF NOT EXISTS refs (
  name  TEXT NOT NULL PRIMARY KEY CHECK (name = 'main'),
  value INTEGER NOT NULL REFERENCES changesets (id)
);
`;

/** Creates the root changeset and points main at it, unless main exists. */
function seed(db: Db): void {
  const hasMain = db.prepare("SELECT 1 FROM refs WHERE name = 'main'").get();
  if (hasMain) {
    return;
  }
  db.prepare(
    "INSERT INTO changesets (id, parent, author, message, timestamp) VALUES (1, NULL, 'sprout', 'root', ?)",
  ).run(new Date().toISOString());
  db.prepare("INSERT INTO refs (name, value) VALUES ('main', 1)").run();
}

export function openDatabase(path: string): Db {
  const db = new Database(path);
  try {
    // The current better-sqlite3 build already turns foreign keys on
    // (SQLITE_DEFAULT_FOREIGN_KEYS=1); set explicitly so the rule does not
    // depend on the build or the driver. Must run outside a transaction:
    // inside one it is a no-op.
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
    db.transaction(seed).immediate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Id of the changeset main points at. openDatabase guarantees main exists. */
export function readMainHead(db: Db): number {
  const head = db
    .prepare<[], number>("SELECT value FROM refs WHERE name = 'main'")
    .pluck()
    .get();
  if (head === undefined) {
    throw new Error("the main ref is missing");
  }
  return head;
}

/** The changeset with this id, with its changes sorted by path. */
export function readChangeset(db: Db, id: number): Changeset | undefined {
  const row = db
    .prepare<[number], Omit<Changeset, "changes">>(
      "SELECT id, parent, author, message, timestamp FROM changesets WHERE id = ?",
    )
    .get(id);
  if (!row) {
    return undefined;
  }
  const changes = db
    .prepare<[number], Change>(
      "SELECT path, blob_hash AS blobHash FROM changes WHERE changeset_id = ? ORDER BY path",
    )
    .all(id);
  return { ...row, changes };
}

/** A changeset to create. Paths must already be normalized. */
export interface NewChangeset {
  parent: number;
  author: string;
  message: string;
  changes: Change[];
}

export type CreateChangesetResult =
  { kind: "created"; changeset: Changeset } | { kind: "stale-head" };

/** Inserts the changeset and its changes and moves main. Runs inside a transaction. */
function writeChangeset(db: Db, input: NewChangeset): Changeset {
  const id = Number(
    db
      .prepare(
        "INSERT INTO changesets (parent, author, message, timestamp) VALUES (?, ?, ?, ?)",
      )
      .run(input.parent, input.author, input.message, new Date().toISOString())
      .lastInsertRowid,
  );
  const insertChange = db.prepare(
    "INSERT INTO changes (changeset_id, path, blob_hash) VALUES (?, ?, ?)",
  );
  for (const change of input.changes) {
    insertChange.run(id, change.path, change.blobHash);
  }
  db.prepare("UPDATE refs SET value = ? WHERE name = 'main'").run(id);
  const changeset = readChangeset(db, id);
  if (!changeset) {
    throw new Error(`changeset ${id} was not written`);
  }
  return changeset;
}

/**
 * Writes the changeset, its changes and the new main in one immediate
 * transaction: if any step throws, nothing is written and the error is
 * rethrown.
 */
export function createChangeset(
  db: Db,
  _expectedHead: number,
  input: NewChangeset,
): CreateChangesetResult {
  const changeset = db.transaction(writeChangeset).immediate(db, input);
  return { kind: "created", changeset };
}
