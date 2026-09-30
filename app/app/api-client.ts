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
/** Worker/AI-backed actions: the server waits up to 120 s per worker call, plus DB work around it. */
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

export function timeoutForAction(action: unknown): number {
  return typeof action === 'string' && LONG_ACTIONS.has(action) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

function statusMessage(status: number): string {
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
    throw new ApiError(serverMessage || statusMessage(res.status), 'http', res.status, data ?? {});
  }
  if (data === null) {
    throw new ApiError('Сервер вернул некорректный ответ — повторите через минуту', 'parse', res.status);
  }
  return data as T;
}
