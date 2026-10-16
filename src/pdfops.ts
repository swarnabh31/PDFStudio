// Pure PDF operations (no DOM): loading, page reshaping, watermarks, and orphan-object pruning.
import {PDFDocument,PDFName,PDFNumber,PDFRef,PDFDict,PDFArray,PDFStream,PDFRawStream,PDFNull,PDFBool,PDFOperator,PDFOperatorNames as Ops,
  StandardFonts,degrees,rgb,decodePDFRawStream,type PDFObject} from 'pdf-lib';
import {parseRanges} from './util';

export class LockedError extends Error{constructor(){super('This PDF is password-protected. Unlock it in the Password tab first.');this.name='LockedError'}}
const hasEncrypt=(b:Uint8Array)=>new TextDecoder('latin1').decode(b).includes('/Encrypt');

/** Load for editing. Encrypted files throw a LockedError instead of pdf-lib's cryptic parse errors. */
export async function loadPdf(bytes:Uint8Array){
  try{return await PDFDocument.load(bytes.slice(),{updateMetadata:false})}
  catch(e){throw hasEncrypt(bytes)?new LockedError():e}
}
export const isEncrypted=(bytes:Uint8Array)=>loadPdf(bytes).then(()=>false,e=>e instanceof LockedError);

/**
 * pdf-lib never garbage-collects: removed pages / watermark streams would stay inside the saved file.
 * Walk everything reachable from the trailer, null-out references to `dropped` objects (bookmarks, link
 * destinations…) so they can't keep a deleted page alive, then delete every unreachable object.
 */
export function prune(doc:PDFDocument,dropped:PDFRef[]=[]){
  const ctx=doc.context,gone=new Set(dropped.map(r=>r.tag)),keep=new Set<string>();
  const t=ctx.trailerInfo,stack:(PDFObject|undefined)[]=[t.Root,t.Info,t.ID,t.Encrypt];
  while(stack.length){
    const o=stack.pop();
    if(o instanceof PDFRef){if(!keep.has(o.tag)){keep.add(o.tag);stack.push(ctx.lookup(o))}continue}
    const d=o instanceof PDFStream?o.dict:o instanceof PDFDict?o:null;
    if(d)for(const [k,v] of d.entries()){if(v instanceof PDFRef&&gone.has(v.tag))d.set(k,PDFNull);else stack.push(v)}
    else if(o instanceof PDFArray)for(let i=0;i<o.size();i++){const v=o.get(i);if(v instanceof PDFRef&&gone.has(v.tag))o.set(i,PDFNull);else stack.push(v)}
  }
  for(const [ref] of ctx.enumerateIndirectObjects())if(!keep.has(ref.tag))ctx.delete(ref);
}

/** Output page list: `src` is the page's index in the input, `rot` extra clockwise degrees (multiple of 90). */
export interface PagePlan{src:number;rot:number}
/** Rotate, delete and reorder pages in one pass, keeping forms/metadata and dropping deleted content for real. */
export async function reshape(bytes:Uint8Array,plan:PagePlan[]){
  if(!plan.length)throw new Error('A PDF needs at least one page.');
  const doc=await loadPdf(bytes),pages=doc.getPages(),ctx=doc.context;
  const rootRef=doc.catalog.get(PDFName.of("Pages"));if(!(rootRef instanceof PDFRef))throw new Error('Unsupported page tree.');
  const root=doc.catalog.Pages();
  // flattening the page tree would lose attributes pages inherit from intermediate nodes — copy them down first
  for(const p of pages)for(const k of ['Resources','MediaBox','CropBox','Rotate']){
    const n=PDFName.of(k);if(!p.node.has(n)){const v=p.node.getInheritableAttribute(n);if(v)p.node.set(n,v)}
  }
  for(const p of plan)if(p.rot){const pg=pages[p.src];pg.setRotation(degrees((((pg.getRotation().angle+p.rot)%360)+360)%360))}
  const used=new Set(plan.map(p=>p.src)),gone=pages.filter((_,i)=>!used.has(i)).map(p=>p.ref);
  root.set(PDFName.of('Kids'),ctx.obj(plan.map(p=>pages[p.src].ref)));
  root.set(PDFName.of('Count'),PDFNumber.of(plan.length));
  for(const p of plan)pages[p.src].node.setParent(rootRef);
  prune(doc,gone);
  return doc.save({addDefaultPage:false});
}

