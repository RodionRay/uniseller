"use client";
import {useState,useEffect,useCallback} from 'react';
import {Users,Radio,Shield,Sparkles,LayoutDashboard,MessageSquare,Plus,ArrowRight,Search,ChevronRight,ExternalLink,Pencil,Trash2,Check,Upload,Plug,Loader2,LogOut} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {AnimatedNumber} from '@/components/product/animated-number';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '@/components/ui/table';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Skeleton} from '@/components/ui/skeleton';
import {Empty,EmptyHeader,EmptyTitle,EmptyDescription} from '@/components/ui/empty';
import {Toaster,toast} from 'sonner';
import {SidebarProvider,Sidebar,SidebarHeader,SidebarContent,SidebarFooter,SidebarMenu,SidebarMenuItem,SidebarMenuButton,SidebarInset,SidebarTrigger} from '@/components/ui/sidebar';

type Kind='account'|'proxy'|'group'|'lead'|'settings';
type RecordItem={id:string;kind:Kind;data:any;hasSecret:boolean;created:string};

const nav=[['Обзор',LayoutDashboard],['Лиды',Users],['Переписки',MessageSquare],['Группы и каналы',Radio],['Аккаунты',Users],['Прокси',Shield],['AI-ассистент',Sparkles]] as const;
const kinds:Record<string,Kind>={'Лиды':'lead','Переписки':'lead','Группы и каналы':'group','Аккаунты':'account','Прокси':'proxy','AI-ассистент':'settings'};
const labels:Record<Kind,string>={account:'аккаунт',proxy:'прокси',group:'группу',lead:'лид',settings:'настройки AI'};
const defaults:any={account:{name:'',phone:'',proxyId:''},proxy:{name:'',host:'',port:'1080',protocol:'socks5',username:''},group:{name:'',url:'',accountId:''},lead:{name:'',message:'',source:'Вручную',status:'new',draft:''},settings:{name:'Uniseller',model:'gpt-4.1-mini',product:'Uniseller — платформа управления Wildberries, Ozon и Яндекс Маркет. Каталог, заказы, остатки, цены, аналитика, интеграции с 1С и МойСклад, автоматизация ответов на отзывы. Сайт: https://uniseller.io. Отвечай от представителя Uniseller. Уточняй задачу клиента; не обещай неподтверждённые возможности.',keywords:'остатки, синхронизация, МойСклад, 1С, цены, отзывы, автоматизация, несколько кабинетов'}};
const viewCopy:Record<string,string>={'Обзор':'Все подключения и потенциальные клиенты в одном месте.','Лиды':'Запросы селлеров, с которых можно начать полезный диалог.','Переписки':'Черновики ответов и контекст обращений.','Группы и каналы':'Управляйте источниками и назначайте аккаунты.','Аккаунты':'Добавляйте аккаунты и привязывайте к ним прокси.','Прокси':'Сохраняйте подключения для ваших Telegram-аккаунтов.','AI-ассистент':'Задайте контекст продукта и подключите OpenAI.'};

