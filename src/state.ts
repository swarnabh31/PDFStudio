// The "current document" shared by every tool, with undo/redo history of every committed change.
import {isEncrypted} from './pdfops';
export interface Doc{name:string;bytes:Uint8Array}
let cur:Doc|null=null,ver=0;const subs:(()=>void)[]=[];
const undos:Doc[]=[],redos:Doc[]=[],MAX_STEPS=30,MAX_BYTES=400e6; // history is kept in memory, so it is capped
export const getDoc=()=>cur;
export const getVersion=()=>ver;
export const onDoc=(f:()=>void)=>{subs.push(f)};
const emit=()=>{ver++;subs.forEach(f=>f())};
const size=()=>[...undos,...redos].reduce((n,d)=>n+d.bytes.length,0);

/** Replace the open document. `fresh` (opening a different file) starts a new history; otherwise it's an undoable change. */
export function setDoc(name:string,bytes:Uint8Array,fresh=false){
  if(cur&&!fresh)undos.push(cur);else undos.length=0;
  redos.length=0;cur={name,bytes};
  while(undos.length>MAX_STEPS||(undos.length>1&&size()>MAX_BYTES))undos.shift();
  emit();
}
export const canUndo=()=>undos.length>0;
export const canRedo=()=>redos.length>0;
export function undoDoc(){const p=undos.pop();if(!p||!cur)return false;redos.push(cur);cur=p;emit();return true}
export function redoDoc(){const n=redos.pop();if(!n||!cur)return false;undos.push(cur);cur=n;emit();return true}

/** Is the open document password-protected? (memoised per version) */
let lockVer=-1,lockP:Promise<boolean>=Promise.resolve(false);
export function isLocked(){
  if(!cur)return Promise.resolve(false);
  if(lockVer!==ver){lockVer=ver;lockP=isEncrypted(cur.bytes)}
  return lockP;
}
