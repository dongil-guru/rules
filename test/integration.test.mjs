import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pbkdf2Sync } from 'node:crypto';
import { Miniflare, FormData } from 'miniflare';
const password='local-test-password-only',origin='https://document-hub.test';
const hash='pbkdf2$100000$integration-salt$'+pbkdf2Sync(password,'integration-salt',100000,32,'sha256').toString('hex');
const mf=new Miniflare({modules:true,scriptPath:'src/worker.js',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['FILES'],bindings:{ADMIN_PASSWORD_HASH:hash},serviceBindings:{ASSETS:()=>new Response('<!doctype html><title>문서관리</title>',{headers:{'Content-Type':'text/html'}})}});
let cookie='',db,bucket;
async function req(path,{method='GET',data,files,headers={}}={}){
 const options={method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...headers}};
 if(files){const body=new FormData();body.set('payload',JSON.stringify(data));for(const [name,text] of files)body.append('files',new Blob([text]),name);options.body=body;}
 else if(data){options.headers['Content-Type']='application/json';options.body=JSON.stringify(data);}
 const response=await mf.dispatchFetch(origin+path,options),type=response.headers.get('Content-Type')||'';
 return {status:response.status,body:type.includes('application/json')?await response.json():await response.text(),headers:response.headers};
}
const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
const form=(side,category,title='정보보안 업무지침',extra={})=>({organization_id:side,category_id:category,title,revision_date:'2026-10-20',summary:'주요내용',manager:'최동일',approval_no:'안전-1234',related_document_id:null,keep_attachments:[],...extra});
const save=(path,data,files=[],method='POST')=>req(path,{method,data,files});
const document=async id=>ok(await req('/api/documents/'+id));
const edit=async (bundle,extra={},files=[])=>{
 const r=bundle.revisions[0];return save('/api/revisions/'+r.id,form(bundle.document.organization_id,bundle.document.category_id,r.title,{revision_date:r.revision_date,summary:r.summary,manager:r.manager,approval_no:r.approval_no,token:r.token,related_document_id:bundle.related_document_id,keep_attachments:r.attachments.map(a=>a.id),...extra}),files,'PUT');
};
async function migrate(name){const sql=await readFile('migrations/'+name,'utf8');await db.batch(sql.split(/;\s*\n/).map(s=>s.trim()).filter(Boolean).map(sql=>db.prepare(sql)));}
test('문서관리: 고정 구분·1:1 연결·기관별 비교 표 통합 검증',async t=>{
 t.after(()=>mf.dispose());db=await mf.getD1Database('DB');bucket=await mf.getR2Bucket('FILES');
 await migrate('0001_initial.sql');
 await t.test('기존 다중 연결 데이터 전환과 문서·이력·파일 보존',async()=>{
  for(const [id,name] of [['old-org-a','한국상하수도협회'],['old-org-b','상급기관'],['old-org-c','유관기관']])await db.prepare('INSERT INTO organizations VALUES(?,?,?)').bind(id,name,'2026-01-01').run();
  await db.prepare('INSERT INTO work_categories VALUES(?,?,?,?)').bind('legacy-cat','기존업무',null,'2026-01-01').run();
  for(const [id,org] of [['old-a1','old-org-a'],['old-a2','old-org-a'],['old-b1','old-org-b'],['old-b2','old-org-c']]){
   await db.prepare('INSERT INTO documents VALUES(?,?,?,?)').bind(id,org,'legacy-cat','2026-01-01').run();
   await db.prepare('INSERT INTO revisions VALUES(?,?,1,?,?,?,?,?,?,?,?)').bind('rev-'+id,id,id,'2026-01-01','기존내용','기존담당','결재1','token-'+id,'2026-01-01',id==='old-a1'?'2026-10-19T10:00:00Z':'2026-10-18T10:00:00Z').run();
  }
  for(const target of ['rev-old-b1','rev-old-b2'])await db.prepare('INSERT INTO relations VALUES(?,?)').bind('rev-old-a1',target).run();
  await db.prepare('INSERT INTO relations VALUES(?,?)').bind('rev-old-a2','rev-old-b1').run();
  await bucket.put('legacy-key','legacy-file-body');
  await db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?)').bind('legacy-file','rev-old-a1','legacy-key','기존.pdf',16,'application/pdf','2026-01-01').run();
  await migrate('0002_document_pairs.sql');
  assert.equal((await db.prepare('SELECT count(*) n FROM documents').first()).n,4);
  assert.equal((await db.prepare('SELECT count(*) n FROM revisions').first()).n,4);
  assert.equal((await db.prepare('SELECT count(*) n FROM attachments').first()).n,1);
  assert.equal(await (await bucket.get('legacy-key')).text(),'legacy-file-body');
  assert.equal((await db.prepare('SELECT count(*) n FROM file_garbage').first()).n,0);
  assert.deepEqual((await db.prepare('SELECT id,name FROM organizations ORDER BY id').all()).results,[{id:'kwwa',name:'한국상하수도협회'},{id:'upper',name:'상위기관'}]);
  const pairs=(await db.prepare('SELECT kwwa_id,upper_id FROM document_pairs').all()).results;
  assert.deepEqual(pairs,[{kwwa_id:'old-a1',upper_id:'old-b1'}]);
  assert.equal((await db.prepare("SELECT count(*) n FROM documents WHERE organization_id NOT IN ('kwwa','upper')").first()).n,0);
 });
 await t.test('기존 하위분류를 독립 업무구분으로 전환하고 데이터·동일 이름 보존',async()=>{
  await db.prepare('INSERT INTO work_categories VALUES(?,?,?,?)').bind('legacy-child','기존업무','legacy-cat','2026-01-02').run();
  await db.prepare('INSERT INTO documents VALUES(?,?,?,?)').bind('legacy-child-doc','upper','legacy-child','2026-01-02').run();
  await db.prepare('INSERT INTO revisions VALUES(?,?,1,?,?,?,?,?,?,?,?)').bind('legacy-child-rev','legacy-child-doc','하위분류 문서','2026-01-02','보존 내용','담당자','결재2','legacy-child-token','2026-01-02','2026-01-02').run();
  await bucket.put('legacy-child-key','child-file');
  await db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?)').bind('legacy-child-file','legacy-child-rev','legacy-child-key','하위분류.pdf',10,'application/pdf','2026-01-02').run();
  const before=(await db.prepare('SELECT id,name,created_at FROM work_categories ORDER BY id').all()).results;
  await migrate('0003_flat_work_categories.sql');
  assert.deepEqual((await db.prepare('SELECT id,name,created_at FROM work_categories ORDER BY id').all()).results,before);
  const columns=(await db.prepare('PRAGMA table_info(work_categories)').all()).results.map(c=>c.name);assert.ok(!columns.includes('parent_id'));assert.ok(columns.includes('sort_order'));
  assert.deepEqual((await db.prepare('SELECT sort_order FROM work_categories ORDER BY sort_order').all()).results.map(c=>c.sort_order),[0,1]);
  assert.equal((await db.prepare('SELECT category_id FROM documents WHERE id=?').bind('legacy-child-doc').first()).category_id,'legacy-child');
  assert.equal((await db.prepare('SELECT count(*) n FROM revisions').first()).n,5);assert.equal((await db.prepare('SELECT count(*) n FROM attachments').first()).n,2);
  assert.equal(await (await bucket.get('legacy-child-key')).text(),'child-file');assert.equal(await (await bucket.get('legacy-key')).text(),'legacy-file-body');
  assert.deepEqual((await db.prepare('SELECT kwwa_id,upper_id FROM document_pairs').all()).results,[{kwwa_id:'old-a1',upper_id:'old-b1'}]);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 });
 let privacy,security,parent,child,upperA,upperB,assocA,assocB,raceTarget;
 await t.test('로그인·세션·출처 검사',async()=>{
  assert.equal((await req('/api/bootstrap')).status,401);
  assert.equal((await req('/api/login',{method:'POST',data:{username:'admin',password},headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await req('/api/login',{method:'POST',data:{username:'admin',password:'wrong'}})).status,401);
  const login=await req('/api/login',{method:'POST',data:{username:'admin',password}});ok(login);cookie=login.headers.get('Set-Cookie').split(';')[0];assert.match(cookie,/__Host-doc_session=/);assert.match(login.headers.get('Set-Cookie'),/HttpOnly/);
  assert.equal(ok(await req('/api/session')).authenticated,true);assert.equal((await req('/')).status,200);
 });
 await t.test('고정 기관 구분 변경 차단과 1단계 업무구분 등록·수정·삭제',async()=>{
  const base=ok(await req('/api/bootstrap'));assert.equal(base.organizations.length,2);
  for(const [path,method] of [['/api/organizations','POST'],['/api/organizations/kwwa','PUT'],['/api/organizations/upper','DELETE']])assert.equal((await req(path,{method,data:{name:'임의기관'}})).status,405);
  await assert.rejects(db.prepare("UPDATE organizations SET name='변경' WHERE id='kwwa'").run());
  privacy=ok(await req('/api/categories',{method:'POST',data:{name:'개인정보보호'}}),201).id;
  security=ok(await req('/api/categories',{method:'POST',data:{name:'정보보안'}}),201).id;
  parent=ok(await req('/api/categories',{method:'POST',data:{name:'법무'}}),201).id;
  child=ok(await req('/api/categories',{method:'POST',data:{name:'내부규정'}}),201).id;
  assert.equal((await req('/api/categories',{method:'POST',data:{name:'하위분류',parent_id:parent}})).status,400);
  assert.equal((await req('/api/categories/'+parent,{method:'PUT',data:{name:'법무',parent_id:privacy}})).status,400);
  assert.equal((await req('/api/categories',{method:'POST',data:{name:'개인정보보호'}})).status,409);
  const temp=ok(await req('/api/categories',{method:'POST',data:{name:'임시'}}),201).id;
  ok(await req('/api/categories/'+temp,{method:'PUT',data:{name:'임시 수정'}}));assert.equal(ok(await req('/api/bootstrap')).categories.find(c=>c.id===temp).name,'임시 수정');
  assert.equal((await req('/api/categories/'+temp,{method:'PUT',data:{name:'개인정보보호'}})).status,409);
  ok(await req('/api/categories/'+temp,{method:'DELETE'}));assert.ok(!ok(await req('/api/bootstrap')).categories.some(c=>c.id===temp));
  assert.ok(ok(await req('/api/bootstrap')).categories.every(c=>!('parent_id' in c)&&Number.isInteger(c.sort_order)&&Number.isInteger(c.document_count)));
 });
 await t.test('업무구분 순서 저장·검증·동시 변경 보호와 신규 항목 마지막 배치',async()=>{
  let previous=ok(await req('/api/bootstrap')).categories.map(c=>c.id),ordered=[...previous].reverse();
  ok(await req('/api/categories/order',{method:'PUT',data:{ids:ordered,previous_ids:previous}}));
  assert.deepEqual(ok(await req('/api/bootstrap')).categories.map(c=>c.id),ordered);
  assert.equal((await req('/api/categories/order',{method:'PUT',data:{ids:ordered,previous_ids:previous}})).status,409);
  previous=ordered;
  assert.equal((await req('/api/categories/order',{method:'PUT',data:{ids:previous.slice(1),previous_ids:previous}})).status,400);
  assert.equal((await req('/api/categories/order',{method:'PUT',data:{ids:[...previous,previous[0]],previous_ids:previous}})).status,400);
  assert.equal((await req('/api/categories/order',{method:'PUT',data:{ids:['unknown-category',...previous.slice(1)],previous_ids:previous}})).status,400);
  const concurrent=await Promise.all([[...previous].reverse(),[...previous.slice(1),previous[0]]].map(ids=>req('/api/categories/order',{method:'PUT',data:{ids,previous_ids:previous}})));
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const before=ok(await req('/api/bootstrap')).categories.map(c=>c.id),added=ok(await req('/api/categories',{method:'POST',data:{name:'AAA 마지막 업무'}}),201).id;
  assert.deepEqual(ok(await req('/api/bootstrap')).categories.map(c=>c.id),[...before,added]);
  assert.equal((await req('/api/categories/order',{method:'PUT',data:{ids:[...before].reverse(),previous_ids:before}})).status,409);
  ok(await req('/api/categories/'+added,{method:'DELETE'}));
 });
 await t.test('문서 등록·2개 첨부파일·1개 연관문서 연결',async()=>{
  upperA=ok(await save('/api/documents',form('upper',privacy,'내부관리계획_상위',{revision_date:'2026-01-13'}),[['상위.pdf','upper-original']]),201);
  upperB=ok(await save('/api/documents',form('upper',privacy,'상위 가이드라인')),201);
  assocA=ok(await save('/api/documents',form('kwwa',privacy,'내부관리계획_협회',{revision_date:'2026-01-30',manager:'원담당자',related_document_id:upperA.document_id}),[['계획.pdf','association-original'],['비교표.hwp','comparison-original']]),201);
  assocB=ok(await save('/api/documents',form('kwwa',privacy,'협회 가이드라인')),201);
  const data=await document(assocA.document_id);assert.equal(data.revisions[0].attachments.length,2);assert.equal(data.related_document_id,upperA.document_id);
  assert.equal((await req('/api/files/'+data.revisions[0].attachments[0].id)).status,200);
 });
 await t.test('등록 문서가 있는 업무구분 삭제 차단·이름 수정·사용자 지정 표 순서',async()=>{
  const before=ok(await req('/api/bootstrap')),used=before.categories.find(c=>c.id===privacy);assert.equal(used.document_count,4);
  assert.equal((await req('/api/categories/'+privacy,{method:'DELETE'})).status,409);
  await assert.rejects(db.prepare('DELETE FROM work_categories WHERE id=?').bind(privacy).run());
  ok(await req('/api/categories/'+privacy,{method:'PUT',data:{name:'개인정보 보호'}}));
  assert.equal((await document(assocA.document_id)).document.category_name,'개인정보 보호');
  assert.deepEqual(ok(await req('/api/bootstrap')).categories.map(c=>c.id),before.categories.map(c=>c.id));
  ok(await req('/api/categories/'+privacy,{method:'PUT',data:{name:'개인정보보호'}}));
  const rows=ok(await req('/api/documents')).rows,actual=[...new Set(rows.map(row=>row.category_id))];
  assert.deepEqual(actual,ok(await req('/api/bootstrap')).categories.filter(c=>actual.includes(c.id)).map(c=>c.id));
  const oldChild=ok(await req('/api/documents?category=legacy-child'));assert.equal(oldChild.documents.length,1);assert.equal(oldChild.documents[0].id,'legacy-child-doc');
  assert.ok(ok(await req('/api/documents?category=legacy-cat')).documents.every(d=>d.id!=='legacy-child-doc'));
 });
 await t.test('최신 문서 비교 행·연결 없는 빈칸·중복 표시 방지',async()=>{
  const result=ok(await req('/api/documents?category='+privacy));assert.equal(result.rows.length,3);
  assert.equal(result.documents.length,4);assert.equal(new Set(result.documents.map(d=>d.id)).size,4);
  const pair=result.rows.find(r=>r.kwwa?.id===assocA.document_id);assert.equal(pair.upper.id,upperA.document_id);
  assert.equal(pair.kwwa.revision_date,'2026-01-30');assert.equal(pair.upper.revision_date,'2026-01-13');
  assert.equal(result.rows.find(r=>r.kwwa?.id===assocB.document_id).upper,null);
  assert.equal(result.rows.find(r=>r.upper?.id===upperB.document_id).kwwa,null);
  assert.ok(result.rows.every(r=>r.category_id===privacy));
 });
 await t.test('어느 기관 문서를 클릭해도 양쪽 상세 위치 고정',async()=>{
  for(const id of [assocA.document_id,upperA.document_id]){
   const data=await document(id);assert.equal(data.columns.kwwa.document.id,assocA.document_id);assert.equal(data.columns.upper.document.id,upperA.document_id);
   assert.equal(data.related_documents.length,1);assert.equal(data.columns.upper.revisions[0].attachments[0].name,'상위.pdf');
  }
  const single=await document(upperB.document_id);assert.equal(single.columns.kwwa,null);assert.equal(single.columns.upper.document.id,upperB.document_id);
 });
 await t.test('중복 연결·역방향 재사용·동일 구분·자기 연결 차단',async()=>{
  const before=(await db.prepare('SELECT count(*) n FROM documents').first()).n;
  assert.equal((await save('/api/documents',form('kwwa',privacy,'중복',{related_document_id:upperA.document_id}))).status,409);
  assert.equal((await save('/api/documents',form('upper',privacy,'역방향 중복',{related_document_id:assocA.document_id}))).status,409);
  assert.equal((await save('/api/documents',form('kwwa',privacy,'같은 구분',{related_document_id:assocB.document_id}))).status,400);
  assert.equal((await edit(await document(assocA.document_id),{related_document_id:assocA.document_id})).status,400);
  assert.equal((await save('/api/documents',form('kwwa',security,'다른 업무',{related_document_id:upperB.document_id}))).status,400);
  assert.equal((await save('/api/documents',form('kwwa',privacy,'여러 문서',{related_document_id:[upperA.document_id,upperB.document_id]}))).status,400);
  assert.equal((await save('/api/documents',form('other',privacy,'잘못된 구분'))).status,400);
  assert.equal((await save('/api/documents',form('kwwa',privacy,'이전 양식',{relations:[]}))).status,400);
  assert.equal((await db.prepare('SELECT count(*) n FROM documents').first()).n,before);
 });
 await t.test('선택 목록에서 다른 문서와 연결된 대상 제외',async()=>{
  let options=ok(await req('/api/references?'+new URLSearchParams({exclude_org:'kwwa',category:privacy,document:assocB.document_id}))).documents;
  assert.ok(options.some(d=>d.id===upperB.document_id));assert.ok(!options.some(d=>d.id===upperA.document_id));
  options=ok(await req('/api/references?'+new URLSearchParams({exclude_org:'kwwa',category:privacy,document:assocA.document_id}))).documents;
  assert.ok(options.some(d=>d.id===upperA.document_id));assert.ok(options.every(d=>d.organization_id==='upper'&&d.category_id===privacy));
 });
 await t.test('각 문서 개정 누적과 연결 유지·전체 이력·첨부 보존',async()=>{
  const upper=form('upper',privacy,'개정된 상위 계획');delete upper.related_document_id;
  ok(await save(`/api/documents/${upperA.document_id}/revisions`,upper,[['상위개정.pdf','upper-revised']]),201);
  const assoc=form('kwwa',privacy,'개정된 협회 계획');delete assoc.related_document_id;
  ok(await save(`/api/documents/${assocA.document_id}/revisions`,assoc,[['협회개정.pdf','association-revised']]),201);
  const data=await document(assocA.document_id);
  assert.deepEqual(data.columns.kwwa.revisions.map(r=>r.sequence),[2,1]);assert.deepEqual(data.columns.upper.revisions.map(r=>r.sequence),[2,1]);
  assert.equal(data.columns.kwwa.revisions[1].attachments.length,2);assert.equal(data.columns.upper.revisions[1].attachments[0].name,'상위.pdf');
  assert.equal(data.related_document_id,upperA.document_id);
 });
 await t.test('이전 이력 검색에도 최신 문서와 연결 상대 함께 표시',async()=>{
  const list=ok(await req('/api/documents?'+new URLSearchParams({title:'내부관리계획_협회',manager:'원담당자',from:'2026-01-30',to:'2026-01-30'})));
  assert.equal(list.rows.length,1);assert.equal(list.rows[0].kwwa.title,'개정된 협회 계획');assert.equal(list.rows[0].kwwa.history_match,1);assert.equal(list.rows[0].upper.title,'개정된 상위 계획');
  assert.equal(ok(await req('/api/documents?title='+encodeURIComponent('개정된 상위'))).rows[0].kwwa.id,assocA.document_id);
  assert.equal((await req('/api/documents?from=2026-02-30')).status,400);assert.equal((await req('/api/documents?from=2026-05-01&to=2026-01-01')).status,400);
 });
 await t.test('상대 문서의 모든 필드 수정·첨부 교체·오래된 토큰 보호',async()=>{
  const before=await document(upperA.document_id),old=before.revisions[0];
  ok(await edit(before,{title:'가'.repeat(50),summary:'내'.repeat(300),approval_no:'가'.repeat(10),manager:'새 담당자',revision_date:'2026-08-15',keep_attachments:[]},[['최종.pdf','final-file']]));
  const after=await document(assocA.document_id),r=after.columns.upper.revisions[0];assert.equal(r.title.length,50);assert.equal(r.summary.length,300);assert.equal(r.manager,'새 담당자');assert.equal(r.approval_no.length,10);assert.equal(r.revision_date,'2026-08-15');assert.equal(r.attachments[0].name,'최종.pdf');
  assert.equal(after.columns.upper.related_document_id,assocA.document_id);
  assert.equal((await save('/api/revisions/'+old.id,form('upper',privacy,'오래된 창',{token:old.token,related_document_id:null}),[],'PUT')).status,409);
  assert.equal((await document(upperA.document_id)).related_document_id,assocA.document_id);
 });
 await t.test('연결 해제·상대 변경·양쪽에서 동일한 1:1 관계 확인',async()=>{
  ok(await edit(await document(assocA.document_id),{related_document_id:null}));assert.equal((await document(upperA.document_id)).related_document_id,null);
  ok(await edit(await document(assocB.document_id),{related_document_id:upperA.document_id}));
  ok(await edit(await document(assocA.document_id),{related_document_id:upperB.document_id}));
  assert.equal((await document(upperA.document_id)).related_document_id,assocB.document_id);assert.equal((await document(upperB.document_id)).related_document_id,assocA.document_id);
  assert.equal(ok(await req('/api/documents?category='+privacy)).rows.length,2);
  assert.equal((await edit(await document(assocB.document_id),{related_document_id:upperB.document_id})).status,409);
  assert.equal((await document(assocB.document_id)).related_document_id,upperA.document_id);
 });
 await t.test('연결 해제 후 기관 구분·업무구분 이동',async()=>{
  const temp=ok(await save('/api/documents',form('kwwa',privacy,'이동 문서')),201);
  ok(await edit(await document(temp.document_id),{organization_id:'upper',category_id:child}));
  const moved=await document(temp.document_id);assert.equal(moved.document.organization_id,'upper');assert.equal(moved.document.category_id,child);assert.equal(moved.columns.kwwa,null);
  ok(await req('/api/documents/'+temp.document_id,{method:'DELETE',data:{token:moved.revisions[0].token}}));
 });
 await t.test('동시에 같은 대상을 연결해도 한 문서만 성공',async()=>{
  raceTarget=ok(await save('/api/documents',form('upper',security,'동시 연결 대상')),201);
  const result=await Promise.all(['동시 A','동시 B'].map(title=>save('/api/documents',form('kwwa',security,title,{related_document_id:raceTarget.document_id}),[['동시.pdf',title]])));
  assert.deepEqual(result.map(r=>r.status).sort(),[201,409]);
  const partner=await document(raceTarget.document_id);assert.ok(partner.columns.kwwa);assert.equal(partner.related_documents.length,1);
  const rows=ok(await req('/api/documents?category='+security)).rows;assert.equal(rows.length,1);assert.equal(rows[0].upper.id,raceTarget.document_id);
  await assert.rejects(db.prepare('INSERT INTO document_pairs VALUES(?,?,?)').bind(assocB.document_id,raceTarget.document_id,'2026-10-20').run());
 });
 await t.test('개정 순번 동시성·최신 및 최초 이력 삭제 후 연결 유지',async()=>{
  const payload=form('kwwa',privacy,'동시 개정');delete payload.related_document_id;
  const concurrent=await Promise.all([save(`/api/documents/${assocA.document_id}/revisions`,payload),save(`/api/documents/${assocA.document_id}/revisions`,payload)]);concurrent.forEach(r=>ok(r,201));
  let data=await document(assocA.document_id);assert.deepEqual(data.revisions.map(r=>r.sequence),[4,3,2,1]);
  ok(await req('/api/revisions/'+data.revisions[0].id,{method:'DELETE',data:{token:data.revisions[0].token}}));
  data=await document(assocA.document_id);assert.equal(data.related_document_id,upperB.document_id);assert.equal(data.revisions[0].sequence,3);
  const first=data.revisions.at(-1),files=first.attachments;
  const removed=ok(await req('/api/revisions/'+first.id,{method:'DELETE',data:{token:first.token}}));assert.equal(removed.document_deleted,false);
  data=await document(assocA.document_id);assert.deepEqual(data.revisions.map(r=>r.sequence),[3,2]);assert.equal(data.related_document_id,upperB.document_id);
  for(const file of files)assert.equal((await req('/api/files/'+file.id)).status,404);
 });
 await t.test('모든 순번 삭제·마지막 이력 삭제 시 문서 정리 및 상대 문서 보존',async()=>{
  const upper=ok(await save('/api/documents',form('upper',security,'보존할 상대 문서'),[['상대.pdf','keep-partner']]),201);
  const assoc=ok(await save('/api/documents',form('kwwa',security,'삭제할 제정',{related_document_id:upper.document_id}),[['제정.pdf','delete-first']]),201);
  for(const title of ['중간 개정','마지막 개정'])ok(await save(`/api/documents/${assoc.document_id}/revisions`,form('kwwa',security,title,{related_document_id:upper.document_id}),[[title+'.pdf',title]]),201);
  let data=await document(assoc.document_id);const middle=data.revisions[1],first=data.revisions.at(-1),last=data.revisions[0];
  assert.equal((await req('/api/revisions/'+middle.id,{method:'DELETE',data:{token:'stale-token'}})).status,409);
  assert.equal((await document(assoc.document_id)).revisions.length,3);
  for(const revision of [middle,first]){
   const result=ok(await req('/api/revisions/'+revision.id,{method:'DELETE',data:{token:revision.token}}));assert.equal(result.document_deleted,false);
   for(const file of revision.attachments)assert.equal((await req('/api/files/'+file.id)).status,404);
  }
  data=await document(assoc.document_id);assert.deepEqual(data.revisions.map(r=>r.sequence),[3]);assert.equal(data.related_document_id,upper.document_id);
  ok(await save(`/api/documents/${assoc.document_id}/revisions`,form('kwwa',security,'제정 삭제 후 개정',{related_document_id:upper.document_id})),201);
  data=await document(assoc.document_id);assert.deepEqual(data.revisions.map(r=>r.sequence),[4,3]);
  ok(await req('/api/revisions/'+data.revisions[0].id,{method:'DELETE',data:{token:data.revisions[0].token}}));
  const removed=ok(await req('/api/revisions/'+last.id,{method:'DELETE',data:{token:last.token}}));assert.equal(removed.document_deleted,true);assert.equal(removed.document_id,assoc.document_id);
  assert.equal((await req('/api/documents/'+assoc.document_id)).status,404);
  for(const file of last.attachments)assert.equal((await req('/api/files/'+file.id)).status,404);
  const survivor=await document(upper.document_id);assert.equal(survivor.related_document_id,null);assert.equal(survivor.columns.kwwa,null);assert.equal(survivor.revisions.length,1);
  assert.equal((await req('/api/files/'+survivor.revisions[0].attachments[0].id)).body,'keep-partner');
  const row=ok(await req('/api/documents?category='+security)).rows.find(row=>row.upper?.id===upper.document_id);assert.equal(row.kwwa,null);
  const upperRemoved=ok(await req('/api/revisions/'+survivor.revisions[0].id,{method:'DELETE',data:{token:survivor.revisions[0].token}}));assert.equal(upperRemoved.document_deleted,true);
  assert.equal((await req('/api/documents/'+upper.document_id)).status,404);
  assert.ok(ok(await req('/api/bootstrap')).categories.some(c=>c.id===security));
 });
 await t.test('동시 삭제 및 개정 추가 경합에서 빈 문서가 남지 않음',async()=>{
  const temp=ok(await save('/api/documents',form('kwwa',security,'동시 삭제 문서')),201);
  ok(await save(`/api/documents/${temp.document_id}/revisions`,form('kwwa',security,'동시 삭제 개정')),201);
  const data=await document(temp.document_id);
  const deleted=await Promise.all(data.revisions.map(r=>req('/api/revisions/'+r.id,{method:'DELETE',data:{token:r.token}})));deleted.forEach(result=>ok(result));
  assert.equal(deleted.filter(r=>r.body.document_deleted).length,1);assert.equal((await req('/api/documents/'+temp.document_id)).status,404);
  const race=ok(await save('/api/documents',form('upper',security,'개정 삭제 경합')),201),original=(await document(race.document_id)).revisions[0];
  const [removal,append]=await Promise.all([req('/api/revisions/'+original.id,{method:'DELETE',data:{token:original.token}}),save(`/api/documents/${race.document_id}/revisions`,form('upper',security,'동시에 추가된 개정'),[['경합.pdf','race-file']])]);
  ok(removal);assert.ok([201,404,409].includes(append.status),JSON.stringify(append.body));
  if(append.status===201){const remaining=await document(race.document_id);assert.equal(remaining.revisions.length,1);assert.equal(remaining.revisions[0].title,'동시에 추가된 개정');}
  else assert.equal((await req('/api/documents/'+race.document_id)).status,404);
  assert.equal((await db.prepare('SELECT count(*) n FROM documents d WHERE NOT EXISTS(SELECT 1 FROM revisions r WHERE r.document_id=d.id)').first()).n,0);
 });
 await t.test('문서 삭제 시 상대 보존·자동 연결 해제·파일 접근 차단',async()=>{
  const target=await document(upperA.document_id),file=target.revisions[0].attachments[0];
  ok(await req('/api/documents/'+upperA.document_id,{method:'DELETE',data:{token:target.revisions[0].token}}));
  assert.equal((await req('/api/documents/'+upperA.document_id)).status,404);assert.equal((await req('/api/files/'+file.id)).status,404);
  const survivor=await document(assocB.document_id);assert.equal(survivor.related_document_id,null);assert.equal(survivor.columns.upper,null);
 });
 await t.test('문자수·유효일자·필수값·사용 중 업무구분 보호',async()=>{
  for(const fields of [{title:'한'.repeat(51)},{summary:'한'.repeat(301)},{approval_no:'가'.repeat(11)},{revision_date:'2026-02-30'},{manager:''}])assert.equal((await save('/api/documents',form('kwwa',privacy,'오류 문서',fields))).status,400);
  assert.equal((await req('/api/categories/'+privacy,{method:'DELETE'})).status,409);
 });
 await t.test('로그아웃·첨부 접근 제한·로그인 실패 제한',async()=>{
  const file=(await document(assocA.document_id)).revisions.at(-1).attachments[0];
  ok(await req('/api/logout',{method:'POST'}));cookie='';assert.equal((await req('/api/documents')).status,401);assert.equal((await req('/api/files/'+file.id)).status,401);
  for(let i=0;i<5;i++)assert.equal((await req('/api/login',{method:'POST',data:{username:'admin',password:'wrong'},headers:{'CF-Connecting-IP':'198.51.100.9'}})).status,401);
  assert.equal((await req('/api/login',{method:'POST',data:{username:'admin',password},headers:{'CF-Connecting-IP':'198.51.100.9'}})).status,429);
 });
});
