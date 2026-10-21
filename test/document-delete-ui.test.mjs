import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('양쪽 기관의 이력 삭제는 날짜가 있는 확인창을 거쳐 취소·삭제·마지막 이력 정리를 처리',async t=>{
 const source=await readFile('public/app.js','utf8');
 for(const organization of ['kwwa','upper'])for(const last of [false,true]){
  await t.test(`${organization}: ${last?'마지막 이력과 문서 삭제':'과거 이력만 삭제'}`,async()=>{
   const elements=new Map(),handlers=new Map(),requests=[];
   const element=()=>({innerHTML:'',textContent:'',open:false,addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},classList:{add(){},remove(){},toggle(){}}});
   for(const id of ['#app','#editor-dialog','#category-dialog','#confirm-dialog','#toast'])elements.set(id,element());
   const document={querySelector:id=>elements.get(id),querySelectorAll:()=>[],addEventListener:(type,handler)=>handlers.set(type,handler),body:{classList:{add(){},remove(){}}}};
   const location={hash:'#document=kwwa'},revision=(id,date)=>({id,title:'안전 <지침>',revision_date:date,sequence:3,display_sequence:1,token:'token-'+id,attachments:[{id:'file-'+id,name:'첨부.pdf',size:3}],summary:'',manager:'담당',approval_no:''});
   const bundle=id=>({document:{id,organization_id:id,category_id:'work',document_type:'지침'},revisions:[revision(id+'-latest','2026-10-21'),revision(id+'-old','2020-01-01')],related_document_id:id==='kwwa'?'upper':'kwwa'});
   const left=bundle('kwwa'),right=bundle('upper'),target=organization==='kwwa'?left:right;
   if(last)target.revisions=target.revisions.slice(1);
   const selected=target.revisions.at(-1),before={...left,columns:{kwwa:left,upper:right}};
   const afterLeft={...left,revisions:left.revisions.filter(r=>r.id!==selected.id),related_document_id:last&&organization==='upper'?null:'upper'};
   const afterRight={...right,revisions:right.revisions.filter(r=>r.id!==selected.id)};
   const after={...afterLeft,columns:{kwwa:afterLeft,upper:last&&organization==='upper'?null:afterRight}};
   const base={user:{id:'user',name:'사용자',login_id:'member',is_admin:false},categories:[{id:'work',name:'개인정보'}],organizations:['kwwa','upper'].map(id=>({id,document_count:last&&id===organization?0:1})),category_document_counts:['kwwa','upper'].filter(id=>!(last&&id===organization)).map(id=>({category_id:'work',organization_id:id,document_count:1})),stats:{}};
   const fetch=async(path,options={})=>{
    requests.push({path,options});
    if(options.method==='DELETE'){assert.equal(path,'/api/revisions/'+selected.id);assert.deepEqual(JSON.parse(options.body),{token:selected.token});return Response.json({ok:true,document_id:organization,document_deleted:last});}
    if(path==='/api/bootstrap')return Response.json(base);
    if(path.startsWith('/api/documents?'))return Response.json({documents:[],rows:[]});
    if(path==='/api/documents/kwwa')return Response.json(after);
    throw Error('Unexpected request: '+path);
   };
   const app=new Function('document','window','fetch','setTimeout','clearTimeout','location',source.replace(/\nstart\(\);\s*$/,'\nreturn {state};'))(document,{addEventListener(){},scrollTo(){}},fetch,()=>0,()=>{},location);
   app.state.authenticated=true;app.state.loading=false;app.state.user=base.user;app.state.bootstrap=base;app.state.category='work';app.state.view='detail';app.state.detail=before;
   const click=(action,extra={})=>handlers.get('click')({target:{closest:()=>({dataset:{action,...extra}})},preventDefault(){}});
   const cancel=click('delete-revision',{id:selected.id,documentId:organization});
   const dialog=elements.get('#confirm-dialog');assert.equal(dialog.open,true);assert.ok(dialog.innerHTML.includes('안전 &lt;지침&gt; · 2020.1.1.'));assert.ok(dialog.innerHTML.includes('첨부파일 1개'));
   assert.equal(requests.length,0);await click('confirm-no');await cancel;assert.equal(dialog.open,false);assert.equal(requests.length,0);
   const deletion=click('delete-revision',{id:selected.id,documentId:organization});assert.equal(dialog.open,true);
   assert.equal(dialog.innerHTML.includes('마지막 이력이므로'),last);await click('confirm-yes');await deletion;
   assert.equal(requests.filter(r=>r.options.method==='DELETE').length,1);assert.equal(dialog.open,false);assert.equal(elements.get('#toast').textContent,'이력을 삭제했습니다.');
   assert.deepEqual(app.state.bootstrap.category_document_counts,base.category_document_counts);
   if(last&&organization==='kwwa')assert.equal(location.hash,'#document=upper');
   else{assert.equal(app.state.detail.columns[organization]?.revisions.some(r=>r.id===selected.id)||false,false);assert.ok(requests.some(r=>r.path==='/api/documents/kwwa'));}
  });
 }
});
