import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pbkdf2Sync, createHash } from 'node:crypto';
import { Miniflare, FormData } from 'miniflare';
import { passwordHash, inspectAdministrator, prepareAdministrator } from '../scripts/admin-credentials.mjs';
import { normalizeIp, clientIp } from '../src/access-control.mjs';
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
 const r=bundle.revisions[0];return save('/api/revisions/'+r.id,form(bundle.document.organization_id,bundle.document.category_id,r.title,{revision_date:r.revision_date,summary:r.summary,manager:r.manager,approval_no:r.approval_no,document_type:bundle.document.document_type,requirement:bundle.document.requirement,token:r.token,related_document_id:bundle.related_document_id,keep_attachments:r.attachments.map(a=>a.id),...extra}),files,'PUT');
};
async function migrate(name,database=db){const sql=await readFile('migrations/'+name,'utf8');await database.batch(sql.split(/;\s*\n/).map(s=>s.trim()).filter(Boolean).map(sql=>database.prepare(sql)));}
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
 await t.test('문서종류·사용자 구조 전환과 기존 문서 및 파일 보존',async()=>{
  const before=(await db.prepare('SELECT id,organization_id,category_id,created_at FROM documents ORDER BY id').all()).results;
  const legacyToken='a'.repeat(64);await db.prepare('INSERT INTO sessions VALUES(?,?)').bind(createHash('sha256').update(legacyToken).digest('hex'),Date.now()+60000).run();
  await migrate('0004_document_types_and_users.sql');
  await migrate('0007_access_control_requirement.sql');
  assert.deepEqual((await db.prepare('SELECT id,organization_id,category_id,created_at FROM documents ORDER BY id').all()).results,before);
  assert.equal((await db.prepare("SELECT count(*) n FROM documents WHERE document_type<>'지침'").first()).n,0);
  assert.equal((await db.prepare('SELECT count(*) n FROM revisions').first()).n,5);assert.equal((await db.prepare('SELECT count(*) n FROM attachments').first()).n,2);
  assert.equal((await db.prepare("SELECT count(*) n FROM documents WHERE requirement<>'권장'").first()).n,0);
  assert.equal((await db.prepare('SELECT mode FROM access_settings WHERE id=1').first()).mode,'all');
  cookie='__Host-doc_session='+legacyToken;assert.equal(ok(await req('/api/session')).authenticated,false);cookie='';
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
 await t.test('연도·월 검색의 연초·월말·윤년 경계와 입력값 검증',async()=>{
  const category=ok(await req('/api/categories',{method:'POST',data:{name:'연월 검색 검증'}}),201).id;
  const cases=[
   ['2025-12-31','전년도말','다른담당'],['2026-01-01','올해초','검색담당'],
   ['2026-02-28','2월말','검색담당'],['2026-03-01','3월초','다른담당'],
   ['2026-12-31','올해말','다른담당'],['2027-01-01','다음해초','검색담당'],
   ['2024-02-29','윤년','다른담당'],['1900-01-01','하한','다른담당'],['9999-12-31','상한','다른담당']
  ],created=[];
  for(const [revision_date,title,manager] of cases)created.push(ok(await save('/api/documents',form('kwwa',category,title,{revision_date,manager})),201));
  const search=async query=>ok(await req('/api/documents?category='+category+'&'+query)).documents;
  const dates=async query=>(await search(query)).map(d=>d.revision_date).sort();
  assert.deepEqual(await dates('year=2026'),['2026-01-01','2026-02-28','2026-03-01','2026-12-31']);
  assert.deepEqual(await dates('year=2026&month=2'),['2026-02-28']);
  assert.deepEqual(await dates('year=2026&month=01'),['2026-01-01']);
  assert.deepEqual(await dates('year=2026&month=12'),['2026-12-31']);
  assert.deepEqual(await dates('year=2025'),['2025-12-31']);
  assert.deepEqual(await dates('year=2024&month=2'),['2024-02-29']);
  assert.deepEqual(await dates('year=1900&month=1'),['1900-01-01']);
  assert.deepEqual(await dates('year=9999&month=12'),['9999-12-31']);
  assert.equal((await search('year=&month=')).length,cases.length);
  assert.equal((await search('year=2026&month=2&title='+encodeURIComponent('2월말')+'&manager='+encodeURIComponent('검색담당'))).length,1);
  assert.equal((await search('year=2026&month=2&manager='+encodeURIComponent('다른담당'))).length,0);
  for(const query of ['month=1','year=2026&month=0','year=2026&month=13','year=2026&month=1.5','year=1899','year=10000','year=26','year=abcd','year=2026.5'])assert.equal((await req('/api/documents?'+query)).status,400,query);
  ok(await save('/api/documents/'+created[1].document_id+'/revisions',form('kwwa',category,'다음 해에 개정된 문서',{revision_date:'2027-04-15'})),201);
  const history=await search('year=2026&month=1');assert.equal(history.length,1);assert.equal(history[0].id,created[1].document_id);assert.equal(history[0].revision_date,'2027-04-15');
  for(const item of created){const current=await document(item.document_id);ok(await req('/api/documents/'+item.document_id,{method:'DELETE',data:{token:current.revisions[0].token}}));}
  ok(await req('/api/categories/'+category,{method:'DELETE'}));
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
 await t.test('문서종류 기본값·네 가지 종류 정렬·같은 종류의 날짜 내림차순·연결 행 기준',async()=>{
  const category=ok(await req('/api/categories',{method:'POST',data:{name:'문서종류 검증'}}),201).id,created=[];
  const add=async(title,type,date,extra={})=>{
   const result=ok(await save('/api/documents',form('kwwa',category,title,{...(type?{document_type:type}:{}),revision_date:date,...extra}),[['종류.pdf','type-file']]),201);created.push(result);return result;
  };
  const other=await add('기타 문서','기타','2030-01-01');
  const guide=await add('가이드라인 문서','가이드라인','2027-01-01');
  const upper=ok(await save('/api/documents',form('upper',category,'상위기관 다른 종류',{document_type:'기타',revision_date:'2099-12-31'})),201);created.push(upper);
  const manualOld=await add('매뉴얼 이전','매뉴얼','2020-01-01',{related_document_id:upper.document_id});
  const guidelineOld=await add('지침 이전','지침','2025-01-01');
  const defaultType=await add('기본 종류',null,'2024-01-01');
  const manualNew=await add('매뉴얼 최근','매뉴얼','2026-01-01');
  const guidelineNew=await add('지침 최근','지침','2026-01-01');
  const list=ok(await req('/api/documents?category='+category));
  assert.deepEqual(list.rows.map(row=>(row.kwwa||row.upper).id),[guidelineNew,guidelineOld,defaultType,manualNew,manualOld,guide,other].map(d=>d.document_id));
  assert.equal(list.rows.find(row=>row.kwwa?.id===manualOld.document_id).upper.document_type,'기타');
  assert.equal((await document(defaultType.document_id)).document.document_type,'지침');
  assert.deepEqual(ok(await req('/api/bootstrap')).document_types,['지침','매뉴얼','가이드라인','기타']);
  for(const document_type of ['규정','',null,42])assert.equal((await save('/api/documents',form('kwwa',category,'잘못된 종류',{document_type}))).status,400);
  await assert.rejects(db.prepare("UPDATE documents SET document_type='규정' WHERE id=?").bind(other.document_id).run());
  const original=await document(manualOld.document_id),file=original.revisions[0].attachments[0];
  ok(await save('/api/documents/'+manualOld.document_id+'/revisions',form('kwwa',category,'기존 양식 개정',{related_document_id:upper.document_id})),201);
  let changed=await document(manualOld.document_id);assert.equal(changed.document.document_type,'매뉴얼');assert.equal(changed.revisions.length,2);
  ok(await edit(changed,{document_type:'가이드라인'}));
  changed=await document(manualOld.document_id);assert.equal(changed.document.document_type,'가이드라인');assert.equal(changed.revisions.length,2);assert.equal(changed.related_document_id,upper.document_id);
  assert.equal((await req('/api/files/'+file.id)).body,'type-file');
  const options=ok(await req('/api/references?'+new URLSearchParams({exclude_org:'upper',category,document:upper.document_id}))).documents;
  assert.equal(options.find(d=>d.id===manualOld.document_id).document_type,'가이드라인');
  for(const item of created){const current=await document(item.document_id);ok(await req('/api/documents/'+item.document_id,{method:'DELETE',data:{token:current.revisions[0].token}}));}
  ok(await req('/api/categories/'+category,{method:'DELETE'}));
 });
 await t.test('양쪽 기관 날짜순 이력·중간 삽입·동일 날짜·차수 재계산·최신 문서 및 첨부 보존',async()=>{
  const before=(await db.prepare('SELECT id,token FROM revisions ORDER BY id').all()).results;
  await migrate('0006_revision_date_order.sql');assert.deepEqual((await db.prepare('SELECT id,token FROM revisions ORDER BY id').all()).results,before);
  const category=ok(await req('/api/categories',{method:'POST',data:{name:'날짜순 이력 검증'}}),201).id;
  const upper=ok(await save('/api/documents',form('upper',category,'상위 최신 먼저 등록',{document_type:'가이드라인',revision_date:'2030-01-01'}),[['상위-최신.pdf','upper-newest-file']]),201);
  const assoc=ok(await save('/api/documents',form('kwwa',category,'협회 최신 먼저 등록',{document_type:'매뉴얼',revision_date:'2028-07-01',related_document_id:upper.document_id}),[['협회-최신.pdf','association-newest-file']]),201);
  const cases=[{side:'kwwa',prefix:'협회',created:assoc,partner:upper,latestDate:'2028-07-01',type:'매뉴얼'}, {side:'upper',prefix:'상위',created:upper,partner:assoc,latestDate:'2030-01-01',type:'가이드라인'}];
  const expectedHistory=async(id,ordered)=>{
   const bundle=await document(id);assert.deepEqual(bundle.revisions.map(r=>r.id),ordered);
   assert.deepEqual(bundle.revisions.map(r=>r.display_sequence),ordered.map((_,index)=>ordered.length-index));
   assert.deepEqual(bundle.revisions.map(r=>r.revision_date),bundle.revisions.map(r=>r.revision_date).sort().reverse());return bundle;
  };
  const latest=async item=>{
   const row=ok(await req('/api/documents?category='+category)).rows[0];return row[item.side];
  };
  for(const item of cases){
   const {side,prefix,created,partner}=item,id=created.document_id;
   const append=(date,title)=>save('/api/documents/'+id+'/revisions',form(side,category,title,{revision_date:date,related_document_id:partner.document_id}),[[title+'.pdf',title+'-file']]);
   const middle=ok(await append('2024-04-01',prefix+' 중간'),201),oldest=ok(await append('2020-01-01',prefix+' 과거'),201),sameDay=ok(await append('2024-04-01',prefix+' 같은 날짜'),201);
   let bundle=await expectedHistory(id,[created.revision_id,sameDay.revision_id,middle.revision_id,oldest.revision_id]);
   assert.deepEqual(bundle.revisions.map(r=>r.sequence),[1,4,2,3]);assert.equal(bundle.document.document_type,item.type);assert.equal(bundle.related_document_id,partner.document_id);
   assert.equal(bundle.revisions[0].attachments.length,1);const originalFile=bundle.revisions[0].attachments[0];
   let newest=await latest(item);assert.equal(newest.revision_id,created.revision_id);assert.equal(newest.revision_date,item.latestDate);assert.equal(newest.display_sequence,4);assert.equal(newest.attachment_count,1);
   const references=ok(await req('/api/references?'+new URLSearchParams({exclude_org:side==='kwwa'?'upper':'kwwa',category,document:partner.document_id}))).documents;
   assert.equal(references.find(d=>d.id===id).revision_id,created.revision_id);assert.equal(references.find(d=>d.id===id).display_sequence,4);
   const historical=ok(await req('/api/documents?'+new URLSearchParams({category,year:'2020'}))).documents.find(d=>d.id===id);
   assert.equal(historical.revision_date,item.latestDate);assert.equal(historical.history_match,1);
   // Move the last-registered oldest record above the original newest date.
   const moved=bundle.revisions.at(-1),file=moved.attachments[0];
   ok(await edit({...bundle,revisions:[moved]},{title:prefix+' 날짜 수정 최신',revision_date:'2040-02-02'}));
   bundle=await expectedHistory(id,[oldest.revision_id,created.revision_id,sameDay.revision_id,middle.revision_id]);
   assert.equal(bundle.revisions[0].attachments[0].id,file.id);assert.equal((await req('/api/files/'+file.id)).body,prefix+' 과거-file');
   assert.equal((await edit({...bundle,revisions:[moved]},{revision_date:'2041-01-01'})).status,409);
   assert.equal((await latest(item)).revision_id,oldest.revision_id);
   const first=bundle.revisions.at(-1);ok(await req('/api/revisions/'+first.id,{method:'DELETE',data:{token:first.token}}));
   bundle=await expectedHistory(id,[oldest.revision_id,created.revision_id,sameDay.revision_id]);assert.equal(bundle.revisions.at(-1).display_sequence,1);
   // A newly registered earlier date becomes 제정; every other label advances.
   const earlier=ok(await append('2010-01-01',prefix+' 가장 과거 추가'),201);
   bundle=await expectedHistory(id,[oldest.revision_id,created.revision_id,sameDay.revision_id,earlier.revision_id]);
   const removed=bundle.revisions[0];ok(await req('/api/revisions/'+removed.id,{method:'DELETE',data:{token:removed.token}}));
   bundle=await expectedHistory(id,[created.revision_id,sameDay.revision_id,earlier.revision_id]);assert.equal((await latest(item)).revision_id,created.revision_id);assert.equal((await req('/api/files/'+file.id)).status,404);
   const concurrent=await Promise.all([append('2015-01-01',prefix+' 동시 추가 A'),append('2015-01-01',prefix+' 동시 추가 B')]);concurrent.forEach(result=>ok(result,201));
   bundle=await document(id);const tied=bundle.revisions.filter(r=>r.revision_date==='2015-01-01');assert.equal(tied.length,2);assert.ok(tied[0].sequence>tied[1].sequence);
   await expectedHistory(id,[created.revision_id,sameDay.revision_id,...tied.map(r=>r.id),earlier.revision_id]);assert.equal(new Set(bundle.revisions.map(r=>r.sequence)).size,5);
   assert.equal(bundle.revisions.find(r=>r.id===created.revision_id).attachments[0].id,originalFile.id);assert.equal((await req('/api/files/'+originalFile.id)).status,200);
  }
  for(const item of cases){
   const bundle=await document(item.created.document_id),registeredLast=[...bundle.revisions].sort((a,b)=>b.sequence-a.sequence)[0];
   assert.notEqual(bundle.revisions[0].id,registeredLast.id);
   assert.equal((await req('/api/documents/'+item.created.document_id,{method:'DELETE',data:{token:registeredLast.token}})).status,409);
   ok(await req('/api/documents/'+item.created.document_id,{method:'DELETE',data:{token:bundle.revisions[0].token}}));
   if(item.side==='kwwa'){const survivor=await document(upper.document_id);assert.equal(survivor.related_document_id,null);assert.equal(survivor.revisions[0].id,upper.revision_id);}
  }
  ok(await req('/api/categories/'+category,{method:'DELETE'}));assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 });
 await t.test('문서 필수여부 기본값·등록·수정·개정 보존 및 허용값 검증',async()=>{
  const made=ok(await save('/api/documents',form('kwwa',privacy,'필수여부 검증')),201),id=made.document_id;
  let bundle=await document(id);assert.equal(bundle.document.requirement,'권장');
  ok(await edit(bundle,{requirement:'필수'}));bundle=await document(id);assert.equal(bundle.document.requirement,'필수');
  assert.equal(ok(await req('/api/documents')).documents.find(d=>d.id===id).requirement,'필수');
  ok(await save('/api/documents/'+id+'/revisions',form('kwwa',privacy,'필수문서 개정')),201);bundle=await document(id);assert.equal(bundle.document.requirement,'필수');assert.equal(bundle.revisions.length,2);
  const options=ok(await req('/api/references?'+new URLSearchParams({exclude_org:'upper',category:privacy}))).documents;assert.equal(options.find(d=>d.id===id).requirement,'필수');
  for(const requirement of ['',null,'선택',true])assert.equal((await edit(bundle,{requirement})).status,400);
  await assert.rejects(db.prepare("UPDATE documents SET requirement='선택' WHERE id=?").bind(id).run());
  ok(await edit(bundle,{requirement:'권장'}));bundle=await document(id);assert.equal(bundle.document.requirement,'권장');assert.equal(bundle.revisions.length,2);
  ok(await req('/api/documents/'+id,{method:'DELETE',data:{token:bundle.revisions[0].token}}));
 });
 const userPassword='member-initial-password',changedPassword='member-changed-password',resetPassword='member-reset-password';
 const signIn=async(username,secret,ip='203.0.113.10')=>{
  const result=await req('/api/login',{method:'POST',data:{username,password:secret},headers:{'CF-Connecting-IP':ip}});ok(result);return {cookie:result.headers.get('Set-Cookie').split(';')[0],user:result.body.user};
 };
 const as=(session,path,options={})=>req(path,{...options,headers:{...options.headers,Cookie:session}});
 const accounts=async()=>ok(await req('/api/users')).users;
 const account=async id=>(await accounts()).find(user=>user.id===id);
 const changeAccount=async(user,extra)=>req('/api/users/'+user.id,{method:'PUT',data:{...user,...extra}});
 let memberId;
 await t.test('관리자 전체 사용자 목록·마스킹·추가·모든 계정정보 수정·중복 및 동시 변경 보호',async()=>{
  const root=ok(await req('/api/me')).user;assert.equal(root.login_id,'admin');assert.equal(root.is_admin,true);assert.ok(root.last_login_at);
  const created=ok(await req('/api/users',{method:'POST',data:{login_id:'member',password:userPassword,name:'일반 사용자',active:true,is_admin:true,last_login_at:'2026-01-02T03:04:05+09:00'}}),201);memberId=created.id;
  let member=await account(memberId);assert.equal(member.is_admin,false);assert.equal(member.password_mask,'********');assert.equal(member.last_login_at,'2026-01-01T18:04:05.000Z');
  assert.equal((await accounts()).length,2);
  const safe=JSON.stringify([await accounts(),ok(await req('/api/bootstrap')),ok(await req('/api/session'))]);
  assert.doesNotMatch(safe,/password_hash|pbkdf2\$|member-initial-password|local-test-password-only/);
  const stored=await db.prepare('SELECT password_hash FROM users WHERE id=?').bind(memberId).first();assert.match(stored.password_hash,/^pbkdf2\$100000\$/);assert.notEqual(stored.password_hash,userPassword);
  for(const data of [{login_id:'MEMBER',password:userPassword,name:'중복'}, {login_id:'admin',password:userPassword,name:'관리자 중복'}])assert.equal((await req('/api/users',{method:'POST',data})).status,409);
  for(const extra of [{name:''},{login_id:''},{active:'true'},{password:'short'},{password:'a'.repeat(257)},{last_login_at:'not-a-date'},{last_login_at:'2026-02-30T00:00:00Z'}])assert.equal((await changeAccount(member,extra)).status,400);
  ok(await changeAccount(member,{name:'사용자 수정',password:'',last_login_at:null}));
  assert.equal((await changeAccount(member,{name:'오래된 수정'})).status,409);
  member=await account(memberId);assert.equal(member.name,'사용자 수정');assert.equal(member.last_login_at,null);
  assert.equal((await db.prepare('SELECT password_hash FROM users WHERE id=?').bind(memberId).first()).password_hash,stored.password_hash);
  const concurrent=await Promise.all(['동시 수정 A','동시 수정 B'].map(name=>changeAccount(member,{name})));assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 });
 await t.test('일반 사용자는 본인 정보만 조회하고 사용자 관리 API·권한 승격은 차단',async()=>{
  const session=await signIn('MEMBER',userPassword),own=ok(await as(session.cookie,'/api/me')).user;
  assert.equal(own.id,memberId);assert.equal(own.is_admin,false);assert.ok(Date.parse(own.last_login_at)>=Date.now()-10000);
  const bootstrap=ok(await as(session.cookie,'/api/bootstrap'));assert.equal(bootstrap.user.id,memberId);assert.equal('users' in bootstrap,false);
  assert.equal(ok(await as(session.cookie,'/api/session')).user.id,memberId);
  const root=(await accounts()).find(user=>user.is_admin);
  for(const [path,method] of [['/api/users','GET'],['/api/users','POST'],['/api/users/'+memberId,'PUT'],['/api/users/'+memberId,'DELETE'],['/api/users/'+root.id,'GET'],['/api/users/'+root.id,'PUT']])assert.equal((await as(session.cookie,path,{method,data:method==='GET'?undefined:{...own,is_admin:true,password:userPassword}})).status,403);
  assert.equal((await account(memberId)).is_admin,false);assert.equal((await account(root.id)).login_id,'admin');
 });
 await t.test('본인 비밀번호 검증·변경·대상 계정 위조 차단·모든 기존 세션 폐기',async()=>{
  const one=await signIn('member',userPassword),two=await signIn('member',userPassword);
  const root=(await accounts()).find(user=>user.is_admin),rootHash=(await db.prepare('SELECT password_hash FROM users WHERE id=?').bind(root.id).first()).password_hash;
  assert.equal((await as(one.cookie,'/api/me/password',{method:'PUT',data:{current_password:'incorrect',new_password:changedPassword}})).status,400);
  assert.equal((await as(one.cookie,'/api/me/password',{method:'PUT',data:{current_password:userPassword,new_password:'short'}})).status,400);
  assert.equal(ok(await as(two.cookie,'/api/me/password',{method:'PUT',data:{id:root.id,current_password:userPassword,new_password:changedPassword}})).reauthenticate,true);
  for(const old of [one.cookie,two.cookie]){assert.equal((await as(old,'/api/me')).status,401);assert.equal(ok(await as(old,'/api/session')).authenticated,false);}
  assert.equal((await db.prepare('SELECT password_hash FROM users WHERE id=?').bind(root.id).first()).password_hash,rootHash);
  assert.equal((await req('/api/login',{method:'POST',data:{username:'member',password:userPassword},headers:{'CF-Connecting-IP':'203.0.113.11'}})).status,401);
  assert.equal((await signIn('member',changedPassword)).user.id,memberId);
 });
 await t.test('관리자 ID·비밀번호 초기화 및 비활성화는 접근 차단하고 재활성화 후 새 로그인만 허용',async()=>{
  const old=await signIn('member',changedPassword);
  ok(await changeAccount(await account(memberId),{login_id:'renamed-member',password:resetPassword,name:'최종 이름',last_login_at:'2026-09-01T10:20:00+09:00'}));
  assert.equal((await as(old.cookie,'/api/documents')).status,401);
  assert.equal((await req('/api/login',{method:'POST',data:{username:'member',password:changedPassword},headers:{'CF-Connecting-IP':'203.0.113.12'}})).status,401);
  const renamed=await signIn('renamed-member',resetPassword);assert.equal(renamed.user.name,'최종 이름');
  ok(await changeAccount(await account(memberId),{active:false}));assert.equal((await as(renamed.cookie,'/api/me')).status,401);
  assert.equal((await req('/api/login',{method:'POST',data:{username:'renamed-member',password:resetPassword},headers:{'CF-Connecting-IP':'203.0.113.13'}})).status,401);
  ok(await changeAccount(await account(memberId),{active:true}));assert.equal((await as(renamed.cookie,'/api/me')).status,401);
  assert.equal((await signIn('renamed-member',resetPassword)).user.active,true);
 });
 await t.test('사용자 삭제는 세션만 함께 정리하며 문서는 보존하고 관리자 삭제·비활성화는 보호',async()=>{
  const session=await signIn('renamed-member',resetPassword),member=await account(memberId);
  const before=(await db.prepare('SELECT count(*) n FROM documents').first()).n;
  assert.equal((await req('/api/users/'+memberId,{method:'DELETE',data:{token:'stale'}})).status,409);
  ok(await req('/api/users/'+memberId,{method:'DELETE',data:{token:member.token}}));
  assert.equal((await as(session.cookie,'/api/me')).status,401);assert.equal((await db.prepare('SELECT count(*) n FROM user_sessions WHERE user_id=?').bind(memberId).first()).n,0);
  assert.equal((await db.prepare('SELECT count(*) n FROM documents').first()).n,before);
  const root=(await accounts()).find(user=>user.is_admin);
  assert.equal((await req('/api/users/'+root.id,{method:'DELETE',data:{token:root.token}})).status,409);
  assert.equal((await changeAccount(root,{active:false})).status,409);
  await assert.rejects(db.prepare('DELETE FROM users WHERE id=?').bind(root.id).run());
  await assert.rejects(db.prepare('UPDATE users SET active=0 WHERE id=?').bind(root.id).run());
  await assert.rejects(db.prepare('UPDATE users SET is_admin=0 WHERE id=?').bind(root.id).run());
 });
 await t.test('관리자 자신의 ID·비밀번호 변경 뒤 재배포용 점검에서도 계정과 변경 비밀번호 유지',async()=>{
  const root=(await accounts()).find(user=>user.is_admin),oldCookie=cookie,newPassword='admin-changed-password';
  assert.equal(ok(await changeAccount(root,{login_id:'renamed-admin',name:'변경 관리자',password:newPassword})).reauthenticate,true);
  assert.equal((await as(oldCookie,'/api/users')).status,401);
  const health=ok(await req('/api/health'));assert.equal(health.ready,true);assert.equal(health.account_management,true);
  assert.equal((await db.prepare('SELECT count(*) n FROM users WHERE is_admin=1').first()).n,1);
  assert.equal((await req('/api/login',{method:'POST',data:{username:'admin',password},headers:{'CF-Connecting-IP':'203.0.113.14'}})).status,401);
  cookie=(await signIn('renamed-admin',newPassword)).cookie;
  assert.equal(ok(await req('/api/me')).user.name,'변경 관리자');
  assert.equal(ok(await changeAccount(await account(root.id),{login_id:'admin',name:'관리자',password})).reauthenticate,true);
  cookie=(await signIn('admin',password)).cookie;
 });
 await t.test('로그아웃·첨부 접근 제한·기존 로그인 차단 해제 및 반복 실패 뒤 즉시 로그인',async()=>{
  const file=(await document(assocA.document_id)).revisions.at(-1).attachments[0];
  ok(await req('/api/logout',{method:'POST'}));cookie='';assert.equal((await req('/api/documents')).status,401);assert.equal((await req('/api/files/'+file.id)).status,401);
  const ip='198.51.100.9',ipHash=createHash('sha256').update(ip).digest('hex');
  await db.prepare('INSERT INTO login_attempts VALUES(?,99,?)').bind(ipHash,Date.now()+900000).run();
  // Even pre-existing block records cannot prevent checking a correct password.
  let session=await signIn('admin',password,ip);assert.equal(session.user.is_admin,true);
  await migrate('0005_clear_login_lockouts.sql');assert.equal((await db.prepare('SELECT count(*) n FROM login_attempts').first()).n,0);
  for(let i=0;i<12;i++)assert.equal((await req('/api/login',{method:'POST',data:{username:'admin',password:'wrong'},headers:{'CF-Connecting-IP':ip}})).status,401);
  session=await signIn('admin',password,ip);assert.equal(ok(await as(session.cookie,'/api/session')).authenticated,true);
  assert.equal(ok(await req('/api/health')).login_attempt_limit,false);
  assert.equal((await db.prepare('SELECT count(*) n FROM login_attempts').first()).n,0);
 });
});

test('IP 주소 정규화·신뢰할 수 있는 접속 IP·위조 헤더 구분',()=>{
 for(const [input,expected] of [['203.0.113.10','203.0.113.10'],[' 203.0.113.10 ','203.0.113.10'],['2001:0DB8:0000:0:0:0:0:1','2001:db8::1'],['::ffff:203.0.113.10','203.0.113.10'],['::ffff:cb00:710a','203.0.113.10']])assert.equal(normalizeIp(input),expected);
 for(const input of ['203.0.113.*','203.0.113.10/32','203.0.113.10:443','203.0.113.010','256.0.0.1','127.1','0x7f000001','[2001:db8::1]','fe80::1%eth0','2001:::1','203.0.113.10,203.0.113.11','<script>','',null])assert.equal(normalizeIp(input),null,String(input));
 const request=headers=>new Request(origin,{headers});
 assert.equal(clientIp(request({'CF-Connecting-IP':'203.0.113.22','X-Forwarded-For':'203.0.113.10','CF-Connecting-IPv6':'2001:db8::1'})),'203.0.113.22');
 assert.equal(clientIp(request({'X-Forwarded-For':'203.0.113.10'})),null);
 assert.equal(clientIp(request({'CF-Connecting-IP':'203.0.113.10','CF-Worker':'external.example'})),null);
 assert.equal(clientIp(request({'CF-Connecting-IP':'2a06:98c0:3600::103'})),null);
 assert.equal(clientIp(request({'CF-Connecting-IP':'240.1.2.3','CF-Connecting-IPv6':'2001:0DB8::1'})),'2001:db8::1');
 assert.equal(clientIp(request({'CF-Connecting-IP':'240.1.2.3'})),null);
});

test('사이트 전체 IP 접근제어·관리자 권한·우회 차단·동시 변경 및 관리자 접속 보호',async t=>{
 const fixture=new Miniflare({modules:true,scriptPath:'src/worker.js',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['FILES'],bindings:{ADMIN_PASSWORD_HASH:hash},serviceBindings:{ASSETS:()=>new Response('<!doctype html><title>안전정보팀</title>',{headers:{'Content-Type':'text/html'}})}});
 t.after(()=>fixture.dispose());const database=await fixture.getD1Database('DB'),files=await fixture.getR2Bucket('FILES');
 for(const name of ['0001_initial.sql','0002_document_pairs.sql','0003_flat_work_categories.sql','0004_document_types_and_users.sql','0005_clear_login_lockouts.sql','0006_revision_date_order.sql'])await migrate(name,database);
 const query=async(sql,params=[])=>{const result=await database.prepare(sql).bind(...params).all();return result.results;};
 await prepareAdministrator(query,password);
 await database.prepare("INSERT INTO work_categories VALUES('access-category','접근 검증','2026-01-01',0)").run();
 await database.prepare("INSERT INTO documents VALUES('access-document','kwwa','access-category','2026-01-01','지침')").run();
 await database.prepare("INSERT INTO revisions VALUES('access-revision','access-document',1,'보호할 문서','2026-01-01','','담당','','access-revision-token','2026-01-01','2026-01-01')").run();
 await database.prepare("INSERT INTO attachments VALUES('access-file','access-revision','access-storage','보호파일.pdf',12,'application/pdf','2026-01-01')").run();await files.put('access-storage','private-file');
 const originalRoot=await database.prepare('SELECT id,password_hash FROM users WHERE is_admin=1').first();
 await migrate('0007_access_control_requirement.sql',database);
 let session='';const current='203.0.113.10',other='203.0.113.22';
 const http=async(path,{method='GET',data,ip=current,headers={},cookie:override=session}={})=>{
  const response=await fixture.dispatchFetch(origin+path,{method,headers:{Origin:origin,'CF-Connecting-IP':ip,...(override?{Cookie:override}:{}),...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):undefined});
  return {status:response.status,headers:response.headers,body:(response.headers.get('Content-Type')||'').includes('application/json')?await response.json():await response.text()};
 };
 const policy=async()=>ok(await http('/api/access-control'));
 const add=async(ip,active=true,description='')=>http('/api/access-control/ips',{method:'POST',data:{ip,description,active,token:(await policy()).token}});
 const changeMode=async mode=>http('/api/access-control',{method:'PUT',data:{mode,token:(await policy()).token}});
 let mine,inactive,ipv6,memberCookie;
 await t.test('이관 시 모든 IP 기본 허용과 문서·파일·관리자 비밀번호 보존',async()=>{
  assert.deepEqual(await database.prepare('SELECT id,password_hash FROM users WHERE is_admin=1').first(),originalRoot);
  assert.equal((await database.prepare("SELECT requirement FROM documents WHERE id='access-document'").first()).requirement,'권장');assert.equal(await (await files.get('access-storage')).text(),'private-file');
  assert.equal((await http('/',{ip:other,cookie:''})).status,200);
  const login=await http('/api/login',{method:'POST',data:{username:'admin',password}});ok(login);session=login.headers.get('Set-Cookie').split(';')[0];
  const access=await policy();assert.equal(access.mode,'all');assert.deepEqual(access.ips,[]);assert.equal(access.client_ip,current);
  assert.equal((await changeMode('allowlist')).status,409);assert.equal((await policy()).mode,'all');
  assert.equal(ok(await http('/api/health')).ip_access_control,true);
 });
 await t.test('IP 추가·수정·삭제·활성화 상태·IPv6 중복 및 입력값 검사',async()=>{
  let access=ok(await add(current,true,'현재 관리자'));mine=access.ips.find(rule=>rule.ip===current);
  access=ok(await add(other,false,'비활성 테스트'));inactive=access.ips.find(rule=>rule.ip===other);assert.equal(inactive.active,false);
  access=ok(await add('2001:0DB8:0000:0:0:0:0:1',true,'IPv6 사무실'));ipv6=access.ips.find(rule=>rule.ip==='2001:db8::1');assert.ok(ipv6);
  assert.equal((await add('2001:db8::1')).status,409);assert.equal((await add('::ffff:203.0.113.10')).status,409);
  for(const ip of ['256.1.1.1','203.0.113.*','203.0.113.10/24','192.168.1.1:80','example.com',''])assert.equal((await add(ip)).status,400);
  assert.equal((await add('203.0.113.30','yes')).status,400);assert.equal((await add('203.0.113.30',true,'가'.repeat(201))).status,400);
  const temp=ok(await add('203.0.113.30')).ips.find(rule=>rule.ip==='203.0.113.30');
  access=ok(await http('/api/access-control/ips/'+temp.id,{method:'PUT',data:{ip:'203.0.113.31',description:'변경',active:false,token:(await policy()).token}}));assert.equal(access.ips.find(rule=>rule.id===temp.id).active,false);
  ok(await http('/api/access-control/ips/'+temp.id,{method:'DELETE',data:{token:access.token}}));assert.ok(!(await policy()).ips.some(rule=>rule.id===temp.id));
  assert.equal((await http('/api/access-control',{method:'PUT',data:{mode:'invalid',token:(await policy()).token}})).status,400);
 });
 await t.test('일반 사용자의 접근제어 조회·변경과 관리자 권한 위조 차단',async()=>{
  ok(await http('/api/users',{method:'POST',data:{login_id:'ip-member',name:'일반 사용자',password:'member-test-password'}}),201);
  const login=await http('/api/login',{method:'POST',data:{username:'ip-member',password:'member-test-password'},ip:other});ok(login);memberCookie=login.headers.get('Set-Cookie').split(';')[0];
  for(const [path,method] of [['/api/access-control','GET'],['/api/access-control','PUT'],['/api/access-control/ips','POST'],['/api/access-control/ips/'+mine.id,'PUT'],['/api/access-control/ips/'+mine.id,'DELETE']])assert.equal((await http(path,{method,cookie:memberCookie,ip:other,data:method==='GET'?undefined:{is_admin:true,mode:'all',ip:other,token:(await policy()).token}})).status,403);
  const bootstrap=ok(await http('/api/bootstrap',{cookie:memberCookie,ip:other}));assert.equal('ips' in bootstrap,false);assert.equal('access' in bootstrap,false);
 });
 await t.test('허용 목록은 로그인 페이지·로그인·기존 세션·문서·첨부파일에 적용하고 헤더 위조는 차단',async()=>{
  ok(await changeMode('allowlist'));
  for(const path of ['/','/index.html','/unknown-page','/api/session','/api/login','/api/bootstrap','/api/documents','/api/files/access-file','/api/me/password','/api/access-control']){
   const result=await http(path,{ip:other,method:path==='/api/login'?'POST':'GET',data:path==='/api/login'?{username:'admin',password}:undefined});assert.equal(result.status,403,path);
   if(path.startsWith('/api/')){assert.equal(result.body.code,'IP_ACCESS_DENIED');assert.equal(result.body.client_ip,other);assert.equal('ips' in result.body,false);}else{assert.match(result.body,/data-ip-access-denied/);assert.doesNotMatch(result.body,/id="login-form"/);}
  }
  const before=(await database.prepare('SELECT last_login_at FROM users WHERE is_admin=1').first()).last_login_at;
  assert.equal((await http('/api/login',{ip:other,method:'POST',data:{username:'admin',password}})).status,403);assert.equal((await database.prepare('SELECT last_login_at FROM users WHERE is_admin=1').first()).last_login_at,before);
  for(const headers of [{'X-Forwarded-For':current,'X-Real-IP':current},{'CF-Connecting-IPv6':'2001:db8::1'}])assert.equal((await http('/api/files/access-file',{ip:other,headers})).status,403);
  for(const headers of [{'CF-Connecting-IP':''},{'CF-Connecting-IP':current+', '+other},{'CF-Worker':'outside.example'}])assert.equal((await http('/api/documents',{headers})).status,403);
  assert.equal((await http('/api/me',{cookie:memberCookie,ip:other})).status,403);
  assert.equal(ok(await http('/api/me',{cookie:memberCookie})).user.login_id,'ip-member');
  assert.equal((await http('/api/files/access-file')).body,'private-file');
  assert.equal((await http('/api/files/access-file',{ip:'2001:0DB8:0:0:0:0:0:1'})).status,200);
  assert.equal((await http('/api/documents',{ip:'240.1.2.3',headers:{'CF-Connecting-IPv6':'2001:db8::1'}})).status,200);
  for(const path of ['/app.js','/styles.css','/favicon.svg','/api/health'])assert.equal((await http(path,{ip:other,cookie:''})).status,200);
  assert.equal((await http('/api/documents',{cookie:''})).status,401);
 });
 await t.test('관리자 자신의 접근 차단 방지와 다른 IP의 활성화 변경 즉시 적용',async()=>{
  let access=await policy();
  for(const [method,extra] of [['DELETE',{}],['PUT',{ip:current,active:false}],['PUT',{ip:'203.0.113.99',active:true}]]){
   assert.equal((await http('/api/access-control/ips/'+mine.id,{method,data:{...extra,token:access.token}})).status,409);assert.equal((await policy()).token,access.token);
  }
  access=ok(await http('/api/access-control/ips/'+inactive.id,{method:'PUT',data:{ip:other,description:'활성화',active:true,token:access.token}}));assert.equal((await http('/api/me',{cookie:memberCookie,ip:other})).status,200);
  access=ok(await http('/api/access-control/ips/'+inactive.id,{method:'PUT',data:{ip:other,description:'다시 비활성화',active:false,token:access.token}}));assert.equal((await http('/api/me',{cookie:memberCookie,ip:other})).status,403);
  ok(await http('/api/access-control/ips/'+ipv6.id,{method:'DELETE',data:{token:access.token}}));assert.equal((await http('/api/documents',{ip:'2001:db8::1'})).status,403);
 });
 await t.test('동시 설정 변경 보호·재배포 계정 점검 시 제한 유지·모든 IP 허용 복원',async()=>{
  const access=await policy();
  const results=await Promise.all(['203.0.113.40','203.0.113.41'].map(ip=>http('/api/access-control/ips',{method:'POST',data:{ip,token:access.token}})));assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
  await prepareAdministrator(query,password);ok(await http('/api/health',{ip:other}));assert.equal((await policy()).mode,'allowlist');assert.equal((await http('/',{ip:other})).status,403);
  ok(await changeMode('all'));assert.equal((await http('/',{ip:other,cookie:''})).status,200);assert.equal((await http('/api/me',{cookie:memberCookie,ip:other})).status,200);
  const fresh=await policy();ok(await http('/api/access-control/ips/'+mine.id,{method:'DELETE',data:{token:fresh.token}}));assert.equal((await policy()).mode,'all');
 });
 await t.test('수동 오설정으로 허용 목록이 비면 모든 비공개 경로는 차단',async()=>{
  await database.prepare("UPDATE access_settings SET mode='allowlist' WHERE id=1").run();await database.prepare('DELETE FROM allowed_ips').run();
  assert.equal((await http('/')).status,403);assert.equal((await http('/api/login',{method:'POST',data:{username:'admin',password}})).status,403);assert.equal((await http('/api/files/access-file')).status,403);
  assert.equal((await http('/api/health')).status,200);assert.equal((await database.prepare('SELECT count(*) n FROM documents').first()).n,1);
 });
});

test('배포 전 관리자 생성·미사용 초기 비밀번호 복구·로그인 및 수정한 비밀번호 보존·동시 변경 보호',async t=>{
 const previousHash=passwordHash('old-runtime-secret-password');
 const fixture=new Miniflare({modules:true,scriptPath:'src/worker.js',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['FILES'],bindings:{ADMIN_PASSWORD_HASH:previousHash},serviceBindings:{ASSETS:()=>new Response('ok')}});
 t.after(()=>fixture.dispose());const database=await fixture.getD1Database('DB');
 for(const name of ['0001_initial.sql','0002_document_pairs.sql','0003_flat_work_categories.sql','0004_document_types_and_users.sql','0005_clear_login_lockouts.sql','0006_revision_date_order.sql','0007_access_control_requirement.sql'])await migrate(name,database);
 const query=async(sql,params=[])=>{const result=await database.prepare(sql).bind(...params).all();return result.results;};
 const root=()=>database.prepare('SELECT * FROM users WHERE is_admin=1').first();
 assert.equal((await prepareAdministrator(query,password)).status,'created');
 let user=await root();const originalId=user.id;assert.equal(inspectAdministrator(user,password).matches_deployment_password,true);
 assert.equal((await prepareAdministrator(query,password)).status,'unchanged');
 // Reproduce importing a stale runtime secret into the untouched initial user.
 await database.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(previousHash,user.id).run();
 user=await root();assert.equal(inspectAdministrator(user,password).matches_deployment_password,false);assert.equal(user.last_login_at,null);assert.equal(user.created_at,user.updated_at);
 assert.equal((await prepareAdministrator(query,password)).status,'repaired_initial_password');
 user=await root();assert.equal(user.id,originalId);assert.equal(inspectAdministrator(user,password).matches_deployment_password,true);assert.notEqual(user.created_at,user.updated_at);
 await fixture.dispatchFetch(origin+'/api/health');assert.equal((await root()).password_hash,user.password_hash);
 const login=await fixture.dispatchFetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password})});assert.equal(login.status,200);
 const signedIn=await root();assert.ok(signedIn.last_login_at);
 assert.equal((await prepareAdministrator(query,'different-deployment-password')).status,'unchanged');assert.equal((await root()).password_hash,signedIn.password_hash);
 // Explicit account edits are also preserved without relying on login history.
 const manuallyChanged=passwordHash('changed-before-login-password');
 await database.prepare('UPDATE users SET password_hash=?,last_login_at=NULL,updated_at=? WHERE id=?').bind(manuallyChanged,'2026-10-20T00:00:00Z',originalId).run();
 assert.equal((await prepareAdministrator(query,password)).status,'unchanged');assert.equal((await root()).password_hash,manuallyChanged);
 // A login or edit racing recovery invalidates its optimistic token.
 await database.prepare('UPDATE users SET password_hash=?,last_login_at=NULL,updated_at=created_at WHERE id=?').bind(previousHash,originalId).run();
 let raced=false;
 const racingQuery=async(sql,params)=>{if(sql.startsWith('UPDATE users SET password_hash=')){raced=true;await database.prepare("UPDATE users SET token='concurrent-account-edit',password_hash=? WHERE id=?").bind(manuallyChanged,originalId).run();}return query(sql,params);};
 assert.equal((await prepareAdministrator(racingQuery,password)).status,'unchanged');assert.equal(raced,true);assert.equal((await root()).password_hash,manuallyChanged);
 assert.equal((await database.prepare('SELECT count(*) n FROM users').first()).n,1);
});

