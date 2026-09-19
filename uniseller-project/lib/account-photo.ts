/** Клиентская подготовка фото профиля аккаунта (сжатие до JPEG data URL). */

export const ACCOUNT_PHOTO_MAX_INPUT_BYTES=2_500_000;
export const ACCOUNT_PHOTO_MAX_EDGE=320;
export const ACCOUNT_PHOTO_QUALITY=0.78;
export const ACCOUNT_PHOTO_MAX_DATA_URL=320_000;

export function isAllowedAccountPhotoFile(file:File):boolean{
  return ['image/jpeg','image/png','image/webp'].includes(file.type)&&file.size>0&&file.size<=ACCOUNT_PHOTO_MAX_INPUT_BYTES;
}

export async function fileToAccountPhotoDataUrl(
  file:File,
  options:{
    maxEdge?:number;
    quality?:number;
    maxDataUrlLength?:number;
    createImageBitmapFn?:typeof createImageBitmap;
    canvasFactory?:()=>HTMLCanvasElement;
  }={},
):Promise<string>{
  if(!isAllowedAccountPhotoFile(file)){
    throw new Error('Выберите JPEG, PNG или WebP до 2.5 МБ');
  }
  const maxEdge=options.maxEdge??ACCOUNT_PHOTO_MAX_EDGE;
  const quality=options.quality??ACCOUNT_PHOTO_QUALITY;
  const maxDataUrlLength=options.maxDataUrlLength??ACCOUNT_PHOTO_MAX_DATA_URL;
  const createBitmap=options.createImageBitmapFn??createImageBitmap;
  const canvas=options.canvasFactory?options.canvasFactory():document.createElement('canvas');

  const bitmap=await createBitmap(file);
  try{
    const scale=Math.min(1,maxEdge/Math.max(bitmap.width,bitmap.height));
    const width=Math.max(1,Math.round(bitmap.width*scale));
    const height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.width=width;
    canvas.height=height;
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Не удалось обработать изображение');
    ctx.drawImage(bitmap,0,0,width,height);
    let dataUrl=canvas.toDataURL('image/jpeg',quality);
    if(dataUrl.length>maxDataUrlLength){
      dataUrl=canvas.toDataURL('image/jpeg',Math.max(0.45,quality-0.2));
    }
    if(dataUrl.length>maxDataUrlLength){
      throw new Error('Фото слишком большое после сжатия. Выберите другое изображение');
    }
    return dataUrl;
  }finally{
    bitmap.close?.();
  }
}
