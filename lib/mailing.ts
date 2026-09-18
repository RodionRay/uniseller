/** Типы и хелперы модуля «Рассылка» (ЛС / reply в чат). */

import type { TaskLogEntry } from "@/lib/audience-invite";

export const MAILING_TASK_STATUSES = [
  "draft",
  "scheduled",
  "running",
  "paused",
  "completed",
  "error",
] as const;
export type MailingTaskStatus = (typeof MAILING_TASK_STATUSES)[number];

export const MAILING_STATUS_LABELS: Record<MailingTaskStatus, string> = {
  draft: "Черновик",
  scheduled: "Запланирован",
  running: "В работе",
  paused: "Остановлен",
  completed: "Завершён",
  error: "Ошибка",
};

export const MAILING_SOURCE_KINDS = ["audience", "leads"] as const;
export type MailingSourceKind = (typeof MAILING_SOURCE_KINDS)[number];

export const MAILING_SOURCE_LABELS: Record<MailingSourceKind, string> = {
  audience: "База аудитории",
  leads: "Лиды",
};

export const MAILING_CONTENT_MODES = ["template", "ai"] as const;
export type MailingContentMode = (typeof MAILING_CONTENT_MODES)[number];

export const MAILING_CONTENT_LABELS: Record<MailingContentMode, string> = {
  template: "Текст / Spintax",
  ai: "AI-генерация",
};

export const MAILING_DELIVERY_MODES = ["dm", "chat"] as const;
export type MailingDeliveryMode = (typeof MAILING_DELIVERY_MODES)[number];

export const MAILING_LEAD_FILTERS = ["all", "hot", "warm", "hot_warm"] as const;
export type MailingLeadFilter = (typeof MAILING_LEAD_FILTERS)[number];

export const MAILING_LEAD_FILTER_LABELS: Record<MailingLeadFilter, string> = {
  all: "Все лиды",
  hot: "Только горячие",
  warm: "Только тёплые",
  hot_warm: "Горячие и тёплые",
};

export type MailingDelivery = {
  at: string;
  key: string;
  userId: string;
  username: string;
  leadId: string;
  accountId: string;
  ok: boolean;
  error: string;
  messageId: string;
  chatId: string;
  link: string;
  textPreview: string;
  mode: MailingDeliveryMode;
};

/** Раскрытие Spintax: {привет|здравствуйте} → случайный вариант. Вложенность до 8 уровней. */
export function resolveSpintax(input: string, depth = 0): string {
  if (depth > 8) return String(input || "");
  let s = String(input || "");
  const re = /\{([^{}]+)\}/;
  let guard = 0;
  while (re.test(s) && guard < 80) {
    guard++;
    s = s.replace(re, (_, inner: string) => {
      const parts = String(inner).split("|");
      if (!parts.length) return "";
      return parts[Math.floor(Math.random() * parts.length)] || "";
    });
  }
  if (/\{[^{}]+\}/.test(s)) return resolveSpintax(s, depth + 1);
  return s.trim();
}

