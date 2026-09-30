import { vi } from "vitest";
import { ALL_CRM_ACCESS, accessForRole, type WorkspaceContext } from "@/lib/staff-types";
import { createD1Fake, insertRecord, type FakeD1 } from "./d1-fake";
import type Database from "better-sqlite3";

/** Shared mutable state the vi.mock factories read (hoisted mocks cannot close over locals). */
export const harness: {
  db: FakeD1 | null;
  sqlite: Database.Database | null;
  ctx: WorkspaceContext | Error;
  userId: string | null;
} = { db: null, sqlite: null, ctx: new Error("unset"), userId: null };

export const OWNER = "owner-1";

export function ownerContext(): WorkspaceContext {
  return { userId: OWNER, ownerId: OWNER, isOwner: true, role: "owner", access: ALL_CRM_ACCESS };
}

export function staffContext(access: Partial<typeof ALL_CRM_ACCESS>): WorkspaceContext {
  return {
    userId: "staff-1",
    ownerId: OWNER,
    isOwner: false,
    role: "operator",
    access: { ...accessForRole("viewer"), ...access },
  };
}

export function resetHarness(latencyMs = 0): Database.Database {
  const { db, sqlite } = createD1Fake({ latencyMs });
  harness.db = db;
  harness.sqlite = sqlite;
  harness.ctx = ownerContext();
  harness.userId = OWNER;
  return sqlite;
}

/** Test seal: reversible, bound to the owner like the real AAD. */
export const fakeSeal = async (value: string, owner: string) => `sealed:${owner}:${value}`;
export const fakeUnseal = async (value: string, owner: string) => {
  const prefix = `sealed:${owner}:`;
  if (!value.startsWith(prefix)) throw new Error("bad seal");
  return value.slice(prefix.length);
};

export const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

export async function seedAccount(
  sqlite: Database.Database,
  id = ACCOUNT_ID,
  data: Record<string, unknown> = {},
): Promise<void> {
  insertRecord(sqlite, {
    id,
    owner: OWNER,
    kind: "account",
    data: {
      name: "Acc",
      phone: "+79990000000",
      status: "active",
      limits: { invite: 40, message: 40, chat: 40, memberInvite: 40 },
      ...data,
    },
    secret: await fakeSeal(
      JSON.stringify({ kind: "tdata", zipBase64: "ZIP", apiId: 1, apiHash: "h" }),
      OWNER,
    ),
  });
}

export function post(body: unknown): Request {
  return new Request("http://localhost/api/workspace", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

type WorkerHandler = (path: string, body: Record<string, unknown>) => Promise<unknown> | unknown;

/** Routes fetch() to the fake Telegram worker; records every call path. */
export function mockWorker(handler: WorkerHandler): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.pathname === "/health") return Response.json({ ok: true });
      calls.push(url.pathname);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      return Response.json(await handler(url.pathname, body));
    }),
  );
  return calls;
}

export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
