import {describe,expect,it} from 'vitest';
import {findMinusHit} from '@/lib/lead-filter';
import {MAX_LEARNED_MINUS_TERMS,learnableMinusTerms,sanitizeMinusTerms,scanStopTerms,type StopListSettings} from '@/lib/lead-stopwords';

const SETTINGS:StopListSettings={
  keywords:'остатки, синхронизация, МойСклад, несколько кабинетов',
  hotSignals:'ищу сервис, кто пользуется',
  product:'Платформа для селлеров WB/Ozon: остатки, заказы, цены, отзывы, несколько кабинетов',
  leadCriteria:'Ищет сервис для синхронизации остатков и заказов',
  avoidTopics:'',
};

/** Top minus hits of the 2026-09-18 replay (392 old leads, 17 passed): chat words, dates, n-gram shards. */
const POLLUTED=[
  'список','личку','карточек','пишите','карточка','инфографика','оставлять отзывы','2026 года','сентября 2026',
  'почему решили','корова способна','тариф лучше','фото','оплата','новости','клиент','здравствуйте','ребята','товар',
];

/** Genuine off-topic junk that must survive read-time cleanup. */
const REAL_JUNK=['крипта','usdt','таро','вакансия','казино','бали','visa','рупии','ставки на спорт','матрица судьбы','яндекс директ'];

/** Target requests the polluted list used to drop before the core ever saw them. */
const TARGETS=[
  'Ребята, пишите в личку, у кого есть сервис для синхронизации остатков?',
  'Здравствуйте! Список карточек на WB не обновляется, ищу сервис для остатков',
  'Почему решили что МойСклад лучше? Нужна синхронизация остатков, 2026 года тариф',
  'Скиньте фото, кто пользуется сервисом для отзывов и инфографика нужна',
];

describe('scanStopTerms: polluted stop-list recovers at read time',()=>{
  const list=scanStopTerms({...SETTINGS,minusKeywords:[...POLLUTED,...REAL_JUNK].join(', ')});

  it.each(POLLUTED)('drops generic / date / shard term "%s"',(term)=>{
    expect(list).not.toContain(term);
  });

  it('keeps real junk in its original order',()=>{
    expect(list).toEqual(REAL_JUNK);
  });

  it.each(TARGETS)('target request is no longer dropped by the stop-list: %s',(msg)=>{
    expect(findMinusHit(msg,list)).toBe('');
  });

  it('still drops genuine junk messages',()=>{
    expect(findMinusHit('Продаю USDT по курсу, пишите',list)).toBe('usdt');
    expect(findMinusHit('Виза на Бали за рупии',list)).toBe('бали');
  });
});

describe('learnableMinusTerms: auto-learning adds only phrases and clearly off-topic words',()=>{
  it('does not learn generic single words or message shards',()=>{
    expect(learnableMinusTerms(POLLUTED,SETTINGS)).toEqual([]);
  });

  it('does not learn arbitrary single words from a message',()=>{
    expect(learnableMinusTerms(['корова','рулетка','доставка','молоко'],SETTINGS)).toEqual([]);
  });

  it('learns off-topic single words and topic phrases',()=>{
    expect(learnableMinusTerms(['крипта','USDT','казино','вакансии','ставки на спорт','разведение коров'],SETTINGS))
      .toEqual(['крипта','USDT','казино','вакансии','ставки на спорт','разведение коров']);
  });

  it('keeps product words out even as phrases',()=>{
    expect(learnableMinusTerms(['синхронизация остатков','карточка товара','остатки'],SETTINGS)).toEqual([]);
  });

  it('drops pasted message fragments longer than a short phrase',()=>{
    expect(learnableMinusTerms(['продам корову недорого самовывоз из подмосковья'],SETTINGS)).toEqual([]);
  });

  it(`learns at most ${MAX_LEARNED_MINUS_TERMS} terms per action`,()=>{
    const many=Array.from({length:20},(_,i)=>`ставки на спорт ${String.fromCharCode(1072+i)}`);
    expect(learnableMinusTerms(many,SETTINGS)).toHaveLength(MAX_LEARNED_MINUS_TERMS);
  });
});

