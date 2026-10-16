import {PDFDocument,degrees,type PDFImage} from 'pdf-lib';
import {$,base,download,toast,toPng,edgeScroll} from '../util';
import {getDoc,setDoc,onDoc,isLocked} from '../state';
import {openPdf,type View} from '../pdfview';
import {loadPdf} from '../pdfops';
import {drawSignature} from './signpad';
import {icon} from '../icons';

// Positions are fractions of the page as displayed (top-left origin) so they survive resizing.
interface Item{page:number;x:number;y:number;w:number;h:number;ar:number;png:Uint8Array;url:string}
let items:Item[]=[],dirty=true,tok=0,onChange=()=>{};
// Pending placements have their own undo/redo (snapshots of `items`); applying them commits one undoable document change.
let hist:Item[][]=[],fut:Item[][]=[];
const snap=()=>items.map(i=>({...i}));
const record=(before:Item[])=>{hist.push(before);fut.length=0;onChange()};
const host=()=>$('#pages'),pageEls=()=>[...host().querySelectorAll<HTMLElement>('.page')];
const upd=()=>{$<HTMLButtonElement>('#applyAnn').disabled=!items.length;onChange()};

async function render(){
  const my=++tok;dirty=false;items=[];hist=[];fut=[];upd();host().replaceChildren();
  const d=getDoc();if(!d){host().textContent='Open a PDF to add signatures or images.';return}
  if(await isLocked()){host().textContent='This PDF is password-protected — unlock it in the Password tab first.';return}
  const pdf:View=await openPdf(d.bytes),dpr=Math.min(window.devicePixelRatio||1,2);
  for(let p=0;p<pdf.numPages;p++){
    const pg=await pdf.getPage(p+1),vp=pg.getViewport({scale:1.6});if(my!==tok)return;
    const w=document.createElement('div');w.className='page';w.dataset.p=String(p);w.style.aspectRatio=`${vp.width}/${vp.height}`;
    const cv=document.createElement('canvas');cv.width=vp.width*dpr;cv.height=vp.height*dpr;w.append(cv);host().append(w);
    await pg.render({canvasContext:cv.getContext('2d')!,viewport:vp,transform:dpr!==1?[dpr,0,0,dpr,0,0]:undefined}).promise;
  }
}
export function showAnnotate(){if(dirty)render()}

function visiblePage(){
  const pgs=pageEls(),mid=innerHeight/2;
  return pgs.find(e=>{const r=e.getBoundingClientRect();return r.top<=mid&&r.bottom>=mid})||pgs.find(e=>e.getBoundingClientRect().bottom>0)||pgs[0]||null;
}
// height fraction that keeps the image's aspect ratio on a page of this displayed shape
const hFor=(it:Item,wrap:HTMLElement)=>{const r=wrap.getBoundingClientRect();return it.w*it.ar*r.width/r.height};

async function add(png:Uint8Array,wFrac:number){
  const wrap=visiblePage();if(!wrap)return toast('Open a PDF first.');
  const url=URL.createObjectURL(new Blob([png as BlobPart],{type:'image/png'})),im=new Image();im.src=url;await im.decode();
  const ar=im.naturalHeight/im.naturalWidth,r=wrap.getBoundingClientRect();
  let w=wFrac,h=w*ar*r.width/r.height;if(h>.5){h=.5;w=h*r.height/(ar*r.width)}
  const before=snap(),it:Item={page:+wrap.dataset.p!,x:(1-w)/2,y:.4,w,h,ar,png,url};items.push(it);record(before);mount(it);upd();
}

