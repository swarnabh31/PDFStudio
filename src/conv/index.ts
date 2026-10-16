// The "Convert" workspace — a left sidebar of converters + one form at a time. Everything runs in-browser.
import {$,toPng,download,toast} from '../util';
import {icon,hydrateIcons} from '../icons';
import {getDoc,onDoc} from '../state';
import * as E from './engine';

type Src='file'|'pdf'|'text';
interface Conv{id:string;group:string;label:string;sub:string;icon:string;src:Src;
  body:()=>string;wire:(b:HTMLElement,api:Api)=>void;run:(b:HTMLElement,api:Api)=>Promise<E.Out>}
interface Api{doc:()=>{name:string;bytes:Uint8Array}|null;out:(o:E.Out)=>void;toast:(m:string)=>void}

const MIME={pdf:'application/pdf',txt:'text/plain',md:'text/markdown',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
const baseName=(n:string)=>n.replace(/\.[^.]+$/,'');

// current form inputs (only one form is live at a time; reset on each selection)
let pickedBytes:Uint8Array|null=null, pickedName='';
let files:File[]=[];
let resync:()=>void=()=>{};

const api:Api={doc:getDoc,out:o=>download(o.name,o.bytes,o.mime),toast};
const resolveSrc=()=>{ if(pickedBytes)return{name:pickedName,bytes:pickedBytes}; return getDoc() };

// ---- shared body builders ----
function pdfBody(o:{title:string;desc:string}){
  return `<h2 class="cph">${icon('convert',22)}${o.title}</h2><p class="csub">${o.desc}</p>
    <div class="card csrc card form">
      <div class="csrc-drop" id="csrcDrop"><i data-i="folder" data-s="26"></i>
        <div><b>Choose or drop a PDF</b><span id="csrcNote">Click to pick a file, or drop it here.</span></div>
        <label class="btn add" for="csrcIn"><i data-i="folder"></i>Choose PDF…</label>
        <input id="csrcIn" type="file" accept="application/pdf,.pdf" hidden>
      </div>
      <div class="row" style="justify-content:space-between">
        <span class="hint">Runs entirely in your browser — the file is never uploaded.</span>
        <button id="cgo" class="cta">${icon('download',16)}Convert &amp; Download</button>
      </div>
    </div>`;
}
function textBody(o:{title:string;desc:string;ph?:string;ext:string;label:string}){
  return `<h2 class="cph">${icon('convert',22)}${o.title}</h2><p class="csub">${o.desc}</p>
    <div class="card csrc card form">
      <div class="row" style="justify-content:space-between">
        <span class="hint"><i data-i="folder" data-s="14"></i> <span id="csrcNote">Paste below, or load a file.</span></span>
        <label class="btn add" for="csrcIn"><i data-i="file"></i>${o.label}</label>
        <input id="csrcIn" type="file" accept="${o.ext}" hidden>
      </div>
      <textarea id="csrcTa" class="csrc-ta" rows="11" spellcheck="false" placeholder="${o.ph||''}"></textarea>
      <div class="row" style="justify-content:space-between">
        <label>Base font size <select id="csrcSize"><option>10</option><option selected>11</option><option>12</option><option>13</option><option>14</option></select></label>
        <button id="cgo" class="cta">${icon('download',16)}Convert &amp; Download</button>
      </div>
    </div>`;
}
function fileBody(o:{title:string;desc:string;accept:string;min:1;hint:string;optionRow?:string}){
  return `<h2 class="cph">${icon('convert',22)}${o.title}</h2><p class="csub">${o.desc}</p>
    <div class="card csrc card form" data-min="${o.min}">
      <div class="csrc-drop" id="csrcDrop"><i data-i="folder" data-s="26"></i>
        <div><b>Add files to convert</b><span>${o.hint}</span></div>
        <label class="btn add" for="fileIn"><i data-i="plus"></i>Add files…</label>
        <input id="fileIn" type="file" accept="${o.accept}" multiple hidden>
      </div>
      <ul class="cfile" id="fileList"></ul>
      ${o.optionRow||''}
      <div class="row" style="justify-content:space-between">
        <span class="hint" id="fileMeta">Runs entirely in your browser — the files are never uploaded.</span>
        <button id="cgo" class="cta" disabled>${icon('download',16)}Convert &amp; Download</button>
      </div>
    </div>`;
}

// ---- shared form wiring ----
function wirePdf(b:HTMLElement){
  const note=b.querySelector('#csrcNote') as HTMLElement;
  const setNote=(t:string)=>{if(note)note.textContent=t};
  resync=()=>{const d=getDoc();setNote(pickedName?`Source: ${pickedName}`:(d?`Source: ${d.name} (current document)`:'Source: none — open a PDF or choose one to convert.'))};
  resync();
  const inp=b.querySelector('#csrcIn') as HTMLInputElement;
  inp.onchange=async e=>{const f=(e.target as HTMLInputElement).files?.[0];if(!f)return;pickedName=f.name;pickedBytes=new Uint8Array(await f.arrayBuffer());resync()};
  const drop=b.querySelector('#csrcDrop') as HTMLElement;
  const take=async(f?:File|null)=>{if(!f)return;pickedName=f.name;pickedBytes=new Uint8Array(await f.arrayBuffer());resync()};
  if(drop){
    drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over')});
    drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
    drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');take(e.dataTransfer?.files?.[0])});
    drop.onclick=()=>inp.click();
  }
}
function wireText(b:HTMLElement){
  const ta=b.querySelector('#csrcTa') as HTMLTextAreaElement;
  const note=b.querySelector('#csrcNote') as HTMLElement;
  const inp=b.querySelector('#csrcIn') as HTMLInputElement;
  inp.onchange=async e=>{
    const f=(e.target as HTMLInputElement).files?.[0];if(!f)return;
    let text='';
    try{ text=new TextDecoder().decode(await f.arrayBuffer()) }catch{ text='' }
    ta.value=text;
    if(note)note.textContent=`Loaded ${f.name} — edit below, then convert.`;
  };
}
function renderFiles(b:HTMLElement){
  const ul=b.querySelector('#fileList') as HTMLElement;
  const card=b.querySelector('.csrc') as HTMLElement;
  const min=+(card?.dataset.min||1);
  if(!ul)return;
  ul.replaceChildren();
  files.forEach((f,i)=>{
    const li=document.createElement('li');
    li.innerHTML=`<span class="fi">${icon('file',16)}</span><span class="n"></span><span class="sz">${(f.size/1024).toFixed(1)} KB</span><button aria-label="Remove ${f.name}">${icon('x',14)}</button>`;
    li.querySelector('.n')!.textContent=f.name;
    li.querySelector('button')!.onclick=()=>{files.splice(i,1);renderFiles(b)};
    ul.append(li);
  });
  const meta=b.querySelector('#fileMeta') as HTMLElement;
  if(meta)meta.textContent=files.length?`${files.length} file${files.length>1?'s':''} selected`:'Add files to continue.';
  $<HTMLButtonElement>('#cgo').disabled=files.length<min;
}
function wireFiles(b:HTMLElement){
  const inp=b.querySelector('#fileIn') as HTMLInputElement;
  inp.onchange=e=>{const sel=Array.from((e.target as HTMLInputElement).files||[]);files.push(...sel);inp.value='';renderFiles(b)};
  const drop=b.querySelector('#csrcDrop') as HTMLElement;
  if(drop){
    drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over')});
    drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
    drop.addEventListener('drop',async e=>{e.preventDefault();drop.classList.remove('over');const sel=Array.from(e.dataTransfer?.files||[]);files.push(...sel);renderFiles(b)});
    drop.onclick=()=>inp.click();
  }
  renderFiles(b);
}
const textSrc=(b:HTMLElement)=>(b.querySelector('#csrcTa') as HTMLTextAreaElement)?.value??'';

// ---- the converters ----
const CONV:Conv[]=[
  {id:'pdf2word',group:'Word',label:'PDF → Word',sub:'to .docx',icon:'word',src:'pdf',
    body:()=>pdfBody({title:'PDF to Word',desc:'Extract text from a PDF and package it as an editable Word (.docx) document. Bold runs and headings are preserved where possible.'}),
    wire:wirePdf,
    run:()=>{const src=resolveSrc();if(!src)throw new Error('Open a PDF or choose one to convert.');
      return E.extractPdf(src.bytes).then(pages=>({name:baseName(src.name)+'.docx',bytes:E.docxFromPages(pages),mime:MIME.docx}));}},
  {id:'word2pdf',group:'Word',label:'Word → PDF',sub:'from .docx',icon:'pdf',src:'file',
    body:()=>fileBody({title:'Word to PDF',desc:'Open a Word document and render it to a clean PDF. Headings, bold and inline images are carried over; tables flatten to their text.',accept:'*.docx,*.doc,.docx,.doc,.application/vnd.openxmlformats-officedocument.wordprocessingml.document',min:1,hint:'.docx supported · legacy .doc needs a .docx save'}),
    wire:wireFiles,
    run:()=>{
      if(!files.length)throw new Error('Add at least one Word file.');
      const legacy=files.some(f=>/\.doc$/i.test(f.name)&&! /\.docx$/i.test(f.name));
      if(legacy)throw new Error('Legacy .doc (Word 97–2003) can\'t be read in the browser — open it in Word and “Save as .docx”, then retry.');
      if(!files.every(f=>/\.docx$/i.test(f.name)))throw new Error('Choose Word files (.docx).');
      return (async()=>{
        const all:E.Line[]=[];
        for(const f of files){all.push(...E.docFromDocx(new Uint8Array(await f.arrayBuffer())).lines)}
        if(!all.length)throw new Error('Couldn\'t read any readable text from that .docx.');
        const bytes=await E.pdfFromDoc({lines:all});
        return {name:files.length>1?`${baseName(files[0].name)}-combined.pdf`:baseName(files[0].name)+'.pdf',bytes,mime:MIME.pdf};
      })();}},
  {id:'img2pdf',group:'Images',label:'Image → PDF',sub:'one per page',icon:'image',src:'file',
    body:()=>fileBody({title:'Image to PDF',desc:'Turn one or more images (PNG, JPG, WebP, GIF) into a single PDF. Each image becomes its own page.',accept:'image/*,.png,.jpg,.jpeg,.webp,.gif',min:1,hint:'PNG · JPG · WebP · GIF',
      optionRow:`<div class="row"><label>Page size <select id="imgMode"><option value="fit">Fit to image</option><option value="A4">A4 letter-sized</option></select></label><span class="hint">“Fit to image” sizes each page to its image for a crisper result.</span></div>`}),
    wire:wireFiles,
    run:()=>{
      if(!files.length)throw new Error('Add at least one image.');
      return (async()=>{
        const items:{bytes:Uint8Array;mime:string}[]=[];
        for(const f of files){
          const u8=new Uint8Array(await f.arrayBuffer());
          const mime=f.type||'';
          if(mime==='image/png'||mime==='image/jpeg')items.push({bytes:u8,mime});
          else{const png=await toPng(f,3000);png&&items.push({bytes:png,mime:'image/png'})}
        }
        if(!items.length)throw new Error('Couldn\'t read a valid image.');
        const mode=($<HTMLSelectElement>('#imgMode')?.value)||'fit';
        const bytes=await E.pdfFromImages(items,mode as any);
        return {name:files.length>1?'images.pdf':baseName(files[0].name)+'.pdf',bytes,mime:MIME.pdf};
      })();}},
  {id:'md2pdf',group:'Text',label:'Markdown → PDF',sub:'to PDF',icon:'hash',src:'text',
    body:()=>textBody({title:'Markdown to PDF',desc:'Paste Markdown or load a .md file and render it to a clean, paginated PDF — headings, bold, lists, code and more.',ext:'*.md,.md,*.markdown,.markdown,*.text,.md',label:'Load .md…',ph:'# Title here\n\nWrite **Markdown** and render it to a clean PDF.\n- Headings\n- **Bold**, *italic*, `code`\n- Bulleted lists\n- Code fences ```'}),
    wire:wireText,
    run:(b)=>{const text=textSrc(b);if(!text.trim())throw new Error('Paste Markdown or load a .md file first.');
      const base=+$<HTMLSelectElement>('#csrcSize').value;
      return E.pdfFromDoc(E.docFromMd(text,base)).then(bytes=>({name:'document.pdf',bytes,mime:MIME.pdf}));}},
  {id:'pdf2md',group:'Text',label:'PDF → Markdown',sub:'to .md',icon:'file',src:'pdf',
    body:()=>pdfBody({title:'PDF to Markdown',desc:'Extract text from a PDF as Markdown with headings and paragraphs. Layout and images are simplified to their text.'}),
    wire:wirePdf,
    run:()=>{const src=resolveSrc();if(!src)throw new Error('Open a PDF or choose one to convert.');
      return E.extractPdf(src.bytes).then(pages=>({name:baseName(src.name)+'.md',bytes:strMd(E.mdFromPages(pages)),mime:MIME.md}));}},
  {id:'txt2pdf',group:'Text',label:'TXT → PDF',sub:'to PDF',icon:'txt',src:'text',
    body:()=>textBody({title:'Text to PDF',desc:'Paste plain text or load a .txt file and get a tidy, word-wrapped, paginated PDF.',ext:'*.txt,.txt,text/plain',label:'Load .txt…',ph:'Paste your text here, or load a .txt file.'}),
    wire:wireText,
    run:(b)=>{const text=textSrc(b);if(!text.trim())throw new Error('Paste text or load a .txt file first.');
      const base=+$<HTMLSelectElement>('#csrcSize').value;
      return E.pdfFromDoc(E.docFromTxt(text,base)).then(bytes=>({name:'document.pdf',bytes,mime:MIME.pdf}));}},
  {id:'pdf2txt',group:'Text',label:'PDF → TXT',sub:'to .txt',icon:'txt',src:'pdf',
    body:()=>pdfBody({title:'PDF to TXT',desc:'Extract readable plain text from a PDF, page by page, preserving word spacing.'}),
    wire:wirePdf,
    run:()=>{const src=resolveSrc();if(!src)throw new Error('Open a PDF or choose one to convert.');
      return E.extractPdf(src.bytes).then(pages=>({name:baseName(src.name)+'.txt',bytes:strMd(E.txtFromPages(pages)),mime:MIME.txt}));}},
];
const strMd=(s:string)=>new TextEncoder().encode(s);

// ---- controller ----
let cur:Conv=CONV[0];
const cnav=$<HTMLElement>('#cnav'), cbody=$<HTMLElement>('#cbody');

function buildNav(){
  let html='<div class="cnav-h">Converters</div>';
  for(const g of [...new Set(CONV.map(c=>c.group))]){
    const items=CONV.filter(c=>c.group===g);
    html+=items.map(c=>`<button class="citem" data-cid="${c.id}">${icon(c.icon,18)}<span><span class="ct">${c.label}</span><span class="cs">${c.sub}</span></span></button>`).join('');
  }
  cnav.innerHTML=html;
  cnav.querySelectorAll<HTMLElement>('.citem').forEach(el=>el.onclick=()=>select(el.dataset.cid!));
}
function select(id:string){
  const c=CONV.find(x=>x.id===id)||CONV[0];
  cur=c;
  pickedBytes=null;pickedName='';files=[];resync=()=>{};
  cnav.querySelectorAll<HTMLElement>('.citem').forEach(el=>el.classList.toggle('on',el.dataset.cid===c.id));
  const b=cbody;
  b.innerHTML=c.body();hydrateIcons(b);
  c.wire(b,api);
  b.classList.remove('flash');void b.offsetWidth;b.classList.add('flash');
}
const busy=(b:HTMLElement,fn:()=>Promise<E.Out>)=>{
  const t=b.innerHTML;b.setAttribute('disabled','');b.innerHTML=icon('convert',15)+'Working…';
  fn().then(out=>{api.out(out);toast('Done — download started.')})
    .catch(e=>toast((e as Error).message||String(e)))
    .finally(()=>{b.removeAttribute('disabled');b.innerHTML=t});
};
function wireGo(){
  cbody.addEventListener('click',e=>{
    if((e.target as HTMLElement).closest('#cgo')&&!$<HTMLButtonElement>('#cgo').disabled)
      busy($<HTMLButtonElement>('#cgo'),async()=>cur.run(cbody,api));
  });
  onDoc(()=>resync());
}

export function initConvert(){
  buildNav();
  wireGo();
  select('pdf2word');
}
