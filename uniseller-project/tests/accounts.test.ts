import {describe,expect,it} from 'vitest';
import {accountSchema,groupSchema,leadSchema,proxySchema,schemas,WORKSPACE_BODY_LIMIT} from '@/lib/workspace-schemas';
import {
  accountSetupStatus,
  canDeleteConnection,
  isAccountInUse,
  isProxyInUse,
  parseAccount,
  resolveAccountStatus,
} from '@/lib/processes/accounts';
import {isAllowedAccountPhotoFile} from '@/lib/account-photo';

describe('аккаунты',()=>{
  it('принимает валидный телефон, статус, лимиты и фото',()=>{
    expect(parseAccount({
      name:'Основной',
      phone:'+79991234567',
      proxyId:'',
      status:'active',
      limitJoins:10,
      limitInvites:40,
      limitMessages:10,
      limitChats:10,
      firstName:'Uniseller',
      lastName:'Сервис',
      username:'cedardesk403',
      photo:'data:image/jpeg;base64,/9j/4AAQ',
    })).toMatchObject({
      name:'Основной',
      phone:'+79991234567',
      status:'active',
      username:'cedardesk403',
    });
  });

  it('отклоняет телефон без плюса и коротких номеров',()=>{
    expect(()=>accountSchema.parse({name:'A',phone:'79991234567'})).toThrow();
    expect(()=>accountSchema.parse({name:'A',phone:'+123'})).toThrow();
    expect(()=>accountSchema.parse({name:'A',phone:'+0123456789'})).toThrow();
  });

  it('не затирает выбранный статус при сохранении',()=>{
    expect(resolveAccountStatus('active','setup',false)).toBe('active');
    expect(resolveAccountStatus(undefined,'active',false)).toBe('active');
    expect(resolveAccountStatus(undefined,undefined,true)).toBe('setup');
  });

  it('блокирует удаление прокси, назначенного аккаунту',()=>{
    const accounts=[{id:'a1',data:{proxyId:'p1'}}];
    expect(isProxyInUse(accounts,'p1')).toBe(true);
    expect(canDeleteConnection('proxy','p1',accounts)).toEqual({
      ok:false,
      error:'Сначала измените привязку в аккаунтах или группах',
    });
    expect(canDeleteConnection('proxy','p2',accounts)).toEqual({ok:true});
  });

  it('блокирует удаление аккаунта, назначенного группе',()=>{
    const groups=[{id:'g1',data:{accountId:'acc-1'}}];
    expect(isAccountInUse(groups,'acc-1')).toBe(true);
    expect(canDeleteConnection('account','acc-1',groups).ok).toBe(false);
    expect(canDeleteConnection('account','acc-2',groups).ok).toBe(true);
  });

  it('отмечает готовность к авторизации при наличии прокси',()=>{
    expect(accountSetupStatus(false)).toBe('setup');
    expect(accountSetupStatus(true)).toBe('ready_for_auth');
  });

  it('валидирует прокси для привязки к аккаунту',()=>{
    expect(proxySchema.parse({
      name:'EU',
      host:'proxy.example.com',
      port:'1080',
      protocol:'socks5',
      username:'u',
    })).toMatchObject({port:1080,protocol:'socks5'});
    expect(()=>proxySchema.parse({
      name:'bad',
      host:'not a host',
      port:1080,
      protocol:'socks5',
    })).toThrow();
  });

  it('schemas.account совпадает с публичным API валидации',()=>{
    expect(schemas.account).toBe(accountSchema);
  });

  it('разрешает тело запроса с фото больше прежних 30 КБ',()=>{
    expect(WORKSPACE_BODY_LIMIT).toBeGreaterThan(30_000);
  });

  it('принимает только подходящие файлы фото',()=>{
    expect(isAllowedAccountPhotoFile(new File([new Uint8Array([1,2,3])],'a.jpg',{type:'image/jpeg'}))).toBe(true);
    expect(isAllowedAccountPhotoFile(new File([new Uint8Array([1])],'a.gif',{type:'image/gif'}))).toBe(false);
  });
});

describe('группы как источники для инвайтов',()=>{
  it('принимает публичные и invite-ссылки',()=>{
    expect(groupSchema.parse({name:'Sellers',url:'https://t.me/sellers_group',accountId:''}).url).toBe(
      'https://t.me/sellers_group',
    );
    expect(groupSchema.parse({name:'Private',url:'https://t.me/+AbCdEf12345',accountId:'a'}).accountId).toBe('a');
    expect(groupSchema.parse({name:'Handle',url:'@seller_chat',accountId:''}).url).toBe('@seller_chat');
  });

  it('отклоняет произвольные URL',()=>{
    expect(()=>groupSchema.parse({name:'X',url:'https://example.com/x'})).toThrow();
  });
});

describe('лиды',()=>{
  it('требует сообщение минимум из 3 символов',()=>{
    expect(leadSchema.parse({name:'Лид',message:'Нужна синхронизация остатков'})).toMatchObject({
      status:'new',
      source:'Вручную',
      draft:'',
    });
    expect(()=>leadSchema.parse({name:'Лид',message:'ab'})).toThrow();
  });
});
