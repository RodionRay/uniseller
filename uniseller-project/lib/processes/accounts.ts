import {accountSchema} from '@/lib/workspace-schemas';

export type AccountRef={id:string;data:{proxyId?:string;accountId?:string;[key:string]:unknown}};

/** Валидация карточки Telegram-аккаунта. */
export function parseAccount(data:unknown){
  return accountSchema.parse(data);
}

/** Нельзя удалить прокси, пока он назначен аккаунту. */
export function isProxyInUse(accounts:AccountRef[],proxyId:string):boolean{
  return accounts.some((a)=>a.data.proxyId===proxyId);
}

/** Нельзя удалить аккаунт, пока он назначен группе. */
export function isAccountInUse(groups:AccountRef[],accountId:string):boolean{
  return groups.some((g)=>g.data.accountId===accountId);
}

export function canDeleteConnection(
  kind:'proxy'|'account',
  id:string,
  refs:AccountRef[],
):{ok:true}|{ok:false;error:string}{
  if(kind==='proxy'&&isProxyInUse(refs,id)){
    return {ok:false,error:'Сначала измените привязку в аккаунтах или группах'};
  }
  if(kind==='account'&&isAccountInUse(refs,id)){
    return {ok:false,error:'Сначала измените привязку в аккаунтах или группах'};
  }
  return {ok:true};
}

/** Статус карточки до подключения Telegram-сессии. */
export function accountSetupStatus(hasProxy:boolean):'setup'|'ready_for_auth'{
  return hasProxy?'ready_for_auth':'setup';
}

export const ACCOUNT_STATUS_LABELS={
  setup:'Требует подключения',
  active:'Активный',
  paused:'Пауза',
  error:'Ошибка',
} as const;

/** Не затираем выбранный статус аккаунта при каждом save (баг сохранения). */
export function resolveAccountStatus(
  incoming:string|undefined,
  existing:string|undefined,
  isCreate:boolean,
):string{
  if(incoming&&incoming in ACCOUNT_STATUS_LABELS)return incoming;
  if(existing&&existing in ACCOUNT_STATUS_LABELS)return existing;
  return isCreate?'setup':'setup';
}
