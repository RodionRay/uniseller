/** Каталог тематических Telegram-групп/каналов для поиска целевых источников. */

export type GroupNiche =
  | "marketplaces"
  | "wildberries"
  | "ozon"
  | "yandex_market"
  | "megamarket"
  | "avito"
  | "vk_market"
  | "aliexpress"
  | "ecommerce"
  | "dropshipping"
  | "inventory"
  | "1c"
  | "logistics"
  | "fulfillment"
  | "reviews"
  | "pricing"
  | "analytics"
  | "saas"
  | "crm"
  | "freelance"
  | "marketing"
  | "smm"
  | "startup"
  | "business"
  | "b2b"
  | "fintech"
  | "education"
  | "healthcare"
  | "beauty"
  | "fashion"
  | "food"
  | "auto"
  | "realestate"
  | "hr"
  | "legal"
  | "accounting"
  | "design"
  | "content"
  | "bots"
  | "leadgen"
  | "certificates"
  | "china"
  | "networking";

export const GROUP_NICHE_LABELS: Record<GroupNiche, string> = {
  marketplaces: "Маркетплейсы",
  wildberries: "Wildberries",
  ozon: "Ozon",
  yandex_market: "Яндекс Маркет",
  megamarket: "Мегамаркет",
  avito: "Авито",
  vk_market: "VK Маркет",
  aliexpress: "AliExpress",
  ecommerce: "E-commerce",
  dropshipping: "Дропшиппинг",
  inventory: "Остатки / склады",
  "1c": "1С / МойСклад",
  logistics: "Логистика",
  fulfillment: "Фулфилмент",
  reviews: "Отзывы",
  pricing: "Цены",
  analytics: "Аналитика",
  saas: "SaaS / сервисы",
  crm: "CRM",
  freelance: "Фриланс / подряд",
  marketing: "Маркетинг / реклама",
  smm: "SMM",
  startup: "Стартапы",
  business: "Бизнес",
  b2b: "B2B / продажи",
  fintech: "Финтех / оплаты",
  education: "Образование",
  healthcare: "Здоровье / med",
  beauty: "Beauty",
  fashion: "Fashion",
  food: "Food / HoReCa",
  auto: "Авто",
  realestate: "Недвижимость",
  hr: "HR / вакансии",
  legal: "Юристы",
  accounting: "Бухгалтерия",
  design: "Дизайн",
  content: "Контент",
  bots: "Боты / Telegram",
  leadgen: "Лидогенерация",
  certificates: "Сертификация",
  china: "Китай / поставки",
  networking: "Нетворкинг",
};

export type CatalogGroup = {
  id: string;
  name: string;
  /** Реальная публичная ссылка. Если пусто — шаблон: ссылку вставляет оператор. */
  url: string;
  verified: boolean;
  niches: GroupNiche[];
  description: string;
  audience: string;
  searchHint: string;
};

function g(
  id: string,
  name: string,
  url: string,
  niches: GroupNiche[],
  description: string,
  audience: string,
  verified = true,
): CatalogGroup {
  return {
    id,
    name,
    url,
    verified: verified && !!url,
    niches,
    description,
    audience,
    searchHint: url || `Поиск в Telegram: ${name}`,
  };
}

/**
 * Каталог публичных чатов + темы для ручного поиска.
 * verified+url — можно вступать сразу; без url — оператор вставляет инвайт.
 */
