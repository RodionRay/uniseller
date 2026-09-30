/**
 * Guards the lead stop-lists (minusKeywords / avoidTopics) against auto-learning pollution.
 *
 * Auto-learning (train_from_hot / train_from_ignored / reject_lead_stopwords) used to append the
 * product's own vocabulary ("остатков", "озон", "селлер", "нал", "бот" …) to the stop-lists, and
 * every scan then dropped exactly the messages we look for. A minus candidate is rejected here when
 * it is short, generic, marketplace context, or overlaps the positive settings of the assistant.
 *
 * The same filter runs at read time ({@link scanStopTerms}), so it also drops what older auto-learning
 * left behind: everyday chat words ("список", "личку", "пишите"), date fragments ("2026 года") and
 * n-gram shards of rejected messages ("почему решили", "тариф лучше"). What auto-learning may add
 * from now on is narrower still: {@link learnableMinusTerms}.
 */

import {
  MAX_MINUS_TERMS,
  MAX_MINUS_TERM_LENGTH,
  WEAK_PLUS_TERMS,
  normalizeYo,
  splitTerms,
  hasBuyerIntent,
  hasProductFit,
  hasSoftAsk,
} from "@/lib/lead-filter";
import { SUGGESTED_MINUS } from "@/lib/ai-keywords";

export type StopListSettings = {
  keywords?: string;
  hotSignals?: string;
  learnExamples?: string;
  product?: string;
  leadCriteria?: string;
  minusKeywords?: string;
  avoidTopics?: string;
};

export type CleanedStopLists = {
  minusKeywords: string;
  avoidTopics: string;
  removed: string[];
};

const MIN_CANDIDATE_LENGTH = 4;
const MIN_CONTENT_WORD_LENGTH = 3;
const STEM_LENGTH = 5;
const MIN_PROTECTED_TERM_LENGTH = 4;
const MIN_PROTECTED_WORD_LENGTH = 4;
const MIN_DESCRIPTION_WORD_LENGTH = 5;

/**
 * Ask / address / question / function words. A stop-term made only of them ("кто знает",
 * "нужна помощь", "ребят", "кто-нибудь") hits every real request, so it is never a stop signal.
 */
const GENERIC_WORDS = new Set([
  // ask
  "помогите", "помоги", "помощь", "подскажите", "подскажи", "посоветуйте", "посоветуй",
  "нужен", "нужна", "нужно", "нужны", "надо", "ищу", "ищем", "ищет", "скажите", "пожалуйста",
  "спасибо", "вопрос", "может", "можно", "знает", "знаете", "делает", "делаете", "разбирается",
  "пользуется", "пользовался", "пользуетесь", "работает", "есть",
  // address / greeting
  "здравствуйте", "привет", "всем", "добрый", "доброе", "день", "вечер", "утро", "коллеги",
  "ребята", "ребят", "друзья", "народ", "подписчики",
  // question words
  "кто", "что", "как", "где", "когда", "почему", "зачем", "какой", "какая", "какое", "какие",
  "каким", "какую", "чем", "кому", "кого", "куда", "откуда", "сколько", "нибудь", "либо",
  // function words
  "для", "при", "про", "без", "или", "это", "эти", "тут", "там", "уже", "еще", "все", "вот",
  "так", "тоже", "также", "очень", "если", "чтобы", "меня", "мне", "нас", "вас", "вам", "нам",
  // everyday chat vocabulary: present in requests and chatter alike
  "список", "списка", "списке", "списком", "списки", "личку", "личка", "личке", "лс", "пишите",
  "напишите", "пиши", "напиши", "пишу", "фото", "фотки", "фотографии", "оплата", "оплату", "оплаты",
  "новости", "новость", "клиент", "клиента", "клиенту", "клиенты", "клиентов", "человек", "люди",
  "сообщение", "сообщения", "ссылка", "ссылку", "группа", "группе", "чат", "чате", "канал", "тема",
  "теме", "вопросы", "ответ", "ответы", "оставлять", "оставить", "оставьте", "сегодня", "завтра",
  "вчера", "сейчас",
]);

/**
 * Sentence glue: question words, comparatives, short adjectives, auxiliaries, pronouns. A phrase that
 * contains one is a shard cut out of a sentence ("почему решили", "корова способна", "тариф лучше"),
 * never a topic, so it only ever matched the one message it was cut from.
 */
const GLUE_WORDS = new Set([
  "кто", "что", "как", "где", "когда", "почему", "зачем", "какой", "какая", "какое", "какие", "сколько",
  "лучше", "хуже", "больше", "меньше", "дешевле", "дороже", "быстрее", "проще", "сложнее",
  "способна", "способен", "способны", "готов", "готова", "готовы", "должен", "должна", "должны",
  "можно", "нужно", "надо", "было", "была", "были", "будет", "будут", "решили", "решил", "решила",
  "сделал", "сделали", "сказал", "сказали", "хотел", "хотели", "стал", "стали", "который", "которая",
  "которые", "которых", "этот", "эта", "этого", "этом", "свой", "свои", "наш", "ваш", "мой", "твой",
  "просто", "только", "именно", "даже", "вообще", "реально", "сразу", "потом", "теперь", "тоже",
]);

