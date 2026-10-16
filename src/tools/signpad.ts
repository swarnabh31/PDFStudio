import {$} from '../util';
// Signature pad: Pointer Events cover mouse, touch and pen; pen pressure varies the stroke width.
export function drawSignature():Promise<Uint8Array|null>{
  const dlg=$<HTMLDialogElement>('#sigDlg'),cv=$<HTMLCanvasElement>('#sigCv'),ok=$<HTMLButtonElement>('#sigOk');
  return new Promise(res=>{
    dlg.showModal();
    const dpr=window.devicePixelRatio||1,W=cv.clientWidth,H=cv.clientHeight;
    cv.width=W*dpr;cv.height=H*dpr;
    const c=cv.getContext('2d')!;c.scale(dpr,dpr);c.lineCap='round';c.lineJoin='round';
    let box:number[]|null=null,last:{x:number;y:number}|null=null;ok.disabled=true;
    const ink=()=>(document.querySelector('input[name=ink]:checked') as HTMLInputElement).value;
    const pt=(e:PointerEvent)=>{const r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
    const seg=(e:PointerEvent)=>{
      if(!last)return;const p=pt(e);
      c.strokeStyle=ink();c.lineWidth=e.pointerType==='pen'?1+e.pressure*3.5:2.6;
      c.beginPath();c.moveTo(last.x,last.y);c.lineTo(p.x,p.y);c.stroke();
      box=box?[Math.min(box[0],p.x),Math.min(box[1],p.y),Math.max(box[2],p.x),Math.max(box[3],p.y)]:[p.x,p.y,p.x,p.y];
      last=p;ok.disabled=false;
    };
    cv.onpointerdown=e=>{cv.setPointerCapture(e.pointerId);last=pt(e);seg(e)};
    cv.onpointermove=e=>{if(!last)return;const ev=e.getCoalescedEvents?.();(ev&&ev.length?ev:[e]).forEach(seg)};
    cv.onpointerup=cv.onpointercancel=()=>{last=null};
    $('#sigClear').onclick=()=>{c.clearRect(0,0,W,H);box=null;ok.disabled=true};
    $('#sigCancel').onclick=()=>dlg.close();
    dlg.onclose=()=>res(null); // Esc / cancel (ignored if already resolved)
    ok.onclick=()=>{
      if(!box)return;const pad=6;
      const x0=Math.max(0,box[0]-pad),y0=Math.max(0,box[1]-pad),x1=Math.min(W,box[2]+pad),y1=Math.min(H,box[3]+pad);
      const o=document.createElement('canvas');o.width=Math.round((x1-x0)*dpr);o.height=Math.round((y1-y0)*dpr);
      o.getContext('2d')!.drawImage(cv,x0*dpr,y0*dpr,o.width,o.height,0,0,o.width,o.height);
      o.toBlob(async b=>{res(new Uint8Array(await b!.arrayBuffer()));dlg.close()},'image/png');
    };
  });
}
