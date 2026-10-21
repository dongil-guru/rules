const paths={file:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h6',folder:'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',building:'M4 22V4l8-2 8 2v18 M1 22h22 M9 22v-5h6v5 M8 7h1 M15 7h1 M8 11h1 M15 11h1',layers:'m12 3 10 6-10 6L2 9z M2 14l10 6 10-6 M2 19l10 6 10-6',history:'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2',search:'m21 21-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',plus:'M12 5v14 M5 12h14',chevron:'m9 5 7 7-7 7',down:'m6 9 6 6 6-6',arrow:'M5 12h14 m-5-5 5 5-5 5',back:'M19 12H5 m7-7-7 7 7 7',clip:'m21 11-8 8a6 6 0 0 1-8-8l9-9a4 4 0 0 1 6 6L10 18a2 2 0 0 1-3-3l9-9',link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',download:'M12 3v12 m-5-5 5 5 5-5 M3 16v5h18v-5',edit:'m16 3 5 5-12 12-6 1 1-6z M14 5l5 5',trash:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',close:'M6 6l12 12 M6 18 18 6',logout:'M9 4H4v16h5 M9 12h12 m-4-4 4 4-4 4',check:'m5 12 4 4L19 6',tree:'M5 3v13h6 M5 8h6 M15 5h6v6h-6z M15 15h6v6h-6z',list:'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M10 2h4l1 3 3 1 3 1v4l-2 2-1 3 1 3-3 2-3-1-3 1-3-2 1-3-1-3-2-2V7l3-1 3-1z',home:'m3 10 9-7 9 7 M5 9v12h14V9 M9 21v-7h6v7',info:'M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',lock:'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',upload:'M12 16V3 m-5 5 5-5 5 5 M3 16v5h18v-5',menu:'M3 6h18 M3 12h18 M3 18h18',refresh:'M20 7a9 9 0 1 0 1 9 M21 2v6h-6'};
const SIDES=[{id:'kwwa',name:'한국상하수도협회'},{id:'upper',name:'상위기관'}];
const DOCUMENT_TYPES=['지침','매뉴얼','가이드라인','기타'];
Object.assign(paths,{book:'M12 5v16 M12 5C8 2 4 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-6-2-10 1',guide:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M16 8l-3 5-5 3 3-5z',other:'M5 3h10l4 4v14H5z M9 12h.01 M12 12h.01 M15 12h.01',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-3.87'});
const icon=(name,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.file}"/></svg>`;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=s=>document.querySelector(s);
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const size=b=>b>=1048576?`${(b/1048576).toFixed(1)} MB`:b>=1024?`${Math.ceil(b/1024)} KB`:`${b} B`;
const state={bootstrap:{organizations:[],categories:[],stats:{}},documents:[],rows:[],detail:null,view:'list',category:'',searchOpen:false,search:{title:'',manager:'',year:'',month:''},error:'',loading:true,categoryTab:'categories',categoryEdit:null,categoryBusy:false,editor:null,user:null,users:[],usersLoading:false,usersError:'',userEditor:null,authenticated:false,clientIp:'',access:null,accessLoading:false,accessError:'',accessBusy:false,accessEditor:null,accessDenied:false,entryDefaults:null,entryOwner:null,exportSelection:{organizations:null,categories:null},exportBusy:false,exportError:'',searchDraft:null};
const currentUser=()=>state.user||state.bootstrap.user||{is_admin:false,name:'사용자',login_id:''};
const typeIcon=type=>{const name=DOCUMENT_TYPES.includes(type)?type:'지침',index=DOCUMENT_TYPES.indexOf(name);return `<span class="document-type-icon type-${index}" title="${name}" aria-label="문서종류: ${name}">${icon(['file','book','guide','other'][index])}</span>`;};
const dateTime=value=>value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'';
const dateTimeInput=value=>value?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)).replace(' ','T'):'';
let toastTimer, listGeneration=0, detailGeneration=0, refTimer, refsGeneration=0, confirmResolve=null;
const ENTRY_DEFAULTS_KEY='document-hub-entry-defaults';
function resetEntryDefaults(){state.exportAbort?.abort();state.entryDefaults=null;state.entryOwner=null;try{sessionStorage.removeItem(ENTRY_DEFAULTS_KEY);}catch{}}
function registrationDefaults(){
 const owner=currentUser().id||'';
 if(state.entryOwner!==owner){state.entryOwner=owner;state.entryDefaults=null;try{const saved=JSON.parse(sessionStorage.getItem(ENTRY_DEFAULTS_KEY)||'null');if(saved?.owner===owner)state.entryDefaults=saved.values;}catch{}}
 return state.entryDefaults||{};
}
function rememberRegistration(data){
 state.entryOwner=currentUser().id||'';state.entryDefaults=Object.fromEntries(['category_id','organization_id','document_type','requirement'].map(key=>[key,data[key]]));
 try{sessionStorage.setItem(ENTRY_DEFAULTS_KEY,JSON.stringify({owner:state.entryOwner,values:state.entryDefaults}));}catch{}
}
function exportIds(kind){const ids=kind==='organizations'?SIDES.map(o=>o.id):state.bootstrap.categories.map(c=>c.id),selected=state.exportSelection[kind];return selected===null?ids:ids.filter(id=>selected.includes(id));}
function downloadPanel(){
 const groups=[['organizations','기관구분',SIDES],['categories','업무구분',state.bootstrap.categories]];
 return `<section class="download-panel" aria-labelledby="download-panel-heading"><h3 id="download-panel-heading">다운로드</h3><p class="download-help">기관구분과 업무구분을 선택하세요.</p>${groups.map(([kind,title,items])=>{const selected=exportIds(kind);return `<fieldset class="download-options"><legend>${title}</legend><label class="download-check download-check-all"><input type="checkbox" data-export-all="${kind}" ${items.length&&selected.length===items.length?'checked':''} ${!items.length||state.exportBusy?'disabled':''}>전체 선택</label><div class="download-check-list">${items.map(item=>`<label class="download-check"><input type="checkbox" data-export-kind="${kind}" value="${esc(item.id)}" ${selected.includes(item.id)?'checked':''} ${state.exportBusy?'disabled':''}>${esc(item.name)}</label>`).join('')||'<span class="small muted">등록된 업무구분이 없습니다.</span>'}</div></fieldset>`;}).join('')}<div class="download-actions"><button class="btn primary" type="button" data-action="download-excel" ${state.exportBusy?'disabled':''}>${icon('download')}엑셀 다운로드</button><button class="btn" type="button" data-action="download-files" ${state.exportBusy?'disabled':''}>${icon('download')}첨부파일 ZIP</button></div><p class="download-help">엑셀: 문서별 최신 정보 · 첨부파일 ZIP: 전체 이력의 파일</p>${state.exportBusy?`<p class="download-progress" role="status">${esc(state.exportProgress||'다운로드할 자료를 확인하고 있습니다…')}</p>`:''}${state.exportError?`<p class="download-error" role="alert">${esc(state.exportError)}</p>`:''}</section>`;
}
async function downloadExport(format){
 if(state.exportBusy)return;
 const organizations=exportIds('organizations'),categories=exportIds('categories');state.exportError='';
 if(!organizations.length||!categories.length){state.exportError='기관구분과 업무구분을 각각 한 개 이상 선택해 주세요.';render();return;}
 const query=new URLSearchParams({format});organizations.forEach(id=>query.append('organization',id));categories.forEach(id=>query.append('category',id));
 let handle=null,writable=null;const filename='안전정보팀_첨부파일_'+today()+'.zip';
 state.exportBusy=true;state.exportProgress='다운로드할 자료를 확인하고 있습니다…';render();
 try{
  if(format==='files'){
   if(typeof window.showSaveFilePicker==='function')handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'ZIP 압축파일',accept:{'application/zip':['.zip']}}]});
   state.exportAbort=new AbortController();const signal=state.exportAbort.signal;
   const [tools,manifest]=await Promise.all([import('/archive.mjs'),api('/api/exports/files?'+query,{signal})]);let started=0;
   const entries=tools.attachmentEntries(manifest.documents,manifest.files,async file=>{
    state.exportProgress=`첨부파일 ${++started} / ${manifest.files.length}개를 모으고 있습니다…`;render();
    const path='/api/files/'+file.id,response=await fetch(path,{credentials:'same-origin',signal});
    if(!response.ok)await readApiResponse(response,path);return response.body;
   });
   const stream=tools.zipStream(entries);
   if(handle){writable=await handle.createWritable();await stream.pipeTo(writable,{signal});}
   else{const blob=await new Response(stream).blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
   notify('첨부파일 ZIP을 다운로드했습니다.');
  }else{
   await api('/api/exports/check?'+query);
   const link=document.createElement('a');link.href='/api/exports/excel?'+query;link.download='';document.body.appendChild(link);link.click();link.remove();notify('엑셀 다운로드를 시작했습니다.');
  }
 }catch(e){await writable?.abort().catch(()=>{});if(e.name!=='AbortError')state.exportError=e.message;}finally{state.exportAbort=null;state.exportProgress='';state.exportBusy=false;render();}
}
const catPath=id=>state.bootstrap.categories.find(c=>c.id===id)?.name||'';
function notify(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3800);}
async function api(path,options={}){
  const init={credentials:'same-origin',...options};
  if(init.json){init.body=JSON.stringify(init.json);delete init.json;init.headers={'Content-Type':'application/json',...init.headers};}
  let response;try{response=await fetch(path,init);}catch{throw new Error('서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.');}
  return readApiResponse(response,path);
}
async function readApiResponse(response,path){
  const data=await response.json().catch(()=>({error:'서버 응답을 읽지 못했습니다.'}));
  if(data.code==='IP_ACCESS_DENIED'){
    resetEntryDefaults();state.authenticated=false;state.user=null;state.users=[];state.documents=[];state.rows=[];state.detail=null;state.access=null;state.bootstrap={categories:[],stats:{}};state.accessDenied=true;state.clientIp=data.client_ip||'';
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.body.classList.remove('dialog-open');renderAccessDenied(data.error);throw new Error(data.error);
  }
  if(!response.ok){if(response.status===401&&!path.endsWith('/login')){resetEntryDefaults();state.authenticated=false;state.user=null;state.users=[];state.bootstrap.user=null;document.querySelectorAll('dialog[open]').forEach(d=>d.close());renderLogin('로그인이 만료되었습니다. 다시 로그인해 주세요.');}throw new Error(data.error||'처리하지 못했습니다.');}return data;
}
function showError(id,message){const el=$(id);if(el){el.textContent=message;el.classList.toggle('hidden',!message);}}
function queryString(){const q=new URLSearchParams({...state.search});if(state.category)q.set('category',state.category);return q.toString();}
async function reloadAll(){
  const generation=++listGeneration;
  const [base,list]=await Promise.all([api('/api/bootstrap'),api('/api/documents?'+queryString())]);
  if(generation!==listGeneration)return;
  state.bootstrap=base;state.user=base.user||state.user;state.documents=list.documents;state.rows=list.rows||[];state.loading=false;state.error='';
  if(state.authenticated)render();
}
async function refreshList(){state.loading=true;render();try{const generation=++listGeneration;const data=await api('/api/documents?'+queryString());if(generation!==listGeneration)return;state.documents=data.documents;state.rows=data.rows||[];state.error='';}catch(e){state.error=e.message;}finally{state.loading=false;if(state.authenticated)render();}}
function navigate(documentId='',revisionId=''){
  const params=new URLSearchParams();if(documentId)params.set('document',documentId);if(revisionId)params.set('revision',revisionId);
  const hash=params.toString()?'#'+params:'';
  if(location.hash===hash)handleRoute();else location.hash=hash;
}
async function handleRoute(){
  if(!state.authenticated)return;
  const params=new URLSearchParams(location.hash.slice(1)),id=params.get('document'),revision=params.get('revision');
  const generation=++detailGeneration;
  if(params.has('access')){
    if(!currentUser().is_admin){navigate();return;}
    state.view='access';state.detail=null;state.accessLoading=true;state.accessError='';render();
    try{state.access=await api('/api/access-control');}catch(e){state.accessError=e.message;}finally{if(generation===detailGeneration){state.accessLoading=false;render();}}return;
  }
  if(params.has('users')||params.has('account')){state.view=currentUser().is_admin?'users':'account';state.detail=null;state.usersLoading=true;state.usersError='';render();try{await loadUserList();}catch(e){state.usersError=e.message;}finally{if(generation===detailGeneration){state.usersLoading=false;render();}}return;}
  if(!id){state.view='list';state.detail=null;render();return;}
  state.view='detail';state.detail=null;render();
  try{const data=await api('/api/documents/'+encodeURIComponent(id));if(generation!==detailGeneration)return;state.detail=data;state.focusRevision=revision;render();if(revision)requestAnimationFrame(()=>document.getElementById('revision-'+revision)?.scrollIntoView({behavior:'smooth',block:'nearest'}));else window.scrollTo(0,0);}catch(e){if(generation!==detailGeneration)return;state.error=e.message;state.view='list';render();}
}
function renderAccessDenied(message='허용되지 않은 IP입니다. 관리자에게 접근 허용을 요청해 주세요.'){
  $('#app').innerHTML=`<main class="access-denied-page" data-ip-access-denied><section class="access-denied-card"><img src="/favicon.svg" alt=""><p>안전정보팀</p><h1>접근이 제한되었습니다</h1><p>${esc(message)}</p><p>현재 접속 IP: <strong>${esc(state.clientIp||'확인할 수 없음')}</strong></p><a class="btn primary" href="/">다시 확인</a></section></main>`;
}
function renderLogin(message='',configured=true,username='admin'){
  $('#app').innerHTML=`<main class="login-page"><section class="login-art"><div class="login-brand"><img src="/favicon.svg" alt="">안전정보팀</div><div class="login-copy"><h1>업무의 기준을 모으고,<br>변화의 이력을 잇다.</h1><p>기관과 업무별로 정리하는 지침·매뉴얼·가이드라인.<br>최초 제정부터 최신 개정까지 한곳에서 관리하세요.</p><div class="login-preview"><span>${icon('building')}문서 구분</span><span>${icon('folder')}업무구분</span><span>${icon('file')}문서의 제·개정 이력 <small>최신</small></span></div></div><div class="login-bottom">DOCUMENT HUB &nbsp; / &nbsp; YOUR WORK, WELL ORGANIZED</div></section><section class="login-form-side"><div class="login-form-wrapper"><div class="eyebrow">WORKSPACE LOGIN</div><h2>문서함에 오신 것을 환영합니다</h2><p>로그인하여 업무 문서를 확인하고 관리하세요.</p><div id="login-error" class="error-box ${message?'':'hidden'}" role="alert">${esc(message)}</div>${configured?`<form id="login-form"><label class="field"><span>아이디</span><input name="username" autocomplete="username" value="${esc(username)}" required maxlength="100"></label><label class="field"><span>비밀번호</span><input name="password" type="password" autocomplete="current-password" placeholder="비밀번호를 입력하세요" required maxlength="256"></label><button type="submit" class="btn primary">로그인 ${icon('arrow')}</button></form>`:'<div class="notice-box">사이트 준비 중입니다. 관리자 설정을 마친 후 새로고침해 주세요.</div>'}<div class="login-foot">${icon('lock')}로그인한 사용자만 문서와 첨부파일에 접근할 수 있습니다.</div></div></section></main>`;
}
function sidebar(){
  const b=state.bootstrap;
  return `<aside class="sidebar"><a class="brand" href="#" data-action="home"><img src="/favicon.svg" alt=""><div><strong>안전정보팀</strong><small>DOCUMENT HUB</small></div></a><button class="side-main" data-action="home">${icon('layers')}전체 문서</button><div class="side-scroll"><div class="side-label"><span>업무구분</span><button data-action="categories" title="업무구분 관리" aria-label="업무구분 관리">${icon('plus')}</button></div>${b.categories.map(c=>`<button class="filter-item ${state.category===c.id?'active':''}" data-action="filter-cat" data-id="${c.id}">${icon('folder')}${esc(c.name)}</button>`).join('')||'<div class="category-empty">등록된 업무구분이 없습니다.</div>'}</div><div class="sidebar-footer">${currentUser().is_admin?`<button class="account-menu ${state.view==='users'?'active':''}" data-action="users">${icon('users')}사용자 관리</button><button class="account-menu ${state.view==='access'?'active':''}" data-action="access">${icon('lock')}접근제어</button>`:''}<div class="workspace-pill"><div class="avatar">${esc([...currentUser().name][0]||'사')}</div><button class="profile-account" data-action="my-account" title="내 계정과 비밀번호 변경"><strong>${esc(currentUser().name)}</strong><span>${esc(currentUser().login_id)}</span></button><button data-action="logout" title="로그아웃" aria-label="로그아웃">${icon('logout')}</button></div></div></aside>`;
}
function render(){
  if(!state.authenticated)return;
  $('#app').innerHTML=`${sidebar()}<div class="main"><header class="topbar"><div><button class="mobile-menu" data-action="menu" aria-label="업무구분 메뉴 열기">${icon('menu')}</button><div class="breadcrumbs">${icon('home')}업무 공간 ${icon('chevron')}<strong>문서 관리</strong>${state.view==='detail'?`${icon('chevron')}<span>제·개정 이력</span>`:state.view==='users'?`${icon('chevron')}<span>사용자 관리</span>`:state.view==='account'?`${icon('chevron')}<span>비밀번호 변경</span>`:state.view==='access'?`${icon('chevron')}<span>접근제어</span>`:''}</div></div><div class="top-status"><span class="status-dot"></span>문서와 이력을 안전하게 보관합니다</div></header><main class="page">${state.view==='detail'?detailView():(state.view==='users'||state.view==='account')?usersView():state.view==='access'?accessView():listView()}<footer class="page-footer">문서관리<span>·</span>업무의 기준과 변화를 함께 기록합니다.</footer></main></div>`;
}
function listView(){
  const filters=state.category?[catPath(state.category)]:[],search=state.searchDraft||state.search;
  return `<div class="page-heading"><div><h1>안전정보팀 업무 표준문서 관리</h1><p>한국상하수도협회와 상위기관의 문서를 업무별로 비교하고 제·개정 이력을 관리하세요.</p></div><div class="heading-buttons"><button class="btn" data-action="categories">${icon('settings')}업무구분 관리</button><button class="btn primary" data-action="new">${icon('plus')}문서 등록</button></div></div><section class="search-card" aria-label="문서검색 및 다운로드"><details id="document-search" class="search-disclosure" ${state.searchOpen?'open':''}><summary class="search-toggle"><span class="section-mini-title">${icon('search')}문서검색 및 다운로드</span><span class="search-toggle-state"><span class="search-closed-label">펼치기</span><span class="search-open-label">접기</span>${icon('down')}</span></summary><div class="search-content search-download-grid"><section class="search-panel" aria-labelledby="search-panel-heading"><h3 id="search-panel-heading">문서검색</h3><form id="search-form" class="search-form"><label class="field"><span>문서명</span><input name="title" value="${esc(search.title)}" placeholder="문서명을 입력하세요" maxlength="100"></label><label class="field"><span>담당자</span><input name="manager" value="${esc(search.manager)}" placeholder="담당자 이름" maxlength="100"></label><div class="field date-field"><span>제·개정 일자</span><div class="range year-month"><input id="search-year" name="year" type="number" inputmode="numeric" min="1900" max="9999" step="1" value="${esc(search.year)}" placeholder="연도 (예: 2026)" aria-label="검색 연도" ${search.month?'required':''}><select id="search-month" name="month" aria-label="검색 월"><option value="">전체 월</option>${Array.from({length:12},(_,index)=>`<option value="${index+1}" ${Number(search.month)===index+1?'selected':''}>${index+1}월</option>`).join('')}</select></div><small>연도만 입력하면 해당 연도 전체를 검색합니다.</small></div><div class="search-actions"><button class="btn" type="button" data-action="reset" aria-label="검색 초기화" title="검색 초기화">${icon('refresh')}</button><button type="submit" class="btn primary">${icon('search')}검색</button></div></form></section>${downloadPanel()}</div></details>${filters.length?`<div class="filter-summary">선택한 분류 ${filters.map(x=>`<span class="pill">${esc(x)}</span>`).join('')}<button class="text-btn" data-action="clear-filters">해제 ${icon('close')}</button></div>`:''}</section>${state.error?`<div class="error-box" role="alert">${esc(state.error)}</div>`:''}<section class="document-panel">${state.loading?'<div class="loading-line">문서를 불러오고 있습니다.</div>':documentList()}<div class="panel-footer"><span>${icon('info')}연관문서는 같은 행에 표시합니다. 문서명을 클릭하면 양쪽 제·개정 이력을 볼 수 있습니다.</span></div></section>`;
}
const displayDate=value=>value?value.split('-').map(Number).join('.')+'.':'';
function documentCells(document){
  if(!document)return '<td class="empty-document-cell" aria-label="연관문서 없음"></td><td class="empty-document-cell"></td>';
  return `<td class="paired-title-cell"><button data-action="open" data-id="${document.id}" title="${esc(document.title)} 전체 이력 보기">${typeIcon(document.document_type)}<span class="paired-document-name">${esc(document.title)}</span></button></td><td class="paired-date-cell"><time datetime="${esc(document.revision_date)}">${esc(displayDate(document.revision_date))}</time></td>`;
}
function documentList(){
  const rows=[...state.rows],searching=Object.values(state.search).some(value=>value.trim());
  if(!searching){
    const present=new Set(rows.map(row=>row.category_id));
    for(const category of state.bootstrap.categories){
      if(state.category&&category.id!==state.category)continue;
      if(!present.has(category.id))rows.push({category_id:category.id,category_path:catPath(category.id),kwwa:null,upper:null});
    }
  }
  const categoryOrder=new Map(state.bootstrap.categories.map((c,index)=>[c.id,index]));
  rows.sort((a,b)=>{const left=a.kwwa||a.upper,right=b.kwwa||b.upper;return (categoryOrder.get(a.category_id)??Number.MAX_SAFE_INTEGER)-(categoryOrder.get(b.category_id)??Number.MAX_SAFE_INTEGER)||DOCUMENT_TYPES.indexOf(left?.document_type||'지침')-DOCUMENT_TYPES.indexOf(right?.document_type||'지침')||(right?.revision_date||'').localeCompare(left?.revision_date||'');});
  if(!rows.length){const search=searching||state.category;return `<div class="empty"><div class="empty-icon">${icon(search?'search':'folder')}</div><h3>${search?'검색된 문서가 없습니다':'첫 번째 업무 문서를 등록해 보세요'}</h3><p>${search?'검색어와 업무구분, 연도·월을 확인해 주세요.':'업무구분을 설정한 후 문서를 등록하세요.<br>연관문서를 연결하면 같은 행에 나란히 표시됩니다.'}</p><button class="btn ${search?'':'primary'}" data-action="${search?'reset':'new'}">${icon(search?'refresh':'plus')}${search?'검색 초기화':'문서 등록'}</button></div>`;}
  const groups=new Map();for(const row of rows){if(!groups.has(row.category_id))groups.set(row.category_id,[]);groups.get(row.category_id).push(row);}
  return `<div class="paired-table-scroll"><table class="paired-document-table"><caption class="sr-only">업무구분별 한국상하수도협회와 상위기관의 최신 문서 및 제·개정 일자</caption><colgroup><col class="business-col"><col><col class="date-col"><col class="connector-col"><col><col class="date-col"></colgroup><thead><tr><th rowspan="2" scope="col">업무구분</th><th colspan="2" scope="colgroup">한국상하수도협회 (${state.bootstrap.organizations?.find(o=>o.id==='kwwa')?.document_count||0}건)</th><th rowspan="2" class="connector-heading" scope="col"><span class="sr-only">연관문서 연결</span></th><th colspan="2" scope="colgroup">상위기관 (${state.bootstrap.organizations?.find(o=>o.id==='upper')?.document_count||0}건)</th></tr><tr><th scope="col">문서명</th><th scope="col">제·개정 일자</th><th scope="col">문서명</th><th scope="col">제·개정 일자</th></tr></thead>${[...groups.values()].map(rows=>`<tbody>${rows.map((row,index)=>`<tr class="${row.kwwa&&row.upper?'paired-row-linked':''}">${index===0?`<th class="business-cell" scope="rowgroup" rowspan="${rows.length}">${esc(row.category_path||catPath(row.category_id))}</th>`:''}${documentCells(row.kwwa)}<td class="pair-connector-cell">${row.kwwa&&row.upper?'<span class="pair-connector" role="img" aria-label="연관문서 연결"></span>':''}</td>${documentCells(row.upper)}</tr>`).join('')}</tbody>`).join('')}</table></div>`;
}
function revisionAttachments(attachments=[],showEmpty=false){
  if(!attachments.length)return showEmpty?'<p class="no-attachments">첨부파일 없음</p>':'';
  return `<section class="revision-section"><h4>${icon('clip')}첨부파일 ${attachments.length}개</h4><div class="attachment-list">${attachments.map(a=>`<a class="attachment" href="/api/files/${a.id}" download="${esc(a.name)}">${icon('file')}<span class="filename">${esc(a.name)}</span><small>${size(a.size)}</small>${icon('download')}</a>`).join('')}</div></section>`;
}
function revisionFields(v){return `<div class="revision-meta"><span>담당자<strong>${esc(v.manager)}</strong></span><span class="revision-approval">참조 문서번호<strong>${esc(v.approval_no||'미등록')}</strong></span></div><div class="revision-summary">${esc(v.summary)}</div>`;}
function detailBundle(id){if(!state.detail)return null;if(!id||state.detail.document.id===id)return state.detail;return Object.values(state.detail.columns||{}).find(bundle=>bundle?.document.id===id)||null;}
function comparisonRevision(v,index,documentId,documentType){
  return `<article class="revision-card ${index===0?'is-latest':''} ${state.focusRevision===v.id?'focused':''}" id="revision-${v.id}"><div class="revision-top"><div><time class="revision-date" datetime="${esc(v.revision_date)}" aria-label="제·개정 일자">${esc(displayDate(v.revision_date))}</time>${index===0?'<span class="badge latest">최신</span>':''}</div></div><div class="revision-title-row"><h4 class="revision-title">${typeIcon(documentType)}<span class="revision-title-text">${esc(v.title)}</span></h4><div class="revision-actions"><button class="text-btn" data-action="edit" data-id="${v.id}" data-document-id="${documentId}">${icon('edit')}수정</button><button class="text-btn danger-text" data-action="delete-revision" data-id="${v.id}" data-document-id="${documentId}">${icon('trash')}삭제</button></div></div>${revisionFields(v)}${revisionAttachments(v.attachments)}</article>`;
}
function institutionHistory(side,bundle){
  if(!bundle)return `<section class="institution-history"><h2 class="institution-history-heading">${side.name}</h2><div class="institution-empty" aria-label="연결된 ${side.name} 문서가 없습니다"></div></section>`;
  const d=bundle.document,rs=bundle.revisions,r=rs[0];
  return `<section class="institution-history ${d.id===state.detail.document.id?'selected-document':''}"><h2 class="institution-history-heading">${side.name}</h2><div class="institution-document-heading"><h3>${typeIcon(d.document_type)}<span class="revision-title-text">${esc(r.title)}</span></h3><button class="btn primary" data-action="append" data-document-id="${d.id}">${icon('plus')}개정본 추가</button></div><div class="history-content"><div class="timeline">${rs.map((v,index)=>comparisonRevision(v,index,d.id,d.document_type)).join('')}</div></div></section>`;
}
function detailView(){
  if(!state.detail)return '<div class="loading-line">제·개정 이력을 불러오고 있습니다.</div>';
  return `<div class="back-row"><button data-action="back">${icon('back')}문서목록으로 돌아가기</button></div><div class="page-heading detail-page-heading"><div><h1>${esc(catPath(state.detail.document.category_id)||state.detail.document.category_name)} 제·개정 이력</h1><p>한국상하수도협회와 상위기관의 제·개정 정보를 나란히 확인합니다.</p></div></div><div class="paired-detail-scroll"><div class="institution-comparison">${SIDES.map(side=>institutionHistory(side,state.detail.columns?.[side.id]||null)).join('')}</div></div>`;
}
function categoryOptions(selected=''){const current=selected||state.bootstrap.categories[0]?.id;return state.bootstrap.categories.map(c=>`<option value="${c.id}" ${current===c.id?'selected':''}>${esc(c.name)}</option>`).join('');}
async function loadUserList(){
  const own=await api('/api/me');state.user=own.user;
  state.users=own.user.is_admin?(await api('/api/users')).users:[own.user];
}
function usersView(){
  const own=currentUser(),admin=own.is_admin,list=admin?state.users:[own];
  return `<div class="page-heading"><div><h1>${admin?'사용자 관리':'비밀번호 변경'}</h1><p>${admin?'사용자 계정과 활성화 상태를 관리합니다.':'본인의 계정정보를 확인하고 비밀번호를 변경할 수 있습니다.'}</p></div>${admin?`<button class="btn primary" data-action="add-user">${icon('plus')}사용자 추가</button>`:''}</div>${state.usersError?`<div class="error-box" role="alert">${esc(state.usersError)}</div>`:''}<section class="document-panel">${state.usersLoading?'<div class="loading-line">사용자 정보를 불러오고 있습니다.</div>':`<div class="users-table-scroll"><table class="users-table"><thead><tr><th scope="col">ID</th><th scope="col">비밀번호</th><th scope="col">이름</th><th scope="col">마지막 로그인 일시</th><th scope="col">활성화 여부</th>${admin?'<th scope="col">관리</th>':''}</tr></thead><tbody>${list.map(user=>`<tr><td>${esc(user.login_id)}${user.is_admin?'<span class="user-role">관리자</span>':''}</td><td class="masked-password" aria-label="비밀번호 마스킹">********</td><td>${esc(user.name)}</td><td>${user.last_login_at?`<time datetime="${esc(user.last_login_at)}">${esc(dateTime(user.last_login_at))}</time>`:''}</td><td><div class="account-status-actions"><span class="user-status ${user.active?'enabled':'disabled'}">${user.active?'활성화':'비활성화'}</span>${admin?'':'<button class="btn" data-action="change-password">비밀번호 변경</button>'}</div></td>${admin?`<td><div class="user-row-actions"><button class="text-btn" data-action="edit-user" data-id="${user.id}">수정</button><button class="text-btn danger-text" data-action="delete-user" data-id="${user.id}" ${user.is_admin?'disabled title="관리자 계정은 삭제할 수 없습니다."':''}>삭제</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`}</section>`;
}
function accessView(){
  if(!currentUser().is_admin)return '';
  const access=state.access;
  return `<div class="page-heading"><div><h1>접근제어</h1><p>로그인 화면과 문서·첨부파일에 접근할 수 있는 IP를 관리합니다.</p></div><button class="btn primary" data-action="add-ip" ${!access||state.accessBusy?'disabled':''}>${icon('plus')}허용 IP 추가</button></div>${state.accessError?`<div class="error-box" role="alert">${esc(state.accessError)}</div>`:''}${state.accessLoading||!access?'<div class="loading-line">접근제어 설정을 불러오고 있습니다.</div>':`<section class="access-settings-card"><div class="access-current-ip"><span>현재 접속 IP <strong>${esc(access.client_ip||'확인할 수 없음')}</strong></span>${access.client_ip?'<button class="text-btn" data-action="add-current-ip">현재 IP 등록</button>':''}</div><form id="access-mode-form"><fieldset class="access-mode-options"><legend>IP 허용 방식</legend><label><input type="radio" name="mode" value="all" ${access.mode==='all'?'checked':''}>모든 IP 허용</label><label><input type="radio" name="mode" value="allowlist" ${access.mode==='allowlist'?'checked':''}>등록된 IP만 허용</label></fieldset><p class="access-help">등록된 IP만 허용하면 활성화된 IP에서만 로그인 화면과 문서에 접근할 수 있습니다.</p><button class="btn primary" type="submit" ${state.accessBusy?'disabled':''}>설정 저장</button></form></section><section class="document-panel"><div class="users-table-scroll"><table class="users-table access-ip-table"><thead><tr><th scope="col">IP</th><th scope="col">설명</th><th scope="col">활성화 여부</th><th scope="col">관리</th></tr></thead><tbody>${access.ips.length?access.ips.map(rule=>`<tr><td class="ip-address">${esc(rule.ip)}</td><td>${esc(rule.description)}</td><td><span class="user-status ${rule.active?'enabled':'disabled'}">${rule.active?'활성화':'비활성화'}</span></td><td><div class="user-row-actions"><button class="text-btn" data-action="edit-ip" data-id="${rule.id}">수정</button><button class="text-btn danger-text" data-action="delete-ip" data-id="${rule.id}">삭제</button></div></td></tr>`).join(''):'<tr><td colspan="4" class="access-empty">등록된 IP가 없습니다.</td></tr>'}</tbody></table></div></section>`}`;
}
function openAccessEditor(id,useCurrent=false){
  if(!currentUser().is_admin||!state.access)return;
  const rule=id?state.access.ips.find(rule=>rule.id===id):null;if(id&&!rule)return;
  state.accessEditor={rule,busy:false};
  $('#access-dialog').innerHTML=`<div class="dialog-head"><div><h2 id="access-heading">${rule?'허용 IP 수정':'허용 IP 추가'}</h2><p>인터넷 접속에 사용하는 공인 IP를 입력하세요.</p></div><button class="close-button" data-action="close-access" aria-label="닫기">${icon('close')}</button></div><form id="access-ip-form"><div class="dialog-body"><div id="access-ip-error" class="error-box hidden" role="alert"></div><div class="form-grid"><label class="field wide"><span>IP <b class="required">*</b></span><input name="ip" value="${esc(rule?.ip||(useCurrent?state.access.client_ip:''))}" required maxlength="45" placeholder="예: 203.0.113.10" autocomplete="off" spellcheck="false"><small>IPv4 또는 IPv6 한 개를 입력합니다. 여러 IP는 각각 등록하세요.</small></label><label class="field wide"><span>설명</span><input name="description" value="${esc(rule?.description||'')}" maxlength="200" placeholder="예: 협회 사무실"></label><label class="field wide"><span>활성화 여부</span><select name="active"><option value="1" ${rule?.active===false?'':'selected'}>활성화</option><option value="0" ${rule?.active===false?'selected':''}>비활성화</option></select></label></div></div><div class="dialog-foot"><button type="button" class="btn" data-action="close-access">취소</button><button class="btn primary" id="save-access-ip" type="submit">저장</button></div></form>`;
  $('#access-dialog').showModal();document.body.classList.add('dialog-open');
}
async function saveAccessMode(form){
  if(state.accessBusy||!state.access||!currentUser().is_admin)return;
  state.accessBusy=true;state.accessError='';const mode=new FormData(form).get('mode');render();
  try{state.access=await api('/api/access-control',{method:'PUT',json:{mode,token:state.access.token}});notify('IP 접근 방식을 저장했습니다.');}catch(e){state.accessError=e.message;}finally{state.accessBusy=false;render();}
}
async function saveAccessIp(form){
  const editor=state.accessEditor;if(!editor||editor.busy||!currentUser().is_admin)return;
  editor.busy=true;const button=$('#save-access-ip');button.disabled=true;showError('#access-ip-error','');
  try{
    const data=Object.fromEntries(new FormData(form));data.active=data.active==='1';data.token=state.access.token;
    state.access=await api('/api/access-control/ips'+(editor.rule?'/'+editor.rule.id:''),{method:editor.rule?'PUT':'POST',json:data});
    editor.busy=false;$('#access-dialog').close();state.accessEditor=null;document.body.classList.remove('dialog-open');render();notify('허용 IP를 저장했습니다.');
  }catch(e){showError('#access-ip-error',e.message);}finally{editor.busy=false;button.disabled=false;}
}
async function removeAccessIp(id){
  if(!currentUser().is_admin||state.accessBusy)return;const rule=state.access?.ips.find(rule=>rule.id===id);if(!rule)return;
  if(!await askConfirm('허용 IP를 삭제할까요?','등록된 IP만 허용 중이면 삭제한 IP에서는 접근할 수 없습니다.',rule.ip))return;
  try{state.access=await api('/api/access-control/ips/'+id,{method:'DELETE',json:{token:state.access.token}});render();notify('허용 IP를 삭제했습니다.');}catch(e){state.accessError=e.message;render();}
}
function openUserEditor(id){
  if(!currentUser().is_admin){notify('관리자만 사용할 수 있는 기능입니다.');return;}
  const user=id?state.users.find(user=>user.id===id):null;if(id&&!user){notify('사용자를 찾을 수 없습니다.');return;}
  state.userEditor={user,busy:false};
  $('#user-dialog').innerHTML=`<div class="dialog-head"><div><h2 id="user-heading">${user?'사용자 수정':'사용자 추가'}</h2><p>${user?'변경할 계정정보를 입력하세요.':'새 사용자의 계정정보를 입력하세요.'}</p></div><button class="close-button" data-action="close-user" aria-label="닫기">${icon('close')}</button></div><form id="user-form"><div class="dialog-body"><div id="user-error" class="error-box hidden" role="alert"></div><div class="form-grid"><label class="field"><span>ID <b class="required">*</b></span><input name="login_id" value="${esc(user?.login_id||'')}" required maxlength="100" autocomplete="off"></label><label class="field"><span>비밀번호 ${user?'':'<b class="required">*</b>'}</span><input name="password" type="password" ${user?'':'required'} minlength="12" maxlength="256" autocomplete="new-password" placeholder="${user?'변경할 때만 입력':'12자 이상 입력'}">${user?'<small>비워두면 현재 비밀번호를 유지합니다.</small>':''}</label><label class="field wide"><span>이름 <b class="required">*</b></span><input name="name" value="${esc(user?.name||'')}" required maxlength="100"></label><label class="field"><span>마지막 로그인 일시</span><input name="last_login_at" type="datetime-local" min="1900-01-01T00:00" max="9999-12-31T23:59" value="${esc(dateTimeInput(user?.last_login_at))}"></label><label class="field"><span>활성화 여부</span><select name="active"><option value="1" ${user?.active===false?'':'selected'}>활성화</option><option value="0" ${user?.active===false?'selected':''} ${user?.is_admin?'disabled':''}>비활성화</option></select>${user?.is_admin?'<small>관리자 계정은 활성화 상태를 유지합니다.</small>':''}</label></div></div><div class="dialog-foot"><button type="button" class="btn" data-action="close-user">취소</button><button class="btn primary" id="save-user" type="submit">저장</button></div></form>`;
  $('#user-dialog').showModal();document.body.classList.add('dialog-open');
}
function openPasswordEditor(){
  state.userEditor={user:currentUser(),busy:false};
  $('#user-dialog').innerHTML=`<div class="dialog-head"><div><h2 id="user-heading">비밀번호 변경</h2><p>변경 후에는 새 비밀번호로 다시 로그인해 주세요.</p></div><button class="close-button" data-action="close-user" aria-label="닫기">${icon('close')}</button></div><form id="password-form"><div class="dialog-body"><div id="user-error" class="error-box hidden" role="alert"></div><div class="password-fields"><label class="field"><span>현재 비밀번호</span><input name="current_password" type="password" required maxlength="256" autocomplete="current-password"></label><label class="field"><span>새 비밀번호</span><input name="new_password" type="password" required minlength="12" maxlength="256" autocomplete="new-password"></label><label class="field"><span>새 비밀번호 확인</span><input name="confirm_password" type="password" required minlength="12" maxlength="256" autocomplete="new-password"></label></div></div><div class="dialog-foot"><button type="button" class="btn" data-action="close-user">취소</button><button class="btn primary" id="save-user" type="submit">비밀번호 변경</button></div></form>`;
  $('#user-dialog').showModal();document.body.classList.add('dialog-open');
}
function accountLoginAgain(loginId,message){
  state.userEditor=null;$('#user-dialog').close();document.body.classList.remove('dialog-open');state.authenticated=false;state.user=null;state.users=[];location.hash='';renderLogin(message,true,loginId);
}
async function saveUser(form){
  const editor=state.userEditor;if(!editor||editor.busy)return;editor.busy=true;const button=$('#save-user');button.disabled=true;showError('#user-error','');
  try{
    const data=Object.fromEntries(new FormData(form));data.active=data.active==='1';data.token=editor.user?.token;
    data.last_login_at=data.last_login_at===dateTimeInput(editor.user?.last_login_at)?editor.user?.last_login_at||null:data.last_login_at?new Date(data.last_login_at+'+09:00').toISOString():null;
    const result=await api('/api/users'+(editor.user?'/'+editor.user.id:''),{method:editor.user?'PUT':'POST',json:data});
    if(result.reauthenticate){accountLoginAgain(data.login_id,'계정정보를 변경했습니다. 새 정보로 다시 로그인해 주세요.');return;}
    editor.busy=false;$('#user-dialog').close();state.userEditor=null;document.body.classList.remove('dialog-open');await reloadAll();await loadUserList();render();notify('사용자 정보를 저장했습니다.');
  }catch(e){showError('#user-error',e.message);}finally{editor.busy=false;button.disabled=false;}
}
async function saveOwnPassword(form){
  const editor=state.userEditor;if(!editor||editor.busy)return;const data=Object.fromEntries(new FormData(form));showError('#user-error','');
  if(data.new_password!==data.confirm_password){showError('#user-error','새 비밀번호와 확인 입력이 일치하지 않습니다.');return;}
  editor.busy=true;const button=$('#save-user');button.disabled=true;
  try{await api('/api/me/password',{method:'PUT',json:{current_password:data.current_password,new_password:data.new_password}});accountLoginAgain(editor.user.login_id,'비밀번호를 변경했습니다. 새 비밀번호로 다시 로그인해 주세요.');}
  catch(e){showError('#user-error',e.message);}finally{editor.busy=false;button.disabled=false;}
}
async function removeUser(id){
  if(!currentUser().is_admin)return;const user=state.users.find(user=>user.id===id);if(!user)return;
  if(user.is_admin){notify('관리자 계정은 삭제할 수 없습니다.');return;}
  if(!await askConfirm('사용자를 삭제할까요?','계정과 로그인 세션이 삭제됩니다. 등록된 문서는 유지됩니다.',user.login_id+' · '+user.name))return;
  try{await api('/api/users/'+id,{method:'DELETE',json:{token:user.token}});await loadUserList();render();notify('사용자를 삭제했습니다.');}catch(e){state.usersError=e.message;render();}
}
function openEditor(mode,revisionId,documentId){
  const b=state.bootstrap;if(!b.categories.length){notify('업무구분을 먼저 등록해 주세요.');openCategories();return;}
  const detail=mode==='new'?null:detailBundle(documentId);if(mode!=='new'&&!detail){notify('문서를 찾을 수 없습니다. 새로고침해 주세요.');return;}
  const original=mode==='edit'?detail.revisions.find(r=>r.id===revisionId):mode==='append'?detail.revisions[0]:null;
  if(mode==='edit'&&!original){notify('수정할 이력을 찾을 수 없습니다.');return;}
  const partner=detail?.related_document_id?detailBundle(detail.related_document_id):null;
  const relations=partner?[{id:partner.document.id,organization_id:partner.document.organization_id,category_id:partner.document.category_id,...{title:partner.revisions[0].title,revision_date:partner.revisions[0].revision_date,sequence:partner.revisions[0].sequence,organization_name:partner.document.organization_name}}]:[];
  state.editor={mode,documentId:detail?.document.id||null,revisionId:mode==='edit'?original.id:null,token:original?.token,files:[],kept:mode==='edit'?[...original.attachments]:[],relations,busy:false};
  const previous=mode==='new'?registrationDefaults():{};
  const org=detail?.document.organization_id||(SIDES.some(o=>o.id===previous.organization_id)?previous.organization_id:SIDES[0].id),category=detail?.document.category_id||(b.categories.some(c=>c.id===previous.category_id)?previous.category_id:b.categories[0]?.id||''),documentType=detail?.document.document_type||(DOCUMENT_TYPES.includes(previous.document_type)?previous.document_type:DOCUMENT_TYPES[0]),requirement=detail?.document.requirement||(['권장','필수'].includes(previous.requirement)?previous.requirement:'권장');
  const label=mode==='new'?'문서 등록':mode==='append'?'개정본 추가':'제·개정 이력 수정';
  $('#editor-dialog').innerHTML=`<div class="dialog-head"><div><h2 id="editor-heading">${label}</h2><p>${mode==='new'?'새 문서의 최초 제정 이력을 등록합니다.':mode==='append'?'기존 문서에 새로운 개정 이력을 이어서 등록합니다.':'선택한 이력의 정보와 첨부파일, 연관문서를 수정합니다.'}</p></div><button class="close-button" data-action="close-editor" aria-label="닫기">${icon('close')}</button></div><form id="revision-form"><div class="dialog-body"><div id="editor-error" class="error-box hidden" role="alert"></div><div class="form-grid document-form"><label class="field document-classification"><span>업무구분 <b class="required">*</b></span><select name="category_id" id="editor-category" required>${categoryOptions(category)}</select></label><label class="field document-classification"><span>기관 구분 <b class="required">*</b></span><select name="organization_id" id="editor-org" required>${SIDES.map(o=>`<option value="${o.id}" ${org===o.id?'selected':''}>${esc(o.name)}</option>`).join('')}</select></label><label class="field document-classification"><span>문서종류 <b class="required">*</b></span><select name="document_type" id="editor-document-type" required>${DOCUMENT_TYPES.map(type=>`<option value="${type}" ${documentType===type?'selected':''}>${type}</option>`).join('')}</select></label><label class="field document-classification"><span>필수여부 <b class="required">*</b></span><select name="requirement" id="editor-requirement" required>${['권장','필수'].map(value=>`<option value="${value}" ${requirement===value?'selected':''}>${value}</option>`).join('')}</select></label>${mode==='edit'?'<div class="notice-box wide">기관 구분·문서종류·필수여부·업무구분·연관문서 변경은 문서 전체에 반영됩니다.</div>':''}<label class="field wide"><span>문서명 <b class="required">*</b><span class="counter" data-counter-for="editor-title">0 / 50</span></span><input id="editor-title" name="title" required maxlength="50" value="${esc(original?.title||'')}" placeholder="예: 개인정보 보호 내부관리계획"></label><label class="field"><span>제·개정 일자 <b class="required">*</b></span><input name="revision_date" type="date" required min="1900-01-01" max="9999-12-31" value="${mode==='edit'?esc(original.revision_date):today()}"></label><label class="field"><span>담당자 <b class="required">*</b></span><input name="manager" required maxlength="100" value="${esc(original?.manager||'')}" placeholder="담당자 이름 또는 부서"></label><label class="field wide"><span>참조 문서번호<span class="counter" data-counter-for="editor-approval">0 / 10</span></span><input name="approval_no" id="editor-approval" maxlength="10" value="${mode==='edit'?esc(original.approval_no):''}" placeholder="최대 10자"></label><label class="field wide"><span>설명<span class="counter" data-counter-for="editor-summary">0 / 300</span></span><textarea name="summary" id="editor-summary" maxlength="300" placeholder="문서에 대한 설명을 입력하세요.">${mode==='edit'?esc(original.summary):''}</textarea></label><section class="field wide"><span>첨부파일<span class="counter" id="file-count">0 / 20</span></span>${mode==='append'?'<small class="history-note">기존 첨부파일은 이전 이력에 보관됩니다. 이번 개정의 파일을 첨부해 주세요.</small>':''}<label class="file-drop" id="file-drop">${icon('upload')}<div class="file-drop-copy"><span>파일을 선택하거나 이곳에 끌어 놓으세요</span><small>여러 파일 첨부 가능 · 파일당 20MB · 한 번에 총 40MB</small></div><input type="file" id="editor-files" multiple aria-label="첨부파일 선택"></label><div id="editor-file-list"></div></section><section class="field wide"><span>연관문서<span class="counter" id="relation-count">연결 없음</span></span><small>같은 업무구분의 반대편 기관 문서 1개를 선택합니다. 이미 다른 문서와 연결된 문서는 표시되지 않습니다.</small><div id="selected-relations" class="selected-relations"></div><div class="relation-picker"><div class="relation-picker-search single"><input id="reference-query" placeholder="연관문서의 문서명으로 찾기" aria-label="연관문서 검색"></div><div id="reference-options" class="relation-picker-results"><div class="no-options">연관문서를 불러오고 있습니다.</div></div></div></section></div></div><div class="dialog-foot"><button type="button" class="btn" data-action="close-editor">취소</button><button type="submit" class="btn primary" id="save-revision">${icon('check')}${mode==='edit'?'수정 저장':'등록'}</button></div></form>`;
  $('#editor-dialog').showModal();document.body.classList.add('dialog-open');renderEditorFiles();renderSelectedRefs();updateCounters();loadReferences();
  $('#editor-category').focus();
}
function updateCounters(){document.querySelectorAll('[data-counter-for]').forEach(el=>{const input=document.getElementById(el.dataset.counterFor);el.textContent=`${[...input.value.normalize('NFC')].length} / ${input.maxLength}`;});}
function renderEditorFiles(){const e=state.editor;if(!e)return;$('#file-count').textContent=`${e.kept.length+e.files.length} / 20`;$('#editor-file-list').innerHTML=e.kept.map(a=>`<div class="file-edit-row">${icon('file')}<span>${esc(a.name)}</span><small>${size(a.size)} · 기존</small><button type="button" data-action="remove-old-file" data-id="${a.id}" aria-label="${esc(a.name)} 첨부 해제">${icon('close')}</button></div>`).join('')+e.files.map((a,i)=>`<div class="file-edit-row">${icon('file')}<span>${esc(a.name)}</span><small>${size(a.size)} · 추가</small><button type="button" data-action="remove-new-file" data-id="${i}" aria-label="${esc(a.name)} 첨부 해제">${icon('close')}</button></div>`).join('');}
function addFiles(files){const e=state.editor,newFiles=[...files].filter(f=>!e.files.some(x=>x.name===f.name&&x.size===f.size&&x.lastModified===f.lastModified));if(newFiles.some(f=>f.size>20*1048576)){notify('파일 한 개의 크기는 20MB 이하여야 합니다.');return;}if(newFiles.length+e.files.length+e.kept.length>20){notify('첨부파일은 20개까지 등록할 수 있습니다.');return;}if([...e.files,...newFiles].reduce((s,f)=>s+f.size,0)>40*1048576){notify('새로 첨부하는 파일의 합계는 40MB 이하여야 합니다.');return;}e.files.push(...newFiles);renderEditorFiles();}
async function loadReferences(){
  const generation=++refsGeneration,editor=state.editor,org=$('#editor-org')?.value,category=$('#editor-category')?.value;
  if(!editor||!org)return;
  if(!category){$('#reference-options').innerHTML='<div class="no-options">업무구분을 먼저 선택해 주세요.</div>';return;}
  const query=new URLSearchParams({exclude_org:org,category,document:editor.documentId||'',q:$('#reference-query').value});
  try{const result=await api('/api/references?'+query);if(generation!==refsGeneration||state.editor!==editor)return;editor.options=result.documents;$('#reference-options').innerHTML=result.documents.map(r=>`<label class="ref-option"><input type="radio" name="related-option" value="${r.id}" data-reference="${r.id}" ${editor.relations.some(x=>x.id===r.id)?'checked':''}><div><strong>${esc(r.title)}</strong><small>${esc(r.organization_name)} · ${esc(displayDate(r.revision_date))}</small></div></label>`).join('')||'<div class="no-options">연결 가능한 같은 업무구분의 문서가 없습니다.</div>';if(result.has_more)$('#reference-options').insertAdjacentHTML('beforeend','<div class="no-options">100건까지 표시됩니다. 문서명으로 검색해 주세요.</div>');}catch(e){if(generation===refsGeneration&&state.editor===editor&&$('#reference-options'))$('#reference-options').innerHTML=`<div class="no-options">${esc(e.message)}</div>`;}
}
function renderSelectedRefs(){const e=state.editor;if(!e||!$('#selected-relations'))return;$('#relation-count').textContent=e.relations.length?'1개 문서 연결':'연결 없음';$('#selected-relations').innerHTML=e.relations.map(r=>`<div class="selected-ref"><span>${esc(r.title)}<small>${esc(r.organization_name)}</small></span><button type="button" data-action="remove-reference" data-id="${r.id}" aria-label="연관문서 연결 해제">${icon('close')}</button></div>`).join('');document.querySelectorAll('[data-reference]').forEach(c=>c.checked=e.relations.some(r=>r.id===c.dataset.reference));}
async function saveEditor(form){
  const e=state.editor;if(!e||e.busy)return;e.busy=true;showError('#editor-error','');$('#save-revision').disabled=true;$('#save-revision').textContent='저장하고 있습니다…';
  const data=Object.fromEntries(new FormData(form));data.token=e.token;data.keep_attachments=e.kept.map(a=>a.id);data.related_document_id=e.relations[0]?.id||null;
  const body=new FormData();body.set('payload',JSON.stringify(data));for(const file of e.files)body.append('files',file,file.name);
  const path=e.mode==='new'?'/api/documents':e.mode==='append'?`/api/documents/${e.documentId}/revisions`:`/api/revisions/${e.revisionId}`;
  try{const result=await api(path,{method:e.mode==='edit'?'PUT':'POST',body});if(e.mode==='new')rememberRegistration(data);$('#editor-dialog').close();state.editor=null;document.body.classList.remove('dialog-open');notify(e.mode==='edit'?'이력을 수정했습니다.':'문서 이력을 등록했습니다.');await reloadAll();navigate(result.document_id,result.revision_id);}catch(error){showError('#editor-error',error.message);$('#editor-error')?.scrollIntoView({block:'center'});}finally{e.busy=false;if($('#save-revision')){$('#save-revision').disabled=false;$('#save-revision').textContent=e.mode==='edit'?'수정 저장':'등록';}}
}
function openCategories(){state.categoryTab='categories';state.categoryEdit=null;renderCategories();$('#category-dialog').showModal();document.body.classList.add('dialog-open');}
function renderCategories(){
  const list=state.bootstrap.categories,disabled=state.categoryBusy?'disabled':'';
  $('#category-dialog').innerHTML=`<div class="dialog-head"><div><h2 id="category-heading">업무구분 관리</h2><p>업무구분은 하위분류 없이 1단계로 관리합니다. 위로·아래로 버튼으로 표시 순서를 변경하세요.</p></div><button class="close-button" data-action="close-category" aria-label="닫기">${icon('close')}</button></div><div class="dialog-body"><div id="category-error" class="error-box hidden" role="alert"></div><form id="category-add-form" class="category-add-form flat"><input name="name" required maxlength="80" placeholder="업무구분명 입력" aria-label="업무구분명" ${disabled}><button class="btn primary" type="submit" ${disabled}>${icon('plus')}추가</button></form><div class="category-table">${list.map((c,index)=>`<div class="category-row">${state.categoryEdit===c.id?`<form class="category-inline-form" data-category-edit="${c.id}"><input name="name" value="${esc(c.name)}" required maxlength="80" aria-label="업무구분명 수정" ${disabled}><button type="submit" ${disabled}>저장</button><button type="button" data-action="cancel-category-edit" ${disabled}>취소</button></form>`:`<span class="category-position">${index+1}</span><span class="category-name">${esc(c.name)}</span><span class="counter">문서 ${c.document_count||0}개</span><div class="category-row-actions"><button data-action="move-category" data-id="${c.id}" data-direction="up" aria-label="${esc(c.name)} 위로 이동" ${index===0?'disabled':disabled}>위로</button><button data-action="move-category" data-id="${c.id}" data-direction="down" aria-label="${esc(c.name)} 아래로 이동" ${index===list.length-1?'disabled':disabled}>아래로</button><button data-action="edit-category" data-id="${c.id}" ${disabled}>수정</button><button class="delete-category" data-action="delete-category" data-id="${c.id}" ${c.document_count>0?'disabled title="등록된 문서가 있어 삭제할 수 없습니다."':disabled}>삭제</button></div>`}</div>`).join('')||'<div class="empty compact"><p>등록된 업무구분이 없습니다. 위에서 추가해 주세요.</p></div>'}</div><p class="small muted">등록된 문서가 없는 업무구분만 삭제할 수 있습니다.</p></div><div class="dialog-foot"><button class="btn primary" data-action="close-category">완료</button></div>`;
}
async function moveCategory(id,direction){
  if(state.categoryBusy)return;
  const previous=state.bootstrap.categories.map(c=>c.id),index=previous.indexOf(id),next=index+(direction==='up'?-1:1);
  if(index<0||next<0||next>=previous.length)return;
  const ordered=[...previous];[ordered[index],ordered[next]]=[ordered[next],ordered[index]];
  state.categoryBusy=true;renderCategories();let error='';
  try{await api('/api/categories/order',{method:'PUT',json:{ids:ordered,previous_ids:previous}});await reloadAll();notify('업무구분 순서를 변경했습니다.');}
  catch(e){error=e.message;await reloadAll().catch(()=>{});}
  finally{state.categoryBusy=false;renderCategories();if(error)showError('#category-error',error);}
}
async function saveCategory(form,id){if(state.categoryBusy)return;const button=form.querySelector('button[type=submit]');button.disabled=true;showError('#category-error','');try{await api(`/api/categories${id?'/'+id:''}`,{method:id?'PUT':'POST',json:Object.fromEntries(new FormData(form))});await reloadAll();state.categoryEdit=null;renderCategories();notify(id?'업무구분을 수정했습니다.':'업무구분을 추가했습니다.');}catch(e){showError('#category-error',e.message);}finally{button.disabled=false;}}
function askConfirm(title,text,item='',confirmLabel='삭제'){
  if(confirmResolve)confirmResolve(false);
  $('#confirm-dialog').innerHTML=`<div class="confirm-body"><h3 id="confirm-heading">${esc(title)}</h3>${item?`<div class="confirm-title">${esc(item)}</div>`:''}<p>${esc(text)}</p></div><div class="dialog-foot"><button class="btn" data-action="confirm-no">취소</button><button class="btn danger" data-action="confirm-yes">${esc(confirmLabel)}</button></div>`;
  $('#confirm-dialog').showModal();return new Promise(resolve=>confirmResolve=resolve);
}
async function deleteCategory(id){if(state.categoryBusy)return;const item=state.bootstrap.categories.find(x=>x.id===id);if(!item)return;if(item.document_count>0){showError('#category-error','등록된 문서가 있는 업무구분은 삭제할 수 없습니다.');return;}if(!await askConfirm('업무구분을 삭제할까요?','등록된 문서가 없는 업무구분만 삭제할 수 있습니다.',item.name))return;try{await api('/api/categories/'+id,{method:'DELETE'});if(state.category===id)state.category='';await reloadAll();renderCategories();notify('업무구분을 삭제했습니다.');}catch(e){showError('#category-error',e.message);}}
async function removeRevision(id,documentId){
  const detail=detailBundle(documentId),r=detail?.revisions.find(v=>v.id===id);if(!r)return;
  const effect=detail.revisions.length===1?'마지막 이력이므로 해당 문서도 삭제되고 연관문서 연결이 해제됩니다. 상대 문서는 유지됩니다.':'문서 간 연결은 유지됩니다.';
  if(!await askConfirm('이 이력을 삭제할까요?',`첨부파일 ${r.attachments.length}개가 함께 삭제됩니다. ${effect}\n삭제 후 되돌릴 수 없습니다.`,`${r.title} · ${revName(r.display_sequence??r.sequence)}`))return;
  try{const result=await api('/api/revisions/'+id,{method:'DELETE',json:{token:r.token}});await reloadAll();if(result.document_deleted&&state.detail?.document.id===detail.document.id)navigate(detail.related_document_id||'');else await handleRoute();notify('이력을 삭제했습니다.');}catch(e){notify(e.message);}
}
async function removeDocument(documentId){const detail=detailBundle(documentId);if(!detail)return;const {document:d,revisions:rs}=detail;if(!await askConfirm('문서 전체를 삭제할까요?',`이 문서의 모든 이력과 첨부파일이 삭제되고 연관문서와의 연결이 해제됩니다. 상대 문서는 유지됩니다.\n삭제 후 되돌릴 수 없습니다.`,rs[0].title,'전체 삭제'))return;try{await api('/api/documents/'+d.id,{method:'DELETE',json:{token:rs[0].token}});state.view='list';state.detail=null;await reloadAll();navigate();notify('문서와 전체 이력을 삭제했습니다.');}catch(e){notify(e.message);}}
async function resetSearch(){state.searchDraft=null;state.category='';state.search={title:'',manager:'',year:'',month:''};state.error='';if(state.view!=='list'){state.view='list';navigate();}await refreshList();}
document.addEventListener('click',async event=>{
  const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
  event.preventDefault();const {action,id}=target.dataset;
  try{switch(action){
    case 'home':await resetSearch();break;
    case 'users':if(location.hash==='#users')await handleRoute();else location.hash='#users';break;
    case 'my-account':{const hash=currentUser().is_admin?'#users':'#account';if(location.hash===hash)await handleRoute();else location.hash=hash;break;}
    case 'access':if(!currentUser().is_admin)break;if(location.hash==='#access')await handleRoute();else location.hash='#access';break;
    case 'add-ip':openAccessEditor();break;
    case 'add-current-ip':openAccessEditor(state.access?.ips.find(rule=>rule.ip===state.access.client_ip)?.id,true);break;
    case 'edit-ip':openAccessEditor(id);break;
    case 'delete-ip':await removeAccessIp(id);break;
    case 'close-access':if(!state.accessEditor?.busy)$('#access-dialog').close();break;
    case 'add-user':openUserEditor();break;
    case 'edit-user':openUserEditor(id);break;
    case 'delete-user':await removeUser(id);break;
    case 'change-password':openPasswordEditor();break;
    case 'close-user':if(!state.userEditor?.busy)$('#user-dialog').close();break;
    case 'download-excel':await downloadExport('excel');break;
    case 'download-files':await downloadExport('files');break;
    case 'back':navigate();break;
    case 'menu':$('.sidebar')?.classList.toggle('open');break;
    case 'new':openEditor('new');break;
    case 'append':openEditor('append',null,target.dataset.documentId);break;
    case 'edit':openEditor('edit',id,target.dataset.documentId);break;
    case 'open':navigate(id,target.dataset.revision||'');break;
    case 'jump':state.focusRevision=id;document.getElementById('revision-'+id)?.scrollIntoView({behavior:'smooth',block:'nearest'});break;
    case 'filter-cat':state.category=state.category===id?'':id;state.view='list';navigate();await refreshList();break;
    case 'clear-filters':state.category='';await refreshList();break;
    case 'reset':await resetSearch();break;
    case 'categories':openCategories();break;
    case 'categories-work':openCategories('categories');break;
    case 'edit-category':state.categoryEdit=id;renderCategories();break;
    case 'cancel-category-edit':state.categoryEdit=null;renderCategories();break;
    case 'move-category':await moveCategory(id,target.dataset.direction);break;
    case 'delete-category':await deleteCategory(id);break;
    case 'close-category':$('#category-dialog').close();document.body.classList.remove('dialog-open');if(state.view==='detail')await handleRoute();break;
    case 'close-editor':if(!state.editor?.busy){$('#editor-dialog').close();state.editor=null;document.body.classList.remove('dialog-open');}break;
    case 'remove-old-file':state.editor.kept=state.editor.kept.filter(a=>a.id!==id);renderEditorFiles();break;
    case 'remove-new-file':state.editor.files.splice(Number(id),1);renderEditorFiles();break;
    case 'remove-reference':state.editor.relations=state.editor.relations.filter(r=>r.id!==id);renderSelectedRefs();break;
    case 'delete-revision':await removeRevision(id,target.dataset.documentId);break;
    case 'delete-document':await removeDocument(target.dataset.documentId);break;
    case 'confirm-no':case 'confirm-yes':{const resolve=confirmResolve;confirmResolve=null;$('#confirm-dialog').close();resolve?.(action==='confirm-yes');break;}
    case 'logout':await api('/api/logout',{method:'POST'});resetEntryDefaults();state.exportSelection={organizations:null,categories:null};state.authenticated=false;state.user=null;state.users=[];renderLogin();break;
  }}catch(e){notify(e.message);}
});
document.addEventListener('submit',async event=>{
  const form=event.target;event.preventDefault();
  if(form.id==='login-form'){const button=form.querySelector('button');button.disabled=true;showError('#login-error','');try{await api('/api/login',{method:'POST',json:Object.fromEntries(new FormData(form))});resetEntryDefaults();state.exportSelection={organizations:null,categories:null};state.authenticated=true;await reloadAll();await handleRoute();}catch(e){showError('#login-error',e.message);button.disabled=false;}}
  else if(form.id==='search-form'){state.searchDraft=null;state.search=Object.fromEntries(new FormData(form));await refreshList();}
  else if(form.id==='revision-form')await saveEditor(form);
  else if(form.id==='user-form')await saveUser(form);
  else if(form.id==='password-form')await saveOwnPassword(form);
  else if(form.id==='access-mode-form')await saveAccessMode(form);
  else if(form.id==='access-ip-form')await saveAccessIp(form);
  else if(form.id==='category-add-form')await saveCategory(form);
  else if(form.dataset.categoryEdit)await saveCategory(form,form.dataset.categoryEdit);
});
document.addEventListener('input',event=>{if(event.target.closest('#search-form'))state.searchDraft=Object.fromEntries(new FormData($('#search-form')));if(event.target.closest('#revision-form'))updateCounters();if(event.target.id==='reference-query'){clearTimeout(refTimer);refTimer=setTimeout(loadReferences,250);}});
document.addEventListener('change',event=>{
  const t=event.target;
  if(t.closest?.('#search-form'))state.searchDraft=Object.fromEntries(new FormData($('#search-form')));
  if(t.dataset.exportAll){const kind=t.dataset.exportAll;state.exportSelection[kind]=t.checked?null:[];state.exportError='';render();return;}
  if(t.dataset.exportKind){const kind=t.dataset.exportKind,current=exportIds(kind);state.exportSelection[kind]=t.checked?[...new Set([...current,t.value])]:current.filter(id=>id!==t.value);state.exportError='';render();return;}
  if(t.id==='search-month')$('#search-year').required=Boolean(t.value);if(t.id==='editor-files'){addFiles(t.files);t.value='';}
  if(t.id==='editor-org'||t.id==='editor-category'){if(state.editor.relations.length){state.editor.relations=[];notify('기관 구분 또는 업무구분 변경으로 연관문서 선택을 해제했습니다.');}renderSelectedRefs();loadReferences();}
  if(t.dataset.reference&&t.checked){const e=state.editor,r=e.options?.find(r=>r.id===t.dataset.reference);e.relations=r?[r]:[];renderSelectedRefs();}
});
document.addEventListener('toggle',event=>{if(event.target.id==='document-search')state.searchOpen=event.target.open;},true);
document.addEventListener('dragover',event=>{const zone=event.target.closest('#file-drop');if(zone){event.preventDefault();zone.classList.add('dragover');}});
document.addEventListener('dragleave',event=>event.target.closest('#file-drop')?.classList.remove('dragover'));
document.addEventListener('drop',event=>{const zone=event.target.closest('#file-drop');if(zone){event.preventDefault();zone.classList.remove('dragover');addFiles(event.dataTransfer.files);}});
$('#editor-dialog').addEventListener('cancel',event=>{if(state.editor?.busy)event.preventDefault();});
$('#editor-dialog').addEventListener('close',()=>{if(!state.editor?.busy)state.editor=null;if(!document.querySelector('dialog[open]'))document.body.classList.remove('dialog-open');});
$('#category-dialog').addEventListener('close',()=>{if(!document.querySelector('dialog[open]'))document.body.classList.remove('dialog-open');});
$('#confirm-dialog').addEventListener('close',()=>{if(confirmResolve){confirmResolve(false);confirmResolve=null;}});
$('#user-dialog')?.addEventListener('cancel',event=>{if(state.userEditor?.busy)event.preventDefault();});
$('#user-dialog')?.addEventListener('close',()=>{if(!state.userEditor?.busy)state.userEditor=null;if(!document.querySelector('dialog[open]'))document.body.classList.remove('dialog-open');});
$('#access-dialog')?.addEventListener('cancel',event=>{if(state.accessEditor?.busy)event.preventDefault();});
$('#access-dialog')?.addEventListener('close',()=>{if(!state.accessEditor?.busy)state.accessEditor=null;if(!document.querySelector('dialog[open]'))document.body.classList.remove('dialog-open');});
window.addEventListener('hashchange',handleRoute);
async function start(){try{const session=await api('/api/session');state.clientIp=session.client_ip||'';if(!session.authenticated){renderLogin('',session.configured,session.username);return;}state.authenticated=true;await reloadAll();await handleRoute();}catch(e){if(state.authenticated){state.loading=false;state.error=e.message;render();}else if(!state.accessDenied)renderLogin(e.message);}}
start();
