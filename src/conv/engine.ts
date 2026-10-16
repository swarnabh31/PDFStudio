// Client-side converters: no server, no extra deps. Uses pdf-lib (write PDF), pdfjs (read PDF text)
// and fflate (zip/unzip .docx) — all already bundled in the app.
import {PDFDocument, StandardFonts, rgb} from 'pdf-lib';
import {zipSync, strToU8, unzipSync, strFromU8} from 'fflate';
import {openPdf} from '../pdfview';

export interface Out{name:string;bytes:Uint8Array;mime:string}
export type C=[number,number,number];

// ---- a small, renderer-agnostic model of "pages of styled, wrappable content" ----
interface T{t:string;b?:boolean;i?:boolean;mono?:boolean;sz:number;c?:C}
interface I{bytes:Uint8Array;mime:string;w:number;h:number}
export type Frag=T|I;
export const fragIsImg=(f:Frag):f is I=>'bytes' in f;
export interface Line{frgs:Frag[];sz:number;indent?:number;bullet?:string;align?:'left'|'center'|'right';before?:number;after?:number;code?:boolean;rule?:boolean}
export interface Doc{lines:Line[]}
type Base={sz:number;b?:boolean;i?:boolean;mono?:boolean;c?:C};

const INK:C=[0.13,0.15,0.2];
const MUTED:C=[0.42,0.44,0.52];
const LINK:C=[0.10,0.29,0.82];
const CODEINK:C=[0.10,0.12,0.17];
const CODEBG:C=[0.94,0.94,0.97];

// A4 (pt) and page margins
const PW=595.28, PH=841.89, ML=65, MR=65;
const right=PW-MR, contentW=PW-ML-MR, bottom=54;

// ---------------- WinAnsi (cp1252) text fitting ----------------
// pdf-lib's standard fonts only encode WinAnsi. Anything outside it (box drawing,
// arrows, CJK, ...) is mapped to a close WinAnsi-safe stand-in so such documents
// still render instead of throwing "WinAnsi cannot encode …".
const CP1252=new Set([
  0x0152,0x0153,0x0160,0x0161,0x017d,0x017e,0x0178,0x0192,0x02c6,0x02dc,
  0x2013,0x2014,0x2018,0x2019,0x201a,0x201b,0x201c,0x201d,0x201e,0x201f,
  0x2020,0x2021,0x2022,0x2026,0x2030,0x2039,0x203a,0x20ac,0x2122]);
const BLOCK=new Map([
  ['\u2588','#'],['\u2580','#'],['\u2581','#'],['\u2582','#'],['\u2583','#'],['\u2584','#'],['\u2585','#'],['\u2586','#'],['\u2587','#'],
  ['\u2589','~'],['\u258a','~'],['\u258b','~'],['\u258c','~'],['\u258d','~'],['\u258e','~'],['\u258f','~'],
  ['\u2590','.'],['\u2591','.'],['\u2592',':'],['\u2593',':'],['\u2594',':'],['\u2595',':'],['\u2596',':'],['\u2597',':'],
  ['\u2598',':'],['\u2599',':'],['\u259a',':'],['\u259b',':'],['\u259c',':'],['\u259d',':'],['\u259e',':'],['\u259f',':']]);
const BOX_H=new Set(['\u2500','\u2501','\u2504','\u2509','\u250c','\u2510','\u2514','\u2518','\u2524','\u252e','\u2530','\u2532',
  '\u253c','\u253e','\u2542','\u2547','\u254a','\u254c','\u254e']);
const BOX_V=new Set(['\u2502','\u2503','\u2506','\u250a','\u250b','\u250d','\u250e','\u2515','\u252a','\u2534','\u253b',
  '\u252c','\u252d','\u252f','\u2531','\u2533','\u253d','\u253f','\u2541','\u2543','\u2548','\u2549','\u254b','\u254d','\u254f','\u2506']);