// ---------------- watermarks ----------------
export interface WM{kind:'text'|'image';text:string;png?:Uint8Array;size:number;scale:number;opacity:number;angle:number;color:string;tiled:boolean;pages:string}
const KEY=PDFName.of('PSWatermark'); // private marker on the content stream we add, so removal is exact

/** Size and positions of the watermark on a page shown vw×vh pt. Shared by the PDF writer and the on-screen preview, so they always agree.
 *  `cs` are watermark centres relative to the page centre (y up); `hOff` is baseline→visual centre. */
export function wmLayout(o:WM,vw:number,vh:number,textW:(t:string,size:number)=>number,imgAR:number){
  const th=o.angle*Math.PI/180,text=o.kind==='text';
  let w=text?textW(o.text,o.size):vw*o.scale/100,size=o.size;
  const chord=Math.min(vw/Math.abs(Math.cos(th)||1e-9),vh/Math.abs(Math.sin(th)||1e-9)); // page length along the watermark's direction
  if(w>chord*.8){size*=chord*.8/w;w=chord*.8}                // never let it run off a small page
  const h=text?size:w*imgAR,hOff=text?size*.36:h/2;
  let cs:[number,number][]=[[0,0]];
  if(o.tiled){
    let sx=w+Math.max(w*.6,40),sy=h*2.5+30,M:number;
    for(;;){M=Math.ceil(Math.hypot(vw,vh)/Math.min(sx,sy));if((2*M+1)**2<=1500)break;sx*=1.3;sy*=1.3}
    cs=[];for(let a=-M;a<=M;a++)for(let j=-M;j<=M;j++){
      const u=(a+(j&1?.5:0))*sx,v=j*sy,dx=u*Math.cos(th)-v*Math.sin(th),dy=u*Math.sin(th)+v*Math.cos(th);
      if(Math.abs(dx)<=vw/2+w/2&&Math.abs(dy)<=vh/2+w/2)cs.push([dx,dy]);
    }
  }
  return {w,h,size,hOff,cs};
}
let mf:Promise<(t:string,size:number)=>number>|null=null;
/** Text-width function for the watermark font (Helvetica Bold), for the preview. */
export const watermarkMeasure=()=>mf??=(async()=>{const f=await (await PDFDocument.create()).embedFont(StandardFonts.HelveticaBold);return (t:string,z:number)=>f.widthOfTextAtSize(t,z)})();