export const GROUP_CATALOG: CatalogGroup[] = [
  // ——— Wildberries (публичные) ———
  g("wb-sellers", "WILDBERRIES seller", "https://t.me/wildberries_sllr", ["marketplaces", "wildberries", "ecommerce"], "Чат селлеров WB: карточки, поставки, комиссии.", "Селлеры WB"),
  g("wb-mplaces", "Поставщики Wildberries", "https://t.me/mplaces_wildberries", ["marketplaces", "wildberries", "ecommerce", "logistics"], "Крупный чат поставщиков и менеджеров WB.", "Селлеры WB"),
  g("wb-network", "Wildberries | Чат поставщиков", "https://t.me/wbnetwork", ["marketplaces", "wildberries", "ecommerce"], "Взаимопомощь поставщиков Wildberries.", "Селлеры WB"),
  g("wb-support-chat", "Чат поддержки поставщиков WB", "https://t.me/sellers_wildberries", ["marketplaces", "wildberries", "analytics"], "Поддержка поставщиков WB, аналитика, продажи.", "Селлеры WB"),
  g("wb-aidd", "Wildberries ЧАТ поставщиков", "https://t.me/wildberries_aidd", ["marketplaces", "wildberries", "ecommerce"], "Крупное сообщество поставщиков WB.", "Селлеры WB"),
  g("wb-helper", "WbHelper — помощь поставщикам", "https://t.me/WbHelper", ["marketplaces", "wildberries", "business"], "Вопросы по работе с WB.", "Селлеры WB"),
  g("wb-official-chat", "WB Official Chat", "https://t.me/wbofficialchat", ["marketplaces", "wildberries"], "Официальный/партнёрский чат WB.", "Партнёры WB"),
  g("wb-content", "Контент WB", "https://t.me/contentwbchat", ["marketplaces", "wildberries", "marketing", "content"], "Контент и карточки для WB.", "Контент / селлеры"),
  g("wb-sklad", "Склады WB", "https://t.me/wbofficialSKLAD", ["marketplaces", "wildberries", "logistics", "inventory", "fulfillment"], "Склады и поставки WB.", "Логистика"),
  g("wb-fbs", "Wildberries FBS", "https://t.me/wildberriesfbs", ["marketplaces", "wildberries", "logistics", "fulfillment"], "FBS-поставки и процессы.", "FBS-селлеры"),
  g("wb-search", "WB Search / видимость", "https://t.me/wbsearch", ["marketplaces", "wildberries", "analytics"], "Поиск и выдача на WB.", "Аналитика"),
  g("wb-mpchat", "Wildberries Поставщики | Чат Селлеров", "https://t.me/marketplace_wbchat", ["marketplaces", "wildberries", "ecommerce"], "Крупный чат взаимопомощи поставщиков WB.", "Селлеры WB"),
  g("wb-help", "WB Help", "https://t.me/wb_help", ["marketplaces", "wildberries"], "Помощь по Wildberries.", "Селлеры WB"),

  // ——— Ozon ———
  g("ozon-sellers", "OZON чат поставщиков", "https://t.me/ozon_mplace", ["marketplaces", "ozon", "ecommerce"], "Селлеры Ozon: FBO/FBS, акции, карточки.", "Селлеры Ozon"),
  g("ozon-mpgroup", "Ozon | Чат поставщиков", "https://t.me/mpgroup_ozon", ["marketplaces", "ozon", "ecommerce"], "Поддержка поставщиков Ozon, обмен опытом.", "Селлеры Ozon"),
  g("ozon-sllr", "OZON seller", "https://t.me/ozon_sllr", ["marketplaces", "ozon", "ecommerce"], "Сообщество селлеров Ozon.", "Селлеры Ozon"),
  g("ozon-business", "Ozon Business", "https://t.me/ozonbusiness", ["marketplaces", "ozon", "business"], "Бизнес-канал/чат Ozon.", "Селлеры Ozon"),

  // ——— Яндекс Маркет / Мегамаркет ———
  g("ym-sellers", "Чат продавцов Яндекс Маркета 2.0", "https://t.me/chat_marketplace_ym2", ["marketplaces", "yandex_market", "ecommerce"], "Крупный чат продавцов Яндекс Маркета.", "Селлеры ЯМ"),
  g("you-marketplaces", "Поставщики МП | объявления", "https://t.me/youmarketplaces", ["marketplaces", "yandex_market", "megamarket", "ecommerce"], "WB / Ozon / ЯМ / Мегамаркет.", "Мультиселлеры"),

  // ——— Мульти-МП ———
  g("mp-multi", "Чат селлеры WB / Ozon / YM", "https://t.me/mp_seller", ["marketplaces", "ecommerce", "analytics", "inventory", "pricing", "yandex_market"], "Общий чат мультиселлеров.", "Мультиселлеры"),
  g("mp-sellers-chat", "Чат продавцов WB / Ozon", "https://t.me/sellers_chat", ["marketplaces", "ecommerce", "wildberries", "ozon"], "Советы и опыт продавцов МП.", "Селлеры МП"),
  g("mp-wb-ozon", "Wildberries & Ozon | Чат поставщиков", "https://t.me/sellery_chat_ozon_wb", ["marketplaces", "wildberries", "ozon", "ecommerce"], "Совместный чат поставщиков WB и Ozon.", "Мультиселлеры"),
  g("wb-ozon-chats", "Wildberries&Ozon | Чат Селлеров", "https://t.me/wildberriesozon_chats", ["marketplaces", "wildberries", "ozon", "ecommerce"], "Крупный чат взаимопомощи селлеров.", "Мультиселлеры"),
  g("wboz-sellers", "Чат поставщиков | WB | OZON", "https://t.me/wbozsellers", ["marketplaces", "wildberries", "ozon", "ecommerce"], "Поставщики WB и Ozon.", "Мультиселлеры"),
  g("wb-ozon-mp", "Общий чат поставщиков WB и Ozon", "https://t.me/wb_ozon_mp", ["marketplaces", "wildberries", "ozon"], "Общий чат поставщиков.", "Мультиселлеры"),
  g("wb-ozon-docs", "Сертификация и документы МП", "https://t.me/wb_ozonchat", ["marketplaces", "wildberries", "ozon", "certificates", "legal"], "Сертификаты, декларации, документы.", "Селлеры / юристы"),
  g("marketplace-chati", "Маркетплейсы. ЧАТ", "https://t.me/MarketplaceChati", ["1c", "ecommerce", "inventory", "marketplaces"], "Процессы, учёт, продвижение на МП.", "Селлеры / интеграторы"),

  // ——— Учёт ———
  g("moysklad-mp", "МойСклад | Блог", "https://t.me/moysklad", ["1c", "inventory", "marketplaces", "ecommerce", "saas"], "Учёт, e-commerce, маркетплейсы.", "Селлеры с учётом"),

  // ——— Доп. маркетплейсы / селлеры (проверенные публичные) ———
  g("wb-supply", "Wildberries | Чат поставщиков", "https://t.me/wb_supply", ["marketplaces", "wildberries", "ecommerce"], "Крупный чат поставщиков и продавцов WB.", "Селлеры WB"),
  g("wb-top-seller", "WB OZON Селлеры", "https://t.me/top_seller_wb_ozon", ["marketplaces", "wildberries", "ozon", "ecommerce"], "Чат селлеров МП РФ.", "Мультиселлеры"),
  g("mp-marketplace-chat", "Маркетплейсы Чат поставщиков", "https://t.me/marketplace_mpchat", ["marketplaces", "ecommerce", "wildberries", "ozon"], "Сообщество поставщиков всех МП.", "Селлеры МП"),
  g("mp-helper", "Чат поставщиков маркетплейсов", "https://t.me/mplacechat_helper", ["marketplaces", "wildberries", "ecommerce"], "Взаимопомощь поставщиков WB/МП.", "Селлеры WB"),
  g("mp-wb-ozon-yam", "Чат поставщиков WB/Ozon/ЯМ", "https://t.me/wb_ozon_yamarket_chat", ["marketplaces", "wildberries", "ozon", "yandex_market", "ecommerce"], "WB, Ozon и Яндекс Маркет.", "Мультиселлеры"),
  g("mp-group-marketplace", "MP GROUP | чат МП", "https://t.me/mpgroup_marketplace", ["marketplaces", "ecommerce", "wildberries", "ozon", "yandex_market", "aliexpress"], "WB, Ozon, ЯМ, Lamoda, AliExpress.", "Селлеры МП"),
  g("ozon-sellers-2", "Ozon Чат поставщиков", "https://t.me/ozon_sellers_chat", ["marketplaces", "ozon", "ecommerce"], "Обсуждение работы с Ozon.", "Селлеры Ozon"),
  g("ozon-partner", "Ozon ЧАТ поставщиков", "https://t.me/ozon_partner", ["marketplaces", "ozon", "ecommerce"], "Чат поставщиков Ozon.", "Селлеры Ozon"),
  g("ym-sellers-2", "Яндекс.Маркет — для продавцов", "https://t.me/yandex_market_sellers", ["marketplaces", "yandex_market", "ecommerce"], "Продавцы Яндекс Маркета.", "Селлеры ЯМ"),

  // ——— Фулфилмент / логистика ———
  g("ff-full-logistic", "Фулл Логистик | Фулфилмент", "https://t.me/fulllogistic_chat", ["fulfillment", "logistics", "marketplaces", "wildberries", "ozon"], "Фулфилмент и доставка на МП.", "Fulfillment"),
  g("logistics-mp", "Logistics Marketplace", "https://t.me/logistics_marketplace", ["logistics", "fulfillment", "marketplaces", "ecommerce"], "Логистика под маркетплейсы.", "Логистика"),

  // ——— Китай / импорт ———
  g("china-mpgroup", "Доставка из Китая | MP Group", "https://t.me/mpgroup_china", ["china", "marketplaces", "logistics", "ecommerce", "wildberries", "ozon"], "Китай → РФ для WB/Ozon.", "Импортёры"),
  g("china-tovar", "Товары для МП / карго Китай", "https://t.me/tovar_kitay_market", ["china", "dropshipping", "ecommerce", "logistics", "marketplaces"], "Карго, товары для МП.", "Импорт / дроп"),
  g("china-cargo", "Карго Китай | 1688 / Taobao", "https://t.me/cargobai_long", ["china", "logistics", "ecommerce", "marketplaces", "wildberries", "ozon"], "Поиск товара, карго, 1688.", "Логистика ВЭД"),

  // ——— Аналитика / контент ———
  g("mpstats-chat", "MPSTATS Chat", "https://t.me/mpstatsio", ["analytics", "marketplaces", "pricing", "saas"], "Аналитика и управление продажами на МП.", "Аналитики"),
  g("shopstat-chat", "ShopStat Chat", "https://t.me/shopstat_chat", ["analytics", "marketplaces", "saas", "pricing"], "Аналитика магазинов и МП.", "Аналитики"),
  g("infograph-wb", "Инфографика товара WB/Ozon", "https://t.me/infograph_wb_ozon", ["content", "design", "marketplaces", "wildberries", "ozon"], "Инфографика карточек МП.", "Контент"),

  // ——— CRM / SaaS ———
  g("amocrm-official", "amoCRM канал", "https://t.me/amocrm", ["crm", "saas", "b2b", "business", "leadgen"], "Официальный канал amoCRM: продажи и CRM.", "B2B / CRM"),
  g("amocrm-chat", "amoCRM Chat", "https://t.me/amocrm_chat", ["crm", "saas", "b2b", "business"], "Обсуждение amoCRM и внедрений.", "B2B / CRM"),
  g("bitrix24-biz", "CRM Битрикс24 | Бизнес", "https://t.me/business_bitrix24", ["crm", "saas", "b2b", "business"], "Внедрение и автоматизация Битрикс24.", "B2B"),

  // ——— Бизнес / нетворкинг / стартапы ———
  g("biznes-chat-1", "Бизнес-чат №1", "https://t.me/biznes_chat", ["business", "networking", "b2b", "leadgen"], "Идеи, партнёры, поставщики, нетворкинг.", "Предприниматели"),
  g("biz-predprinimateli", "Подслушано Бизнес | Предприниматели", "https://t.me/predprinimateli_biznes", ["business", "networking", "freelance", "leadgen"], "Бизнес, фриланс, заказчики.", "Бизнес"),
  g("biz-bezproblem", "Бизнес и фриланс", "https://t.me/bizbezproblem", ["business", "freelance", "leadgen", "networking"], "Поиск клиентов бизнесу и фрилансу.", "Бизнес / фриланс"),
  g("startup-founder", "IT Founder / проекты", "https://t.me/startup_founder", ["startup", "saas", "networking", "freelance"], "Идеи, команда, проекты.", "Стартапы"),

  // ——— Фриланс ———
  g("freelance-tg", "Фриланс чат Telegram", "https://t.me/freelance_in_telegram", ["freelance", "design", "marketing", "content", "business"], "Заказчики и исполнители.", "Фриланс"),
  g("freelance-work", "Работа онлайн | чат", "https://t.me/work_online_today", ["freelance", "business", "design", "content", "hr"], "Удалёнка и заказы.", "Фриланс"),
  g("free-chat-fl", "Фриланс | FREE CHAT", "https://t.me/free_chat_for_freelance", ["freelance", "design", "marketing", "bots"], "Поиск проектов и подрядчиков.", "Фриланс"),

  // ——— Вертикали ———
  g("beauty-biz", "Beauty Business Chat", "https://t.me/beauty_business_chat", ["beauty", "business", "crm", "marketing"], "Beauty-бизнес и услуги.", "Beauty"),
  g("vk-ads-chat", "VK реклама", "https://t.me/vk_ads_chat", ["vk_market", "marketing", "smm", "leadgen"], "Реклама ВКонтакте.", "SMM / Ads"),

  // ——— Темы / базы для ручного поиска (без обязательной ссылки) ———
  g("topic-crm-amocrm", "AmoCRM / CRM внедрение", "", ["crm", "saas", "b2b", "business"], "Ищут CRM, внедрение, интеграции.", "B2B / интеграторы", false),
  g("topic-bitrix", "Битрикс24 чаты", "", ["crm", "saas", "b2b", "business"], "Битрикс24, порталы, автоматизация.", "B2B", false),
  g("topic-megaplan", "Мегаплан / CRM", "", ["crm", "saas", "b2b"], "CRM и задачи для SMB.", "B2B", false),
  g("topic-retailcrm", "RetailCRM / e-com CRM", "", ["crm", "ecommerce", "saas"], "CRM для интернет-магазинов.", "E-com", false),
  g("topic-saas-ru", "SaaS Russia / продукты", "", ["saas", "startup", "business", "b2b"], "Обсуждение SaaS и подписок.", "Основатели / продажи", false),
  g("topic-product-hunt-ru", "Product / indie hackers RU", "", ["saas", "startup"], "Продуктовые обсуждения, запуск.", "Основатели", false),
  g("topic-freelance-dev", "Фриланс разработка", "", ["freelance", "saas", "business"], "Подрядчики, заказы на разработку.", "Агентства / фриланс", false),
  g("topic-freelance-design", "Фриланс дизайн / SMM", "", ["freelance", "marketing", "design", "smm"], "Дизайн, SMM, контент.", "Агентства", false),
  g("topic-freelance-copy", "Копирайтинг / тексты", "", ["freelance", "content", "marketing"], "Тексты, лендинги, карточки.", "Контент", false),
  g("topic-marketing-perf", "Performance / контекст", "", ["marketing", "business", "leadgen"], "Реклама, трафик, агентства.", "Маркетинг", false),
  g("topic-marketing-seo", "SEO / продвижение", "", ["marketing", "ecommerce", "content"], "SEO, контент-маркетинг.", "Маркетинг", false),
  g("topic-smm", "SMM / соцсети", "", ["smm", "marketing", "content"], "Ведение соцсетей, таргет.", "SMM", false),
  g("topic-startup-ru", "Стартапы RU", "", ["startup", "saas", "business", "networking"], "Пилоты, B2B-продажи, продукт.", "Стартапы", false),
  g("topic-b2b-sales", "B2B продажи", "", ["b2b", "business", "crm", "saas", "leadgen"], "Лиды, отделы продаж, CRM.", "Отделы продаж", false),
  g("topic-ecommerce-ops", "Операции e-commerce", "", ["ecommerce", "inventory", "logistics", "fulfillment"], "Склады, фулфилмент, процессы.", "Операторы", false),
  g("topic-unit-econ", "Юнит-экономика МП", "", ["analytics", "pricing", "marketplaces"], "Маржа, ДРР, юнит-экономика.", "Аналитики / селлеры", false),
  g("topic-reviews-bot", "Отзывы и репутация", "", ["reviews", "marketplaces", "saas"], "Автоответы, рейтинг, сервисы отзывов.", "Поддержка / SaaS", false),
  g("topic-1c-integr", "1С интеграции с МП", "", ["1c", "marketplaces", "inventory", "saas"], "1С ↔ WB/Ozon/ЯМ.", "Интеграторы", false),
  g("topic-moysklad-chat", "МойСклад чаты пользователей", "", ["1c", "inventory", "ecommerce", "saas"], "Учёт и интеграции МойСклад.", "Селлеры", false),
  g("topic-proxy-farm", "Прокси и антидетект (осторожно)", "", ["business"], "Инфра для аккаунтов — шум, фильтровать стоп-словами.", "Операторы", false),
  g("topic-hr-exclude", "Вакансии / HR (стоп)", "", ["hr", "business"], "Вакансии — обычно не целевые лиды.", "HR", false),
  g("topic-megamarket", "Мегамаркет селлеры", "", ["megamarket", "marketplaces", "ecommerce"], "Продавцы Мегамаркета / СберМегаМаркет.", "Селлеры ММ", false),
  g("topic-avito", "Авито бизнес / услуги", "", ["avito", "business", "ecommerce", "freelance", "leadgen"], "Услуги, подряд, локальный B2B.", "Услуги", false),
  g("topic-vk-market", "VK Маркет / VK Ads", "", ["vk_market", "marketplaces", "marketing", "smm"], "Продажи и реклама ВКонтакте.", "Селлеры / SMM", false),
  g("topic-aliexpress", "AliExpress / глобал", "", ["aliexpress", "marketplaces", "china", "ecommerce"], "Поставки и продажи Ali.", "Импорт / селлеры", false),
  g("topic-china-supply", "Поставщики Китай / 1688", "", ["china", "ecommerce", "logistics", "dropshipping"], "Поиск фабрик, выкуп, логистика.", "Импортёры", false),
  g("topic-dropshipping", "Дропшиппинг RU", "", ["dropshipping", "ecommerce", "marketplaces", "china"], "Дроп, витрины, поставщики.", "Дропшипперы", false),
  g("topic-fulfillment", "Фулфилмент / 3PL", "", ["fulfillment", "logistics", "inventory", "ecommerce"], "Склады под ключ, FBS/FBO.", "Операторы", false),
  g("topic-no-code", "No-code / автоматизация", "", ["saas", "crm", "business", "bots"], "Make, n8n, Albato, интеграции.", "Интеграторы", false),
  g("topic-support-outsource", "Аутсорс поддержки", "", ["freelance", "saas", "business", "bots"], "Ищут операторов, чат-боты, helpdesk.", "Аутсорс", false),
  g("topic-legal-ip", "ИП / юрсопровождение", "", ["legal", "business", "certificates"], "Регистрация, договоры, налоги.", "Юристы", false),
  g("topic-accounting", "Бухгалтерия для бизнеса", "", ["accounting", "business", "1c"], "Учёт, отчётность, аутсорс бухгалтерии.", "Бухгалтерия", false),
  g("topic-telegram-bots", "Telegram-боты / чат-боты", "", ["bots", "saas", "marketing", "business", "leadgen"], "Боты, воронки, автоматизация диалогов.", "Разработка / SaaS", false),
  g("topic-leadgen", "Лидогенерация / тёплые лиды", "", ["leadgen", "marketing", "business", "saas", "b2b"], "Заявки, прогрев, лидген-сервисы.", "Маркетинг", false),
  g("topic-fintech", "Финтех / эквайринг / рассрочка", "", ["fintech", "ecommerce", "saas", "business"], "Оплаты, BNPL, кассы.", "Финтех", false),
  g("topic-education", "Онлайн-школы / EdTech", "", ["education", "marketing", "saas", "business"], "Курсы, LMS, трафик на обучение.", "EdTech", false),
  g("topic-healthcare", "MedTech / клиники", "", ["healthcare", "saas", "business", "crm"], "Запись, CRM клиник, telemed.", "Med", false),
  g("topic-beauty", "Beauty / салоны", "", ["beauty", "business", "crm", "marketing"], "Салоны, мастера, запись.", "Beauty", false),
  g("topic-fashion", "Fashion / одежда МП", "", ["fashion", "marketplaces", "ecommerce", "wildberries", "ozon"], "Одежда, бренд, карточки.", "Fashion-селлеры", false),
  g("topic-food", "Food / доставка / HoReCa", "", ["food", "business", "logistics", "saas"], "Рестораны, доставка, агрегаторы.", "HoReCa", false),
  g("topic-auto", "Авто бизнес / дилеры", "", ["auto", "business", "crm", "marketing"], "Автосалоны, сервисы, лиды.", "Авто", false),
  g("topic-realestate", "Недвижимость / риелторы", "", ["realestate", "business", "crm", "leadgen"], "Объекты, лиды, CRM.", "Недвижимость", false),
  g("topic-design", "Дизайн / брендинг", "", ["design", "freelance", "marketing", "content"], "Фирстиль, упаковка, карточки.", "Дизайн", false),
  g("topic-content", "Контент / UGC / инфографика", "", ["content", "marketplaces", "marketing", "design"], "Инфографика МП, UGC, видео.", "Контент", false),
  g("topic-certificates", "Сертификация / декларации", "", ["certificates", "legal", "marketplaces", "china"], "Документы для МП и импорта.", "Сертификация", false),
  g("topic-analytics-mp", "Аналитика МП / MPStats / Moneyplace", "", ["analytics", "marketplaces", "pricing", "saas"], "Сервисы аналитики и ниш.", "Аналитики", false),
  g("topic-pricing-reprice", "Репрайсеры / динамические цены", "", ["pricing", "marketplaces", "saas", "analytics"], "Автоцены, конкуренты.", "Селлеры / SaaS", false),
  g("topic-inventory-sync", "Синхронизация остатков", "", ["inventory", "1c", "marketplaces", "saas"], "Остатки между площадками.", "Интеграторы", false),
  g("topic-networking-biz", "Бизнес-клубы / нетворкинг", "", ["networking", "business", "b2b", "startup"], "Знакомства, питчи, партнёрства.", "Основатели", false),
  g("topic-agency", "Digital-агентства", "", ["marketing", "freelance", "smm", "business", "leadgen"], "Агентства ищут подряд / клиентов.", "Агентства", false),
  g("topic-it-outsource", "IT-аутсорс / заказчики", "", ["freelance", "saas", "b2b", "business"], "Заказы на разработку и поддержку.", "IT", false),
  g("topic-helpdesk", "Helpdesk / омниканал", "", ["saas", "crm", "bots", "business"], "Поддержка, чаты, тикеты.", "SaaS", false),
  g("topic-email-crm", "Email / рассылки / CDP", "", ["marketing", "saas", "crm", "leadgen"], "Рассылки, сегменты, CRM-маркетинг.", "Маркетинг", false),
  g("topic-call-center", "Колл-центр / телефония", "", ["business", "crm", "saas", "b2b"], "Ищут телефонию, скрипты, операторов.", "Продажи", false),
  g("topic-wholesale", "Опт / дистрибуция", "", ["business", "ecommerce", "china", "b2b"], "Оптовые поставки, дистрибьюторы.", "B2B", false),
  g("topic-brand", "Бренд / DTC", "", ["ecommerce", "marketing", "fashion", "beauty", "business"], "Свой бренд, DTC, маркетплейсы.", "Бренды", false),

  // ——— Рынки поиска клиентов (темы без обязательной ссылки) ———
  g("topic-clients-b2b", "Ищу клиентов B2B / подряд", "", ["b2b", "leadgen", "business", "freelance"], "«Ищу подрядчика», «нужен сервис», B2B-запросы.", "Продажи услуг", false),
  g("topic-clients-local", "Локальный бизнес / услуги города", "", ["business", "avito", "leadgen", "marketing"], "Клиенты на услуги в городе: ремонт, красота, авто.", "Локальные услуги", false),
  g("topic-clients-agency", "Заказчики агентств", "", ["marketing", "smm", "leadgen", "freelance", "business"], "Ищут SMM, performance, дизайн-студию.", "Агентства", false),
  g("topic-clients-it", "Заказчики IT / digital", "", ["freelance", "saas", "b2b", "bots", "business"], "«Нужен разработчик», «сделать бота», «CRM».", "IT / digital", false),
  g("topic-clients-edu", "Родители / курсы / репетиторы", "", ["education", "marketing", "leadgen"], "Запросы на обучение и курсы.", "EdTech", false),
  g("topic-clients-fit", "Фитнес / спорт / wellness", "", ["healthcare", "beauty", "business", "marketing"], "Залы, тренеры, wellness-услуги.", "Wellness", false),
  g("topic-clients-travel", "Туризм / визы / переезд", "", ["business", "legal", "leadgen"], "Визы, туры, релокация.", "Travel", false),
  g("topic-clients-photo", "Фото / видео / ивенты", "", ["design", "content", "freelance", "marketing"], "Съёмки, монтаж, мероприятия.", "Креатив", false),
  g("topic-clients-builders", "Стройка / ремонт / подряд", "", ["business", "realestate", "freelance", "leadgen"], "Ремонт квартир, стройматериалы, бригады.", "Стройка", false),
  g("topic-clients-lawyers", "Юрпомощь / банкротство / долги", "", ["legal", "business", "leadgen"], "Юристы, банкротство физлиц, договоры.", "Юристы", false),
  g("topic-clients-tax", "Налоги / бухгалтерия / ИП", "", ["accounting", "legal", "business", "1c"], "Бухгалтерия, налоги, открытие ИП/ООО.", "Бухгалтерия", false),
  g("topic-clients-invest", "Инвестиции / трейдинг (осторожно)", "", ["fintech", "business"], "Много шума — фильтровать стоп-словами.", "Финтех", false),
  g("topic-clients-crypto", "Крипта / web3 (осторожно)", "", ["fintech", "startup"], "Высокий шум и скам.", "Финтех", false),
  g("topic-clients-mothers", "Мамы / детские товары / услуги", "", ["business", "ecommerce", "marketing", "leadgen"], "Детские услуги, товары, няни.", "Family", false),
  g("topic-clients-pets", "Питомцы / вет / зоотовы", "", ["business", "ecommerce", "healthcare"], "Ветклиники, зоотовары, груминг.", "Pets", false),
  g("topic-clients-hr-recruit", "Рекрутинг / подбор (B2B)", "", ["hr", "b2b", "saas", "business"], "Ищут рекрутера / ATS — не путать с вакансиями.", "HR tech", false),
  g("topic-clients-pr", "PR / медиа / блогеры", "", ["marketing", "smm", "content", "leadgen"], "PR, посевы, инфлюенсеры.", "PR", false),
  g("topic-clients-print", "Полиграфия / мерч / упаковка", "", ["design", "ecommerce", "business", "china"], "Печать, мерч, упаковка для брендов.", "Производство", false),
  g("topic-clients-logistics-b2b", "Грузоперевозки / логистика B2B", "", ["logistics", "fulfillment", "business", "b2b"], "Перевозки, таможня, склады.", "Логистика", false),
  g("topic-clients-cafe", "Кафе / рестораны / поставщики", "", ["food", "business", "logistics"], "HoReCa ищет поставщиков и сервисы.", "HoReCa", false),
  g("topic-clients-doctors", "Врачи / клиники / пациенты", "", ["healthcare", "crm", "marketing", "leadgen"], "Запись, реклама клиник, сервисы.", "Med", false),
  g("topic-clients-schools", "Школы / детсады / кружки", "", ["education", "business", "leadgen"], "Образовательные услуги.", "Образование", false),
  g("topic-clients-events", "Ивенты / свадьбы / праздники", "", ["business", "design", "marketing", "leadgen"], "Организация мероприятий.", "Ивенты", false),
  g("topic-clients-cleaning", "Клининг / клининг B2B", "", ["business", "leadgen", "avito"], "Уборка квартир и офисов.", "Услуги", false),
  g("topic-clients-security", "Охрана / видеонаблюдение", "", ["business", "saas", "b2b"], "Системы безопасности.", "B2B", false),
  g("topic-clients-software", "Софт для бизнеса / лицензии", "", ["saas", "crm", "1c", "business"], "Ищут софт, лицензии, внедрение.", "SaaS", false),
  g("topic-clients-ads", "Реклама / трафик / лиды «куплю»", "", ["marketing", "leadgen", "smm", "business"], "Покупают трафик и заявки.", "Маркетинг", false),
  g("topic-fl-ru", "FL.ru / биржа фриланса (чат)", "", ["freelance", "design", "content", "business"], "Биржи и чаты заказчиков.", "Фриланс", false),
  g("topic-kwork", "Kwork / заказы", "", ["freelance", "design", "marketing", "bots"], "Заказы на услуги.", "Фриланс", false),
  g("topic-habr-freelance", "Хабр Фриланс / IT-заказы", "", ["freelance", "saas", "b2b"], "IT-подряд и заказчики.", "IT", false),
  g("topic-vc-ru", "VC.ru / предприниматели", "", ["startup", "business", "saas", "networking", "b2b"], "Стартапы и малый бизнес ищут сервисы.", "Стартапы", false),
  g("topic-entrepreneurs", "Предприниматели RU чаты", "", ["business", "networking", "b2b", "leadgen"], "Общение предпринимателей, запросы услуг.", "Бизнес", false),
  g("topic-moscow-biz", "Бизнес Москва / регионы", "", ["business", "networking", "leadgen", "avito"], "Городские бизнес-чаты.", "Локальный B2B", false),
  g("topic-women-biz", "Женский бизнес / community", "", ["business", "networking", "marketing", "beauty"], "Комьюнити и запросы услуг.", "Community", false),
  g("topic-export", "Экспорт / ВЭД", "", ["china", "logistics", "business", "legal", "b2b"], "ВЭД, таможня, экспортёры.", "ВЭД", false),
  g("topic-farmers", "Фермеры / агро", "", ["food", "business", "logistics", "ecommerce"], "Агробизнес и сбыт.", "Агро", false),
  g("topic-handmade", "Handmade / крафт / маркеты", "", ["ecommerce", "marketplaces", "design", "marketing"], "Хендмейд-продавцы ищут продвижение.", "E-com", false),
  g("topic-podcast", "Подкасты / медиа", "", ["content", "marketing", "smm"], "Медиа ищут гостей, продюсеров, сервисы.", "Медиа", false),
  g("topic-gaming", "Геймдев / студии", "", ["freelance", "startup", "design", "saas"], "Студии ищут подряд и тулы.", "Геймдев", false),
  g("topic-mobile-apps", "Мобильные приложения / заказы", "", ["freelance", "saas", "bots", "business"], "Заказ приложений и поддержка.", "Mobile", false),
];

