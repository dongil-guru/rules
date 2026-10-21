// PKWARE APPNOTE: UTF-8 stored ZIP entries, streaming data descriptors and
// ZIP64 central-directory offsets. Attachment bodies are never buffered.
const encoder=new TextEncoder(),MAX32=0xffffffff;
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crcChunk=(crc,bytes)=>{for(let i=0;i<bytes.length;i++)crc=crcTable[(crc^bytes[i])&255]^(crc>>>8);return crc;};
function record(size){const bytes=new Uint8Array(size);return {bytes,view:new DataView(bytes.buffer)};}
function stamp(value){const d=new Date(value||'2026-01-01T00:00:00Z');if(!Number.isFinite(d.getTime()))return stamp('2026-01-01');return {time:(d.getUTCHours()<<11)|(d.getUTCMinutes()<<5)|(d.getUTCSeconds()>>1),date:((Math.max(1980,Math.min(2107,d.getUTCFullYear()))-1980)<<9)|((d.getUTCMonth()+1)<<5)|d.getUTCDate()};}
export function zipLayout(entries){
 let offset=0;
 const files=entries.map(entry=>{
  if(!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>=MAX32)throw new Error('ZIP 개별 파일 크기를 확인해 주세요.');
  if(!entry.name||entry.name.startsWith('/')||entry.name.includes('\\')||entry.name.split('/').some(s=>s==='..'||s==='.'))throw new Error('ZIP 파일 경로가 올바르지 않습니다.');
  const name=encoder.encode(entry.name);if(name.length>65535)throw new Error('ZIP 파일 이름이 너무 깁니다.');
  const file={...entry,nameBytes:name,offset,...stamp(entry.modified)};offset+=30+name.length+entry.size+16;return file;
 });
 const centralOffset=offset,centralSize=files.reduce((sum,f)=>sum+46+f.nameBytes.length+(f.offset>=MAX32?12:0),0),zip64=files.length>=65535||centralOffset>=MAX32||centralSize>=MAX32;
 return {files,centralOffset,centralSize,zip64,size:centralOffset+centralSize+(zip64?98:22)};
}
function local(file){const {bytes,view:v}=record(30+file.nameBytes.length);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x0808,true);v.setUint16(10,file.time,true);v.setUint16(12,file.date,true);v.setUint16(26,file.nameBytes.length,true);bytes.set(file.nameBytes,30);return bytes;}
function descriptor(file){const {bytes,view:v}=record(16);v.setUint32(0,0x08074b50,true);v.setUint32(4,file.crc,true);v.setUint32(8,file.size,true);v.setUint32(12,file.size,true);return bytes;}
function central(file){
 const wide=file.offset>=MAX32,{bytes,view:v}=record(46+file.nameBytes.length+(wide?12:0));
 v.setUint32(0,0x02014b50,true);v.setUint16(4,wide?45:20,true);v.setUint16(6,wide?45:20,true);v.setUint16(8,0x0808,true);v.setUint16(12,file.time,true);v.setUint16(14,file.date,true);v.setUint32(16,file.crc,true);v.setUint32(20,file.size,true);v.setUint32(24,file.size,true);v.setUint16(28,file.nameBytes.length,true);v.setUint16(30,wide?12:0,true);v.setUint32(38,file.name.endsWith('/')?16:0,true);v.setUint32(42,wide?MAX32:file.offset,true);bytes.set(file.nameBytes,46);
 if(wide){const p=46+file.nameBytes.length;v.setUint16(p,1,true);v.setUint16(p+2,8,true);v.setBigUint64(p+4,BigInt(file.offset),true);}return bytes;
}
function ending(layout){
 const {files,centralOffset,centralSize,zip64}=layout,{bytes,view:v}=record(zip64?98:22);let p=0;
 if(zip64){v.setUint32(0,0x06064b50,true);v.setBigUint64(4,44n,true);v.setUint16(12,45,true);v.setUint16(14,45,true);v.setBigUint64(24,BigInt(files.length),true);v.setBigUint64(32,BigInt(files.length),true);v.setBigUint64(40,BigInt(centralSize),true);v.setBigUint64(48,BigInt(centralOffset),true);v.setUint32(56,0x07064b50,true);v.setBigUint64(64,BigInt(centralOffset+centralSize),true);v.setUint32(72,1,true);p=76;}
 v.setUint32(p,0x06054b50,true);v.setUint16(p+8,Math.min(65535,files.length),true);v.setUint16(p+10,Math.min(65535,files.length),true);v.setUint32(p+12,Math.min(MAX32,centralSize),true);v.setUint32(p+16,Math.min(MAX32,centralOffset),true);return bytes;
}
export function zipStream(entries){
 const layout=zipLayout(entries);let reader=null;
 async function* generate(){
  try{
   for(const file of layout.files){
    yield local(file);let size=0,crc=-1;
    const body=typeof file.body==='function'?await file.body():file.body;
    if(body instanceof Uint8Array){size=body.length;crc=crcChunk(crc,body);if(body.length)yield body;}
    else if(body?.getReader){
     reader=body.getReader();try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>file.size)throw new Error('첨부파일 크기가 변경되었습니다.');crc=crcChunk(crc,next.value);yield next.value;}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();reader=null;}
    }else throw new Error('첨부파일을 읽을 수 없습니다.');
    if(size!==file.size)throw new Error('첨부파일 크기가 변경되었습니다.');file.crc=(crc^-1)>>>0;yield descriptor(file);
   }
   for(const file of layout.files)yield central(file);yield ending(layout);
  }finally{if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();reader=null;}}
 }
 const iterator=generate();
 return new ReadableStream({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(next.value);}catch(e){controller.error(e);}},async cancel(){await reader?.cancel().catch(()=>{});await iterator.return();}},{highWaterMark:0});
}
export function safeArchiveName(value,fallback='문서'){
 let name=String(value||'').normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g,'_').trim().replace(/[. ]+$/g,'');
 name=[...name].slice(0,160).join('')||fallback;if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='_'+name;return name;
}
export function uniqueArchiveName(value,used,isFile=false){
 const base=safeArchiveName(value,isFile?'첨부파일':'문서'),dot=isFile?base.lastIndexOf('.'):-1,stem=dot>0?base.slice(0,dot):base,ext=dot>0?base.slice(dot):'';
 let name=base,n=2;while(used.has(name.toLocaleLowerCase('ko-KR')))name=stem+' ('+(n++)+')'+ext;used.add(name.toLocaleLowerCase('ko-KR'));return name;
}
export function attachmentDisposition(name){return `attachment; filename="download.${name.endsWith('.xlsx')?'xlsx':'zip'}"; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`;}

// Shared by the browser and format tests. Each file is opened only when the
// destination asks for its next bytes, allowing direct streaming to a file.
export function attachmentEntries(documents,files,openFile){
 const entries=[],roots=new Set(),empty=new Uint8Array(),byDocument=new Map();
 for(const file of files){if(!byDocument.has(file.document_id))byDocument.set(file.document_id,[]);byDocument.get(file.document_id).push(file);}
 for(const document of documents){
  const root=uniqueArchiveName(document.title,roots)+'/';entries.push({name:root,size:0,body:empty});const revisions=new Map(),dates=new Set();
  for(const file of byDocument.get(document.id)||[]){
   let revision=revisions.get(file.revision_id);
   if(!revision){const date=uniqueArchiveName(file.revision_date,dates);revision={prefix:root+date+'/',names:new Set()};revisions.set(file.revision_id,revision);entries.push({name:revision.prefix,size:0,body:empty});}
   entries.push({name:revision.prefix+uniqueArchiveName(file.name,revision.names,true),size:file.size,modified:file.created_at,body:()=>openFile(file)});
  }
 }
 return entries;
}
