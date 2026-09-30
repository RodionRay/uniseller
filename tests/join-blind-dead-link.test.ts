import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-api-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-api-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-api-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';
import {isAccountResolveBlind} from '@/lib/processes/join-flow';
import {JOIN_RELEVANCE_VERSION,buildRelevanceProfile} from '@/lib/join-relevance';

const ACCS=['a0000000-0000-4000-8000-00000000000a','b0000000-0000-4000-8000-00000000000b','c0000000-0000-4000-8000-00000000000c'];
const GROUP='e0000000-0000-4000-8000-00000000000e';
const AUTO_GROUP='f0000000-0000-4000-8000-00000000000f';

// Реальный ответ воркера на мёртвый @username, когда контрольный @telegram тоже не резолвится (e2e 2026-09-30).
const BLIND_ON_DEAD_LINK={
  ok:false,status:'error',join:'missing',usernameMissing:true,accountBlind:true,
  error:'Аккаунт не резолвит даже @telegram — ограничен Telegram, @dead_link_chat тут ни при чём (ValueError: No user has "dead_link_chat" as username)',
};
let joinCalls=0;

function rec(id:string){
  const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(row.data);
}
function patch(id:string,data:Record<string,unknown>){
  testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...rec(id),...data}),id);
}
async function addAccount(id:string){
  addRecord(id,'account',{name:id.slice(0,1),status:'active',proxyId:'',limits:{invite:40}},
    await seal(JSON.stringify({kind:'session',zipBase64:id,apiId:1,apiHash:'h'}),OWNER));
}
/** Пауза между вступлениями прошла — следующий вызов не упирается в pacing. */
function skipPacing(){
  for(const id of ACCS)patch(id,{lastJoinAt:'',joinReservedUntil:''});
  patch(GROUP,{joinNextAt:''});
}

describe('мёртвый @username не слепит всю ферму',()=>{
  let errSpy:ReturnType<typeof vi.spyOn>;
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    testDb().sqlite.prepare('DELETE FROM records WHERE id=?').run(ACCOUNT_ID);
    errSpy=vi.spyOn(console,'error').mockImplementation(()=>{});
    joinCalls=0;
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
      if(String(url).endsWith('/join-group')){joinCalls++;return Response.json(BLIND_ON_DEAD_LINK)}
      return Response.json({ok:false,error:'not stubbed'},{status:500});
    }));
    for(const id of ACCS)await addAccount(id);
    addRecord(GROUP,'group',{name:'Мёртвая',url:'https://t.me/dead_link_chat',membership:'none',status:'setup',joinedAt:'',joinWanted:true,accountId:ACCS[0]});
  });
  afterEach(()=>{
    errSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('слепым помечается не больше одного аккаунта, группа засчитывает каждого и умирает',async()=>{
    for(let i=0;i<ACCS.length;i++){
      await POST(postRequest({action:'join_group',id:GROUP}));
      skipPacing();
    }

    const blind=ACCS.filter(id=>isAccountResolveBlind(rec(id)));
    expect(blind.length).toBeLessThanOrEqual(1);
    expect(rec(GROUP).joinDead).toBe(true);
    expect(joinCalls).toBeLessThanOrEqual(ACCS.length);
  },15_000);

  it('после смерти ссылки воркер больше не зовётся',async()=>{
    for(let i=0;i<ACCS.length+2;i++){
      await POST(postRequest({action:'join_group',id:GROUP}));
      skipPacing();
    }

    expect(joinCalls).toBeLessThanOrEqual(ACCS.length);
  },15_000);
});

describe('вступаем только в группы из очереди владельца',()=>{
  let errSpy:ReturnType<typeof vi.spyOn>;
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    testDb().sqlite.prepare('DELETE FROM records WHERE id=?').run(ACCOUNT_ID);
    errSpy=vi.spyOn(console,'error').mockImplementation(()=>{});
    joinCalls=0;
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
      if(String(url).endsWith('/join-group')){joinCalls++;return Response.json({ok:true,join:'joined',status:'active'})}
      return Response.json({ok:false,error:'not stubbed'},{status:500});
    }));
    await addAccount(ACCS[0]!);
    // Свежий балл под текущие (пустые) настройки — рескор его не пересчитает.
    const rel={v:JOIN_RELEVANCE_VERSION,sig:buildRelevanceProfile({}).sig,score:90,band:'auto',reasons:['ниша: маркетплейсы'],members:5000,at:new Date().toISOString()};
    addRecord(AUTO_GROUP,'group',{name:'Рекомендуемая',url:'https://t.me/auto_chat',membership:'none',status:'setup',joinedAt:'',accountId:ACCS[0],joinRelevance:rel,joinState:'queued'});
  });
  afterEach(()=>{
    errSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('группа с высоким баллом без одобрения не вступается и уходит из очереди',async()=>{
    const res=await POST(postRequest({action:'join_group',id:AUTO_GROUP}));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({notWanted:true,gate:'auto'});
    expect(joinCalls).toBe(0);
    expect(rec(AUTO_GROUP).joinState).toBe('');
  });

  it('автопочинка не ставит рекомендуемую группу в очередь',async()=>{
    const res=await POST(postRequest({action:'heal_dead_group_accounts'}));
    const body=await res.json() as {items?:{id:string}[]};
    
    expect((body.items||[]).map(i=>i.id)).not.toContain(AUTO_GROUP);
  });

  it('после «Вступить» владельца группа вступается',async()=>{
    await POST(postRequest({action:'enqueue_joins',groupIds:[AUTO_GROUP]}));
    const res=await POST(postRequest({action:'join_group',id:AUTO_GROUP}));

    expect(res.status).toBe(200);
    expect(joinCalls).toBe(1);
  },10_000);
});
