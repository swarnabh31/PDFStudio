import {$,toast,edgeScroll} from '../util';
import {getDoc,setDoc,onDoc,isLocked} from '../state';
import {openPdf,paint,type View} from '../pdfview';
import {reshape,type PagePlan} from '../pdfops';
import {icon} from '../icons';

// The grid mirrors the document: card order == page order. Each action updates the grid at once and is
// queued as one undoable change to the document, so "Undo" in the header reverts it.
let dirty=true,mine=false,tok=0,q:Promise<void>=Promise.resolve(),pdf:View|null=null,io:IntersectionObserver|null=null,suppress=false;
const grid=()=>$('#pgGrid'),cards=()=>[...grid().children] as HTMLElement[];
const sel=()=>cards().filter(c=>c.classList.contains('sel'));
/** Resolves when every queued page change has been written to the document. */
export const settle=()=>q;

function label(){
  const cs=cards(),s=sel().length;
  cs.forEach((c,i)=>c.querySelector('.pn')!.textContent=String(i+1));
  $('#pgCount').textContent=!cs.length?'':s?`${s} of ${cs.length} selected`:`${cs.length} page${cs.length>1?'s':''}`;
  for(const id of ['#pgL','#pgR','#pgDel'])$<HTMLButtonElement>(id).disabled=!s;
  $<HTMLButtonElement>('#pgAll').disabled=!cs.length;$('#pgAll').textContent=s===cs.length&&s?'Select none':'Select all';
}
const fit=(c:HTMLElement)=>{ // keep a rotated thumbnail inside its box
  const cv=c.querySelector('canvas')!,th=c.querySelector<HTMLElement>('.th')!,r=+c.dataset.rot!,w=cv.clientWidth,h=cv.clientHeight;
  cv.style.transform=`rotate(${r}deg) scale(${r%180?Math.min(th.clientWidth/h,th.clientHeight/w,1):1})`;
};
function mk(src:number){
  const c=document.createElement('div');c.className='pc';c.dataset.src=String(src);c.dataset.rot='0';
  c.innerHTML='<div class="th"><canvas></canvas></div><div class="pn"></div><div class="pb">'+
    [['l','rotl','Rotate left'],['r','rotr','Rotate right'],['b','left','Move earlier'],['f','right','Move later'],['d','trash','Delete page']]
      .map(([a,t,h])=>`<button data-a="${a}" title="${h}" aria-label="${h}">${icon(t,15)}</button>`).join('')+'</div>';
  return c;
}

// ---- actions: build the plan from the grid as it is now, update the grid, queue the write ----
const ident=():PagePlan[]=>cards().map((_,i)=>({src:i,rot:0}));
function push(plan:PagePlan[]){
  label();
  q=q.then(async()=>{
    const d=getDoc();if(!d)return;
    const out=await reshape(d.bytes,plan);mine=true;try{setDoc(d.name,out)}finally{mine=false}
  }).catch(e=>{toast('Page change failed: '+((e as Error).message||e));dirty=true;return render()});
}
function rotate(cs:HTMLElement[],d:number){
  const all=cards(),plan=ident();
  cs.forEach(c=>{plan[all.indexOf(c)].rot=d;c.dataset.rot=String(+c.dataset.rot!+d);fit(c)});push(plan);
}
function remove(cs:HTMLElement[]){
  const all=cards();if(cs.length>=all.length)return toast('A PDF needs at least one page.');
  push(ident().filter((_,i)=>!cs.includes(all[i])));cs.forEach(c=>c.remove());label();
}
function move(c:HTMLElement,to:number){ // c ends up at index `to`
  const all=cards(),from=all.indexOf(c);if(to<0||to>=all.length||to===from)return;
  const plan=ident(),[m]=plan.splice(from,1);plan.splice(to,0,m);
  grid().insertBefore(c,all.filter(x=>x!==c)[to]??null);push(plan);c.scrollIntoView({block:'nearest'});
}

