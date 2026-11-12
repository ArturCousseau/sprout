/**
 * Every kind of rejected git push the demo counts (classifyPush in git.ts):
 * "fetch-first" when the remote moved before the push, "ref-lock" when two
 * pushes raced for the ref and this one lost.
 */
export const REJECTION_TYPES = ["fetch-first", "ref-lock"] as const;
export type RejectionType = (typeof REJECTION_TYPES)[number];

/** What one agent did in one run (docs/demo.md §6, D4). */
export interface AgentResult {
  /** 1-based agent number. */
  agent: number;
  /** "conflict": a real conflict (same file); the agent gave up. */
  outcome: "accepted" | "conflict";
  /** git: pushes; Sprout: `POST /changesets` requests. */
  attempts: number;
  /** Rejected attempts by type, e.g. `{ "fetch-first": 2, "ref-lock": 1 }`. */
  rejections: Partial<Record<RejectionType, number>>;
  /** Sprout: whether the 201 came with another parent. git: always null. */
  reparented: boolean | null;
  /** Milliseconds from the barrier release to this agent's end. */
  endMs: number;
}

/** One column of the scoreboard, computed only from the agent results. */
export interface RunSummary {
  accepted: number;
  /** Sum of every rejection type of every agent. */
  rejections: number;
  attempts: number;
  /**
   * null when every agent has `reparented: null` (git). A list mixing null
   * with booleans throws.
   */
  reparents: number | null;
  conflicts: number;
  /** Largest `endMs`: from the release to the last agent's end. */
  totalMs: number;
}

export function summarize(agents: AgentResult[]): RunSummary {
  if (agents.length === 0) {
    throw new Error("cannot summarize a run with no agents");
  }
  const nulls = agents.filter((a) => a.reparented === null).length;
  if (nulls > 0 && nulls < agents.length) {
    throw new Error(
      "reparented must be null for every agent (git) or for none (Sprout)",
    );
  }
  let accepted = 0;
  let conflicts = 0;
  let rejections = 0;
  let attempts = 0;
  let reparents: number | null = null;
  let totalMs = 0;
  for (const a of agents) {
    if (a.outcome === "accepted") accepted += 1;
    else conflicts += 1;
    for (const count of Object.values(a.rejections)) rejections += count ?? 0;
    attempts += a.attempts;
    if (a.reparented !== null) {
      reparents = (reparents ?? 0) + (a.reparented ? 1 : 0);
    }
    totalMs = Math.max(totalMs, a.endMs);
  }
  return { accepted, rejections, attempts, reparents, conflicts, totalMs };
}