export function normalizeMailText(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function recipientKey(opts: {
  sourceKind: MailingSourceKind;
  userId?: string;
  username?: string;
  leadId?: string;
}): string {
  if (opts.sourceKind === "leads" && opts.leadId) return `lead:${opts.leadId}`;
  if (opts.userId) return `u:${opts.userId}`;
  if (opts.username) return `un:${opts.username.toLowerCase().replace(/^@/, "")}`;
  if (opts.leadId) return `lead:${opts.leadId}`;
  return "";
}

export function pushMailingDelivery(
  list: MailingDelivery[] | undefined,
  entry: MailingDelivery,
  max = 2000,
): MailingDelivery[] {
  return [...(list || []), entry].slice(-max);
}

export const DEFAULT_DM_SOFT_CLOSE =
  "Если предложение не подошло — коротко извинись за беспокойство и мягко попроси не мутить и не банить аккаунт: можно просто не отвечать. Без давления.";

export const DEFAULT_MAILING_TASK = {
  name: "",
  sourceKind: "audience" as MailingSourceKind,
  audienceTaskId: "",
  leadFilter: "hot_warm" as MailingLeadFilter,
  contentMode: "ai" as MailingContentMode,
  templateText: "",
  deliveryMode: "dm" as MailingDeliveryMode,
  accountIds: [] as string[],
  silent: false,
  deleteDialogAfter: false,
  /** Только для ЛС + AI: инструкция «не мутить / извиниться за беспокойство» */
  dmSoftCloseEnabled: true,
  dmSoftClose: DEFAULT_DM_SOFT_CLOSE,
  batchPerTick: 1,
  dailyLimitEnabled: true,
  dailyLimit: 200,
  stopDisconnectedPct: 30,
  pauseFromSec: 45,
  pauseToSec: 90,
  pauseBetweenAccounts: true,
  autoStart: true,
  status: "draft" as MailingTaskStatus,
  sentTotal: 0,
  sentToday: 0,
  failed: 0,
  total: 0,
  sendDay: "",
  nextAt: "",
  accountIndex: 0,
  cursor: "",
  aiPool: [] as string[],
  aiPoolUsed: 0,
  deliveredKeys: [] as string[],
  deferredUntil: {} as Record<string, string>,
  deliveries: [] as MailingDelivery[],
  error: "",
  log: [] as TaskLogEntry[],
  lastTickAt: "",
  tickLockUntil: "",
};

export function mailingOkText(username: string, userId: string, link: string): string {
  const label = username
    ? `@${username.replace(/^@/, "")}`
    : userId
      ? `id${userId}`
      : "получатель";
  if (link) return `Доставлено ${label} · ${link}`;
  return `Доставлено ${label}`;
}

export function mailingFailText(username: string, userId: string, error: string): string {
  const label = username
    ? `@${username.replace(/^@/, "")}`
    : userId
      ? `id${userId}`
      : "получатель";
  const e = String(error || "").toLowerCase();
  if (e.includes("privacy") || e.includes("ограничил")) {
    return `${label}: запретил личные сообщения`;
  }
  if (e.includes("flood") || e.includes("too many requests")) {
    return `${label}: лимит Telegram (Too many requests)`;
  }
  if (
    e.includes("no user has") ||
    e.includes("username_not_occupied") ||
    e.includes("username_invalid") ||
    e.includes("nobody is using this username")
  ) {
    return `${label}: username не существует`;
  }
  return `Ошибка ${label}: ${String(error || "fail").slice(0, 100)}`;
}

/** Flood / Too many requests — отлёжка аккаунта + отложить получателя. */
export function isRateLimitMailingError(error: string): boolean {
  const e = String(error || "").toLowerCase();
  return (
    e.includes("too many requests") ||
    e.includes("floodwait") ||
    e.includes("flood_wait") ||
    e.includes("flood") ||
    e.includes("slowmode") ||
    /\bwait\s*\d+\s*s/.test(e)
  );
}

/** Секунды паузы из текста ошибки или дефолт. */
export function parseMailingFloodWaitSec(error: string, fallback = 900): number {
  const raw = String(error || "");
  const m =
    raw.match(/FloodWait\s*(\d+)/i) ||
    raw.match(/wait[_\s]*(\d+)\s*s/i) ||
    raw.match(/(\d+)\s*seconds?/i) ||
    raw.match(/A wait of (\d+)/i);
  const n = m ? Number(m[1]) : NaN;
  if (Number.isFinite(n) && n > 0) return Math.max(60, Math.min(86_400, Math.floor(n)));
  if (/too many requests/i.test(raw)) return Math.max(fallback, 600);
  return Math.max(60, fallback);
}

/** Ошибка получателя, которую бессмысленно ретраить на других аккаунтах. */
export function isPermanentMailingRecipientError(error: string): boolean {
  const e = String(error || "").toLowerCase();
  return (
    e.includes("privacy") ||
    e.includes("ограничил") ||
    e.includes("запретил") ||
    e.includes("username_not_occupied") ||
    e.includes("username_invalid") ||
    e.includes("no user has") ||
    e.includes("nobody is using this username") ||
    e.includes("user_deactivated") ||
    e.includes("input_user_deactivated") ||
    e.includes("peer_id_invalid") ||
    e.includes("could not find the input entity") ||
    e.includes("cannot find any entity") ||
    e.includes("no such user") ||
    e.includes("user not found")
  );
}

/** Сессия/tdata мёртвая — аккаунт надо снять с фермы, а не крутить того же получателя. */
export function isDeadAccountMailingError(error: string): boolean {
  const e = String(error || "").toLowerCase();
  return (
    e.includes("tdesktopunauthorized") ||
    e.includes("auth_key") ||
    e.includes("session password needed") ||
    e.includes("unauthorized") ||
    e.includes("user_deactivated_ban") ||
    e.includes("session_revoked") ||
    e.includes("auth_key_unregistered")
  );
}
