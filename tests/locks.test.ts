import { describe, expect, it } from "vitest";
import { acquireLock, releaseLock, withLock } from "@/lib/locks";
import { createD1Fake } from "./helpers/d1-fake";

describe("CAS lock rows", () => {
  it("grants the lock to exactly one of two concurrent callers", async () => {
    const { db } = createD1Fake();
    const [a, b] = await Promise.all([
      acquireLock(db, { owner: "o1", key: "tick:mailing:t1", ttlMs: 60_000 }),
      acquireLock(db, { owner: "o1", key: "tick:mailing:t1", ttlMs: 60_000 }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("lets the next caller in after release", async () => {
    const { db } = createD1Fake();
    const first = await acquireLock(db, { owner: "o1", key: "k", ttlMs: 60_000 });
    expect(first).not.toBeNull();
    expect(await acquireLock(db, { owner: "o1", key: "k", ttlMs: 60_000 })).toBeNull();
    await releaseLock(db, first!);
    expect(await acquireLock(db, { owner: "o1", key: "k", ttlMs: 60_000 })).not.toBeNull();
  });

  it("takes over an expired lock and ignores a stale release", async () => {
    const { db } = createD1Fake();
    const t0 = 1_000_000;
    const stale = await acquireLock(db, { owner: "o1", key: "k", ttlMs: 10, now: t0 });
    const fresh = await acquireLock(db, { owner: "o1", key: "k", ttlMs: 60_000, now: t0 + 50 });
    expect(fresh).not.toBeNull();
    await releaseLock(db, stale!);
    expect(
      await acquireLock(db, { owner: "o1", key: "k", ttlMs: 60_000, now: t0 + 100 }),
    ).toBeNull();
  });

  it("isolates owners and keys", async () => {
    const { db } = createD1Fake();
    expect(await acquireLock(db, { owner: "o1", key: "k", ttlMs: 60_000 })).not.toBeNull();
    expect(await acquireLock(db, { owner: "o2", key: "k", ttlMs: 60_000 })).not.toBeNull();
    expect(await acquireLock(db, { owner: "o1", key: "k2", ttlMs: 60_000 })).not.toBeNull();
  });

  it("withLock releases after the callback throws", async () => {
    const { db } = createD1Fake();
    await expect(
      withLock(db, { owner: "o1", key: "k", ttlMs: 60_000 }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const again = await withLock(db, { owner: "o1", key: "k", ttlMs: 60_000 }, async () => 42);
    expect(again).toEqual({ acquired: true, value: 42 });
  });

  it("withLock reports busy without running the callback", async () => {
    const { db } = createD1Fake();
    await acquireLock(db, { owner: "o1", key: "k", ttlMs: 60_000 });
    let ran = false;
    const out = await withLock(db, { owner: "o1", key: "k", ttlMs: 60_000 }, async () => {
      ran = true;
    });
    expect(out).toEqual({ acquired: false });
    expect(ran).toBe(false);
  });
});
