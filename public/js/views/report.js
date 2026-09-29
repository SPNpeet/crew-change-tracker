import { A } from '../app.js';
import { api } from '../api.js';
import { esc, fmtFull, dateTh, MIN } from '../core.js';
import { icon } from '../ui.js';

const app = () => document.getElementById('app');

export async function enter(r, alive) {
  app().innerHTML = '<div class="muted">กำลังเตรียมรายงาน...</div>';
  const d = await api('GET', `/api/jobs/${r.params.id}`);
  if (!alive()) return;
  const j = d.job, crew = d.crew, late = A.settings.late_min, docs = A.settings.docs;
  const on = crew.filter(c => c.type === 'on').length;
  const vans = new Set(crew.map(c => c.vehicle_id).filter(Boolean)).size;
  const rooms = crew.filter(c => c.hotel_id).length;
  const nLate = crew.reduce((a, c) => a + c.cps.filter(x => x.actual != null && x.plan != null && (x.actual - x.plan) / MIN > late).length, 0);
  document.title = `รายงาน ${j.vessel}`;
  app().innerHTML = `<div class="report">
    <div class="rp-bar noprint"><button class="btn" type="button" data-act="rp-print">${icon('print')}พิมพ์ / บันทึก PDF</button><a class="btn line" href="/jobs/${j.id}/9" data-link>${icon('left')}กลับ</a><span class="muted s13">เลือกเครื่องพิมพ์ "Save as PDF" เพื่อบันทึกเป็นไฟล์</span></div>
    <div class="rp-page">
      <div class="rp-h"><div><div class="rp-co">${esc(A.settings.company.name_th)}</div><div class="rp-co2">${esc(A.settings.company.name)}</div></div><div class="rp-t"><h1>สรุปงานเปลี่ยนลูกเรือ</h1><div>Crew change summary</div></div></div>
      <table class="rp-kv"><tr><th>เรือ</th><td>${esc(j.vessel)}</td><th>ท่าเรือ</th><td>${esc(j.port || '—')}</td></tr>
        <tr><th>Owner</th><td>${esc(j.owner || '—')}</td><th>Local agent</th><td>${esc(j.agent || '—')}</td></tr>
        <tr><th>ETA</th><td>${fmtFull(j.eta)}</td><th>ETB</th><td>${fmtFull(j.etb)}</td></tr>
        <tr><th>สถานะงาน</th><td>${j.status === 'closed' ? 'ปิดงาน ' + fmtFull(j.closed_at) : 'กำลังดำเนินการ'}</td><th>ออกรายงาน</th><td>${fmtFull(Date.now())}</td></tr></table>
      <div class="rp-kpi"><div><b>${crew.length}</b><span>ลูกเรือ (On ${on} / Off ${crew.length - on})</span></div><div><b>${vans}</b><span>รถที่ใช้</span></div><div><b>${rooms}</b><span>ห้องพัก</span></div><div><b>${nLate}</b><span>ช้ากว่าแผนเกิน <span class="nw">${late} นาที</span></span></div></div>
      <h2>รายชื่อลูกเรือ</h2>
      <table class="rp-t"><thead><tr><th>#</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>ประเภท</th><th>เที่ยวบิน</th><th>รถ</th><th>โรงแรม / ห้อง</th><th>เอกสาร</th></tr></thead><tbody>
        ${crew.map((c, i) => { const v = A.vehicle(c.vehicle_id); const miss = docs.filter(x => !c.docs[x]); return `<tr><td>${i + 1}</td><td>${esc(c.name)}</td><td>${esc(c.rank)}</td><td>${c.type === 'on' ? 'On' : 'Off'}</td><td>${esc(c.flight)}</td><td>${v ? esc(v.name) : '—'}</td><td class="w">${esc(A.hotelName(c.hotel_id) || '—')}${c.room ? ` <span class="nw">ห้อง ${esc(c.room)}</span>` : ''}</td><td class="w">${miss.length ? 'ขาด ' + esc(miss.join(', ')) : 'ครบ'}</td></tr>`; }).join('')}
      </tbody></table>
      <h2>Time log</h2>
      <table class="rp-t"><thead><tr><th>ลูกเรือ</th><th>จุด</th><th>แผน</th><th>เวลาจริง</th><th>ต่าง (นาที)</th></tr></thead><tbody>
        ${crew.map(c => c.cps.map((x, k) => { const df = x.actual != null && x.plan != null ? Math.round((x.actual - x.plan) / MIN) : null; return `<tr class="${k === 0 ? 'grp' : ''}"><td>${k === 0 ? esc(c.name) : ''}</td><td>${esc(x.name)}</td><td>${fmtFull(x.plan)}</td><td>${fmtFull(x.actual)}</td><td class="${df != null && df > late ? 'rp-late' : ''}">${df == null ? '' : (df > 0 ? '+' : '') + df}</td></tr>`; }).join('')).join('')}
      </tbody></table>
      ${crew.some(c => c.notes.length) ? `<h2>หมายเหตุ</h2><table class="rp-t"><thead><tr><th>ลูกเรือ</th><th>เวลา</th><th>หมายเหตุ</th></tr></thead><tbody>${crew.flatMap(c => c.notes.map(n => `<tr><td>${esc(c.name)}</td><td>${fmtFull(n.at)}</td><td class="w">${esc(n.text)}</td></tr>`)).join('')}</tbody></table>` : ''}
      <div class="rp-foot">เวลาทั้งหมดเป็นเวลาประเทศไทย · ออกจากระบบ Crew Change Tracker · ${dateTh(Date.now())}</div>
    </div></div>`;
}

export const actions = { 'rp-print'() { window.print(); } };
