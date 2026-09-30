/**
 * Seller-question gate: a question or soft ask about marketplace operations is a lead candidate
 * even without a plus keyword ("как вы грузите остатки на три кабинета?"). A question without a
 * seller-topic word is not. Mirrors telegram-worker/src/check_account.py::is_seller_question;
 * vocabulary and cases are shared through tests/fixtures/lead-question-gate.json.
 */

/** Ask verbs matched as a word-start stem (подскажите / подскажи). */
export const QUESTION_STEMS = ["подскаж", "посоветуй", "порекомендуй"] as const;

/** Question words and phrases matched as whole words ("как вы" must not hit "как вывести"). */
export const QUESTION_WORDS = [
  "кто-нибудь", "кто нибудь", "кто знает", "кто в курсе", "кто пользуется", "кто пользовался",
  "кто сталкивался", "кто работает", "кто работал", "у кого есть", "у кого-нибудь", "у кого-то",
  "может кто", "может кто-то", "как вы", "как у вас", "чем вы", "где взять", "где найти", "есть ли",
  "как правильно", "как лучше", "какой", "какая", "какое", "какие", "какую", "каким", "какими",
] as const;

/** Marketplace / seller-ops stems matched at a word start. */
export const TOPIC_STEMS = [
  "wildberries", "вайлдберр", "ozon", "озон", "яндекс маркет", "яндекс.маркет", "маркетплейс",
  "мегамаркет", "селлер", "кабинет", "остатк", "остаток", "поставк", "заказ", "отзыв", "карточк",
  "артикул", "мойсклад", "мой склад", "выгрузк", "выгруж", "синхрониз", "интеграц", "учет",
  "ценообраз", "ценник", "складск", "фулфилмент",
] as const;

/** Short or ambiguous topic words matched as whole words ("цен" must not hit "центр"). */
export const TOPIC_WORDS = [
  "wb", "вб", "1с", "1c", "api", "апи", "fbs", "fbo", "rfbs", "фбс", "фбо", "рфбс", "crm", "срм", "лк",
  "склад", "склада", "складе", "складу", "складом", "склады", "складов", "складам", "складами", "складах",
  "цен", "цена", "цены", "цену", "цене", "ценой", "ценам", "ценами", "ценах",
] as const;

type Term = { term: string; re: RegExp };

function escapeTerm(term: string): string {
  return term
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
}

function compileTerms(stems: readonly string[], words: readonly string[]): Term[] {
  const start = "(?<![\\p{L}\\p{N}])";
  return [
    ...stems.map((term) => ({ term, re: new RegExp(`${start}${escapeTerm(term)}`, "u") })),
    ...words.map((term) => ({
      term,
      re: new RegExp(`${start}${escapeTerm(term)}(?![\\p{L}\\p{N}-])`, "u"),
    })),
  ];
}

const QUESTION_TERMS = compileTerms(QUESTION_STEMS, QUESTION_WORDS);
const TOPIC_TERMS = compileTerms(TOPIC_STEMS, TOPIC_WORDS);

function normalize(text: string): string {
  return String(text || "").toLowerCase().replace(/ё/g, "е");
}

/** A question mark or a question / soft-ask marker. */
export function hasQuestion(text: string): boolean {
  const body = normalize(text);
  return /[?？]/.test(body) || QUESTION_TERMS.some((t) => t.re.test(body));
}

/** Seller-topic terms found in the text, in vocabulary order (stems first, then words). */
export function sellerTopicHits(text: string): string[] {
  const body = normalize(text);
  return TOPIC_TERMS.filter((t) => t.re.test(body)).map((t) => t.term);
}

/**
 * Marketplace names and fulfilment schemes: they say where the seller works, not what the question
 * is about, so the core does not count them as topic evidence (the worker gate still does).
 */
const MARKETPLACE_CONTEXT_TERMS: ReadonlySet<string> = new Set([
  "wildberries", "вайлдберр", "ozon", "озон", "яндекс маркет", "яндекс.маркет", "маркетплейс",
  "мегамаркет", "селлер", "wb", "вб", "fbs", "fbo", "rfbs", "фбс", "фбо", "рфбс", "лк",
]);

/** Seller-topic hits that name an operation (остатки, кабинеты, 1С, цены), not a marketplace. */
export function sellerOpsTopicHits(text: string): string[] {
  return sellerTopicHits(text).filter((t) => !MARKETPLACE_CONTEXT_TERMS.has(t));
}

export function isSellerQuestion(text: string): boolean {
  return hasQuestion(text) && sellerTopicHits(text).length > 0;
}
