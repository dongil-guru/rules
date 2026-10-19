import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { resolve } from 'node:path';

const required=['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','ADMIN_PASSWORD'];
const absent=required.filter(k=>!process.env[k]);
if(absent.length){
 console.error('GitHub 저장소 Settings → Secrets and variables → Actions에 다음 Secret을 등록해 주세요: '+absent.join(', '));
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Cloudflare 배포 설정 필요\n\nGitHub 저장소의 **Settings → Secrets and variables → Actions**에 다음 값을 등록하세요.\n\n'+absent.map(k=>'- `'+k+'`').join('\n')+'\n\n등록한 뒤 실패한 배포 작업을 다시 실행하면 전용 D1·R2를 준비하고 사이트를 배포합니다.\n');
 process.exit(1);
}
const account=process.env.CLOUDFLARE_ACCOUNT_ID.trim();
if(!/^[a-f0-9]{32}$/i.test(account))throw new Error('CLOUDFLARE_ACCOUNT_ID는 본인 Cloudflare의 32자리 Account ID여야 합니다.');
const password=process.env.ADMIN_PASSWORD;
if(password.length<12||password.length>256)throw new Error('ADMIN_PASSWORD는 12~256자로 등록해 주세요.');
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
const cfBase=`https://api.cloudflare.com/client/v4/accounts/${account}`;
const wrangler=resolve('node_modules/wrangler/bin/wrangler.js');
async function cf(path,method='GET',body,allow404=false){
 const response=await fetch(cfBase+path,{method,headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 const result=await response.json().catch(()=>({success:false,errors:[]}));
 if(response.status===404&&allow404)return null;
 if(!response.ok||result.success===false)throw new Error(`Cloudflare ${method} ${path.split('?')[0]} 실패 (${response.status}). API 토큰의 Workers Scripts·D1·Workers R2 Storage 편집 권한과 R2 활성화 상태를 확인해 주세요. 오류 코드: ${(result.errors||[]).map(e=>e.code).join(',')}`);
 return result.result;
}
function run(args,input){
 const result=spawnSync(process.execPath,[wrangler,...args],{encoding:'utf8',input,stdio:['pipe','pipe','pipe'],env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:16*1024*1024});
 if(result.stdout)process.stdout.write(result.stdout);
 if(result.stderr)process.stderr.write(result.stderr);
 if(result.status!==0)throw new Error('배포 명령 실패: wrangler '+args.join(' '));
 return result.stdout||'';
}
async function ensureDatabase(){
 const name=config.d1_databases[0].database_name;
 const list=await cf('/d1/database?name='+encodeURIComponent(name)+'&per_page=100');
 let db=Array.isArray(list)?list.find(d=>d.name===name):null;
 if(!db){console.log('전용 D1 데이터베이스 생성');db=await cf('/d1/database','POST',{name,primary_location_hint:'apac'});}
 const id=db.uuid||db.id;
 if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error('D1 데이터베이스 식별자를 확인하지 못했습니다.');
 if(config.d1_databases[0].database_id!=='REPLACE_WITH_D1_DATABASE_ID'&&config.d1_databases[0].database_id!==id)throw new Error('기존 설정과 다른 D1 ID입니다. 운영 데이터베이스를 확인해 주세요.');
 config.d1_databases[0].database_id=id;
}
async function ensureBucket(){
 const name=config.r2_buckets[0].bucket_name;
 const bucket=await cf('/r2/buckets/'+encodeURIComponent(name),'GET',undefined,true);
 if(!bucket){console.log('전용 비공개 R2 파일 저장소 생성');await cf('/r2/buckets','POST',{name,locationHint:'apac'});}
}
async function verify(url){
 for(let attempt=0;attempt<6;attempt++){
  try{
   const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(20000)});const health=await response.json();
   if(response.ok&&health.ready){
    const login=await fetch(url+'/api/login',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({username:config.vars?.ADMIN_USER||'admin',password}),signal:AbortSignal.timeout(20000)});
    if(!login.ok)throw new Error('관리자 로그인 검사 실패');
    const cookie=login.headers.get('Set-Cookie')?.split(';')[0];
    if(!cookie)throw new Error('로그인 세션이 없습니다.');
    const b=await fetch(url+'/api/bootstrap',{headers:{Cookie:cookie},signal:AbortSignal.timeout(20000)});
    if(!b.ok)throw new Error('문서 저장소 조회 검사 실패');
    const data=await b.json();if(!Array.isArray(data.organizations)||!Array.isArray(data.categories))throw new Error('분류 조회 결과 확인 필요');
    await fetch(url+'/api/logout',{method:'POST',headers:{Origin:url,Cookie:cookie},signal:AbortSignal.timeout(20000)});
    return;
   }
  }catch{/* Allow propagation of a newly deployed Worker before checking again. */}
  if(attempt<5)await new Promise(resolve=>setTimeout(resolve,5000));
 }
 throw new Error('배포 후 로그인·데이터베이스 검사를 통과하지 못했습니다. Cloudflare 배포 상태를 확인해 주세요.');
}
try{
 await ensureDatabase();await ensureBucket();
 writeFileSync('wrangler.jsonc',JSON.stringify(config,null,2)+'\n');
 run(['d1','migrations','apply','DB','--remote']);
 // A new Worker must exist before the CLI can pipe its secret without prompting.
 let output=run(['deploy']);
 const salt=randomBytes(16).toString('hex');
 const hash='pbkdf2$100000$'+salt+'$'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex');
 run(['secret','bulk'],JSON.stringify({ADMIN_PASSWORD_HASH:hash}));
 output=run(['deploy']);
 const match=[...output.matchAll(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/gi)].find(m=>new URL(m[0]).hostname.startsWith(config.name+'.'));
 if(!match)throw new Error('배포 주소를 확인하지 못했습니다. 위 Wrangler 배포 결과를 확인해 주세요.');
 const url=match[0];await verify(url);
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'url='+url+'\n');
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## 문서이음 배포 완료\n\n[사이트 접속]('+url+')\n\n- 본인 Cloudflare Workers·D1·R2 사용\n- 로그인·분류 조회 및 데이터베이스 검사 통과\n- 관리자 아이디: `admin`\n- 비밀번호: GitHub Secret `ADMIN_PASSWORD`에 본인이 등록한 값\n');
 console.log('배포 및 로그인·저장소 확인 완료: '+url);
}catch(error){console.error(error.message);process.exitCode=1;}
