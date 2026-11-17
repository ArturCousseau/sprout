import { describe, expect, it } from "vitest";
import { HarnessError } from "./harness-error.js";
import {
  checkStatus,
  parseAccepted,
  parseConflicts,
  parseMainRef,
  parseTree,
  type SproutOperation,
} from "./sprout-responses.js";

// Written by hand, not derived from EXPECTED_STATUS: removing a status from
// the list must make its test fail, not disappear.
const expected: [SproutOperation, number][] = [
  ["getMain", 200],
  ["putBlob", 201],
  ["putBlob", 200],
  ["postChangesets", 201],
  ["postChangesets", 409],
  ["getTree", 200],
];

const operations: SproutOperation[] = [
  "getMain",
  "putBlob",
  "postChangesets",
  "getTree",
];
const unexpected: [SproutOperation, number][] = operations.flatMap((op) =>
  [400, 404, 415, 500].map((status): [SproutOperation, number] => [op, status]),
);

describe("checkStatus", () => {
  it.each(expected)("%s: %i is expected", (op, status) => {
    expect(() => checkStatus(op, status)).not.toThrow();
  });

  it.each(unexpected)("%s: %i → HarnessError", (op, status) => {
    expect(() => checkStatus(op, status)).toThrow(HarnessError);
    expect(() => checkStatus(op, status)).toThrow(
      `unexpected status ${status} for ${op}`,
    );
  });

  it("postChangesets: 200 → HarnessError (only 201 means created)", () => {
    expect(() => checkStatus("postChangesets", 200)).toThrow(HarnessError);
    expect(() => checkStatus("postChangesets", 200)).toThrow(
      "unexpected status 200 for postChangesets (expected 201 or 409)",
    );
  });

  // Cross checks: a status expected for one operation is not accepted for
  // another, so the list is per operation, not global.
  it("putBlob: 409 → HarnessError (409 is only for postChangesets)", () => {
    expect(() => checkStatus("putBlob", 409)).toThrow(HarnessError);
    expect(() => checkStatus("putBlob", 409)).toThrow(
      "unexpected status 409 for putBlob (expected 201 or 200)",
    );
  });

  it("getMain: 201 → HarnessError (201 is only for writes)", () => {
    expect(() => checkStatus("getMain", 201)).toThrow(HarnessError);
    expect(() => checkStatus("getMain", 201)).toThrow(
      "unexpected status 201 for getMain (expected 200)",
    );
  });
});

// Bodies and expected values written by hand (plan, "Corpos de resposta").
// Each case is wrapped in a one-element tuple so that it.each does not spread
// an array body ([]) into the test arguments.
describe("criterion 6: response bodies", () => {
  it.each([
    [{ id: 1 }, 1],
    [{ id: 7 }, 7],
  ])("parseMainRef(%j) → %i", (body, expected) => {
    expect(parseMainRef(body)).toBe(expected);
  });

  it.each([
    [{}],
    [{ id: "1" }],
    [{ id: 1.5 }],
    [{ id: null }],
    [null],
    [[]],
    ["1"],
  ])("parseMainRef(%j) → HarnessError", (body) => {
    expect(() => parseMainRef(body)).toThrow(HarnessError);
    expect(() => parseMainRef(body)).toThrow("id must be an integer");
  });

  it.each([
    [{ id: 2, parent: 1 }, 1],
    [{ parent: 3 }, 3],
  ])("parseAccepted(%j) → %i", (body, expected) => {
    expect(parseAccepted(body)).toBe(expected);
  });

  it.each([
    [{}],
    [{ parent: "1" }],
    [{ parent: 1.5 }],
    [{ parent: null }],
    [null],
  ])("parseAccepted(%j) → HarnessError", (body) => {
    expect(() => parseAccepted(body)).toThrow(HarnessError);
    expect(() => parseAccepted(body)).toThrow("parent must be an integer");
  });

  it.each([
    [{ conflicts: ["conflito.txt"] }, ["conflito.txt"]],
    [{ conflicts: ["a.txt", "b.txt"] }, ["a.txt", "b.txt"]],
  ])("parseConflicts(%j) → %j", (body, expected) => {
    expect(parseConflicts(body)).toEqual(expected);
  });

  it.each([
    [{}],
    [{ conflicts: [] }],
    [{ conflicts: "conflito.txt" }],
    [{ conflicts: [1] }],
    [{ conflicts: ["a.txt", 1] }],
    [null],
  ])("parseConflicts(%j) → HarnessError", (body) => {
    expect(() => parseConflicts(body)).toThrow(HarnessError);
    expect(() => parseConflicts(body)).toThrow(
      "conflicts must be a non-empty array of strings",
    );
  });
});

