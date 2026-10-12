import { A, go, boot, chrome, flushPending } from '../app.js';
import { api, pendingItems, otherPendingCount, itemKey, pendingFile, discardPending, retryPending, logoutDevice } from '../api.js';
import { esc } from '../core.js';
import { icon, toast } from '../ui.js';

const app = () => document.getElementById('app');
const ROLE = { admin: 'ผู้ดูแลระบบ', office: 'สำนักงาน', field: 'พนักงานภาคสนาม' };
export const roleLabel = u => u.role === 'field' && u.see_all ? 'หัวหน้างานภาคสนาม' : ROLE[u.role];

function shell(inner) {
  return `<div class="auth"><div class="auth-card card">
    <div class="auth-logo"><div class="mk"><svg class="i" viewBox="0 0 24 24"><path d="M3 17c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0"/><path d="M5 14l1.5-5h11L19 14"/><path d="M12 9V4"/><path d="M9 6h6"/></svg></div><div><b>Crew Change Tracker</b><span>Success Marine Service</span></div></div>
    ${inner}</div></div>`;
}

export async function enter(r, alive = () => true) {
  if (r.name === 'account') return account();
  chrome(false);
  if (r.name === 'setup') {
    const s = await api('GET', '/api/setup');
    if (!alive()) return;
    if (!s.needed) return go('/login', true);
    app().innerHTML = shell(`<h1 class="auth-t">ติดตั้งระบบครั้งแรก</h1><p class="muted s14">สร้างบัญชีผู้ดูแลระบบคนแรก ใช้รหัสติดตั้งที่ได้รับจากผู้พัฒนา</p>
      <form class="form1" id="setupf" autocomplete="off">
        <label class="f">รหัสติดตั้ง<input name="key" type="password" required></label>
        <label class="f">ชื่อที่แสดง<input name="name" required maxlength="80" placeholder="เช่น คุณสมหญิง"></label>
        <label class="f">ชื่อผู้ใช้ (ภาษาอังกฤษ)<input name="username" required pattern="[A-Za-z0-9._\-]{3,40}" autocapitalize="none" placeholder="เช่น somying"></label>
        <label class="f">รหัสผ่าน (อย่างน้อย 8 ตัว)<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <div class="ferr" role="alert"></div>
        <button class="btn block big-btn" type="submit">สร้างบัญชีและเข้าสู่ระบบ</button></form>`);
    document.getElementById('setupf').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api('POST', '/api/setup', Object.fromEntries(f), { allow401: true });
        await boot();
        go('/', true);
      } catch (x) { e.target.querySelector('.ferr').textContent = x.message; }
    });
    return;
  }
  if (A.me) return go('/', true);
  let needed = false;
  try { needed = (await api('GET', '/api/setup')).needed; } catch (e) {}
  if (!alive()) return;
  if (needed) return go('/setup', true);
  app().innerHTML = shell(`<h1 class="auth-t">เข้าสู่ระบบ</h1>
    <form class="form1" id="loginf">
      <label class="f">ชื่อผู้ใช้<input name="username" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
      <label class="f">รหัสผ่าน<input name="password" type="password" required autocomplete="current-password"></label>
      <div class="ferr" role="alert"></div>
      <button class="btn block big-btn" type="submit">เข้าสู่ระบบ</button>
    </form>
    <p class="muted s13 auth-foot">ลืมรหัสผ่าน ติดต่อผู้ดูแลระบบของบริษัทเพื่อตั้งรหัสใหม่</p>`);
  document.getElementById('loginf').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await api('POST', '/api/login', Object.fromEntries(new FormData(e.target)), { allow401: true });
      await boot();
      go('/', true);
    } catch (x) {
      e.target.querySelector('.ferr').textContent = x.message;
    } finally { btn.disabled = false; }
  });
}

