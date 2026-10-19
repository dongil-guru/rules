import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export function passwordHash(password){
 if(typeof password!=='string'||password.length<12||password.length>256)throw new Error('ADMIN_PASSWORD는 12~256자로 등록해 주세요.');
 const salt=randomBytes(16).toString('hex');
 return 'pbkdf2$100000$'+salt+'$'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex');
}

export function inspectAdministrator(user,password){
 const parts=user.password_hash.split('$'),valid=parts.length===4&&parts[0]==='pbkdf2'&&parts[1]==='100000'&&!!parts[2]&&/^[a-f0-9]{64}$/i.test(parts[3]);
 const matches=valid&&timingSafeEqual(Buffer.from(parts[3],'hex'),pbkdf2Sync(password,parts[2],100000,32,'sha256'));
 return {default_id:user.login_id==='admin',active:user.active===1,valid_hash:valid,matches_deployment_password:matches,never_logged_in:!user.last_login_at,account_unchanged:user.created_at===user.updated_at};
}

export async function prepareAdministrator(query,password,hash=passwordHash(password)){
 const [user]=await query('SELECT id,login_id,password_hash,active,last_login_at,created_at,updated_at,token FROM users WHERE is_admin=1');
 const time=new Date().toISOString(),token=randomUUID();
 if(!user){
  const created=await query('INSERT OR IGNORE INTO users(id,login_id,password_hash,name,last_login_at,active,is_admin,token,created_at,updated_at) VALUES(?,?,?,\'관리자\',NULL,1,1,?,?,?) RETURNING id',[randomUUID(),'admin',hash,token,time,time]);
  return {status:created.length?'created':'unchanged'};
 }
 const diagnosis=inspectAdministrator(user,password);
 // Repair only the untouched initial import implicated in the login incident.
 // A successful login or any account edit makes this recovery inapplicable.
 if(diagnosis.default_id&&diagnosis.active&&diagnosis.never_logged_in&&diagnosis.account_unchanged&&!diagnosis.matches_deployment_password){
  const repairedAt=new Date(Math.max(Date.now(),Date.parse(user.created_at)+1)).toISOString();
  const repaired=await query('UPDATE users SET password_hash=?,token=?,updated_at=? WHERE id=? AND token=? AND login_id=\'admin\' AND is_admin=1 AND active=1 AND last_login_at IS NULL AND created_at=updated_at RETURNING id',[hash,token,repairedAt,user.id,user.token]);
  if(!repaired.length)return {status:'unchanged',diagnosis};
  await query('DELETE FROM user_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND token=?)',[user.id,user.id,token]);
  return {status:'repaired_initial_password',diagnosis};
 }
 return {status:'unchanged',diagnosis};
}