describe('buyer-intent and product-fit phrases never become stop terms (settings do not contain them)',()=>{
  const narrow:StopListSettings={keywords:'остатки, синхронизация, МойСклад'};
  const REQUESTS=['ищу crm','нужна crm','выгрузка остатков','управление ценами','подскажите сервис','кто пользуется mpstats'];

  it('auto-learning rejects them',()=>{
    expect(learnableMinusTerms(REQUESTS,narrow)).toEqual([]);
  });

  it('read time drops them',()=>{
    expect(scanStopTerms({...narrow,minusKeywords:REQUESTS.join(', ')})).toEqual([]);
  });
});

describe('default junk survives product-text overlap',()=>{
  const overlapping:StopListSettings={
    keywords:'аккаунты, продажи',
    product:'Сервис роста продаж для аккаунтов селлеров, перенос со старой системы',
  };
  const DEFAULT_JUNK=['продаю аккаунт','продажа аккаунтов','куплю аккаунт','таро','накрутка','казино'];

  it('read time keeps them',()=>{
    expect(scanStopTerms({...overlapping,minusKeywords:DEFAULT_JUNK.join(', ')})).toEqual(DEFAULT_JUNK);
  });

  it('learning keeps them',()=>{
    expect(learnableMinusTerms(DEFAULT_JUNK,overlapping)).toEqual(DEFAULT_JUNK);
  });
});

describe('seller-operations and pain vocabulary is never a stop term (uncapped)',()=>{
  const OPS=[
    'поставки','контроль','вручную','excel','ошибка','проблема','приемка','считать прибыль','устал считать',
    'чистая прибыль по артикулу','остаток','заказы','склад','прибыль','выручка','себестоимость','отчет',
  ];

  it.each([['empty settings',{}],['product settings',SETTINGS]] as const)('scanStopTerms drops them with %s',(_label,settings)=>{
    expect(scanStopTerms({...settings,minusKeywords:OPS.join(', ')})).toEqual([]);
  });

  it('sanitizer drops them before the 120 cap, so cleanup scripts remove them too',()=>{
    const filler=Array.from({length:150},(_,i)=>`казино${i}`);
    expect(sanitizeMinusTerms([...filler,...OPS],{})).toEqual(filler);
  });

  it('auto-learning rejects them',()=>{
    expect(learnableMinusTerms(OPS,{})).toEqual([]);
  });
});

describe('sub-phrases of buyer requests are not stop terms',()=>{
  const SHARDS=['пользуется mpstats','пользуетесь сервисом','посоветуйте программу','какой тариф','тариф брать'];

  it('read time drops them',()=>{
    expect(scanStopTerms({minusKeywords:SHARDS.join(', ')})).toEqual([]);
  });

  it('the request they came from passes the list',()=>{
    const list=scanStopTerms({minusKeywords:[...SHARDS,'usdt'].join(', ')});
    expect(findMinusHit('Кто пользуется MPstats подскажите какой тариф лучше брать',list)).toBe('');
  });
});

describe('generic single words are dropped',()=>{
  it.each(['решили','будут','существуют','лично','сеть'])('%s',(word)=>{
    expect(scanStopTerms({minusKeywords:word})).toEqual([]);
  });
});

describe('verb-form shards from the 2026-09-30 replay',()=>{
  it.each(['базовый взять','брать смысл','клиент интересовался','выплат меняли','года направлять','кормить доить','поменять','проверяете'])('drops "%s"',(term)=>{
    expect(scanStopTerms({minusKeywords:term})).toEqual([]);
  });

  it('keeps nouns that only look like past tense and real junk phrases',()=>{
    expect(scanStopTerms({minusKeywords:'канал казино, персонал, ищу водителей, куплю usdt'}))
      .toEqual(['канал казино','персонал','ищу водителей','куплю usdt']);
  });

  it('the MPstats request passes the cleaned list',()=>{
    const list=scanStopTerms({minusKeywords:'брать смысл, смысл базовый, базовый взять, пользуется mpstats, usdt'});
    expect(list).toEqual(['смысл базовый','usdt']);
    expect(findMinusHit('Кто пользуется MPstats подскажите какой тариф лучше брать, есть ли смысл просто Базовый взять тариф',list)).toBe('');
  });
});
