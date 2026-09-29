import { api, flushOutbox, pendingCount } from './api.js';
import { esc, hm } from './core.js';
import { icon, toast, closeLb, busy } from './ui.js';
import * as auth from './views/auth.js';
import * as jobs from './views/jobs.js';
import * as office from './views/office.js';
import * as field from './views/field.js';
import * as owner from './views/owner.js';
import * as admin from './views/admin.js';
import * as report from './views/report.js';

export const A = {
  me: null, settings: null, users: [], vehicles: [], hotels: [],
  route: { name: 'boot', params: {} },
  ui: {},
  actions: {},
  changes: {},
  user: id => A.users.find(u => u.id === id),
  vehicle: id => A.vehicles.find(v => v.id === id),
  hotelName: id => (A.hotels.find(h => h.id === id) || {}).name || '',
  isOffice: () => A.me && (A.me.role === 'admin' || A.me.role === 'office'),
  isAdmin: () => A.me && A.me.role === 'admin'
};

const VIEWS = { login: auth, setup: auth, jobs, newjob: jobs, job: office, field, crew: field, owner, admin, account: auth, report };
[auth, jobs, office, field, owner, admin, report].forEach(v => { Object.assign(A.actions, v.actions || {}); Object.assign(A.changes, v.changes || {}); });

function parse(path) {
  const p = path.replace(/\/+$/, '') || '/';
  let m;
  if ((m = /^\/t\/([A-Za-z0-9_-]{16,40})$/.exec(p))) return { name: 'owner', params: { token: m[1] } };
  if (p === '/login') return { name: 'login', params: {} };
  if (p === '/setup') return { name: 'setup', params: {} };
  if (p === '/account') return { name: 'account', params: {} };
  if (p === '/jobs') return { name: 'jobs', params: { status: new URLSearchParams(location.search).get('status') || 'open' } };
  if (p === '/jobs/new') return { name: 'newjob', params: {} };
  if ((m = /^\/jobs\/(\d+)\/report$/.exec(p))) return { name: 'report', params: { id: +m[1] } };
  if ((m = /^\/jobs\/(\d+)(?:\/([1-9]))?$/.exec(p))) return { name: 'job', params: { id: +m[1], step: +(m[2] || 0) } };
  if (p === '/field') return { name: 'field', params: {} };
  if ((m = /^\/field\/(\d+)$/.exec(p))) return { name: 'crew', params: { crew: +m[1] } };
  if ((m = /^\/admin(?:\/(users|vehicles|hotels|points|general|backup))?$/.exec(p))) return { name: 'admin', params: { tab: m[1] || 'users' } };
  return { name: 'home', params: {} };
}

export function go(path, replace) {
  if (path !== location.pathname + location.search) {
    try { history[replace ? 'replaceState' : 'pushState']({ app: 1 }, '', path); } catch (e) {}
  }
  route();
}

let loadSeq = 0;
export async function route() {
  const r = parse(location.pathname);
  closeLb();
  const dlg = document.getElementById('dlg');
  if (dlg.open) dlg.close();
  if (r.name === 'owner') { A.route = r; chrome(false); return VIEWS.owner.enter(r); }
  if (!A.me && !['login', 'setup'].includes(r.name)) {
    try { await boot(); } catch (e) {
      if (e.status === 401) return go('/login' , true);
      A.route = { name: 'error', params: {} };
      chrome(false);
      document.getElementById('app').innerHTML = `<div class="center-card card card-b"><h3>เชื่อมต่อระบบไม่ได้</h3><p class="muted">${esc(e.message)}</p><button class="btn" type="button" data-act="reload">${icon('refresh')}ลองใหม่</button></div>`;
      return;
    }
  }
  if (r.name === 'home') return go(A.isOffice() ? '/jobs' : '/field', true);
  if (A.me && ['jobs', 'newjob', 'job', 'report'].includes(r.name) && !A.isOffice()) return go('/field', true);
  if (r.name === 'admin' && !A.isAdmin()) return go('/', true);
  A.route = r;
  chrome(!!A.me && r.name !== 'report' && !['login', 'setup'].includes(r.name));
  const seq = ++loadSeq;
  const view = VIEWS[r.name];
  await view.enter(r, () => seq === loadSeq);
  window.scrollTo(0, 0);
}

