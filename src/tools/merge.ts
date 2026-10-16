import {PDFDocument} from 'pdf-lib';
import {$,download,toast} from '../util';
import {icon} from '../icons';
import {getDoc,setDoc} from '../state';
interface F{name:string;bytes:Uint8Array;pages:number}
const files:F[]=[];

async function addFile(name:string,bytes:Uint8Array){
  try{const d=await PDFDocument.load(bytes.slice());files.push({name,bytes,pages:d.getPageCount()})}
  catch{toast(name+': could not be read (encrypted or corrupt).')}
}
function move(i:number,d:number){const j=i+d;if(j<0||j>=files.length)return;[files[i],files[j]]=[files[j],files[i]];draw()}
function draw(){
  const ul=$('#mergeList');ul.replaceChildren();
  files.forEach((f,i)=>{
    const li=document.createElement('li');
    li.innerHTML=`<span class="ix">${i+1}</span><span class="fi">${icon('file',18)}</span><span class="n"></span><span class="pgs">${f.pages} page${f.pages>1?'s':''}</span>`;
    li.querySelector('.n')!.textContent=f.name;
    const acts:[string,string,()=>void][]=[['up','Move up',()=>move(i,-1)],['down','Move down',()=>move(i,1)],['x','Remove',()=>{files.splice(i,1);draw()}]];
    for(const [ic,t,fn] of acts){const b=document.createElement('button');b.innerHTML=icon(ic);b.title=t;b.setAttribute('aria-label',`${t}: ${f.name}`);b.onclick=fn;li.append(b)}
    ul.append(li);
  });
  const n=files.length,pg=files.reduce((a,f)=>a+f.pages,0);
  $('#mergeCount').textContent=n?`${n} file${n>1?'s':''} · ${pg} pages`:'No files added';
  $('#mergeNote').textContent=n<2?'Add at least two PDFs to merge.':'Files are joined in the order shown.';
  $<HTMLButtonElement>('#mergeGo').disabled=n<2;
}
export function initMerge(){
  $<HTMLInputElement>('#mergeIn').onchange=async e=>{
    const inp=e.target as HTMLInputElement;
    for(const f of Array.from(inp.files||[]))await addFile(f.name,new Uint8Array(await f.arrayBuffer()));
    inp.value='';draw();
  };
  $('#mergeCur').onclick=async()=>{const d=getDoc();if(!d)return toast('No document is open.');await addFile(d.name,d.bytes);draw()};
  $('#mergeGo').onclick=async()=>{
    try{
      const out=await PDFDocument.create();
      for(const f of files){const s=await PDFDocument.load(f.bytes.slice());(await out.copyPages(s,s.getPageIndices())).forEach(p=>out.addPage(p))}
      const b=await out.save();setDoc('merged.pdf',b);download('merged.pdf',b);
      toast(`Merged ${files.length} files (${out.getPageCount()} pages). It is now the open document.`);
    }catch(e){toast('Merge failed: '+((e as Error).message||e))}
  };
  draw();
}
