"use client";

import {useEffect,useRef,useState} from 'react';
import {MessageCircle,X,Send,Loader2,Sparkles} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {PRODUCT_NAME} from '@/lib/product-knowledge';

type ChatMessage={role:'user'|'assistant';content:string};
type Surface='admin'|'site';

const SUGGESTIONS=[
  'Что умеет Uniseller?',
  'Как синхронизировать остатки?',
  'Есть интеграция с МойСклад?',
];

export function AiAssistantWidget({surface='site'}:{surface?:Surface}){
  const [open,setOpen]=useState(false);
  const [input,setInput]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [messages,setMessages]=useState<ChatMessage[]>([
    {
      role:'assistant',
      content:`Здравствуйте! Я ассистент ${PRODUCT_NAME}. Спрошу про маркетплейсы, остатки, МойСклад/1С, цены или отзывы — подскажу по продукту.`,
    },
  ]);
  const listRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    if(!open)return;
    listRef.current?.scrollTo({top:listRef.current.scrollHeight,behavior:'smooth'});
  },[messages,open,busy]);

  async function send(text:string){
    const message=text.trim();
    if(!message||busy)return;
    setError('');
    setInput('');
    const history=messages.slice(-8);
    setMessages((m)=>[...m,{role:'user',content:message}]);
    setBusy(true);
    try{
      const r=await fetch('/api/assistant',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({message,history,surface}),
      });
      const data:any=await r.json();
      if(!r.ok)throw new Error(data.error||'Не удалось получить ответ');
      setMessages((m)=>[...m,{role:'assistant',content:data.reply}]);
    }catch(e){
      setError((e as Error).message);
      setMessages((m)=>[...m,{
        role:'assistant',
        content:'Сейчас не удалось ответить. Повторите вопрос чуть позже или напишите на сайте uniseller.io.',
      }]);
    }finally{
      setBusy(false);
    }
  }

  return (
    <div className="assistant-root" data-surface={surface}>
      {open&&(
        <section className="assistant-panel" aria-label={`Ассистент ${PRODUCT_NAME}`}>
          <header className="assistant-header">
            <div className="assistant-header-title">
              <span className="assistant-avatar" aria-hidden><Sparkles size={16}/></span>
              <div>
                <strong>Ассистент {PRODUCT_NAME}</strong>
                <p>Ответы по продукту и сценариям селлера</p>
              </div>
            </div>
            <button type="button" className="assistant-icon-btn" aria-label="Закрыть" onClick={()=>setOpen(false)}>
              <X size={16}/>
            </button>
          </header>

          <div className="assistant-messages" ref={listRef}>
            {messages.map((m,i)=>(
              <div key={i} className={'assistant-bubble '+(m.role==='user'?'is-user':'is-bot')}>
                {m.content}
              </div>
            ))}
            {busy&&<div className="assistant-bubble is-bot is-typing">Печатает…</div>}
          </div>

          {!messages.some((m)=>m.role==='user')&&(
            <div className="assistant-suggestions">
              {SUGGESTIONS.map((s)=>(
                <button key={s} type="button" onClick={()=>send(s)} disabled={busy}>{s}</button>
              ))}
            </div>
          )}

          {error&&<p className="assistant-error" role="alert">{error}</p>}

          <form
            className="assistant-composer"
            onSubmit={(e)=>{e.preventDefault();send(input)}}
          >
            <Textarea
              value={input}
              onChange={(e)=>setInput(e.target.value)}
              placeholder="Спросите про Uniseller…"
              rows={2}
              maxLength={2000}
              aria-label="Сообщение ассистенту"
              onKeyDown={(e)=>{
                if(e.key==='Enter'&&!e.shiftKey){
                  e.preventDefault();
                  send(input);
                }
              }}
            />
            <Button type="submit" disabled={busy||!input.trim()} aria-label="Отправить">
              {busy?<Loader2 className="animate-spin" size={16}/>:<Send size={16}/>}
            </Button>
          </form>
        </section>
      )}

      <button
        type="button"
        className={'assistant-fab'+(open?' is-open':'')}
        aria-expanded={open}
        aria-label={open?'Скрыть ассистента':'Открыть ассистента Uniseller'}
        onClick={()=>setOpen((v)=>!v)}
      >
        {open?<X size={22}/>:<MessageCircle size={22}/>}
        {!open&&<span className="assistant-fab-label">Спросить Uniseller</span>}
      </button>
    </div>
  );
}