/** Calendar words: with numbers they form date fragments ("2026 года", "сентября 2026"), never a topic. */
const DATE_WORDS = new Set([
  "год", "года", "году", "годов", "лет", "г", "гг",
  "январь", "января", "февраль", "февраля", "март", "марта", "апрель", "апреля", "май", "мая",
  "июнь", "июня", "июль", "июля", "август", "августа", "сентябрь", "сентября", "октябрь", "октября",
  "ноябрь", "ноября", "декабрь", "декабря",
]);

/** Marketplace / seller context: the audience's background vocabulary (closed list, whole words). */
const CONTEXT_WORDS = new Set([
  "wb", "вб", "озон", "озона", "озоне", "ozon", "wildberries", "вайлдберриз", "вайлдберис",
  "вайлдбериз", "яндекс", "яндекса", "yandex", "маркет", "маркета", "маркетплейс", "маркетплейса",
  "маркетплейсе", "маркетплейсы", "маркетплейсов", "маркетплейсам", "маркетплейсах", "мегамаркет",
  "megamarket", "селлер", "селлера", "селлеру", "селлеры", "селлеров", "селлерам", "селлерами",
  "seller", "sellers", "товар", "товара", "товары", "товаров", "товаре", "товарам", "склад",
  "склада", "складе", "склады", "складов", "карточка", "карточки", "карточек", "карточку", "карточке",
  "карточкам", "карточками", "инфографика", "инфографики", "инфографику", "инфографикой", "отзыв",
  "отзыва", "отзывы", "отзывов", "отзывам", "заказ", "заказа", "заказы", "заказов",
]);

/**
 * Single words that are off-topic for any seller audience (spam, crypto, esoterics, jobs, travel).
 * Auto-learning adds a single word only from this lexicon; everything else must be a phrase.
 */
const OFF_TOPIC_WORD_RE =
  /^(?:ваканси\p{L}*|резюме|казино|крипт\p{L}*|usdt|usdc|btc|биткоин\p{L}*|bitcoin|форекс|forex|трейдинг\p{L}*|таро|гадани\p{L}*|гадалк\p{L}*|астролог\p{L}*|нумеролог\p{L}*|эзотерик\p{L}*|накрутк\p{L}*|букмекер\p{L}*|беттинг\p{L}*|микрозайм\p{L}*|займ\p{L}*|бали|visa|рупи[ийяюе]|эскорт\p{L}*|порно\p{L}*|интим\p{L}*)$/u;

/** Auto-learning takes at most this many terms per action; the list is capped by scan anyway. */
export const MAX_LEARNED_MINUS_TERMS = 8;
/** Longer learned "phrases" are pasted message fragments, not stop phrases. */
const MAX_LEARNED_PHRASE_WORDS = 4;