/** Рынки: где искать клиентов (группы ниш для UI). */
export const MARKET_SECTIONS: {id: string; title: string; hint: string; niches: GroupNiche[]}[] = [
  {id: "mp", title: "Маркетплейсы", hint: "Селлеры WB/Ozon/ЯМ ищут сервисы", niches: ["marketplaces", "wildberries", "ozon", "yandex_market", "megamarket", "ecommerce", "analytics", "pricing", "inventory", "reviews", "fulfillment", "certificates"]},
  {id: "saas", title: "SaaS / CRM / B2B", hint: "Внедрение, подписки, продажи B2B", niches: ["saas", "crm", "b2b", "business", "bots", "1c", "fintech"]},
  {id: "services", title: "Услуги и фриланс", hint: "Подряд, агентства, заказчики", niches: ["freelance", "marketing", "smm", "design", "content", "leadgen", "bots"]},
  {id: "local", title: "Локальный бизнес", hint: "Городские услуги и Авито", niches: ["avito", "beauty", "food", "auto", "realestate", "healthcare", "education"]},
  {id: "trade", title: "Торговля и логистика", hint: "Импорт, дроп, склады", niches: ["china", "dropshipping", "logistics", "fulfillment", "aliexpress", "vk_market"]},
  {id: "growth", title: "Стартапы и рост", hint: "Пилоты, нетворкинг, PR", niches: ["startup", "networking", "marketing", "leadgen", "saas"]},
];


