import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const wrangler=resolve(root,'node_modules/wrangler/bin/wrangler.js');
function run(args,{input,capture=false,allowFailure=false}={}) {
  const result=spawnSync(process.execPath,[wrangler,...args],{encoding:'utf8',input,stdio:input!==undefined?['pipe','inherit','inherit']:capture?['inherit','pipe','pipe']:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  if(capture){if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);}
  if(result.status!==0&&!allowFailure)throw new Error(`실행하지 못했습니다: wrangler ${args.join(' ')}`);
  return result;
}
function config(){return JSON.parse(readFileSync('wrangler.jsonc','utf8'));}
function hiddenQuestion(prompt) {
  if(!process.stdin.isTTY)throw new Error('비밀번호 설정은 터미널에서 실행해 주세요.');
  return new Promise(resolve=>{
    process.stdout.write(prompt);
    const silent=new Writable({write(_chunk,_encoding,done){done();}});
    const rl=createInterface({input:process.stdin,output:silent,terminal:true});
    rl.question('',answer=>{rl.close();process.stdout.write('\n');resolve(answer);});
  });
}
try {
  console.log('문서이음 · Cloudflare 최초 배포 설정');
  console.log('본인 계정의 전용 데이터베이스와 비공개 파일 저장소를 사용합니다.');
  run(['login']);
  let c=config();
  if(c.d1_databases[0].database_id==='REPLACE_WITH_D1_DATABASE_ID'){
    const result=run(['d1','create',c.d1_databases[0].database_name,'--location','apac','--update-config=false'],{capture:true});
    const text=(result.stdout||'')+(result.stderr||'');
    const id=text.match(/database_id["']?\s*[:=]\s*["']([a-f0-9-]{36})/i)?.[1];
    if(!id)throw new Error('D1 ID를 자동 확인하지 못했습니다. 출력된 database_id를 wrangler.jsonc에 입력한 후 다시 실행해 주세요.');
    c.d1_databases[0].database_id=id;writeFileSync('wrangler.jsonc',JSON.stringify(c,null,2)+'\n');
  }
  const bucket=run(['r2','bucket','create',c.r2_buckets[0].bucket_name,'--location','apac','--update-config=false'],{capture:true,allowFailure:true});
  if(bucket.status!==0&&!/already (exists|owned)/i.test((bucket.stdout||'')+(bucket.stderr||'')))throw new Error('파일 저장소를 생성하지 못했습니다. R2 활성화 여부와 오류를 확인해 주세요.');
  run(['d1','migrations','apply','DB','--remote']);
  // Create the Worker before piping a secret; a new Worker would otherwise
  // require an interactive creation prompt while stdin contains secret bytes.
  run(['deploy']);
  let password=await hiddenQuestion('사이트 관리자 비밀번호 (12~256자, 화면에 표시되지 않음): ');
  if(password.length<12||password.length>256)throw new Error('비밀번호는 12~256자로 입력해 주세요.');
  const confirm=await hiddenQuestion('비밀번호 다시 입력: ');
  if(password!==confirm)throw new Error('비밀번호가 일치하지 않습니다.');
  const salt=randomBytes(16).toString('hex');
  const derived=pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex');
  password='';
  const passwordHash=`pbkdf2$100000$${salt}$${derived}`;
  run(['secret','put','ADMIN_PASSWORD_HASH'],{input:passwordHash+'\n'});
  run(['deploy']);
  console.log('\n배포가 완료되었습니다. 위 workers.dev 주소로 접속하세요.');
  console.log('최초 관리자 아이디: admin / 최초 비밀번호: 방금 설정한 비밀번호. 기존 계정의 ID와 비밀번호는 유지됩니다.');
  console.log('wrangler.jsonc의 D1 ID 변경을 GitHub에도 반영해 주세요.');
}catch(error){console.error('\n설정을 완료하지 못했습니다. '+error.message);process.exitCode=1;}