function wordsOf(text: string): string[] {
  return normalizeYo(text.toLowerCase())
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function stemOf(word: string): string {
  return word.length >= STEM_LENGTH ? word.slice(0, STEM_LENGTH) : word;
}

type ProtectedVocabulary = { terms: string[]; words: Set<string>; stems: Set<string> };

function protectedVocabulary(settings: StopListSettings): ProtectedVocabulary {
  const terms = [
    ...splitTerms(settings.keywords || ""),
    ...splitTerms(settings.hotSignals || ""),
    ...splitTerms(settings.learnExamples || ""),
  ].map(normalizeYo);
  const words = new Set<string>();
  for (const term of terms) {
    for (const w of wordsOf(term)) {
      if (w.length >= MIN_PROTECTED_WORD_LENGTH && !GENERIC_WORDS.has(w)) words.add(w);
    }
  }
  for (const text of [settings.product || "", settings.leadCriteria || ""]) {
    for (const w of wordsOf(text)) {
      if (w.length >= MIN_DESCRIPTION_WORD_LENGTH && !GENERIC_WORDS.has(w)) words.add(w);
    }
  }
  return { terms, words, stems: new Set([...words].map(stemOf)) };
}

function isContentWord(word: string): boolean {
  if (word.length < MIN_CONTENT_WORD_LENGTH || GENERIC_WORDS.has(word)) return false;
  return !DATE_WORDS.has(word) && !/^\d+$/u.test(word);
}

/** Same 5-letter stem ("остатков" ~ "остатки"), a fragment of a protected word ("склад" in "мойсклад"), or context. */
function isProtectedWord(word: string, vocab: ProtectedVocabulary): boolean {
  if (CONTEXT_WORDS.has(word) || WEAK_PLUS_TERMS.has(word)) return true;
  if (word.length < MIN_PROTECTED_WORD_LENGTH) return false;
  if (vocab.stems.has(stemOf(word))) return true;
  for (const p of vocab.words) if (p.includes(word) || word.includes(p)) return true;
  return false;
}

/** Selling or buying ready-made accounts: spam in seller chats whatever the product text says. */
const ACCOUNT_TRADE_RE = /^(?:прода\p{L}*|куп\p{L}*|покупк\p{L}*)\s+аккаунт\p{L}*$/u;

const DEFAULT_JUNK = new Set(SUGGESTED_MINUS.map((t) => normalizeYo(t.toLowerCase())));

/**
 * Known junk (the default stop-list, off-topic lexicon, account trade) is never dropped for merely
 * resembling product text: "продаж" in the product must not unblock "продаю аккаунт", "старой" not "таро".
 */
function isKnownJunk(candidate: string, words: readonly string[]): boolean {
  return (
    DEFAULT_JUNK.has(candidate) ||
    ACCOUNT_TRADE_RE.test(candidate) ||
    words.some((w) => OFF_TOPIC_WORD_RE.test(w))
  );
}

/** A request our leads are made of ("ищу crm", "выгрузка остатков") must never become a stop term. */
function looksLikeLeadRequest(candidate: string): boolean {
  return hasBuyerIntent(candidate) || hasSoftAsk(candidate) || hasProductFit(candidate);
}

function rejectsCandidate(candidate: string, vocab: ProtectedVocabulary): boolean {
  if (candidate.length < MIN_CANDIDATE_LENGTH || candidate.length > MAX_MINUS_TERM_LENGTH) return true;
  if (WEAK_PLUS_TERMS.has(candidate)) return true;
  const words = wordsOf(candidate);
  // An explicit positive term wins even over known junk.
  if (vocab.terms.some((p) => p.includes(candidate))) return true;
  if (isKnownJunk(candidate, words)) return false;
  if (looksLikeLeadRequest(candidate)) return true;
  if (words.length > 1 && words.some((w) => GLUE_WORDS.has(w))) return true;
  const content = words.filter(isContentWord);
  if (!content.length) return true;
  if (content.length === 1) {
    const single = vocab.terms.some(
      (p) => p.length >= MIN_PROTECTED_TERM_LENGTH && candidate.includes(p),
    );
    return single || isProtectedWord(content[0] as string, vocab);
  }
  // A phrase is only dropped when every content word is protected ("яндекс директ" stays).
  return content.every((w) => isProtectedWord(w, vocab));
}

/**
 * Keep only minus candidates that cannot hit the product's own leads.
 * Deduplicates case-insensitively (ё=е), keeps first spelling and order.
 */
export function sanitizeMinusTerms(
  candidates: readonly string[],
  settings: StopListSettings,
): string[] {
  const vocab = protectedVocabulary(settings);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const original = String(raw || "").trim();
    const key = normalizeYo(original.toLowerCase());
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!rejectsCandidate(key, vocab)) out.push(original);
  }
  return out;
}

/**
 * What auto-learning (reject / train actions) may append to the stop-lists: sanitized candidates that
 * are either a short phrase (2–{@link MAX_LEARNED_PHRASE_WORDS} words) or a single clearly off-topic
 * word, at most {@link MAX_LEARNED_MINUS_TERMS}. An ordinary single word from a rejected message
 * ("список", "корова") is never learned: it hits every chat that happens to use it.
 */
export function learnableMinusTerms(
  candidates: readonly string[],
  settings: StopListSettings,
): string[] {
  return sanitizeMinusTerms(candidates, settings)
    .filter((term) => {
      const words = wordsOf(term);
      if (words.length === 1) return OFF_TOPIC_WORD_RE.test(words[0] as string);
      return words.length <= MAX_LEARNED_PHRASE_WORDS;
    })
    .slice(0, MAX_LEARNED_MINUS_TERMS);
}

function csvTerms(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Re-run the stored stop-lists through {@link sanitizeMinusTerms}; pure, for cleanup of polluted settings. */
export function cleanStopLists(settings: StopListSettings): CleanedStopLists {
  const removed: string[] = [];
  const clean = (raw: string): string => {
    const terms = csvTerms(raw);
    const kept = sanitizeMinusTerms(terms, settings);
    const keptKeys = new Set(kept.map((t) => t.toLowerCase()));
    for (const t of terms) {
      const k = t.toLowerCase();
      if (!keptKeys.has(k) && !removed.includes(k)) removed.push(k);
    }
    return kept.join(", ");
  };
  return {
    minusKeywords: clean(settings.minusKeywords || ""),
    avoidTopics: clean(settings.avoidTopics || ""),
    removed,
  };
}

/**
 * The one ordered stop list a scan uses, for the TS core AND the Python worker:
 * minusKeywords (newest first, as learning prepends) then avoidTopics, sanitized at read time so
 * polluted tenants recover without a manual cleanup, deduplicated, capped at MAX_MINUS_TERMS.
 */
export function scanStopTerms(settings: StopListSettings): string[] {
  const merged = [...csvTerms(settings.minusKeywords || ""), ...csvTerms(settings.avoidTopics || "")];
  return sanitizeMinusTerms(merged, settings).slice(0, MAX_MINUS_TERMS);
}
