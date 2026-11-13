import { describe, expect, it } from "vitest";
import { HarnessError } from "./harness-error.js";
import {
  checkStatus,
  parseAccepted,
  parseConflicts,
  parseMainRef,
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
];

const operations: SproutOperation[] = ["getMain", "putBlob", "postChangesets"];
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
