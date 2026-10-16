import {$,toast,toPng,parseRanges} from '../util';
import {getDoc,setDoc,onDoc,isLocked} from '../state';
import {openPdf,paint,type View} from '../pdfview';
import {addWatermark,removeWatermarks,wmLayout,watermarkMeasure,type WM} from '../pdfops';

let dirty=true,pv=0,pdf:View|null=null,tok=0,ovTok=0,png:Uint8Array|null=null,bmp:ImageBitmap|null=null,pw=0,ph=0,total=0;
let src:Uint8Array|null=null,stripped:Uint8Array|null=null; // cache of the document without the watermark added here
const val=(id:string)=>$<HTMLInputElement>(id).value,on=(id:string)=>$<HTMLInputElement>(id).checked;
const fontMsg='The built-in font can\'t draw some of those characters. Use plain Latin text, or an image watermark.';
const opts=():WM=>({kind:val('#wmMode')==='image'?'image':'text',text:val('#wmText'),png:png??undefined,size:+val('#wmSize')||64,scale:+val('#wmScale')||40,
  opacity:+val('#wmOpacity')/100,angle:+val('#wmAngle')||0,color:val('#wmColor'),tiled:val('#wmLayout')==='tile',pages:val('#wmPages')});

/** Paint the watermark over the page preview exactly as it would be written (same layout code as the PDF). Cheap, so it runs on every edit. */
async function drawOverlay(){
  const my=++ovTok,ov=$<HTMLCanvasElement>('#wmOv'),cv=$<HTMLCanvasElement>('#wmCv'),note=$('#wmPvNote');
  ov.width=cv.width;ov.height=cv.height;note.textContent='';
  if(!pdf||!pw||!cv.width)return;
  const o=opts(),say=(t:string)=>{note.textContent=t};
  if(o.kind==='text'&&!o.text.trim())return say('Type the watermark text to see it here.');
  if(o.kind==='image'&&!bmp)return say('Choose an image to see it here.');
  try{if(o.pages.trim()&&!parseRanges(o.pages,total).flat().includes(pv))return say('This page is not in the page range, so it will not get a watermark.')}
  catch(e){return say((e as Error).message)}
  const meas=await watermarkMeasure();if(my!==ovTok)return;
  let L;try{L=wmLayout(o,pw,ph,meas,bmp?bmp.height/bmp.width:1)}catch{return say(fontMsg)}
  const k=ov.width/pw,th=o.angle*Math.PI/180,g=ov.getContext('2d')!;
  g.globalAlpha=o.opacity;g.fillStyle=o.color;
  for(const [dx,dy] of L.cs){
    g.save();g.translate((pw/2+dx)*k,(ph/2-dy)*k);g.rotate(-th);
    if(o.kind==='text'){g.font=`bold ${L.size*k}px Helvetica,Arial,sans-serif`;g.textBaseline='alphabetic';g.fillText(o.text,-L.w/2*k,L.hOff*k)}
    else g.drawImage(bmp!,-L.w/2*k,-L.h/2*k,L.w*k,L.h*k);
    g.restore();
  }
}
let raf=0;const preview=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{drawOverlay()})};

