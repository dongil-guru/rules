import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pbkdf2Sync } from 'node:crypto';
import { Miniflare, FormData } from 'miniflare';
const password='local-test-password-only';
const origin='https://document-hub.test';
const hash='pbkdf2$100000$integration-salt$'+pbkdf2Sync(password,'integration-salt',100000,32,'sha256').toString('hex');
const mf=new Miniflare({modules:true,scriptPath:'src/worker.js',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['FILES'],bindings:{ADMIN_PASSWORD_HASH:hash},serviceBindings:{ASSETS:()=>new Response('<!doctype html><title>문서이음</title>',{headers:{'Content-Type':'text/html'}})}});
let cookie='',db,bucket;
async function req(path,{method='GET',data,files,headers={}}={}){
 const options={method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...headers}};
 if(files){const body=new FormData();body.set('payload',JSON.stringify(data));for(const [name,text] of files)body.append('files',new Blob([text]),name);options.body=body;}
 else if(data){options.headers['Content-Type']='application/json';options.body=JSON.stringify(data);}
 const response=await mf.dispatchFetch(origin+path,options);const type=response.headers.get('Content-Type')||'';const body=type.includes('application/json')?await response.json():await response.text();return {status:response.status,body,headers:response.headers};
}
const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
const form=(org,cat,title='정보보안 업무지침',extra={})=>({organization_id:org,category_id:cat,title,revision_date:'2026-10-19',summary:'제정 주요내용',manager:'최동일',approval_no:'안전-1234',relations:[],keep_attachments:[],...extra});
async function save(path,data,files=[],method='POST'){return req(path,{method,data,files});}
async function document(id){return ok(await req('/api/documents/'+id));}
test('문서이음: 실제 Workers·D1·R2 통합 검증',async t=>{
 t.after(()=>mf.dispose());
 db=await mf.getD1Database('DB');bucket=await mf.getR2Bucket('FILES');
 const schema=await readFile('migrations/0001_initial.sql','utf8');
 for(const sql of schema.split(/;\s*\n/).map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 let orgA,orgB,orgC,parent,child,cat2,target1,target2,source;
 await t.test('로그인·세션·출처 검사',async()=>{
  assert.equal((await req('/api/bootstrap')).status,401);
  assert.equal((await req('/api/login',{method:'POST',data:{username:'admin',password},headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await req('/api/login',{method:'POST',data:{username:'admin',password:'wrong'}})).status,401);
  const login=await req('/api/login',{method:'POST',data:{username:'admin',password}});ok(login);cookie=login.headers.get('Set-Cookie').split(';')[0];assert.match(cookie,/__Host-doc_session=/);assert.match(login.headers.get('Set-Cookie'),/HttpOnly/);assert.match(login.headers.get('Set-Cookie'),/Secure/);
  assert.equal(ok(await req('/api/session')).authenticated,true);
  const home=await req('/');assert.equal(home.status,200);assert.match(home.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 });
 await t.test('기관 1단계·업무 2단계 CRUD와 단계 제한',async()=>{
  orgA=ok(await req('/api/organizations',{method:'POST',data:{name:'한국상하수도협회'}}),201).id;
  orgB=ok(await req('/api/organizations',{method:'POST',data:{name:'상급기관'}}),201).id;
  orgC=ok(await req('/api/organizations',{method:'POST',data:{name:'유관기관'}}),201).id;
  parent=ok(await req('/api/categories',{method:'POST',data:{name:'정보관리'}}),201).id;
  child=ok(await req('/api/categories',{method:'POST',data:{name:'정보보안',parent_id:parent}}),201).id;
  cat2=ok(await req('/api/categories',{method:'POST',data:{name:'개인정보보호'}}),201).id;
  assert.equal((await req('/api/categories',{method:'POST',data:{name:'3단계',parent_id:child}})).status,400);
  assert.equal((await req('/api/categories/'+parent,{method:'PUT',data:{name:'정보관리',parent_id:cat2}})).status,400);
  assert.equal((await req('/api/organizations',{method:'POST',data:{name:'한국상하수도협회'}})).status,409);
  ok(await req('/api/organizations/'+orgB,{method:'PUT',data:{name:'기후에너지환경부'}}));
  const temp=ok(await req('/api/categories',{method:'POST',data:{name:'삭제할 분류'}}),201).id;ok(await req('/api/categories/'+temp,{method:'DELETE'}));
 });
 await t.test('최초 제정·복수 첨부파일·다른 기관 2건 참조',async()=>{
  target1=ok(await save('/api/documents',form(orgB,child,'상위 지침 A',{revision_date:'2026-01-01'})),201);
  target2=ok(await save('/api/documents',form(orgB,cat2,'상위 지침 B',{revision_date:'2026-02-01'})),201);
  source=ok(await save('/api/documents',form(orgA,child,'내부 정보보안 지침',{revision_date:'2025-01-01',manager:'이전담당자',relations:[target1.revision_id,target2.revision_id]}),[['지침.pdf','first-file'],['비교표.hwp','second-file']]),201);
  const data=await document(source.document_id),r=data.revisions[0];assert.equal(r.sequence,1);assert.equal(r.attachments.length,2);assert.equal(r.relations.length,2);
  const file=await req('/api/files/'+r.attachments.find(a=>a.name==='지침.pdf').id);assert.equal(file.status,200);assert.equal(file.body,'first-file');assert.match(file.headers.get('Content-Disposition'),/attachment;/);
  assert.equal((await req('/api/organizations/'+orgA,{method:'DELETE'})).status,409);assert.equal((await req('/api/categories/'+child,{method:'DELETE'})).status,409);
 });
 await t.test('개정 누적·최신건 목록·과거 이력 검색·참조 이력 고정',async()=>{
  ok(await save(`/api/documents/${source.document_id}/revisions`,form(orgA,child,'최신 정보보안 지침',{summary:'개정 주요내용',relations:[target1.revision_id,target2.revision_id]}),[['개정.pdf','revision-file']]),201);
  const data=await document(source.document_id);assert.equal(data.revisions.length,2);assert.equal(data.revisions[0].sequence,2);assert.equal(data.revisions[1].title,'내부 정보보안 지침');
  const list=ok(await req('/api/documents'));assert.equal(list.documents.length,3);assert.equal(list.documents.find(d=>d.id===source.document_id).title,'최신 정보보안 지침');
  const old=ok(await req('/api/documents?title='+encodeURIComponent('내부')+'&manager='+encodeURIComponent('이전담당자')+'&from=2025-01-01&to=2025-01-01'));assert.equal(old.documents.length,1);assert.equal(old.documents[0].history_match,1);assert.equal(old.documents[0].title,'최신 정보보안 지침');
  ok(await save(`/api/documents/${target1.document_id}/revisions`,form(orgB,child,'상위 지침 A 개정')),201);
  const after=await document(source.document_id);assert.equal(after.revisions[0].relations.find(r=>r.document_id===target1.document_id).id,target1.revision_id);
  const options=ok(await req('/api/references?exclude_org='+orgA));assert.ok(options.revisions.length>=3);assert.ok(options.revisions.every(r=>r.organization_id!==orgA));
 });
 await t.test('모든 정보 수정·첨부 교체·기관/업무 이동·연관링크 교체',async()=>{
  const before=await document(source.document_id),r=before.revisions[0];
  ok(await save('/api/revisions/'+r.id,form(orgC,cat2,'가'.repeat(50),{token:r.token,revision_date:'2026-08-15',summary:'내'.repeat(300),manager:'새 담당자',approval_no:'가'.repeat(10),relations:[target2.revision_id]}),[['최종.pdf','edited-file']],'PUT'));
  const after=await document(source.document_id),edited=after.revisions[0];assert.equal(after.document.organization_id,orgC);assert.equal(after.document.category_id,cat2);assert.equal(edited.title.length,50);assert.equal(edited.summary.length,300);assert.equal(edited.approval_no.length,10);assert.equal(edited.manager,'새 담당자');assert.equal(edited.revision_date,'2026-08-15');assert.equal(edited.relations.length,1);assert.equal(edited.relations[0].id,target2.revision_id);assert.equal(edited.attachments.length,1);assert.equal(edited.attachments[0].name,'최종.pdf');assert.equal(after.revisions[1].attachments.length,2);
  const stale=await save('/api/revisions/'+r.id,form(orgC,cat2,'오래된 창',{token:r.token}),[],'PUT');assert.equal(stale.status,409);
  const kept=edited.attachments[0];ok(await save('/api/revisions/'+edited.id,form(orgC,cat2,'수정된 보안지침',{token:edited.token,keep_attachments:[kept.id],relations:[target1.revision_id,target2.revision_id]}),[],'PUT'));
  assert.equal((await document(source.document_id)).revisions[0].attachments[0].id,kept.id);
 });
 await t.test('문자수·유효일자·필수값·교차기관·참조보존 검사',async()=>{
  for(const field of [{title:'한'.repeat(51)},{summary:'한'.repeat(301)},{approval_no:'한'.repeat(11)},{revision_date:'2026-02-30'},{revision_date:'2026-13-01'},{manager:''},{relations:[target1.revision_id]}]){
   const result=await save('/api/documents',form(orgB,child,'실패해야 하는 문서',field));assert.equal(result.status,400,JSON.stringify({field,response:result.body}));
  }
  const prior=await document(source.document_id),r=prior.revisions[0];
  const conflict=await save('/api/revisions/'+r.id,form(orgB,child,'같은 기관 연결',{token:r.token,relations:[target1.revision_id]}),[],'PUT');assert.equal(conflict.status,400);
  const attempted=await save('/api/revisions/'+r.id,form(orgB,child,'기관 충돌',{token:r.token,relations:[]}),[],'PUT');assert.equal(attempted.status,409); // An earlier revision still links to org B.
  assert.equal((await document(source.document_id)).document.organization_id,orgC);
 });
 await t.test('동시 개정 등록 시 이력 순번 유일성',async()=>{
  const results=await Promise.all([save(`/api/documents/${source.document_id}/revisions`,form(orgC,cat2,'동시 개정 A')),save(`/api/documents/${source.document_id}/revisions`,form(orgC,cat2,'동시 개정 B'))]);
  results.forEach(r=>ok(r,201));const data=await document(source.document_id);assert.deepEqual(data.revisions.map(r=>r.sequence),[4,3,2,1]);
 });
 await t.test('개정 삭제 후 직전 이력 복원·원본 이력 삭제 보호',async()=>{
  let data=await document(source.document_id);ok(await req('/api/revisions/'+data.revisions[0].id,{method:'DELETE',data:{token:data.revisions[0].token}}));
  data=await document(source.document_id);assert.equal(data.revisions[0].sequence,3);
  const original=data.revisions.at(-1);assert.equal((await req('/api/revisions/'+original.id,{method:'DELETE',data:{token:original.token}})).status,409);
  const list=ok(await req('/api/documents'));assert.equal(list.documents.find(d=>d.id===source.document_id).sequence,3);
 });
 await t.test('문서 전체 삭제·상호참조 제거·파일 접근 제한',async()=>{
  const target=await document(target2.document_id);assert.ok(target.revisions[0].backlinks.length>=1);
  const data=await document(source.document_id),attachmentId=data.revisions.at(-1).attachments[0].id;
  ok(await req('/api/documents/'+source.document_id,{method:'DELETE',data:{token:data.revisions[0].token}}));
  assert.equal((await req('/api/documents/'+source.document_id)).status,404);assert.equal((await req('/api/files/'+attachmentId)).status,404);assert.equal((await document(target2.document_id)).revisions[0].backlinks.length,0);
  const files=await db.prepare('SELECT count(*) n FROM attachments a JOIN revisions r ON r.id=a.revision_id WHERE r.document_id=?').bind(source.document_id).first();assert.equal(files.n,0);
 });
 await t.test('로그아웃·로그인 연속 실패 제한',async()=>{
  ok(await req('/api/logout',{method:'POST'}));assert.equal((await req('/api/bootstrap')).status,401);cookie='';
  for(let i=0;i<5;i++)assert.equal((await req('/api/login',{method:'POST',data:{username:'admin',password:'wrong'},headers:{'CF-Connecting-IP':'198.51.100.9'}})).status,401);
  assert.equal((await req('/api/login',{method:'POST',data:{username:'admin',password},headers:{'CF-Connecting-IP':'198.51.100.9'}})).status,429);
 });
});
