import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.js";

let root: string;
const opened: Db[] = [];

function track(db: Db): Db {
  opened.push(db);
  return db;
}

function open(path = ":memory:"): Db {
  return track(openDatabase(path));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sprout-db-"));
});

afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
  }
  await rm(root, { recursive: true, force: true });
});

const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

describe("schema", () => {
  it("creates only the changesets, changes and refs tables", () => {
    const db = open();

    const tableNames = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .pluck()
      .all();
    expect(tableNames).toEqual(["changes", "changesets", "refs"]);

    const columns = (table: string) =>
      db
        .prepare('SELECT name, type, "notnull", pk FROM pragma_table_info(?)')
        .all(table);
    expect(columns("changesets")).toEqual([
      { name: "id", type: "INTEGER", notnull: 0, pk: 1 },
      { name: "parent", type: "INTEGER", notnull: 0, pk: 0 },
      { name: "author", type: "TEXT", notnull: 1, pk: 0 },
      { name: "message", type: "TEXT", notnull: 1, pk: 0 },
      { name: "timestamp", type: "TEXT", notnull: 1, pk: 0 },
    ]);
    expect(columns("changes")).toEqual([
      { name: "changeset_id", type: "INTEGER", notnull: 1, pk: 1 },
      { name: "path", type: "TEXT", notnull: 1, pk: 2 },
      { name: "blob_hash", type: "TEXT", notnull: 0, pk: 0 },
    ]);
    expect(columns("refs")).toEqual([
      { name: "name", type: "TEXT", notnull: 1, pk: 1 },
      { name: "value", type: "INTEGER", notnull: 1, pk: 0 },
    ]);
  });

  it("rejects a changeset whose parent does not exist", () => {
    const db = open();

    expect(() =>
      db
        .prepare(
          "INSERT INTO changesets (id, parent, author, message, timestamp) VALUES (2, 99, 'a', 'm', 't')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it.each([
    ["dev", /CHECK constraint failed/],
    [null, /NOT NULL constraint failed/],
  ])("refs rejects any name other than main (%s)", (name, error) => {
    const db = open();

    expect(() =>
      db.prepare("INSERT INTO refs (name, value) VALUES (?, 1)").run(name),
    ).toThrow(error);
  });

  it("rejects the same path twice in one changeset", () => {
    const db = open();
    const insert = db.prepare(
      "INSERT INTO changes (changeset_id, path, blob_hash) VALUES (1, 'a.txt', NULL)",
    );
    insert.run();

    expect(() => insert.run()).toThrow(
      /UNIQUE constraint failed: changes.changeset_id, changes.path/,
    );
  });
});

describe("root changeset", () => {
  it("creates the root changeset and main on a new database", () => {
    const db = open();

    expect(
      db.prepare("SELECT id, parent, author, message FROM changesets").all(),
    ).toEqual([{ id: 1, parent: null, author: "sprout", message: "root" }]);
    expect(
      db.prepare("SELECT timestamp FROM changesets").pluck().get(),
    ).toMatch(ISO_UTC);
    expect(db.prepare("SELECT * FROM changes").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM refs").all()).toEqual([
      { name: "main", value: 1 },
    ]);
  });

  it("creates root and main atomically", () => {
    const file = join(root, "sprout.db");
    const setup = track(new Database(file));
    setup.exec(`
      CREATE TABLE refs (name TEXT PRIMARY KEY, value INTEGER);
      CREATE TRIGGER fail_ref BEFORE INSERT ON refs
      BEGIN SELECT RAISE(ABORT, 'boom'); END;
    `);
    setup.close();

    expect(() => open(file)).toThrow(/boom/);

    const raw = track(new Database(file));
    expect(raw.prepare("SELECT count(*) FROM changesets").pluck().get()).toBe(
      0,
    );
  });

  it("reopening keeps main and does not add another root", () => {
    const file = join(root, "sprout.db");
    const first = open(file);
    first
      .prepare(
        "INSERT INTO changesets (id, parent, author, message, timestamp) VALUES (2, 1, 'a', 'm', '2026-11-06T00:00:00.000Z')",
      )
      .run();
    first.prepare("UPDATE refs SET value = 2 WHERE name = 'main'").run();
    first.close();

    const again = open(file);

    expect(
      again.prepare("SELECT value FROM refs WHERE name = 'main'").pluck().get(),
    ).toBe(2);
    expect(again.prepare("SELECT count(*) FROM changesets").pluck().get()).toBe(
      2,
    );
  });
});
