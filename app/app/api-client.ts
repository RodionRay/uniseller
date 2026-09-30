/**
 * Client-side JSON transport for the cabinet.
 * Why: a proxy 502/504 returns HTML, and a hung worker call never resolves — both used to crash
 * or freeze the UI. Every failure here becomes an ApiError whose message is safe to show in a toast.
 */

export type ApiErrorKind = 'http' | 'timeout' | 'network' | 'parse';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status; 0 when the request never got a response. */
  readonly status: number;
  readonly data: Record<string, unknown>;

  constructor(message: string, kind: ApiErrorKind, status = 0, data: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.data = data;
  }
}

export const DEFAULT_TIMEOUT_MS = 30_000;
/** Worker/AI-backed actions: the server waits up to 130 s per worker call, plus DB work around it. */
export const LONG_TIMEOUT_MS = 150_000;

const LONG_ACTIONS = new Set([
  'draft',
  'check_proxy',
  'check_proxies',
  'check_account',
  'check_accounts',
  'generate_account_about',
  'apply_account_profiles',
  'upload_account_photos',
  'join_group',
  'scan_group',
  'rebuild_product',
  'train_from_hot',
  'train_from_ignored',
  'reject_lead_stopwords',
  'send_lead_message',
  'rescan_groups',
  'import_catalog',
  'enqueue_joins',
  'preview_lead_core',
  'test_notify',
  'tick_audience',
  'tick_invite',
  'tick_mailing',
  'refill_mailing_ai_pool',
  'poll_dm_replies',
  'export_audience',
]);

/**
 * Actions whose single worker call may take 180 s (invite, collect, photo upload) plus the app margin;
 * mirrors lib/processes/worker-timeouts.ts. The server stops starting new calls after its tick budget.
 */
export const SLOW_WORKER_TIMEOUT_MS = 200_000;
const SLOW_WORKER_ACTIONS = new Set(['tick_invite', 'tick_audience', 'upload_account_photos']);

/** poll_dm_replies: server budget is up to 90 s per call (2 accounts max). */
export const POLL_DM_TIMEOUT_MS = 100_000;

export function timeoutForAction(action: unknown): number {
  if (action === 'poll_dm_replies') return POLL_DM_TIMEOUT_MS;
  if (typeof action === 'string' && SLOW_WORKER_ACTIONS.has(action)) return SLOW_WORKER_TIMEOUT_MS;
  return typeof action === 'string' && LONG_ACTIONS.has(action) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * "Busy, try later" contract of the workspace API: a 2xx payload with `busy: true`,
 * or a 409/429 error (account lease, pace, flood). Returns the suggested wait or null.
 */
export function busyWaitSec(source: unknown): number | null {
  if (source instanceof ApiError) {
    const busy = source.data.busy === true || source.status === 409 || source.status === 429;
    return busy ? Math.max(0, Number(source.data.waitSec) || 0) : null;
  }
  const data = asRecord(source);
  if (!data || data.busy !== true) return null;
  return Math.max(0, Number(data.waitSec) || 0);
}

export function isForbidden(e: unknown): boolean {
  return e instanceof ApiError && e.status === 403;
}

/** Human wait label: "30 с" / "2 мин"; empty wait → "немного". */
export function waitLabel(sec: number): string {
  if (!sec) return 'немного';
  return sec < 60 ? `${Math.ceil(sec)} с` : `${Math.ceil(sec / 60)} мин`;
}

function statusMessage(status: number, data: Record<string, unknown>): string {
  const wait = Number(data.waitSec) || 0;
  if (data.busy === true || ((status === 409 || status === 429) && wait > 0)) {
    return `Аккаунт занят — повторите через ${waitLabel(wait)}`;
  }
  if (status === 409) return 'Операция уже выполняется — попробуйте чуть позже';
  if (status === 429) return 'Слишком много запросов — подождите немного';
  if (status === 401) return 'Сессия истекла — войдите снова';
  if (status === 403) return 'Недостаточно прав для этого действия';
  if (status >= 500) return `Сервер временно недоступен (${status}) — повторите через минуту`;
  return `Ошибка запроса (${status})`;
}

function parseBody(text: string): Record<string, unknown> | null {
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return null;
  }
}

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

export type RequestJsonOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/** fetch + safe JSON parse + timeout. Resolves only on 2xx with a JSON (or empty) body. */
export async function requestJson<T = Record<string, unknown>>(
  url: string,
  init: RequestInit = {},
  { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch }: RequestJsonOptions = {},
): Promise<T> {
  let res: Response;
  let text: string;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    text = await res.text();
  } catch (e) {
    if (isTimeout(e)) {
      throw new ApiError(`Сервер не ответил за ${Math.round(timeoutMs / 1000)} с — проверьте результат и повторите`, 'timeout');
    }
    throw new ApiError('Нет связи с сервером — проверьте интернет и повторите', 'network');
  }
  const data = parseBody(text);
  if (!res.ok) {
    const serverMessage = data && typeof data.error === 'string' && data.error ? data.error : '';
    throw new ApiError(serverMessage || statusMessage(res.status, data ?? {}), 'http', res.status, data ?? {});
  }
  if (data === null) {
    throw new ApiError('Сервер вернул некорректный ответ — повторите через минуту', 'parse', res.status);
  }
  return data as T;
}