/** Show `it` on its page, with drag (also onto other pages), a resize handle, a page picker and a remove button. */
function mount(it:Item){
  let wrap=pageEls()[it.page];
  const box=document.createElement('div');box.className='ov';
  const im=new Image();im.src=it.url;im.draggable=false;
  const del=document.createElement('button');del.className='x';del.innerHTML=icon('x',13);del.title='Remove';del.setAttribute('aria-label','Remove');
    const sel=document.createElement('select');sel.className='pg';sel.title='Move to page';sel.setAttribute('aria-label','Move to page');
  pageEls().forEach((_,i)=>sel.add(new Option(`Page ${i+1}`,String(i))));
  // eight handles: edges stretch one way, corners resize proportionally from the opposite corner
  const hs=['nw','n','ne','e','se','s','sw','w'].map(d=>{const h=document.createElement('span');h.className='h';h.dataset.d=d;return h});
  box.append(im,del,sel,...hs);wrap.append(box);
  const lay=()=>{sel.value=String(it.page);Object.assign(box.style,{left:it.x*100+'%',top:it.y*100+'%',width:it.w*100+'%',height:it.h*100+'%'})};lay();
  const clamp=()=>{it.x=Math.min(Math.max(it.x,0),1-it.w);it.y=Math.min(Math.max(it.y,0),1-it.h)};
  const toPage=(p:HTMLElement)=>{ // re-parent onto another page, keeping the width fraction (height follows that page's shape)
    wrap=p;p.append(box);it.page=+p.dataset.p!;it.h=hFor(it,p);
    if(it.h>1){const r=p.getBoundingClientRect();it.h=1;it.w=it.h*r.height/(it.ar*r.width)}
  };
  sel.onchange=()=>{
    const before=snap(),p=pageEls()[+sel.value];toPage(p);clamp();lay();record(before);p.scrollIntoView({block:'center',behavior:'smooth'});
  };
  const bind=(el:HTMLElement,dir:string)=>el.addEventListener('pointerdown',e=>{
    if((e.target as HTMLElement).closest('button,select'))return;e.preventDefault();e.stopPropagation();el.setPointerCapture(e.pointerId);
    // While dragging the box stays in its original page (moving it in the DOM would drop pointer capture) and may overhang
    // neighbouring pages; on release it is re-parented to the page under the pointer.
    const before=snap(),home=wrap,panel=$('#p-annotate'),bx=box.getBoundingClientRect(),gx=e.clientX-bx.left,gy=e.clientY-bx.top,sx=e.clientX,sy=e.clientY,x0=it.x,y0=it.y,w0=it.w,h0=it.h;
    let cx=e.clientX,cy=e.clientY,moved=false,stop=()=>{};
    const near=(y:number)=>{let best=home,bd=Infinity;for(const p of pageEls()){const r=p.getBoundingClientRect(),d=y<r.top?r.top-y:y>r.bottom?y-r.bottom:0;if(d<bd){bd=d;best=p}}return best};
    const mark=()=>{const t=dir?null:near(cy);pageEls().forEach(p=>p.classList.toggle('tgt',p===t&&t!==home))};
    const place=()=>{
      moved=true;const r=home.getBoundingClientRect();
      if(dir){
        const dx=(cx-sx)/r.width,dy=(cy-sy)/r.height,hz=dir.includes('e')?1:dir.includes('w')?-1:0,vt=dir.includes('s')?1:dir.includes('n')?-1:0;
        const maxW=hz>0?1-x0:hz<0?x0+w0:w0,maxH=vt>0?1-y0:vt<0?y0+h0:h0; // room left on the page in the direction being dragged
        let w=w0+hz*dx,h=h0+vt*dy;
        if(hz&&vt){const k=Math.max(Math.min(Math.max(w/w0,h/h0),maxW/w0,maxH/h0),.04/w0,.03/h0);w=w0*k;h=h0*k} // corner: keep the current shape
        else{w=hz?Math.min(Math.max(w,.04),maxW):w0;h=vt?Math.min(Math.max(h,.03),maxH):h0}
        it.w=w;it.h=h;it.x=hz<0?x0+w0-w:x0;it.y=vt<0?y0+h0-h:y0;
        it.ar=h*r.height/(w*r.width); // remember the new shape so moving it to another page keeps the stretch
      }
      else{it.x=(cx-gx-r.left)/r.width;it.y=(cy-gy-r.top)/r.height;mark()}
      lay();
    };
    const mv=(m:PointerEvent)=>{cx=m.clientX;cy=m.clientY;place()};
    if(!dir)stop=edgeScroll(panel,()=>cy,$('#p-annotate .bar').offsetHeight,place);
    const up=()=>{
      stop();el.removeEventListener('pointermove',mv);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',up);
      pageEls().forEach(p=>p.classList.remove('tgt'));
      if(!moved)return;
      if(!dir){const b=box.getBoundingClientRect(),p=near(cy),r=p.getBoundingClientRect();toPage(p);it.x=(b.left-r.left)/r.width;it.y=(b.top-r.top)/r.height}
      clamp();lay();record(before);
    };
    el.addEventListener('pointermove',mv);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);
  });
  bind(box,'');hs.forEach(h=>bind(h,h.dataset.d!));
  del.onclick=()=>{const before=snap();box.remove();items.splice(items.indexOf(it),1);record(before);upd()};
}
const remount=()=>{host().querySelectorAll('.ov').forEach(e=>e.remove());items.forEach(mount);upd()};

async function apply(){
  const d=getDoc();if(!d||!items.length)return;
  try{
    const doc=await loadPdf(d.bytes),cache=new Map<Uint8Array,PDFImage>();
    for(const it of items){
      const pg=doc.getPage(it.page),b=pg.getCropBox(),r=((pg.getRotation().angle%360)+360)%360;
      // visual (rotated, y-down) size of the page, then the image's bottom-left corner in that space
      const vw=r%180?b.height:b.width,vh=r%180?b.width:b.height,vx=it.x*vw,vy=(it.y+it.h)*vh;
      const [px,py]=r===0?[vx,b.height-vy]:r===90?[vy,vx]:r===180?[b.width-vx,vy]:[b.width-vy,b.height-vx];
      let img=cache.get(it.png);if(!img){img=await doc.embedPng(it.png);cache.set(it.png,img)}
      pg.drawImage(img,{x:b.x+px,y:b.y+py,width:it.w*vw,height:it.h*vh,rotate:degrees(r)});
    }
    const out=await doc.save(),name=base(d.name)+'-signed.pdf';
    download(name,out);setDoc(name,out);await render();toast('Saved '+name);
  }catch(e){toast('Could not apply: '+((e as Error).message||e))}
}

/** Undo/redo of pending placements; the header buttons use this before falling back to document history. */
export function initAnnotate(changed:()=>void){
  onChange=changed;
  onDoc(()=>{dirty=true});
  $('#addSig').onclick=async()=>{if(!getDoc())return toast('Open a PDF first.');const s=await drawSignature();if(s)add(s,.28)};
  $<HTMLInputElement>('#imgIn').onchange=async e=>{
    const inp=e.target as HTMLInputElement,f=inp.files?.[0];inp.value='';if(!f)return;
    try{await add(await toPng(f),.4)}catch{toast('Could not read that image.')}
  };
  $('#applyAnn').onclick=apply;
  return {
    canUndo:()=>hist.length>0,canRedo:()=>fut.length>0,
    undo(){const p=hist.pop();if(p){fut.push(snap());items=p;remount()}},
    redo(){const n=fut.pop();if(n){hist.push(snap());items=n;remount()}},
  };
}