function account() {
  const u = A.me;
  const items = pendingItems(u.id);
  app().innerHTML = `<div class="narrow stack">
    <div class="card"><div class="card-h"><h3>บัญชีของฉัน</h3></div><div class="card-b">
      <div class="who-row"><span class="av lg">${esc([...u.name][0] || '?')}</span><div><div class="nm">${esc(u.name)}</div><div class="sub">${esc(roleLabel(u))}${u.title ? ' · ' + esc(u.title) : ''}</div><div class="sub">ชื่อผู้ใช้ ${esc(u.username)}</div></div></div>
    </div></div>
    <div class="card"><div class="card-h"><h3>เปลี่ยนรหัสผ่าน</h3></div><div class="card-b">
      <form class="form1" id="pwf">
        <label class="f">รหัสผ่านเดิม<input name="current" type="password" required autocomplete="current-password"></label>
        <label class="f">รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <div class="ferr" role="alert"></div>
        <button class="btn" type="submit">${icon('lock')}เปลี่ยนรหัสผ่าน</button>
      </form></div></div>
    <div class="card" id="pending-work"><div class="card-h"><h3>งานที่ยังส่งไม่สำเร็จ (${items.length})</h3></div><div class="card-b stack">
      <p class="muted s14">ก่อนออกจากระบบ กรุณาส่งงานให้ครบ หรือบันทึกสำเนาแล้วลบรายการที่ไม่ต้องการ ระบบจะไม่ลบงานค้างให้อัตโนมัติ</p>
      ${otherPendingCount(u.id) ? '<p class="muted s14">เครื่องนี้มีงานค้างของบัญชีอื่น ระบบจะเก็บไว้หลังออกจากระบบ เพื่อให้เจ้าของบัญชีกลับเข้าสู่ระบบมาส่งหรือบันทึกสำเนา</p>' : ''}
      ${items.map(it => `<div class="stack"><div>${esc(it.label || (it.photo ? 'รูปภาพ' : 'ยืนยันจุด'))}</div><div class="sub">${esc(new Date(it.at).toLocaleString('th-TH'))}</div>${it.error ? `<p class="ferr" role="alert">${esc(it.error)}</p>` : '<div class="sub">รอส่งเมื่อเชื่อมต่อและเข้าสู่ระบบด้วยบัญชีนี้</div>'}<div class="stack"><button class="btn line" type="button" data-act="pending-save" data-key="${esc(itemKey(it))}">${icon('download')}บันทึกสำเนา</button><button class="btn line" type="button" data-act="pending-discard" data-key="${esc(itemKey(it))}">ลบรายการนี้ออกจากเครื่อง</button></div></div>`).join('')}
      ${items.length ? '<button class="btn" type="button" data-act="pending-retry">ลองส่งอีกครั้ง</button>' : '<div class="sub">ไม่มีงานค้างของบัญชีนี้</div>'}
    </div></div>
    <button class="btn line block" type="button" data-act="logout">${icon('out')}ออกจากระบบ</button>
  </div>`;
  document.getElementById('pwf').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('POST', '/api/me/password', Object.fromEntries(new FormData(e.target)));
      e.target.reset();
      toast('เปลี่ยนรหัสผ่านแล้ว เครื่องอื่นที่เคยเข้าระบบจะต้องเข้าใหม่');
    } catch (x) { e.target.querySelector('.ferr').textContent = x.message; }
  });
}

export const actions = {
  async logout(t) {
    if (t.disabled) return;
    t.disabled = true;
    try {
      await flushPending();
      await logoutDevice(A.me.id);
      location.replace('/login');
    } catch (e) { account(); toast(e.message, 8000); }
    finally { t.disabled = false; }
  },
  async 'pending-retry'(t) {
    t.disabled = true;
    try {
      const r = await retryPending(A.me.id);
      account();
      toast(r.failed.length ? r.failed.join(' • ') : `ส่งสำเร็จ ${r.sent} รายการ`, 6000);
    } finally { t.disabled = false; }
  },
  async 'pending-save'(t) {
    const { blob, name } = await pendingFile(t.dataset.key, A.me.id);
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('ดาวน์โหลดสำเนาแล้ว โปรดตรวจสอบไฟล์ก่อนลบรายการ');
  },
  async 'pending-discard'(t) {
    if (!window.confirm('ลบงานที่ยังส่งไม่สำเร็จนี้ออกจากเครื่อง? หากยังต้องใช้ กรุณาบันทึกสำเนาและตรวจสอบไฟล์ก่อน การลบนี้เรียกคืนไม่ได้')) return;
    await discardPending(t.dataset.key, A.me.id);
    account();
    toast('ลบรายการที่เลือกแล้ว');
  }
};
