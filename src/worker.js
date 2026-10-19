const MAX_FILE = 20 * 1024 * 1024;
const MAX_TOTAL = 40 * 1024 * 1024;
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
  if (!/^[a-f0-9]{64}$/.test(token) || !env.DB) return false;
  return !!await first(env,'SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?',await digest(token),Date.now());
}
async function passwordMatches(value, env) {
  if (env.ADMIN_PASSWORD_HASH) {
    const [algorithm,iterations,salt,expected] = env.ADMIN_PASSWORD_HASH.split('$');
    if (algorithm!=='pbkdf2' || !/^\d+$/.test(iterations) || !salt || !expected) return false;
    const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);
    const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:Number(iterations),salt:new TextEncoder().encode(salt)},key,256);
    const actual = [...new Uint8Array(bits)].map(b=>b.toString(16).padStart(2,'0')).join('');
    return constantTime(actual,expected);
  }
  return constantTime(await digest(value), await digest(env.ADMIN_PASSWORD));
}
function constantTime(a,b) { if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0; }
async function readJSON(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415,'요청 형식이 올바르지 않습니다.');
  if (Number(request.headers.get('Content-Length')||0)>100000) fail(413,'요청이 너무 큽니다.');
  try {const data = await request.json();if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'입력값을 확인해 주세요.');return data;} catch { fail(400,'입력값을 확인해 주세요.'); }
}
async function login(request, env) {
  if (!configReady(env)) fail(503,'사이트 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.');
  const body = await readJSON(request);
  const ipHash = await digest(request.headers.get('CF-Connecting-IP') || 'local');
  const prior = await first(env,'SELECT * FROM login_attempts WHERE ip_hash=?',ipHash);
  if (prior?.failures>=5 && prior.blocked_until>Date.now()) fail(429,'로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.');
  const name = typeof body.username==='string'?body.username.slice(0,100):'';
  const password = typeof body.password==='string'?body.password:'';
  if (password.length>256 || name !== (env.ADMIN_USER||'admin') || !await passwordMatches(password,env)) {
    await stmt(env,`INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET failures=CASE WHEN blocked_until<? THEN 1 ELSE failures+1 END, blocked_until=CASE WHEN blocked_until<? THEN excluded.blocked_until ELSE blocked_until END`,ipHash,Date.now()+900000,Date.now(),Date.now()).run();
    fail(401,'아이디 또는 비밀번호가 올바르지 않습니다.');
  }
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
  await env.DB.batch([stmt(env,'DELETE FROM login_attempts WHERE ip_hash=?',ipHash),stmt(env,'INSERT INTO sessions VALUES(?,?)',await digest(token),Date.now()+43200000),stmt(env,'DELETE FROM sessions WHERE expires_at<?',Date.now())]);
  return json({ok:true},200,{'Set-Cookie':sessionCookie(request,token,43200)});
}
async function bootstrap(env) {
  const results = await env.DB.batch([
    stmt(env,'SELECT * FROM organizations ORDER BY name COLLATE NOCASE'),
    stmt(env,'SELECT * FROM work_categories ORDER BY name COLLATE NOCASE'),
    stmt(env,`SELECT (SELECT count(*) FROM documents) documents, (SELECT count(*) FROM revisions) revisions, (SELECT count(*) FROM organizations) organizations, (SELECT count(DISTINCT document_id) FROM revisions WHERE updated_at>=?) recent`,new Date(Date.now()-30*86400000).toISOString())
  ]);
  return json({organizations:results[0].results,categories:results[1].results,stats:results[2].results[0]});
}
async function categoryMutation(request, env, kind, id) {
  const table = kind==='organizations'?'organizations':'work_categories';
  const existing = id ? await first(env,`SELECT * FROM ${table} WHERE id=?`,id) : null;
  if (id&&!existing) fail(404,'분류를 찾을 수 없습니다.');
  if(request.method==='DELETE') {
    try {await stmt(env,`DELETE FROM ${table} WHERE id=?`,id).run();} catch {fail(409,'사용 중인 분류입니다. 연결된 문서 또는 하위 분류를 먼저 이동하거나 삭제해 주세요.');}
    return json({ok:true});
  }
  const body=await readJSON(request),name=clean(body.name,'분류명',80,true);
  const parent=kind==='categories'?(body.parent_id||null):null;
  if(parent) {
    const p=await first(env,'SELECT * FROM work_categories WHERE id=?',parent);
    if(!p||p.parent_id||parent===id)fail(400,'상위 업무구분을 확인해 주세요. 2단계까지만 등록할 수 있습니다.');
  }
  const key=id||uid();
  try {
    if(kind==='organizations')await (id?stmt(env,'UPDATE organizations SET name=? WHERE id=?',name,id):stmt(env,'INSERT INTO organizations VALUES(?,?,?)',key,name,now())).run();
    else await (id?stmt(env,'UPDATE work_categories SET name=?,parent_id=? WHERE id=?',name,parent,id):stmt(env,'INSERT INTO work_categories VALUES(?,?,?,?)',key,name,parent,now())).run();
  }catch(e){if(String(e).includes('UNIQUE'))fail(409,'동일한 이름의 분류가 있습니다.');if(String(e).includes('2단계'))fail(400,'하위 분류가 있는 업무구분은 다른 분류 아래로 옮길 수 없습니다.');throw e;}
  return json({id:key},id?200:201);
}
function searchClause(url, alias='s') {
  const clauses=[],args=[];
  for(const [param,column] of [['title','title'],['manager','manager']]) {
    const val=(url.searchParams.get(param)||'').normalize('NFC').trim();
    if(val){if([...val].length>100)fail(400,'검색어는 100자 이하로 입력해 주세요.');clauses.push(`instr(lower(${alias}.${column}),lower(?))>0`);args.push(val);}
  }
  for(const [param,operator] of [['from','>='],['to','<=']]) {
    const val=url.searchParams.get(param);
    if(val){validDate(val,'검색 날짜');clauses.push(`${alias}.revision_date${operator}?`);args.push(val);}
  }
  if(url.searchParams.get('from')&&url.searchParams.get('to')&&url.searchParams.get('from')>url.searchParams.get('to'))fail(400,'검색 시작일은 종료일보다 늦을 수 없습니다.');
  return {sql:clauses.length?clauses.join(' AND '):'1=1',args};
}
async function listDocuments(url,env) {
  const where=[],args=[],search=searchClause(url);
  const org=url.searchParams.get('organization'),cat=url.searchParams.get('category');
  if(org){where.push('d.organization_id=?');args.push(org);}
  if(cat){where.push('(d.category_id=? OR c.parent_id=?)');args.push(cat,cat);}
  where.push(`EXISTS(SELECT 1 FROM revisions s WHERE s.document_id=d.id AND ${search.sql})`);args.push(...search.args);
  const list=await rows(env,`SELECT d.id,d.organization_id,d.category_id,o.name organization_name,c.name category_name,c.parent_id,
    r.id revision_id,r.title,r.revision_date,r.summary,r.manager,r.approval_no,r.sequence,r.updated_at,
    (SELECT count(*) FROM revisions v WHERE v.document_id=d.id) revision_count,
    (SELECT count(*) FROM attachments a WHERE a.revision_id=r.id) attachment_count,
    (SELECT count(*) FROM relations l WHERE l.source_id=r.id) relation_count,
    CASE WHEN ${search.sql.replaceAll('s.','r.')} THEN 0 ELSE 1 END history_match
    FROM documents d JOIN organizations o ON o.id=d.organization_id JOIN work_categories c ON c.id=d.category_id
    JOIN revisions r ON r.document_id=d.id AND r.sequence=(SELECT MAX(sequence) FROM revisions WHERE document_id=d.id)
    WHERE ${where.join(' AND ')} ORDER BY r.revision_date DESC,r.updated_at DESC,d.id`,...search.args,...args);
  return json({documents:list});
}
async function detail(env,id) {
  const document=await first(env,`SELECT d.*,o.name organization_name,c.name category_name,c.parent_id FROM documents d JOIN organizations o ON o.id=d.organization_id JOIN work_categories c ON c.id=d.category_id WHERE d.id=?`,id);
  if(!document)fail(404,'문서를 찾을 수 없습니다. 삭제되었을 수 있습니다.');
  const result=await env.DB.batch([
    stmt(env,'SELECT * FROM revisions WHERE document_id=? ORDER BY sequence DESC',id),
    stmt(env,`SELECT a.id,a.revision_id,a.name,a.size,a.mime,a.created_at FROM attachments a JOIN revisions r ON r.id=a.revision_id WHERE r.document_id=? ORDER BY a.created_at,a.name`,id),
    stmt(env,`SELECT l.source_id,r.id,r.document_id,r.title,r.revision_date,r.sequence,d.organization_id,o.name organization_name FROM relations l JOIN revisions s ON s.id=l.source_id JOIN revisions r ON r.id=l.target_id JOIN documents d ON d.id=r.document_id JOIN organizations o ON o.id=d.organization_id WHERE s.document_id=? ORDER BY o.name,r.title,r.sequence DESC`,id),
    stmt(env,`SELECT l.target_id,r.id,r.document_id,r.title,r.revision_date,r.sequence,o.name organization_name FROM relations l JOIN revisions t ON t.id=l.target_id JOIN revisions r ON r.id=l.source_id JOIN documents d ON d.id=r.document_id JOIN organizations o ON o.id=d.organization_id WHERE t.document_id=? ORDER BY o.name,r.title`,id)
  ]);
  return json({document,revisions:result[0].results.map(r=>({...r,attachments:result[1].results.filter(a=>a.revision_id===r.id),relations:result[2].results.filter(a=>a.source_id===r.id),backlinks:result[3].results.filter(a=>a.target_id===r.id)}))});
}
async function references(url,env) {
  const exclude=url.searchParams.get('exclude_org');if(!exclude)fail(400,'문서의 기관을 먼저 선택해 주세요.');
  const q=(url.searchParams.get('q')||'').normalize('NFC').trim().slice(0,100);
  const org=url.searchParams.get('organization');
  const list=await rows(env,`SELECT r.id,r.document_id,r.title,r.revision_date,r.sequence,o.name organization_name,d.organization_id,
    CASE WHEN r.sequence=(SELECT MAX(sequence) FROM revisions WHERE document_id=d.id) THEN 1 ELSE 0 END is_latest
    FROM revisions r JOIN documents d ON d.id=r.document_id JOIN organizations o ON o.id=d.organization_id
    WHERE d.organization_id<>? AND (instr(lower(r.title),lower(?))>0 OR instr(lower(o.name),lower(?))>0)
    ${org?'AND d.organization_id=?':''} ORDER BY o.name,r.title COLLATE NOCASE,r.sequence DESC LIMIT 101`,exclude,q,q,...(org?[org]:[]));
  return json({revisions:list.slice(0,100),has_more:list.length>100});
}
async function parsedRevision(request) {
  if(!request.headers.get('Content-Type')?.startsWith('multipart/form-data'))fail(415,'파일 전송 형식이 올바르지 않습니다.');
  if(Number(request.headers.get('Content-Length')||0)>MAX_TOTAL+200000)fail(413,'한 번에 첨부하는 파일은 총 40MB 이하여야 합니다.');
  let form;try{form=await request.formData();}catch{fail(400,'첨부파일을 읽지 못했습니다.');}
  let data;try{data=JSON.parse(form.get('payload'));}catch{fail(400,'문서 입력값을 확인해 주세요.');}
  if(!data||typeof data!=='object')fail(400,'입력값을 확인해 주세요.');
  const fields={title:clean(data.title,'문서명',50,true),revision_date:validDate(data.revision_date),summary:clean(data.summary,'주요내용',300),manager:clean(data.manager,'담당자',100,true),approval_no:clean(data.approval_no,'참조 결재번호',10)};
  const organization=clean(data.organization_id,'기관',80,true),category=clean(data.category_id,'업무구분',80,true);
  const keep=ids(data.keep_attachments||[],'첨부파일',20),relations=ids(data.relations||[],'연관문서');
  const files=form.getAll('files').filter(x=>typeof x!=='string'&&x.name);
  if(files.length+keep.length>20)fail(400,'첨부파일은 이력당 20개까지 등록할 수 있습니다.');
  if(files.some(f=>f.size>MAX_FILE))fail(413,'파일 한 개의 크기는 20MB 이하여야 합니다.');
  if(files.reduce((s,f)=>s+f.size,0)>MAX_TOTAL)fail(413,'한 번에 첨부하는 파일은 총 40MB 이하여야 합니다.');
  return {data,fields,organization,category,keep,relations,files};
}
async function cleanup(env) {
  const garbage=await rows(env,'SELECT storage_key FROM file_garbage LIMIT 50');
  for(const item of garbage){try{await env.FILES.delete(item.storage_key);await stmt(env,'DELETE FROM file_garbage WHERE storage_key=?',item.storage_key).run();}catch{ /* Retry at the next mutation. */ }}
}
async function saveRevision(request,env,ctx,documentId,revisionId) {
  const input=await parsedRevision(request),{data,fields,organization,category,keep,relations,files}=input;
  let original=null;
  if(revisionId){original=await first(env,'SELECT * FROM revisions WHERE id=?',revisionId);if(!original)fail(404,'수정할 이력을 찾을 수 없습니다.');documentId=original.document_id;if(data.token!==original.token)fail(409,'다른 창에서 변경된 이력입니다. 새로고침 후 다시 수정해 주세요.');}
  if(documentId&&!await first(env,'SELECT 1 FROM documents WHERE id=?',documentId))fail(404,'문서를 찾을 수 없습니다.');
  if(!await first(env,'SELECT 1 FROM organizations WHERE id=?',organization))fail(400,'기관을 선택해 주세요.');
  if(!await first(env,'SELECT 1 FROM work_categories WHERE id=?',category))fail(400,'업무구분을 선택해 주세요.');
  if(keep.length&&!revisionId)fail(400,'이전 이력의 첨부파일은 원본 이력에서 확인해 주세요. 새 이력에는 파일을 첨부해 주세요.');
  if(keep.length){const owned=await rows(env,'SELECT id FROM attachments WHERE revision_id=?',revisionId);if(keep.some(id=>!owned.some(a=>a.id===id)))fail(400,'기존 첨부파일을 확인해 주세요.');}
  if(relations.length){const found=await rows(env,`SELECT r.id,d.organization_id FROM revisions r JOIN documents d ON d.id=r.document_id WHERE r.id IN (${relations.map(()=>'?').join(',')})`,...relations);if(found.length!==relations.length)fail(400,'삭제되었거나 존재하지 않는 연관문서가 있습니다.');if(found.some(x=>x.organization_id===organization))fail(400,'연관문서는 다른 기관의 문서만 선택할 수 있습니다.');}
  const docId=documentId||uid(),revId=revisionId||uid(),token=uid(),time=now(),uploaded=[];
  try {
    for(const file of files){const id=uid(),key=`attachments/${docId}/${revId}/${id}`,name=clean(file.name,'파일명',255,true),mime=clean(file.type,'파일 형식',150)||'application/octet-stream';await env.FILES.put(key,file.stream(),{httpMetadata:{contentType:'application/octet-stream'}});uploaded.push({id,key,name,size:file.size,mime});}
    const commands=[];
    const f=[fields.title,fields.revision_date,fields.summary,fields.manager,fields.approval_no];
    const guard=revisionId?'EXISTS(SELECT 1 FROM revisions WHERE id=? AND token=?)':'1=1';
    const guardArgs=revisionId?[revId,token]:[];
    if(revisionId){
      commands.push(stmt(env,'UPDATE revisions SET title=?,revision_date=?,summary=?,manager=?,approval_no=?,token=?,updated_at=? WHERE id=? AND token=?',...f,token,time,revId,data.token));
      commands.push(stmt(env,`DELETE FROM relations WHERE source_id=? AND ${guard}`,revId,...guardArgs));
      commands.push(stmt(env,`UPDATE documents SET organization_id=?,category_id=? WHERE id=? AND ${guard}`,organization,category,docId,...guardArgs));
    }else {
      if(!documentId)commands.push(stmt(env,'INSERT INTO documents VALUES(?,?,?,?)',docId,organization,category,time));
      else commands.push(stmt(env,'UPDATE documents SET organization_id=?,category_id=? WHERE id=?',organization,category,docId));
      commands.push(stmt(env,'INSERT INTO revisions (id,document_id,sequence,title,revision_date,summary,manager,approval_no,token,created_at,updated_at) SELECT ?,?,COALESCE(MAX(sequence),0)+1,?,?,?,?,?,?,?,? FROM revisions WHERE document_id=?',revId,docId,...f,token,time,time,docId));
    }
    for(const target of relations)commands.push(stmt(env,`INSERT INTO relations(source_id,target_id) SELECT ?,? WHERE ${guard}`,revId,target,...guardArgs));
    if(revisionId)commands.push(stmt(env,`DELETE FROM attachments WHERE revision_id=? ${keep.length?`AND id NOT IN (${keep.map(()=>'?').join(',')})`:''} AND ${guard}`,revId,...keep,...guardArgs));
    for(const file of uploaded)commands.push(stmt(env,`INSERT INTO attachments (id,revision_id,storage_key,name,size,mime,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,file.id,revId,file.key,file.name,file.size,file.mime,time,...guardArgs));
    const result=await env.DB.batch(commands);
    if(revisionId&&result[0].meta.changes===0)fail(409,'다른 창에서 변경된 이력입니다. 새로고침 후 다시 수정해 주세요.');
    ctx.waitUntil(cleanup(env));
    return json({document_id:docId,revision_id:revId},revisionId?200:201);
  }catch(e){for(const f of uploaded){try{await env.FILES.delete(f.key);}catch{/* Do not obscure the original error. */}}throw e;}
}
async function deleteRevision(request,env,ctx,id) {
  const body=await readJSON(request),rev=await first(env,'SELECT * FROM revisions WHERE id=?',id);
  if(!rev)fail(404,'이력을 찾을 수 없습니다.');
  if(rev.token!==body.token)fail(409,'변경된 이력입니다. 새로고침 후 다시 시도해 주세요.');
  if(rev.sequence===1)fail(409,'최초 제정 이력은 문서 전체 삭제에서 삭제해 주세요.');
  const result=await stmt(env,'DELETE FROM revisions WHERE id=? AND token=?',id,body.token).run();
  if(!result.meta.changes)fail(409,'변경된 이력입니다. 새로고침 후 다시 시도해 주세요.');
  ctx.waitUntil(cleanup(env));return json({ok:true});
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
  if(path==='/api/session'&&method==='GET')return json({authenticated:await authorized(request,env),configured:configReady(env),username:env.ADMIN_USER||'admin'});
  if(path==='/api/login'&&method==='POST')return login(request,env);
  if(path==='/api/health'&&method==='GET')return json({ready:configReady(env)});
  if(!await authorized(request,env))fail(401,'로그인이 필요합니다. 다시 로그인해 주세요.');
  if(path==='/api/logout'&&method==='POST'){await stmt(env,'DELETE FROM sessions WHERE token_hash=?',await digest(cookieValue(request))).run();return json({ok:true},200,{'Set-Cookie':sessionCookie(request,'',0)});}
  if(path==='/api/bootstrap'&&method==='GET')return bootstrap(env);
  const category=path.match(/^\/api\/(organizations|categories)(?:\/([\w-]+))?$/);
  if(category&&['POST','PUT','DELETE'].includes(method)){if((method==='POST'&&category[2])||(method!=='POST'&&!category[2]))fail(405,'허용되지 않는 요청입니다.');return categoryMutation(request,env,category[1],category[2]);}
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
    const known=message.match(/(기관 변경으로 동일 기관의 참조가 발생합니다[^\n]*|연관문서는 다른 기관의 문서만 연결할 수 있습니다\.)/);
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