const CH_MAP:Record<string,string>={
  // spaces & invisibles
  '\u00a0':' ','\u00ad':'','\u200b':'','\u200c':'','\u200d':'','\u2060':'',
  '\u2000':' ','\u2001':' ','\u2002':' ','\u2003':' ','\u2004':' ','\u2005':' ','\u2006':' ',
  '\u2007':' ','\u2008':' ','\u2009':' ','\u200a':' ','\u2028':' ','\u2029':' ',
  '\u202f':' ','\u205f':' ','\u3000':' ','\ufffd':'','\u0559':'','\u203b':'','\u061c':'',
  // dashes / punctuation
  '\u2011':'-','\u2212':'-','\u2026':'...',
  // arrows & geometric shapes
  '\u2190':'<-','\u2192':'->','\u2194':'<->','\u2195':'<->','\u2191':'^','\u2193':'v','\u21d0':'<-','\u21d2':'->',
  '\u25ba':'>','\u25bc':'v','\u25b2':'^','\u25c0':'<','\u25c2':'<','\u25c4':'<','\u25c6':'\u00b7',
  '\u25cb':'o','\u25cc':'o','\u25cf':'\u2022','\u25aa':'\u2022','\u25a0':'#','\u25a1':'o',
  // misc
  '\u2713':'*','\u2714':'*','\u2610':'[ ]','\u2611':'[x]','\u2612':'[x]',
};
export const fitText=(s:string):string=>Array.from(s).map(ch=>{
  const m=CH_MAP[ch]??BLOCK.get(ch);
  if(m!==undefined)return m;
  if(BOX_H.has(ch))return '-';
  if(BOX_V.has(ch))return '|';
  const cp=ch.codePointAt(0)!;
  if(cp<0x20)return ch===' '||ch==='\t'?' ':'';
  if(cp<=0xff)return ch; // Latin-1 (a few cp1252-undefined holes are practically absent)
  if(CP1252.has(cp))return ch;
  return '\u00b7'; // visible placeholder for CJK, emoji, etc.
}).join('');

// ---------------- the PDF writer (shared by TXT, Markdown, Word) ----------------
type Tok={kind:'t';s:string;t:T}|{kind:'i';i:I}

function toTokens(line:Line):Tok[]{
  const out:Tok[]=[];
  for(const fr of line.frgs){
    if(fragIsImg(fr)){out.push({kind:'i',i:fr});continue}
    for(const p of fitText(fr.t).split(/\s+/).filter(Boolean))out.push({kind:'t',s:p,t:fr});
  }
  return out;
}

