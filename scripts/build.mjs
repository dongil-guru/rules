import { mkdir, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, ['--check','src/worker.js'], {stdio:'inherit'});
execFileSync(process.execPath, ['--check','public/app.js'], {stdio:'inherit'});
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
await cp('public','dist/public',{recursive:true});
await cp('src','dist/src',{recursive:true});
console.log('문서이음 배포 파일 준비 완료');
