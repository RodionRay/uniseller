"use client";

import {useRef} from 'react';
import {ImagePlus,Trash2} from 'lucide-react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {ACCOUNT_STATUS_LABELS} from '@/lib/processes/accounts';
import {fileToAccountPhotoDataUrl} from '@/lib/account-photo';

type ProxyOption={id:string;name:string};

export function AccountFormFields({
  form,
  change,
  onPhoto,
  onError,
  proxies,
  Pick,
}:{
  form:any;
  change:(key:string,value:string|number)=>void;
  onPhoto:(dataUrl:string)=>void;
  onError:(message:string)=>void;
  proxies:ProxyOption[];
  Pick:React.ComponentType<{
    value:string;
    onChange:(s:string)=>void;
    options:{id:string;name:string}[];
    placeholder:string;
  }>;
}){
  const fileRef=useRef<HTMLInputElement>(null);

  async function onPickPhoto(file:File|undefined){
    if(!file)return;
    try{
      onPhoto(await fileToAccountPhotoDataUrl(file));
    }catch(e){
      onError((e as Error).message);
    }
  }

  return (
    <>
      <div className="account-photo-row">
        <div className="account-photo-preview" aria-hidden>
          {form.photo
            ?<img src={form.photo} alt="" className="account-photo-img"/>
            :<span className="account-photo-placeholder">{(form.name||'?').slice(0,1).toUpperCase()}</span>}
        </div>
        <div className="account-photo-actions">
          <p className="text-sm font-medium mb-2">Фото профиля</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label="Загрузить фото аккаунта"
            onChange={async(e)=>{
              await onPickPhoto(e.target.files?.[0]);
              e.target.value='';
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={()=>fileRef.current?.click()}>
              <ImagePlus size={14}/>{form.photo?'Заменить фото':'Добавить фото'}
            </Button>
            {!!form.photo&&(
              <Button type="button" variant="ghost" size="sm" onClick={()=>onPhoto('')}>
                <Trash2 size={14}/>Убрать
              </Button>
            )}
          </div>
          <p className="small-note mt-2">JPEG/PNG/WebP до 2.5 МБ. Сохраняется сжатым в карточке аккаунта.</p>
        </div>
      </div>

      <label className="field">Название
        <Input value={form.name??''} onChange={(e)=>change('name',e.target.value)} required maxLength={200}/>
      </label>
      <label className="field">Телефон
        <Input type="tel" value={form.phone??''} placeholder="+79991234567" onChange={(e)=>change('phone',e.target.value)} required maxLength={16}/>
      </label>
      <label className="field">Прокси
        <Pick
          value={form.proxyId||''}
          onChange={(v)=>change('proxyId',v)}
          options={proxies}
          placeholder="Без прокси"
        />
      </label>
      <label className="field">Статус
        <Select value={form.status||'setup'} onValueChange={(v)=>change('status',v)}>
          <SelectTrigger className="w-full"><SelectValue/></SelectTrigger>
          <SelectContent>
            {Object.entries(ACCOUNT_STATUS_LABELS).map(([value,label])=>(
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <div className="account-limits-grid">
        {([
          ['limitJoins','Вступления'],
          ['limitInvites','Инвайт людей'],
          ['limitMessages','Сообщения'],
          ['limitChats','Чаты'],
        ] as const).map(([key,label])=>(
          <label className="field" key={key}>{label}
            <Input
              type="number"
              min={0}
              max={1000}
              value={form[key]??0}
              onChange={(e)=>change(key,Number(e.target.value))}
            />
          </label>
        ))}
      </div>
      <p className="small-note">Дневные лимиты (сброс 00:00 МСК). «Вступления» — join в группы; «Инвайт людей» — модуль инвайтинга.</p>

      <div className="grid grid-cols-2 gap-4">
        <label className="field">Имя
          <Input value={form.firstName??''} onChange={(e)=>change('firstName',e.target.value)} maxLength={200}/>
        </label>
        <label className="field">Фамилия
          <Input value={form.lastName??''} onChange={(e)=>change('lastName',e.target.value)} maxLength={200}/>
        </label>
      </div>
      <label className="field">Логин Telegram
        <Input
          value={form.username??''}
          placeholder="username без @"
          onChange={(e)=>change('username',e.target.value.replace(/^@/,''))}
          maxLength={32}
        />
      </label>
      <p className="small-note">Без @username нельзя вступать в группы. При создании аккаунта ник можно оставить пустым и заполнить позже.</p>
    </>
  );
}
