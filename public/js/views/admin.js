import { A, go, reloadRefs } from '../app.js';
import { api } from '../api.js';
import { esc, fmtFull, mail, userAv, DEFAULT_TPL, DEFAULT_OKTB } from '../core.js';
import { icon, toast, openDialog, dlgHead, dlgFoot, uploadType } from '../ui.js';
import { roleLabel } from './auth.js';
import { storageCard } from '../storage.js';

const app = () => document.getElementById('app');
const TABS = [['users', 'ผู้ใช้งาน'], ['vehicles', 'รถและคนขับ'], ['hotels', 'โรงแรม'], ['points', 'จุดสถานะ'], ['general', 'ตั้งค่าทั่วไป'], ['backup', 'สำรองข้อมูล']];
let USERS = [];
let PREVIEW = null;

const MAIL_KINDS = [
  ['appoint', 'แจ้ง Local Agent รับแต่งตั้ง', 'ขั้นตอนที่ 3', ['to', 'services_line', 'vessel', 'PORT', 'port', 'agent', 'owner', 'services', 'on', 'off', 'signature']],
  ['sched', 'อัปเดตตารางเรือ', 'ขั้นตอนที่ 2', ['to', 'vessel', 'owner', 'port', 'eta', 'etb', 'etd', 'signature']],
  ['gate', 'GATE PERMISSION', 'ขั้นตอนที่ 6', ['to', 'vessel', 'PORT', 'etb_date', 'agent', 'gate_lines', 'signature']],
  ['plan', 'แผนส่ง Owner', 'ขั้นตอนที่ 5', ['to', 'vessel', 'owner', 'port', 'plan_rows', 'signature']],
  ['night', 'สรุปแผนคืนนี้', 'ขั้นตอนที่ 8', ['to', 'vessel', 'time', 'owner', 'port', 'status_lines', 'night_plan', 'signature']],
  ['morning', 'สรุปผลเช้านี้', 'ขั้นตอนที่ 8', ['to', 'vessel', 'owner', 'morning_done', 'status_lines', 'signature']],
  ['update', 'อัปเดตสถานะตอนนี้', 'ขั้นตอนที่ 8', ['to', 'vessel', 'time', 'owner', 'status_lines', 'signature']]
];
const VAR_TH = {
  to: 'บรรทัด To: อีเมลผู้รับ (ไม่มีอีเมลจะว่าง)',
  vessel: 'ชื่อเรือ',
  port: 'ท่าเรือ',
  PORT: 'ท่าเรือ ตัวพิมพ์ใหญ่',
  owner: 'ชื่อ Owner',
  agent: 'ชื่อ Local agent',
  services: 'เรื่องที่ได้รับแต่งตั้ง บรรทัดละเรื่อง',
  services_line: 'เรื่องที่ได้รับแต่งตั้ง ในบรรทัดเดียว ตัวพิมพ์ใหญ่',
  on: 'จำนวน On signer',
  off: 'จำนวน Off signer',
  eta: 'วันเวลา ETA',
  etb: 'วันเวลา ETB',
  etd: 'วันเวลา ETD',
  etb_date: 'วันที่ ETB ขึ้นต้นด้วย " / " (ยังไม่มี ETB จะว่าง)',
  gate_lines: 'รายชื่อลูกเรือ ผู้ดูแล และคนขับ',
  plan_rows: 'แผนเวลาของลูกเรือทุกคน',
  status_lines: 'สถานะล่าสุดของลูกเรือทุกคน',
  night_plan: 'จุดที่จะถึงใน 12 ชม. ข้างหน้า',
  morning_done: 'จุดที่ผ่านแล้วใน 12 ชม. ที่ผ่านมา',
  time: 'เวลาตอนสร้างร่าง (ชม.:นาที)',
  signature: 'ลายเซ็นท้ายอีเมล'
};

const BRAND = [
  ['letterhead', 'หัวจดหมาย', 'แถบโลโก้และที่อยู่บริษัท วางเต็มความกว้างด้านบนของจดหมาย'],
  ['signature', 'ลายเซ็น', 'ลายเซ็นของผู้ลงนามท้ายจดหมาย'],
  ['stamp', 'ตราประทับ', 'ตราประทับบริษัท วางข้างลายเซ็น']
];
const OKTB_VARS = [['company', 'ชื่อบริษัทในจดหมาย (แก้ได้ตอนสร้างเอกสาร)'], ['vessel', 'ชื่อเรือ'], ['port', 'ท่าเรือ'], ['call_date', 'วันที่เรือเข้าเทียบท่า เช่น 19 September 2026']];

function brandTiles() {
  return BRAND.map(([k, l, d]) => {
    const at = A.brand[k];
    return `<div class="brand"><div class="brand-pv">${at ? `<img src="/api/brand/${k}?v=${at}" alt="${l}">` : '<span>ยังไม่มีรูป</span>'}</div><div class="brand-i"><b>${l}</b><span class="sub">${d}</span>
      <div class="row"><label class="btn line sm">${icon('image')}${at ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}<input class="vh" type="file" accept="image/png,image/jpeg" data-chg="a-brand" data-kind="${k}" aria-label="${at ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}${l}"></label>${at ? `<button class="btn line sm danger" data-act="a-branddel" data-kind="${k}" type="button">${icon('trash')}ลบรูป</button>` : ''}</div>
      <div class="fstat" role="status"></div><div class="ferr" role="alert"></div></div></div>`;
  }).join('');
}

