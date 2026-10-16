// qpdf compiled to WebAssembly (loaded on first use): the only way here to write/read encrypted PDFs, since pdf-lib can't.
import wasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url';
/** Run qpdf on `input`; refer to the files as /in.pdf and /out.pdf in `args`. Throws with qpdf's message if no output was produced. */
export async function qpdf(args:string[],input:Uint8Array):Promise<Uint8Array>{
  const {default:create}=await import('@neslinesli93/qpdf-wasm'),log:string[]=[];
  const q:any=await (create as any)({noInitialRun:true,locateFile:()=>wasmUrl,print:(s:string)=>log.push(s),printErr:(s:string)=>log.push(s)});
  q.FS.writeFile('/in.pdf',input);
  try{q.callMain(args)}catch{/* a failed run is detected by the missing output below */}
  try{return q.FS.readFile('/out.pdf')}catch{throw new Error(log.join(' ')||'qpdf produced no output')}
}
