// Shared pdf.js helpers for tools that show page thumbnails/previews.
import * as pdfjs from 'pdfjs-dist';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).href;
export type View=pdfjs.PDFDocumentProxy;
export const openPdf=(bytes:Uint8Array)=>pdfjs.getDocument({data:bytes.slice()}).promise;
/** Draw page `i` (0-based) into `cv`, `width` CSS px wide. */
export async function paint(pdf:View,i:number,cv:HTMLCanvasElement,width:number){
  const pg=await pdf.getPage(i+1),dpr=Math.min(window.devicePixelRatio||1,2),vp=pg.getViewport({scale:width/pg.getViewport({scale:1}).width});
  cv.width=Math.round(vp.width*dpr);cv.height=Math.round(vp.height*dpr);
  await pg.render({canvasContext:cv.getContext('2d')!,viewport:vp,transform:dpr!==1?[dpr,0,0,dpr,0,0]:undefined}).promise;
}