export async function pdfFromDoc(doc:Doc):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  const reg=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const ital=await pdf.embedFont(StandardFonts.HelveticaOblique);
  const boldItal=await pdf.embedFont(StandardFonts.HelveticaBoldOblique);
  const mono=await pdf.embedFont(StandardFonts.Courier);
  const fontOf=(t:T)=>t.mono?mono:t.b&&t.i?boldItal:t.b?bold:t.i?ital:reg;
  const width=(s:string,t:T)=>fontOf(t).widthOfTextAtSize(s,t.sz);
  const spaceW=(t:T)=>fontOf(t).widthOfTextAtSize(' ',t.sz);

  const imgCache=new Map<I, Awaited<ReturnType<typeof pdf.embedPng>>>();
  for(const fr of doc.lines.flatMap(l=>l.frgs)){
    if(!fragIsImg(fr)||imgCache.has(fr))continue;
    const img=fr.mime==='image/jpeg'? await pdf.embedJpg(fr.bytes) : await pdf.embedPng(fr.bytes);
    imgCache.set(fr,img);
  }

  let page=pdf.addPage([PW,PH]);
  let y=PH-64;
  const newPage=()=>{page=pdf.addPage([PW,PH]);y=PH-64};
  const colorOf=(c?:C)=>rgb(...(c||INK));

  for(const line of doc.lines){
    const lh=Math.max(line.sz,11)*1.3;
    y-=(line.before??0);
    if(line.rule){
      if(y<bottom+lh)newPage();
      page.drawLine({start:{x:ML,y},end:{x:right,y},thickness:1,color:rgb(0.66,0.68,0.76)});
      y-=(line.after??8);continue;
    }
    if(line.code){ // a soft highlight band behind the first visual line
      y-=0;
      page.drawRectangle({x:ML-6,y:y-(lh)+3,width:contentW+12,height:lh-3,color:rgb(0.93,0.93,0.97)});
    }

    let startX=ML, wrapX=ML;
    const toks=toTokens(line);
    const approx=toks.reduce((a,t)=>a+(t.kind==='t'?width(t.s,t.t):t.i.w),0)+Math.max(0,toks.filter(t=>t.kind==='t').length-1)*spaceW({sz:line.sz} as T);
    if(line.bullet){
      page.drawText(fitText(line.bullet),{x:ML,y,size:line.sz,font:fontOf({t:'',sz:line.sz} as T),color:rgb(0.5,0.52,0.6)});
      startX+=Math.max(line.sz,11)*0.95;
      wrapX=startX;
    } else {
      startX+=line.indent??0;wrapX=startX;
    }
    if(line.align==='center'&&startX+approx<=right)startX=ML+(contentW-approx)/2;
    else if(line.align==='right'&&startX+approx<=right)startX=right-approx;

    let x=startX, first=true, prevText=false;
    for(const tok of toks){
      const w=tok.kind==='t'?width(tok.s,tok.t):tok.i.w;
      if(!first&&(x+w)>right){
        y-=lh;if(y<bottom){newPage()}
        x=wrapX;first=true;prevText=false;
      }
      if(!first&&prevText&&tok.kind==='t')x+=spaceW(tok.t);
      if(tok.kind==='t'){
        page.drawText(tok.s,{x,y,size:tok.t.sz,font:fontOf(tok.t),color:colorOf(tok.t.c)});
        x+=w;prevText=true;
      }else{
        const img=imgCache.get(tok.i)!;
        page.drawImage(img,{x,y:y-tok.i.h,width:tok.i.w,height:tok.i.h});
        x+=tok.i.w+10;prevText=false;
      }
      first=false;
    }
    y-=lh+(line.after??0);
  }
  return pdf.save();
}