// ---- thumbnails (painted lazily as they scroll into view) ----
async function thumb(c:HTMLElement,my:number){
  try{await paint(pdf!,+c.dataset.src!,c.querySelector('canvas')!,150);if(my===tok)fit(c)}catch{/* grid was rebuilt */}
}
async function render(){
  const my=++tok;dirty=false;io?.disconnect();grid().replaceChildren();pdf?.destroy();pdf=null;
  const note=(t:string)=>{$('#pgNote').textContent=t;label()};
  const d=getDoc();if(!d)return note('Open a PDF to rotate, delete or reorder its pages.');
  if(await isLocked())return note('This PDF is password-protected — unlock it in the Password tab first.');
  note('');
  try{const p=await openPdf(d.bytes);if(my!==tok){p.destroy();return}pdf=p}catch{return note('Could not read this PDF.')}
  io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){io!.unobserve(e.target);thumb(e.target as HTMLElement,my)}}),{root:$('#p-pages'),rootMargin:'500px'});
  for(let i=0;i<pdf.numPages;i++){const c=mk(i);grid().append(c);io.observe(c)}
  label();
}
export function showPages(){if(dirty)render()}

export function initPages(){
  onDoc(()=>{if(!mine)dirty=true});
  const g=grid();
  g.addEventListener('click',e=>{
    const t=e.target as HTMLElement,c=t.closest<HTMLElement>('.pc');if(!c||suppress)return;
    const a=t.closest('button')?.dataset.a;
    if(a==='l')rotate([c],-90);else if(a==='r')rotate([c],90);else if(a==='d')remove([c]);
    else if(a==='b')move(c,cards().indexOf(c)-1);else if(a==='f')move(c,cards().indexOf(c)+1);
    else if(t.closest('.th')){c.classList.toggle('sel');label()}
  });
  // drag a thumbnail to reorder (mouse / pen; on touch use ◀ ▶)
  g.addEventListener('pointerdown',e=>{
    const c=(e.target as HTMLElement).closest<HTMLElement>('.pc');
    if(!c||e.button||e.pointerType==='touch'||!(e.target as HTMLElement).closest('.th'))return;
    const panel=$('#p-pages'),sx=e.clientX,sy=e.clientY,st=panel.scrollTop;let drag=false,y=sy,x=sx,tgt:HTMLElement|null=null,stop=()=>{};
    const place=()=>{
      c.style.transform=`translate(${x-sx}px,${y-sy+panel.scrollTop-st}px)`;
      const t=cards().find(o=>{if(o===c)return false;const r=o.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom})||null;
      if(t!==tgt){tgt?.classList.remove('over');t?.classList.add('over');tgt=t}
    };
    const mv=(m:PointerEvent)=>{
      x=m.clientX;y=m.clientY;
      if(!drag&&Math.hypot(x-sx,y-sy)>6){drag=true;c.classList.add('drag');c.setPointerCapture(e.pointerId);stop=edgeScroll(panel,()=>y,$('#p-pages .bar').offsetHeight,place)}
      if(drag)place();
    };
    const up=()=>{
      removeEventListener('pointermove',mv);removeEventListener('pointerup',up);removeEventListener('pointercancel',up);stop();
      if(!drag)return;
      suppress=true;setTimeout(()=>suppress=false);c.classList.remove('drag');c.style.transform='';tgt?.classList.remove('over');
      if(tgt)move(c,cards().indexOf(tgt));
    };
    addEventListener('pointermove',mv);addEventListener('pointerup',up);addEventListener('pointercancel',up);
  });
  $('#pgAll').onclick=()=>{const all=cards(),on=sel().length!==all.length;all.forEach(c=>c.classList.toggle('sel',on));label()};
  $('#pgL').onclick=()=>rotate(sel(),-90);
  $('#pgR').onclick=()=>rotate(sel(),90);
  $('#pgDel').onclick=()=>remove(sel());
}
