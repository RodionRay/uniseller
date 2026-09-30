/**
 * Gate for client pollers.
 * Why: interval ticks used to fire while the previous tick was still waiting on a slow worker call,
 * and kept hammering a failing server at full rate. The gate skips overlapping ticks, backs off
 * exponentially after consecutive failures and throttles ticks while the tab is hidden.
 */

export type PollGateOptions = {
  /** First backoff step after a failed tick. */
  baseBackoffMs: number;
  maxBackoffMs: number;
  /** Minimum gap between tick starts while the document is hidden. */
  hiddenMinIntervalMs: number;
};

export type PollGate = {
  /** Returns true and marks the gate busy when a tick may run now. */
  tryEnter(now: number, hidden: boolean): boolean;
  /** Releases the gate; a failed tick extends the backoff, a successful one resets it. */
  leave(now: number, ok: boolean): void;
  readonly failures: number;
};

export function createPollGate({ baseBackoffMs, maxBackoffMs, hiddenMinIntervalMs }: PollGateOptions): PollGate {
  let inFlight = false;
  let failures = 0;
  let nextAllowedAt = 0;
  let lastStartedAt = Number.NEGATIVE_INFINITY;

  return {
    tryEnter(now, hidden) {
      if (inFlight || now < nextAllowedAt) return false;
      if (hidden && now - lastStartedAt < hiddenMinIntervalMs) return false;
      inFlight = true;
      lastStartedAt = now;
      return true;
    },
    leave(now, ok) {
      inFlight = false;
      if (ok) {
        failures = 0;
        nextAllowedAt = 0;
        return;
      }
      failures += 1;
      nextAllowedAt = now + Math.min(maxBackoffMs, baseBackoffMs * 2 ** (failures - 1));
    },
    get failures() {
      return failures;
    },
  };
}
