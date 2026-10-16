import './style.css';
import editTheme from './edit-theme.css?inline';
import {icon,hydrateIcons} from './icons';
import {$,toast,download} from './util';
import {getDoc,setDoc,getVersion,onDoc,canUndo,canRedo,undoDoc,redoDoc,isLocked} from './state';
import {initAnnotate,showAnnotate} from './tools/annotate';
import {initMerge} from './tools/merge';
import {initPages,showPages,settle} from './tools/pages';
import {initWatermark,showWatermark} from './tools/watermark';
import {initSecurity,showSecurity} from './tools/security';
import {initSplit,showSplit} from './tools/split';
import {initConvert} from './conv';

const frame=$<HTMLIFrameElement>('#editFrame');
let active='edit',editVer=-1,origLoad:((f:File)=>unknown)|null=null;

// ---- Edit tab: the original editor, untouched, hosted in an iframe and bridged from outside ----
async function pushToEdit(){
  const d=getDoc();if(!d||!origLoad||editVer===getVersion())return;
  editVer=getVersion();
  if(await isLocked())return toast('This PDF is password-protected — unlock it in the Password tab to edit it.');
  origLoad(new File([d.bytes as BlobPart],d.name,{type:'application/pdf'}));
}
/** Make the embedded editor look like the rest of the app (same-origin, so we can reach into it). */
function themeEditor(w:any){
  const d:Document=w.document;d.documentElement.dataset.theme='dark';
  d.head.insertAdjacentHTML('beforeend',`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap"><style>${editTheme}</style>`);
  const pre=(id:string,n:string)=>d.getElementById(id)?.insertAdjacentHTML('afterbegin',icon(n));
  pre('fonts','font');pre('undo','rotl');pre('save','download');d.querySelector('label.btn')?.insertAdjacentHTML('afterbegin',icon('folder'));
  const zo=d.getElementById('zo')!,zi=d.getElementById('zi')!,box=d.createElement('span'),out=d.createElement('output');
  box.className='zoom';zo.before(box);out.textContent='100%';box.append(zo,out,zi);
  const sync=()=>{out.textContent=Math.round(w.eval('scale')/1.5*100)+'%'};zo.addEventListener('click',sync);zi.addEventListener('click',sync);
  d.getElementById('stat')?.insertAdjacentHTML('beforebegin',`<span class="spk">${icon('sparkle',14)}</span>`);
}
frame.addEventListener('load',()=>{
  const w=frame.contentWindow as any;
  try{themeEditor(w)}catch{/* theming is cosmetic */}
  origLoad=w.load;
  // files opened inside the editor become the shared document
  w.load=(f:File)=>{if(f)f.arrayBuffer().then(b=>{setDoc(f.name,new Uint8Array(b),true);editVer=getVersion()});return origLoad!(f)};
  // the editor's "Download edited PDF" also hands the result to the other tools
  const oc=w.claude;
  w.claude={use:async(k:string)=>{
    const dl=await oc.use(k);
    return dl&&{save:async(a:{filename:string;data:Uint8Array})=>{
      if(/\.pdf$/i.test(a.filename)){setDoc(a.filename,new Uint8Array(a.data));editVer=getVersion()}
      return dl.save(a);
    }};
  }};
  pushToEdit();
});

// ---- tabs ----
function show(id:string){
  active=id;
  document.querySelectorAll<HTMLElement>('nav button').forEach(b=>b.classList.toggle('on',b.dataset.tab===id));
  document.querySelectorAll<HTMLElement>('.panel').forEach(p=>p.classList.toggle('on',p.id==='p-'+id));
  if(id==='edit'){if(!frame.getAttribute('src'))frame.src=import.meta.env.BASE_URL+'edit/index.html';else pushToEdit()}
  if(id==='annotate')showAnnotate();
  if(id==='pages')showPages();
  if(id==='watermark')showWatermark();
  if(id==='security')showSecurity();
  if(id==='split')showSplit();
  $('#tbar').hidden=id==='edit'; // the text editor carries its own toolbar
  refresh();
}
document.querySelectorAll<HTMLElement>('nav button').forEach(b=>b.onclick=()=>show(b.dataset.tab!));

// ---- undo / redo / download (header) ----
// In "Sign & images" the buttons first step through pending placements, then through document changes.
// In "Edit text" they're off: the editor has its own undo and unsaved edits there aren't part of the document yet.
const ann=initAnnotate(()=>refresh()),undoB=$<HTMLButtonElement>('#undo'),redoB=$<HTMLButtonElement>('#redo');
function refresh(){
  const edit=active==='edit',pend=active==='annotate';
  undoB.disabled=edit||!((pend&&ann.canUndo())||canUndo());redoB.disabled=edit||!((pend&&ann.canRedo())||canRedo());
  $<HTMLButtonElement>('#dl').disabled=!getDoc();
}
async function step(undo:boolean){
  if(active==='edit')return;
  if(active==='annotate'&&(undo?ann.canUndo():ann.canRedo())){undo?ann.undo():ann.redo();return refresh()}
  await settle(); // let in-flight page edits reach the document first
  if(undo?undoDoc():redoDoc())show(active);else toast(undo?'Nothing to undo.':'Nothing to redo.');
}
undoB.onclick=()=>step(true);redoB.onclick=()=>step(false);
$('#dl').onclick=()=>{const d=getDoc();if(d)download(d.name,d.bytes)};
addEventListener('keydown',e=>{
  if(!(e.ctrlKey||e.metaKey)||e.altKey||(e.target as HTMLElement).closest('input,textarea,select,[contenteditable]'))return;
  const k=e.key.toLowerCase();
  if(k==='z'||k==='y'){e.preventDefault();step(k==='z'&&!e.shiftKey)}
});

// ---- global "Open PDF" ----
function nameChip(){const n=getDoc()?.name,t=$('#docname');t.textContent=n??'No PDF open';t.classList.toggle('none',!n);t.title=n??''}
onDoc(()=>{nameChip();refresh()});
$<HTMLInputElement>('#open').onchange=async e=>{
  const inp=e.target as HTMLInputElement,f=inp.files?.[0];inp.value='';if(!f)return;
  if(!/\.pdf$/i.test(f.name)&&f.type!=='application/pdf')return toast('Please choose a PDF file.');
  setDoc(f.name,new Uint8Array(await f.arrayBuffer()),true);
  if(await isLocked()){show('security');toast('This PDF is password-protected — enter its password to unlock it.')}else show(active);
};

// Ctrl/Cmd+O opens a PDF
const mac=/mac|iphone|ipad/i.test(navigator.platform);$('#openKey').textContent=mac?'⌘O':'Ctrl O';
addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='o'){e.preventDefault();$<HTMLInputElement>('#open').click()}});
hydrateIcons();nameChip();
initMerge();initSplit();initPages();initWatermark();initSecurity();initConvert();show('edit');