// Written by hand with `printf 'agente N\n' | sha256sum` (the same values as
// sprout-agents.test.ts).
const H1 = "ebf0a5cfd5f69be2c45927bf26823df03672b0aab59e77ffedaf4fec371c7161";
const H2 = "3ae6b2f9235e1e7213e554ad7abd104870f8897a2d51771002b3281f5d53ff94";

/** Matches exactly `message`, not a part of it. */
function exactly(message: string): RegExp {
  return new RegExp(`^${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

// GET /changesets/:id/tree 200 → `{ id, entries: [{ path, blobHash }] }`
// (src/server/app.ts). Bodies, maps and messages written by hand (#19, D6).
describe("parseTree (#19, D6)", () => {
  it.each([
    [
      "two entries",
      {
        id: 3,
        entries: [
          { path: "agente-1.txt", blobHash: H1 },
          { path: "agente-2.txt", blobHash: H2 },
        ],
      },
      [
        ["agente-1.txt", H1],
        ["agente-2.txt", H2],
      ],
    ],
    ["no entries (the root's tree)", { id: 3, entries: [] }, []],
  ])("SR2 %s → path → blobHash", (_label, body, entries) => {
    expect(parseTree(body, 3)).toEqual(new Map(entries as [string, string][]));
  });

  it.each([
    ["null", null, "sprout: getTree body: id must be 3 (got null)"],
    ["{}", {}, "sprout: getTree body: id must be 3 (got {})"],
    [
      "id 2 asked as 3",
      { id: 2, entries: [] },
      'sprout: getTree body: id must be 3 (got {"id":2,"entries":[]})',
    ],
    [
      "entries not an array",
      { id: 3, entries: "agente-1.txt" },
      'sprout: getTree body: entries must be an array of { path, blobHash } strings (got {"id":3,"entries":"agente-1.txt"})',
    ],
    [
      "a numeric path",
      { id: 3, entries: [{ path: 1, blobHash: H1 }] },
      `sprout: getTree body: entries must be an array of { path, blobHash } strings (got {"id":3,"entries":[{"path":1,"blobHash":"${H1}"}]})`,
    ],
    [
      "a null blobHash",
      { id: 3, entries: [{ path: "agente-1.txt", blobHash: null }] },
      'sprout: getTree body: entries must be an array of { path, blobHash } strings (got {"id":3,"entries":[{"path":"agente-1.txt","blobHash":null}]})',
    ],
    [
      "duplicate path",
      {
        id: 3,
        entries: [
          { path: "agente-1.txt", blobHash: H1 },
          { path: "agente-1.txt", blobHash: H2 },
        ],
      },
      `sprout: getTree body: duplicate path agente-1.txt (got {"id":3,"entries":[{"path":"agente-1.txt","blobHash":"${H1}"},{"path":"agente-1.txt","blobHash":"${H2}"}]})`,
    ],
  ])("SR3 %s → HarnessError", (_label, body, message) => {
    expect(() => parseTree(body, 3)).toThrow(HarnessError);
    expect(() => parseTree(body, 3)).toThrow(exactly(message));
  });
});
