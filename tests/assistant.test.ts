import {describe,expect,it,vi} from 'vitest';
import {
  buildAssistantSystemPrompt,
  fallbackAssistantReply,
  matchAssistantFaq,
  PRODUCT_NAME,
} from '@/lib/product-knowledge';
import {
  assistantRequestSchema,
  canAskAssistant,
  generateAssistantReply,
} from '@/lib/assistant-chat';

describe('AI-ассистент · знание о продукте',()=>{
  it('собирает system prompt с Uniseller и правилами',()=>{
    const prompt=buildAssistantSystemPrompt('Тестовый контекст');
    expect(prompt).toContain(PRODUCT_NAME);
    expect(prompt).toContain('Тестовый контекст');
    expect(prompt).toContain('Не выдумывай цены');
  });

  it('отвечает по FAQ без OpenAI',()=>{
    expect(matchAssistantFaq('Что такое Uniseller?')).toMatch(/платформа/i);
    expect(matchAssistantFaq('Нужна синхронизация остатков')).toMatch(/остат/i);
    expect(fallbackAssistantReply('случайный вопрос xyz')).toMatch(/Uniseller/);
  });
});

describe('AI-ассистент · chat API helpers',()=>{
  it('валидирует сообщение и историю',()=>{
    expect(assistantRequestSchema.parse({
      message:'Как подключить МойСклад?',
      history:[{role:'user',content:'Привет'},{role:'assistant',content:'Здравствуйте!'}],
      surface:'site',
    }).surface).toBe('site');
    expect(()=>assistantRequestSchema.parse({message:''})).toThrow();
  });

  it('ограничивает частоту вопросов',()=>{
    const now=new Date('2026-09-18T12:00:00Z');
    expect(canAskAssistant(null,now)).toBe(true);
    expect(canAskAssistant('2026-09-18T11:59:50Z',now)).toBe(false);
    expect(canAskAssistant('2026-09-18T11:59:30Z',now)).toBe(true);
  });

  it('без ключа использует knowledge fallback',async()=>{
    const result=await generateAssistantReply(
      {message:'Что такое Uniseller?',history:[],surface:'site'},
      {apiKey:null},
    );
    expect(result.source).toBe('knowledge');
    expect(result.reply).toMatch(/Uniseller/i);
  });

  it('с ключом вызывает DeepSeek chat completions',async()=>{
    const fetchImpl=vi.fn(async()=>({
      ok:true,
      json:async()=>({
        choices:[{message:{content:'Uniseller помогает с остатками и МойСклад.'}}],
      }),
    })) as unknown as typeof fetch;

    const result=await generateAssistantReply(
      {message:'Расскажи про остатки',history:[],surface:'admin'},
      {apiKey:'sk-test',fetchImpl},
    );
    expect(result.source).toBe('openai');
    expect(result.reply).toMatch(/остат/i);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
