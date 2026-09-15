import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type SessionUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

const COOKIE_NAME = "uniseller_session";
const ADMIN_USER_ID = "admin";
const LOGIN_PATH = "/login";
const LOGOUT_PATH = "/logout";
const SESSION_TTL_SEC = 60 * 60 * 24 * 14;
const PBKDF2_ITERATIONS = 210_000;

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return verifySessionToken(raw);
}

export async function requireUser(returnTo: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (user) return user;
  redirect(loginPath(returnTo));
}

export function loginPath(returnTo = "/"): string {
  return `${LOGIN_PATH}?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function logoutPath(returnTo = "/"): string {
  return `${LOGOUT_PATH}?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function sessionCookieName(): string {
  return COOKIE_NAME;
}

export function sessionCookieOptions(maxAge = SESSION_TTL_SEC) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function createSessionToken(email: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = Buffer.from(
    JSON.stringify({ sub: ADMIN_USER_ID, email, exp }),
    "utf8",
  ).toString("base64url");
  const sig = await sign(payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(
  token: string,
): Promise<SessionUser | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await sign(payload);
  if (!timingSafeEqual(sig, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: string;
      email?: string;
      exp?: number;
    };
    if (data.sub !== ADMIN_USER_ID || typeof data.email !== "string") return null;
    if (typeof data.exp !== "number" || data.exp * 1000 < Date.now()) return null;
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if (!adminEmail || data.email.toLowerCase() !== adminEmail) return null;
    return {
      userId: ADMIN_USER_ID,
      email: data.email,
      displayName: data.email,
      fullName: null,
    };
  } catch {
    return null;
  }
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const email = process.env.ADMIN_EMAIL?.trim();
  const hash = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (!email || !hash || !password) return false;
  return verifyPasswordHash(password, hash);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  return [
    "pbkdf2",
    String(PBKDF2_ITERATIONS),
    Buffer.from(salt).toString("base64url"),
    Buffer.from(derived).toString("base64url"),
  ].join("$");
}

export async function verifyPasswordHash(
  password: string,
  stored: string,
): Promise<boolean> {
  const [algo, iterRaw, saltB64, hashB64] = stored.split("$");
  if (algo !== "pbkdf2" || !iterRaw || !saltB64 || !hashB64) return false;
  const iterations = Number(iterRaw);
  if (!Number.isFinite(iterations) || iterations < 100_000) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(hashB64, "base64url");
  const actual = Buffer.from(await deriveKey(password, salt, iterations));
  if (expected.length !== actual.length) return false;
  return timingSafeEqualBytes(expected, actual);
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://app.local");
    if (url.origin !== "https://app.local") return "/";
    if (
      url.pathname === LOGIN_PATH ||
      url.pathname === LOGOUT_PATH ||
      url.pathname === "/signin-with-chatgpt" ||
      url.pathname === "/signout-with-chatgpt" ||
      url.pathname === "/callback"
    ) {
      return "/";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

async function sign(payload: string): Promise<string> {
  const key = await sessionKey();
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return Buffer.from(mac).toString("base64url");
}

async function sessionKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET не настроен (минимум 32 символа)");
  }
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function deriveKey(
  password: string,
  salt: Buffer | Uint8Array,
  iterations: number,
): Promise<ArrayBuffer> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    256,
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqualBytes(
    Buffer.from(a, "utf8"),
    Buffer.from(b, "utf8"),
  );
}

function timingSafeEqualBytes(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i]! ^ b[i]!;
  return out === 0;
}