export async function boot() {
  const d = await api('GET', '/api/me', undefined, { allow401: true });
  Object.assign(A, { me: d.user, settings: d.settings, users: d.users, vehicles: d.vehicles, hotels: d.hotels });
  document.getElementById('coname').textContent = d.settings.company.name.replace(/ Co\., Ltd\.$/, '');
}

export async function reloadRefs() {
  const d = await api('GET', '/api/me');
  Object.assign(A, { me: d.user, settings: d.settings, users: d.users, vehicles: d.vehicles, hotels: d.hotels });
}

function navItems() {
  if (!A.me) return [];
  const items = [];
  if (A.isOffice()) items.push(['/jobs', 'งานเปลี่ยนลูกเรือ', 'งาน', 'list', ['jobs', 'newjob', 'job']]);
  items.push(['/field', A.isOffice() ? 'หน้าจอภาคสนาม' : 'ลูกเรือของฉัน', A.isOffice() ? 'ภาคสนาม' : 'ลูกเรือ', 'phone', ['field', 'crew']]);
  if (A.isAdmin()) items.push(['/admin', 'ตั้งค่าระบบ', 'ตั้งค่า', 'gear', ['admin']]);
  items.push(['/account', 'บัญชีของฉัน', 'บัญชี', 'user', ['account']]);
  return items;
}

export function chrome(show) {
  const top = document.getElementById('top'), mt = document.getElementById('mtabs');
  top.hidden = !show;
  mt.hidden = !show;
  document.body.classList.toggle('bare', !show);
  if (!show) return;
  const items = navItems();
  const cur = A.route.name;
  document.getElementById('views').innerHTML = items.filter(i => i[0] !== '/account').map(([h, l, , ic, names]) => `<a href="${h}" data-link aria-current="${names.includes(cur)}">${icon(ic)}<span>${l}</span></a>`).join('');
  mt.innerHTML = items.map(([h, , s, ic, names]) => `<a href="${h}" data-link aria-current="${names.includes(cur)}">${icon(ic)}<span>${s}</span></a>`).join('');
  mt.style.gridTemplateColumns = `repeat(${items.length},1fr)`;
  const mb = document.getElementById('mebtn');
  mb.innerHTML = `<span class="av sm">${esc([...A.me.name][0] || '?')}</span><span class="nm">${esc(A.me.name)}</span>`;
  mb.setAttribute('aria-current', String(cur === 'account'));
  document.body.classList.toggle('detail', cur === 'crew');
}

document.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]');
  if (a && !e.ctrlKey && !e.metaKey && !e.shiftKey && a.target !== '_blank') {
    e.preventDefault();
    go(a.getAttribute('href'));
    return;
  }
  const t = e.target.closest('[data-act]');
  if (!t || t.tagName === 'INPUT' && t.type === 'file') return;
  const fn = A.actions[t.dataset.act];
  if (fn) { e.preventDefault(); Promise.resolve(fn(t, e)).catch(err => toast(err.message || 'ทำรายการไม่สำเร็จ')); }
});
document.addEventListener('change', e => {
  const t = e.target.closest('[data-chg]');
  if (!t) return;
  const fn = A.changes[t.dataset.chg];
  if (fn) Promise.resolve(fn(t, e)).catch(err => toast(err.message || 'บันทึกไม่สำเร็จ'));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.getElementById('lb').hidden) closeLb(); });

A.actions['lb-close'] = () => closeLb();
A.actions.reload = () => location.reload();
A.actions.back = () => { if (history.state && history.state.app) history.back(); else go(A.isOffice() ? '/jobs' : '/field', true); };

window.addEventListener('popstate', route);
window.addEventListener('cct-logout', () => { if (A.route.name !== 'owner' && A.route.name !== 'login') { A.me = null; go('/login', true); } });

function tick() {
  document.getElementById('clock').textContent = hm(Date.now());
  const view = VIEWS[A.route.name];
  if (document.visibilityState === 'visible' && view && view.poll && !busy()) view.poll(A.route);
}
setInterval(tick, 20000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
window.addEventListener('online', async () => {
  const n = await flushOutbox(A.me && A.me.id);
  if (n) { toast(`ส่งข้อมูลที่ค้างไว้ ${n} รายการแล้ว`); tick(); }
});
setInterval(async () => { if (A.me && pendingCount(A.me.id) && navigator.onLine) { const n = await flushOutbox(A.me.id); if (n) tick(); } }, 30000);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});

document.getElementById('clock').textContent = hm(Date.now());
route();
