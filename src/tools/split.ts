import {PDFDocument} from 'pdf-lib';
import {zipSync} from 'fflate';
import {$,base,download,toast,parseRanges as parse} from '../util';
import {loadPdf} from '../pdfops';
import {getDoc,onDoc,isLocked} from '../state';
import {openPdf,paint,type View} from '../pdfview';
import {icon} from '../icons';

// Page picker: every page is a card you can tick. The "Selected pages" field mirrors the ticks and also accepts typed ranges.
let dirty=true,tok=0,pdf:View|null=null,io:IntersectionObserver|null=null,last=-1;
const sel=new Set<number>();
const grid=()=>$('#splitGrid'),cards=()=>[...grid().children] as HTMLElement[],range=()=>$<HTMLInputElement>('#splitRange');

/** Sorted selection as runs of consecutive page numbers (zero-based): {1,2,3,5} -> [[0,1,2],[4]]. */
function runs(){
  const out:number[][]=[];
  for(const i of [...sel].sort((a,b)=>a-b)){const r=out[out.length-1];if(r&&r[r.length-1]===i-1)r.push(i);else out.push([i])}
  return out;
}
/** {1,2} -> "1, 2"; runs of three or more collapse: {1,2,3,5} -> "1-3, 5". */
const text=()=>runs().map(r=>r.length>2?`${r[0]+1}-${r[r.length-1]+1}`:r.map(i=>i+1).join(', ')).join(', ');

function sync(fromField=false){
  const n=cards().length,k=sel.size,r=runs();
  cards().forEach((c,i)=>{
    const on=sel.has(i);c.classList.toggle('on',on);c.setAttribute('aria-checked',String(on));
    c.querySelector('.cap')!.textContent=on?'Included in export':'Skipped';
    c.querySelector('.hd .ic')!.outerHTML=icon(on?'boxOn':'box',18);
  });
  $('#splitHead').textContent=n?`Document pages (${k} of ${n} selected)`:'Document pages';
  if(!fromField){range().value=text();range().classList.remove('bad')}
  $<HTMLInputElement>('#splitSepW').hidden=r.length<2;
  $<HTMLButtonElement>('#splitGo').disabled=!k;
  for(const id of ['#splitAll','#splitClear','#splitEach','#splitChunk'])$<HTMLButtonElement>(id).disabled=!n;
  range().disabled=!n;
}

async function render(){
  const my=++tok;dirty=false;io?.disconnect();grid().replaceChildren();pdf?.destroy();pdf=null;sel.clear();last=-1;
  const note=(t:string)=>{$('#splitNote').textContent=t;$('#splitNote').hidden=!t;sync()};
  const d=getDoc();if(!d)return note('Open a PDF to choose the pages you want to extract.');
  if(await isLocked())return note('This PDF is password-protected. Unlock it in the Password tab first.');
  try{const p=await openPdf(d.bytes);if(my!==tok){p.destroy();return}pdf=p}catch{return note('Could not read this PDF.')}
  note('');
  io=new IntersectionObserver(es=>es.forEach(e=>{
    if(!e.isIntersecting)return;io!.unobserve(e.target);
    paint(pdf!,+(e.target as HTMLElement).dataset.i!,e.target.querySelector('canvas')!,240).catch(()=>{/* grid was rebuilt */});
  }),{root:$('#p-split'),rootMargin:'400px'});
  for(let i=0;i<pdf.numPages;i++){
    const c=document.createElement('button');c.type='button';c.className='sp-card';c.dataset.i=String(i);c.setAttribute('role','checkbox');c.setAttribute('aria-checked','false');
    c.innerHTML=`<span class="hd"><span>Page<b>${i+1}</b></span>${icon('box',18)}</span><span class="th"><canvas></canvas></span><span class="cap">Skipped</span>`;
    grid().append(c);io.observe(c);
  }
  sync();
}
export function showSplit(){if(dirty)render()}

/** Copy each group of page indices into its own PDF; one result downloads as a PDF, several as a .zip. */
async function build(groups:number[][],single:string){
  const d=getDoc();if(!d)return toast('Open a PDF first.');
  if(await isLocked())return toast('This PDF is password-protected. Unlock it in the Password tab first.');
  const src=await loadPdf(d.bytes),outs:Uint8Array[]=[];
  for(const g of groups){const o=await PDFDocument.create();(await o.copyPages(src,g)).forEach(p=>o.addPage(p));outs.push(await o.save())}
  const b=base(d.name);
  if(outs.length===1)download(single.replace('{b}',b),outs[0]);
  else download(`${b}-split.zip`,zipSync(Object.fromEntries(outs.map((o,i)=>[`${b}-part${i+1}.pdf`,o])),{level:0}),'application/zip');
  toast(`Created ${outs.length} PDF${outs.length>1?'s':''}.`);
}
const run=(f:()=>Promise<void>)=>f().catch(e=>toast((e as Error).message||String(e)));

export function initSplit(){
  onDoc(()=>{dirty=true;if($('#p-split').classList.contains('on'))render()});
  grid().addEventListener('click',e=>{
    const c=(e.target as HTMLElement).closest<HTMLElement>('.sp-card');if(!c)return;
    const i=+c.dataset.i!,on=!sel.has(i);
    if(e.shiftKey&&last>=0){for(let k=Math.min(i,last);k<=Math.max(i,last);k++)on?sel.add(k):sel.delete(k)} // shift-click selects a stretch
    else on?sel.add(i):sel.delete(i);
    last=i;sync();
  });
  $('#splitAll').onclick=()=>{cards().forEach((_,i)=>sel.add(i));sync()};
  $('#splitClear').onclick=()=>{sel.clear();sync()};
  range().oninput=()=>{ // typed ranges drive the selection; bad input is flagged but never discards the ticks
    const v=range().value.trim(),n=cards().length;
    if(!v){sel.clear();range().classList.remove('bad');return sync(true)}
    try{const g=parse(v,n);sel.clear();g.flat().forEach(i=>sel.add(i));range().classList.remove('bad');sync(true)}
    catch{range().classList.add('bad')}
  };
  range().onblur=()=>{range().value=text();range().classList.remove('bad')};
  range().onkeydown=e=>{if(e.key==='Enter'&&!$<HTMLButtonElement>('#splitGo').disabled)$('#splitGo').click()};
  $('#splitGo').onclick=()=>run(async()=>{
    const r=runs();if(!r.length)throw new Error('Select at least one page.');
    await build($<HTMLInputElement>('#splitSep').checked&&r.length>1?r:[r.flat()],'{b}-extract.pdf');
  });
  $('#splitEach').onclick=()=>run(()=>build(cards().map((_,i)=>[i]),'{b}-extract.pdf'));
  $('#splitChunk').onclick=()=>run(async()=>{
    const k=Math.floor(+$<HTMLInputElement>('#splitN').value),n=cards().length;if(!(k>=1))throw new Error('Enter how many pages per file.');
    const g:number[][]=[];for(let i=0;i<n;i+=k)g.push(Array.from({length:Math.min(k,n-i)},(_,j)=>i+j));await build(g,'{b}-extract.pdf');
  });
  sync();
}