// live preview of the open document's page, with the watermark drawn over it
async function render(){
  const my=++tok;dirty=false;pdf?.destroy();pdf=null;pw=0;
  const cv=$<HTMLCanvasElement>('#wmCv'),info=$('#wmPage'),wrap=$('#wmWrap'),d=getDoc();
  const none=(t:string)=>{cv.width=cv.height=0;wrap.hidden=true;info.textContent=t;$('#wmPvNote').textContent='';for(const id of ['#wmPrev','#wmNext'])$<HTMLButtonElement>(id).disabled=true};
  if(!d)return none('Open a PDF to preview the watermark.');
  if(await isLocked())return none('This PDF is password-protected. Unlock it in the Password tab first.');
  try{
    // when replacing, show the page without the watermark added earlier, since that is what the result will look like
    let bytes=d.bytes;
    if(on('#wmReplace')){if(src!==d.bytes){src=d.bytes;stripped=(await removeWatermarks(d.bytes,true)).out}bytes=stripped!}
    $('#wmReplNote').hidden=bytes===d.bytes;
    const p=await openPdf(bytes);if(my!==tok){p.destroy();return}pdf=p;
  }catch{return none('Could not read this PDF.')}
  total=pdf.numPages;pv=Math.min(pv,total-1);
  info.textContent=`Page ${pv+1} / ${total}`;
  $<HTMLButtonElement>('#wmPrev').disabled=pv<1;$<HTMLButtonElement>('#wmNext').disabled=pv>=total-1;
  const w=Math.max(200,Math.min(420,($('#wmPvCard').clientWidth||460)-40));
  wrap.hidden=false;wrap.style.width=w+'px';
  const vp=(await pdf.getPage(pv+1)).getViewport({scale:1});pw=vp.width;ph=vp.height;
  await paint(pdf,pv,cv,w);if(my!==tok)return;
  cv.style.width='100%';
  drawOverlay();
}
export function showWatermark(){if(dirty)render();else preview()}

export function initWatermark(){
  onDoc(()=>{dirty=true;if($('#p-watermark').classList.contains('on'))render()});
  const sync=()=>{
    const img=val('#wmMode')==='image';
    document.querySelectorAll<HTMLElement>('.wm-t').forEach(e=>e.hidden=img);
    document.querySelectorAll<HTMLElement>('.wm-i').forEach(e=>e.hidden=!img);
    $('#wmOp').textContent=val('#wmOpacity')+'%';
  };
  // any change to the settings redraws the preview
  const form=$('#wmForm');form.addEventListener('input',()=>{sync();preview()});form.addEventListener('change',()=>{sync();preview()});sync();
  $('#wmReplace').addEventListener('change',()=>{render()});
  $<HTMLInputElement>('#wmImg').onchange=async e=>{
    const inp=e.target as HTMLInputElement,f=inp.files?.[0];inp.value='';if(!f)return;
    try{png=await toPng(f);bmp?.close();bmp=await createImageBitmap(new Blob([png as BlobPart],{type:'image/png'}));$('#wmImgName').textContent=f.name;preview()}
    catch{png=null;bmp=null;$('#wmImgName').textContent='';toast('Could not read that image.')}
  };
  const step=(n:number)=>{pv+=n;render()};
  $('#wmPrev').onclick=()=>step(-1);$('#wmNext').onclick=()=>step(1);

  $('#wmAdd').onclick=async()=>{
    const d=getDoc();if(!d)return toast('Open a PDF first.');
    const o=opts();
    if(o.kind==='image'&&!png)return toast('Choose an image first.');
    if(o.kind==='text'&&!o.text.trim())return toast('Type the watermark text first.');
    try{
      let base=d.bytes,replaced=0;
      if(on('#wmReplace')){const r=await removeWatermarks(d.bytes,true);base=r.out;replaced=r.pages} // swap out the one added earlier instead of stacking
      const {out,pages}=await addWatermark(base,o);
      setDoc(d.name,out);toast(`Watermark applied to ${pages} page${pages>1?'s':''}${replaced?', replacing the earlier one':''}. Undo reverts it.`);
    }catch(e){
      const m=(e as Error).message||String(e);
      toast(/WinAnsi|encode/i.test(m)?fontMsg:m);
    }
  };
  $('#wmDel').onclick=async()=>{
    const d=getDoc();if(!d)return toast('Open a PDF first.');
    try{
      const {out,pages}=await removeWatermarks(d.bytes);
      if(!pages)return toast('No removable watermark found. Only watermarks added here, or ones tagged as watermarks by other tools, can be detected.');
      setDoc(d.name,out);toast(`Removed watermarks from ${pages} page${pages>1?'s':''}. Undo reverts it.`);
    }catch(e){toast((e as Error).message||String(e))}
  };
}
