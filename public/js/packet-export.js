import {buildEvidencePack} from './oktb.js';
// A review bundle, not a signed guarantee or an immigration approval. Render the
// manifest with the existing Thai browser font, then append immutable file bytes.
export async function packetPdf(packet,files){
 const s=packet.snapshot,lines=[s.status==='partial'?'PARTIAL DOCUMENT PACKET / ชุดเอกสารบางส่วน':'DOCUMENT PACKET / ชุดเอกสารสำหรับตรวจ',`Vessel / เรือ: ${s.payload.job.vessel}`,`Packet: ${packet.id}`,`Prepared: ${new Date(packet.prepared_at).toISOString()}`,`Revision: ${s.revision}`,`Incomplete people / จำนวนคนที่ไม่ครบ: ${s.manifest.incomplete_people}`,'','This export is not proof of submission or authority approval.','การส่งออกไม่ใช่หลักฐานการยื่นหรือการอนุมัติจากหน่วยงาน','', 'Included people / รายชื่อ'];
 for(const p of s.payload.people){lines.push(`${p.crew.name} — ${p.group?.name||'Ungrouped / ยังไม่จัดกลุ่ม'}`);for(const l of p.crew.flight_legs)lines.push(`  ${l.flight} ${l.from} > ${l.to}: ${l.departure} (${l.departure_zone}) > ${l.arrival} (${l.arrival_zone})`);lines.push(`  Missing / ขาด: ${p.missing.join(', ')||'None / ไม่มี'}`);}
 lines.push('','Included files / ไฟล์ที่แนบ');for(const f of s.manifest.included_files)lines.push(`Crew ${f.crew_id} | File ${f.file_id} | ${f.pages} pages | SHA256 ${f.sha256}`);
 lines.push('','Unreviewed, unavailable and missing files are omitted.','ไฟล์ที่ยังไม่ตรวจ ไม่มี หรือไม่พร้อมใช้งาน ไม่รวมในชุดนี้');
 await document.fonts.ready;const pages=[];let cv,g,y;
 const page=()=>{cv=document.createElement('canvas');cv.width=1240;cv.height=1754;g=cv.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,1240,1754);g.fillStyle='#111';g.font='24px "IBM Plex Sans Thai",sans-serif';y=85;pages.push(cv);};page();
 for(const line of lines){let row='';for(const char of line){if(g.measureText(row+char).width>1080){if(y>1650)page();g.fillText(row,80,y);y+=38;row='';}row+=char;}if(y>1650)page();g.fillText(row,80,y);y+=38;}
 return buildEvidencePack(pages,files,'Document review packet '+packet.id);
}