async function api(body?:unknown){
  const r=await fetch('/api/workspace',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const data:any=await r.json();
  if(!r.ok)throw new Error(data.error||'Ошибка соединения');
  return data;
}

function Pick({value,onChange,options,placeholder}:{value:string;onChange:(s:string)=>void;options:{id:string;name:string}[];placeholder:string}){
  return <Select value={value||'none'} onValueChange={v=>onChange(v==='none'?'':v)}>
    <SelectTrigger className="w-full"><SelectValue placeholder={placeholder}/></SelectTrigger>
    <SelectContent>
      <SelectItem value="none">{placeholder}</SelectItem>
      {options.map(v=><SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
    </SelectContent>
  </Select>;
}

function statusBadge(status:string){
  if(status==='working')return <span className="badge success">В работе</span>;
  if(status==='archived')return <span className="badge neutral">Архив</span>;
  return <span className="badge">Новый</span>;
}

export default function Home(){
  const [view,setView]=useState('Обзор'),[records,setRecords]=useState<RecordItem[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[query,setQuery]=useState(''),[filter,setFilter]=useState('all');
  const [modal,setModal]=useState<{kind:Kind;item?:RecordItem}|null>(null),[form,setForm]=useState<any>({}),[secret,setSecret]=useState(''),[clearSecret,setClearSecret]=useState(false),[formError,setFormError]=useState(''),[busy,setBusy]=useState(false),[deleting,setDeleting]=useState<RecordItem|null>(null),[detail,setDetail]=useState<RecordItem|null>(null),[importOpen,setImportOpen]=useState(false),[importText,setImportText]=useState('');

  const refresh=useCallback(async()=>{try{const data=await api();setRecords(data.records);setError('')}catch(e){setError((e as Error).message)}finally{setLoading(false)}},[]);
  useEffect(()=>{refresh()},[refresh]);
  const navigate=(name:string)=>{setView(name);setQuery('');setFilter('all')};
  const open=(kind:Kind,item?:RecordItem)=>{setModal({kind,item});setForm({...defaults[kind],...item?.data});setSecret('');setClearSecret(false);setFormError('')};

  useEffect(()=>{
    const context=(document as any).modelContext;
    if(!context?.registerTool)return;
    const abort=new AbortController();
    Promise.resolve(context.registerTool({
      name:'start_group_creation',
      description:'Открыть форму добавления группы Telegram. Не вступает в группу.',
      inputSchema:{type:'object',properties:{},additionalProperties:false},
      annotations:{readOnlyHint:false},
      execute(input:unknown){
        if(!input||typeof input!=='object'||Object.keys(input).length)throw new Error('Ожидается пустой объект');
        navigate('Группы и каналы');open('group');return {opened:true};
      }
    },{signal:abort.signal})).catch(()=>{});
    return()=>abort.abort();
  },[]);

  const list=(kind:Kind)=>records.filter(r=>r.kind===kind);
  const settings=list('settings')[0];

  async function save(e:React.FormEvent){
    e.preventDefault();if(!modal)return;setBusy(true);setFormError('');
    try{await api({action:'save',kind:modal.kind,id:modal.item?.id,data:form,secret,clearSecret});await refresh();setModal(null);setSecret('');toast.success('Изменения сохранены')}
    catch(e){setFormError((e as Error).message)}finally{setBusy(false)}
  }
  async function remove(){
    if(!deleting)return;setBusy(true);
    try{await api({action:'delete',kind:deleting.kind,id:deleting.id});await refresh();setDeleting(null);toast.success('Запись удалена')}
    catch(e){toast.error((e as Error).message)}finally{setBusy(false)}
  }
  async function draft(item:RecordItem){
    setBusy(true);
    try{const r=await api({action:'draft',id:item.id});await refresh();setDetail({...item,data:{...item.data,draft:r.draft}});toast.success('Черновик готов')}
    catch(e){toast.error((e as Error).message)}finally{setBusy(false)}
  }
  async function importProxies(){
    setBusy(true);setFormError('');
    try{
      const lines=importText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      if(!lines.length||lines.length>100)throw new Error('Введите от 1 до 100 прокси');
      const parsed=lines.map((line,i)=>{
        let u:URL;
        try{u=new URL(line.includes('://')?line:'socks5://'+line)}catch{throw new Error(`Строка ${i+1}: проверьте формат`)}
        const port=u.port||(u.protocol==='http:'?'80':'');
        if(!['socks5:','http:'].includes(u.protocol)||!u.hostname||!port||Number(port)>65535||(u.pathname&&u.pathname!=='/')||u.search||u.hash)throw new Error(`Строка ${i+1}: нужен socks5://login:password@host:port`);
        return {data:{name:'Прокси '+u.hostname+':'+port,host:u.hostname,port,protocol:u.protocol.slice(0,-1),username:decodeURIComponent(u.username)},secret:decodeURIComponent(u.password)};
      });
      let done=0;
      for(const row of parsed){await api({action:'save',kind:'proxy',...row});done++;setImportText(lines.slice(done).join('\n'))}
      await refresh();setImportOpen(false);setImportText('');toast.success(`Добавлено прокси: ${done}`);
    }catch(e){setFormError((e as Error).message);await refresh()}finally{setBusy(false)}
  }

  const currentKind=kinds[view];
  const displayed=records.filter(r=>r.kind===(currentKind||'lead')&&(view!=='Переписки'||r.data.draft)&&(filter==='all'||r.data.status===filter)&&JSON.stringify(r.data).toLowerCase().includes(query.toLowerCase()));
  const change=(key:string,value:string)=>setForm((f:any)=>({...f,[key]:value}));
  const field=(key:string,label:string,type='text',placeholder='')=><label className="field">{label}<Input type={type} value={form[key]??''} placeholder={placeholder} onChange={e=>change(key,e.target.value)} required={!['username','source'].includes(key)} maxLength={key==='phone'?16:250}/></label>;

  const EmptyLeads=()=> (
    <Empty className="empty-state border-0">
      <EmptyHeader>
        <div className="icon-box mx-auto mb-3"><Search size={22}/></div>
        <EmptyTitle>Пока нет подходящих запросов</EmptyTitle>
        <EmptyDescription>Добавьте группы селлеров или внесите первый лид вручную.</EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" onClick={()=>open('lead')}><Plus size={16}/>Добавить лид</Button>
    </Empty>
  );

  const renderLeads=(items:RecordItem[])=>items.length?items.map(r=>(
    <div className="lead-row" key={r.id}>
      <button className="text-left flex-1 min-w-0" onClick={()=>setDetail(r)}>
        <div className="flex gap-3 items-center flex-wrap">
          <span className="row-title">{r.data.name}</span>
          {statusBadge(r.data.status)}
        </div>
        <p className="mt-2 text-[14px] leading-6 line-clamp-2 muted">{r.data.message}</p>
        <p className="small-note mt-2">{r.data.source} · {new Date(r.created).toLocaleDateString('ru-RU')}</p>
      </button>
      <Button variant="ghost" onClick={()=>setDetail(r)}>Открыть<ChevronRight size={16}/></Button>
    </div>
  )):<EmptyLeads/>;

  const stats=[
    {label:'Всего лидов',n:list('lead').length,sub:'Запросы потенциальных клиентов',Icon:Users,tone:'blue'},
    {label:'В работе',n:list('lead').filter(r=>r.data.status==='working').length,sub:'Отобраны для общения',Icon:MessageSquare,tone:'green'},
    {label:'Группы и каналы',n:list('group').length,sub:'Добавленные источники',Icon:Radio,tone:'cyan'},
    {label:'Аккаунты',n:list('account').length,sub:'Сохранённые аккаунты',Icon:Shield,tone:'orange'},
  ] as const;

  return (
    <SidebarProvider className="spike-shell" style={{'--sidebar-width':'270px'} as React.CSSProperties}>
      <Toaster position="bottom-right" richColors/>
      <Sidebar>
        <SidebarHeader className="p-5">
          <div className="spike-brand">
            <div className="spike-brand-mark">U</div>
            <div className="spike-brand-text">
              <strong>Uniseller</strong>
              <span>Admin Panel</span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <div className="nav-caption">Рабочее пространство</div>
          <SidebarMenu className="px-3 gap-1">
            {nav.map(([name,Icon],i)=>(
              <SidebarMenuItem key={name}>
                {i===3&&<div className="nav-caption">Подключения</div>}
                <SidebarMenuButton className="nav-item" isActive={view===name} onClick={()=>navigate(name)}>
                  <Icon/><span>{name}</span>
                  {name==='Лиды'&&<span className="nav-count">{list('lead').length}</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <div className="sidebar-help">
            <Plug size={18}/>
            <p>Telegram ещё не подключён</p>
            <button onClick={()=>navigate('Аккаунты')}>Настроить аккаунты <ArrowRight size={13}/></button>
          </div>
          <div className="foot-account">
            <span className="workspace-avatar">US</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Администратор</p>
              <p className="small-note">Личное пространство</p>
            </div>
            <a className="text-link" href="/api/auth/logout?return_to=%2Flogin" title="Выйти" aria-label="Выйти"><LogOut size={16}/></a>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="topbar">
          <div className="flex items-center gap-3 text-sm">
            <SidebarTrigger/>
            <span className="muted hidden sm:inline">Uniseller</span>
            <ChevronRight size={14} className="text-[var(--spike-muted)]"/>
            <span className="font-semibold">{view}</span>
          </div>
          <a className="text-link flex items-center gap-2" href="https://uniseller.io" target="_blank" rel="noreferrer">
            Продукт<ExternalLink size={13}/>
          </a>
        </header>

        <div className="workspace" key={view}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">Telegram · Uniseller</div>
              <h1>{view==='Обзор'?'Рабочее пространство':view}</h1>
              <p className="muted mt-2">{viewCopy[view]}</p>
            </div>
            <Button onClick={()=>open(currentKind||'group',currentKind==='settings'?settings:undefined)}>
              <Plus size={16}/>{currentKind==='settings'?'Настроить AI':'Добавить '+labels[currentKind||'group']}
            </Button>
          </div>

          {error&&(
            <div role="alert" className="error-banner">
              {error}
              <Button variant="ghost" onClick={refresh}>Повторить</Button>
              {error.includes('Войдите')&&<a href="/login?return_to=%2F" target="_top" className="text-link">Войти</a>}
            </div>
          )}

          {view==='Обзор'&&<>
            <div className="stats">
              {stats.map(({label,n,sub,Icon,tone})=>(
                <div className="stat" key={label}>
                  <div className="stat-label">
                    {label}
                    <span className={`stat-icon ${tone}`}><Icon size={18}/></span>
                  </div>
                  <div className="stat-number"><AnimatedNumber value={loading?'—':n}/></div>
                  <p className="small-note">{sub}</p>
                </div>
              ))}
            </div>

            <div className="setup">
              <div className="title-icon">
                <div className="icon-box"><Plug size={22}/></div>
                <div>
                  <h2>Подключите Telegram, чтобы начать сбор</h2>
                  <p className="muted">Сейчас доступны настройки и ручная работа с лидами.</p>
                </div>
              </div>
              <Button variant="outline" onClick={()=>navigate('Аккаунты')}>К подключениям<ArrowRight size={15}/></Button>
            </div>

            <div className="split">
              <section className="panel table-panel">
                <div className="panel-heading">
                  <h2>Последние лиды</h2>
                  <Button variant="ghost" onClick={()=>navigate('Лиды')}>Все лиды<ArrowRight size={14}/></Button>
                </div>
                {renderLeads(list('lead').slice(0,4))}
              </section>
              <aside className="panel">
                <div className="flex items-center justify-between mb-2">
                  <h2>Быстрый старт</h2>
                  <span className="badge">{[list('account').length,list('proxy').length,list('group').length,settings?.hasSecret].filter(Boolean).length} / 4</span>
                </div>
                {[
                  {s:'Добавьте аккаунт',v:'Аккаунты',done:list('account').length},
                  {s:'Назначьте прокси',v:'Прокси',done:list('proxy').length},
                  {s:'Добавьте группы',v:'Группы и каналы',done:list('group').length},
                  {s:'Настройте AI',v:'AI-ассистент',done:settings?.hasSecret},
                ].map((s,i)=>(
                  <button className="steps w-full text-left" key={s.s} onClick={()=>navigate(s.v)}>
                    <span className={'step-num '+(s.done?'step-done':'')}>{s.done?<Check size={14}/>:i+1}</span>
                    <span className="text-sm leading-6 flex-1 font-medium">{s.s}</span>
                    <ChevronRight size={14} className="text-[var(--spike-muted)]"/>
                  </button>
                ))}
                <p className="small-note mt-4">Ответы проверяются вами перед отправкой.</p>
              </aside>
            </div>

            <div className="topic-row">
              <span className="muted">Ищем потребности в</span>
              {['Синхронизации остатков','МойСклад и 1С','Управлении ценами','Ответах на отзывы'].map(t=><span className="topic" key={t}>{t}</span>)}
            </div>
          </>}

          {view!=='Обзор'&&view!=='AI-ассистент'&&<>
            <div className="toolbar">
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-2.5 text-[var(--spike-muted)]" size={16}/>
                <Input className="pl-9" placeholder="Поиск по списку…" aria-label="Поиск по списку" value={query} onChange={e=>setQuery(e.target.value)}/>
              </div>
              {currentKind==='lead'?(
                <Tabs value={filter} onValueChange={setFilter}>
                  <TabsList>
                    <TabsTrigger value="all">Все</TabsTrigger>
                    <TabsTrigger value="new">Новые</TabsTrigger>
                    <TabsTrigger value="working">В работе</TabsTrigger>
                    <TabsTrigger value="archived">Архив</TabsTrigger>
                  </TabsList>
                </Tabs>
              ):currentKind==='proxy'?(
                <Button variant="outline" onClick={()=>{setImportOpen(true);setFormError('')}}><Upload size={15}/>Импорт списком</Button>
              ):(
                <span className="badge neutral">{displayed.length} записей</span>
              )}
            </div>
            {currentKind!=='lead'&&(
              <div className="status-note">
                {currentKind==='account'?'Сохраняется карточка аккаунта. Вход по коду или импорт tdata и проверка сессии пока не подключены.':currentKind==='proxy'?'Прокси сохраняются с зашифрованным паролем. Проверка соединения станет доступна вместе с Telegram-подключением.':'Группы сохраняются как источники. Вступление и чтение сообщений пока не подключены.'}
              </div>
            )}
            <section className="panel table-panel">
              {loading?(
                <div className="p-6 space-y-4"><Skeleton className="h-12 w-full"/><Skeleton className="h-12 w-full"/></div>
              ):currentKind==='lead'?renderLeads(displayed):displayed.length?(
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Название</TableHead>
                      <TableHead>{currentKind==='account'?'Телефон':currentKind==='proxy'?'Адрес':'Ссылка'}</TableHead>
                      <TableHead>{currentKind==='account'?'Прокси':currentKind==='proxy'?'Тип':'Аккаунт'}</TableHead>
                      <TableHead>Состояние</TableHead>
                      <TableHead className="text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayed.map(r=>(
                      <TableRow key={r.id}>
                        <TableCell className="font-semibold">{r.data.name}</TableCell>
                        <TableCell>{r.data.phone||r.data.url||r.data.host+':'+r.data.port}</TableCell>
                        <TableCell>{currentKind==='proxy'?r.data.protocol.toUpperCase():records.find(x=>x.id===(r.data.proxyId||r.data.accountId))?.data.name||'Не назначен'}</TableCell>
                        <TableCell><span className="badge warning">{currentKind==='proxy'?'Не проверен':'Требует подключения'}</span></TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" aria-label={'Изменить '+r.data.name} onClick={()=>open(r.kind,r)}><Pencil size={15}/></Button>
                            <Button variant="ghost" size="icon" aria-label={'Удалить '+r.data.name} onClick={()=>setDeleting(r)}><Trash2 size={15}/></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ):(
                <Empty className="empty-state border-0">
                  <EmptyHeader>
                    <div className="icon-box mx-auto mb-3"><Radio size={22}/></div>
                    <EmptyTitle>{query?'Ничего не найдено':'Здесь пока нет записей'}</EmptyTitle>
                    <EmptyDescription>{query?'Попробуйте другой запрос.':'Добавьте первое подключение для рабочего пространства.'}</EmptyDescription>
                  </EmptyHeader>
                  {!query&&<Button variant="outline" onClick={()=>open(currentKind)}><Plus size={15}/>Добавить {labels[currentKind]}</Button>}
                </Empty>
              )}
            </section>
          </>}

          {view==='AI-ассистент'&&(
            <div className="section-grid">
              <section className="panel">
                <div className="flex justify-between items-center mb-6">
                  <div className="title-icon">
                    <div className="icon-box"><Sparkles size={22}/></div>
                    <h2>Контекст Uniseller</h2>
                  </div>
                  <span className={`badge ${settings?.hasSecret?'success':'warning'}`}>{settings?.hasSecret?'Ключ сохранён':'Ключ не добавлен'}</span>
                </div>
                <p className="text-[15px] leading-7 whitespace-pre-wrap">{settings?.data.product||defaults.settings.product}</p>
                <h2 className="mt-7 mb-3">Темы поиска</h2>
                <div className="flex flex-wrap gap-2">
                  {(settings?.data.keywords||defaults.settings.keywords).split(',').map((t:string)=><span className="topic" key={t}>{t.trim()}</span>)}
                </div>
                <Button className="mt-7" variant="outline" onClick={()=>open('settings',settings)}><Pencil size={15}/>Изменить настройки</Button>
              </section>
              <section className="panel">
                <h2 className="mb-2">Как готовятся ответы</h2>
                <div className="steps"><span className="step-num">1</span><p className="text-sm leading-6">Откройте лид с сообщением селлера.</p></div>
                <div className="steps"><span className="step-num">2</span><p className="text-sm leading-6">Нажмите «Подготовить ответ». Текст сообщения будет передан OpenAI.</p></div>
                <div className="steps"><span className="step-num">3</span><p className="text-sm leading-6">Проверьте черновик и скопируйте его для отправки.</p></div>
                <p className="muted mt-5">Модель: {settings?.data.model||defaults.settings.model}. Запросы оплачиваются через ваш API-аккаунт.</p>
                <p className="small-note mt-4">Автоматический отбор сообщений и отправка в Telegram появятся после подключения сборщика.</p>
              </section>
            </div>
          )}

          <footer className="app-footer">
            <span>Uniseller · Поиск клиентов</span>
            <span>Spike-inspired admin · Отправка вручную</span>
          </footer>
        </div>
      </SidebarInset>

      <Dialog open={!!modal} onOpenChange={o=>{if(!o&&!busy){setModal(null);setSecret('')}}}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{modal?.item?'Изменить':'Добавить'} {modal?labels[modal.kind]:''}</DialogTitle>
            <DialogDescription>{modal?.kind==='settings'?'Контекст и ключ для подготовки ответов.':'Запись будет сохранена в вашем рабочем пространстве.'}</DialogDescription>
          </DialogHeader>
          <form className="form-stack" onSubmit={save}>
            {field('name','Название')}
            {modal?.kind==='account'&&<>
              {field('phone','Телефон','tel','+79991234567')}
              <label className="field">Прокси<Pick value={form.proxyId} onChange={v=>change('proxyId',v)} options={list('proxy').map(r=>({id:r.id,name:r.data.name}))} placeholder="Без прокси"/></label>
              <p className="small-note">Это карточка аккаунта. Авторизация в Telegram пока недоступна.</p>
            </>}
            {modal?.kind==='proxy'&&<>
              <div className="grid grid-cols-2 gap-4">{field('host','IP или хост','text','192.0.2.1')}{field('port','Порт','number','1080')}</div>
              <label className="field">Протокол
                <Select value={form.protocol} onValueChange={v=>change('protocol',v)}>
                  <SelectTrigger className="w-full"><SelectValue/></SelectTrigger>
                  <SelectContent><SelectItem value="socks5">SOCKS5</SelectItem><SelectItem value="http">HTTP</SelectItem></SelectContent>
                </Select>
              </label>
              {field('username','Логин')}
              <label className="field">Пароль
                <Input type="password" autoComplete="new-password" value={secret} onChange={e=>{setSecret(e.target.value);setClearSecret(false)}} placeholder={modal.item?.hasSecret?'Сохранён. Оставьте пустым, чтобы не менять':'Пароль прокси'}/>
              </label>
            </>}
            {modal?.kind==='group'&&<>
              {field('url','Ссылка на группу или канал','text','https://t.me/sellers_group')}
              <label className="field">Аккаунт<Pick value={form.accountId} onChange={v=>change('accountId',v)} options={list('account').map(r=>({id:r.id,name:r.data.name}))} placeholder="Назначить позже"/></label>
              <p className="small-note">Добавление источника не вступает в группу.</p>
            </>}
            {modal?.kind==='lead'&&<>
              {field('source','Источник','text','Название группы')}
              <label className="field">Сообщение селлера<Textarea required rows={5} value={form.message||''} onChange={e=>change('message',e.target.value)}/></label>
              <label className="field">Статус
                <Select value={form.status} onValueChange={v=>change('status',v)}>
                  <SelectTrigger className="w-full"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Новый</SelectItem>
                    <SelectItem value="working">В работе</SelectItem>
                    <SelectItem value="archived">Архив</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              {form.draft&&<label className="field">Черновик<Textarea rows={5} value={form.draft} onChange={e=>change('draft',e.target.value)}/></label>}
            </>}
            {modal?.kind==='settings'&&<>
              <label className="field">О продукте и правилах ответа<Textarea rows={5} value={form.product||''} onChange={e=>change('product',e.target.value)}/></label>
              <label className="field">Темы поиска, через запятую<Textarea value={form.keywords||''} onChange={e=>change('keywords',e.target.value)}/></label>
              {field('model','Модель OpenAI')}
              <label className="field">API-ключ OpenAI
                <Input type="password" autoComplete="new-password" value={secret} onChange={e=>{setSecret(e.target.value);setClearSecret(false)}} placeholder={settings?.hasSecret?'Ключ сохранён. Введите новый для замены':'sk-…'}/>
              </label>
              <p className="small-note">Ключ хранится зашифрованным и не возвращается в браузер после сохранения.</p>
            </>}
            {modal?.item?.hasSecret&&['proxy','settings'].includes(modal.kind)&&(
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={clearSecret} onCheckedChange={v=>{setClearSecret(v===true);if(v)setSecret('')}}/>
                Удалить сохранённый {modal.kind==='settings'?'API-ключ':'пароль'}
              </label>
            )}
            {formError&&<p role="alert" className="form-error">{formError}</p>}
            <Button type="submit" disabled={busy}>{busy&&<Loader2 className="animate-spin" size={15}/>}Сохранить</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={o=>{if(!busy){setImportOpen(o);if(!o)setImportText('')}}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Импорт прокси</DialogTitle>
            <DialogDescription>По одному на строку: socks5://login:password@host:port</DialogDescription>
          </DialogHeader>
          <Textarea aria-label="Список прокси" rows={7} value={importText} onChange={e=>setImportText(e.target.value)}/>
          <label className="field">Или загрузите .txt
            <Input type="file" accept=".txt" onChange={async e=>{const f=e.target.files?.[0];if(f){if(f.size>50000){setFormError('Файл больше 50 КБ');return}setImportText(await f.text())}}}/>
          </label>
          {formError&&<p className="form-error">{formError}</p>}
          <Button disabled={busy} onClick={importProxies}>{busy?'Сохранение…':'Импортировать'}</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={o=>{if(!o)setDetail(null)}}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{detail?.data.name}</DialogTitle>
            <DialogDescription>{detail?.data.source} · Запрос селлера</DialogDescription>
          </DialogHeader>
          <p className="draft">{detail?.data.message}</p>
          {detail?.data.draft&&<>
            <h2>Черновик ответа</h2>
            <p className="draft">{detail.data.draft}</p>
            <Button variant="outline" onClick={async()=>{try{await navigator.clipboard.writeText(detail.data.draft);toast.success('Черновик скопирован')}catch{toast.error('Не удалось скопировать. Выделите текст вручную.')}}}>Скопировать ответ</Button>
          </>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={()=>detail&&draft(detail)}><Sparkles size={16}/>{busy?'Готовим…':'Подготовить ответ'}</Button>
            <Button variant="outline" onClick={()=>{if(detail){open('lead',detail);setDetail(null)}}}>Редактировать</Button>
            <Button variant="ghost" onClick={()=>{setDeleting(detail);setDetail(null)}}><Trash2 size={15}/></Button>
          </div>
          <p className="small-note">Подготовка передаст сообщение в OpenAI. Отправка в Telegram пока выполняется вручную.</p>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={o=>{if(!o&&!busy)setDeleting(null)}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить «{deleting?.data.name}»?</AlertDialogTitle>
            <AlertDialogDescription>Запись будет удалена из админки. Это не удаляет аккаунт Telegram и не выходит из группы.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={e=>{e.preventDefault();remove()}}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
