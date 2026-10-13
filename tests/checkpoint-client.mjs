// Synthetic fixtures mirror current displayed IDs/revisions. Explicit negative values are preserved.
async function crewAt(base,cookie,id){const r=await fetch(base+'/api/field',{headers:{cookie}});return r.ok?(await r.json()).crew.find(c=>c.id===Number(id)):null;}
export async function checkpointBody(base,cookie,path,body,method) {
 const m=path.match(/^\/api\/crew\/(\d+)(?:\/(confirm|undo|notes))?$/);
 if(!['POST','PATCH'].includes(method)||!m||body instanceof Uint8Array)return body;
 const c=await crewAt(base,cookie,m[1]);if(!c)return body;
 const out={...body};
 if(method==='PATCH'){if(!('expected_assignment_revision' in out))out.expected_assignment_revision=c.assignment_rev;return out;}
 if(!('assignment_revision' in out))out.assignment_revision=c.assignment_rev;
 if(['confirm','undo'].includes(m[2])&&out.cp_id===undefined){const cp=out.idx!==undefined?c.cps.find(x=>x.idx===out.idx):c.cps.filter(x=>x.actual!=null).at(-1);if(cp){out.idx??=cp.idx;out.cp_id=cp.id;}}
 return out;
}
export async function assignmentPath(base,cookie,path,method){
 const m=path.match(/^\/api\/crew\/(\d+)\/photos(?:\?|$)/);
 if(method!=='POST'||!m||/[?&]assignment_revision=/.test(path))return path;
 const c=await crewAt(base,cookie,m[1]);return c?path+(path.includes('?')?'&':'?')+'assignment_revision='+c.assignment_rev:path;
}
