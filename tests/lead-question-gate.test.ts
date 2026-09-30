import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {explainLeadDecision,type LeadCoreSettings} from '@/lib/lead-core';
import {
  QUESTION_STEMS,
  QUESTION_WORDS,
  TOPIC_STEMS,
  TOPIC_WORDS,
  hasQuestion,
  isSellerQuestion,
  sellerTopicHits,
} from '@/lib/lead-question-gate';

type GateCase={text:string;question:boolean;topics:string[]};
type GateFixture={
  questionStems:string[];
  questionWords:string[];
  topicStems:string[];
  topicWords:string[];
  cases:GateCase[];
};
const FIXTURE=JSON.parse(readFileSync(path.resolve(__dirname,'fixtures/lead-question-gate.json'),'utf8')) as GateFixture;

/** Synthetic Uniseller-like settings (no real account data). */
const uniseller:LeadCoreSettings={
  keywords:'остатки, синхронизация, МойСклад, 1С, управление ценами, ответы на отзывы, несколько кабинетов, интеграция, ищу сервис, нужна crm, кто пользуется',
  minusKeywords:'вакансия, резюме, накрутка, матрица судьбы, таро, гадание, писать @, казино',
  avoidTopics:'',
  leadCriteria:'Явно ищет сервис или CRM для учёта остатков, синхронизации заказов, цен, отзывов, нескольких кабинетов маркетплейсов, интеграции с 1С или МойСклад',
  hotSignals:'ищу сервис, нужен сервис, кто пользуется, интеграция 1с, мойсклад, синхронизация остатков',
  product:'Uniseller — платформа для селлеров WB/Ozon: остатки, заказы, цены, отзывы, несколько кабинетов, 1С/МойСклад',
};

const dental:LeadCoreSettings={
  keywords:'стоматология, запись пациентов, crm клиники, 1с медицина',
  minusKeywords:'вакансия, матрица судьбы, таро',
  leadCriteria:'Ищет CRM или запись пациентов для стоматологической клиники',
  hotSignals:'ищу crm, запись пациентов, стоматология',
  product:'DentalSoft — CRM для стоматологий: запись, карты пациентов, 1С',
};

describe('seller-question gate: shared TS/Python fixture',()=>{
  it('code vocabulary equals the fixture vocabulary',()=>{
    expect([...QUESTION_STEMS]).toEqual(FIXTURE.questionStems);
    expect([...QUESTION_WORDS]).toEqual(FIXTURE.questionWords);
    expect([...TOPIC_STEMS]).toEqual(FIXTURE.topicStems);
    expect([...TOPIC_WORDS]).toEqual(FIXTURE.topicWords);
  });

  it.each(FIXTURE.cases.map((c)=>[c.text.slice(0,40),c] as const))('%s',(_,c)=>{
    expect(hasQuestion(c.text)).toBe(c.question);
    expect(sellerTopicHits(c.text)).toEqual(c.topics);
    expect(isSellerQuestion(c.text)).toBe(c.question&&c.topics.length>0);
  });
});

describe('lead core: seller questions the worker now passes',()=>{
  it('a seller question with two topic words and a settings hit reaches AI as warm',()=>{
    const d=explainLeadDecision('Как вы грузите остатки на три кабинета?',uniseller);
    expect(d.softAsk).toBe(true);
    expect(d.pass).toBe(true);
    expect(d.temperature).toBe('warm');
  });

  it('a seller question naming only one topic stays below warm',()=>{
    const d=explainLeadDecision('У всех по фбс Кизы не проходят сегодня?',uniseller);
    expect(d.pass).toBe(false);
  });

  it('marketplace names are context, not a second topic: chat about orders on WB stays below warm',()=>{
    const d=explainLeadDecision('СПП летит в космос, ещё вб кошелёк 3%, как у вас заказы на вб?',uniseller);
    expect(d.softAsk).toBe(true);
    expect(d.pass).toBe(false);
  });

  it('a question without any topic word is not a soft ask',()=>{
    const d=explainLeadDecision('Нашёл пачку сигарет, нужны кому то??',uniseller);
    expect(d.softAsk).toBe(false);
    expect(d.pass).toBe(false);
  });

  it('topic chat without a question stays below warm',()=>{
    const d=explainLeadDecision('Скачайте отчет из фбо - управление остатками, там будет лист скрыто',uniseller);
    expect(d.softAsk).toBe(false);
    expect(d.pass).toBe(false);
  });

  it('marketplace vocabulary does not make a lead for another niche',()=>{
    const d=explainLeadDecision('Как вы грузите остатки на три кабинета?',dental);
    expect(d.pass).toBe(false);
  });
});