export async function enter(r, alive) {
  const tab = r.params.tab;
  const nav = `<div class="page-h"><div><h1>ตั้งค่าระบบ</h1><div class="muted s14">เฉพาะผู้ดูแลระบบ</div></div></div><nav class="seg wide" aria-label="หมวดตั้งค่า">${TABS.map(([k, l]) => `<a href="/admin/${k}" data-link aria-current="${k === tab}">${l}</a>`).join('')}</nav>`;
  app().innerHTML = nav + '<div id="adm" class="muted">กำลังโหลด...</div>';
  const el = () => document.getElementById('adm');
  if (tab === 'users') {
    USERS = (await api('GET', '/api/users')).users;
    if (!alive()) return;
    const active = USERS.filter(u => u.active).length;
    el().className = '';
    el().innerHTML = `<div class="card"><div class="card-h"><h2>ผู้ใช้งาน</h2><span class="sub">ใช้งานอยู่ ${active} / ${A.settings.max_users} บัญชี</span><div class="act"><button class="btn" data-act="a-adduser" type="button" ${active >= A.settings.max_users ? 'disabled' : ''}>${icon('plus')}เพิ่มผู้ใช้</button></div></div>
      <div class="scroll"><table class="t nw cards"><thead><tr><th>ชื่อ</th><th>รหัสพนักงาน</th><th>ชื่อผู้ใช้</th><th>สิทธิ์</th><th>เบอร์โทร</th><th>สถานะ</th><th></th></tr></thead><tbody>
      ${USERS.map(u => `<tr class="${u.active ? '' : 'dim'}"><td class="c-main"><div class="who2">${userAv(u)}<div><div class="nm">${esc(u.name)}</div><div class="sub">${esc(u.title || '')}</div></div></div></td><td data-l="รหัสพนักงาน">${esc(u.emp_code || '—')}</td><td data-l="ชื่อผู้ใช้">${esc(u.username)}</td><td data-l="สิทธิ์">${esc(roleLabel(u))}</td><td data-l="เบอร์โทร">${esc(u.phone || '—')}</td><td data-l="สถานะ">${u.active ? (u.locked ? '<span class="pill warn-c">ล็อกชั่วคราว</span>' : '<span class="pill ok">ใช้งาน</span>') : '<span class="pill gray">ปิดแล้ว</span>'}</td><td class="acts"><button class="btn line sm" data-act="a-edituser" data-id="${u.id}" type="button" aria-label="แก้ไข ${esc(u.name)}">${icon('edit')}แก้ไข</button></td></tr>`).join('')}
      </tbody></table></div></div>
      <p class="muted s13">พนักงานภาคสนามเห็นเฉพาะลูกเรือที่ได้รับมอบหมาย ยกเว้นสิทธิ์ "หัวหน้างานภาคสนาม" ที่เห็นลูกเรือทุกคน · บัญชีที่ไม่ใช้แล้วให้ปิดแทนการลบ เพื่อให้ประวัติงานยังอยู่ครบ</p>`;
    return;
  }
  if (tab === 'vehicles' || tab === 'hotels') {
    await reloadRefs();
    if (!alive()) return;
    const list = tab === 'vehicles' ? A.vehicles : A.hotels;
    const cell = (label, v) => `<td data-l="${label}">${esc(v || '—')}</td>`;
    const account = x => { const u = x.user_id ? A.user(x.user_id) : null; return `<td data-l="บัญชีคนขับ">${!u ? '<span class="muted">ยังไม่มีบัญชี</span>' : u.active && u.role === 'field' ? esc(u.name) : `${esc(u.name)} <span class="pill warn-c">บัญชีถูกปิด</span>`}</td>`; };
    el().className = '';
    el().innerHTML = `<div class="card"><div class="card-h"><h2>${tab === 'vehicles' ? 'รถและคนขับ' : 'โรงแรม'}</h2><span class="sub">${list.filter(x => x.active).length} รายการที่ใช้งาน</span><div class="act"><button class="btn" data-act="a-res" data-kind="${tab}" type="button">${icon('plus')}เพิ่ม${tab === 'vehicles' ? 'รถ' : 'โรงแรม'}</button></div></div>
      ${list.length ? `<div class="scroll"><table class="t nw ${tab === 'vehicles' ? 'tight ' : ''}cards"><thead><tr>${tab === 'vehicles' ? '<th>รถ</th><th>ทะเบียน</th><th>คนขับ</th><th>ชื่อคนขับ (อังกฤษ)</th><th>เลขบัตร</th><th>เบอร์โทร</th><th>บัญชีคนขับ</th>' : '<th>โรงแรม</th><th>เบอร์โทร</th>'}<th>สถานะ</th><th></th></tr></thead><tbody>
      ${list.map(x => `<tr class="${x.active ? '' : 'dim'}"><td class="c-main nm">${esc(x.name)}</td>${tab === 'vehicles' ? cell('ทะเบียน', x.plate) + cell('คนขับ', x.driver) + cell('ชื่อคนขับ (อังกฤษ)', x.driver_en) + cell('เลขบัตร', x.driver_id) + cell('เบอร์โทร', x.driver_phone) + account(x) : cell('เบอร์โทร', x.phone)}<td data-l="สถานะ">${x.active ? '<span class="pill ok">ใช้งาน</span>' : '<span class="pill gray">ไม่ใช้แล้ว</span>'}</td><td class="acts"><button class="btn line sm" data-act="a-res" data-kind="${tab}" data-id="${x.id}" type="button" aria-label="แก้ไข ${esc(x.name)}">${icon('edit')}แก้ไข</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="card-b muted">ยังไม่มีรายการ</div>'}</div>
      <p class="muted s13">${tab === 'vehicles' ? 'ชื่อคนขับภาษาอังกฤษ เลขบัตร และทะเบียน ใช้ในอีเมล GATE PERMISSION · รถที่มีบัญชีคนขับ ลูกเรือที่จัดให้รถคันนั้นจะขึ้นในมือถือของคนขับด้วย' : 'โรงแรมที่เพิ่มไว้จะเลือกได้ในขั้นตอนที่ 7'}</p>`;
    return;
  }
  if (tab === 'points') {
    await reloadRefs();
    if (!alive()) return;
    renderPoints();
    return;
  }
  if (tab === 'general') {
    const s = A.settings;
    const storage = await api('GET', '/api/storage').catch(() => null);
    if (!alive()) return;
    const tpl = { ...DEFAULT_TPL, ...s.mail_tpl };
    const ok = { ...DEFAULT_OKTB, ...s.oktb };
    PREVIEW = null;
    el().className = 'stack';
    el().innerHTML = `${storageCard(storage)}<form id="genform" class="card"><div class="card-h"><h2>ตั้งค่าทั่วไป</h2></div><div class="card-b form">
      <label class="f">ชื่อบริษัท (ไทย)<input name="name_th" value="${esc(s.company.name_th)}" maxlength="120"></label>
      <label class="f">ชื่อบริษัท (อังกฤษ)<input name="name" value="${esc(s.company.name)}" maxlength="120"></label>
      <label class="f" style="grid-column:1 / -1">ลายเซ็นท้ายอีเมล<textarea name="signature" rows="3" maxlength="400">${esc(s.company.signature)}</textarea></label>
      <label class="f">ถือว่า "ช้ากว่าแผน" เมื่อเกิน (นาที)<input name="late_min" type="number" min="1" max="240" value="${s.late_min}" required></label>
      <label class="f">เตือนเมื่อใช้พื้นที่เก็บไฟล์ถึง (%)<input name="storage_warning_percent" type="number" min="1" max="99" value="${s.storage_warning_percent}" required><span class="fhelp">ค่าเริ่มต้น 80% ผู้ดูแลปรับได้ 1–99% เป็นจุดแจ้งเตือน ไม่เปลี่ยนโควตาพื้นที่หรือราคา</span></label>
      <label class="f">เอกสารที่ต้องมีต่อคน (บรรทัดละ 1 รายการ)<textarea name="docs" rows="5">${esc(s.docs.join('\n'))}</textarea></label>
      <label class="f">เรื่องที่ได้รับแต่งตั้ง (บรรทัดละ 1 รายการ)<textarea name="services" rows="5">${esc(s.services.join('\n'))}</textarea></label>
      <div class="ferr" role="alert" style="grid-column:1 / -1"></div>
      <div style="grid-column:1 / -1"><button class="btn" type="submit">${icon('check')}บันทึก</button></div>
    </div></form>
    <form id="mailform" class="card"><div class="card-h"><h2>ข้อความอีเมล</h2><span class="sub">แก้สำนวนอีเมลได้เอง · คำในวงเล็บปีกกา เช่น {{vessel}} ระบบจะแทนค่าจากงานให้</span></div><div class="card-b stack tpl-list">
      ${MAIL_KINDS.map(([k, title, where, vars]) => `<details class="tpl"><summary><b>${esc(title)}</b><span class="sub">${where}</span></summary><div class="tpl-b">
        <textarea class="mail" name="${k}" maxlength="4000" spellcheck="false" aria-label="ข้อความอีเมล ${esc(title)}">${esc(tpl[k])}</textarea>
        <div class="tpl-vars">${vars.map(v => `<div><code>{{${v}}}</code><span>${esc(VAR_TH[v])}</span></div>`).join('')}</div>
        <div class="tpl-prev" hidden><div class="sub"></div><pre></pre></div>
        <div class="row"><button class="btn line sm" data-act="a-tplreset" data-kind="${k}" type="button">${icon('refresh')}คืนค่าเริ่มต้น</button></div>
      </div></details>`).join('')}
      <div class="ferr" role="alert"></div>
      <div><button class="btn" type="submit">${icon('check')}บันทึกข้อความอีเมล</button></div>
    </div></form>
    <div class="card"><div class="card-h"><h2>เอกสาร OK TO BOARD</h2><span class="sub">หัวจดหมาย ลายเซ็น ตราประทับ และข้อความในจดหมาย · ใช้สร้างเอกสารที่ขั้นตอนที่ 4</span></div><div class="card-b stack">
      <div class="brands" id="brands">${brandTiles()}</div>
      <div class="muted s13">รูป PNG หรือ JPG ไม่เกิน 2 MB · ลายเซ็นและตราประทับใช้ไฟล์ PNG พื้นหลังโปร่งใสจะดูดีที่สุด · ตอนสร้างเอกสารเลือกได้ทุกครั้งว่าจะใส่หัวจดหมายและลายเซ็นหรือไม่</div>
      <form id="oktbform" class="form">
        <label class="f">ผู้ประสานงาน (P.I.C)<input name="pic_name" maxlength="120" value="${esc(ok.pic_name)}" placeholder="ชื่อที่ ตม. ติดต่อได้"></label>
        <label class="f">เบอร์โทรผู้ประสานงาน<input name="pic_mobile" maxlength="60" inputmode="tel" value="${esc(ok.pic_mobile)}"></label>
        <label class="f">ชื่อผู้ลงนาม<input name="signer_name" maxlength="120" value="${esc(ok.signer_name)}"></label>
        <label class="f">ตำแหน่งผู้ลงนาม<input name="signer_title" maxlength="120" value="${esc(ok.signer_title)}"></label>
        <label class="f">เรื่อง (Subject)<input name="subject" maxlength="200" value="${esc(ok.subject)}"></label>
        <label class="f">บรรทัดท้ายจดหมาย<input name="footer" maxlength="200" value="${esc(ok.footer)}"></label>
        ${[['intro', 'ย่อหน้าเปิดจดหมาย', 5], ['guarantee', 'ย่อหน้ารับรองและค่าใช้จ่าย', 9]].map(([k, l, rows]) => `<label class="f" style="grid-column:1 / -1">${l}<textarea name="${k}" rows="${rows}" maxlength="2000" spellcheck="false">${esc(ok[k])}</textarea></label>
        <div class="row" style="grid-column:1 / -1"><button class="btn line sm" data-act="a-oktbreset" data-key="${k}" type="button">${icon('refresh')}คืนค่าเริ่มต้น</button></div>`).join('')}
        <div class="tpl-vars" style="grid-column:1 / -1">${OKTB_VARS.map(([v, d]) => `<div><code>{{${v}}}</code><span>${d}</span></div>`).join('')}</div>
        <div class="muted s13" style="grid-column:1 / -1">คำในวงเล็บปีกกาใช้ได้ในสองย่อหน้านี้ ระบบแทนค่าจากงานให้ · ย่อหน้าแรกของแต่ละช่องเยื้องบรรทัดแรกให้เอง · เว้นบรรทัดว่างเพื่อเว้นระยะระหว่างย่อหน้า · ดูผลจริงได้ที่ปุ่ม "ดูตัวอย่างหน้าแรก" ในขั้นตอนที่ 4</div>
        <div class="ferr" role="alert" style="grid-column:1 / -1"></div>
        <div style="grid-column:1 / -1"><button class="btn" type="submit">${icon('check')}บันทึกเอกสาร OK TO BOARD</button></div>
      </form>
    </div></div>`;
    document.getElementById('mailform').mailExpected = structuredClone(tpl);
    loadPreview(alive);
    return;
  }
  if (tab === 'backup') {
    const d = await api('GET', '/api/backups');
    if (!alive()) return;
    const monthly = d.backups.filter(b => !b.name.startsWith('daily/'));
    const nightly = d.backups.filter(b => b.name.startsWith('daily/'));
    const table = (list, label) => list.length ? `<div class="scroll"><table class="t nw cards"><thead><tr><th>${label}</th><th>ขนาด</th><th>สร้างเมื่อ</th><th></th></tr></thead><tbody>${list.map(b => `<tr><td class="c-main nm" data-l="${label}">${esc(b.name.replace('daily/', '').replace(/\.(xlsx|json\.gz)$/, ''))}</td><td data-l="ขนาด">${Math.max(1, Math.round(b.size / 1024))} KB</td><td data-l="สร้างเมื่อ">${fmtFull(Date.parse(b.uploaded))}</td><td class="acts"><a class="btn line sm" href="/api/backups/${b.name.split('/').map(encodeURIComponent).join('/')}" download>${icon('download')}ดาวน์โหลด</a></td></tr>`).join('')}</tbody></table></div>` : '';
    el().className = 'stack';
    el().innerHTML = `<div class="card"><div class="card-h"><h2>ดาวน์โหลดข้อมูลทั้งหมดตอนนี้</h2></div><div class="card-b"><p class="muted s14" style="margin-top:0">ไฟล์ Excel รวมงาน ลูกเรือ Time log ความเคลื่อนไหว ผู้ใช้ รถ และโรงแรม</p><a class="btn" href="/api/export/all.xlsx" download>${icon('download')}ดาวน์โหลด Excel ทั้งระบบ</a></div></div>
      <div class="card"><div class="card-h"><h2>สำรองฐานข้อมูลทุกคืน</h2><span class="sub">02:00 ทุกคืน · เก็บย้อนหลัง 35 วัน</span></div>
        ${table(nightly.slice(0, 7), 'วันที่') || '<div class="card-b muted">ไฟล์แรกจะถูกสร้างคืนนี้เวลา 02:00</div>'}
        <div class="card-b muted s13">ไฟล์นี้เก็บข้อมูลฐานข้อมูล ไม่รวมไฟล์รูปถ่าย ต้องตั้งค่าและตรวจสอบการสำรองรูปกับข้อมูลไปยัง NAS ตามคู่มือ และทดลองกู้คืนก่อนยืนยันความพร้อม</div></div>
      <div class="card"><div class="card-h"><h2>ไฟล์ Excel รายเดือน</h2></div><div class="card-b muted s13">เก็บข้อมูลทั้งระบบ ณ เวลาสร้าง ไม่ได้กรองเฉพาะเดือนในชื่อไฟล์ เริ่มสร้างวันที่ 1 และลองใหม่ถึงวันที่ 7 หากยังไม่มีไฟล์</div>
        ${table(monthly, 'เดือนในชื่อไฟล์') || '<div class="card-b muted">ยังไม่มีไฟล์ Excel รายเดือน</div>'}</div>
      <p class="muted s13">ระยะเวลากู้ฐานข้อมูลย้อนหลังขึ้นกับแผนบริการที่ใช้งาน กรุณาตรวจสอบกับผู้ดูแลก่อนใช้งาน</p>`;
  }
}

const CP_LISTS = [['cp_on', 'On signer (ขึ้นเรือ)'], ['cp_off', 'Off signer (ลงเรือ)']];
let CP = null;
const cpForm = () => document.getElementById('cpform');
const newPointId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

// Each row carries the point's own id, so name, minutes and photo flag stay together when rows move.
function cpRow(x) {
  return `<div class="cp-row" data-id="${esc(x.id)}"><span class="cp-n"></span>
    <label class="cp-f"><span class="cp-l">ชื่อจุด (ไทย)</span><input name="th" value="${esc(x.th)}" maxlength="60" required></label>
    <label class="cp-f"><span class="cp-l">ชื่อจุด (อังกฤษ ให้ Owner เห็น)</span><input name="en" value="${esc(x.en)}" maxlength="60"></label>
    <label class="cp-f cp-gap"><span class="cp-l">นาทีจากจุดก่อน</span><input name="gap" type="number" inputmode="numeric" min="0" max="10080" value="${x.gap}"></label>
    <label class="cp-photo"><input type="checkbox" name="photo" ${x.photo ? 'checked' : ''}><span>ต้องถ่ายรูป</span></label>
    <span class="cp-acts"><button class="iconbtn plain" type="button" data-act="a-cpup" data-say="เลื่อนขึ้น">${icon('up')}</button><button class="iconbtn plain" type="button" data-act="a-cpdown" data-say="เลื่อนลง">${icon('down')}</button><button class="iconbtn" type="button" data-act="a-cpdel" data-say="ลบจุด">${icon('trash')}</button></span></div>`;
}

function renderPoints() {
  const s = A.settings;
  const block = ([key, title]) => {
    const list = s[key], chain = list[Math.min(s[key + '_chain'], list.length - 1)].id;
    return `<div class="card cp-card"><div class="card-h"><h3>${title}</h3><span class="sub cp-count" role="status"></span></div><div class="card-b">
      <label class="f cp-chainf"><span>ถ้าลูกเรือมาช้า ให้เลื่อนเวลาคาดการณ์ถึงจุด</span><select name="${key}_chain" data-chainsel></select><span class="fhelp">จุดหลังจากนี้ยึดตามตารางเรือ ไม่เลื่อนตามเที่ยวบิน เช่น เลือก ถึงโรงแรม</span></label>
      <div class="cp-head" aria-hidden="true"><span></span><span>ชื่อจุด (ไทย)</span><span>ชื่อจุด (อังกฤษ ให้ Owner เห็น)</span><span>นาทีจากจุดก่อน</span><span></span><span></span></div>
      <div class="cp-edit" data-key="${key}" data-chain="${esc(chain)}">${list.map(cpRow).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="btn line sm" data-act="a-cpadd" data-key="${key}" type="button">${icon('plus')}เพิ่มจุด</button><span class="fhelp">มีได้ 2 ถึง 20 จุด</span></div></div></div>`;
  };
  const adm = document.getElementById('adm');
  adm.className = '';
  adm.innerHTML = `<div class="hint">${icon('info')}<div class="hint-l">
      <div><b>จุดสถานะ</b> คือจุดที่พนักงานภาคสนามกดยืนยันในมือถือเมื่อลูกเรือไปถึง เช่น เครื่องลง ขึ้นรถ ถึงโรงแรม</div>
      <div>แก้แล้วมีผลกับลูกเรือที่เพิ่ม<b>หลังกดบันทึก</b> ลูกเรือที่เพิ่มไว้แล้วใช้จุดชุดเดิมของตัวเองต่อไป</div>
      <div><b>นาทีจากจุดก่อน</b> ใช้เติมเวลาตามแผนให้อัตโนมัติในขั้นตอนที่ 5 เมื่อกด "เติมเวลาที่เหลือ"</div>
      <div><b>ต้องถ่ายรูป</b> มือถือจะให้ถ่ายรูปพร้อมเวลาและพิกัดจากมือถือก่อนยืนยันจุดนั้น ถ้าไม่ถ่ายต้องใส่เหตุผล และสำนักงานจะเห็นว่าจุดนั้นรูปค้าง</div>
    </div></div>
    <form id="cpform" class="stack">${CP_LISTS.map(block).join('')}
      <div class="savebar"><div class="ferr" role="alert"></div><div class="row"><button class="btn" type="submit">${icon('check')}บันทึกจุดสถานะ</button><button class="btn line" type="button" data-act="a-cpreset">ยกเลิกการแก้ไข</button><span class="unsaved" id="cpdirty" role="status" hidden>ยังไม่ได้บันทึก</span></div></div></form>`;
  CP = { expected: structuredClone({ cp_on: s.cp_on, cp_off: s.cp_off, cp_on_chain: s.cp_on_chain, cp_off_chain: s.cp_off_chain }) };
  cpForm().querySelectorAll('.cp-edit').forEach(cpSync);
  CP.saved = JSON.stringify(cpRead());
  cpDirty();
  A.leave = () => !!cpForm() && JSON.stringify(cpRead()) !== CP.saved;
}

function cpRead() {
  const body = {};
  for (const box of cpForm().querySelectorAll('.cp-edit')) {
    body[box.dataset.key] = [...box.querySelectorAll('.cp-row')].map(r => ({ id: r.dataset.id, th: r.querySelector('[name=th]').value.trim(), en: r.querySelector('[name=en]').value.trim(), gap: +r.querySelector('[name=gap]').value || 0, photo: r.querySelector('[name=photo]').checked }));
    body[box.dataset.key + '_chain_id'] = box.dataset.chain;
  }
  return body;
}

function cpDirty() {
  const dirty = JSON.stringify(cpRead()) !== CP.saved;
  document.getElementById('cpdirty').hidden = !dirty;
  cpForm().querySelector('[data-act="a-cpreset"]').disabled = !dirty;
}

// Numbers, the live count, the move buttons and the choices of the forecast select all follow the rows on screen.
function cpSync(box) {
  const rows = [...box.querySelectorAll('.cp-row')], card = box.closest('.cp-card');
  rows.forEach((r, i) => {
    const name = r.querySelector('[name=th]').value.trim() || `จุดที่ ${i + 1}`;
    r.querySelector('.cp-n').textContent = i + 1;
    r.querySelectorAll('.cp-acts button').forEach(b => { b.title = b.dataset.say; b.setAttribute('aria-label', `${b.dataset.say} ${name}`); });
    r.querySelector('[data-act="a-cpup"]').disabled = i === 0;
    r.querySelector('[data-act="a-cpdown"]').disabled = i === rows.length - 1;
  });
  card.querySelector('.cp-count').textContent = `${rows.length} จุด`;
  const sel = card.querySelector('[data-chainsel]'), kept = rows.some(r => r.dataset.id === box.dataset.chain);
  sel.innerHTML = (kept ? '' : '<option value="">จุดเดิมถูกลบแล้ว กรุณาเลือกจุดใหม่</option>') + rows.map((r, i) => `<option value="${esc(r.dataset.id)}">${i + 1}. ${esc(r.querySelector('[name=th]').value.trim() || 'ยังไม่ได้ตั้งชื่อ')}</option>`).join('');
  sel.value = kept ? box.dataset.chain : '';
  if (!kept) box.dataset.chain = '';
}

function cpChanged(box, focus) {
  cpSync(box);
  cpDirty();
  if (focus && !focus.disabled) focus.focus();
}

function userDialog(u) {
  const edit = !!u;
  u = u || { role: 'field', see_all: false, active: true };
  openDialog(`<form class="dlg-form wide" autocomplete="off">${dlgHead(edit ? 'แก้ไขผู้ใช้ · ' + u.name : 'เพิ่มผู้ใช้')}<div class="dlg-b form">
    <label class="f">ชื่อที่แสดง<input name="name" required maxlength="80" value="${esc(u.name || '')}" placeholder="เช่น สมศักดิ์"></label>
    <label class="f">ชื่อผู้ใช้ (ภาษาอังกฤษ)<input name="username" ${edit ? 'disabled' : 'required'} pattern="[A-Za-z0-9._\-]{3,40}" autocapitalize="none" value="${esc(u.username || '')}" placeholder="เช่น somsak"></label>
    <label class="f" style="grid-column:1 / -1">สิทธิ์<select name="role" ${edit && u.id === A.me.id ? 'disabled' : ''}><option value="field" ${u.role === 'field' && !u.see_all ? 'selected' : ''}>พนักงานภาคสนาม</option><option value="lead" ${u.role === 'field' && u.see_all ? 'selected' : ''}>หัวหน้างานภาคสนาม</option><option value="office" ${u.role === 'office' ? 'selected' : ''}>สำนักงาน</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>ผู้ดูแลระบบ</option></select><span class="fhelp">พนักงานภาคสนาม ใช้มือถือ เห็นเฉพาะลูกเรือที่ได้รับมอบหมาย · หัวหน้างานภาคสนาม เห็นลูกเรือทุกคน · สำนักงาน ทำงาน 9 ขั้นตอน · ผู้ดูแลระบบ ทำได้เหมือนสำนักงาน และตั้งค่าระบบได้</span></label>
    <label class="f">รหัสพนักงาน (ไม่บังคับ)<input name="emp_code" maxlength="30" autocapitalize="characters" value="${esc(u.emp_code || '')}" placeholder="เช่น HR02"></label>
    <label class="f">ตำแหน่ง / หน้าที่<input name="title" maxlength="80" value="${esc(u.title || '')}" placeholder="เช่น Boarding agent · สนามบิน"></label>
    <label class="f">เบอร์โทร<input name="phone" maxlength="30" inputmode="tel" value="${esc(u.phone || '')}"></label>
    <label class="f">เลขบัตรประชาชน (ใช้ในอีเมล GATE PERMISSION)<input name="id_card" maxlength="30" value="${esc(u.id_card || '')}"></label>
    <label class="f">${edit ? 'ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน (อย่างน้อย 8 ตัว)'}<input name="password" type="password" ${edit ? '' : 'required'} minlength="8" autocomplete="new-password"></label>
    ${edit ? `<label class="f chk" style="grid-column:1 / -1"><input type="checkbox" name="active" ${u.active ? 'checked' : ''} ${u.id === A.me.id ? 'disabled' : ''}><span>เปิดใช้งานบัญชีนี้ (ปิดแล้วจะเข้าระบบไม่ได้ทันที)</span></label>` : ''}
    ${edit && u.locked ? `<label class="f chk" style="grid-column:1 / -1"><input type="checkbox" name="unlock" checked><span>ปลดล็อกบัญชี (ถูกล็อกเพราะใส่รหัสผิดหลายครั้ง)</span></label>` : ''}
    </div>${dlgFoot(edit ? 'บันทึก' : 'เพิ่มผู้ใช้')}</form>`, async fd => {
    const b = { name: fd.get('name'), emp_code: fd.get('emp_code'), title: fd.get('title'), phone: fd.get('phone'), id_card: fd.get('id_card') };
    const role = fd.get('role');
    if (role) { b.role = role === 'lead' ? 'field' : role; b.see_all = role === 'lead'; }
    if (fd.get('password')) b.password = fd.get('password');
    if (edit) {
      if (u.id !== A.me.id) b.active = fd.get('active') === 'on';
      if (fd.get('unlock')) b.unlock = true;
      await api('PATCH', `/api/users/${u.id}`, b);
    } else {
      b.username = fd.get('username');
      await api('POST', '/api/users', b);
    }
    await reloadRefs();
    toast(edit ? 'บันทึกแล้ว' : 'เพิ่มผู้ใช้แล้ว แจ้งชื่อผู้ใช้และรหัสผ่านให้พนักงานได้เลย');
    go('/admin/users', true);
  });
}

function resDialog(kind, x) {
  const veh = kind === 'vehicles';
  const edit = !!x;
  x = x || { active: 1 };
  const f = (n, l, attrs = '') => `<label class="f">${l}<input name="${n}" value="${esc(x[n] || '')}" ${attrs}></label>`;
  const drivers = A.users.filter(u => u.role === 'field' && u.active);
  const gone = x.user_id && !drivers.some(u => u.id === x.user_id) ? A.user(x.user_id) : null;
  const account = `<label class="f" style="grid-column:1 / -1"><span>บัญชีผู้ใช้ของคนขับ</span><select name="user_id"><option value="">ยังไม่มีบัญชี</option>${drivers.map(u => `<option value="${u.id}" ${x.user_id === u.id ? 'selected' : ''}>${esc(u.name)}${u.see_all ? ' (หัวหน้างานภาคสนาม)' : ''}${u.emp_code ? ' · ' + esc(u.emp_code) : ''}</option>`).join('')}</select><span class="fhelp">เมื่อเชื่อมบัญชีแล้ว ลูกเรือที่จัดให้รถคันนี้จะขึ้นในมือถือของคนขับคนนั้น · เลือกได้เฉพาะบัญชีพนักงานภาคสนามที่ยังใช้งาน · ลูกเรือที่จัดรถคันนี้ไว้ก่อนเชื่อมบัญชี ให้กดเปลี่ยนคนขับที่ขั้นตอนที่ 7 ของงานนั้น</span></label>${gone ? `<div class="okhint" style="grid-column:1 / -1">บัญชีที่เคยเชื่อมไว้ (${esc(gone.name)}) ถูกปิดแล้ว เลือกบัญชีใหม่ หรือกดบันทึกเพื่อยกเลิกการเชื่อม</div>` : ''}`;
  openDialog(`<form class="dlg-form" id="resf">${dlgHead((edit ? 'แก้ไข' : 'เพิ่ม') + (veh ? 'รถ' : 'โรงแรม'))}<div class="dlg-b form" style="grid-template-columns:1fr 1fr">
    ${veh ? f('name', 'ชื่อรถ', 'required maxlength="60" placeholder="เช่น รถตู้ 1"') + f('plate', 'ทะเบียน', 'maxlength="30"') + account + f('driver', 'คนขับ', 'maxlength="80" placeholder="เช่น คุณประเสริฐ"') + f('driver_en', 'ชื่อคนขับ (อังกฤษ)', 'maxlength="80"') + f('driver_id', 'เลขบัตรคนขับ', 'maxlength="30"') + f('driver_phone', 'เบอร์โทรคนขับ', 'maxlength="30" inputmode="tel"')
      : f('name', 'ชื่อโรงแรม', 'required maxlength="120"') + f('phone', 'เบอร์โทร', 'maxlength="30" inputmode="tel"')}
    ${edit ? `<label class="f chk" style="grid-column:1 / -1"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}><span>ยังใช้งานอยู่ (ปิดแล้วจะไม่แสดงให้เลือกในงานใหม่)</span></label>` : ''}
    </div>${dlgFoot()}</form>`, async fd => {
    const b = Object.fromEntries([...fd].filter(([k]) => k !== 'active'));
    if (edit) b.active = fd.get('active') === 'on';
    await api(edit ? 'PATCH' : 'POST', `/api/${kind}${edit ? '/' + x.id : ''}`, b);
    await reloadRefs();
    toast('บันทึกแล้ว');
    go(`/admin/${kind}`, true);
  });
  const form = document.getElementById('resf');
  if (veh) form.elements.user_id.addEventListener('change', e => {
    const u = A.user(+e.target.value);
    if (!u) return;
    // Only empty boxes are filled from the account, and they stay editable.
    for (const [name, value] of [['driver', u.name], ['driver_phone', u.phone], ['driver_id', u.id_card]]) if (value && !form.elements[name].value.trim()) form.elements[name].value = value;
  });
}

async function loadPreview(alive) {
  try {
    const { jobs } = await api('GET', '/api/jobs?status=open');
    if (!jobs.length || !alive()) return;
    const last = jobs.reduce((a, b) => (b.created_at > a.created_at ? b : a));
    const d = await api('GET', `/api/jobs/${last.id}`);
    if (!alive()) return;
    PREVIEW = d;
    document.querySelectorAll('#mailform details.tpl').forEach(showPreview);
  } catch (e) {}
}

function showPreview(det) {
  const box = det && det.querySelector('.tpl-prev');
  if (!PREVIEW || !box) return;
  const ta = det.querySelector('textarea');
  box.hidden = false;
  box.querySelector('.sub').textContent = `ตัวอย่างจากงาน ${PREVIEW.job.vessel} (ยังไม่บันทึก)`;
  box.querySelector('pre').textContent = mail(ta.name, PREVIEW.job, PREVIEW.crew, { ...A, settings: { ...A.settings, mail_tpl: { [ta.name]: ta.value } } });
}

export const actions = {
  'a-adduser'() { userDialog(null); },
  'a-edituser'(t) { userDialog(USERS.find(u => u.id === +t.dataset.id)); },
  'a-res'(t) { const list = t.dataset.kind === 'vehicles' ? A.vehicles : A.hotels; resDialog(t.dataset.kind, t.dataset.id ? list.find(x => x.id === +t.dataset.id) : null); },
  'a-cpadd'(t) {
    const box = document.querySelector(`.cp-edit[data-key="${t.dataset.key}"]`);
    if (box.children.length >= 20) return toast('มีได้ไม่เกิน 20 จุด');
    box.insertAdjacentHTML('beforeend', cpRow({ id: newPointId(), th: '', en: '', gap: 30, photo: false }));
    cpChanged(box, box.lastElementChild.querySelector('input'));
  },
  'a-cpdel'(t) {
    const box = t.closest('.cp-edit'), row = t.closest('.cp-row');
    if (box.children.length <= 2) return toast('ต้องมีอย่างน้อย 2 จุด');
    const next = (row.nextElementSibling || row.previousElementSibling).querySelector('[data-act="a-cpdel"]');
    row.remove();
    cpChanged(box, next);
  },
  'a-cpup'(t) {
    const row = t.closest('.cp-row');
    if (!row.previousElementSibling) return;
    row.previousElementSibling.before(row);
    cpChanged(row.parentElement, row.previousElementSibling ? t : row.querySelector('[data-act="a-cpdown"]'));
  },
  'a-cpdown'(t) {
    const row = t.closest('.cp-row');
    if (!row.nextElementSibling) return;
    row.nextElementSibling.after(row);
    cpChanged(row.parentElement, row.nextElementSibling ? t : row.querySelector('[data-act="a-cpup"]'));
  },
  'a-cpreset'() {
    renderPoints();
    toast('ยกเลิกการแก้ไขแล้ว แสดงค่าที่บันทึกไว้ล่าสุด');
  },
  'a-tplreset'(t) {
    const det = t.closest('details');
    det.querySelector('textarea').value = DEFAULT_TPL[t.dataset.kind];
    showPreview(det);
    toast('คืนค่าเริ่มต้นแล้ว กด "บันทึกข้อความอีเมล" เพื่อใช้งาน');
  },
  'a-oktbreset'(t) {
    document.getElementById('oktbform').elements[t.dataset.key].value = DEFAULT_OKTB[t.dataset.key];
    toast('คืนค่าเริ่มต้นแล้ว กด "บันทึกเอกสาร OK TO BOARD" เพื่อใช้งาน');
  },
  async 'a-branddel'(t) {
    const kind = t.dataset.kind, label = BRAND.find(b => b[0] === kind)[1];
    if (!window.confirm(`ลบรูป${label} ?`)) return;
    t.disabled = true;
    try {
      A.brand = (await api('DELETE', `/api/brand/${kind}`)).brand;
      document.getElementById('brands').innerHTML = brandTiles();
      toast(`ลบรูป${label}แล้ว`);
    } catch (e) {
      t.disabled = false;
      t.closest('.brand').querySelector('.ferr').textContent = e.message;
    }
  }
};

export const changes = {
  async 'a-brand'(t) {
    const file = t.files && t.files[0], kind = t.dataset.kind, label = BRAND.find(b => b[0] === kind)[1];
    t.value = '';
    if (!file) return;
    const tile = t.closest('.brand'), err = tile.querySelector('.ferr'), stat = tile.querySelector('.fstat');
    err.textContent = '';
    try {
      const type = uploadType(file, ['image/png', 'image/jpeg']);
      if (!type) throw new Error('รองรับเฉพาะไฟล์รูป PNG / JPG');
      if (file.size > 2 * 1024 * 1024) throw new Error('รูปใหญ่เกิน 2 MB ย่อรูปแล้วอัปโหลดใหม่');
      tile.classList.add('busy');
      stat.textContent = 'กำลังอัปโหลด...';
      A.brand = (await api('PUT', `/api/brand/${kind}`, new Blob([file], { type }))).brand;
      document.getElementById('brands').innerHTML = brandTiles();
      toast(`อัปโหลด${label}แล้ว`);
    } catch (e) {
      tile.classList.remove('busy');
      stat.textContent = '';
      err.textContent = e.message;
    }
  }
};

document.addEventListener('input', e => {
  if (e.target.matches('#mailform textarea')) showPreview(e.target.closest('details'));
  if (e.target.matches('#cpform .cp-row input')) {
    if (e.target.name === 'th') cpSync(e.target.closest('.cp-edit'));
    cpDirty();
  }
});

document.addEventListener('change', e => {
  if (e.target.matches('#cpform [data-chainsel]')) {
    const box = e.target.closest('.cp-card').querySelector('.cp-edit');
    box.dataset.chain = e.target.value;
    cpChanged(box);
  } else if (e.target.matches('#cpform .cp-row input')) cpDirty();
});

document.addEventListener('submit', async e => {
  const f = e.target;
  if (!['cpform', 'genform', 'mailform', 'oktbform'].includes(f.id)) return;
  e.preventDefault();
  const err = f.querySelector('.ferr');
  err.textContent = '';
  const btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    let body;
    if (f.id === 'cpform') {
      body = cpRead();
      const lost = CP_LISTS.find(([key]) => !body[key + '_chain_id']);
      if (lost) {
        f.querySelector(`[name="${lost[0]}_chain"]`).focus();
        throw new Error(`${lost[1]}: จุดที่เลือกไว้ในช่อง "ถ้าลูกเรือมาช้า" ถูกลบแล้ว กรุณาเลือกจุดใหม่ก่อนบันทึก`);
      }
      body.cp_expected = CP.expected;
    } else if (f.id === 'mailform') {
      const blank = MAIL_KINDS.find(([k]) => !f.elements[k].value.trim());
      if (blank) {
        f.elements[blank[0]].closest('details').open = true;
        throw new Error(`ข้อความ "${blank[1]}" ว่างอยู่ พิมพ์ข้อความหรือกดคืนค่าเริ่มต้นก่อนบันทึก`);
      }
      body = { mail_tpl: Object.fromEntries(MAIL_KINDS.map(([k]) => [k, f.elements[k].value])), mail_tpl_expected: f.mailExpected };
    } else if (f.id === 'oktbform') {
      const o = Object.fromEntries(Object.keys(DEFAULT_OKTB).map(k => [k, f.elements[k].value]));
      if (!o.intro.trim() || !o.guarantee.trim()) throw new Error('ย่อหน้าในจดหมายว่างอยู่ พิมพ์ข้อความหรือกดคืนค่าเริ่มต้นก่อนบันทึก');
      body = { oktb: o };
    } else {
      const fd = new FormData(f);
      const lines = k => String(fd.get(k) || '').split('\n').map(s => s.trim()).filter(Boolean);
      body = { company: { name: fd.get('name'), name_th: fd.get('name_th'), signature: fd.get('signature') }, late_min: +fd.get('late_min'), storage_warning_percent: +fd.get('storage_warning_percent'), docs: lines('docs'), services: lines('services') };
    }
    const r = await api('PUT', '/api/settings', body);
    A.settings = r.settings;
    if (f.id === 'mailform') f.mailExpected = structuredClone(r.settings.mail_tpl);
    if (f.id === 'genform') {
      const storage = await api('GET', '/api/storage').catch(() => null);
      if (f.isConnected) document.querySelector('.storage-status')?.replaceWith(document.createRange().createContextualFragment(storageCard(storage)));
    }
    if (f.id === 'cpform' && f.isConnected) renderPoints();
    toast(f.id === 'mailform' ? 'บันทึกข้อความอีเมลแล้ว' : f.id === 'oktbform' ? 'บันทึกเอกสาร OK TO BOARD แล้ว' : f.id === 'cpform' ? 'บันทึกจุดสถานะแล้ว มีผลกับลูกเรือที่เพิ่มหลังจากนี้' : 'บันทึกการตั้งค่าแล้ว');
  } catch (x) { err.textContent = x.message; }
  finally { btn.disabled = false; }
});
