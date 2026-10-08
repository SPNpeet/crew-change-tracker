import { A, go, reloadRefs } from '../app.js';
import { api } from '../api.js';
import { esc, fmtFull, mail, DEFAULT_TPL } from '../core.js';
import { icon, toast, openDialog, dlgHead, dlgFoot } from '../ui.js';
import { roleLabel } from './auth.js';

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
    el().innerHTML = `<div class="card"><div class="card-h"><h3>ผู้ใช้งาน</h3><span class="sub">ใช้งานอยู่ ${active} / ${A.settings.max_users} บัญชี</span><div class="act"><button class="btn" data-act="a-adduser" type="button" ${active >= A.settings.max_users ? 'disabled' : ''}>${icon('plus')}เพิ่มผู้ใช้</button></div></div>
      <div class="scroll"><table class="t nw"><thead><tr><th>ชื่อ</th><th>ชื่อผู้ใช้</th><th>สิทธิ์</th><th>เบอร์โทร</th><th>สถานะ</th><th></th></tr></thead><tbody>
      ${USERS.map(u => `<tr class="${u.active ? '' : 'dim'}"><td><div class="nm">${esc(u.name)}</div><div class="sub">${esc(u.title || '')}</div></td><td>${esc(u.username)}</td><td>${esc(roleLabel(u))}</td><td>${esc(u.phone || '—')}</td><td>${u.active ? (u.locked ? '<span class="pill warn-c">ล็อกชั่วคราว</span>' : '<span class="pill ok">ใช้งาน</span>') : '<span class="pill gray">ปิดแล้ว</span>'}</td><td class="acts"><button class="btn line sm" data-act="a-edituser" data-id="${u.id}" type="button">${icon('edit')}แก้ไข</button></td></tr>`).join('')}
      </tbody></table></div></div>
      <p class="muted s13">พนักงานภาคสนามเห็นเฉพาะลูกเรือที่ได้รับมอบหมาย ยกเว้นเปิด "เห็นลูกเรือทุกคน" สำหรับหัวหน้างาน · บัญชีที่ไม่ใช้แล้วให้ปิดแทนการลบ เพื่อให้ประวัติงานยังอยู่ครบ</p>`;
    return;
  }
  if (tab === 'vehicles' || tab === 'hotels') {
    await reloadRefs();
    if (!alive()) return;
    const list = tab === 'vehicles' ? A.vehicles : A.hotels;
    el().className = '';
    el().innerHTML = `<div class="card"><div class="card-h"><h3>${tab === 'vehicles' ? 'รถและคนขับ' : 'โรงแรม'}</h3><span class="sub">${list.filter(x => x.active).length} รายการที่ใช้งาน</span><div class="act"><button class="btn" data-act="a-res" data-kind="${tab}" type="button">${icon('plus')}เพิ่ม${tab === 'vehicles' ? 'รถ' : 'โรงแรม'}</button></div></div>
      ${list.length ? `<div class="scroll"><table class="t nw"><thead><tr>${tab === 'vehicles' ? '<th>รถ</th><th>ทะเบียน</th><th>คนขับ</th><th>ชื่อคนขับ (อังกฤษ)</th><th>เลขบัตร</th><th>เบอร์โทร</th>' : '<th>โรงแรม</th><th>เบอร์โทร</th>'}<th>สถานะ</th><th></th></tr></thead><tbody>
      ${list.map(x => `<tr class="${x.active ? '' : 'dim'}">${tab === 'vehicles' ? `<td class="nm">${esc(x.name)}</td><td>${esc(x.plate)}</td><td>${esc(x.driver)}</td><td>${esc(x.driver_en)}</td><td>${esc(x.driver_id)}</td><td>${esc(x.driver_phone)}</td>` : `<td class="nm">${esc(x.name)}</td><td>${esc(x.phone)}</td>`}<td>${x.active ? '<span class="pill ok">ใช้งาน</span>' : '<span class="pill gray">ไม่ใช้แล้ว</span>'}</td><td class="acts"><button class="btn line sm" data-act="a-res" data-kind="${tab}" data-id="${x.id}" type="button">${icon('edit')}แก้ไข</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="card-b muted">ยังไม่มีรายการ</div>'}</div>
      <p class="muted s13">${tab === 'vehicles' ? 'ชื่อคนขับภาษาอังกฤษ เลขบัตร และทะเบียน ใช้ในอีเมล GATE PERMISSION' : 'โรงแรมที่เพิ่มไว้จะเลือกได้ในขั้นตอนที่ 7'}</p>`;
    return;
  }
  if (tab === 'points') {
    const s = A.settings;
    const block = (key, title) => {
      const list = s[key], chain = s[key + '_chain'];
      return `<div class="card"><div class="card-h"><h3>${title}</h3><span class="sub">${list.length} จุด</span></div><div class="card-b">
        <div class="cp-edit" data-key="${key}">${list.map((x, i) => cpRow(x, i, chain)).join('')}</div>
        <div class="row" style="margin-top:10px"><button class="btn line sm" data-act="a-cpadd" data-key="${key}" type="button">${icon('plus')}เพิ่มจุด</button></div></div></div>`;
    };
    el().className = '';
    el().innerHTML = `<div class="hint">${icon('info')}<span>จุดสถานะใช้กับลูกเรือที่เพิ่ม<b>หลังจากบันทึก</b> ลูกเรือเดิมใช้จุดชุดเดิมต่อ · "นาทีจากจุดก่อน" ใช้เติมเวลาแผนอัตโนมัติ · <b>จุดสิ้นสุดการเลื่อนเวลา</b>: ถ้าลูกเรือช้า ระบบเลื่อนเวลาคาดการณ์ของจุดถัดไปจนถึงจุดนี้</span></div>
      <form id="cpform" class="stack">${block('cp_on', 'On signer (ขึ้นเรือ)')}${block('cp_off', 'Off signer (ลงเรือ)')}
      <div class="ferr" role="alert"></div><div><button class="btn" type="submit">${icon('check')}บันทึกจุดสถานะ</button></div></form>`;
    return;
  }
  if (tab === 'general') {
    const s = A.settings;
    const tpl = { ...DEFAULT_TPL, ...s.mail_tpl };
    PREVIEW = null;
    el().className = 'stack';
    el().innerHTML = `<form id="genform" class="card"><div class="card-h"><h3>ตั้งค่าทั่วไป</h3></div><div class="card-b form">
      <label class="f">ชื่อบริษัท (ไทย)<input name="name_th" value="${esc(s.company.name_th)}" maxlength="120"></label>
      <label class="f">ชื่อบริษัท (อังกฤษ)<input name="name" value="${esc(s.company.name)}" maxlength="120"></label>
      <label class="f" style="grid-column:1 / -1">ลายเซ็นท้ายอีเมล<textarea name="signature" rows="3" maxlength="400">${esc(s.company.signature)}</textarea></label>
      <label class="f">ถือว่า "ช้ากว่าแผน" เมื่อเกิน (นาที)<input name="late_min" type="number" min="1" max="240" value="${s.late_min}" required></label>
      <div></div>
      <label class="f">เอกสารที่ต้องมีต่อคน (บรรทัดละ 1 รายการ)<textarea name="docs" rows="5">${esc(s.docs.join('\n'))}</textarea></label>
      <label class="f">เรื่องที่ได้รับแต่งตั้ง (บรรทัดละ 1 รายการ)<textarea name="services" rows="5">${esc(s.services.join('\n'))}</textarea></label>
      <div class="ferr" role="alert" style="grid-column:1 / -1"></div>
      <div style="grid-column:1 / -1"><button class="btn" type="submit">${icon('check')}บันทึก</button></div>
    </div></form>
    <form id="mailform" class="card"><div class="card-h"><h3>ข้อความอีเมล</h3><span class="sub">แก้สำนวนอีเมลได้เอง · คำในวงเล็บปีกกา เช่น {{vessel}} ระบบจะแทนค่าจากงานให้</span></div><div class="card-b stack tpl-list">
      ${MAIL_KINDS.map(([k, title, where, vars]) => `<details class="tpl"><summary><b>${esc(title)}</b><span class="sub">${where}</span></summary><div class="tpl-b">
        <textarea class="mail" name="${k}" maxlength="4000" spellcheck="false" aria-label="ข้อความอีเมล ${esc(title)}">${esc(tpl[k])}</textarea>
        <div class="tpl-vars">${vars.map(v => `<div><code>{{${v}}}</code><span>${esc(VAR_TH[v])}</span></div>`).join('')}</div>
        <div class="tpl-prev" hidden><div class="sub"></div><pre></pre></div>
        <div class="row"><button class="btn line sm" data-act="a-tplreset" data-kind="${k}" type="button">${icon('refresh')}คืนค่าเริ่มต้น</button></div>
      </div></details>`).join('')}
      <div class="ferr" role="alert"></div>
      <div><button class="btn" type="submit">${icon('check')}บันทึกข้อความอีเมล</button></div>
    </div></form>`;
    loadPreview(alive);
    return;
  }
  if (tab === 'backup') {
    const d = await api('GET', '/api/backups');
    if (!alive()) return;
    const monthly = d.backups.filter(b => !b.name.startsWith('daily/'));
    const nightly = d.backups.filter(b => b.name.startsWith('daily/'));
    const table = (list, label) => list.length ? `<div class="scroll"><table class="t nw"><thead><tr><th>${label}</th><th>ขนาด</th><th>สร้างเมื่อ</th><th></th></tr></thead><tbody>${list.map(b => `<tr><td class="nm">${esc(b.name.replace('daily/', '').replace(/\.(xlsx|json\.gz)$/, ''))}</td><td>${Math.max(1, Math.round(b.size / 1024))} KB</td><td>${fmtFull(Date.parse(b.uploaded))}</td><td class="acts"><a class="btn line sm" href="/api/backups/${b.name.split('/').map(encodeURIComponent).join('/')}" download>${icon('download')}ดาวน์โหลด</a></td></tr>`).join('')}</tbody></table></div>` : '';
    el().className = 'stack';
    el().innerHTML = `<div class="card"><div class="card-h"><h3>ดาวน์โหลดข้อมูลทั้งหมดตอนนี้</h3></div><div class="card-b"><p class="muted s14" style="margin-top:0">ไฟล์ Excel รวมงาน ลูกเรือ Time log ความเคลื่อนไหว ผู้ใช้ รถ และโรงแรม</p><a class="btn" href="/api/export/all.xlsx" download>${icon('download')}ดาวน์โหลด Excel ทั้งระบบ</a></div></div>
      <div class="card"><div class="card-h"><h3>สำรองทั้งระบบทุกคืน</h3><span class="sub">02:00 ทุกคืน · เก็บย้อนหลัง 35 วัน · ใช้กู้ระบบได้ทั้งหมด</span></div>
        ${table(nightly.slice(0, 7), 'วันที่') || '<div class="card-b muted">ไฟล์แรกจะถูกสร้างคืนนี้เวลา 02:00</div>'}
        <div class="card-b muted s13">ไฟล์ทุกคืนและรูปถ่ายทั้งหมด ถูกดึงไปเก็บที่ NAS ของบริษัทอัตโนมัติ (ตั้งค่าครั้งเดียวที่ NAS ตามคู่มือหัวข้อสำรองข้อมูล)</div></div>
      <div class="card"><div class="card-h"><h3>ไฟล์ Excel รายเดือน</h3><span class="sub">สร้างให้อัตโนมัติทุกวันที่ 1 ของเดือน</span></div>
        ${table(monthly, 'เดือน') || '<div class="card-b muted">ยังไม่มีไฟล์ ไฟล์แรกจะถูกสร้างในวันที่ 1 ของเดือนถัดไป</div>'}</div>
      <p class="muted s13">ฐานข้อมูลยังสำรองอัตโนมัติอีกชั้น กู้คืนย้อนหลังได้ 30 วัน (ติดต่อผู้พัฒนา)</p>`;
  }
}

function cpRow(x, i, chain) {
  return `<div class="cp-row"><span class="cp-n">${i + 1}</span><input name="th" value="${esc(x.th)}" maxlength="60" placeholder="ชื่อจุด (ไทย)" aria-label="ชื่อจุดภาษาไทย" required><input name="en" value="${esc(x.en)}" maxlength="60" placeholder="ชื่อจุด (อังกฤษ สำหรับ Owner)" aria-label="ชื่อจุดภาษาอังกฤษ"><label class="cp-gap"><input name="gap" type="number" min="0" max="10080" value="${x.gap}" aria-label="นาทีจากจุดก่อน"><span>นาทีจากจุดก่อน</span></label><label class="cp-chain"><input type="radio" name="chain-${i}" value="${i}" ${i === chain ? 'checked' : ''} data-chain aria-label="จุดสิ้นสุดการเลื่อนเวลา"><span>จุดสิ้นสุดการเลื่อนเวลา</span></label><button class="iconbtn" type="button" data-act="a-cpdel" aria-label="ลบจุด">${icon('trash')}</button></div>`;
}

function userDialog(u) {
  const edit = !!u;
  u = u || { role: 'field', see_all: false, active: true };
  openDialog(`<form class="dlg-form wide" autocomplete="off">${dlgHead(edit ? 'แก้ไขผู้ใช้ · ' + u.name : 'เพิ่มผู้ใช้')}<div class="dlg-b form">
    <label class="f">ชื่อที่แสดง<input name="name" required maxlength="80" value="${esc(u.name || '')}" placeholder="เช่น สมศักดิ์"></label>
    <label class="f">ชื่อผู้ใช้ (ภาษาอังกฤษ)<input name="username" ${edit ? 'disabled' : 'required'} pattern="[A-Za-z0-9._\-]{3,40}" autocapitalize="none" value="${esc(u.username || '')}" placeholder="เช่น somsak"></label>
    <label class="f">สิทธิ์<select name="role" ${edit && u.id === A.me.id ? 'disabled' : ''}><option value="field" ${u.role === 'field' ? 'selected' : ''}>พนักงานภาคสนาม (มือถือ)</option><option value="office" ${u.role === 'office' ? 'selected' : ''}>สำนักงาน</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>ผู้ดูแลระบบ</option></select></label>
    <label class="f chk"><input type="checkbox" name="see_all" ${u.see_all ? 'checked' : ''}><span>เห็นลูกเรือทุกคน (หัวหน้างานภาคสนาม)</span></label>
    <label class="f">ตำแหน่ง / หน้าที่<input name="title" maxlength="80" value="${esc(u.title || '')}" placeholder="เช่น Boarding agent · สนามบิน"></label>
    <label class="f">เบอร์โทร<input name="phone" maxlength="30" inputmode="tel" value="${esc(u.phone || '')}"></label>
    <label class="f">เลขบัตรประชาชน (ใช้ในอีเมล GATE PERMISSION)<input name="id_card" maxlength="30" value="${esc(u.id_card || '')}"></label>
    <label class="f">${edit ? 'ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน (อย่างน้อย 8 ตัว)'}<input name="password" type="password" ${edit ? '' : 'required'} minlength="8" autocomplete="new-password"></label>
    ${edit ? `<label class="f chk" style="grid-column:1 / -1"><input type="checkbox" name="active" ${u.active ? 'checked' : ''} ${u.id === A.me.id ? 'disabled' : ''}><span>เปิดใช้งานบัญชีนี้ (ปิดแล้วจะเข้าระบบไม่ได้ทันที)</span></label>` : ''}
    ${edit && u.locked ? `<label class="f chk" style="grid-column:1 / -1"><input type="checkbox" name="unlock" checked><span>ปลดล็อกบัญชี (ถูกล็อกเพราะใส่รหัสผิดหลายครั้ง)</span></label>` : ''}
    </div>${dlgFoot(edit ? 'บันทึก' : 'เพิ่มผู้ใช้')}</form>`, async fd => {
    const b = { name: fd.get('name'), title: fd.get('title'), phone: fd.get('phone'), id_card: fd.get('id_card'), see_all: fd.get('see_all') === 'on' };
    if (fd.get('role')) b.role = fd.get('role');
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
  openDialog(`<form class="dlg-form">${dlgHead((edit ? 'แก้ไข' : 'เพิ่ม') + (veh ? 'รถ' : 'โรงแรม'))}<div class="dlg-b form" style="grid-template-columns:1fr 1fr">
    ${veh ? f('name', 'ชื่อรถ', 'required maxlength="60" placeholder="เช่น รถตู้ 1"') + f('plate', 'ทะเบียน', 'maxlength="30"') + f('driver', 'คนขับ', 'maxlength="80" placeholder="เช่น คุณประเสริฐ"') + f('driver_en', 'ชื่อคนขับ (อังกฤษ)', 'maxlength="80"') + f('driver_id', 'เลขบัตรคนขับ', 'maxlength="30"') + f('driver_phone', 'เบอร์โทรคนขับ', 'maxlength="30" inputmode="tel"')
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

function renumber(box) {
  [...box.querySelectorAll('.cp-row')].forEach((r, i) => {
    r.querySelector('.cp-n').textContent = i + 1;
    const radio = r.querySelector('[data-chain]');
    radio.value = i;
  });
}

export const actions = {
  'a-adduser'() { userDialog(null); },
  'a-edituser'(t) { userDialog(USERS.find(u => u.id === +t.dataset.id)); },
  'a-res'(t) { const list = t.dataset.kind === 'vehicles' ? A.vehicles : A.hotels; resDialog(t.dataset.kind, t.dataset.id ? list.find(x => x.id === +t.dataset.id) : null); },
  'a-cpadd'(t) {
    const box = document.querySelector(`.cp-edit[data-key="${t.dataset.key}"]`);
    box.insertAdjacentHTML('beforeend', cpRow({ th: '', en: '', gap: 30 }, box.children.length, -1));
    renumber(box);
    box.lastElementChild.querySelector('input').focus();
  },
  'a-cpdel'(t) {
    const box = t.closest('.cp-edit');
    if (box.children.length <= 2) return toast('ต้องมีอย่างน้อย 2 จุด');
    t.closest('.cp-row').remove();
    renumber(box);
  },
  'a-tplreset'(t) {
    const det = t.closest('details');
    det.querySelector('textarea').value = DEFAULT_TPL[t.dataset.kind];
    showPreview(det);
    toast('คืนค่าเริ่มต้นแล้ว กด "บันทึกข้อความอีเมล" เพื่อใช้งาน');
  }
};

document.addEventListener('input', e => {
  if (e.target.matches('#mailform textarea')) showPreview(e.target.closest('details'));
});

document.addEventListener('change', e => {
  if (!e.target.matches('.cp-edit [data-chain]')) return;
  const box = e.target.closest('.cp-edit');
  box.querySelectorAll('[data-chain]').forEach(r => { if (r !== e.target) r.checked = false; });
});

document.addEventListener('submit', async e => {
  const f = e.target;
  if (f.id !== 'cpform' && f.id !== 'genform' && f.id !== 'mailform') return;
  e.preventDefault();
  const err = f.querySelector('.ferr');
  err.textContent = '';
  const btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    let body;
    if (f.id === 'cpform') {
      body = {};
      for (const box of f.querySelectorAll('.cp-edit')) {
        const key = box.dataset.key;
        const rows = [...box.querySelectorAll('.cp-row')];
        body[key] = rows.map(r => ({ th: r.querySelector('[name=th]').value, en: r.querySelector('[name=en]').value, gap: +r.querySelector('[name=gap]').value || 0 }));
        const ch = rows.findIndex(r => r.querySelector('[data-chain]').checked);
        body[key + '_chain'] = ch < 0 ? 0 : ch;
      }
    } else if (f.id === 'mailform') {
      const blank = MAIL_KINDS.find(([k]) => !f.elements[k].value.trim());
      if (blank) {
        f.elements[blank[0]].closest('details').open = true;
        throw new Error(`ข้อความ "${blank[1]}" ว่างอยู่ พิมพ์ข้อความหรือกดคืนค่าเริ่มต้นก่อนบันทึก`);
      }
      body = { mail_tpl: Object.fromEntries(MAIL_KINDS.map(([k]) => [k, f.elements[k].value])) };
    } else {
      const fd = new FormData(f);
      const lines = k => String(fd.get(k) || '').split('\n').map(s => s.trim()).filter(Boolean);
      body = { company: { name: fd.get('name'), name_th: fd.get('name_th'), signature: fd.get('signature') }, late_min: +fd.get('late_min'), docs: lines('docs'), services: lines('services') };
    }
    const r = await api('PUT', '/api/settings', body);
    A.settings = r.settings;
    toast(f.id === 'mailform' ? 'บันทึกข้อความอีเมลแล้ว' : 'บันทึกการตั้งค่าแล้ว');
  } catch (x) { err.textContent = x.message; }
  finally { btn.disabled = false; }
});
