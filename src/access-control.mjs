// Canonical single-address comparison. No wildcards, ports, or subnet ranges.
export function normalizeIp(value){
 if(typeof value!=='string')return null;
 const text=value.trim();if(!text||text.length>45)return null;
 if(/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(text)){
  const parts=text.split('.').map(Number);return parts.every(n=>n<=255)?parts.join('.'):null;
 }
 if(!text.includes(':')||!/^[0-9a-fA-F:.]+$/.test(text))return null;
 try{
  const host=new URL('http://['+text+']/').hostname.slice(1,-1);
  const mapped=host.match(/^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/);
  if(mapped){const high=parseInt(mapped[1],16),low=parseInt(mapped[2],16);return [high>>8,high&255,low>>8,low&255].join('.');}
  return host;
 }catch{return null;}
}

export function clientIp(request){
 // Other Workers cannot supply a trusted original visitor IP for this policy.
 if(request.headers.get('CF-Worker'))return null;
 const ip=normalizeIp(request.headers.get('CF-Connecting-IP'));
 if(ip==='2a06:98c0:3600::103')return null;
 // Cloudflare Pseudo IPv4 overwrite uses Class E; recover its real IPv6 only
 // in that mode, rather than trusting a caller-supplied secondary header.
 if(ip&&/^\d+\./.test(ip)&&Number(ip.split('.')[0])>=240){
  const ipv6=normalizeIp(request.headers.get('CF-Connecting-IPv6'));
  return ipv6?.includes(':')?ipv6:null;
 }
 return ip;
}

export async function networkAllowed(request,db){
 const settings=await db.prepare('SELECT mode FROM access_settings WHERE id=1').first();
 if(!settings)throw new Error('접근제어 설정을 찾을 수 없습니다.');
 if(settings.mode==='all')return true;
 const ip=clientIp(request);if(!ip)return false;
 return !!await db.prepare('SELECT id FROM allowed_ips WHERE ip=? AND active=1').bind(ip).first();
}

export function deniedResponse(request){
 const ip=clientIp(request)||'확인할 수 없음',message='허용되지 않은 IP입니다. 관리자에게 접근 허용을 요청해 주세요.';
 if(new URL(request.url).pathname.startsWith('/api/'))return new Response(JSON.stringify({error:message,code:'IP_ACCESS_DENIED',client_ip:ip}),{status:403,headers:{'Content-Type':'application/json; charset=utf-8'}});
 return new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>안전정보팀 · 접근 제한</title><link rel="stylesheet" href="/styles.css"><link rel="icon" href="/favicon.svg"></head><body><main class="access-denied-page" data-ip-access-denied><section class="access-denied-card"><img src="/favicon.svg" alt=""><p>안전정보팀</p><h1>접근이 제한되었습니다</h1><p>${message}</p><p>현재 접속 IP: <strong>${ip}</strong></p><a class="btn primary" href="/">다시 확인</a></section></main></body></html>`,{status:403,headers:{'Content-Type':'text/html; charset=utf-8'}});
}
