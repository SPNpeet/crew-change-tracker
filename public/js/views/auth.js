import { A, go, boot, chrome } from '../app.js';
import { api } from '../api.js';
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

export async function enter(r) {
  if (r.name === 'account') return account();
  chrome(false);
  if (r.name === 'setup') {
    const s = await api('GET', '/api/setup');
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
  async logout() {
    await api('POST', '/api/logout');
    A.me = null;
    go('/login', true);
  }
};
