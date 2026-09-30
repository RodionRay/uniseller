import {describe,expect,it} from 'vitest';
import {findMinusHit} from '@/lib/lead-filter';
import {MAX_LEARNED_MINUS_TERMS,learnableMinusTerms,scanStopTerms,type StopListSettings} from '@/lib/lead-stopwords';

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
    expect(learnableMinusTerms(['крипта','USDT','казино','вакансии','ставки на спорт','продажа коров'],SETTINGS))
      .toEqual(['крипта','USDT','казино','вакансии','ставки на спорт','продажа коров']);
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
