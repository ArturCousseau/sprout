import { describe, expect, it } from "vitest";
import { type AgentResult, summarize } from "./metrics.js";

// Fixed results, written by hand: summarize only adds them up.

// git, scenario B: 10 agents, all accepted. Agent N needed N - 1 rejections
// (45 in all), split between "fetch-first" and "ref-lock".
// The 55 attempts exceed the D9 ceiling (3 × N = 30 for N = 10). That ceiling
// is enforced in step 8 (checkGitAttempts), not by summarize.
const gitB: AgentResult[] = Array.from({ length: 10 }, (_, i) => {
  const lost = i; // agent 1 lost 0 rounds, agent 10 lost 9
  const fetchFirst = Math.ceil(lost / 2);
  const refLock = lost - fetchFirst;
  const rejections: AgentResult["rejections"] = {};
  if (fetchFirst > 0) rejections["fetch-first"] = fetchFirst;
  if (refLock > 0) rejections["ref-lock"] = refLock;
  return {
    agent: i + 1,
    outcome: "accepted",
    attempts: lost + 1,
    rejections,
    reparented: null,
    endMs: 100 * (i + 1),
  };
});

// Sprout, scenario B: 10 agents, one request each, 9 reparented.
const sproutB: AgentResult[] = Array.from({ length: 10 }, (_, i) => ({
  agent: i + 1,
  outcome: "accepted",
  attempts: 1,
  rejections: {},
  reparented: i > 0,
  endMs: [12, 30, 25, 41, 18, 33, 27, 39, 22, 35][i],
}));

// Sprout, scenario C: agent 1 accepted, agent 2 got a real conflict (409).
const sproutC: AgentResult[] = [
  {
    agent: 1,
    outcome: "accepted",
    attempts: 1,
    rejections: {},
    reparented: false,
    endMs: 15,
  },
  {
    agent: 2,
    outcome: "conflict",
    attempts: 1,
    rejections: {},
    reparented: false,
    endMs: 17,
  },
];

describe("summarize", () => {
  it("git, scenario B: adds up rejections of every type", () => {
    expect(summarize(gitB)).toEqual({
      accepted: 10,
      rejections: 45,
      attempts: 55,
      reparents: null,
      conflicts: 0,
      totalMs: 1000,
    });
  });

  it("Sprout, scenario B: counts 9 reparents and takes the largest endMs", () => {
    expect(summarize(sproutB)).toEqual({
      accepted: 10,
      rejections: 0,
      attempts: 10,
      reparents: 9,
      conflicts: 0,
      totalMs: 41,
    });
  });

  it("Sprout, scenario C: counts 1 conflict and 0 reparents", () => {
    expect(summarize(sproutC)).toEqual({
      accepted: 1,
      rejections: 0,
      attempts: 2,
      reparents: 0,
      conflicts: 1,
      totalMs: 17,
    });
  });

  it("throws on an empty list", () => {
    expect(() => summarize([])).toThrow(/no agents/);
  });

  it("throws when reparented mixes null with booleans", () => {
    const mixed: AgentResult[] = [
      { ...sproutC[0], reparented: null },
      { ...sproutC[1], reparented: true },
    ];

    expect(() => summarize(mixed)).toThrow(/null for every agent/);
  });
});
