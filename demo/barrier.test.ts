import { describe, expect, it } from "vitest";
import { createBarrier } from "./barrier.js";

// Lets every pending promise callback run before the test looks again.
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// Records whether a promise has settled, without awaiting it.
function track(promise: Promise<number>) {
  const state = { settled: false };
  promise.then(
    () => (state.settled = true),
    () => (state.settled = true),
  );
  return state;
}

describe("createBarrier", () => {
  it.each([0, -1, 1.5])("rejects n = %s", (n) => {
    expect(() => createBarrier(n)).toThrow(RangeError);
  });

  it("with N - 1 arrivals, no promise resolves", async () => {
    const barrier = createBarrier(3);
    const states = [track(barrier.arrive()), track(barrier.arrive())];

    await tick();

    expect(states.map((s) => s.settled)).toEqual([false, false]);
  });

  it("the N-th arrival releases every agent", async () => {
    const barrier = createBarrier(3);
    const waiting = [barrier.arrive(), barrier.arrive()];
    const states = waiting.map(track);
    await tick();
    expect(states.map((s) => s.settled)).toEqual([false, false]);

    const last = barrier.arrive();
    await tick();

    expect(states.map((s) => s.settled)).toEqual([true, true]);
    await expect(last).resolves.toEqual(expect.any(Number));
  });

  it("every agent gets the same instant, read at the N-th arrival", async () => {
    const barrier = createBarrier(3);
    const first = barrier.arrive();
    const second = barrier.arrive();
    const before = performance.now();
    const third = barrier.arrive();

    const instants = await Promise.all([first, second, third]);

    expect(new Set(instants).size).toBe(1);
    expect(instants[0]).toBeGreaterThanOrEqual(before);
  });

  it("with n = 1, the first arrival is released", async () => {
    await expect(createBarrier(1).arrive()).resolves.toEqual(
      expect.any(Number),
    );
  });

  it("arrival N + 1 rejects", async () => {
    const barrier = createBarrier(2);
    void barrier.arrive();
    void barrier.arrive();

    await expect(barrier.arrive()).rejects.toThrow(/arrival 3 is too many/);
  });
});