const NICHE_ALIASES: Record<string, GroupNiche[]> = {
  маркетплейс: ["marketplaces"],
  маркетплейсы: ["marketplaces"],
  marketplace: ["marketplaces"],
  wildberries: ["wildberries", "marketplaces"],
  wb: ["wildberries", "marketplaces"],
  вайлдберриз: ["wildberries", "marketplaces"],
  вайлдберрис: ["wildberries", "marketplaces"],
  ozon: ["ozon", "marketplaces"],
  озон: ["ozon", "marketplaces"],
  "яндекс маркет": ["yandex_market", "marketplaces"],
  ям: ["yandex_market", "marketplaces"],
  мегамаркет: ["megamarket", "marketplaces"],
  megamarket: ["megamarket", "marketplaces"],
  авито: ["avito", "leadgen", "business"],
  avito: ["avito", "leadgen", "business"],
  "vk маркет": ["vk_market", "marketplaces"],
  вконтакте: ["vk_market", "smm", "marketing"],
  aliexpress: ["aliexpress", "china", "marketplaces"],
  алиэкспресс: ["aliexpress", "china", "marketplaces"],
  китай: ["china", "logistics", "dropshipping"],
  1688: ["china", "dropshipping"],
  дроп: ["dropshipping", "ecommerce", "china"],
  dropshipping: ["dropshipping", "ecommerce"],
  остатк: ["inventory", "marketplaces"],
  склад: ["inventory", "logistics", "fulfillment"],
  фулфилмент: ["fulfillment", "logistics", "inventory"],
  fulfillment: ["fulfillment", "logistics"],
  мойсклад: ["1c", "inventory", "saas"],
  "1с": ["1c"],
  "1c": ["1c"],
  логистик: ["logistics", "fulfillment"],
  отзыв: ["reviews"],
  цен: ["pricing"],
  репрайс: ["pricing", "analytics", "saas"],
  аналитик: ["analytics"],
  mpstats: ["analytics", "marketplaces", "saas"],
  moneyplace: ["analytics", "marketplaces", "saas"],
  интеграц: ["1c", "inventory", "marketplaces", "crm", "saas"],
  селлер: ["marketplaces", "ecommerce"],
  seller: ["marketplaces", "ecommerce"],
  автоматиз: ["marketplaces", "inventory", "pricing", "saas", "bots"],
  crm: ["crm", "saas", "b2b", "business"],
  амо: ["crm", "saas"],
  amocrm: ["crm", "saas"],
  битрикс: ["crm", "saas"],
  bitrix: ["crm", "saas"],
  retailcrm: ["crm", "ecommerce", "saas"],
  saas: ["saas", "startup", "business", "b2b"],
  сервис: ["saas", "business"],
  фриланс: ["freelance"],
  подряд: ["freelance", "business", "b2b"],
  агентств: ["marketing", "freelance", "business", "smm", "leadgen"],
  маркетинг: ["marketing", "leadgen"],
  реклам: ["marketing", "leadgen"],
  performance: ["marketing", "leadgen"],
  seo: ["marketing", "content"],
  smm: ["smm", "marketing", "content"],
  таргет: ["smm", "marketing", "leadgen"],
  стартап: ["startup", "saas", "networking"],
  b2b: ["b2b", "business", "crm", "saas"],
  продаж: ["b2b", "business", "crm", "leadgen"],
  лид: ["leadgen", "business", "crm", "saas", "b2b"],
  лидоген: ["leadgen", "marketing", "saas"],
  бот: ["bots", "saas", "marketing"],
  telegram: ["bots", "saas"],
  "чат-бот": ["bots", "saas"],
  финтех: ["fintech", "saas"],
  эквайринг: ["fintech", "ecommerce"],
  рассрочк: ["fintech", "ecommerce"],
  обучен: ["education", "marketing"],
  курс: ["education", "marketing"],
  edtech: ["education", "saas"],
  клиник: ["healthcare", "crm", "saas"],
  med: ["healthcare", "saas"],
  beauty: ["beauty", "business"],
  салон: ["beauty", "crm"],
  fashion: ["fashion", "marketplaces", "ecommerce"],
  одежд: ["fashion", "marketplaces"],
  ресторан: ["food", "business"],
  доставк: ["food", "logistics"],
  horeca: ["food", "business"],
  авто: ["auto", "crm", "business"],
  недвижимост: ["realestate", "crm", "leadgen"],
  риелтор: ["realestate", "leadgen"],
  ваканси: ["hr"],
  резюме: ["hr"],
  юрист: ["legal", "certificates"],
  сертификац: ["certificates", "legal", "marketplaces"],
  бухгалтер: ["accounting", "1c", "business"],
  дизайн: ["design", "freelance", "content"],
  инфографик: ["content", "design", "marketplaces"],
  контент: ["content", "marketing", "smm"],
  ugc: ["content", "marketing"],
  нетворкинг: ["networking", "business", "startup"],
  бренд: ["business", "ecommerce", "marketing", "fashion", "beauty"],
  dtc: ["ecommerce", "marketing", "business"],
  опт: ["b2b", "business", "china", "ecommerce"],
  helpdesk: ["saas", "crm", "bots"],
  омниканал: ["saas", "crm", "bots"],
  телефони: ["crm", "saas", "b2b"],
  колл: ["crm", "b2b", "business"],
};

