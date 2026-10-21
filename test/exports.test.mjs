import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {crc32} from 'node:zlib';
import {Miniflare,FormData} from 'miniflare';
import {passwordHash} from '../scripts/admin-credentials.mjs';
import {zipStream,zipLayout,safeArchiveName,uniqueArchiveName,attachmentEntries} from '../public/archive.mjs';
import {workbookStream} from '../src/spreadsheet.mjs';
const origin='https://exports.test',password='export-fixture-password-only';
function unzip(data){
 const bytes=Buffer.from(data),end=bytes.length-22;assert.equal(bytes.readUInt32LE(end),0x06054b50);
 let count=bytes.readUInt16LE(end+10),offset=bytes.readUInt32LE(end+16);assert.notEqual(count,65535,'Use a small test fixture');
 const files=new Map();
 for(let i=0;i<count;i++){
  assert.equal(bytes.readUInt32LE(offset),0x02014b50);assert.ok(bytes.readUInt16LE(offset+8)&2048);assert.equal(bytes.readUInt16LE(offset+10),0);
  const crc=bytes.readUInt32LE(offset+16),size=bytes.readUInt32LE(offset+24),nameLength=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42),name=bytes.subarray(offset+46,offset+46+nameLength).toString('utf8');
  assert.equal(bytes.readUInt32LE(local),0x04034b50);const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28),body=bytes.subarray(start,start+size);
  assert.equal(body.length,size);assert.equal(crc32(body),crc);assert.ok(!files.has(name));files.set(name,body);offset+=46+nameLength+extra+comment;
 }
 assert.equal(offset,end);return files;
}
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#13;/g,'\r').replace(/&amp;/g,'&');
function spreadsheetRows(zip){const sheet=unzip(zip).get('xl/worksheets/sheet1.xml').toString();assert.doesNotMatch(sheet,/<f[ >]/);return {sheet,rows:[...sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row=>[...row[1].matchAll(/<c\b[^>]*t="inlineStr"[^>]*><is><t[^>]*>([\s\S]*?)<\/t><\/is><\/c>/g)].map(c=>decode(c[1])))};}

test('한글 ZIP의 외부 CRC 검증·안전한 경로·중복 이름·지연 읽기·취소와 ZIP64 크기 계산',async()=>{
 const data=new TextEncoder().encode('한글 파일 본문\n\0binary'),bytes=await new Response(zipStream([{name:'문서/자료.txt',size:data.length,body:data}])).arrayBuffer();
 assert.equal(unzip(bytes).get('문서/자료.txt').toString(),'한글 파일 본문\n\0binary');
 assert.equal(safeArchiveName('../a\\b: c?*'), '.._a_b_ c__');assert.equal(safeArchiveName('..'),'문서');assert.equal(safeArchiveName('CON.txt'),'_CON.txt');
 const used=new Set();assert.equal(uniqueArchiveName('자료.PDF',used,true),'자료.PDF');assert.equal(uniqueArchiveName('자료.pdf',used,true),'자료 (2).pdf');
 let loaded=0,cancelled=0;
 const source=()=>{loaded++;return new ReadableStream({pull(c){c.enqueue(new Uint8Array([1,2,3]));},cancel(){cancelled++;}},{highWaterMark:0});};
 const reader=zipStream([{name:'one',size:3,body:source},{name:'two',size:3,body:source}]).getReader();
 await reader.read();assert.equal(loaded,0);await reader.read();assert.equal(loaded,1);await reader.cancel();assert.equal(cancelled,1);assert.equal(loaded,1);
 assert.throws(()=>zipStream([{name:'../secret',size:0,body:new Uint8Array()}]),/경로/);
 const wide=zipLayout([{name:'a',size:0xffffff00},{name:'b',size:0xffffff00},{name:'c',size:0}]);assert.equal(wide.zip64,true);assert.ok(wide.files[2].offset>0xffffffff);assert.ok(wide.size>0x100000000);
});

test('엑셀은 여러 줄·한글·수식처럼 보이는 입력을 안전한 문자열로 저장',async()=>{
 const docs=[{category_name:'업무',organization_name:'협회',document_type:'지침',requirement:'권장',title:'=1+1',revision_date:'2026-10-21',manager:'<담당>&"',approval_no:'@참조',summary:'첫 줄\n둘째\u0000줄',attachments:[{name:'자료.pdf'}],related_title:'연결 문서',related_organization_name:'상위기관',related_revision_date:'2026-01-01'}];
 const bytes=await new Response(workbookStream(docs)).arrayBuffer(),{rows,sheet}=spreadsheetRows(bytes);
 assert.equal(rows.length,2);assert.equal(rows[1][4],'=1+1');assert.equal(rows[1][6],'<담당>&"');assert.equal(rows[1][8],'첫 줄\n둘째줄');assert.equal(rows[1][9],'자료.pdf\n\n');assert.equal(rows[1][10],'상위기관\n연결 문서\n2026-01-01');
 assert.match(sheet,/state="frozen"/);assert.match(sheet,/<autoFilter ref="A1:K2"/);assert.ok(unzip(bytes).get('xl/styles.xml').toString().includes('wrapText="1"'));
});

