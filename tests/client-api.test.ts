import { describe, expect, it } from "vitest";
import {
  ApiError,
  DEFAULT_TIMEOUT_MS,
  LONG_TIMEOUT_MS,
  POLL_DM_TIMEOUT_MS,
  busyWaitSec,
  isForbidden,
  requestJson,
  timeoutForAction,
  waitLabel,
} from "@/app/app/api-client";
import { createPollGate } from "@/app/app/poll-gate";
import { appTimeoutForWorker } from "@/lib/processes/worker-timeouts";

function respond(body: string, status = 200, contentType = "application/json"): typeof fetch {
  return (async () => new Response(body, { status, headers: { "Content-Type": contentType } })) as typeof fetch;
}

async function catchError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("expected rejection");
}

describe("requestJson", () => {
  it("returns parsed JSON on 2xx", async () => {
    const data = await requestJson<{ records: unknown[] }>("/x", {}, { fetchImpl: respond('{"records":[]}') });
    expect(data.records).toEqual([]);
  });

  it("turns an HTML 502 into an http ApiError with a readable message", async () => {
    const err = await catchError(
      requestJson("/x", {}, { fetchImpl: respond("<html>Bad Gateway</html>", 502, "text/html") }),
    );
    expect(err.kind).toBe("http");
    expect(err.status).toBe(502);
    expect(err.message).toContain("502");
    expect(err.message).not.toMatch(/Unexpected token/);
  });

  it("keeps the server error text and data on JSON errors", async () => {
    const err = await catchError(
      requestJson("/x", {}, { fetchImpl: respond('{"error":"Аккаунт занят","busy":true}', 409) }),
    );
    expect(err.status).toBe(409);
    expect(err.message).toBe("Аккаунт занят");
    expect(err.data.busy).toBe(true);
  });

  it("gives 409 without a body a busy notice", async () => {
    const err = await catchError(requestJson("/x", {}, { fetchImpl: respond("", 409) }));
    expect(err.message).toMatch(/уже выполняется/);
  });

  it("rejects a non-JSON 200 as a parse error", async () => {
    const err = await catchError(requestJson("/x", {}, { fetchImpl: respond("<html>ok</html>", 200, "text/html") }));
    expect(err.kind).toBe("parse");
  });

  it("maps a network failure to a network ApiError", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const err = await catchError(requestJson("/x", {}, { fetchImpl: failing }));
    expect(err.kind).toBe("network");
    expect(err.status).toBe(0);
  });

  it("aborts a hung request after the timeout", async () => {
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const err = await catchError(requestJson("/x", {}, { fetchImpl: hanging, timeoutMs: 20 }));
    expect(err.kind).toBe("timeout");
  });
});

describe("busy / forbidden contract", () => {
  it("shows a busy 429 without server text as a wait notice", async () => {
    const err = await catchError(
      requestJson("/x", {}, { fetchImpl: respond('{"busy":true,"pace":true,"waitSec":30}', 429) }),
    );
    expect(err.message).toBe("Аккаунт занят — повторите через 30 с");
    expect(busyWaitSec(err)).toBe(30);
  });

  it("reads busy from a 2xx payload (scan_group / tick_*)", () => {
    expect(busyWaitSec({ ok: true, busy: true, skipped: true, waitSec: 15 })).toBe(15);
    expect(busyWaitSec({ ok: true, task: {} })).toBeNull();
    expect(busyWaitSec(null)).toBeNull();
  });

  it("does not treat a 500 as busy", () => {
    expect(busyWaitSec(new ApiError("x", "http", 500))).toBeNull();
  });

  it("detects 403 forbidden", async () => {
    const err = await catchError(requestJson("/x", {}, { fetchImpl: respond('{"forbidden":true}', 403) }));
    expect(isForbidden(err)).toBe(true);
    expect(isForbidden(new ApiError("x", "network"))).toBe(false);
  });

  it("formats waits in seconds or minutes", () => {
    expect(waitLabel(0)).toBe("немного");
    expect(waitLabel(30)).toBe("30 с");
    expect(waitLabel(125)).toBe("3 мин");
  });
});

describe("timeoutForAction", () => {
  it("gives worker-backed actions the long timeout", () => {
    expect(timeoutForAction("scan_group")).toBe(LONG_TIMEOUT_MS);
    expect(timeoutForAction("tick_mailing")).toBe(LONG_TIMEOUT_MS);
  });

  it("gives poll_dm_replies ~100 s to cover the server budget", () => {
    expect(timeoutForAction("poll_dm_replies")).toBe(POLL_DM_TIMEOUT_MS);
    expect(POLL_DM_TIMEOUT_MS).toBeGreaterThanOrEqual(95_000);
  });

  it("outlasts the slowest single worker call (180 s + margin) for invite, collect and photos", () => {
    for (const action of ["tick_invite", "tick_audience", "upload_account_photos"]) {
      expect(timeoutForAction(action)).toBeGreaterThanOrEqual(appTimeoutForWorker("/invite-users") + 5_000);
    }
  });

  it("outlasts one default worker call for the other long actions", () => {
    expect(LONG_TIMEOUT_MS).toBeGreaterThan(appTimeoutForWorker("/send-message"));
  });

  it("gives CRUD and GET the default timeout", () => {
    expect(timeoutForAction("save")).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutForAction(undefined)).toBe(DEFAULT_TIMEOUT_MS);
  });
});

describe("createPollGate", () => {
  const opts = { baseBackoffMs: 5_000, maxBackoffMs: 60_000, hiddenMinIntervalMs: 30_000 };

  it("skips a tick while the previous one is in flight", () => {
    const gate = createPollGate(opts);
    expect(gate.tryEnter(0, false)).toBe(true);
    expect(gate.tryEnter(5_000, false)).toBe(false);
    gate.leave(6_000, true);
    expect(gate.tryEnter(10_000, false)).toBe(true);
  });

  it("backs off exponentially on consecutive failures and resets on success", () => {
    const gate = createPollGate(opts);
    gate.tryEnter(0, false);
    gate.leave(0, false);
    expect(gate.tryEnter(4_999, false)).toBe(false);
    expect(gate.tryEnter(5_000, false)).toBe(true);
    gate.leave(5_000, false);
    expect(gate.tryEnter(14_999, false)).toBe(false);
    expect(gate.tryEnter(15_000, false)).toBe(true);
    gate.leave(15_000, true);
    expect(gate.failures).toBe(0);
    expect(gate.tryEnter(15_001, false)).toBe(true);
  });

  it("caps the backoff", () => {
    const gate = createPollGate(opts);
    for (let i = 0; i < 10; i++) {
      gate.tryEnter(Number.MAX_SAFE_INTEGER / 2, false);
      gate.leave(0, false);
    }
    expect(gate.tryEnter(60_000, false)).toBe(true);
  });

  it("throttles ticks while the tab is hidden", () => {
    const gate = createPollGate(opts);
    expect(gate.tryEnter(0, true)).toBe(true);
    gate.leave(1_000, true);
    expect(gate.tryEnter(5_000, true)).toBe(false);
    expect(gate.tryEnter(5_000, false)).toBe(true);
    gate.leave(6_000, true);
    expect(gate.tryEnter(36_000, true)).toBe(true);
  });
});
