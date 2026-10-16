import {$,base,download,toast} from '../util';
import {getDoc,setDoc,isLocked} from '../state';
import {qpdf} from '../qpdf';
import {loadPdf} from '../pdfops';

const val=(id:string)=>$<HTMLInputElement>(id).value,on=(id:string)=>$<HTMLInputElement>(id).checked;
const busy=async(b:HTMLElement,f:()=>Promise<void>)=>{
  const t=b.innerHTML;b.setAttribute('disabled','');b.textContent='Working…';
  try{await f()}catch(e){toast((e as Error).message||String(e))}finally{b.removeAttribute('disabled');b.innerHTML=t}
};

export async function showSecurity(){
  const d=getDoc();
  $('#secInfo').textContent=!d?'Open a PDF first.':`${d.name} — ${await isLocked()?'password-protected':'not password-protected'}`;
}

export function initSecurity(){
  $('#pwAdd').onclick=e=>busy(e.currentTarget as HTMLElement,async()=>{
    const d=getDoc();if(!d)return toast('Open a PDF first.');
    const pw=val('#pwNew'),owner=val('#pwOwner'),print=on('#pwPrint'),copy=on('#pwCopy'),edit=on('#pwEdit');
    if(!pw)return toast('Enter a password.');
    if(pw!==val('#pwNew2'))return toast('The two passwords don\'t match.');
    if(!(print&&copy&&edit)&&!owner)return toast('To restrict printing, copying or editing, also set an owner password.');
    if(await isLocked())return toast('This PDF is already protected — remove its password first.');
    await loadPdf(d.bytes); // fail early with a clear message if the file is unreadable
    const out=await qpdf(['/in.pdf','--encrypt',pw,owner||pw,'256',`--print=${print?'full':'none'}`,`--modify=${edit?'all':'none'}`,`--extract=${copy?'y':'n'}`,'--','/out.pdf'],d.bytes);
    download(base(d.name)+'-protected.pdf',out);
    toast('Protected copy downloaded (AES-256). The open document stays unprotected.');
    for(const id of ['#pwNew','#pwNew2','#pwOwner'])$<HTMLInputElement>(id).value='';
  });
  $('#pwDel').onclick=e=>busy(e.currentTarget as HTMLElement,async()=>{
    const d=getDoc();if(!d)return toast('Open a PDF first.');
    if(!await isLocked())return toast('This PDF isn\'t password-protected.');
    let out:Uint8Array;
    try{out=await qpdf([`--password=${val('#pwOld')}`,'--decrypt','/in.pdf','/out.pdf'],d.bytes)}
    catch{return toast('Wrong password — or this file can\'t be unlocked.')}
    setDoc(base(d.name)+'-unlocked.pdf',out);$<HTMLInputElement>('#pwOld').value='';
    toast('Password removed. Use Download to save it; Undo restores the protected version.');showSecurity();
  });
}
