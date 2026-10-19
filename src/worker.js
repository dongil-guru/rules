const MAX_FILE = 20 * 1024 * 1024;
const MAX_TOTAL = 40 * 1024 * 1024;
const DOCUMENT_TYPES = ['지침','매뉴얼','가이드라인','기타'];
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json; charset=utf-8', ...extra}});
const rows = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
const first = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const clean = (value, field, max, required = false) => {
  if (value != null && typeof value !== 'string') fail(400, `${field} 형식이 올바르지 않습니다.`);
  const text = (value || '').normalize('NFC').trim();
  if (required && !text) fail(400, `${field}을(를) 입력해 주세요.`);
  if ([...text].length > max) fail(400, `${field}은(는) ${max}자까지 입력할 수 있습니다.`);
  return text;
};
function validDate(value, label = '일자') {
  const parsed = typeof value==='string' ? new Date(value+'T00:00:00Z') : new Date(NaN);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31' || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==value) fail(400, `${label}을(를) 연월일 형식으로 입력해 주세요.`);
  return value;
}
function ids(value, label, max = 100) {
  if (!Array.isArray(value) || value.length > max || value.some(x=>typeof x!=='string' || !/^[\w-]{1,80}$/.test(x))) fail(400, `${label} 목록을 확인해 주세요.`);
  return [...new Set(value)];
}
function configReady(env) { return !!(env.DB && env.FILES && (env.ADMIN_PASSWORD?.length >= 12 || env.ADMIN_PASSWORD_HASH)); }
const cookieName = request => new URL(request.url).protocol === 'https:' ? '__Host-doc_session' : 'doc_session';
const cookieValue = request => request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName(request)+'='))?.split('=')[1] || '';
function sessionCookie(request, token, maxAge) {
  return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
}
async function authorized(request, env) {
  const token = cookieValue(request);
  if (!/^[a-f0-9]{64}$/.test(token) || !env.DB) return null;
  const user=await first(env,'SELECT u.id,u.login_id,u.name,u.last_login_at,u.active,u.is_admin,u.token FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1',await digest(token),Date.now());
  return user?publicUser(user):null;
}
async function passwordMatches(value, hash) {
  if (hash) {
    const [algorithm,iterations,salt,expected] = hash.split('$');
    if (algorithm!=='pbkdf2' || !/^\d+$/.test(iterations) || !salt || !expected) return false;
    const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);
    const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:Number(iterations),salt:new TextEncoder().encode(salt)},key,256);
    const actual = [...new Uint8Array(bits)].map(b=>b.toString(16).padStart(2,'0')).join('');
    return constantTime(actual,expected);
  }
  return false;
}
async function hashPassword(value){
  if(typeof value!=='string'||value.length<12||value.length>256)fail(400,'비밀번호는 12~256자로 입력해 주세요.');
  const salt=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:100000,salt:new TextEncoder().encode(salt)},key,256);
  return 'pbkdf2$100000$'+salt+'$'+[...new Uint8Array(bits)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function publicUser(user){return {id:user.id,login_id:user.login_id,name:user.name,last_login_at:user.last_login_at||null,active:!!user.active,is_admin:!!user.is_admin,token:user.token,password_mask:'********'};}
async function ensureAdministrator(env){
  const existing=await first(env,'SELECT id FROM users WHERE is_admin=1');if(existing)return;
  const hash=env.ADMIN_PASSWORD_HASH||await hashPassword(env.ADMIN_PASSWORD);
  const time=now();
  await stmt(env,'INSERT OR IGNORE INTO users(id,login_id,password_hash,name,last_login_at,active,is_admin,token,created_at,updated_at) VALUES(?,?,?,?,NULL,1,1,?,?,?)',uid(),env.ADMIN_USER||'admin',hash,'관리자',uid(),time,time).run();
}
function constantTime(a,b) { if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0; }
async function readJSON(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415,'요청 형식이 올바르지 않습니다.');
  if (Number(request.headers.get('Content-Length')||0)>100000) fail(413,'요청이 너무 큽니다.');
  try {const data = await request.json();if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'입력값을 확인해 주세요.');return data;} catch { fail(400,'입력값을 확인해 주세요.'); }
}
async function login(request, env) {
  if (!configReady(env)) fail(503,'사이트 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.');
  await ensureAdministrator(env);
  const body = await readJSON(request);
  // Login-attempt lockouts stay disabled until the owner asks to restore them.
  // Always check submitted credentials, including IPs with legacy block records.
  const name = typeof body.username==='string'?body.username.normalize('NFC').trim().slice(0,100):'';
  const password = typeof body.password==='string'?body.password:'';
  const user=await first(env,'SELECT * FROM users WHERE login_id=? COLLATE NOCASE',name);
  if (password.length>256 || !user || !user.active || !await passwordMatches(password,user.password_hash)) {
    fail(401,'아이디 또는 비밀번호가 올바르지 않습니다.');
  }
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const time=now(),userToken=uid();
  const result=await env.DB.batch([
    stmt(env,'UPDATE users SET last_login_at=?,updated_at=?,token=? WHERE id=? AND active=1 AND password_hash=? AND token=?',time,time,userToken,user.id,user.password_hash,user.token),
    stmt(env,'INSERT INTO user_sessions SELECT ?,?,id FROM users WHERE id=? AND active=1 AND token=?',await digest(token),Date.now()+43200000,user.id,userToken),
    stmt(env,'DELETE FROM user_sessions WHERE expires_at<?',Date.now())
  ]);
  if(!result[0].meta.changes)fail(401,'계정정보가 변경되었습니다. 다시 로그인해 주세요.');
  return json({ok:true,user:publicUser({...user,last_login_at:time,token:userToken})},200,{'Set-Cookie':sessionCookie(request,token,43200)});
}
async function bootstrap(env,user) {
  const results = await env.DB.batch([
    stmt(env,'SELECT * FROM organizations ORDER BY name COLLATE NOCASE'),
    stmt(env,'SELECT c.*,(SELECT count(*) FROM documents d WHERE d.category_id=c.id) document_count FROM work_categories c ORDER BY c.sort_order,c.id'),
    stmt(env,`SELECT (SELECT count(*) FROM documents) documents, (SELECT count(*) FROM revisions) revisions, (SELECT count(*) FROM organizations) organizations, (SELECT count(DISTINCT document_id) FROM revisions WHERE updated_at>=?) recent`,new Date(Date.now()-30*86400000).toISOString())
  ]);
  return json({organizations:results[0].results,categories:results[1].results,stats:results[2].results[0],user,document_types:DOCUMENT_TYPES});
}
function requireAdministrator(user){if(!user.is_admin)fail(403,'관리자만 사용할 수 있는 기능입니다.');}
function userDateTime(value){
  if(value==null||value==='')return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(new Date(value).getTime()))fail(400,'마지막 로그인 일시를 확인해 주세요.');
  validDate(value.slice(0,10),'마지막 로그인 날짜');
  return new Date(value).toISOString();
}
async function listUsers(env,user){requireAdministrator(user);return json({users:(await rows(env,'SELECT id,login_id,name,last_login_at,active,is_admin,token FROM users ORDER BY is_admin DESC,created_at,id')).map(publicUser)});}
async function mutateUser(request,env,user,id){
  requireAdministrator(user);const body=await readJSON(request),existing=id?await first(env,'SELECT * FROM users WHERE id=?',id):null;
  if(id&&!existing)fail(404,'사용자를 찾을 수 없습니다.');
  if(existing&&body.token!==existing.token)fail(409,'사용자 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
  if(request.method==='DELETE'){
    if(existing.is_admin)fail(409,'관리자 계정은 삭제할 수 없습니다.');
    const result=await stmt(env,'DELETE FROM users WHERE id=? AND token=?',id,body.token).run();if(!result.meta.changes)fail(409,'사용자 정보가 변경되었습니다. 새로고침해 주세요.');
    return json({ok:true});
  }
  const loginId=clean(body.login_id,'ID',100,true),name=clean(body.name,'이름',100,true);
  const active=body.active===undefined?(existing?!!existing.active:true):body.active;
  if(typeof active!=='boolean')fail(400,'활성화 여부를 확인해 주세요.');
  if(existing?.is_admin&&!active)fail(409,'관리자 계정은 비활성화할 수 없습니다.');
  if(!existing?.is_admin&&loginId.toLowerCase()==='admin')fail(409,'admin은 관리자 계정 전용 ID입니다.');
  const password=body.password===undefined?'':body.password;
  if(typeof password!=='string')fail(400,'비밀번호를 확인해 주세요.');
  const hash=password?await hashPassword(password):existing?.password_hash;
  if(!hash)fail(400,'비밀번호를 입력해 주세요.');
  const lastLogin=Object.prototype.hasOwnProperty.call(body,'last_login_at')?userDateTime(body.last_login_at):existing?.last_login_at||null;
  const key=id||uid(),token=uid(),time=now(),revoke=!!existing&&(!!password||existing.login_id!==loginId||!!existing.active!==active);
  try{
    const commands=[existing?stmt(env,'UPDATE users SET login_id=?,password_hash=?,name=?,last_login_at=?,active=?,token=?,updated_at=? WHERE id=? AND token=?',loginId,hash,name,lastLogin,active?1:0,token,time,key,body.token):stmt(env,'INSERT INTO users(id,login_id,password_hash,name,last_login_at,active,is_admin,token,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?,?)',key,loginId,hash,name,lastLogin,active?1:0,token,time,time)];
    if(revoke)commands.push(stmt(env,'DELETE FROM user_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND token=?)',key,key,token));
    const result=await env.DB.batch(commands);if(!result[0].meta.changes)fail(409,'사용자 정보가 변경되었습니다. 새로고침해 주세요.');
    return json({ok:true,id:key,reauthenticate:revoke&&key===user.id},existing?200:201);
  }catch(e){if(String(e).includes('UNIQUE'))fail(409,'이미 등록된 ID입니다.');throw e;}
}
async function changeOwnPassword(request,env,user){
  const body=await readJSON(request),existing=await first(env,'SELECT * FROM users WHERE id=?',user.id);
  if(!existing||!existing.active)fail(401,'다시 로그인해 주세요.');
  if(typeof body.current_password!=='string'||body.current_password.length>256||!await passwordMatches(body.current_password,existing.password_hash))fail(400,'현재 비밀번호가 올바르지 않습니다.');
  const hash=await hashPassword(body.new_password),token=uid();
  const result=await env.DB.batch([
    stmt(env,'UPDATE users SET password_hash=?,token=?,updated_at=? WHERE id=? AND token=?',hash,token,now(),user.id,existing.token),
    stmt(env,'DELETE FROM user_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND token=?)',user.id,user.id,token)
  ]);
  if(!result[0].meta.changes)fail(409,'사용자 정보가 변경되었습니다. 다시 시도해 주세요.');
  return json({ok:true,reauthenticate:true});
}
async function categoryMutation(request, env, id) {
  const existing = id ? await first(env,'SELECT * FROM work_categories WHERE id=?',id) : null;
  if (id&&!existing) fail(404,'분류를 찾을 수 없습니다.');
  if(request.method==='DELETE') {
    if(await first(env,'SELECT 1 FROM documents WHERE category_id=?',id))fail(409,'등록된 문서가 있는 업무구분은 삭제할 수 없습니다. 문서를 먼저 이동하거나 삭제해 주세요.');
    try {await stmt(env,'DELETE FROM work_categories WHERE id=?',id).run();} catch(e) {if(String(e).includes('FOREIGN KEY'))fail(409,'등록된 문서가 있는 업무구분은 삭제할 수 없습니다.');throw e;}
    return json({ok:true});
  }
  const body=await readJSON(request),name=clean(body.name,'분류명',80,true);
  if(body.parent_id!=null&&body.parent_id!=='')fail(400,'업무구분은 하위분류 없이 1단계로만 등록할 수 있습니다.');
  const key=id||uid();
  try {
    await (id?stmt(env,'UPDATE work_categories SET name=? WHERE id=?',name,id):stmt(env,'INSERT INTO work_categories(id,name,created_at,sort_order) SELECT ?,?,?,COALESCE(MAX(sort_order),-1)+1 FROM work_categories',key,name,now())).run();
  }catch(e){if(String(e).includes('UNIQUE')||String(e).includes('동일한 이름'))fail(409,'동일한 이름의 업무구분이 있습니다.');throw e;}
  return json({id:key},id?200:201);
}
async function reorderCategories(request,env){
  const body=await readJSON(request),ordered=ids(body.ids,'업무구분',1000),previous=ids(body.previous_ids,'기존 업무구분',1000);
  if(ordered.length!==body.ids.length||previous.length!==body.previous_ids.length)fail(400,'업무구분 순서에 중복된 항목이 있습니다.');
  const current=(await rows(env,'SELECT id FROM work_categories ORDER BY sort_order,id')).map(c=>c.id);
  if(JSON.stringify(previous)!==JSON.stringify(current))fail(409,'업무구분 목록 또는 순서가 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
  if(ordered.length!==current.length||ordered.some(id=>!current.includes(id)))fail(400,'모든 업무구분을 빠짐없이 한 번씩 지정해 주세요.');
  if(!current.length)return json({ok:true});
  const result=await stmt(env,`WITH before_order AS MATERIALIZED (
    SELECT json_group_array(id) token FROM (SELECT id FROM work_categories ORDER BY sort_order,id)
  ) UPDATE work_categories SET sort_order=(SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value=work_categories.id)
    WHERE (SELECT token FROM before_order)=?`,JSON.stringify(ordered),JSON.stringify(previous)).run();
  if(result.meta.changes!==current.length)fail(409,'업무구분 목록 또는 순서가 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
  return json({ok:true});
}
function searchClause(url, alias='s') {
  const clauses=[],args=[];
  for(const [param,column] of [['title','title'],['manager','manager']]) {
    const val=(url.searchParams.get(param)||'').normalize('NFC').trim();
    if(val){if([...val].length>100)fail(400,'검색어는 100자 이하로 입력해 주세요.');clauses.push(`instr(lower(${alias}.${column}),lower(?))>0`);args.push(val);}
  }
  const year=(url.searchParams.get('year')||'').trim(),month=(url.searchParams.get('month')||'').trim();
  if(month&&!year)fail(400,'월을 검색하려면 연도를 입력해 주세요.');
  if(year){
    if(!/^\d{4}$/.test(year)||Number(year)<1900||Number(year)>9999)fail(400,'검색 연도는 1900~9999 사이의 4자리 숫자로 입력해 주세요.');
    if(month&&!/^(0?[1-9]|1[0-2])$/.test(month))fail(400,'검색 월은 1~12 사이로 입력해 주세요.');
    const firstMonth=month?String(Number(month)).padStart(2,'0'):'01',lastMonth=month?firstMonth:'12';
    const lastDay=new Date(Date.UTC(Number(year),Number(lastMonth),0)).getUTCDate();
    clauses.push(`${alias}.revision_date>=?`,`${alias}.revision_date<=?`);args.push(`${year}-${firstMonth}-01`,`${year}-${lastMonth}-${lastDay}`);
  }
  for(const [param,operator] of [['from','>='],['to','<=']]) {
    const val=url.searchParams.get(param);
    if(val){validDate(val,'검색 날짜');clauses.push(`${alias}.revision_date${operator}?`);args.push(val);}
  }
  if(url.searchParams.get('from')&&url.searchParams.get('to')&&url.searchParams.get('from')>url.searchParams.get('to'))fail(400,'검색 시작일은 종료일보다 늦을 수 없습니다.');
  return {sql:clauses.length?clauses.join(' AND '):'1=1',args};
}
async function listDocuments(url,env) {
  const search=searchClause(url),category=url.searchParams.get('category');
  const filter=category?'AND d.category_id=?':'';
  const result=await env.DB.batch([
    stmt(env,`SELECT d.id FROM documents d WHERE EXISTS(SELECT 1 FROM revisions s WHERE s.document_id=d.id AND ${search.sql}) ${filter}`,...search.args,...(category?[category]:[])),
    stmt(env,`SELECT d.id,d.organization_id,d.category_id,d.document_type,o.name organization_name,c.name category_name,c.name category_path,c.sort_order category_order,
      r.id revision_id,r.title,r.revision_date,r.summary,r.manager,r.approval_no,r.sequence,r.updated_at,
      (SELECT count(*) FROM revisions v WHERE v.document_id=d.id) revision_count,
      (SELECT count(*) FROM attachments a WHERE a.revision_id=r.id) attachment_count,
      CASE WHEN ${search.sql.replaceAll('s.','r.')} THEN 0 ELSE 1 END history_match,
      p.kwwa_id,p.upper_id
      FROM documents d JOIN organizations o ON o.id=d.organization_id JOIN work_categories c ON c.id=d.category_id
      JOIN revisions r ON r.document_id=d.id AND r.sequence=(SELECT MAX(sequence) FROM revisions WHERE document_id=d.id)
      LEFT JOIN document_pairs p ON p.kwwa_id=d.id OR p.upper_id=d.id
      ORDER BY c.sort_order,c.id,r.revision_date DESC,d.id`,...search.args)
  ]);
  const matches=new Set(result[0].results.map(d=>d.id)),all=new Map(result[1].results.map(d=>[d.id,{...d,search_match:matches.has(d.id),history_match:matches.has(d.id)?d.history_match:0}]));
  const seen=new Set(),pairedRows=[];
  for(const document of all.values()){
    const key=document.kwwa_id||document.id;if(seen.has(key))continue;seen.add(key);
    const kwwa=document.kwwa_id?all.get(document.kwwa_id):(document.organization_id==='kwwa'?document:null);
    const upper=document.upper_id?all.get(document.upper_id):(document.organization_id==='upper'?document:null);
    if(!matches.has(kwwa?.id)&&!matches.has(upper?.id))continue;
    const anchor=kwwa||upper;pairedRows.push({category_id:anchor.category_id,category_path:anchor.category_path,category_order:anchor.category_order,kwwa:kwwa||null,upper:upper||null});
  }
  pairedRows.sort((a,b)=>{const left=a.kwwa||a.upper,right=b.kwwa||b.upper;return a.category_order-b.category_order||a.category_id.localeCompare(b.category_id)||DOCUMENT_TYPES.indexOf(left.document_type)-DOCUMENT_TYPES.indexOf(right.document_type)||right.revision_date.localeCompare(left.revision_date)||left.title.localeCompare(right.title,'ko')||left.id.localeCompare(right.id);});
  return json({rows:pairedRows,documents:pairedRows.flatMap(row=>[row.kwwa,row.upper].filter(Boolean))});
}
async function detail(env,id) {
  const partnerSql=`SELECT CASE WHEN kwwa_id=? THEN upper_id ELSE kwwa_id END FROM document_pairs WHERE kwwa_id=? OR upper_id=?`;
  const scope=`SELECT ? UNION ${partnerSql}`,args=[id,id,id,id];
  const result=await env.DB.batch([
    stmt(env,`SELECT d.*,o.name organization_name,c.name category_name FROM documents d JOIN organizations o ON o.id=d.organization_id JOIN work_categories c ON c.id=d.category_id WHERE d.id IN (${scope})`,...args),
    stmt(env,`SELECT * FROM revisions WHERE document_id IN (${scope}) ORDER BY document_id,sequence DESC`,...args),
    stmt(env,`SELECT a.id,a.revision_id,a.name,a.size,a.mime,a.created_at FROM attachments a JOIN revisions r ON r.id=a.revision_id WHERE r.document_id IN (${scope}) ORDER BY a.created_at,a.name`,...args)
  ]);
  if(!result[0].results.some(d=>d.id===id))fail(404,'문서를 찾을 수 없습니다. 삭제되었을 수 있습니다.');
  const files=new Map(),revisions=new Map();
  for(const file of result[2].results){if(!files.has(file.revision_id))files.set(file.revision_id,[]);files.get(file.revision_id).push(file);}
  for(const revision of result[1].results){if(!revisions.has(revision.document_id))revisions.set(revision.document_id,[]);revisions.get(revision.document_id).push({...revision,attachments:files.get(revision.id)||[]});}
  const bundles=result[0].results.map(document=>({document,revisions:revisions.get(document.id)||[],related_document_id:result[0].results.find(d=>d.id!==document.id)?.id||null}));
  const current=bundles.find(b=>b.document.id===id),related=bundles.filter(b=>b.document.id!==id);
  return json({...current,related_documents:related,columns:{kwwa:bundles.find(b=>b.document.organization_id==='kwwa')||null,upper:bundles.find(b=>b.document.organization_id==='upper')||null}});
}
async function references(url,env) {
  const side=url.searchParams.get('exclude_org'),category=url.searchParams.get('category'),current=url.searchParams.get('document')||'';
  if(!['kwwa','upper'].includes(side))fail(400,'기관 구분을 먼저 선택해 주세요.');
  if(!category)fail(400,'업무구분을 먼저 선택해 주세요.');
  const q=(url.searchParams.get('q')||'').normalize('NFC').trim().slice(0,100);
  const list=await rows(env,`SELECT d.id,d.organization_id,d.category_id,d.document_type,o.name organization_name,r.id revision_id,r.title,r.revision_date,r.sequence
    FROM documents d JOIN organizations o ON o.id=d.organization_id JOIN revisions r ON r.document_id=d.id
    WHERE d.organization_id<>? AND d.category_id=? AND d.id<>?
      AND r.sequence=(SELECT MAX(sequence) FROM revisions WHERE document_id=d.id)
      AND instr(lower(r.title),lower(?))>0
      AND NOT EXISTS(SELECT 1 FROM document_pairs p WHERE (p.kwwa_id=d.id OR p.upper_id=d.id) AND p.kwwa_id<>? AND p.upper_id<>?)
    ORDER BY r.title COLLATE NOCASE,r.revision_date DESC LIMIT 101`,side,category,current,q,current,current);
  return json({documents:list.slice(0,100),has_more:list.length>100});
}
async function parsedRevision(request) {
  if(!request.headers.get('Content-Type')?.startsWith('multipart/form-data'))fail(415,'파일 전송 형식이 올바르지 않습니다.');
  if(Number(request.headers.get('Content-Length')||0)>MAX_TOTAL+200000)fail(413,'한 번에 첨부하는 파일은 총 40MB 이하여야 합니다.');
  let form;try{form=await request.formData();}catch{fail(400,'첨부파일을 읽지 못했습니다.');}
  let data;try{data=JSON.parse(form.get('payload'));}catch{fail(400,'문서 입력값을 확인해 주세요.');}
  if(!data||typeof data!=='object')fail(400,'입력값을 확인해 주세요.');
  const fields={title:clean(data.title,'문서명',50,true),revision_date:validDate(data.revision_date),summary:clean(data.summary,'설명',300),manager:clean(data.manager,'담당자',100,true),approval_no:clean(data.approval_no,'참조 문서번호',10)};
  const organization=clean(data.organization_id,'기관',80,true),category=clean(data.category_id,'업무구분',80,true);
  const documentType=data.document_type===undefined?null:clean(data.document_type,'문서종류',20,true);
  if(documentType&&!DOCUMENT_TYPES.includes(documentType))fail(400,'문서종류는 지침·매뉴얼·가이드라인·기타 중에서 선택해 주세요.');
  if(data.relations!==undefined)fail(400,'문서 연결 방식이 변경되었습니다. 화면을 새로고침한 후 다시 저장해 주세요.');
  const keep=ids(data.keep_attachments||[],'첨부파일',20),related=clean(data.related_document_id,'연관문서',80);
  const hasRelated=Object.prototype.hasOwnProperty.call(data,'related_document_id');
  const files=form.getAll('files').filter(x=>typeof x!=='string'&&x.name);
  if(files.length+keep.length>20)fail(400,'첨부파일은 이력당 20개까지 등록할 수 있습니다.');
  if(files.some(f=>f.size>MAX_FILE))fail(413,'파일 한 개의 크기는 20MB 이하여야 합니다.');
  if(files.reduce((s,f)=>s+f.size,0)>MAX_TOTAL)fail(413,'한 번에 첨부하는 파일은 총 40MB 이하여야 합니다.');
  return {data,fields,organization,category,documentType,keep,related,hasRelated,files};
}
async function cleanup(env) {
  const garbage=await rows(env,'SELECT storage_key FROM file_garbage LIMIT 50');
  for(const item of garbage){try{await env.FILES.delete(item.storage_key);await stmt(env,'DELETE FROM file_garbage WHERE storage_key=?',item.storage_key).run();}catch{ /* Retry at the next mutation. */ }}
}
async function saveRevision(request,env,ctx,documentId,revisionId) {
  const {data,fields,organization,category,documentType,keep,related,hasRelated,files}=await parsedRevision(request);
  let original=null;
  if(revisionId){original=await first(env,'SELECT * FROM revisions WHERE id=?',revisionId);if(!original)fail(404,'수정할 이력을 찾을 수 없습니다.');documentId=original.document_id;if(data.token!==original.token)fail(409,'다른 창에서 변경된 이력입니다. 새로고침 후 다시 수정해 주세요.');}
  const existingDocument=documentId?await first(env,'SELECT * FROM documents WHERE id=?',documentId):null;
  if(documentId&&!existingDocument)fail(404,'문서를 찾을 수 없습니다.');
  const type=documentType||existingDocument?.document_type||'지침';
  if(!['kwwa','upper'].includes(organization))fail(400,'기관 구분은 한국상하수도협회 또는 상위기관을 선택해 주세요.');
  if(!await first(env,'SELECT 1 FROM work_categories WHERE id=?',category))fail(400,'업무구분을 선택해 주세요.');
  if(keep.length&&!revisionId)fail(400,'이전 이력의 첨부파일은 원본 이력에서 확인해 주세요. 새 이력에는 파일을 첨부해 주세요.');
  if(keep.length){const owned=await rows(env,'SELECT id FROM attachments WHERE revision_id=?',revisionId);if(keep.some(id=>!owned.some(a=>a.id===id)))fail(400,'기존 첨부파일을 확인해 주세요.');}
  const docId=documentId||uid(),revId=revisionId||uid(),token=uid(),time=now(),uploaded=[];
  const pair=documentId?await first(env,'SELECT * FROM document_pairs WHERE kwwa_id=? OR upper_id=?',docId,docId):null;
  const previous=pair?(pair.kwwa_id===docId?pair.upper_id:pair.kwwa_id):'';
  const target=hasRelated?related:previous;
  if(target){
    if(target===docId)fail(400,'현재 문서를 연관문서로 선택할 수 없습니다.');
    const other=await first(env,'SELECT * FROM documents WHERE id=?',target);
    if(!other)fail(400,'삭제되었거나 존재하지 않는 연관문서입니다.');
    if(other.organization_id===organization)fail(400,'연관문서는 서로 다른 기관 구분의 문서끼리 연결해 주세요.');
    if(other.category_id!==category)fail(400,'연관문서와 같은 업무구분을 선택해 주세요.');
    if(await first(env,'SELECT 1 FROM document_pairs WHERE (kwwa_id=? OR upper_id=?) AND kwwa_id<>? AND upper_id<>?',target,target,docId,docId))fail(409,'이미 다른 문서와 연결된 문서입니다. 다른 연관문서를 선택해 주세요.');
  }
  try {
    for(const file of files){const id=uid(),key=`attachments/${docId}/${revId}/${id}`,name=clean(file.name,'파일명',255,true),mime=clean(file.type,'파일 형식',150)||'application/octet-stream';await env.FILES.put(key,file.stream(),{httpMetadata:{contentType:'application/octet-stream'}});uploaded.push({id,key,name,size:file.size,mime});}
    const commands=[],f=[fields.title,fields.revision_date,fields.summary,fields.manager,fields.approval_no];
    const guard=revisionId?'EXISTS(SELECT 1 FROM revisions WHERE id=? AND token=?)':'1=1',guardArgs=revisionId?[revId,token]:[];
    if(revisionId)commands.push(stmt(env,'UPDATE revisions SET title=?,revision_date=?,summary=?,manager=?,approval_no=?,token=?,updated_at=? WHERE id=? AND token=?',...f,token,time,revId,data.token));
    if(documentId)commands.push(stmt(env,`DELETE FROM document_pairs WHERE (kwwa_id=? OR upper_id=?) AND ${guard}`,docId,docId,...guardArgs));
    if(!documentId)commands.push(stmt(env,'INSERT INTO documents(id,organization_id,category_id,created_at,document_type) VALUES(?,?,?,?,?)',docId,organization,category,time,type));
    else commands.push(stmt(env,`UPDATE documents SET organization_id=?,category_id=?,document_type=? WHERE id=? AND ${guard}`,organization,category,type,docId,...guardArgs));
    if(!revisionId)commands.push(stmt(env,'INSERT INTO revisions (id,document_id,sequence,title,revision_date,summary,manager,approval_no,token,created_at,updated_at) SELECT ?,?,COALESCE(MAX(sequence),0)+1,?,?,?,?,?,?,?,? FROM revisions WHERE document_id=?',revId,docId,...f,token,time,time,docId));
    if(target)commands.push(stmt(env,`INSERT INTO document_pairs(kwwa_id,upper_id,created_at) SELECT ?,?,? WHERE ${guard}`,organization==='kwwa'?docId:target,organization==='upper'?docId:target,time,...guardArgs));
    if(revisionId)commands.push(stmt(env,`DELETE FROM attachments WHERE revision_id=? ${keep.length?`AND id NOT IN (${keep.map(()=>'?').join(',')})`:''} AND ${guard}`,revId,...keep,...guardArgs));
    for(const file of uploaded)commands.push(stmt(env,`INSERT INTO attachments (id,revision_id,storage_key,name,size,mime,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,file.id,revId,file.key,file.name,file.size,file.mime,time,...guardArgs));
    const result=await env.DB.batch(commands);
    if(revisionId&&result[0].meta.changes===0)fail(409,'다른 창에서 변경된 이력입니다. 새로고침 후 다시 수정해 주세요.');
    ctx.waitUntil(cleanup(env));return json({document_id:docId,revision_id:revId},revisionId?200:201);
  }catch(e){for(const file of uploaded){try{await env.FILES.delete(file.key);}catch{}}if(/UNIQUE constraint failed: document_pairs/.test(String(e)))fail(409,'이미 다른 문서와 연결된 문서입니다. 다른 연관문서를 선택해 주세요.');if(/FOREIGN KEY constraint failed/.test(String(e)))fail(409,'문서 또는 연관문서가 변경되었거나 삭제되었습니다. 새로고침 후 다시 시도해 주세요.');throw e;}
}
async function deleteRevision(request,env,ctx,id) {
  const body=await readJSON(request),rev=await first(env,'SELECT * FROM revisions WHERE id=?',id);
  if(!rev)fail(404,'이력을 찾을 수 없습니다.');
  if(rev.token!==body.token)fail(409,'변경된 이력입니다. 새로고침 후 다시 시도해 주세요.');
  const result=await env.DB.batch([
    stmt(env,'DELETE FROM revisions WHERE id=? AND token=?',id,body.token),
    stmt(env,'DELETE FROM documents WHERE id=? AND NOT EXISTS(SELECT 1 FROM revisions WHERE document_id=documents.id)',rev.document_id)
  ]);
  if(!result[0].meta.changes)fail(409,'변경된 이력입니다. 새로고침 후 다시 시도해 주세요.');
  ctx.waitUntil(cleanup(env));return json({ok:true,document_id:rev.document_id,document_deleted:result[1].meta.changes>0});
}
async function deleteDocument(request,env,ctx,id) {
  const body=await readJSON(request);
  const result=await stmt(env,`DELETE FROM documents WHERE id=? AND EXISTS(SELECT 1 FROM revisions r WHERE r.document_id=documents.id AND r.token=? AND r.sequence=(SELECT MAX(sequence) FROM revisions WHERE document_id=documents.id))`,id,body.token||'').run();
  if(!result.meta.changes)fail(409,'문서가 변경되었거나 삭제되었습니다. 새로고침 후 다시 시도해 주세요.');
  ctx.waitUntil(cleanup(env));return json({ok:true});
}
async function download(env,id) {
  const file=await first(env,'SELECT * FROM attachments WHERE id=?',id);if(!file)fail(404,'첨부파일을 찾을 수 없습니다.');
  const object=await env.FILES.get(file.storage_key);if(!object)fail(404,'첨부파일을 찾을 수 없습니다. 관리자에게 문의해 주세요.');
  return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(file.size),'Content-Disposition':`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`}});
}
async function route(request,env,ctx) {
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(!path.startsWith('/api/')){
    if(!['GET','HEAD'].includes(method))fail(405,'허용되지 않는 요청입니다.');
    const asset=await env.ASSETS.fetch(request);
    return asset.status===404&&request.headers.get('Accept')?.includes('text/html')?env.ASSETS.fetch(new Request(new URL('/index.html',url),request)):asset;
  }
  if(!['GET','HEAD'].includes(method)&&request.headers.get('Origin')!==url.origin)fail(403,'같은 사이트에서만 변경할 수 있습니다. 페이지를 새로고침해 주세요.');
  if(path==='/api/session'&&method==='GET'){const user=await authorized(request,env);return json({authenticated:!!user,user,configured:configReady(env),username:env.ADMIN_USER||'admin'});}
  if(path==='/api/login'&&method==='POST')return login(request,env);
  if(path==='/api/health'&&method==='GET'){if(configReady(env))await ensureAdministrator(env);return json({ready:configReady(env)&&!!await first(env,'SELECT id FROM users WHERE is_admin=1 AND active=1'),account_management:true,login_attempt_limit:false});}
  const user=await authorized(request,env);
  if(!user)fail(401,'로그인이 필요합니다. 다시 로그인해 주세요.');
  if(path==='/api/logout'&&method==='POST'){await stmt(env,'DELETE FROM user_sessions WHERE token_hash=?',await digest(cookieValue(request))).run();return json({ok:true},200,{'Set-Cookie':sessionCookie(request,'',0)});}
  if(path==='/api/me'&&method==='GET')return json({user});
  if(path==='/api/me/password'&&method==='PUT')return changeOwnPassword(request,env,user);
  if(path==='/api/users'&&method==='GET')return listUsers(env,user);
  if(path==='/api/users'&&method==='POST')return mutateUser(request,env,user);
  const account=path.match(/^\/api\/users\/([\w-]+)$/);
  if(account){requireAdministrator(user);if(['PUT','DELETE'].includes(method))return mutateUser(request,env,user,account[1]);fail(405,'허용되지 않는 요청입니다.');}
  if(path==='/api/bootstrap'&&method==='GET')return bootstrap(env,user);
  if(path==='/api/categories/order'&&method==='PUT')return reorderCategories(request,env);
  const category=path.match(/^\/api\/(organizations|categories)(?:\/([\w-]+))?$/);
  if(category&&['POST','PUT','DELETE'].includes(method)){if(category[1]==='organizations')fail(405,'기관 구분은 한국상하수도협회와 상위기관으로 고정되어 있습니다.');if((method==='POST'&&category[2])||(method!=='POST'&&!category[2]))fail(405,'허용되지 않는 요청입니다.');return categoryMutation(request,env,category[2]);}
  if(path==='/api/documents'&&method==='GET')return listDocuments(url,env);
  if(path==='/api/documents'&&method==='POST')return saveRevision(request,env,ctx);
  if(path==='/api/references'&&method==='GET')return references(url,env);
  const document=path.match(/^\/api\/documents\/([\w-]+)$/);
  if(document&&method==='GET')return detail(env,document[1]);
  if(document&&method==='DELETE')return deleteDocument(request,env,ctx,document[1]);
  const append=path.match(/^\/api\/documents\/([\w-]+)\/revisions$/);
  if(append&&method==='POST')return saveRevision(request,env,ctx,append[1]);
  const revision=path.match(/^\/api\/revisions\/([\w-]+)$/);
  if(revision&&method==='PUT')return saveRevision(request,env,ctx,null,revision[1]);
  if(revision&&method==='DELETE')return deleteRevision(request,env,ctx,revision[1]);
  const file=path.match(/^\/api\/files\/([\w-]+)$/);
  if(file&&method==='GET')return download(env,file[1]);
  fail(404,'요청한 항목을 찾을 수 없습니다.');
}
export default {async fetch(request,env,ctx){
  let response;try{response=await route(request,env,ctx);}catch(e){
    const message=String(e.message||e);
    const known=message.match(/(연관문서는 서로 다른 기관 구분의 같은 업무구분 문서끼리 연결해 주세요\.|연관문서 연결을 해제하거나 동일한 업무구분을 선택해 주세요\.)/);
    response=json({error:e.status?e.message:known?known[1]:'처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},e.status||(known?409:500));
    if(!e.status&&!known)console.error('request_failed',new URL(request.url).pathname,message.replace(/\n/g,' ').slice(0,500));
  }
  const headers=new Headers(response.headers);
  headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','same-origin');headers.set('X-Frame-Options','DENY');
  headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  headers.set('Cache-Control','no-store');
  if(new URL(request.url).protocol==='https:')headers.set('Strict-Transport-Security','max-age=31536000');
  return new Response(response.body,{status:response.status,headers});
}};
