export interface Barrier {
  /**
   * Waits until all N agents have arrived. Every call resolves with the same
   * instant: `performance.now()` read at the N-th arrival (start of the total
   * time). An arrival beyond N rejects.
   */
  arrive(): Promise<number>;
}

/** In-memory start barrier for `n` agents in the same process (D2). */
export function createBarrier(n: number): Barrier {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`barrier needs an integer n >= 1, got ${n}`);
  }
  let arrived = 0;
  const { promise, resolve } = Promise.withResolvers<number>();
  return {
    arrive() {
      if (arrived === n) {
        return Promise.reject(
          new Error(`barrier for ${n} agents: arrival ${n + 1} is too many`),
        );
      }
      arrived += 1;
      if (arrived === n) {
        resolve(performance.now());
      }
      return promise;
    },
  };
}
