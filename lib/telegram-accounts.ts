/** Модель аккаунтов/прокси по паттерну TGLab (docs.tglab.pro). */

export const ACCOUNT_STATUSES = [
  "setup",
  "checking",
  "active",
  "proxy_error",
  "disconnected",
  "unauthorized",
  "spamblock",
  "frozen",
  "cooldown",
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  setup: "Требует подключения",
  checking: "Проверяется",
  active: "Активный",
  proxy_error: "Ошибка прокси",
  disconnected: "Не подключен",
  unauthorized: "Не авторизован",
  spamblock: "Спамблок",
  frozen: "Заморожен",
  cooldown: "Отлежка",
};

export const PROXY_STATUSES = ["checking", "active", "inactive"] as const;
export type ProxyStatus = (typeof PROXY_STATUSES)[number];

export const PROXY_STATUS_LABELS: Record<ProxyStatus, string> = {
  checking: "Проверяется",
  active: "Активный",
  inactive: "Неактивный",
};

export type AccountLimits = {
  invite: number;
  message: number;
  chat: number;
};

export const DEFAULT_ACCOUNT_LIMITS: AccountLimits = {
  invite: 10,
  message: 10,
  chat: 10,
};

/**
 * Мягкие суточные лимиты под Telegram API / антиспам (как в TGLab и практике ферм).
 * Не официальная квота Bot API — ориентир для user-сессий.
 */
export const TELEGRAM_RECOMMENDED_LIMITS = {
  invite: 40,
  message: 40,
  chat: 20,
  memberInvite: 40,
} as const;

export type AccountFormat = "tdata" | "session" | "session_json" | "manual";
export type SessionMode = "keep" | "new";

export function accountStatusTone(status: string): "success" | "warning" | "danger" | "neutral" | "default" {
  if (status === "active") return "success";
  if (status === "setup" || status === "checking" || status === "cooldown") return "warning";
  if (
    status === "proxy_error" ||
    status === "disconnected" ||
    status === "unauthorized" ||
    status === "spamblock" ||
    status === "frozen" ||
    status === "inactive"
  ) {
    return "danger";
  }
  return "neutral";
}

export function isOnCooldown(cooldownUntil?: string | null): boolean {
  if (!cooldownUntil) return false;
  const t = Date.parse(cooldownUntil);
  return Number.isFinite(t) && t > Date.now();
}

/** Можно ли ставить в работу (рассылка / инвайт / сбор / группы). */
export function isAccountUsable(data: {
  status?: string | null;
  cooldownUntil?: string | null;
} | null | undefined): boolean {
  if (!data) return false;
  if (isOnCooldown(data.cooldownUntil)) return false;
  const st = String(data.status || "");
  // status=cooldown без актуального until — отлёжка уже прошла, слот снова живой
  if (st === "cooldown") return true;
  if (
    [
      "spamblock",
      "frozen",
      "unauthorized",
      "disconnected",
      "proxy_error",
      "checking",
      "setup",
      "inactive",
      "error",
    ].includes(st)
  ) {
    return false;
  }
  // active / пустой / legacy ok|connected
  return !st || st === "active" || st === "ok" || st === "connected";
}

export function cooldownLabel(cooldownUntil?: string | null): string {
  if (!isOnCooldown(cooldownUntil)) return "";
  return `до ${new Date(cooldownUntil!).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`;
}

/** Авто-отлежка на N часов (как TGLab: лимит / PEER_FLOOD → 24ч). */
export function cooldownHoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

/** Пауза между вступлениями в группы (антибан). */
export const JOIN_GAP_MIN_SEC = 180; // 3 мин
export const JOIN_GAP_MAX_SEC = 420; // 7 мин
export const JOIN_GAP_DEFAULT_SEC = 240; // 4 мин

export function moscowDayKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Следующая полночь по Москве — когда сбрасываются дневные лимиты. */
export function moscowNextMidnightIso(now = Date.now()): string {
  const mskHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  const mskMin = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow",
      minute: "numeric",
    }).format(now),
  );
  const minsLeft = 24 * 60 - (mskHour * 60 + mskMin) + 1;
  return new Date(now + minsLeft * 60 * 1000).toISOString();
}

function dayCounter(
  dayKey: string | undefined,
  count: number | undefined,
): number {
  if (dayKey !== moscowDayKey()) return 0;
  return Math.max(0, Number(count) || 0);
}