/** Draws the watermark as its own tagged content stream (also marked as a standard /Artifact /Watermark). Returns pages touched. */
export async function addWatermark(bytes:Uint8Array,o:WM){
  const doc=await loadPdf(bytes),ctx=doc.context;
  const font=o.kind==='text'?await doc.embedFont(StandardFonts.HelveticaBold):null;
  const img=o.kind==='image'?await doc.embedPng(o.png!):null;
  const c=/^#?([0-9a-f]{6})$/i.exec(o.color)?.[1]||'888888',col=rgb(...[0,2,4].map(i=>parseInt(c.slice(i,i+2),16)/255) as [number,number,number]);
  const idx=o.pages.trim()?[...new Set(parseRanges(o.pages,doc.getPageCount()).flat())]:doc.getPageIndices();
  const th=o.angle*Math.PI/180,tag=ctx.obj({Type:'Pagination',Subtype:'Watermark'});
  for(const i of idx){
    const pg=doc.getPage(i),b=pg.getCropBox(),r=((pg.getRotation().angle%360)+360)%360,sw=r%180!==0;
    const vw=sw?b.height:b.width,vh=sw?b.width:b.height;       // size of the page as displayed
    const {w,h,size,hOff,cs}=wmLayout(o,vw,vh,(t,z)=>font!.widthOfTextAtSize(t,z),img?img.height/img.width:1);
    pg.pushOperators(PDFOperator.of(Ops.BeginMarkedContentSequence,[PDFName.of('Artifact'),tag as any]));
    const phi=(o.angle+r)*Math.PI/180;                         // displayed angle → page-content angle
    for(const [dx,dy] of cs){
      const vx=vw/2+dx,vy=vh/2-dy;                             // displayed, y down — same mapping the signature tool uses
      const [px,py]=r===0?[vx,b.height-vy]:r===90?[vy,vx]:r===180?[b.width-vx,vy]:[b.width-vy,b.height-vx];
      const x=b.x+px-(w/2*Math.cos(phi)-hOff*Math.sin(phi)),y=b.y+py-(w/2*Math.sin(phi)+hOff*Math.cos(phi));
      if(font)pg.drawText(o.text,{x,y,size,font,color:col,opacity:o.opacity,rotate:degrees(o.angle+r)});
      else pg.drawImage(img!,{x,y,width:w,height:h,opacity:o.opacity,rotate:degrees(o.angle+r)});
    }
    pg.pushOperators(PDFOperator.of(Ops.EndMarkedContent));
    const arr=pg.node.Contents() as PDFArray;ctx.lookup(arr.get(arr.size()-1),PDFStream).dict.set(KEY,PDFBool.True);
  }
  return {out:await doc.save({addDefaultPage:false}),pages:idx.length};
}

const bin=(u:Uint8Array)=>{let s='';for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode(...u.subarray(i,i+32768));return s};
/** Cuts `/Artifact <</Subtype /Watermark …>> BDC … EMC` blocks (how Acrobat & many tools tag watermarks). null = nothing found. */
function stripTagged(s:PDFRawStream):Uint8Array|null{
  try{
    const t=bin(decodePDFRawStream(s).decode());if(!t.includes('Watermark'))return null;
    const open=/\/Artifact\s*<<((?:(?!>>)[\s\S])*)>>\s*BDC/g,tok=/(?<![\w/])(BDC|BMC|EMC)(?![\w])/g;
    let out='',last=0,hit=false,m:RegExpExecArray|null;
    while((m=open.exec(t))){
      if(!/\/Watermark\b/.test(m[1])||m.index<last)continue;
      tok.lastIndex=open.lastIndex;let depth=1,e:RegExpExecArray|null,end=-1;
      while(depth&&(e=tok.exec(t))){depth+=e[1]==='EMC'?-1:1;if(!depth)end=tok.lastIndex}
      if(end<0)continue;
      out+=t.slice(last,m.index);last=end;hit=true;open.lastIndex=end;
    }
    return hit?Uint8Array.from(out+t.slice(last),ch=>ch.charCodeAt(0)):null;
  }catch{return null}
}

/** Removes watermarks added by this app, plus standard tagged watermarks from other tools (unless `oursOnly`). */
export async function removeWatermarks(bytes:Uint8Array,oursOnly=false){
  const doc=await loadPdf(bytes),ctx=doc.context;let hit=0;
  for(const pg of doc.getPages()){
    pg.node.normalize();const arr=pg.node.Contents();if(!(arr instanceof PDFArray))continue;
    let h=false;
    for(let i=arr.size()-1;i>=0;i--){
      const ref=arr.get(i),s=ctx.lookup(ref);if(!(s instanceof PDFStream))continue;
      if(s.dict.has(KEY)){arr.remove(i);h=true}
      else if(!oursOnly&&s instanceof PDFRawStream){const n=stripTagged(s);if(n){ctx.assign(ref as PDFRef,ctx.flateStream(n));h=true}}
    }
    if(h)hit++;
  }
  if(!hit)return {out:bytes,pages:0};
  prune(doc);
  return {out:await doc.save({addDefaultPage:false}),pages:hit};
}
