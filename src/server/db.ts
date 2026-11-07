import Database from "better-sqlite3";

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
    // Must run outside a transaction: inside one it is a no-op.
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
    db.transaction(seed).immediate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
