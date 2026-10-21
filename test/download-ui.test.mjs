import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as archiveTools from '../public/archive.mjs';
test('검색·다운로드 영역 분리·선택 범위·전체 문서 건수·연결 표시와 엑셀 다운로드 동선',async()=>{
 const elements=new Map(),handlers=new Map(),requests=[],downloads=[];
 const element=()=>({innerHTML:'',textContent:'',disabled:false,addEventListener(){},classList:{add(){},remove(){},toggle(){}}});
 for(const id of ['#app','#editor-dialog','#category-dialog','#confirm-dialog','#toast'])elements.set(id,element());
 const document={querySelector:id=>elements.get(id),querySelectorAll:()=>[],addEventListener:(type,handler)=>handlers.set(type,handler),createElement:()=>({click(){downloads.push(this.href);},remove(){}}),body:{appendChild(){},classList:{add(){},remove(){}}}};
 const fetch=async(path,options)=>{requests.push({path,options});return {ok:true,status:200,json:async()=>({document_count:1,attachment_count:2})};};
 const source=await readFile('public/app.js','utf8'),app=new Function('document','window','fetch','setTimeout','clearTimeout',source.replace(/\nstart\(\);\s*$/,'\nreturn {state,listView,documentList,downloadPanel,exportIds,downloadExport,renderLogin};'))(document,{addEventListener(){}},fetch,()=>0,()=>{});
 app.state.bootstrap={user:{id:'admin',name:'관리자',login_id:'admin',is_admin:true},organizations:[{id:'kwwa',document_count:12},{id:'upper',document_count:7}],categories:[{id:'a',name:'개인정보'},{id:'b',name:'정보보안'}],category_document_counts:[{category_id:'a',organization_id:'kwwa',document_count:9},{category_id:'a',organization_id:'upper',document_count:3},{category_id:'b',organization_id:'kwwa',document_count:3},{category_id:'b',organization_id:'upper',document_count:4}],stats:{}};app.state.authenticated=true;app.state.loading=false;app.state.searchOpen=true;
 app.state.rows=[{category_id:'a',kwwa:{id:'left',title:'협회 지침',revision_date:'2026-10-21',document_type:'지침'},upper:{id:'right',title:'상위 지침',revision_date:'2026-01-01',document_type:'지침'}},{category_id:'b',kwwa:{id:'alone',title:'단독 문서',revision_date:'2026-02-01',document_type:'기타'},upper:null}];
 let html=app.listView();assert.ok(html.includes('문서검색 및 다운로드'));assert.ok(html.includes('search-download-grid'));assert.ok(html.includes('class="search-panel"'));assert.ok(html.includes('class="download-panel"'));assert.ok(html.includes('한국상하수도협회 (12건)'));assert.ok(html.includes('상위기관 (7건)'));
 assert.equal((html.match(/class="pair-connector"/g)||[]).length,1);assert.equal((html.match(/aria-label="연관문서 연결"/g)||[]).length,1);
 assert.ok(!html.includes('전체 선택'));assert.ok(!html.includes('data-export-all'));assert.equal((html.match(/data-export-kind=/g)||[]).length,4);assert.equal((html.match(/type="radio" name="attachment_versions"/g)||[]).length,2);assert.ok(html.includes('value="latest" checked'));assert.ok(html.includes('최신본만'));assert.ok(html.includes('이전버전까지 포함'));
 assert.ok(html.includes('<tbody class="category-group category-tone-0">'));assert.ok(html.includes('<tbody class="category-group category-tone-1">'));
 assert.deepEqual(app.exportIds('organizations'),['kwwa','upper']);assert.deepEqual(app.exportIds('categories'),['a','b']);
 const change=target=>handlers.get('change')({target:{dataset:{},...target}});
 change({hasAttribute:name=>name==='data-export-versions',value:'all',checked:true});assert.equal(app.state.exportVersions,'all');assert.ok(elements.get('#app').innerHTML.includes('value="all" checked'));
 app.state.search={title:'적용된 검색',manager:'',year:'2026',month:''};app.state.searchDraft={title:'아직 입력 중인 검색',manager:'새 담당',year:'2025',month:'2'};
 change({dataset:{exportKind:'organizations'},value:'kwwa',checked:false});change({dataset:{exportKind:'categories'},value:'a',checked:false});
 assert.deepEqual(app.exportIds('organizations'),['upper']);assert.deepEqual(app.exportIds('categories'),['b']);html=elements.get('#app').innerHTML;assert.ok(html.includes('value="아직 입력 중인 검색"'));assert.equal(app.state.search.title,'적용된 검색');
 await app.downloadExport('excel');assert.equal(requests.length,1);assert.equal(downloads.length,1);let url=new URL(downloads[0],'https://example.test');assert.equal(url.pathname,'/api/exports/excel');assert.deepEqual(url.searchParams.getAll('organization'),['upper']);assert.deepEqual(url.searchParams.getAll('category'),['b']);assert.equal(url.searchParams.has('title'),false);assert.equal(url.searchParams.has('year'),false);assert.equal(url.searchParams.has('versions'),false);
 change({dataset:{exportKind:'categories'},value:'b',checked:false});await app.downloadExport('excel');assert.equal(requests.length,1);assert.equal(downloads.length,1);assert.match(app.state.exportError,/한 개 이상/);
 change({dataset:{exportKind:'categories'},value:'a',checked:true});change({dataset:{exportKind:'categories'},value:'b',checked:true});assert.deepEqual(app.exportIds('categories'),['a','b']);app.state.bootstrap.categories.push({id:'new',name:'새 업무'});assert.deepEqual(app.exportIds('categories'),['a','b']);
 app.state.category='b';app.state.rows=app.state.rows.slice(1);html=app.documentList();assert.ok(html.includes('한국상하수도협회 (3건)'));assert.ok(html.includes('상위기관 (4건)'));assert.ok(!html.includes('class="pair-connector"'));assert.ok(html.includes('<tbody class="category-group category-tone-1">'));assert.ok(!html.includes('category-tone-0'));
 app.state.category='';html=app.documentList();assert.ok(html.includes('한국상하수도협회 (12건)'));assert.ok(html.includes('상위기관 (7건)'));
 app.state.category='new';app.state.rows=[];app.state.search={title:'',manager:'',year:'',month:''};html=app.documentList();assert.ok(html.includes('한국상하수도협회 (0건)'));assert.ok(html.includes('상위기관 (0건)'));
 const css=await readFile('public/styles.css','utf8');assert.ok(css.includes('.sidebar-footer .account-menu{font-size:16.8px}'));assert.ok(css.includes('border-left:1px solid #dce6e2'));assert.ok(css.includes('.pair-connector::before'));assert.ok(css.includes('.download-actions{display:flex;justify-content:flex-end;'));assert.ok(css.includes('.category-group td{background:var(--category-tint)}'));
 app.renderLogin();html=elements.get('#app').innerHTML;assert.ok(html.includes('<h1>안전정보팀 업무관련 기준문서</h1>'));assert.ok(html.includes('<p>지침, 매뉴얼, 가이드라인 등 업무관련 기준문서를 관리합니다.</p>'));
});

