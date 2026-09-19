/** Решения по вступлению в группы (чистая логика для тестов и route). */

import { isCatalogPlaceholderUrl } from "@/lib/group-catalog";
import {
  hasInviteQuota,
  isAccountUsable,
  isDayLimitCooldown,
  joinWaitSec,
} from "@/lib/telegram-accounts";

export function sanitizeJoinStateError(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return "";
  return String(v).slice(0, 500);
}

export type JoinBlockReason =
  | "missing_account"
  | "placeholder_url"
  | "cooldown"
  | "spamblock"
  | "frozen"
  | "quota"
  | "pace"
  | "unusable";

export type JoinGateResult =
  | { ok: true }
  | { ok: false; reason: JoinBlockReason; waitSec?: number; message: string };

/** Можно ли сейчас слать join_group для этой пары group+account. */
export function evaluateJoinGate(opts: {
  groupUrl?: string;
  accountId?: string;
  account?: {
    status?: string | null;
    cooldownUntil?: string | null;
    limits?: { invite?: unknown };
    joinsToday?: number;
    joinsDay?: string;
    lastJoinAt?: string;
  } | null;
}): JoinGateResult {
  if (!opts.accountId) {
    return { ok: false, reason: "missing_account", message: "Назначьте аккаунт группе" };
  }
  if (isCatalogPlaceholderUrl(opts.groupUrl || "")) {
    return {
      ok: false,
      reason: "placeholder_url",
      message: "Нужна реальная ссылка t.me/… или инвайт (это шаблон каталога)",
    };
  }
  const acc = opts.account;
  if (!acc) {
    return { ok: false, reason: "unusable", message: "Аккаунт не найден" };
  }
  const st = String(acc.status || "");
  if (st === "spamblock") {
    return { ok: false, reason: "spamblock", message: "Аккаунт в спамблоке" };
  }
  if (st === "frozen") {
    return { ok: false, reason: "frozen", message: "Аккаунт заморожен" };
  }
  if (isDayLimitCooldown(acc) || st === "cooldown") {
    const until = String(acc.cooldownUntil || "");
    const waitSec = until
      ? Math.max(60, Math.ceil((Date.parse(until) - Date.now()) / 1000) || 300)
      : 300;
    return {
      ok: false,
      reason: "cooldown",
      waitSec,
      message: "Аккаунт на отлёжке",
    };
  }
  if (!isAccountUsable(acc)) {
    return { ok: false, reason: "unusable", message: "Аккаунт недоступен" };
  }
  if (!hasInviteQuota(acc)) {
    return { ok: false, reason: "quota", message: "Дневной лимит вступлений исчерпан" };
  }
  const wait = joinWaitSec(acc);
  if (wait > 0) {
    return {
      ok: false,
      reason: "pace",
      waitSec: wait,
      message: `Пауза между вступлениями: ${wait} с`,
    };
  }
  return { ok: true };
}

export type JoinWorkerResult = {
  ok?: boolean;
  join?: string;
  status?: string;
  error?: string;
  title?: string;
  floodWait?: number;
};

export type JoinOutcome =
  | { kind: "joined"; membership: "joined" }
  | { kind: "pending"; membership: "pending" }
  | { kind: "already"; membership: "joined" }
  | { kind: "flood"; waitSec: number; pace: true }
  | { kind: "frozen"; error: string }
  | { kind: "fail"; error: string };

/** Интерпретация ответа worker /join-group. */
export function interpretJoinWorkerResult(result: JoinWorkerResult): JoinOutcome {
  const err = String(result.error || "");
  const frozen =
    result.status === "frozen" ||
    result.join === "frozen" ||
    /FROZEN|заморожен/i.test(err);
  if (frozen) {
    return { kind: "frozen", error: err.slice(0, 500) || "Аккаунт заморожен Telegram" };
  }
  const flood =
    result.join === "flood" ||
    /FloodWait/i.test(err) ||
    Number(result.floodWait) > 0;
  if (flood) {
    const m = /FloodWait\s+(\d+)/i.exec(err);
    const waitSec = Math.max(
      60,
      Number(result.floodWait) || (m ? Number(m[1]) : 0) || 900,
    );
    return { kind: "flood", waitSec, pace: true };
  }
  if (result.join === "already") {
    return { kind: "already", membership: "joined" };
  }
  if (result.join === "requested") {
    return { kind: "pending", membership: "pending" };
  }
  const reallyJoined =
    !!result.ok &&
    result.join !== "requested" &&
    result.join !== "flood" &&
    result.join !== "missing" &&
    result.join !== "frozen";
  if (reallyJoined || result.join === "ok") {
    return { kind: "joined", membership: "joined" };
  }
  return { kind: "fail", error: err.slice(0, 500) || "Не удалось вступить" };
}
