import {z} from 'zod';

export const kindSchema=z.enum(['account','proxy','group','lead','settings']);
export type WorkspaceKind=z.infer<typeof kindSchema>;

const short=z.string().trim().min(1).max(200);
const optionalText=z.string().max(200).default('');
const dayLimit=z.coerce.number().int().min(0).max(1000);

export const settingsSchema=z.object({
  name:short,
  product:z.string().max(8000),
  keywords:z.string().max(2000),
  model:short,
});

export const accountStatusSchema=z.enum(['setup','active','paused','error']);

export const accountSchema=z.object({
  name:short,
  phone:z.string().regex(/^\+[1-9]\d{7,14}$/),
  proxyId:z.string().max(100).default(''),
  status:accountStatusSchema.default('setup'),
  limitJoins:dayLimit.default(10),
  limitInvites:dayLimit.default(40),
  limitMessages:dayLimit.default(10),
  limitChats:dayLimit.default(10),
  firstName:optionalText,
  lastName:optionalText,
  username:z.string().trim().max(32).regex(/^[a-zA-Z0-9_]*$/).default(''),
  photo:z.string().max(350_000).refine(
    (v)=>!v||/^data:image\/(jpeg|png|webp);base64,/.test(v),
    {message:'Некорректное фото'},
  ).default(''),
});

export const proxySchema=z.object({
  name:short,
  host:z.string().trim().regex(/^[a-zA-Z0-9.-]+$/).max(253),
  port:z.coerce.number().int().min(1).max(65535),
  protocol:z.enum(['socks5','http']),
  username:z.string().max(200).default(''),
});

export const groupSchema=z.object({
  name:short,
  url:z.string().trim().regex(/^(?:https:\/\/t\.me\/(?:\+|joinchat\/)?[a-zA-Z0-9_-]+|@[a-zA-Z0-9_]{5,32})$/),
  accountId:z.string().max(100).default(''),
});

export const leadSchema=z.object({
  name:short,
  message:z.string().trim().min(3).max(8000),
  source:z.string().max(200).default('Вручную'),
  status:z.enum(['new','working','archived']).default('new'),
  draft:z.string().max(10000).default(''),
});

export const schemas={
  account:accountSchema,
  proxy:proxySchema,
  group:groupSchema,
  lead:leadSchema,
  settings:settingsSchema,
} as const;

/** Лимит тела POST: фото аккаунта в base64 требует больше 30 КБ. */
export const WORKSPACE_BODY_LIMIT=400_000;