test('첨부 ZIP은 브라우저에서 파일을 순서대로 읽어 저장하고 인증 만료·저장 취소 시 중단',async()=>{
 const source=(await readFile('public/app.js','utf8')).replace("import('/archive.mjs')",'Promise.resolve(archiveTools)');
 const manifest={documents:[{id:'doc',title:'문서명'}],files:[{id:'a',document_id:'doc',revision_id:'rev',revision_date:'2026-10-21',name:'첫째.pdf',size:3},{id:'b',document_id:'doc',revision_id:'rev',revision_date:'2026-10-21',name:'둘째.pdf',size:3}]};
 async function run({failSecond=false,cancelPicker=false,versions='latest'}={}){
  const elements=new Map(),events=[],chunks=[];let aborted=0,closed=0;
  const element=()=>({innerHTML:'',textContent:'',addEventListener(){},classList:{add(){},remove(){},toggle(){}}});
  for(const id of ['#app','#editor-dialog','#category-dialog','#confirm-dialog','#toast'])elements.set(id,element());
  const document={querySelector:id=>elements.get(id),querySelectorAll:()=>[],addEventListener(){},body:{classList:{add(){},remove(){}}}};
  const window={addEventListener(){},async showSaveFilePicker(options){events.push('picker');assert.ok(options.suggestedName.endsWith('.zip'));if(cancelPicker)throw new DOMException('cancel','AbortError');return {async createWritable(){events.push('writable');return new WritableStream({write(chunk){chunks.push(Buffer.from(chunk));},close(){closed++;},abort(){aborted++;}});}};}};
  const fetch=async path=>{events.push(path);if(path.startsWith('/api/exports/files?'))return Response.json(manifest);if(path==='/api/files/b'&&failSecond)return Response.json({error:'로그인 만료'},{status:401});return new Response(path.endsWith('/a')?'ONE':'TWO',{headers:{'Content-Type':'application/octet-stream'}});};
  const app=new Function('document','window','fetch','setTimeout','clearTimeout','archiveTools',source.replace(/\nstart\(\);\s*$/,'\nreturn {state,downloadExport};'))(document,window,fetch,()=>0,()=>{},archiveTools);
  app.state.authenticated=true;app.state.user={id:'one',name:'사용자',login_id:'member',is_admin:false};app.state.bootstrap={user:app.state.user,categories:[{id:'a',name:'업무'}],organizations:[],stats:{}};app.state.loading=false;app.state.exportVersions=versions;
  await app.downloadExport('files');return {app,events,chunks,aborted,closed,elements};
 }
 const success=await run();assert.equal(success.events[0],'picker');assert.deepEqual(success.events.filter(p=>p.startsWith('/api/files/')),['/api/files/a','/api/files/b']);assert.equal(success.closed,1);assert.equal(success.aborted,0);assert.equal(success.app.state.exportBusy,false);
 assert.equal(new URL(success.events.find(p=>p.startsWith('/api/exports/files?')),'https://example.test').searchParams.get('versions'),'latest');
 const all=await run({versions:'all'});assert.equal(new URL(all.events.find(p=>p.startsWith('/api/exports/files?')),'https://example.test').searchParams.get('versions'),'all');assert.equal(all.closed,1);
 const zip=Buffer.concat(success.chunks);assert.equal(zip.readUInt32LE(0),0x04034b50);assert.ok(zip.includes(Buffer.from('문서명/2026-10-21/첫째.pdf')));assert.ok(zip.includes(Buffer.from('ONE')));assert.ok(zip.includes(Buffer.from('TWO')));
 const failed=await run({failSecond:true});assert.equal(failed.closed,0);assert.equal(failed.aborted,1);assert.equal(failed.app.state.authenticated,false);assert.ok(failed.elements.get('#app').innerHTML.includes('로그인이 만료'));
 const cancelled=await run({cancelPicker:true});assert.deepEqual(cancelled.events,['picker']);assert.equal(cancelled.app.state.exportBusy,false);assert.equal(cancelled.app.state.exportError,'');
});
