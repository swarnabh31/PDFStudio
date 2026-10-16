export const $=<T extends HTMLElement=HTMLElement>(s:string):T=>document.querySelector(s) as T;
export const base=(n:string)=>n.replace(/\.pdf$/i,'');
export function download(name:string,data:Uint8Array,type='application/pdf'){
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data as BlobPart],{type}));a.download=name;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}
let tm:number;
export function toast(t:string){const m=$('#msg');m.textContent=t;m.style.display='block';clearTimeout(tm);tm=window.setTimeout(()=>m.style.display='none',3500)}

// "1-3, 5, 8-10" -> [[0,1,2],[4],[7,8,9]] (zero-based page indices)
export function parseRanges(s:string,max:number):number[][]{
  return s.split(',').map(x=>x.trim()).filter(Boolean).map(part=>{
    const m=/^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);if(!m)throw new Error(`Bad range “${part}”`);
    const a=+m[1],b=+(m[2]??m[1]);if(a<1||b<a||b>max)throw new Error(`“${part}” is outside 1–${max}`);
    return Array.from({length:b-a+1},(_,i)=>a-1+i);
  });
}
/** Any browser-readable image (png/jpg/webp/gif…) -> PNG bytes, longest side capped. */
export async function toPng(f:Blob,max=2000){
  const bm=await createImageBitmap(f),s=Math.min(1,max/Math.max(bm.width,bm.height)),c=document.createElement('canvas');
  c.width=Math.round(bm.width*s);c.height=Math.round(bm.height*s);c.getContext('2d')!.drawImage(bm,0,0,c.width,c.height);
  return new Uint8Array(await (await new Promise<Blob>(r=>c.toBlob(b=>r(b!),'image/png'))).arrayBuffer());
}
/** While dragging, scroll `panel` when the pointer (read from `y`) is near its top/bottom edge. Returns a stop function. */
export function edgeScroll(panel:HTMLElement,y:()=>number,inset=0,moved=()=>{}){
  const t=setInterval(()=>{
    const r=panel.getBoundingClientRect(),top=r.top+inset+50,bot=r.bottom-50,p=y(),v=p<top?p-top:p>bot?p-bot:0;
    if(v){panel.scrollBy(0,Math.max(-24,Math.min(24,v/2)));moved()}
  },16);
  return ()=>clearInterval(t);
}