/** Id тем без verified-ссылки + старые фейки. */
export function catalogPlaceholderUsernames(): Set<string> {
  const set = new Set<string>([
    "mp_automation",
    "wb_sellers",
    "ozon_sellers",
    "ym_sellers",
    "mp_multi",
    "moysklad_mp",
    "1c_ecommerce",
    "fbo_logistics",
    "reviews_mp",
    "pricing_mp",
  ]);
  for (const item of GROUP_CATALOG) {
    if (!item.verified || !item.url) set.add(item.id.replace(/-/g, "_").toLowerCase());
  }
  return set;
}

export function extractTelegramUsername(url: string): string | null {
  const u = (url || "").trim();
  if (!u) return null;
  if (/(?:https?:\/\/)?t\.me\/(?:\+|joinchat\/)/i.test(u)) return null;
  if (u.startsWith("@")) return u.slice(1).toLowerCase();
  const m = u.match(/(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]{5,32})\b/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}

/** Ссылка-заглушка каталога — в Telegram такой группы нет. */
export function isCatalogPlaceholderUrl(url: string): boolean {
  const name = extractTelegramUsername(url);
  if (!name) return false;
  const real = new Set(
    GROUP_CATALOG.filter((item) => item.verified && item.url)
      .map((item) => extractTelegramUsername(item.url))
      .filter(Boolean) as string[],
  );
  if (real.has(name)) return false;
  return catalogPlaceholderUsernames().has(name);
}

