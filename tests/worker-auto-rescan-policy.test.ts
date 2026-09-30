import { describe, expect, it } from "vitest";
import {
  CATCH_UP_BASE_MS,
  nextCatchUpDelayMs,
} from "../telegram-worker/src/auto-rescan-policy.mjs";

const intervalMs = 5 * 60_000;

describe("auto-rescan catch-up policy", () => {
  it("does not catch up when the app reports no more work", () => {
    const data = { more: false, scanned: 3 };
    expect(nextCatchUpDelayMs({ ok: true, data, prevDelayMs: null, intervalMs })).toBeNull();
  });

  it("catches up quickly when the tick scanned or joined something", () => {
    const data = { more: true, scanned: 2, joined: 0, due: 5 };
    expect(nextCatchUpDelayMs({ ok: true, data, prevDelayMs: 96_000, intervalMs })).toBe(
      CATCH_UP_BASE_MS,
    );
  });

  it("catches up quickly when per-owner ticks still have queued groups", () => {
    const data = { more: true, scanned: 0, joined: 0, ticks: [{ queued: 0 }, { queued: 3 }] };
    expect(nextCatchUpDelayMs({ ok: true, data, prevDelayMs: null, intervalMs })).toBe(
      CATCH_UP_BASE_MS,
    );
  });

  it("backs off exponentially when more=true but nothing was done (due=0)", () => {
    const data = { more: true, scanned: 0, joined: 0, due: 0 };
    const delays: Array<number | null> = [];
    let prev: number | null = null;
    for (let i = 0; i < 6; i++) {
      prev = nextCatchUpDelayMs({ ok: true, data, prevDelayMs: prev, intervalMs });
      delays.push(prev);
      if (prev === null) break;
    }
    expect(delays).toEqual([24_000, 48_000, 96_000, 192_000, null]);
  });

  it("backs off after a fetch timeout instead of re-firing every 12 s", () => {
    expect(nextCatchUpDelayMs({ ok: false, aborted: true, prevDelayMs: null, intervalMs })).toBe(
      24_000,
    );
  });

  it("does not catch up after a failed HTTP response", () => {
    const data = { more: true, scanned: 5 };
    expect(nextCatchUpDelayMs({ ok: false, data, prevDelayMs: null, intervalMs })).toBeNull();
  });
});