/** 0 в настройках = без потолка. */
export function hasDayQuota(used: number, limit: unknown): boolean {
  const lim = Number(limit);
  if (!Number.isFinite(lim) || lim <= 0) return true;
  return used < lim;
}

export function hasInviteQuota(data: {
  limits?: { invite?: unknown };
  joinsToday?: number;
  joinsDay?: string;
} | null | undefined): boolean {
  if (!data) return false;
  return hasDayQuota(
    normalizeJoinsToday(data),
    data.limits?.invite ?? DEFAULT_ACCOUNT_LIMITS.invite,
  );
}

export function hasMessageQuota(data: {
  limits?: { message?: unknown };
  messagesToday?: number;
  messagesDay?: string;
} | null | undefined): boolean {
  if (!data) return false;
  return hasDayQuota(
    dayCounter(data.messagesDay, data.messagesToday),
    data.limits?.message ?? DEFAULT_ACCOUNT_LIMITS.message,
  );
}

export function hasMemberInviteQuota(data: {
  limits?: { memberInvite?: unknown };
  memberInvitesToday?: number;
  memberInviteDay?: string;
} | null | undefined): boolean {
  if (!data) return false;
  return hasDayQuota(
    dayCounter(data.memberInviteDay, data.memberInvitesToday),
    data.limits?.memberInvite ?? 40,
  );
}

export function bumpMessageCounters(
  state: { messagesToday?: number; messagesDay?: string },
  add: number,
): { messagesToday: number; messagesDay: string } {
  const day = moscowDayKey();
  const prev = state.messagesDay === day ? Number(state.messagesToday) || 0 : 0;
  return { messagesDay: day, messagesToday: prev + Math.max(0, add) };
}

export function randomJoinGapSec(): number {
  return (
    JOIN_GAP_MIN_SEC +
    Math.floor(Math.random() * (JOIN_GAP_MAX_SEC - JOIN_GAP_MIN_SEC + 1))
  );
}

export type JoinPaceState = {
  lastJoinAt?: string;
  joinsToday?: number;
  joinsDay?: string;
};

/** Сколько секунд ждать до следующего join. 0 = можно сейчас. */
export function joinWaitSec(
  state: JoinPaceState,
  now = Date.now(),
): number {
  if (!state.lastJoinAt) return 0;
  const last = Date.parse(state.lastJoinAt);
  if (!Number.isFinite(last)) return 0;
  const elapsed = (now - last) / 1000;
  const need = JOIN_GAP_DEFAULT_SEC;
  return elapsed >= need ? 0 : Math.ceil(need - elapsed);
}

export function normalizeJoinsToday(state: JoinPaceState): number {
  const day = moscowDayKey();
  if (state.joinsDay !== day) return 0;
  return Math.max(0, Number(state.joinsToday) || 0);
}

export function bumpJoinCounters(state: JoinPaceState): JoinPaceState {
  const day = moscowDayKey();
  const prev = state.joinsDay === day ? Number(state.joinsToday) || 0 : 0;
  return {
    ...state,
    lastJoinAt: new Date().toISOString(),
    joinsDay: day,
    joinsToday: prev + 1,
  };
}

const USERNAME_A = ["nova","mira","lumen","orbit","pixel","cedar","harbor","maple","quark","velvet","cobalt","nimbus","atlas","sierra","echo","zen","fox","oak","iris","sol","river","cloud"];
const USERNAME_B = ["lab","hub","note","desk","path","wave","node","mint","peak","kite","flow","nest","spark","field"];

/** Случайный @username под правила Telegram: 5–32, a-z0-9_, начинается с буквы. */
export function generateTelegramUsername(taken?: Iterable<string>): string {
  const used = new Set(
    [...(taken || [])]
      .map((u) => String(u || "").replace(/^@/, "").trim().toLowerCase())
      .filter(Boolean),
  );
  for (let i = 0; i < 50; i++) {
    const a = USERNAME_A[Math.floor(Math.random() * USERNAME_A.length)]!;
    const b = USERNAME_B[Math.floor(Math.random() * USERNAME_B.length)]!;
    const n = 10 + Math.floor(Math.random() * 990);
    const u = `${a}${b}${n}`;
    if (!used.has(u) && u.length >= 5 && u.length <= 32 && /^[a-z]/.test(u)) return u;
  }
  return `user${Date.now().toString(36)}${Math.floor(Math.random() * 99)}`.slice(0, 32);
}
