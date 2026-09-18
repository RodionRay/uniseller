import {
  readEnv,
  safeRelativeReturnPath,
  sessionCookieOptions,
} from "@/lib/auth";

export type OAuthProvider = "google" | "yandex" | "vk";

const STATE_COOKIE = "unilab_oauth";

export function oauthEnabled(provider: OAuthProvider): boolean {
  const prefix =
    provider === "google"
      ? "GOOGLE"
      : provider === "yandex"
        ? "YANDEX"
        : "VK";
  return Boolean(readEnv(`${prefix}_CLIENT_ID`) && readEnv(`${prefix}_CLIENT_SECRET`));
}

export function telegramEnabled(): boolean {
  return Boolean(readEnv("TELEGRAM_BOT_TOKEN") && readEnv("TELEGRAM_BOT_USERNAME"));
}

export function authProviders() {
  return {
    google: oauthEnabled("google"),
    yandex: oauthEnabled("yandex"),
    vk: oauthEnabled("vk"),
    telegram: telegramEnabled(),
    telegramBot: readEnv("TELEGRAM_BOT_USERNAME") || "",
  };
}

function client(provider: OAuthProvider) {
  const prefix =
    provider === "google"
      ? "GOOGLE"
      : provider === "yandex"
        ? "YANDEX"
        : "VK";
  return {
    id: readEnv(`${prefix}_CLIENT_ID`) || "",
    secret: readEnv(`${prefix}_CLIENT_SECRET`) || "",
  };
}

export function oauthCallbackUrl(origin: string, provider: OAuthProvider) {
  return `${origin}/api/auth/${provider}/callback`;
}

export function oauthAuthorizeUrl(
  origin: string,
  provider: OAuthProvider,
  state: string,
) {
  const { id } = client(provider);
  const redirect = oauthCallbackUrl(origin, provider);
  if (provider === "google") {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", id);
    u.searchParams.set("redirect_uri", redirect);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "openid email profile");
    u.searchParams.set("state", state);
    return u.toString();
  }
  if (provider === "yandex") {
    const u = new URL("https://oauth.yandex.ru/authorize");
    u.searchParams.set("client_id", id);
    u.searchParams.set("redirect_uri", redirect);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("state", state);
    return u.toString();
  }
  const u = new URL("https://oauth.vk.com/authorize");
  u.searchParams.set("client_id", id);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "email");
  u.searchParams.set("v", "5.199");
  u.searchParams.set("state", state);
  return u.toString();
}

export function oauthStateCookie(value: string, maxAge = 600) {
  return {
    name: STATE_COOKIE,
    value,
    options: {
      ...sessionCookieOptions(maxAge),
      sameSite: "lax" as const,
    },
  };
}

export function parseOAuthState(
  raw: string | undefined,
  expected: string | null,
): { provider: string; returnTo: string } | null {
  if (!raw || !expected) return null;
  try {
    const data = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as { s?: string; p?: string; r?: string };
    if (data.s !== expected) return null;
    if (!data.p) return null;
    return {
      provider: data.p,
      returnTo: safeRelativeReturnPath(data.r || "/app"),
    };
  } catch {
    return null;
  }
}

export function makeOAuthState(provider: string, returnTo: string) {
  const s = crypto.randomUUID();
  const packed = Buffer.from(
    JSON.stringify({
      s,
      p: provider,
      r: safeRelativeReturnPath(returnTo),
    }),
    "utf8",
  ).toString("base64url");
  return { s, packed };
}

export type OAuthProfile = {
  providerUserId: string;
  email: string | null;
  name: string;
};

export async function exchangeOAuthCode(
  origin: string,
  provider: OAuthProvider,
  code: string,
): Promise<OAuthProfile> {
  const { id, secret } = client(provider);
  const redirect = oauthCallbackUrl(origin, provider);
  if (provider === "google") {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: id,
        client_secret: secret,
        redirect_uri: redirect,
        grant_type: "authorization_code",
      }),
    });
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) throw new Error("Google не выдал токен");
    const meRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const me = (await meRes.json()) as {
      sub?: string;
      email?: string;
      name?: string;
    };
    if (!me.sub) throw new Error("Google не вернул профиль");
    return {
      providerUserId: me.sub,
      email: me.email || null,
      name: me.name || me.email || "Google",
    };
  }
  if (provider === "yandex") {
    const tokenRes = await fetch("https://oauth.yandex.ru/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: id,
        client_secret: secret,
        grant_type: "authorization_code",
      }),
    });
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) throw new Error("Яндекс не выдал токен");
    const meRes = await fetch("https://login.yandex.ru/info?format=json", {
      headers: { Authorization: `OAuth ${token.access_token}` },
    });
    const me = (await meRes.json()) as {
      id?: string;
      default_email?: string;
      display_name?: string;
      real_name?: string;
    };
    if (!me.id) throw new Error("Яндекс не вернул профиль");
    return {
      providerUserId: String(me.id),
      email: me.default_email || null,
      name: me.real_name || me.display_name || me.default_email || "Яндекс",
    };
  }
  const tokenUrl = new URL("https://oauth.vk.com/access_token");
  tokenUrl.searchParams.set("client_id", id);
  tokenUrl.searchParams.set("client_secret", secret);
  tokenUrl.searchParams.set("redirect_uri", redirect);
  tokenUrl.searchParams.set("code", code);
  const tokenRes = await fetch(tokenUrl);
  const token = (await tokenRes.json()) as {
    access_token?: string;
    user_id?: number;
    email?: string;
  };
  if (!token.access_token || !token.user_id)
    throw new Error("VK не выдал токен");
  const api = new URL("https://api.vk.com/method/users.get");
  api.searchParams.set("user_ids", String(token.user_id));
  api.searchParams.set("access_token", token.access_token);
  api.searchParams.set("v", "5.199");
  const meRes = await fetch(api);
  const me = (await meRes.json()) as {
    response?: { id: number; first_name?: string; last_name?: string }[];
  };
  const person = me.response?.[0];
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ");
  return {
    providerUserId: String(token.user_id),
    email: token.email || null,
    name: name || `VK ${token.user_id}`,
  };
}

export async function verifyTelegramAuth(
  data: Record<string, string>,
): Promise<{ id: string; name: string }> {
  const token = readEnv("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram Login не настроен");
  const hash = data.hash;
  if (!hash) throw new Error("Нет подписи Telegram");
  const check = Object.keys(data)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");
  const secretKey = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    secretKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(check),
  );
  const hex = Buffer.from(mac).toString("hex");
  if (hex !== hash) throw new Error("Неверная подпись Telegram");
  const authDate = Number(data.auth_date || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) {
    throw new Error("Сессия Telegram устарела");
  }
  const name =
    [data.first_name, data.last_name].filter(Boolean).join(" ") ||
    data.username ||
    "Telegram";
  return { id: data.id, name };
}