test('다운로드 API의 최신 이력·선택 범위·전체 첨부 보존·인증 및 IP 제한',async t=>{
 const mf=new Miniflare({modules:true,scriptPath:'src/worker.js',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['FILES'],bindings:{ADMIN_PASSWORD_HASH:passwordHash(password)},serviceBindings:{ASSETS:()=>new Response('fixture')}});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('FILES');
 for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort())await db.batch((await readFile('migrations/'+name,'utf8')).split(/;\s*\n/).map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 let cookie='';
 async function request(path,{method='GET',data,files,ip='203.0.113.10',session=cookie}={}){
  const options={method,headers:{Origin:origin,'CF-Connecting-IP':ip,...(session?{Cookie:session}:{})}};
  if(files){options.body=new FormData();options.body.set('payload',JSON.stringify(data));for(const [name,text] of files)options.body.append('files',new Blob([text]),name);}
  else if(data){options.headers['Content-Type']='application/json';options.body=JSON.stringify(data);}
  const response=await mf.dispatchFetch(origin+path,options),type=response.headers.get('Content-Type')||'';
  return {status:response.status,headers:response.headers,body:type.includes('application/json')?await response.json():new Uint8Array(await response.arrayBuffer())};
 }
 const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
 const signIn=async username=>{const result=await request('/api/login',{method:'POST',data:{username,password}});ok(result);return result.headers.get('Set-Cookie').split(';')[0];};
 cookie=await signIn('admin');const adminCookie=cookie;
 const workA=ok(await request('/api/categories',{method:'POST',data:{name:'개인정보'}}),201).id,workB=ok(await request('/api/categories',{method:'POST',data:{name:'정보보안'}}),201).id;
 const fields=(org,cat,title,more={})=>({organization_id:org,category_id:cat,document_type:'기타',requirement:'필수',title,revision_date:'2026-10-21',manager:'<담당>&',approval_no:'안전-001',summary:'첫 줄\n둘째 줄',related_document_id:null,keep_attachments:[],...more});
 const create=async(data,files=[])=>ok(await request('/api/documents',{method:'POST',data,files}),201);
 const partner=await create(fields('upper',workA,'상위 지침',{revision_date:'2026-06-01'}),[['상위.pdf','upper body']]);
 const doc=await create(fields('kwwa',workA,'=안전 / 지침',{related_document_id:partner.document_id}),[['계획.pdf','first binary\0'],['계획.pdf','second body'],['자료.xlsx','third body']]);
 await request('/api/documents/'+doc.document_id+'/revisions',{method:'POST',data:fields('kwwa',workA,'이전 이력',{revision_date:'2020-01-01',related_document_id:partner.document_id,summary:'이전 내용'}),files:[['과거.hwp','history body']]});
 await create(fields('kwwa',workA,'=안전 / 지침'));
 const other=await create(fields('upper',workB,'같은 날 먼저',{revision_date:'2025-01-01'}),[['이전.txt','old same day']]);
 ok(await request('/api/documents/'+other.document_id+'/revisions',{method:'POST',data:fields('upper',workB,'같은 날 나중',{revision_date:'2025-01-01'}),files:[['최근.txt','new same day']]}),201);
 const scope=(orgs=['kwwa'],cats=[workA])=>{const q=new URLSearchParams();orgs.forEach(x=>q.append('organization',x));cats.forEach(x=>q.append('category',x));return q.toString();};
 const clientArchive=manifest=>new Response(zipStream(attachmentEntries(manifest.documents,manifest.files,async file=>{const response=await request('/api/files/'+file.id);if(response.status!==200)throw new Error(response.body.error);return response.body;}))).arrayBuffer();
 await t.test('기관별 건수는 검색 필터와 관계없이 전체 문서 개수',async()=>{
  const base=ok(await request('/api/bootstrap'));assert.deepEqual(base.organizations.map(o=>[o.id,o.document_count]).sort((a,b)=>a[0].localeCompare(b[0])),[['kwwa',2],['upper',2]]);
  ok(await request('/api/documents?category='+workB+'&title=없는문서'));assert.deepEqual(ok(await request('/api/bootstrap')).organizations.map(o=>o.document_count),[2,2]);
 });
 await t.test('선택·형식·미등록 항목·인증이 유효해야 다운로드 가능',async()=>{
  for(const path of ['excel','files','check'])assert.equal((await request('/api/exports/'+path+'?'+scope(),{session:''})).status,401);
  for(const query of ['', 'organization=kwwa','category='+workA,'organization=wrong&category='+workA,'organization=kwwa&category=unknown',"organization=kwwa&category=x%27%20OR%201=1"]){assert.equal((await request('/api/exports/excel?'+query)).status,400);}
  assert.equal((await request('/api/exports/check?format=bad&'+scope())).status,400);
  const empty=ok(await request('/api/categories',{method:'POST',data:{name:'빈 업무'}}),201).id;assert.equal((await request('/api/exports/excel?'+scope(['kwwa'],[empty]))).status,404);
 });
 await t.test('엑셀은 날짜 기준 최신 이력과 입력한 전체 정보·최신 첨부·연결 문서를 포함',async()=>{
  const response=await request('/api/exports/excel?'+scope());ok(response);assert.match(response.headers.get('Content-Type'),/spreadsheetml/);assert.match(response.headers.get('Content-Disposition'),/filename\*=UTF-8''/);
  const {rows}=spreadsheetRows(response.body);assert.equal(rows.length,3);assert.deepEqual(rows[0],['업무구분','기관구분','문서종류','필수여부','문서명','제·개정 일자','담당자','참조 문서번호','설명','첨부파일','연관문서']);
  const row=rows.find(r=>r[9].includes('계획.pdf'));assert.deepEqual(row.slice(0,9),['개인정보','한국상하수도협회','기타','필수','=안전 / 지침','2026-10-21','<담당>&','안전-001','첫 줄\n둘째 줄']);
  assert.equal(row[9].split('\n').length,3);assert.equal(row[9].split('\n').filter(x=>x==='계획.pdf').length,2);assert.ok(row[9].includes('자료.xlsx'));assert.ok(!row[9].includes('과거.hwp'));assert.equal(row[10],'상위기관\n상위 지침\n2026-06-01');
  const all=spreadsheetRows(ok(await request('/api/exports/excel?'+scope(['kwwa','upper'],[workA,workB])))).rows;assert.equal(all.length,5);assert.ok(all.some(r=>r[4]==='같은 날 나중'));assert.ok(!all.some(r=>r[4]==='같은 날 먼저'));
 });
 await t.test('ZIP은 문서별 폴더 안에 전체 이력의 파일을 원본 바이트 그대로 포함',async()=>{
  const response=await request('/api/exports/files?'+scope());ok(response);assert.match(response.headers.get('Content-Type'),/application\/json/);assert.ok(!JSON.stringify(response.body).includes('storage_key'));const zip=unzip(await clientArchive(response.body)),names=[...zip.keys()];
  assert.ok(names.includes('=안전 _ 지침/'));assert.ok(names.includes('=안전 _ 지침 (2)/'));const history=names.find(n=>n.endsWith('/2020-01-01/과거.hwp'));assert.ok(history);const root=history.split('/')[0];
  const bodies=[...zip.entries()].filter(([name])=>!name.endsWith('/')).map(([,data])=>data.toString()).sort();assert.deepEqual(bodies,['first binary\0','second body','third body','history body'].sort());
  assert.ok(names.includes(root+'/2026-10-21/계획 (2).pdf'));assert.ok(!names.some(n=>n.includes('상위.pdf')));assert.ok(!names.some(n=>n.split('/').includes('..')));
  const info=ok(await request('/api/exports/check?format=files&'+scope()));assert.equal(info.document_count,2);assert.equal(info.attachment_count,4);assert.ok(info.total_bytes>0);assert.ok(!JSON.stringify(info).includes('storage_key'));
 });
 await t.test('파일이 없거나 R2와 메타데이터가 달라지면 손상 ZIP을 만들지 않음',async()=>{
  const noFile=await create(fields('kwwa',workB,'첨부 없는 문서'));assert.equal((await request('/api/exports/files?'+scope(['kwwa'],[workB]))).status,404);assert.equal((await request('/api/exports/excel?'+scope(['kwwa'],[workB]))).status,200);
  const file=await db.prepare('SELECT * FROM attachments WHERE revision_id=? LIMIT 1').bind(doc.revision_id).first();const original=await (await bucket.get(file.storage_key)).arrayBuffer();await bucket.delete(file.storage_key);
  const manifest=ok(await request('/api/exports/files?'+scope()));await assert.rejects(clientArchive(manifest),/첨부파일을 찾을 수 없습니다/);
  await bucket.put(file.storage_key,original);assert.equal((await request('/api/exports/check?format=files&'+scope())).status,200);assert.ok(noFile.document_id);
 });
 await t.test('일반 사용자도 허용 IP에서 다운로드하고 제한 IP·변조 선택은 차단',async()=>{
  ok(await request('/api/users',{method:'POST',data:{login_id:'member',name:'사용자',password,active:true}}),201);const member=await signIn('member');
  assert.equal((await request('/api/exports/excel?'+scope(),{session:member})).status,200);
  let access=ok(await request('/api/access-control'));access=ok(await request('/api/access-control/ips',{method:'POST',data:{token:access.token,ip:'203.0.113.10',description:'fixture',active:true}}));ok(await request('/api/access-control',{method:'PUT',data:{token:access.token,mode:'allowlist'}}));
  for(const type of ['excel','files','check']){const denied=await request('/api/exports/'+type+'?format=files&'+scope(),{session:member,ip:'198.51.100.2'});assert.equal(denied.status,403);assert.equal(denied.body.code,'IP_ACCESS_DENIED');}
  assert.equal((await request('/api/exports/files?'+scope(),{session:member})).status,200);cookie=adminCookie;
 });
});
