import {attachmentDisposition} from '../public/archive.mjs';
import {workbookStream} from './spreadsheet.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const latest=alias=>`(SELECT v.id FROM revisions v WHERE v.document_id=${alias}.id ORDER BY v.revision_date DESC,v.sequence DESC,v.id DESC LIMIT 1)`;
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function exportData(url,env){
 const organizations=[...new Set(url.searchParams.getAll('organization'))],categories=[...new Set(url.searchParams.getAll('category'))];
 if(!organizations.length||!categories.length)fail(400,'기관구분과 업무구분을 각각 한 개 이상 선택해 주세요.');
 if(organizations.some(id=>!['kwwa','upper'].includes(id))||categories.length>1000||categories.some(id=>!/^[\w-]{1,80}$/.test(id)))fail(400,'다운로드할 기관구분과 업무구분을 확인해 주세요.');
 const existing=(await env.DB.prepare('SELECT id FROM work_categories').all()).results;
 if(categories.some(id=>!existing.some(c=>c.id===id)))fail(400,'업무구분이 변경되었습니다. 새로고침 후 다시 선택해 주세요.');
 const scope='d.organization_id IN (SELECT value FROM json_each(?)) AND d.category_id IN (SELECT value FROM json_each(?))',args=[JSON.stringify(organizations),JSON.stringify(categories)];
 const result=await env.DB.batch([
  env.DB.prepare(`SELECT d.id,d.organization_id,d.category_id,d.document_type,d.requirement,c.name category_name,o.name organization_name,r.id revision_id,r.title,r.revision_date,r.manager,r.approval_no,r.summary,pr.title related_title,pr.revision_date related_revision_date,po.name related_organization_name
   FROM documents d JOIN work_categories c ON c.id=d.category_id JOIN organizations o ON o.id=d.organization_id JOIN revisions r ON r.id=${latest('d')}
   LEFT JOIN document_pairs p ON p.kwwa_id=d.id OR p.upper_id=d.id LEFT JOIN documents pd ON pd.id=CASE WHEN p.kwwa_id=d.id THEN p.upper_id ELSE p.kwwa_id END LEFT JOIN revisions pr ON pr.id=${latest('pd')} LEFT JOIN organizations po ON po.id=pd.organization_id
   WHERE ${scope} ORDER BY c.sort_order,c.id,d.organization_id,CASE d.document_type WHEN '지침' THEN 0 WHEN '매뉴얼' THEN 1 WHEN '가이드라인' THEN 2 ELSE 3 END,r.revision_date DESC,d.id`).bind(...args),
  env.DB.prepare(`SELECT a.*,r.document_id,r.revision_date,r.sequence FROM attachments a JOIN revisions r ON r.id=a.revision_id JOIN documents d ON d.id=r.document_id WHERE ${scope} ORDER BY r.document_id,r.revision_date DESC,r.sequence DESC,a.created_at,a.id`).bind(...args)
 ]);
 const files=result[1].results,byRevision=new Map();for(const file of files){if(!byRevision.has(file.revision_id))byRevision.set(file.revision_id,[]);byRevision.get(file.revision_id).push(file);}
 const documents=result[0].results.map(d=>({...d,attachments:byRevision.get(d.revision_id)||[]}));
 if(!documents.length)fail(404,'선택한 기관구분·업무구분에 등록된 문서가 없습니다.');
 return {documents,files};
}
export async function exportDocuments(url,env,kind){
 const format=kind==='check'?url.searchParams.get('format'):kind;if(!['excel','files'].includes(format))fail(400,'다운로드 형식을 선택해 주세요.');
 const {documents,files}=await exportData(url,env);
 if(format==='files'&&!files.length)fail(404,'선택한 문서에 첨부파일이 없습니다. 엑셀 다운로드는 이용할 수 있습니다.');
 if(kind==='files')return new Response(JSON.stringify({documents:documents.map(d=>({id:d.id,title:d.title})),files:files.map(a=>({id:a.id,document_id:a.document_id,revision_id:a.revision_id,revision_date:a.revision_date,name:a.name,size:a.size,created_at:a.created_at}))}),{headers:{'Content-Type':'application/json; charset=utf-8'}});
 if(kind==='check')return new Response(JSON.stringify({document_count:documents.length,attachment_count:files.length,total_bytes:files.reduce((s,a)=>s+a.size,0)}),{headers:{'Content-Type':'application/json; charset=utf-8'}});
 const name=`안전정보팀_문서목록_${today()}.xlsx`;
 return new Response(workbookStream(documents),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':attachmentDisposition(name),'X-Document-Count':String(documents.length),'X-Attachment-Count':String(documents.reduce((count,d)=>count+d.attachments.length,0))}});
}