export function nichesFromProjectText(...parts: (string | undefined)[]): GroupNiche[] {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  const found = new Set<GroupNiche>();
  for (const [alias, niches] of Object.entries(NICHE_ALIASES)) {
    if (text.includes(alias)) niches.forEach((n) => found.add(n));
  }
  if (!found.size && /продаж|товар|кабинет|fbo|fbs|услуг|клиент|заявк/.test(text)) {
    found.add("business");
    found.add("saas");
    found.add("leadgen");
    found.add("b2b");
  }
  return [...found];
}

export type CatalogHit = CatalogGroup & {
  score: number;
  /** Совпадает с нишами продукта / выбранными фильтрами */
  matched: boolean;
  overlap: number;
};

export function searchGroupCatalog(opts: {
  query?: string;
  niches?: GroupNiche[];
  projectText?: string;
  /** Подмешивать ниши из projectText (по умолчанию true, если niches пустые). */
  mergeProject?: boolean;
  /** Если true — в выдаче только matched (при наличии ниш). */
  onlyMatched?: boolean;
}): CatalogHit[] {
  const q = (opts.query || "").trim().toLowerCase();
  const fromProject = nichesFromProjectText(opts.projectText);
  const mergeProject = opts.mergeProject ?? !(opts.niches && opts.niches.length);
  const niches = new Set([
    ...(opts.niches || []),
    ...(mergeProject ? fromProject : []),
  ]);
  const preferNiches = niches.size > 0;

  let hits = GROUP_CATALOG.map((item) => {
    const overlap = preferNiches ? item.niches.filter((n) => niches.has(n)).length : 0;
    let score = 0;
    if (preferNiches) {
      if (!overlap) score -= 8;
      else score += overlap * 5;
    }
    if (q) {
      const hay = `${item.name} ${item.description} ${item.audience} ${item.searchHint} ${item.niches.join(" ")} ${item.niches.map((n) => GROUP_NICHE_LABELS[n]).join(" ")}`.toLowerCase();
      if (hay.includes(q)) score += 6;
      else if (q.split(/\s+/).some((w) => w.length > 2 && hay.includes(w))) score += 3;
      else score -= 3;
    }
    if (item.verified && item.url) score += 2;
    if (niches.has("marketplaces") && item.niches.includes("marketplaces")) score += 1;
    const matched = preferNiches ? overlap > 0 : !q || score > 0;
    return { ...item, score, matched, overlap };
  });

  if (opts.onlyMatched && preferNiches) {
    hits = hits.filter((h) => h.matched);
  }

  return hits
    .filter((h) => (opts.onlyMatched ? h.matched : h.score >= -10))
    .sort((a, b) => {
      if (a.matched !== b.matched) return a.matched ? -1 : 1;
      return b.score - a.score || a.name.localeCompare(b.name, "ru");
    });
}

export function catalogStats() {
  const verified = GROUP_CATALOG.filter((item) => item.verified && item.url).length;
  const topics = GROUP_CATALOG.length - verified;
  const urls = new Set(
    GROUP_CATALOG.filter((item) => item.url).map((item) => extractTelegramUsername(item.url) || item.url),
  );
  return {
    total: GROUP_CATALOG.length,
    verified,
    topics,
    uniqueUrls: urls.size,
    niches: Object.keys(GROUP_NICHE_LABELS).length,
  };
}
