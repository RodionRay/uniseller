import {env} from 'cloudflare:workers';
import {seal as sealSecret,unseal as unsealSecret} from '@/lib/crypto-secrets';

export const database=()=>{
  if(!env.DB)throw new Error('Хранилище недоступно');
  return env.DB;
};

async function ensureWorkerKey(){
  const fromEnv=(env as unknown as Record<string,string>).ENCRYPTION_KEY;
  if(fromEnv&&!process.env.ENCRYPTION_KEY){
    process.env.ENCRYPTION_KEY=fromEnv;
  }
}

export async function seal(value:string,owner:string){
  await ensureWorkerKey();
  return sealSecret(value,owner);
}

export async function unseal(value:string,owner:string){
  await ensureWorkerKey();
  return unsealSecret(value,owner);
}
