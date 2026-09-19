import {z} from 'zod';
import {extractOpenAiDraft} from '@/lib/processes/mailings';
import {buildAssistantSystemPrompt,fallbackAssistantReply} from '@/lib/product-knowledge';

export const assistantMessageSchema=z.object({
  role:z.enum(['user','assistant']),
  content:z.string().trim().min(1).max(4000),
});

export const assistantRequestSchema=z.object({
  message:z.string().trim().min(1).max(2000),
  history:z.array(assistantMessageSchema).max(12).default([]),
  surface:z.enum(['admin','site']).default('site'),
});

export type AssistantRequest=z.infer<typeof assistantRequestSchema>;

export const ASSISTANT_RATE_WINDOW_MS=20_000;

export function canAskAssistant(lastAt:string|null|undefined,now=new Date(),windowMs=ASSISTANT_RATE_WINDOW_MS):boolean{
  if(!lastAt)return true;
  const t=Date.parse(lastAt);
  if(Number.isNaN(t))return true;
  return now.getTime()-t>=windowMs;
}

export function resolveAssistantApiKey():string|null{
  const key=process.env.ASSISTANT_OPENAI_KEY||process.env.OPENAI_API_KEY||'';
  return key.trim()||null;
}

export async function generateAssistantReply(
  input:AssistantRequest,
  options:{apiKey?:string|null;productContext?:string;fetchImpl?:typeof fetch}={},
):Promise<{reply:string;source:'openai'|'knowledge'}>{
  const apiKey=options.apiKey===undefined?resolveAssistantApiKey():options.apiKey;
  if(!apiKey){
    return {reply:fallbackAssistantReply(input.message),source:'knowledge'};
  }

  const history=input.history
    .slice(-8)
    .map((m)=>({role:m.role,content:m.content}));

  const fetchImpl=options.fetchImpl??fetch;
  const response=await fetchImpl('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{
      Authorization:`Bearer ${apiKey}`,
      'Content-Type':'application/json',
    },
    body:JSON.stringify({
      model:process.env.ASSISTANT_MODEL||'gpt-4.1-mini',
      store:false,
      max_output_tokens:700,
      instructions:buildAssistantSystemPrompt(options.productContext),
      input:[
        ...history.map((m)=>({role:m.role,content:m.content})),
        {role:'user',content:input.message},
      ],
    }),
    signal:AbortSignal.timeout(45000),
  });

  if(!response.ok){
    return {reply:fallbackAssistantReply(input.message),source:'knowledge'};
  }
  const result=await response.json();
  const reply=extractOpenAiDraft(result);
  if(!reply){
    return {reply:fallbackAssistantReply(input.message),source:'knowledge'};
  }
  return {reply,source:'openai'};
}