test('등록 화면 순서·첫 업무구분 기본값·명칭·연월 검색 화면·표 제목 글자 크기',async()=>{
 const handlers=new Map(),elements=new Map();
 const element=()=>({innerHTML:'',textContent:'',value:'',required:false,disabled:false,addEventListener(){},showModal(){},focus(){this.focused=true;},classList:{add(){},remove(){},toggle(){}}});
 for(const id of ['#app','#editor-dialog','#category-dialog','#confirm-dialog','#editor-org','#editor-category','#reference-query','#reference-options','#file-count','#editor-file-list','#selected-relations','#relation-count','#toast','#search-year'])elements.set(id,element());
 elements.get('#editor-org').value='kwwa';elements.get('#editor-category').value='first-work';
 const document={querySelector:id=>elements.get(id),querySelectorAll:()=>[],addEventListener:(name,fn)=>handlers.set(name,fn),body:{classList:{add(){},remove(){}}}};
 const source=await readFile('public/app.js','utf8');assert.match(source,/\nstart\(\);\s*$/);
 const savedDefaults=new Map(),sessionStorage={getItem:key=>savedDefaults.get(key),setItem:(key,value)=>savedDefaults.set(key,value),removeItem:key=>savedDefaults.delete(key)};
 const app=new Function('document','window','fetch','setTimeout','clearTimeout','sessionStorage',source.replace(/\nstart\(\);\s*$/,'\nreturn {state,openEditor,listView,queryString,resetSearch,documentList,typeIcon,detailView,rememberRegistration,registrationDefaults,resetEntryDefaults};'))(document,{addEventListener(){}},async()=>({ok:true,json:async()=>({documents:[],rows:[]})}),()=>0,()=>{},sessionStorage);
 app.state.bootstrap={categories:[{id:'first-work',name:'첫 업무',sort_order:0},{id:'other-work',name:'다른 업무',sort_order:1}],stats:{}};
 app.state.category='other-work';app.state.loading=false;app.openEditor('new');
 let html=elements.get('#editor-dialog').innerHTML;
 const selected=(html,id)=>html.match(new RegExp('<select[^>]*id="'+id+'"[^>]*>([\\s\\S]*?)</select>'))?.[1]||'';
 assert.ok(html.indexOf('id="editor-category"')<html.indexOf('id="editor-org"'));
 assert.ok(html.indexOf('id="editor-org"')<html.indexOf('id="editor-document-type"'));
 assert.ok(html.indexOf('id="editor-document-type"')<html.indexOf('id="editor-requirement"'));
 assert.match(selected(html,'editor-requirement'),/<option value="권장" selected>/);
 assert.deepEqual([...selected(html,'editor-requirement').matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]),['권장','필수']);
 assert.deepEqual([...selected(html,'editor-document-type').matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]),['지침','매뉴얼','가이드라인','기타']);
 assert.match(selected(html,'editor-document-type'),/<option value="지침" selected>/);
 assert.match(selected(html,'editor-category'),/<option value="first-work" selected>/);
 assert.doesNotMatch(selected(html,'editor-category'),/업무구분 선택/);
 assert.ok(elements.get('#editor-category').focused);
 assert.ok(html.includes('참조 문서번호'));assert.ok(html.includes('<span>설명'));assert.doesNotMatch(html,/참조 결재번호|주요내용/);
 app.state.user={id:'user-one'};app.rememberRegistration({category_id:'other-work',organization_id:'upper',document_type:'가이드라인',requirement:'필수'});app.openEditor('new');html=elements.get('#editor-dialog').innerHTML;
 for(const [id,value] of [['editor-category','other-work'],['editor-org','upper'],['editor-document-type','가이드라인'],['editor-requirement','필수']])assert.ok(selected(html,id).includes('<option value="'+value+'" selected>'));
 // A reload retains defaults for the current signed-in account in this tab.
 app.state.entryOwner=null;app.state.entryDefaults=null;app.openEditor('new');assert.ok(selected(elements.get('#editor-dialog').innerHTML,'editor-category').includes('value="other-work" selected'));
 const categoryList=app.state.bootstrap.categories;app.state.bootstrap.categories=categoryList.slice(0,1);app.openEditor('new');assert.ok(selected(elements.get('#editor-dialog').innerHTML,'editor-category').includes('value="first-work" selected'));app.state.bootstrap.categories=categoryList;
 // Another account and a new sign-in cannot inherit the previous entry.
 app.state.user={id:'user-two'};app.openEditor('new');assert.ok(selected(elements.get('#editor-dialog').innerHTML,'editor-org').includes('value="kwwa" selected'));
 app.state.user={id:'user-one'};app.resetEntryDefaults();app.openEditor('new');html=elements.get('#editor-dialog').innerHTML;
 for(const [id,value] of [['editor-category','first-work'],['editor-org','kwwa'],['editor-document-type','지침'],['editor-requirement','권장']])assert.ok(selected(html,id).includes('<option value="'+value+'" selected>'));

 const revision={id:'existing-revision',sequence:1,title:'기존 문서',revision_date:'2026-01-30',manager:'담당',approval_no:'문서1',summary:'설명',token:'token',attachments:[]};
 app.state.detail={document:{id:'existing-document',organization_id:'upper',category_id:'other-work',document_type:'매뉴얼',requirement:'필수'},revisions:[revision],related_document_id:null};
 app.openEditor('append',null,'existing-document');html=elements.get('#editor-dialog').innerHTML;
 assert.match(selected(html,'editor-category'),/<option value="other-work" selected>/);
 assert.match(selected(html,'editor-org'),/<option value="upper" selected>/);
 assert.match(selected(html,'editor-document-type'),/<option value="매뉴얼" selected>/);
 assert.match(selected(html,'editor-requirement'),/<option value="필수" selected>/);
 app.openEditor('edit','existing-revision','existing-document');assert.match(selected(elements.get('#editor-dialog').innerHTML,'editor-category'),/<option value="other-work" selected>/);
 assert.match(selected(elements.get('#editor-dialog').innerHTML,'editor-document-type'),/<option value="매뉴얼" selected>/);
 assert.match(selected(elements.get('#editor-dialog').innerHTML,'editor-requirement'),/<option value="필수" selected>/);
 const icons=['지침','매뉴얼','가이드라인','기타'].map(type=>app.typeIcon(type));assert.equal(new Set(icons.map(html=>html.match(/<path d="([^"]+)/)[1])).size,4);
 for(const [index,type] of ['지침','매뉴얼','가이드라인','기타'].entries())assert.ok(icons[index].includes('aria-label="문서종류: '+type+'"'));
 app.state.category='';app.state.rows=[['other','기타','2099-01-01'],['old','매뉴얼','2020-01-01'],['new','매뉴얼','2026-01-01'],['first','지침','2010-01-01']].map(([id,document_type,revision_date])=>({category_id:'first-work',kwwa:{id,title:id,document_type,revision_date},upper:null}));
 html=app.documentList();assert.deepEqual([...html.matchAll(/data-action="open" data-id="([^"]+)"/g)].map(m=>m[1]),['first','new','old','other']);
 assert.ok(html.indexOf('document-type-icon')<html.indexOf('paired-document-name'));assert.ok(html.includes('다른 업무'));
 const history=(id,document_type)=>({document:{id,organization_id:id,category_id:'first-work',document_type},revisions:[
  {...revision,id:id+'-new',title:'최신 <문서>',sequence:1,display_sequence:3,revision_date:'2030-01-01'},
  {...revision,id:id+'-middle',title:'중간 문서',sequence:3,display_sequence:2,revision_date:'2025-01-01'},
  {...revision,id:id+'-old',title:'과거 문서',sequence:2,display_sequence:1,revision_date:'2020-01-01'}
 ],related_document_id:id==='kwwa'?'upper':'kwwa'});
 const kwwa=history('kwwa','매뉴얼'),upper=history('upper','가이드라인');app.state.detail={...kwwa,columns:{kwwa,upper}};
 html=app.detailView();assert.doesNotMatch(html,/class="badge (?:revised|enacted)"/);assert.equal((html.match(/class="revision-top"><div><time class="revision-date"/g)||[]).length,6);
 assert.equal((html.match(/class="badge latest"/g)||[]).length,2);assert.equal((html.match(/aria-label="문서종류: 매뉴얼"/g)||[]).length,4);assert.equal((html.match(/aria-label="문서종류: 가이드라인"/g)||[]).length,4);
 assert.equal((html.match(/<h4 class="revision-title"><span class="document-type-icon/g)||[]).length,6);assert.ok(html.includes('최신 &lt;문서&gt;'));assert.equal((html.match(/<time class="revision-date"/g)||[]).length,6);
 app.state.search={title:'',manager:'',year:'2026',month:'2'};html=app.listView();
 assert.match(html,/<input[^>]*name="year"[^>]*value="2026"/);assert.match(html,/<option value="2" selected>2월/);
 assert.doesNotMatch(html,/name="from"|name="to"|검색 시작일|검색 종료일/);
 const params=new URLSearchParams(app.queryString());assert.equal(params.get('year'),'2026');assert.equal(params.get('month'),'2');assert.equal(params.has('from'),false);
 handlers.get('change')({target:{id:'search-month',value:'2',dataset:{}}});assert.equal(elements.get('#search-year').required,true);
 handlers.get('change')({target:{id:'search-month',value:'',dataset:{}}});assert.equal(elements.get('#search-year').required,false);
 await app.resetSearch();assert.deepEqual(app.state.search,{title:'',manager:'',year:'',month:''});
 const css=await readFile('public/styles.css','utf8'),rule=selector=>css.slice(css.indexOf(selector+'{')+selector.length+1).split('}')[0];
 const font=body=>body.match(/font-size:([^;]+)/)?.[1],headerFont=font(rule('.paired-document-table thead th'));
 assert.ok(headerFont);assert.equal(font(rule('.paired-document-table thead tr:last-child th'))||headerFont,headerFont);
 const primaryColor=css.match(/button\.primary,\.primary\{background:([^;]+)/)?.[1];assert.ok(primaryColor);assert.equal(rule('.revision-top .revision-date').match(/color:([^;]+)/)?.[1],primaryColor);
 await new Promise(setImmediate);
});

test('사용자 관리 화면의 관리자·일반 사용자 구분·브랜드·개인 계정 동선·비밀번호 변경 흐름',async()=>{
 const elements=new Map(),requests=[],handlers=new Map();
 const element=()=>({innerHTML:'',textContent:'',disabled:false,addEventListener(){},showModal(){},close(){},classList:{add(){},remove(){},toggle(){}}});
 for(const id of ['#app','#editor-dialog','#category-dialog','#confirm-dialog','#user-dialog','#toast','#user-error','#save-user'])elements.set(id,element());
 const document={querySelector:id=>elements.get(id),querySelectorAll:()=>[],addEventListener:(type,handler)=>handlers.set(type,handler),body:{classList:{add(){},remove(){}}}};
 const admin={id:'root',login_id:'admin',name:'관리자',active:true,is_admin:true,last_login_at:'2026-10-19T01:02:03.000Z',token:'root-token'};
 const member={id:'member',login_id:'user-id',name:'<img src=x onerror=alert(1)>',active:false,is_admin:false,last_login_at:null,token:'member-token'};
 let own=admin,fail=false,ipDenied=false;
 const base=()=>({categories:[],stats:{},user:own});
 const fetch=async(path,init)=>{requests.push({path,...init});return {ok:!fail&&!ipDenied,status:ipDenied?403:fail?401:200,json:async()=>ipDenied?{error:'허용되지 않은 IP',code:'IP_ACCESS_DENIED',client_ip:'203.0.113.99'}:fail?{error:'로그인 만료'}:path==='/api/me'?{user:own}:path==='/api/users'?{users:[admin,member]}:path==='/api/bootstrap'?base():path.startsWith('/api/documents?')?{rows:[],documents:[]}:{ok:true}};};
 const source=await readFile('public/app.js','utf8'),location={hash:'#users'};
 const app=new Function('document','window','fetch','setTimeout','clearTimeout','location','FormData',source.replace(/\nstart\(\);\s*$/,'\nreturn {state,loadUserList,usersView,openUserEditor,openPasswordEditor,sidebar,saveUser,saveOwnPassword,api,handleRoute,renderLogin};'))(document,{addEventListener(){}},fetch,()=>0,()=>{},location,function(form){return Object.entries(form);});
 app.state.bootstrap=base();app.state.user=admin;app.state.authenticated=true;app.state.view='users';
 await app.loadUserList();assert.deepEqual(requests.map(r=>r.path),['/api/me','/api/users']);
 let html=app.usersView();assert.ok(html.includes('admin'));assert.ok(html.includes('user-id'));assert.equal((html.match(/비밀번호 마스킹/g)||[]).length,2);
 assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));assert.ok(!html.includes('<img src=x'));assert.match(html,/data-action="add-user"/);assert.match(html,/data-action="edit-user"/);assert.match(html,/data-action="delete-user" data-id="root" disabled/);
 for(const label of ['ID','비밀번호','이름','마지막 로그인 일시','활성화 여부'])assert.ok(html.includes('>'+label+'</th>'));
 assert.match(app.sidebar(),/<div class="sidebar-footer"><button[^>]*data-action="users"/);
 html=app.sidebar();assert.ok(html.includes('<strong>안전정보팀</strong>'));assert.ok(html.indexOf('data-action="users"')<html.indexOf('data-action="access"'));
 app.renderLogin();assert.ok(elements.get('#app').innerHTML.includes('alt="">안전정보팀</div>'));
 app.openUserEditor('member');html=elements.get('#user-dialog').innerHTML;
 for(const field of ['login_id','password','name','last_login_at','active'])assert.ok(html.includes('name="'+field+'"'));
 assert.doesNotMatch(html,/<input name="password"[^>]*value=/);assert.ok(html.includes('비워두면 현재 비밀번호를 유지합니다.'));
 app.openUserEditor();await app.saveUser({login_id:'new-user',password:'new-user-password',name:'새 사용자',active:'1',last_login_at:'2026-10-19T10:20'});
 const saved=JSON.parse(requests.find(r=>r.path==='/api/users'&&r.method==='POST').body);assert.equal(saved.active,true);assert.equal(saved.last_login_at,'2026-10-19T01:20:00.000Z');
 own={...member,active:true};app.state.user=own;app.state.users=[admin,own];requests.length=0;
 html=app.usersView();assert.ok(html.includes('user-id'));assert.doesNotMatch(html,/>admin</);assert.doesNotMatch(html,/data-action="(?:add-user|edit-user|delete-user)"/);assert.match(html,/data-action="change-password"/);
 assert.match(html,/<td><div class="account-status-actions"><span class="user-status enabled">활성화<\/span><button[^>]*data-action="change-password"/);
 assert.doesNotMatch(html.split('<section class="document-panel">')[0],/data-action="change-password"/);
 html=app.sidebar();assert.doesNotMatch(html,/data-action="(?:users|access)"/);assert.match(html,/class="profile-account" data-action="my-account"/);
 await app.loadUserList();assert.deepEqual(requests.map(r=>r.path),['/api/me']);assert.equal(app.state.users.length,1);
 await handlers.get('click')({target:{closest:()=>({dataset:{action:'my-account'}})},preventDefault(){}});assert.equal(location.hash,'#account');
 await app.handleRoute();assert.equal(app.state.view,'account');assert.ok(elements.get('#app').innerHTML.includes('비밀번호 변경'));
 app.openPasswordEditor();html=elements.get('#user-dialog').innerHTML;
 for(const field of ['current_password','new_password','confirm_password'])assert.ok(html.includes('name="'+field+'"'));
 assert.doesNotMatch(html,/name="(?:login_id|name|active)"/);
 const previous=html;app.openUserEditor('member');assert.equal(elements.get('#user-dialog').innerHTML,previous);
 requests.length=0;await app.saveOwnPassword({current_password:'old-password',new_password:'new-password-123',confirm_password:'mismatch'});assert.equal(requests.length,0);
 await app.saveOwnPassword({current_password:'old-password',new_password:'new-password-123',confirm_password:'new-password-123'});
 assert.equal(requests[0].path,'/api/me/password');assert.equal(requests[0].method,'PUT');assert.equal(JSON.parse(requests[0].body).new_password,'new-password-123');
 assert.equal(app.state.authenticated,false);assert.deepEqual(app.state.users,[]);assert.equal(location.hash,'');assert.ok(elements.get('#app').innerHTML.includes('새 비밀번호로 다시 로그인'));
 app.state.authenticated=true;app.state.user=admin;app.state.users=[admin,member];app.state.bootstrap.user=admin;fail=true;
 await assert.rejects(app.api('/api/me'),/로그인 만료/);assert.equal(app.state.user,null);assert.equal(app.state.bootstrap.user,null);assert.deepEqual(app.state.users,[]);
 fail=false;ipDenied=true;app.state.authenticated=true;app.state.documents=[{title:'비공개 문서'}];app.state.detail={private:true};app.state.access={ips:['private']};
 await assert.rejects(app.api('/api/documents'),/허용되지 않은 IP/);assert.equal(app.state.authenticated,false);assert.deepEqual(app.state.documents,[]);assert.equal(app.state.detail,null);assert.equal(app.state.access,null);assert.ok(elements.get('#app').innerHTML.includes('data-ip-access-denied'));assert.ok(elements.get('#app').innerHTML.includes('203.0.113.99'));assert.ok(!elements.get('#app').innerHTML.includes('비공개 문서'));
});

test('접근제어 화면의 기본 옵션·허용 IP 표·등록·수정·삭제·일반 사용자 메뉴 제한',async()=>{
 const elements=new Map(),handlers=new Map(),requests=[];
 const element=()=>({innerHTML:'',textContent:'',disabled:false,addEventListener(){},showModal(){},close(){},classList:{add(){},remove(){},toggle(){}}});
 for(const id of ['#app','#editor-dialog','#category-dialog','#confirm-dialog','#user-dialog','#access-dialog','#toast','#access-ip-error','#save-access-ip'])elements.set(id,element());
 const document={querySelector:id=>elements.get(id),querySelectorAll:()=>[],addEventListener:(type,handler)=>handlers.set(type,handler),body:{classList:{add(){},remove(){}}}};
 const user={id:'root',login_id:'admin',name:'관리자',active:true,is_admin:true};let revision=0,access={mode:'all',token:'version-0',client_ip:'203.0.113.10',ips:[]};
 const fetch=async(path,init)=>{
  requests.push({path,...init});const data=init.body?JSON.parse(init.body):{};
  if(init.method==='PUT'&&path==='/api/access-control')access.mode=data.mode;
  else if(init.method==='POST')access.ips.push({id:'ip-'+(++revision),ip:data.ip,description:data.description,active:data.active});
  else if(init.method==='PUT'){const rule=access.ips.find(rule=>path.endsWith('/'+rule.id));Object.assign(rule,data);}
  else if(init.method==='DELETE')access.ips=access.ips.filter(rule=>!path.endsWith('/'+rule.id));
  access.token='version-'+(++revision);return {ok:true,json:async()=>structuredClone(access)};
 };
 const source=await readFile('public/app.js','utf8');
 const app=new Function('document','window','fetch','setTimeout','clearTimeout','location','FormData',source.replace(/\nstart\(\);\s*$/,'\nreturn {state,accessView,openAccessEditor,saveAccessIp,saveAccessMode,removeAccessIp};'))(document,{addEventListener(){}},fetch,()=>0,()=>{},{hash:'#access'},function(form){const entries=Object.entries(form);entries.get=name=>form[name];return entries;});
 app.state.user=user;app.state.bootstrap={categories:[],stats:{},user};app.state.authenticated=true;app.state.view='access';app.state.access=structuredClone(access);
 let html=app.accessView();assert.match(html,/value="all" checked/);assert.match(html,/value="allowlist" /);assert.ok(html.includes('등록된 IP가 없습니다.'));assert.ok(html.includes('현재 접속 IP'));
 app.openAccessEditor(undefined,true);html=elements.get('#access-dialog').innerHTML;assert.ok(html.includes('value="203.0.113.10"'));
 for(const name of ['ip','description','active'])assert.ok(html.includes('name="'+name+'"'));
 await app.saveAccessIp({ip:'203.0.113.10',description:'사무실 <주소>',active:'1'});assert.equal(JSON.parse(requests[0].body).active,true);assert.equal(JSON.parse(requests[0].body).token,'version-0');
 html=app.accessView();assert.ok(html.includes('사무실 &lt;주소&gt;'));assert.ok(html.includes('활성화'));assert.ok(html.includes('data-action="edit-ip"'));assert.ok(html.includes('data-action="delete-ip"'));
 await app.saveAccessMode({mode:'allowlist'});assert.equal(requests.at(-1).path,'/api/access-control');assert.equal(app.state.access.mode,'allowlist');assert.match(app.accessView(),/value="allowlist" checked/);
 const rule=app.state.access.ips[0];app.openAccessEditor(rule.id);await app.saveAccessIp({ip:'203.0.113.11',description:'수정된 주소',active:'0'});assert.equal(JSON.parse(requests.at(-1).body).active,false);assert.equal(requests.at(-1).method,'PUT');
 const removal=app.removeAccessIp(rule.id);await handlers.get('click')({target:{closest:()=>({dataset:{action:'confirm-yes'}})},preventDefault(){}});await removal;assert.equal(requests.at(-1).method,'DELETE');assert.equal(app.state.access.ips.length,0);
 app.state.user={...user,is_admin:false};assert.equal(app.accessView(),'');const count=requests.length;app.openAccessEditor();await app.saveAccessMode({mode:'all'});assert.equal(requests.length,count);
});