// ---------------- Markdown -> model ----------------
const mkf=(t:string,b:Base):Frag=>({t,sz:b.sz||11,b:b.b,i:b.i,mono:b.mono,c:b.c});
function inline(text:string,b:Base):Frag[]{
  const out:Frag[]=[];
  const re=/(\*\*([^*]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last=0,m:RegExpExecArray|null;
  while((m=re.exec(text))){
    if(m.index>last)out.push(mkf(text.slice(last,m.index),b));
    if(m[2]!=null)out.push(mkf(m[2],{...b,b:true}));
    else if(m[3]!=null)out.push(mkf(m[3],{...b,i:true}));
    else if(m[4]!=null)out.push(mkf(m[4],{...b,i:true}));
    else if(m[5]!=null)out.push(mkf(m[5],{...b,b:false,i:false,mono:true,c:CODEINK}));
    else if(m[6]!=null)out.push(mkf(m[6]+(m[7]&&m[7]!==m[6]?' ('+m[7]+')':''),{...b,b:false,i:false,c:LINK}));
    last=re.lastIndex;
  }
  if(last<text.length)out.push(mkf(text.slice(last),b));
  return out;
}

export function docFromMd(md:string,base=11):Doc{
  const L:Line[]=[];
  const sizes=[base*1.85,base*1.5,base*1.25,base*1.15,base*1.08,base];
  let inCode=false,codeBuf:string[]=[];
  const flushCode=()=>{for(const cl of codeBuf)L.push({frgs:[{t:cl||' ',sz:base*0.92,mono:true,c:CODEINK}],sz:base*0.92,code:true,before:1,after:1});codeBuf=[]};
  const src=md.replace(/\r\n/g,'\n').split('\n');
  for(const raw of src){
    if(/^\s*(```|~~~)/.test(raw)){if(inCode)flushCode();inCode=!inCode;continue}
    if(inCode){codeBuf.push(raw);continue}
    const H=/^\s{0,3}(#{1,6})\s+(.*)$/.exec(raw);
    if(H){const lvl=Math.min(H[1].length,6);L.push({frgs:inline(H[2],{sz:sizes[lvl-1],b:true}),sz:sizes[lvl-1],align:'left',before:base*0.8,after:base*0.5});continue}
    if(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(raw)){L.push({frgs:[],sz:base,rule:true,before:base*0.6,after:base*0.6});continue}
    const Q=/^\s*>\s?(.*)$/.exec(raw);
    if(Q){L.push({frgs:inline(Q[1],{sz:base,i:true,c:MUTED}),sz:base,indent:base,before:2,after:2});continue}
    const LI=/^\s{0,3}([-*+]|\d{1,2}\.)\s+(.*)$/.exec(raw);
    if(LI){const level=Math.min(3,Math.floor((raw.length-raw.trimStart().length)/2));const ordered=/\d/.test(LI[1]);L.push({frgs:inline(LI[2],{sz:base}),sz:base,indent:base*1.1+level*base*0.5,bullet:ordered?LI[1].replace(/\./g,''):'•',before:1,after:1});continue}
    if(!raw.trim()){L.push({frgs:[],sz:base,before:0,after:base*0.5});continue}
    L.push({frgs:inline(raw,{sz:base}),sz:base,before:0,after:2});
  }
  if(inCode)flushCode();
  while(L.length&&(!L[L.length-1].frgs.length)&&!L[L.length-1].rule)L.pop();
  return {lines:L};
}

export function docFromTxt(text:string,base=11):Doc{
  const L:Line[]=[];
  for(const raw of text.replace(/\r\n/g,'\n').split('\n')){
    if(!raw.trim())L.push({frgs:[],sz:base,before:0,after:base*0.5});
    else L.push({frgs:[{t:raw,sz:base,c:INK}],sz:base,before:0,after:1});
  }
  while(L.length&&!L[L.length-1].frgs.length)L.pop();
  return {lines:L};
}

// ---------------- Word (.docx) -> model ----------------
function relsMap(zip:Record<string,Uint8Array>):Record<string,string>{
  const out:Record<string,string>={};
  const u8=zip['word/_rels/document.xml.rels'];
  if(!u8)return out;
  const d=new DOMParser().parseFromString(strFromU8(u8),'application/xml');
  for(const r of Array.from(d.getElementsByTagName('Relationship'))){
    const id=r.getAttribute('Id')||'',tgt=r.getAttribute('Target')||'';
    if(id&&tgt)out[id]=tgt.replace(/^.*[\\/]/,'').replace(/^\.?\.?\//,'');
  }
  return out;
}
function attr(el:Element,sufix:string):string|undefined{
  for(const a of Array.from(el.attributes)){const n=(a.name||'');if(n===sufix||n.endsWith(':'+sufix))return a.value}
  return undefined;
}
export function docFromDocx(bytes:Uint8Array):Doc{
  let zip:Record<string,Uint8Array>;
  try{zip=unzipSync(bytes)}catch{throw new Error('That isn\'t an .docx we can open.')}
  const dz=zip['word/document.xml'];
  if(!dz)throw new Error('No document content found in that .docx.');
  const d=new DOMParser().parseFromString(strFromU8(dz),'application/xml');
  if(d.getElementsByTagName('parsererror').length)throw new Error('Could not parse that .docx.');
  const rels=relsMap(zip);
  const L:Line[]=[];

  const addRun=(r:Element,frgs:Frag[])=>{
    const rPr=r.getElementsByTagName('w:rPr')[0];
    let b=false,i=false,sz=10.6;
    if(rPr){
      const bb=rPr.getElementsByTagName('w:b')[0];
      b=!!bb&&bb.getAttribute('w:val')!=='0'&&bb.getAttribute('w:val')!=='false';
      if(rPr.getElementsByTagName('w:i')[0])i=true;
      const s=rPr.getElementsByTagName('w:sz')[0];
      const szv=s?.getAttribute('w:val');
      if(szv)sz=(+szv)/2;
    }
    let text='';
    for(const ch of Array.from(r.children)){
      const tag=ch.tagName;
      if(tag==='w:t')text+=(ch.textContent||'');
      else if(tag==='w:tab'&&!(text.endsWith(' ')))text+=' ';
      else if(tag==='w:br')text+=' ';
    }
    if(text)frgs.push({t:text,sz,b,i,c:INK});
  };
  const addImg=(el:Element,frgs:Frag[])=>{
    try{
      const blip=el.getElementsByTagName('a:blip')[0];
      if(!blip)return;
      const rid=attr(blip,'embed');
      const target=rid?rels[rid]:undefined;
      if(!target)return;
      const u8=zip['word/'+target];
      if(!u8)return;
      const ext=el.getElementsByTagName('wp:extent')[0];
      const cx=ext?+(attr(ext,'cx')||0):0;
      const cy=ext?+(attr(ext,'cy')||0):0;
      const cxPt=cx?cx/12700:240;
      const w=Math.min(cxPt,contentW);
      const scale=cx?w/cxPt:1;
      const h=cy?(cy/12700)*scale:w*0.5;
      frgs.push({bytes:u8,mime:/\.jpe?g$/i.test(target)?'image/jpeg':'image/png',w,h});
    }catch{/* drop the image, keep the text */}
  };

  const walk=(el:Element,frgs:Frag[])=>{
    for(const ch of Array.from(el.children)){
      const tag=ch.tagName;
      if(tag==='w:pPr'||tag==='w:bookmarkStart'||tag==='w:bookmarkEnd'||tag==='w:proofErr'||tag==='w:comment')continue;
      if(tag==='w:r'){addRun(ch,frgs);continue}
      if(tag==='w:hyperlink'||tag==='w:sdt'||tag==='w:ins'||tag==='w:smartTag'){walk(ch,frgs);continue}
      if(tag==='w:drawing'||tag==='w:object'){addImg(ch,frgs);continue}
      if(tag==='w:tc'||tag==='w:tr'){walk(ch,frgs);continue}
      walk(ch,frgs);
    }
  };

  const ps=Array.from(d.getElementsByTagName('w:p'));
  for(const p of ps){
    const pPr=p.getElementsByTagName('w:pPr')[0];
    let style='',lvl=0,align:'left'|'center'|'right'='left',bullet='';
    if(pPr){
      const s=pPr.getElementsByTagName('w:pStyle')[0];
      if(s)style=(s.getAttribute('w:val')||'').toLowerCase();
      const m=/heading\s*(\d)/.exec(style);
      if(m)lvl=+m[1];
      if(/\btitle\b|(subtitle)/.test(style)&&!lvl)lvl=0;
      const o=pPr.getElementsByTagName('w:outlineLvl')[0];
      if(o)lvl=+(o.getAttribute('w:val')||0);
      if(pPr.getElementsByTagName('w:numPr')[0])bullet='•';
      const jc=pPr.getElementsByTagName('w:jc')[0];
      if(jc){const v=jc.getAttribute('w:val')||'';if(v==='center'||v==='right')align=v}
    }
    const isHead=!!lvl||(style==='title'||style==='subtitle');
    const base=10.6;
    const headSizes=[20,16,13.5,12.6,11.6];
    const isTitle=style==='title'&&lvl===0;
    const sz=isTitle?18:isHead?(headSizes[Math.min(lvl,5)-1]||base):base;
    const frgs:Frag[]=[];
    walk(p,frgs);
    const textFrags=frgs.filter(f=>!fragIsImg(f)) as T[];
    const lineSz=Math.max(base,...(textFrags.length?textFrags.map(f=>f.sz):[base]));
    const mapped=frgs.map(f=>fragIsImg(f)?f:({...f,sz:f.sz|| (isHead?sz:base)})) as Frag[];
    L.push({frgs:mapped,sz:lineSz,indent:bullet?base*1.1:0,bullet:bullet||undefined,align,
      before:isHead?base*0.8:base*0.15,after:isHead?base*0.5:base*0.18});
  }
  while(L.length&&(!L[L.length-1].frgs.length)&&!L[L.length-1].rule)L.pop();
  return {lines:L};
}

// ---------------- PDF text -> readable pieces (PDFjs) ----------------
export interface ExItem{str:string;x:number;y:number;w:number;sz:number;bold:boolean}
export interface ExLine{items:ExItem[];sz:number;y:number}
export interface ExPage{lines:ExLine[]}
export async function extractPdf(bytes:Uint8Array):Promise<ExPage[]>{
  const pdf=await openPdf(bytes);
  const pages:ExPage[]=[];
  for(let n=1;n<=pdf.numPages;n++){
    const pg=await pdf.getPage(n);
    const tc:any=await pg.getTextContent();
    const styles:Record<string,any>=(tc.styles)||{};
    const raw:ExItem[]=tc.items.filter((it:any)=>typeof it.str==='string'&&it.str.length).map((it:any)=>{
      const tr: number[]=it.transform||[1,0,0,1,0,0];
      const sz=it.height||(Math.hypot(tr[2],tr[3]))||11;
      const fp=styles[it.fontName]||{};
      const name=((fp.fontFamily||'')+' '+(it.fontName||'')).toLowerCase();
      return {str:it.str,x:tr[4],y:tr[5],w:it.width||0,sz,bold:/bold/i.test(name)};
    }).sort((a:ExItem,b:ExItem)=>b.y-a.y||a.x-b.x);
    const lines:ExLine[]=[];
    for(const it of raw){
      const tol=Math.max(1.5,it.sz*0.4);
      const lastL=lines[lines.length-1];
      if(lastL&&Math.abs(lastL.y-it.y)<=tol){lastL.items.push(it);lastL.sz=Math.max(lastL.sz,it.sz)}
      else lines.push({items:[it],sz:it.sz,y:it.y});
    }
    lines.forEach(ln=>ln.items.sort((a,b)=>a.x-b.x));
    pages.push({lines});
  }
  await pdf.destroy();
  return pages;
}

function lineText(ln:ExLine):string{
  let out='',prevRight=-1;
  for(const it of ln.items){
    if(!it.str)continue;
    if(prevRight>=0){const gap=it.x-prevRight;if(gap>Math.max(1,it.sz*0.28))out+=' '}
    out+=it.str;prevRight=it.x+(it.w||0);
  }
  return out.replace(/\s+/g,' ').trim();
}
export function txtFromPages(pages:ExPage[]):string{
  return pages.map(pg=>pg.lines.map(lineText).filter(Boolean).join('\n')).join('\n\n\n');
}
export function mdFromPages(pages:ExPage[]):string{
  const out:string[]=[];
  pages.forEach((pg,pi)=>{
    const sizes=[...pg.lines.map(l=>l.sz)].sort((a,b)=>a-b);
    const med=(sizes[Math.floor(sizes.length/2)])||11;
    if(pages.length>1)out.push(`<!-- Page ${pi+1} -->`);
    let para:string[]=[];
    const flush=()=>{if(para.length){out.push(para.join(''));para=[]}};
    let lastY=0;
    for(const ln of pg.lines){
      const text=lineText(ln);
      const jump=lastY? (lastY-ln.y)/(med*1.4) : 0;
      if(!text){flush();lastY=ln.y;continue}
      const ratio=ln.sz/med;
      if(ratio>=1.25&&text.length<=140){
        flush();
        const lvl=ratio>=2?1:ratio>=1.7?2:ratio>=1.4?3:4;
        out.push('#'.repeat(lvl)+' '+text);
      }
      else{
        if(para.length&&(jump>=1||text.charCodeAt(0)<32))para.push('');
        else if(para.length)para[para.length-1]+= ' ';
        else para.push('');
        para[para.length-1]+= text;
      }
      lastY=ln.y;
    }
    flush();
  });
  return out.join('\n').replace(/\n{3,}/g,'\n\n').replace(/\s+$/gm,'').trim()+'\n';
}

// ---------------- model -> .docx (PDF text -> Word) ----------------
const CT=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const RELS=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DRELS=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const STYLES=()=>{
  const before=[300,240,200,160,120,120],size=[44,32,26,24,22,22];
  const h=(id:number)=>`<w:style w:type="paragraph" w:styleId="Heading${id}"><w:name w:val="heading ${id}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="${before[id-1]}" w:after="140"/><w:outlineLvl w:val="${id-1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size[id-1]}"/><w:szCs w:val="${size[id-1]}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${[1,2,3,4,5,6].map(h).join('')}</w:styles>`;
};
const escXml=(s:string)=>s.replace(/[<&>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'} as Record<string,string>)[c]);
export function docxFromPages(pages:ExPage[]):Uint8Array{
  const body:string[]=[];
  pages.forEach((pg,pi)=>{
    const sizes=[...pg.lines.map(l=>l.sz)].sort((a,b)=>a-b);
    const med=(sizes[Math.floor(sizes.length/2)])||11;
    if(pi>0)body.push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
    for(const ln of pg.lines){
      const text=lineText(ln);if(!text)continue;
      const ratio=ln.sz/med;
      const lvl=ratio>=2?1:ratio>=1.6?2:ratio>=1.3?3:ratio>=1.15?4:0;
      const jc=ln.items.length>1?(ln.items[ln.items.length-1].x+ln.items[ln.items.length-1].w):0;
      const aligned=jc>right*0.98?'justify':(ln.items.length&&ln.items.every(it=>Math.abs(it.x-((ln.items[0]?.x)||0))>contentW*0.35)?'center':'left');
      const pPr=[lvl?`<w:pStyle w:val="Heading${lvl}"/>`:null,(aligned==='center'?'<w:jc w:val="center"/>':aligned==='justify'?'<w:jc w:val="both"/>':'')].filter(Boolean).join('');
      const rPr=(lvl?'<w:b/>':'')+(lvl?'':'');
      body.push(`<w:p>${pPr?`<w:pPr>${pPr}</w:pPr>`:''}<w:r>${rPr}<w:t xml:space="preserve">${escXml(text)}</w:t></w:r></w:p>`);
    }
  });
  const document=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const files:Record<string,Uint8Array>={
    '[Content_Types].xml':strToU8(CT),
    '_rels/.rels':strToU8(RELS),
    'word/document.xml':strToU8(document),
    'word/styles.xml':strToU8(STYLES()),
    'word/_rels/document.xml.rels':strToU8(DRELS),
  };
  return zipSync(files,{level:9});
}

// ---------------- images -> PDF ----------------
export async function pdfFromImages(items:{bytes:Uint8Array;mime:string}[],mode:'fit'|'A4'):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  for(const it of items){
    let img;
    try{img=it.mime==='image/jpeg'? await pdf.embedJpg(it.bytes):await pdf.embedPng(it.bytes)}
    catch{img=await pdf.embedJpg(it.bytes)}
    if(mode==='A4'){
      const page=pdf.addPage([PW,PH]);
      const tW=contentW,tH=PH-120,ar=img.width/img.height;
      let w,h;if(ar>tW/tH){w=tW;h=tW/ar}else{h=tH;w=tH*ar}
      page.drawImage(img,{x:(PW-w)/2,y:(PH-h)/2,width:w,height:h});
    }else{
      const maxSide=PH-40,s=Math.min(1,maxSide/Math.max(img.width,img.height));
      const w=img.width*s,h=img.height*s,page=pdf.addPage([w,h]);
      page.drawImage(img,{x:0,y:0,width:w,height:h});
    }
  }
  return pdf.save();
}
