import { HttpError, json, readJson, randomId, sha256, now, str, text, ms, ymd, intOrNull, parseJson, bkk, bkkParts } from './util.js';
import { documentNameEn } from '../public/js/core.js';
import { login, logout, currentUser, sessionCookie, hashPassword, checkPasswordRules, publicUser, isOffice, seesAllCrew, requireUser, requireOffice, requireAdmin } from './auth.js';
import { DEFAULTS, EDITABLE, BRAND_KINDS, loadSettings, loadBrand } from './settings.js';
import { buildXlsx } from './xlsx.js';

const MAX_PHOTO = 10 * 1024 * 1024;
const MAX_BRAND = 2 * 1024 * 1024;
const MAX_AVATAR = 1024 * 1024;
const UPLOAD_ID = /^[A-Za-z0-9_-]{16,80}$/;
const GPS_STATES = ['ok', 'denied', 'unavailable', 'timeout'];
const CP_KEYS = ['cp_on', 'cp_off', 'cp_on_chain', 'cp_off_chain'];
const ROLE_EN = { agent: 'Agent', driver: 'Driver', lead: 'Field lead', office: 'Office', admin: 'Admin' };
const USED_BYTES = '(SELECT COALESCE(SUM(size), 0) FROM photos) + (SELECT COALESCE(SUM(size), 0) FROM crew_files) + (SELECT COALESCE(SUM(avatar_size), 0) FROM users)';
const FILE_KINDS = { passport: 'พาสปอร์ต', sirb: 'Seaman book', ticket: 'ตั๋วเครื่องบิน', other: 'อื่น ๆ' };
const FILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const BRAND_LABEL = { letterhead: 'หัวจดหมาย', signature: 'ลายเซ็น', stamp: 'ตราประทับ' };
const JOB_FIELDS = ['vessel', 'port', 'owner', 'owner_email', 'agent', 'agent_email', 'remark'];
const JOB_TIMES = ['eta', 'etb', 'etd', 'imm_deadline'];
const SENT_KEYS = ['appoint', 'sched', 'gate', 'plan', 'owner'];

export default {
  async fetch(req, env, ctx) {
    try {
      const url = new URL(req.url);
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
      if (req.method !== 'GET' && req.method !== 'HEAD') guardWrite(req, url);
      return await route(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error('unhandled', e && e.stack || e);
      return json({ error: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง' }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(daily(env, Number(env.CRON_NOW) || event.scheduledTime));
  }
};

function guardWrite(req, url) {
  const origin = req.headers.get('origin');
  if (origin && origin !== url.origin) throw new HttpError(403, 'คำขอไม่ได้มาจากหน้าระบบ');
  if (req.headers.get('x-cct') !== '1') throw new HttpError(403, 'คำขอไม่ได้มาจากหน้าระบบ');
}

async function route(req, env, url) {
  const p = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  const seg = p.split('/').slice(2);

  if (p === '/api/health') return json({ ok: true });
  if (p === '/api/setup' && m === 'GET') return json({ needed: await setupNeeded(env) });
  if (p === '/api/setup' && m === 'POST') return setup(req, env, url);
  if (p === '/api/login' && m === 'POST') return doLogin(req, env, url);
  if (p === '/api/logout' && m === 'POST') { await logout(req, env); return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', url.protocol === 'https:'), 'clear-site-data': '"cache"' }); }
  if (seg[0] === 'public' && seg[1] && m === 'GET') return publicJob(env, seg[1]);

  const u = await currentUser(req, env);
  requireUser(u);
  const expectedUser = req.headers.get('x-cct-user');
  if (expectedUser && expectedUser !== String(u.id)) throw new HttpError(401, 'บัญชีในหน้าต่างนี้เปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่');

  if (p === '/api/me' && m === 'GET') return json(await bootFor(env, u));
  if (p === '/api/storage' && m === 'GET') {
    requireOffice(u);
    const settings = await loadSettings(env);
    const row = await env.DB.prepare(`SELECT ${USED_BYTES} AS used`).first();
    const usedBytes = row.used, limitBytes = settings.storage_gb * 1024 ** 3;
    const warningPercent = settings.storage_warning_percent;
    return json({ usedBytes, limitBytes, warningPercent, percent: Math.round(usedBytes / limitBytes * 10000) / 100,
      level: usedBytes >= limitBytes ? 'full' : usedBytes * 100 >= limitBytes * warningPercent ? 'warning' : 'ok' });
  }
  if (p === '/api/me/password' && m === 'POST') return changeOwnPassword(req, env, u);
  if (p === '/api/me/avatar' && m === 'PUT') return putAvatar(req, env, u);
  if (p === '/api/me/avatar' && m === 'DELETE') return deleteAvatar(env, u);
  if (seg[0] === 'avatar' && seg.length === 2 && m === 'GET') return getAvatar(env, seg[1]);
  if (p === '/api/jobs' && m === 'GET') return listJobs(env, u, url);
  if (p === '/api/jobs' && m === 'POST') return createJob(req, env, u);
  if (p === '/api/field' && m === 'GET') return fieldList(env, u);

  if (seg[0] === 'jobs' && seg[1]) {
    const id = intOrNull(seg[1]);
    if (seg.length === 2 && m === 'GET') return json(await jobFull(env, u, id));
    if (seg.length === 2 && m === 'PATCH') return patchJob(req, env, u, id);
    if (seg.length === 2 && m === 'DELETE') return deleteJob(env, u, id);
    if (seg[2] === 'crew' && m === 'POST') return addCrew(req, env, u, id);
    if (seg[2] === 'token' && m === 'POST') return newToken(env, u, id);
    if (seg[2] === 'log' && m === 'POST') return addLog(req, env, u, id);
    if (seg[2] === 'export.xlsx' && m === 'GET') return exportJob(env, u, id);
  }
  if (seg[0] === 'crew' && seg[1]) {
    const id = intOrNull(seg[1]);
    if (seg.length === 2 && m === 'PATCH') return patchCrew(req, env, u, id);
    if (seg.length === 2 && m === 'DELETE') return deleteCrew(env, u, id);
    if (seg[2] === 'plan' && m === 'PUT') return putPlan(req, env, u, id);
    if (seg[2] === 'confirm' && m === 'POST') return confirm(req, env, u, id);
    if (seg[2] === 'undo' && m === 'POST') return undo(req, env, u, id);
    if (seg[2] === 'notes' && m === 'POST') return addNote(req, env, u, id);
    if (seg[2] === 'photos' && m === 'POST') return addPhoto(req, env, u, id, url);
    if (seg[2] === 'files' && m === 'POST') return addFile(req, env, u, id, url);
  }
  if (seg[0] === 'photos' && seg[1]) {
    const id = intOrNull(seg[1]);
    if (m === 'GET') return getPhoto(env, u, id);
    if (m === 'DELETE') return deletePhoto(env, u, id);
  }
  if (seg[0] === 'files' && seg.length === 2) {
    const id = intOrNull(seg[1]);
    if (m === 'GET') return getFile(env, u, id);
    if (m === 'DELETE') return deleteFile(env, u, id);
  }
  if (seg[0] === 'brand' && seg.length === 2) {
    if (m === 'GET') return getBrand(env, u, seg[1]);
    if (m === 'PUT') return putBrand(req, env, u, seg[1]);
    if (m === 'DELETE') return deleteBrand(env, u, seg[1]);
  }
  if (seg[0] === 'users') {
    if (seg.length === 1 && m === 'GET') return listUsers(env, u);
    if (seg.length === 1 && m === 'POST') return createUser(req, env, u);
    if (seg.length === 2 && m === 'PATCH') return patchUser(req, env, u, intOrNull(seg[1]));
  }
  if (seg[0] === 'vehicles' || seg[0] === 'hotels') {
    if (seg.length === 1 && m === 'POST') return saveResource(req, env, u, seg[0], null);
    if (seg.length === 2 && m === 'PATCH') return saveResource(req, env, u, seg[0], intOrNull(seg[1]));
  }
  if (p === '/api/settings' && m === 'PUT') return putSettings(req, env, u);
  if (p === '/api/export/all.xlsx' && m === 'GET') { requireOffice(u); return xlsxResponse(await allData(env), `crew-change-all-${fileDate()}.xlsx`); }
  if (p === '/api/backups' && m === 'GET') return listBackups(env, u);
  if (seg[0] === 'backups' && seg[1] && m === 'GET') return getBackup(env, u, seg.slice(1).join('/'));
  throw new HttpError(404, 'ไม่พบรายการนี้');
}

/* ---------- auth ---------- */

async function setupNeeded(env) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  return r.n === 0;
}

async function setup(req, env, url) {
  const b = await readJson(req);
  if (!env.SETUP_KEY || String(b.key || '') !== env.SETUP_KEY) throw new HttpError(403, 'รหัสติดตั้งไม่ถูกต้อง');
  if (!(await setupNeeded(env))) throw new HttpError(409, 'ติดตั้งระบบไปแล้ว');
  await insertUser(env, { username: b.username, name: b.name, role: 'admin', password: b.password });
  const { token, user } = await login(env, b.username, b.password);
  return json({ user: publicUser(user) }, 200, { 'set-cookie': sessionCookie(token, url.protocol === 'https:') });
}

async function doLogin(req, env, url) {
  const b = await readJson(req);
  const { token, user } = await login(env, b.username, b.password);
  return json({ user: publicUser(user) }, 200, { 'set-cookie': sessionCookie(token, url.protocol === 'https:') });
}

async function changeOwnPassword(req, env, u) {
  const b = await readJson(req);
  const { hash } = await hashPassword(String(b.current || ''), u.pw_salt);
  if (hash !== u.pw_hash) throw new HttpError(400, 'รหัสผ่านเดิมไม่ถูกต้อง');
  checkPasswordRules(b.password);
  const h = await hashPassword(b.password);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(h.hash, h.salt, u.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').bind(u.id, u.token_hash)
  ]);
  return json({ ok: true });
}

async function boot(env, u) {
  const settings = await loadSettings(env);
  const [users, vehicles, hotels] = await Promise.all([
    env.DB.prepare('SELECT id, name, role, see_all, title, phone, id_card, emp_code, active FROM users ORDER BY active DESC, name').all(),
    env.DB.prepare(isOffice(u) ? 'SELECT * FROM vehicles ORDER BY active DESC, name' : 'SELECT id, name, plate, driver, driver_phone, active FROM vehicles ORDER BY active DESC, name').all(),
    env.DB.prepare('SELECT * FROM hotels ORDER BY active DESC, name').all()
  ]);
  const people = isOffice(u) ? users.results : users.results.map(x => ({ id: x.id, name: x.name, role: x.role, title: x.title, active: x.active }));
  return { user: publicUser(u), settings, users: people, vehicles: vehicles.results, hotels: hotels.results, now: now() };
}

/* ---------- users & resources ---------- */

async function insertUser(env, b) {
  const username = str(b.username, 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3–40 ตัว');
  const name = str(b.name, 80);
  if (!name) throw new HttpError(400, 'กรุณากรอกชื่อ');
  if (!['admin', 'office', 'field'].includes(b.role)) throw new HttpError(400, 'สิทธิ์ไม่ถูกต้อง');
  checkPasswordRules(b.password);
  const settings = await loadSettings(env);
  const active = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').first();
  if (active.n >= settings.max_users) throw new HttpError(409, `บัญชีผู้ใช้ครบ ${settings.max_users} บัญชีตามใบเสนอราคาแล้ว ปิดบัญชีที่ไม่ใช้ก่อนจึงจะเพิ่มได้`);
  const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (exists) throw new HttpError(409, 'ชื่อผู้ใช้นี้มีอยู่แล้ว');
  const h = await hashPassword(b.password);
  const r = await env.DB.prepare('INSERT INTO users (username, name, role, see_all, title, phone, id_card, emp_code, pw_hash, pw_salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(username, name, b.role, b.see_all ? 1 : 0, str(b.title, 80), str(b.phone, 30), str(b.id_card, 30), str(b.emp_code, 30), h.hash, h.salt, now()).run();
  return r.meta.last_row_id;
}

async function listUsers(env, u) {
  requireAdmin(u);
  const { results } = await env.DB.prepare('SELECT * FROM users ORDER BY active DESC, role, name').all();
  return json({ users: results.map(x => ({ ...publicUser(x), locked: x.locked_until > now() })) });
}

async function createUser(req, env, u) {
  requireAdmin(u);
  const id = await insertUser(env, await readJson(req));
  return json({ id });
}

async function patchUser(req, env, u, id) {
  requireAdmin(u);
  const b = await readJson(req);
  const t = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!t) throw new HttpError(404, 'ไม่พบผู้ใช้');
  const stmts = [];
  const set = (col, v) => stmts.push(env.DB.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).bind(v, id));
  if ('name' in b) { const n = str(b.name, 80); if (!n) throw new HttpError(400, 'กรุณากรอกชื่อ'); set('name', n); }
  if ('title' in b) set('title', str(b.title, 80));
  if ('phone' in b) set('phone', str(b.phone, 30));
  if ('id_card' in b) set('id_card', str(b.id_card, 30));
  if ('emp_code' in b) set('emp_code', str(b.emp_code, 30));
  if ('see_all' in b) set('see_all', b.see_all ? 1 : 0);
  if ('role' in b) {
    if (!['admin', 'office', 'field'].includes(b.role)) throw new HttpError(400, 'สิทธิ์ไม่ถูกต้อง');
    if (id === u.id && b.role !== 'admin') throw new HttpError(400, 'เปลี่ยนสิทธิ์ของตัวเองไม่ได้');
    set('role', b.role);
  }
  if ('active' in b) {
    if (id === u.id && !b.active) throw new HttpError(400, 'ปิดบัญชีของตัวเองไม่ได้');
    if (b.active && !t.active) {
      const settings = await loadSettings(env);
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').first();
      if (n.n >= settings.max_users) throw new HttpError(409, `บัญชีผู้ใช้ครบ ${settings.max_users} บัญชีแล้ว`);
    }
    set('active', b.active ? 1 : 0);
    if (!b.active) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  }
  if ('password' in b) {
    checkPasswordRules(b.password);
    const h = await hashPassword(b.password);
    stmts.push(env.DB.prepare('UPDATE users SET pw_hash = ?, pw_salt = ?, failed = 0, locked_until = 0 WHERE id = ?').bind(h.hash, h.salt, id));
    stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  }
  if ('unlock' in b) set('locked_until', 0);
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true });
}

async function saveResource(req, env, u, kind, id) {
  requireOffice(u);
  const b = await readJson(req);
  const cols = kind === 'vehicles'
    ? { name: 60, plate: 30, driver: 80, driver_en: 80, driver_id: 30, driver_phone: 30 }
    : { name: 120, phone: 30 };
  const vals = {};
  for (const [c, max] of Object.entries(cols)) if (c in b) vals[c] = str(b[c], max);
  if ('active' in b) vals.active = b.active ? 1 : 0;
  if (kind === 'vehicles' && 'user_id' in b) {
    vals.user_id = intOrNull(b.user_id);
    if (vals.user_id != null && !(await env.DB.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'field' AND active = 1").bind(vals.user_id).first())) throw new HttpError(400, 'บัญชีคนขับต้องเป็นพนักงานภาคสนามที่ยังใช้งานอยู่');
  }
  if (id == null) {
    if (!vals.name) throw new HttpError(400, 'กรุณากรอกชื่อ');
    const keys = Object.keys(vals);
    const r = await env.DB.prepare(`INSERT INTO ${kind} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).bind(...keys.map(k => vals[k])).run();
    return json({ id: r.meta.last_row_id });
  }
  if ('name' in vals && !vals.name) throw new HttpError(400, 'กรุณากรอกชื่อ');
  if (!(await env.DB.prepare(`SELECT 1 FROM ${kind} WHERE id = ?`).bind(id).first())) throw new HttpError(404, 'ไม่พบรายการนี้');
  const keys = Object.keys(vals);
  if (keys.length) await env.DB.prepare(`UPDATE ${kind} SET ${keys.map(k => k + ' = ?').join(', ')} WHERE id = ?`).bind(...keys.map(k => vals[k]), id).run();
  return json({ ok: true });
}

async function putSettings(req, env, u) {
  requireAdmin(u);
  const b = await readJson(req);
  const stmts = [];
  if ('mail_tpl' in b) {
    const value = validateSetting('mail_tpl', b.mail_tpl);
    if (Object.keys(b).some(k => k !== 'mail_tpl' && k !== 'mail_tpl_expected')) throw new HttpError(400, 'กรุณาบันทึกข้อความอีเมลแยกจากการตั้งค่าอื่น');
    if (!('mail_tpl_expected' in b)) throw new HttpError(428, 'หน้านี้เป็นรุ่นเก่า กรุณาคัดลอกร่างไว้แล้วโหลดหน้าใหม่ก่อนบันทึก');
    const expected = validateSetting('mail_tpl', b.mail_tpl_expected);
    const prior = await env.DB.prepare("SELECT value FROM settings WHERE key = 'mail_tpl'").first();
    const current = parseJson(prior?.value, DEFAULTS.mail_tpl);
    const conflict = () => new HttpError(409, 'มีผู้แก้ข้อความอีเมลระหว่างที่คุณกำลังแก้ไข ร่างของคุณยังอยู่ กรุณาคัดลอกไว้แล้วโหลดหน้าใหม่เพื่อตรวจสอบก่อนบันทึก');
    if (Object.keys(value).some(k => current[k] !== expected[k])) throw conflict();
    // Compare again inside the write: another request can save after our read.
    const saved = await env.DB.prepare("INSERT INTO settings (key, value) SELECT 'mail_tpl', ? WHERE COALESCE((SELECT value FROM settings WHERE key = 'mail_tpl'), '') = ? ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(value), prior?.value ?? '').run();
    if (!saved.meta.changes) throw conflict();
    return json({ settings: { ...await loadSettings(env), mail_tpl: value } });
  }
  if (Object.keys(b).some(k => CP_KEYS.includes(k) || k === 'cp_on_chain_id' || k === 'cp_off_chain_id' || k === 'cp_expected')) return putPoints(env, b);
  for (const k of Object.keys(b)) {
    if (!EDITABLE.includes(k) || k === 'max_users' || k === 'storage_gb') continue;
    const v = validateSetting(k, b[k]);
    stmts.push(env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, JSON.stringify(v)));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ settings: await loadSettings(env) });
}

async function putPoints(env, b) {
  const next = {};
  for (const k of ['cp_on', 'cp_off']) if (k in b) next[k] = validateSetting(k, b[k]);
  if (Object.keys(b).some(k => !CP_KEYS.includes(k) && k !== 'cp_on_chain_id' && k !== 'cp_off_chain_id' && k !== 'cp_expected')) throw new HttpError(400, 'กรุณาบันทึกจุดสถานะแยกจากการตั้งค่าอื่น');
  if (!('cp_expected' in b)) throw new HttpError(428, 'หน้านี้เป็นรุ่นเก่า สิ่งที่แก้ยังไม่ถูกบันทึก กรุณาจดไว้แล้วโหลดหน้าใหม่ก่อนบันทึกจุดสถานะ');
  const e = b.cp_expected;
  if (!next.cp_on || !next.cp_off || !e || typeof e !== 'object' || Array.isArray(e)) throw new HttpError(400, 'กรุณาส่งจุดสถานะทั้งสองชุดพร้อมกัน');
  const expected = Object.fromEntries(CP_KEYS.map(k => [k, validateSetting(k, e[k])]));
  for (const k of ['cp_on', 'cp_off']) {
    const at = next[k].findIndex(x => x.id === b[k + '_chain_id']);
    if (at < 0) throw new HttpError(400, `จุดที่เลือกไว้ในช่อง "ถ้าลูกเรือมาช้า" ของ ${k === 'cp_on' ? 'On signer' : 'Off signer'} ไม่อยู่ในรายการแล้ว กรุณาเลือกจุดใหม่ก่อนบันทึก`);
    next[k + '_chain'] = at;
  }
  const conflict = () => new HttpError(409, 'มีผู้แก้จุดสถานะระหว่างที่คุณกำลังแก้ไข สิ่งที่คุณแก้ยังอยู่ในหน้านี้ กรุณาจดไว้แล้วโหลดหน้าใหม่เพื่อดูค่าล่าสุดก่อนบันทึก');
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('cp_on', 'cp_off', 'cp_on_chain', 'cp_off_chain')").all();
  const raw = k => (results.find(r => r.key === k) || {}).value ?? '';
  const current = await loadSettings(env);
  if (CP_KEYS.some(k => JSON.stringify(current[k]) !== JSON.stringify(expected[k]))) throw conflict();
  // The first write re-checks every stored value; the rest only follow a successful first write.
  const res = await env.DB.batch(CP_KEYS.map((k, i) => i === 0
    ? env.DB.prepare(`INSERT INTO settings (key, value) SELECT ?, ? WHERE ${CP_KEYS.map(() => "COALESCE((SELECT value FROM settings WHERE key = ?), '') = ?").join(' AND ')} ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(k, JSON.stringify(next[k]), ...CP_KEYS.flatMap(x => [x, raw(x)]))
    : env.DB.prepare('INSERT INTO settings (key, value) SELECT ?, ? WHERE changes() = 1 ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, JSON.stringify(next[k]))));
  if (!res[0].meta.changes) throw conflict();
  return json({ settings: await loadSettings(env) });
}

function validateSetting(k, v) {
  const def = DEFAULTS[k];
  if (k === 'storage_warning_percent') {
    if (!Number.isInteger(v) || v < 1 || v > 99) throw new HttpError(400, 'ตั้งค่าเตือนพื้นที่เป็นจำนวนเต็ม 1–99%');
    return v;
  }
  if (k === 'late_min') { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 240) throw new HttpError(400, 'เวลาช้ากว่าแผนต้องอยู่ระหว่าง 1–240 นาที'); return n; }
  if (k === 'cp_on_chain' || k === 'cp_off_chain') { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 30) throw new HttpError(400, 'ค่าไม่ถูกต้อง'); return n; }
  if (k === 'company') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'ข้อมูลบริษัทไม่ถูกต้อง');
    return { name: str(v.name, 120) || def.name, name_th: str(v.name_th, 120) || def.name_th, signature: text(v.signature, 400) || def.signature };
  }
  if (k === 'docs' || k === 'services') {
    if (!Array.isArray(v)) throw new HttpError(400, 'รูปแบบไม่ถูกต้อง');
    const out = [...new Set(v.map(x => str(x, 60)).filter(Boolean))].slice(0, 20);
    if (!out.length) throw new HttpError(400, 'ต้องมีอย่างน้อย 1 รายการ');
    return out;
  }
  if (k === 'cp_on' || k === 'cp_off') {
    if (!Array.isArray(v) || v.some(x => !x || typeof x !== 'object' || Array.isArray(x))) throw new HttpError(400, 'รูปแบบไม่ถูกต้อง');
    if (v.some(x => x.photo !== undefined && typeof x.photo !== 'boolean')) throw new HttpError(400, 'ค่า "ต้องถ่ายรูป" ไม่ถูกต้อง');
    if (v.some(x => x.id !== undefined && (typeof x.id !== 'string' || !/^[A-Za-z0-9_-]{2,24}$/.test(x.id)))) throw new HttpError(400, 'รหัสจุดสถานะไม่ถูกต้อง');
    const out = v.map(x => ({ id: x.id || randomId(8), th: str(x.th, 60), en: str(x.en, 60), gap: Math.max(0, Math.min(10080, Math.round(Number(x.gap) || 0))), photo: x.photo === true })).filter(x => x.th).slice(0, 20);
    if (new Set(out.map(x => x.id)).size !== out.length) throw new HttpError(400, 'จุดสถานะซ้ำกัน กรุณาโหลดหน้าใหม่');
    if (out.length < 2) throw new HttpError(400, 'จุดสถานะต้องมีอย่างน้อย 2 จุด');
    out.forEach(x => { if (!x.en) x.en = x.th; });
    return out;
  }
  if (k === 'mail_tpl') {
    const kinds = Object.keys(def);
    const ok = v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === kinds.length
      && kinds.every(x => typeof v[x] === 'string' && v[x].length <= 4000 && text(v[x]));
    if (!ok) throw new HttpError(400, 'ข้อความอีเมลไม่ถูกต้อง');
    return Object.fromEntries(kinds.map(x => [x, text(v[x], 4000)]));
  }
  if (k === 'oktb') {
    const keys = Object.keys(def);
    const ok = v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length
      && keys.every(x => typeof v[x] === 'string' && v[x].length <= 2000);
    if (!ok) throw new HttpError(400, 'ตั้งค่าเอกสาร OK TO BOARD ไม่ถูกต้อง');
    return Object.fromEntries(keys.map(x => [x, text(v[x], 2000)]));
  }
  throw new HttpError(400, 'ตั้งค่านี้ไม่ได้');
}

/* ---------- jobs ---------- */

async function getJob(env, id) {
  const j = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
  if (!j) throw new HttpError(404, 'ไม่พบงานนี้');
  return j;
}

function jobOut(j) {
  return { ...j, services: parseJson(j.services, []), steps: parseJson(j.steps, []), sent: parseJson(j.sent, {}), oktb: parseJson(j.oktb, {}) };
}

async function listJobs(env, u, url) {
  requireOffice(u);
  const status = url.searchParams.get('status') === 'closed' ? 'closed' : 'open';
  const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 200;
  const offset = url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, 'หน้ารายการไม่ถูกต้อง');
  const { results } = await env.DB.prepare(
    `SELECT j.id, j.vessel, j.port, j.owner, j.eta, j.etb, j.steps, j.status, j.created_at, j.closed_at,
       (SELECT COUNT(*) FROM crew c WHERE c.job_id = j.id AND c.type = 'on') AS n_on,
       (SELECT COUNT(*) FROM crew c WHERE c.job_id = j.id AND c.type = 'off') AS n_off
     FROM jobs j WHERE j.status = ? ORDER BY ${status === 'open' ? 'COALESCE(j.eta, j.created_at) ASC' : 'j.closed_at DESC'}, j.id ASC LIMIT ? OFFSET ?`
  ).bind(status, limit + 1, offset).all();
  return json({ jobs: results.slice(0, limit).map(j => ({ ...j, steps: parseJson(j.steps, []) })), nextOffset: results.length > limit ? offset + limit : null });
}

async function createJob(req, env, u) {
  requireOffice(u);
  const b = await readJson(req);
  const vessel = str(b.vessel, 120).toUpperCase();
  if (!vessel) throw new HttpError(400, 'กรุณากรอกชื่อเรือ');
  const t = now();
  const r = await env.DB.prepare(
    `INSERT INTO jobs (vessel, port, owner, owner_email, agent, agent_email, eta, etb, etd, imm_deadline, owner_token, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(vessel, str(b.port, 120), str(b.owner, 120), str(b.owner_email, 200), str(b.agent, 120), str(b.agent_email, 200),
    ms(b.eta), ms(b.etb), ms(b.etd), ms(b.imm_deadline), randomId(20), u.id, t, t).run();
  const id = r.meta.last_row_id;
  await log(env, id, u.id, `เปิดงาน ${vessel}`);
  return json({ id });
}

async function patchJob(req, env, u, id) {
  requireOffice(u);
  const j = await getJob(env, id);
  const b = await readJson(req);
  if (j.status !== 'open' && !(b.status === 'open' && Object.keys(b).length === 1)) throw new HttpError(409, 'งานนี้ปิดแล้ว กรุณาเปิดงานก่อนแก้ไข');
  const sets = {};
  const logs = [];
  for (const f of JOB_FIELDS) if (f in b) sets[f] = f === 'remark' ? text(b[f], 2000) : str(b[f], 200);
  if ('vessel' in sets) { sets.vessel = sets.vessel.toUpperCase(); if (!sets.vessel) throw new HttpError(400, 'กรุณากรอกชื่อเรือ'); }
  for (const f of JOB_TIMES) {
    if (!(f in b)) continue;
    const v = ms(b[f]);
    if (v === j[f]) continue;
    sets[f] = v;
    if (f !== 'imm_deadline') {
      const label = f.toUpperCase();
      const src = str(b.source, 120);
      logs.push({ kind: 'eta', text: j[f] == null ? `${label} ${bkk(v)}${src ? ' · ' + src : ''}` : `${label} เปลี่ยนจาก ${bkk(j[f])} เป็น ${bkk(v)}${src ? ' · ' + src : ''}` });
    }
  }
  if ('services' in b) {
    if (!Array.isArray(b.services)) throw new HttpError(400, 'รูปแบบไม่ถูกต้อง');
    sets.services = JSON.stringify([...new Set(b.services.map(x => str(x, 60)).filter(Boolean))].slice(0, 20));
  }
  if ('steps' in b) {
    if (!Array.isArray(b.steps) || b.steps.length !== 9) throw new HttpError(400, 'รูปแบบไม่ถูกต้อง');
    const old = parseJson(j.steps, []);
    const nw = b.steps.map(x => (x ? 1 : 0));
    nw.forEach((v, i) => { if (v !== (old[i] ? 1 : 0)) logs.push({ kind: 'log', text: `ขั้นตอนที่ ${i + 1} ${v ? 'เสร็จแล้ว' : 'เปิดใหม่'}` }); });
    sets.steps = JSON.stringify(nw);
  }
  if ('sent' in b) {
    const sent = parseJson(j.sent, {});
    for (const k of Object.keys(b.sent || {})) {
      if (!SENT_KEYS.includes(k)) continue;
      sent[k] = b.sent[k] ? now() : null;
      if (b.sent[k]) logs.push({ kind: 'log', text: { appoint: 'ส่งอีเมลแจ้ง Local Agent แล้ว', sched: 'แจ้งตารางเรือลูกค้าแล้ว', gate: 'ส่งอีเมล GATE PERMISSION แล้ว', plan: 'ส่งแผนให้ Owner / กัปตันแล้ว', owner: 'ส่งอีเมลอัปเดต Owner แล้ว' }[k] });
    }
    sets.sent = JSON.stringify(sent);
  }
  if ('oktb' in b) sets.oktb = JSON.stringify(oktbOptions(b.oktb));
  if ('status' in b) {
    if (!['open', 'closed'].includes(b.status)) throw new HttpError(400, 'สถานะไม่ถูกต้อง');
    if (b.status !== j.status) {
      sets.status = b.status;
      sets.closed_at = b.status === 'closed' ? now() : null;
      logs.push({ kind: 'log', text: b.status === 'closed' ? 'ปิดงาน' : 'เปิดงานอีกครั้ง' });
    }
  }
  const keys = Object.keys(sets);
  if (keys.length) {
    sets.updated_at = now();
    const all = Object.keys(sets);
    const stmts = [env.DB.prepare(`UPDATE jobs SET ${all.map(k => k + ' = ?').join(', ')} WHERE id = ?`).bind(...all.map(k => sets[k]), id)];
    for (const l of logs) stmts.push(env.DB.prepare('INSERT INTO activity (job_id, at, user_id, kind, text) VALUES (?, ?, ?, ?, ?)').bind(id, now(), u.id, l.kind, l.text));
    await env.DB.batch(stmts);
  }
  return json({ ok: true });
}

function oktbOptions(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'รูปแบบไม่ถูกต้อง');
  const crew = Array.isArray(v.crew) ? [...new Set(v.crew.filter(n => Number.isInteger(n) && n > 0))].slice(0, 200) : [];
  return {
    to: str(v.to, 200), date: ymd(v.date), call_date: ymd(v.call_date), flights: text(v.flights, 2000), company: str(v.company, 200),
    pic_name: str(v.pic_name, 120), pic_mobile: str(v.pic_mobile, 60), letterhead: !!v.letterhead, sign: !!v.sign, attach: !!v.attach, crew
  };
}

async function deleteJob(env, u, id) {
  requireAdmin(u);
  await getJob(env, id);
  const { results } = await env.DB.prepare('SELECT p.r2_key FROM photos p JOIN crew c ON c.id = p.crew_id WHERE c.job_id = ? UNION ALL SELECT f.r2_key FROM crew_files f JOIN crew c ON c.id = f.crew_id WHERE c.job_id = ?').bind(id, id).all();
  for (let i = 0; i < results.length; i += 900) await env.FILES.delete(results.slice(i, i + 900).map(r => r.r2_key));
  await env.DB.prepare('DELETE FROM jobs WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function newToken(env, u, id) {
  requireOffice(u);
  await getJob(env, id);
  const token = randomId(20);
  await env.DB.prepare('UPDATE jobs SET owner_token = ? WHERE id = ?').bind(token, id).run();
  await log(env, id, u.id, 'สร้างลิงก์ Owner ใหม่ ลิงก์เดิมใช้ไม่ได้แล้ว');
  return json({ owner_token: token });
}

async function addLog(req, env, u, id) {
  requireOffice(u);
  await getJob(env, id);
  const b = await readJson(req);
  const t = text(b.text, 500);
  if (!t) throw new HttpError(400, 'กรุณาพิมพ์ข้อความ');
  await log(env, id, u.id, t);
  return json({ ok: true });
}

async function log(env, jobId, userId, t, kind = 'log') {
  await env.DB.prepare('INSERT INTO activity (job_id, at, user_id, kind, text) VALUES (?, ?, ?, ?, ?)').bind(jobId, now(), userId, kind, t).run();
}

async function crewRows(env, where, binds, withFiles = false) {
  const { results: crew } = await env.DB.prepare(`SELECT * FROM crew WHERE ${where} ORDER BY job_id, CASE type WHEN 'on' THEN 0 ELSE 1 END, sort, id`).bind(...binds).all();
  if (!crew.length) return [];
  const ids = crew.map(c => c.id);
  const [cps, notes, photos] = await Promise.all(['checkpoints', 'notes', 'photos'].map(t => inChunks(env, `SELECT * FROM ${t} WHERE crew_id IN`, ids, t === 'checkpoints' ? 'ORDER BY idx' : 'ORDER BY at')));
  const by = (arr) => { const m = new Map(); for (const r of arr) { if (!m.has(r.crew_id)) m.set(r.crew_id, []); m.get(r.crew_id).push(r); } return m; };
  const mc = by(cps), mn = by(notes), mp = by(photos);
  const mf = withFiles ? by(await inChunks(env, 'SELECT id, crew_id, kind, name, mime, size, at FROM crew_files WHERE crew_id IN', ids, 'ORDER BY at, id')) : null;
  return crew.map(c => ({
    ...c, docs: parseJson(c.docs, {}), s4: parseJson(c.s4, {}),
    cps: (mc.get(c.id) || []).map(x => ({ idx: x.idx, name: x.name, name_en: x.name_en, plan: x.plan_at, actual: x.actual_at, by: x.actual_by, role: x.actual_role, received: x.received_at, need_photo: x.need_photo ? 1 : 0, skip: x.photo_skip })),
    notes: (mn.get(c.id) || []).map(x => ({ id: x.id, at: x.at, by: x.user_id, text: x.text })),
    photos: (mp.get(c.id) || []).map(x => ({ id: x.id, at: x.at, by: x.user_id, point: x.point, lat: x.lat, lng: x.lng, cp_idx: x.cp_idx, acc: x.acc, gps: x.gps, received: x.received_at })),
    ...(mf ? { files: (mf.get(c.id) || []).map(x => ({ id: x.id, kind: x.kind, name: x.name, mime: x.mime, size: x.size, at: x.at })) } : {})
  }));
}

async function inChunks(env, sql, ids, tail) {
  const out = [];
  for (let i = 0; i < ids.length; i += 80) {
    const part = ids.slice(i, i + 80);
    const { results } = await env.DB.prepare(`${sql} (${part.map(() => '?').join(',')}) ${tail}`).bind(...part).all();
    out.push(...results);
  }
  return out;
}

async function jobFull(env, u, id) {
  const j = await getJob(env, id);
  if (!isOffice(u)) {
    const mine = seesAllCrew(u) ? true : await env.DB.prepare('SELECT 1 FROM crew WHERE job_id = ? AND (agent_id = ? OR driver_id = ?) LIMIT 1').bind(id, u.id, u.id).first();
    if (!mine) throw new HttpError(403, 'บัญชีนี้ไม่มีสิทธิ์ดูงานนี้');
  }
  const crew = await crewRows(env, isOffice(u) || seesAllCrew(u) ? 'job_id = ?' : 'job_id = ? AND (agent_id = ? OR driver_id = ?)', isOffice(u) || seesAllCrew(u) ? [id] : [id, u.id, u.id], isOffice(u));
  const job = jobOut(j);
  if (!isOffice(u)) {
    for (const k of ['owner_token', 'owner_email', 'agent_email', 'remark', 'oktb']) delete job[k];
    return { job, crew: crew.map(fieldSafe), activity: [], now: now() };
  }
  const { results: activity } = await env.DB.prepare('SELECT a.at, a.kind, a.text, a.user_id, u.name AS who FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.job_id = ? ORDER BY a.at DESC, a.id DESC LIMIT 150').bind(id).all();
  return { job, crew, activity, now: now() };
}

function fieldSafe(c) {
  const { passport, passport_exp, sirb_no, sirb_exp, files, ...rest } = c;
  return rest;
}

async function fieldList(env, u) {
  const all = isOffice(u) || seesAllCrew(u);
  const crew = await crewRows(env, all ? "job_id IN (SELECT id FROM jobs WHERE status = 'open')" : "(agent_id = ? OR driver_id = ?) AND job_id IN (SELECT id FROM jobs WHERE status = 'open')", all ? [] : [u.id, u.id]);
  const jobIds = [...new Set(crew.map(c => c.job_id))];
  const jobs = jobIds.length ? await inChunks(env, 'SELECT id, vessel, port, eta, etb, etd, agent FROM jobs WHERE id IN', jobIds, 'ORDER BY eta') : [];
  if (isOffice(u)) return json({ jobs, crew, now: now() });
  const why = c => c.agent_id === u.id ? (c.driver_id === u.id ? 'both' : 'agent') : c.driver_id === u.id ? 'driver' : undefined;
  return json({ jobs, crew: crew.map(c => ({ ...fieldSafe(c), mine: why(c) })), now: now() });
}

/* ---------- crew ---------- */

async function getCrew(env, id) {
  const c = await env.DB.prepare('SELECT c.*, j.status AS job_status FROM crew c JOIN jobs j ON j.id = c.job_id WHERE c.id = ?').bind(id).first();
  if (!c) throw new HttpError(404, 'ไม่พบลูกเรือ');
  return c;
}

const ownCrew = (u, c) => isOffice(u) || seesAllCrew(u) || c.agent_id === u.id || c.driver_id === u.id;
const capacity = (u, c) => isOffice(u) ? u.role : c.agent_id === u.id ? 'agent' : c.driver_id === u.id ? 'driver' : 'lead';

function canField(u, c) {
  if (!ownCrew(u, c)) throw new HttpError(403, 'ลูกเรือคนนี้ไม่ได้อยู่ในความดูแลของคุณ');
}

async function vehicleDriver(env, vehicleId) {
  if (vehicleId == null) return null;
  const r = await env.DB.prepare("SELECT u.id FROM vehicles v JOIN users u ON u.id = v.user_id WHERE v.id = ? AND u.active = 1 AND u.role = 'field'").bind(vehicleId).first();
  return r ? r.id : null;
}

function openJob(c) {
  if (c.job_status !== 'open') throw new HttpError(409, 'งานนี้ปิดแล้ว แก้ไขไม่ได้');
}

function deviceTime(atRaw, sentRaw, t) {
  const num = v => v == null || v === '' ? NaN : Number(v);
  const at = num(atRaw), sentAt = num(sentRaw);
  if (Number.isFinite(at) && Number.isFinite(sentAt)) {
    const ago = Math.max(0, sentAt - at);
    return ago > 72 * 3600000 ? t : t - ago;
  }
  return !Number.isFinite(at) || at > t + 120000 || at < t - 12 * 3600000 ? t : at;
}

async function addCrew(req, env, u, jobId) {
  requireOffice(u);
  const j = await getJob(env, jobId);
  if (j.status !== 'open') throw new HttpError(409, 'งานนี้ปิดแล้ว แก้ไขไม่ได้');
  const b = await readJson(req);
  const list = Array.isArray(b.crew) ? b.crew : [b];
  if (!list.length || list.length > 60) throw new HttpError(400, 'จำนวนลูกเรือไม่ถูกต้อง');
  const settings = await loadSettings(env);
  const rows = list.map(x => {
    const name = str(x && x.name, 120);
    if (!name) throw new HttpError(400, 'กรุณากรอกชื่อลูกเรือให้ครบทุกคน');
    if (x.type !== undefined && !['on', 'off'].includes(x.type)) throw new HttpError(400, 'ประเภทไม่ถูกต้อง');
    const type = x.type === 'off' ? 'off' : 'on';
    const tpl = type === 'on' ? settings.cp_on : settings.cp_off;
    return { name, type, tpl, agent: intOrNull(x.agent_id), chain: Math.min(tpl.length - 1, type === 'on' ? settings.cp_on_chain : settings.cp_off_chain), passport_exp: ymd(x.passport_exp), sirb_exp: ymd(x.sirb_exp), x };
  });
  const agents = [...new Set(rows.map(r => r.agent).filter(Boolean))];
  for (const a of agents) if (!(await env.DB.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'field' AND active = 1").bind(a).first())) throw new HttpError(400, 'ไม่พบพนักงานผู้ดูแลที่ใช้งานอยู่');
  const stmts = [];
  const crewStmt = [];
  const t = now();
  for (const r of rows) {
    crewStmt.push(stmts.length);
    stmts.push(env.DB.prepare('INSERT INTO crew (job_id, name, rank, type, nationality, flight, passport, passport_exp, sirb_no, sirb_exp, agent_id, chain_end, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(jobId, r.name, str(r.x.rank, 40), r.type, str(r.x.nationality, 60), str(r.x.flight, 40), str(r.x.passport, 40), r.passport_exp, str(r.x.sirb_no, 40), r.sirb_exp, r.agent, r.chain, t));
    r.tpl.forEach((cp, i) => stmts.push(env.DB.prepare('INSERT INTO checkpoints (crew_id, idx, name, name_en, need_photo) VALUES ((SELECT MAX(id) FROM crew WHERE job_id = ?), ?, ?, ?, ?)').bind(jobId, i, cp.th, cp.en, cp.photo ? 1 : 0)));
  }
  const res = await env.DB.batch(stmts);
  const ids = crewStmt.map(k => res[k].meta.last_row_id);
  await log(env, jobId, u.id, list.length === 1 ? `เพิ่มลูกเรือ ${str(list[0].name, 120)}` : `เพิ่มลูกเรือ ${list.length} คน`);
  return json({ ids });
}

async function patchCrew(req, env, u, id) {
  requireOffice(u);
  const c = await getCrew(env, id);
  openJob(c);
  const b = await readJson(req);
  const sets = {};
  const logs = [];
  for (const [f, max] of [['name', 120], ['rank', 40], ['nationality', 60], ['flight', 40], ['passport', 40], ['sirb_no', 40], ['room', 20]]) if (f in b) sets[f] = str(b[f], max);
  for (const f of ['passport_exp', 'sirb_exp']) if (f in b) sets[f] = ymd(b[f]);
  if ('name' in sets && !sets.name) throw new HttpError(400, 'กรุณากรอกชื่อลูกเรือ');
  if ('sort' in b) sets.sort = Math.round(Number(b.sort) || 0);
  const settings = await loadSettings(env);
  let docs = parseJson(c.docs, {});
  if ('docs' in b) {
    docs = {};
    for (const d of settings.docs) docs[d] = b.docs && b.docs[d] ? 1 : 0;
    sets.docs = JSON.stringify(docs);
    const old = parseJson(c.docs, {});
    for (const d of settings.docs) if (!!old[d] !== !!docs[d]) logs.push(`${c.name} · ${d} ${docs[d] ? 'ได้รับแล้ว' : 'ยังไม่มี'}`);
  }
  if ('s4' in b) {
    const old = parseJson(c.s4, {});
    const s4 = { oktb: !!(b.s4 && b.s4.oktb), meet: !!(b.s4 && b.s4.meet), imm: !!(b.s4 && b.s4.imm) };
    const complete = settings.docs.every(d => docs[d]);
    if (s4.oktb && !old.oktb && !complete) throw new HttpError(409, 'เอกสารของลูกเรือคนนี้ยังไม่ครบ ยังออก OKTB ไม่ได้');
    sets.s4 = JSON.stringify(s4);
    for (const [k, l] of [['oktb', 'ออก OKTB'], ['meet', 'ส่ง Meeting point'], ['imm', 'ยื่นเอกสาร ตม.']]) if (!!old[k] !== s4[k]) logs.push(`${c.name} · ${l} ${s4[k] ? 'แล้ว' : 'ยกเลิก'}`);
  }
  for (const [f, table, label] of [['vehicle_id', 'vehicles', 'รถ'], ['hotel_id', 'hotels', 'โรงแรม'], ['agent_id', 'users', 'ผู้ดูแล']]) {
    if (!(f in b)) continue;
    const v = intOrNull(b[f]);
    let nm = '';
    if (v != null) {
      // Historical assignments remain readable; new assignments must be usable.
      const eligible = v === c[f] ? '' : ` AND active = 1${f === 'agent_id' ? " AND role = 'field'" : ''}`;
      const row = await env.DB.prepare(`SELECT name FROM ${table} WHERE id = ?${eligible}`).bind(v).first();
      if (!row) throw new HttpError(400, `ไม่พบ${label}ที่เลือก`);
      nm = row.name;
    }
    if (v !== c[f]) logs.push(`${c.name} · ${label}: ${nm || 'ยังไม่กำหนด'}`);
    sets[f] = v;
  }
  // The driver is copied when the vehicle is chosen; relinking a vehicle later never changes crew already assigned.
  if ('vehicle_id' in sets && sets.vehicle_id !== c.vehicle_id) sets.driver_id = await vehicleDriver(env, sets.vehicle_id);
  if ('driver_id' in b) {
    const want = intOrNull(b.driver_id);
    if (want != null && want !== await vehicleDriver(env, 'vehicle_id' in sets ? sets.vehicle_id : c.vehicle_id)) throw new HttpError(400, 'คนขับต้องเป็นบัญชีที่เชื่อมกับรถของลูกเรือคนนี้และยังใช้งานอยู่');
    sets.driver_id = want;
  }
  if ('driver_id' in sets && sets.driver_id !== c.driver_id) {
    const d = sets.driver_id == null ? null : await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(sets.driver_id).first();
    logs.push(`${c.name} · คนขับในมือถือ: ${d ? d.name : 'ไม่มี'}`);
  }
  if ('type' in b && b.type !== c.type) {
    if (!['on', 'off'].includes(b.type)) throw new HttpError(400, 'ประเภทไม่ถูกต้อง');
    const started = await env.DB.prepare('SELECT 1 FROM checkpoints WHERE crew_id = ? AND actual_at IS NOT NULL LIMIT 1').bind(id).first();
    if (started) throw new HttpError(409, 'ลูกเรือคนนี้เริ่มบันทึกเวลาแล้ว เปลี่ยนประเภทไม่ได้');
    const tpl = b.type === 'on' ? settings.cp_on : settings.cp_off;
    sets.type = b.type;
    sets.chain_end = Math.min(tpl.length - 1, b.type === 'on' ? settings.cp_on_chain : settings.cp_off_chain);
    await env.DB.batch([env.DB.prepare('DELETE FROM checkpoints WHERE crew_id = ?').bind(id), ...tpl.map((cp, i) => env.DB.prepare('INSERT INTO checkpoints (crew_id, idx, name, name_en, need_photo) VALUES (?, ?, ?, ?, ?)').bind(id, i, cp.th, cp.en, cp.photo ? 1 : 0))]);
  }
  const keys = Object.keys(sets);
  if (keys.length) {
    const stmts = [env.DB.prepare(`UPDATE crew SET ${keys.map(k => k + ' = ?').join(', ')} WHERE id = ?`).bind(...keys.map(k => sets[k]), id)];
    for (const l of logs) stmts.push(env.DB.prepare('INSERT INTO activity (job_id, at, user_id, kind, text) VALUES (?, ?, ?, ?, ?)').bind(c.job_id, now(), u.id, 'log', l));
    await env.DB.batch(stmts);
  }
  return json({ ok: true });
}

async function deleteCrew(env, u, id) {
  requireOffice(u);
  const c = await getCrew(env, id);
  openJob(c);
  const { results } = await env.DB.prepare('SELECT r2_key FROM photos WHERE crew_id = ? UNION ALL SELECT r2_key FROM crew_files WHERE crew_id = ?').bind(id, id).all();
  for (let i = 0; i < results.length; i += 900) await env.FILES.delete(results.slice(i, i + 900).map(r => r.r2_key));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM crew WHERE id = ?').bind(id),
    env.DB.prepare('INSERT INTO activity (job_id, at, user_id, kind, text) VALUES (?, ?, ?, ?, ?)').bind(c.job_id, now(), u.id, 'log', `ลบลูกเรือ ${c.name}`)
  ]);
  return json({ ok: true });
}

async function putPlan(req, env, u, id) {
  requireOffice(u);
  const c = await getCrew(env, id);
  openJob(c);
  const b = await readJson(req);
  if (!Array.isArray(b.plans)) throw new HttpError(400, 'รูปแบบไม่ถูกต้อง');
  const { results } = await env.DB.prepare('SELECT idx FROM checkpoints WHERE crew_id = ? ORDER BY idx').bind(id).all();
  if (b.plans.length !== results.length) throw new HttpError(400, 'จำนวนจุดไม่ตรงกับแผน');
  const plans = b.plans.map(ms);
  let prevAt = null, prevI = -1;
  for (let i = 0; i < plans.length; i++) {
    if (plans[i] == null) continue;
    if (prevAt != null && plans[i] < prevAt) throw new HttpError(400, `เวลาจุดที่ ${i + 1} ต้องไม่ก่อนจุดที่ ${prevI + 1}`);
    prevAt = plans[i]; prevI = i;
  }
  await env.DB.batch([
    ...plans.map((v, i) => env.DB.prepare('UPDATE checkpoints SET plan_at = ? WHERE crew_id = ? AND idx = ?').bind(v, id, i)),
    env.DB.prepare('INSERT INTO activity (job_id, at, user_id, kind, text) VALUES (?, ?, ?, ?, ?)').bind(c.job_id, now(), u.id, 'log', `ปรับแผนเวลา ${c.name}`)
  ]);
  return json({ ok: true });
}

async function confirm(req, env, u, id) {
  const c = await getCrew(env, id);
  canField(u, c);
  openJob(c);
  const b = await readJson(req);
  const idx = Number(b.idx);
  const { results: cps } = await env.DB.prepare('SELECT * FROM checkpoints WHERE crew_id = ? ORDER BY idx').bind(id).all();
  const next = cps.findIndex(x => x.actual_at == null);
  const t = now();
  let at = deviceTime(b.at, b.sent_at, t);
  if (!Number.isInteger(idx) || idx < 0 || idx >= cps.length) throw new HttpError(400, 'จุดไม่ถูกต้อง');
  if (cps[idx].actual_at != null) {
    if (cps[idx].actual_by === u.id && Math.abs(cps[idx].actual_at - at) < 120000) return json({ ok: true, duplicate: true, at: cps[idx].actual_at });
    throw new HttpError(409, `จุด "${cps[idx].name}" ยืนยันไปแล้ว`);
  }
  if (idx !== next) throw new HttpError(409, `ต้องยืนยัน "${cps[next].name}" ก่อน`);
  if (idx > 0 && at < cps[idx - 1].actual_at) at = cps[idx - 1].actual_at;
  const lat = coordinate(b.lat, 90), lng = coordinate(b.lng, 180);
  let skip = '';
  if (cps[idx].need_photo) {
    if (b.upload_id != null && !UPLOAD_ID.test(String(b.upload_id))) throw new HttpError(400, 'รหัสรูปไม่ถูกต้อง');
    // A promised upload only permits the confirmation; the photo state itself is read from stored photos.
    if (b.upload_id == null && !(await env.DB.prepare('SELECT 1 FROM photos WHERE crew_id = ? AND cp_idx = ? LIMIT 1').bind(id, idx).first())) {
      skip = str(b.skip_reason, 200);
      if (skip.length < 3 || skip.length > 120) throw new HttpError(400, `จุด "${cps[idx].name}" ต้องถ่ายรูป ถ้าไม่มีรูปให้ระบุเหตุผล 3–120 ตัวอักษร (ถ้าไม่เห็นปุ่มถ่ายรูป ให้ปิดแล้วเปิดหน้านี้ใหม่)`);
    }
  }
  const res = await env.DB.batch([
    env.DB.prepare('UPDATE checkpoints SET actual_at = ?, actual_by = ?, lat = ?, lng = ?, actual_role = ?, received_at = ?, photo_skip = ? WHERE crew_id = ? AND idx = ? AND actual_at IS NULL').bind(at, u.id, lat, lng, capacity(u, c), t, skip, id, idx),
    env.DB.prepare('INSERT INTO activity (job_id, at, user_id, kind, text) SELECT ?, ?, ?, ?, ? WHERE changes() = 1').bind(c.job_id, t, u.id, 'cp', `${c.name} · ${cps[idx].name}${skip ? ' · ยืนยันโดยไม่มีรูป: ' + skip : ''}`)
  ]);
  if (!res[0].meta.changes) throw new HttpError(409, 'มีคนยืนยันจุดนี้ไปก่อนแล้ว');
  return json({ ok: true, at });
}

async function undo(req, env, u, id) {
  const c = await getCrew(env, id);
  canField(u, c);
  openJob(c);
  const b = await readJson(req);
  const last = await env.DB.prepare('SELECT * FROM checkpoints WHERE crew_id = ? AND actual_at IS NOT NULL ORDER BY idx DESC LIMIT 1').bind(id).first();
  if (!last) throw new HttpError(409, 'ยังไม่มีจุดที่ยืนยัน');
  if (b.idx !== undefined && Number(b.idx) !== last.idx) throw new HttpError(409, `ข้อมูลเปลี่ยนแล้ว จุดล่าสุดตอนนี้คือ "${last.name}" กรุณาตรวจอีกครั้ง`);
  await env.DB.batch([
    env.DB.prepare("UPDATE checkpoints SET actual_at = NULL, actual_by = NULL, lat = NULL, lng = NULL, actual_role = '', received_at = NULL, photo_skip = '' WHERE id = ?").bind(last.id),
    env.DB.prepare('INSERT INTO activity (job_id, at, user_id, kind, text) VALUES (?, ?, ?, ?, ?)').bind(c.job_id, now(), u.id, 'log', `${c.name} · ย้อนกลับ "${last.name}"`)
  ]);
  return json({ ok: true });
}

async function addNote(req, env, u, id) {
  const c = await getCrew(env, id);
  canField(u, c);
  openJob(c);
  const b = await readJson(req);
  const t = text(b.text, 1000);
  if (!t) throw new HttpError(400, 'กรุณาพิมพ์หมายเหตุ');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO notes (crew_id, at, user_id, text) VALUES (?, ?, ?, ?)').bind(id, now(), u.id, t),
    env.DB.prepare('INSERT INTO activity (job_id, at, user_id, kind, text) VALUES (?, ?, ?, ?, ?)').bind(c.job_id, now(), u.id, 'note', `${c.name} · หมายเหตุ: ${t}`)
  ]);
  return json({ ok: true });
}

/* ---------- photos ---------- */

function coordinate(v, max) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > max) throw new HttpError(400, 'พิกัดไม่ถูกต้อง');
  return n;
}

async function addPhoto(req, env, u, id, url) {
  const c = await getCrew(env, id);
  canField(u, c);
  const type = (req.headers.get('content-type') || '').split(';')[0].trim();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new HttpError(415, 'รองรับเฉพาะไฟล์รูป JPG / PNG / WEBP');
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_PHOTO) throw new HttpError(413, 'รูปใหญ่เกิน 10 MB');
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(400, 'ไม่พบไฟล์รูป');
  if (buf.byteLength > MAX_PHOTO) throw new HttpError(413, 'รูปใหญ่เกิน 10 MB');
  const point = str(url.searchParams.get('point'), 80);
  const lat = coordinate(url.searchParams.get('lat'), 90), lng = coordinate(url.searchParams.get('lng'), 180);
  const acc = coordinate(url.searchParams.get('acc'), 1e7);
  const gps = url.searchParams.get('gps') || '';
  if (acc != null && acc < 0) throw new HttpError(400, 'พิกัดไม่ถูกต้อง');
  if (gps && !GPS_STATES.includes(gps)) throw new HttpError(400, 'สถานะพิกัดไม่ถูกต้อง');
  if (gps === 'ok' ? lat == null || lng == null : gps && (lat != null || lng != null)) throw new HttpError(400, 'พิกัดไม่ตรงกับสถานะพิกัด');
  const cpRaw = url.searchParams.get('cp_idx');
  const cpIdx = cpRaw == null || cpRaw === '' ? null : Number(cpRaw);
  if (cpIdx != null && (!Number.isInteger(cpIdx) || cpIdx < 0 || !(await env.DB.prepare('SELECT 1 FROM checkpoints WHERE crew_id = ? AND idx = ?').bind(id, cpIdx).first()))) throw new HttpError(400, 'จุดไม่ถูกต้อง');
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
  // sent_at changes on retry; the original capture time and payload must not.
  // Requests from clients older than cp_idx/acc/gps keep their original hash, so their retries still match.
  const requestHash = await sha256(JSON.stringify([id, type, point, lat, lng, url.searchParams.get('at'), digest, ...(cpIdx != null || acc != null || gps ? [cpIdx, acc, gps] : [])]));
  const suppliedId = url.searchParams.get('upload_id');
  if (suppliedId != null && !/^[A-Za-z0-9_-]{16,80}$/.test(suppliedId)) throw new HttpError(400, 'รหัสรูปไม่ถูกต้อง');
  // Old clients/outboxes have no upload id. Keep them retry-safe during rollout.
  const uploadId = suppliedId || requestHash;
  const existing = () => env.DB.prepare('SELECT id, request_hash FROM photos WHERE user_id = ? AND upload_id = ?').bind(u.id, uploadId).first();
  const duplicate = row => {
    if (row.request_hash !== requestHash) throw new HttpError(409, 'รหัสรูปนี้ใช้กับรูปอื่นแล้ว กรุณาเลือกรูปใหม่');
    return json({ id: row.id, duplicate: true });
  };
  const saved = await existing();
  if (saved) return duplicate(saved);
  openJob(c);
  const settings = await loadSettings(env);
  const limit = settings.storage_gb * 1024 ** 3;
  const used = await env.DB.prepare(`SELECT ${USED_BYTES} AS n`).first();
  if (used.n + buf.byteLength > limit) throw new HttpError(507, 'พื้นที่เก็บไฟล์เต็มแล้ว กรุณาแจ้งผู้ดูแลระบบ');
  const key = `photos/${c.job_id}/${id}/${u.id}-${uploadId}.${type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'}`;
  // Conditional creation prevents two racing requests from overwriting the object.
  const obj = await env.FILES.put(key, buf, { onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: type }, customMetadata: { request_hash: requestHash } });
  if (!obj && (await env.FILES.head(key))?.customMetadata?.request_hash !== requestHash) throw new HttpError(409, 'รหัสรูปนี้ใช้กับรูปอื่นแล้ว กรุณาเลือกรูปใหม่');
  const received = now();
  const at = deviceTime(url.searchParams.get('at'), url.searchParams.get('sent_at'), received);
  const [insert] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO photos (crew_id, point, r2_key, size, lat, lng, at, user_id, upload_id, request_hash, cp_idx, acc, gps, received_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM jobs WHERE id = ? AND status = 'open')
      AND ${USED_BYTES} + ? <= ?
      ON CONFLICT(user_id, upload_id) DO NOTHING RETURNING id`)
      .bind(id, point, key, buf.byteLength, lat, lng, at, u.id, uploadId, requestHash, cpIdx, acc, gps, received, c.job_id, buf.byteLength, limit),
    env.DB.prepare('INSERT INTO activity (job_id, at, user_id, kind, text) SELECT ?, ?, ?, ?, ? WHERE changes() = 1')
      .bind(c.job_id, now(), u.id, 'photo', `${c.name} · แนบรูป${point ? ' ' + point : ''}`)
  ]);
  if (insert.results.length) return json({ id: insert.results[0].id });
  const raced = await existing();
  if (raced) return duplicate(raced);
  openJob(await getCrew(env, id));
  throw new HttpError(507, 'พื้นที่เก็บไฟล์เต็มแล้ว กรุณาแจ้งผู้ดูแลระบบ');
}

async function photoRow(env, u, id) {
  const p = await env.DB.prepare('SELECT p.*, c.agent_id, c.driver_id, c.job_id FROM photos p JOIN crew c ON c.id = p.crew_id WHERE p.id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'ไม่พบรูป');
  if (!ownCrew(u, p)) throw new HttpError(403, 'ไม่มีสิทธิ์ดูรูปนี้');
  return p;
}

async function getPhoto(env, u, id) {
  const p = await photoRow(env, u, id);
  const obj = await env.FILES.get(p.r2_key);
  if (!obj) throw new HttpError(404, 'ไม่พบไฟล์รูป');
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" } });
}

async function deletePhoto(env, u, id) {
  const p = await photoRow(env, u, id);
  if (!isOffice(u) && p.user_id !== u.id) throw new HttpError(403, 'ลบได้เฉพาะรูปที่ตัวเองแนบ');
  const st = await env.DB.prepare('SELECT status FROM jobs WHERE id = ?').bind(p.job_id).first();
  if (st.status !== 'open') throw new HttpError(409, 'งานนี้ปิดแล้ว แก้ไขไม่ได้');
  await env.FILES.delete(p.r2_key);
  await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
  await log(env, p.job_id, u.id, 'ลบรูปที่แนบ', 'photo');
  return json({ ok: true });
}

/* ---------- crew documents & brand images ---------- */

async function bootFor(env, u) {
  const d = await boot(env, u);
  if (isOffice(u)) return { ...d, brand: await loadBrand(env) };
  delete d.settings.oktb;
  return d;
}

async function checkStorage(env, add) {
  const settings = await loadSettings(env);
  const used = await env.DB.prepare(`SELECT ${USED_BYTES} AS n`).first();
  if (used.n + add > settings.storage_gb * 1024 ** 3) throw new HttpError(507, 'พื้นที่เก็บไฟล์เต็มแล้ว กรุณาแจ้งผู้ดูแลระบบ');
}

// Profile photos are re-encoded by the browser; anything still carrying EXIF or XMP (which can hold a location) is refused.
function hasMetadata(b, type) {
  const is = (o, s) => o + s.length <= b.length && [...s].every((ch, i) => b[o + i] === ch.charCodeAt(0));
  if (type === 'image/jpeg') {
    for (let p = 2; p + 4 <= b.length && b[p] === 0xff;) {
      const m = b[p + 1];
      if (m === 0xff) { p++; continue; }
      if (m === 0xda || m === 0xd9) break;
      if (m === 0xe1 && (is(p + 4, 'Exif') || is(p + 4, 'http://ns.adobe.com/xap/'))) return true;
      p += 2 + ((b[p + 2] << 8) | b[p + 3]);
    }
    return false;
  }
  if (type === 'image/png') {
    for (let p = 8; p + 8 <= b.length;) {
      if (is(p + 4, 'eXIf') || (is(p + 4, 'iTXt') && is(p + 8, 'XML:com.adobe.xmp'))) return true;
      if (is(p + 4, 'IEND')) break;
      p += 12 + (((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0);
    }
    return false;
  }
  for (let p = 12; p + 8 <= b.length;) {
    if (is(p, 'EXIF') || is(p, 'XMP ')) return true;
    const len = (b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24)) >>> 0;
    p += 8 + len + (len & 1);
  }
  return false;
}

function looksLike(b, type) {
  const at = (sig, o) => sig.every((x, i) => b[o + i] === x);
  if (type === 'image/jpeg') return at([0xff, 0xd8, 0xff], 0);
  if (type === 'image/png') return at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  if (type === 'image/webp') return at([0x52, 0x49, 0x46, 0x46], 0) && at([0x57, 0x45, 0x42, 0x50], 8);
  for (let i = 0; i + 5 <= b.length; i++) if (at([0x25, 0x50, 0x44, 0x46, 0x2d], i)) return true;
  return false;
}

async function rawFile(req, types, max, typeMsg, bigMsg) {
  const type = (req.headers.get('content-type') || '').split(';')[0].trim();
  if (!types.includes(type)) throw new HttpError(415, typeMsg);
  if (Number(req.headers.get('content-length') || 0) > max) throw new HttpError(413, bigMsg);
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(400, 'ไม่พบไฟล์');
  if (buf.byteLength > max) throw new HttpError(413, bigMsg);
  if (!looksLike(new Uint8Array(buf, 0, Math.min(buf.byteLength, 1024)), type)) throw new HttpError(400, 'ไฟล์เสียหาย หรือเนื้อไฟล์ไม่ตรงกับชนิดไฟล์');
  return { type, buf };
}

async function addFile(req, env, u, id, url) {
  requireOffice(u);
  const c = await getCrew(env, id);
  openJob(c);
  const kind = url.searchParams.get('kind');
  if (!Object.hasOwn(FILE_KINDS, kind)) throw new HttpError(400, 'ประเภทเอกสารไม่ถูกต้อง');
  const { type, buf } = await rawFile(req, Object.keys(FILE_TYPES), MAX_PHOTO, 'รองรับเฉพาะไฟล์รูป JPG / PNG / WEBP และ PDF', 'ไฟล์ใหญ่เกิน 10 MB');
  await checkStorage(env, buf.byteLength);
  const ext = FILE_TYPES[type];
  const name = str(url.searchParams.get('name'), 160).replace(/[\\/:*?"<>|]+/g, '_') || `${kind}.${ext}`;
  const key = `docs/${c.job_id}/${id}/${Date.now()}-${randomId(8)}.${ext}`;
  await env.FILES.put(key, buf, { httpMetadata: { contentType: type } });
  let r;
  try {
    r = await env.DB.prepare('INSERT INTO crew_files (crew_id, kind, name, mime, r2_key, size, at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, kind, name, type, key, buf.byteLength, now(), u.id).run();
  } catch (e) {
    await env.FILES.delete(key);
    throw e;
  }
  await log(env, c.job_id, u.id, `${c.name} · แนบไฟล์ ${FILE_KINDS[kind]}`);
  return json({ id: r.meta.last_row_id });
}

async function fileRow(env, id) {
  const f = await env.DB.prepare('SELECT f.*, c.name AS crew_name, c.job_id, j.status AS job_status FROM crew_files f JOIN crew c ON c.id = f.crew_id JOIN jobs j ON j.id = c.job_id WHERE f.id = ?').bind(id).first();
  if (!f) throw new HttpError(404, 'ไม่พบไฟล์นี้');
  return f;
}

const fileHeaders = type => ({ 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" });

async function getFile(env, u, id) {
  requireOffice(u);
  const f = await fileRow(env, id);
  const obj = await env.FILES.get(f.r2_key);
  if (!obj) throw new HttpError(404, 'ไม่พบไฟล์นี้');
  const name = encodeURIComponent(f.name).replace(/['()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
  return new Response(obj.body, { headers: { ...fileHeaders(f.mime), 'content-disposition': `inline; filename*=UTF-8''${name}` } });
}

async function deleteFile(env, u, id) {
  requireOffice(u);
  const f = await fileRow(env, id);
  openJob(f);
  await env.FILES.delete(f.r2_key);
  await env.DB.prepare('DELETE FROM crew_files WHERE id = ?').bind(id).run();
  await log(env, f.job_id, u.id, `${f.crew_name} · ลบไฟล์ ${FILE_KINDS[f.kind]}`);
  return json({ ok: true });
}

function brandKind(kind) {
  if (!BRAND_KINDS.includes(kind)) throw new HttpError(404, 'ไม่พบรายการนี้');
  return 'brand/' + kind;
}

async function setBrand(env, kind, at) {
  const brand = { ...(await loadBrand(env)), [kind]: at };
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('brand', JSON.stringify(brand)).run();
  return json({ brand });
}

async function getBrand(env, u, kind) {
  requireOffice(u);
  const obj = await env.FILES.get(brandKind(kind));
  if (!obj) throw new HttpError(404, `ยังไม่ได้อัปโหลด${BRAND_LABEL[kind]}`);
  return new Response(obj.body, { headers: fileHeaders(obj.httpMetadata?.contentType || 'image/png') });
}

async function putBrand(req, env, u, kind) {
  requireAdmin(u);
  const key = brandKind(kind);
  const { type, buf } = await rawFile(req, ['image/png', 'image/jpeg'], MAX_BRAND, 'รองรับเฉพาะไฟล์รูป PNG / JPG', 'รูปใหญ่เกิน 2 MB');
  await env.FILES.put(key, buf, { httpMetadata: { contentType: type } });
  return setBrand(env, kind, now());
}

async function deleteBrand(env, u, kind) {
  requireAdmin(u);
  await env.FILES.delete(brandKind(kind));
  return setBrand(env, kind, 0);
}

/* ---------- profile photos ---------- */

async function putAvatar(req, env, u) {
  const { type, buf } = await rawFile(req, ['image/jpeg', 'image/png', 'image/webp'], MAX_AVATAR, 'รองรับเฉพาะไฟล์รูป JPG / PNG / WEBP', 'รูปใหญ่เกิน 1 MB');
  if (hasMetadata(new Uint8Array(buf), type)) throw new HttpError(400, 'รูปนี้มีข้อมูลแฝงจากกล้อง (เช่น พิกัดที่ถ่าย) กรุณาเปลี่ยนรูปจากหน้าบัญชีของฉัน ระบบจะตัดข้อมูลแฝงออกให้');
  await checkStorage(env, buf.byteLength - u.avatar_size);
  const key = `avatars/${u.id}-${randomId(12)}.${FILE_TYPES[type]}`;
  const at = now();
  await env.FILES.put(key, buf, { httpMetadata: { contentType: type } });
  try {
    await env.DB.prepare('UPDATE users SET avatar_key = ?, avatar_at = ?, avatar_size = ? WHERE id = ?').bind(key, at, buf.byteLength, u.id).run();
  } catch (e) {
    await env.FILES.delete(key);
    throw e;
  }
  if (u.avatar_key) await env.FILES.delete(u.avatar_key);
  return json({ avatar_at: at });
}

async function deleteAvatar(env, u) {
  await env.DB.prepare("UPDATE users SET avatar_key = '', avatar_at = 0, avatar_size = 0 WHERE id = ?").bind(u.id).run();
  if (u.avatar_key) await env.FILES.delete(u.avatar_key);
  return json({ avatar_at: 0 });
}

async function getAvatar(env, id) {
  const row = /^[0-9]{1,9}$/.test(id) ? await env.DB.prepare('SELECT avatar_key FROM users WHERE id = ?').bind(Number(id)).first() : null;
  const obj = row && row.avatar_key ? await env.FILES.get(row.avatar_key) : null;
  if (!obj) throw new HttpError(404, 'ไม่มีรูปโปรไฟล์');
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" } });
}

/* ---------- owner page ---------- */

async function publicJob(env, token) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) throw new HttpError(404, 'Link not found');
  const j = await env.DB.prepare('SELECT * FROM jobs WHERE owner_token = ?').bind(token).first();
  if (!j || (j.status === 'closed' && j.closed_at < now() - 30 * 86400000)) throw new HttpError(404, 'Link not found or expired');
  const settings = await loadSettings(env);
  const crew = await crewRows(env, 'job_id = ?', [j.id]);
  return json({
    company: settings.company.name,
    late_min: settings.late_min,
    job: { vessel: j.vessel, port: j.port, owner: j.owner, eta: j.eta, etb: j.etb, etd: j.etd, status: j.status },
    crew: crew.map(c => ({ id: c.id, name: c.name, rank: c.rank, type: c.type, flight: c.flight, chain_end: c.chain_end, cps: c.cps.map(x => ({ idx: x.idx, name: x.name_en, name_en: x.name_en, plan: x.plan, actual: x.actual })) })),
    now: now()
  }, 200, { 'x-robots-tag': 'noindex' });
}

/* ---------- export & backup ---------- */

// The device time stays in "Actual"; the server receipt time is listed only when it is more than 2 minutes apart.
const lagged = (at, received) => at != null && received != null && Math.abs(received - at) > 120000;
const photoState = (x, n) => x.actual == null || !x.need_photo ? '' : n ? 'Attached' : 'Pending';
const fileDate = (t = now()) => { const p = bkkParts(t); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };

function xlsxResponse(sheets, name) {
  return new Response(buildXlsx(sheets), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store'
    }
  });
}

async function exportJob(env, u, id) {
  requireOffice(u);
  const j = await getJob(env, id);
  const [settings, crew, users, vehicles, hotels] = await Promise.all([
    loadSettings(env), crewRows(env, 'job_id = ?', [id]),
    env.DB.prepare('SELECT id, name FROM users').all(), env.DB.prepare('SELECT * FROM vehicles').all(), env.DB.prepare('SELECT * FROM hotels').all()
  ]);
  const uName = new Map(users.results.map(x => [x.id, x.name]));
  const veh = new Map(vehicles.results.map(x => [x.id, x]));
  const hot = new Map(hotels.results.map(x => [x.id, x.name]));
  const late = settings.late_min;
  const lateCount = crew.reduce((a, c) => a + c.cps.filter(x => x.actual != null && x.plan != null && (x.actual - x.plan) / 60000 > late).length, 0);
  const summary = [
    ['Crew change summary', ''],
    ['Company', settings.company.name],
    ['Vessel', j.vessel], ['Port', j.port], ['Owner', j.owner], ['Local agent', j.agent],
    ['ETA', bkk(j.eta)], ['ETB', bkk(j.etb)], ['ETD', bkk(j.etd)],
    ['On signers', crew.filter(c => c.type === 'on').length], ['Off signers', crew.filter(c => c.type === 'off').length],
    ['Vehicles used', new Set(crew.map(c => c.vehicle_id).filter(Boolean)).size],
    ['Hotel rooms', crew.filter(c => c.hotel_id).length],
    ['Checkpoints late (> ' + late + ' min)', lateCount],
    ['Status', j.status === 'closed' ? 'Closed ' + bkk(j.closed_at) : 'Open'],
    ['Exported', bkk(now()) + ' (Bangkok time)']
  ];
  const crewSheet = [['No.', 'Name', 'Rank', 'Type', 'Nationality', 'Flight', 'Passport', 'Passport expiry', 'SIRB no.', 'SIRB expiry', 'Vehicle', 'Driver', 'Hotel', 'Room', 'Boarding agent', ...settings.docs.map(d => 'Doc: ' + documentNameEn(d))],
    ...crew.map((c, i) => { const v = veh.get(c.vehicle_id); return [i + 1, c.name, c.rank, c.type === 'on' ? 'On signer' : 'Off signer', c.nationality, c.flight, c.passport, c.passport_exp, c.sirb_no, c.sirb_exp, v ? `${v.name} ${v.plate}` : '', v ? v.driver : '', hot.get(c.hotel_id) || '', c.room, uName.get(c.agent_id) || '', ...settings.docs.map(d => (c.docs[d] ? 'Yes' : 'No'))]; })];
  const log = [['Name', 'Rank', 'Type', 'Checkpoint', 'Checkpoint (EN)', 'Plan', 'Actual', 'Diff (min)', 'Result', 'Confirmed by', 'Role', 'Received by system', 'Photo required', 'Photo', 'Photo status', 'No-photo reason'],
    ...crew.flatMap(c => c.cps.map(x => { const d = x.actual != null && x.plan != null ? Math.round((x.actual - x.plan) / 60000) : ''; const n = c.photos.filter(p => p.cp_idx === x.idx).length; return [c.name, c.rank, c.type === 'on' ? 'On signer' : 'Off signer', x.name, x.name_en, bkk(x.plan), bkk(x.actual), d, x.actual == null ? '' : d !== '' && d > late ? 'Late' : 'On time', uName.get(x.by) || '', ROLE_EN[x.role] || '', lagged(x.actual, x.received) ? bkk(x.received) : '', x.need_photo ? 'Yes' : 'No', n, photoState(x, n), x.skip]; }))];
  const notes = [['Name', 'Time', 'Note', 'By'], ...crew.flatMap(c => c.notes.map(n => [c.name, bkk(n.at), n.text, uName.get(n.by) || '']))];
  return xlsxResponse([
    { name: 'Summary', rows: summary, widths: [30, 50], header: false },
    { name: 'Crew', rows: crewSheet, widths: [5, 26, 10, 12, 14, 12, 14, 14, 14, 14, 18, 18, 28, 8, 18, 14, 14, 14] },
    { name: 'Time log', rows: log, widths: [26, 10, 12, 24, 24, 18, 18, 10, 10, 18, 11, 18, 14, 7, 13, 30] },
    { name: 'Notes', rows: notes, widths: [26, 18, 60, 18] }
  ], `${j.vessel.replace(/[^A-Za-z0-9]+/g, '-')}-${fileDate()}.xlsx`);
}

async function allData(env) {
  const [jobs, crew, cps, users, vehicles, hotels, activity, photos] = await Promise.all([
    env.DB.prepare('SELECT * FROM jobs ORDER BY id').all(),
    env.DB.prepare('SELECT * FROM crew ORDER BY job_id, id').all(),
    env.DB.prepare('SELECT * FROM checkpoints ORDER BY crew_id, idx').all(),
    env.DB.prepare('SELECT id, emp_code, username, name, role, title, phone, active, avatar_at FROM users ORDER BY id').all(),
    env.DB.prepare('SELECT * FROM vehicles ORDER BY id').all(),
    env.DB.prepare('SELECT * FROM hotels ORDER BY id').all(),
    env.DB.prepare('SELECT a.*, u.name AS who FROM activity a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id').all(),
    env.DB.prepare('SELECT crew_id, cp_idx, COUNT(*) AS n FROM photos WHERE cp_idx IS NOT NULL GROUP BY crew_id, cp_idx').all()
  ]);
  const nPhoto = new Map(photos.results.map(x => [x.crew_id + ':' + x.cp_idx, x.n]));
  const uName = new Map(users.results.map(x => [x.id, x.name]));
  const crewName = new Map(crew.results.map(x => [x.id, x]));
  const jobName = new Map(jobs.results.map(x => [x.id, x.vessel]));
  return [
    { name: 'Jobs', rows: [['Job ID', 'Vessel', 'Port', 'Owner', 'Owner email', 'Local agent', 'Agent email', 'ETA', 'ETB', 'ETD', 'Status', 'Created', 'Closed'], ...jobs.results.map(j => [j.id, j.vessel, j.port, j.owner, j.owner_email, j.agent, j.agent_email, bkk(j.eta), bkk(j.etb), bkk(j.etd), j.status, bkk(j.created_at), bkk(j.closed_at)])], widths: [8, 26, 18, 22, 26, 22, 26, 17, 17, 17, 8, 17, 17] },
    { name: 'Crew', rows: [['Crew ID', 'Job ID', 'Vessel', 'Name', 'Rank', 'Type', 'Nationality', 'Flight', 'Passport', 'Passport expiry', 'SIRB no.', 'SIRB expiry', 'Room', 'Boarding agent', 'Driver account'], ...crew.results.map(c => [c.id, c.job_id, jobName.get(c.job_id) || '', c.name, c.rank, c.type, c.nationality, c.flight, c.passport, c.passport_exp, c.sirb_no, c.sirb_exp, c.room, uName.get(c.agent_id) || '', uName.get(c.driver_id) || ''])], widths: [8, 8, 24, 26, 10, 6, 14, 12, 14, 14, 14, 14, 8, 18, 18] },
    { name: 'Time log', rows: [['Job ID', 'Vessel', 'Name', 'No.', 'Checkpoint', 'Plan', 'Actual', 'Diff (min)', 'By', 'Role', 'Received by system', 'Photo required', 'Photo', 'Photo status', 'No-photo reason'], ...cps.results.map(x => { const c = crewName.get(x.crew_id) || {}; const n = nPhoto.get(x.crew_id + ':' + x.idx) || 0; return [c.job_id || '', jobName.get(c.job_id) || '', c.name || '', x.idx + 1, x.name, bkk(x.plan_at), bkk(x.actual_at), x.plan_at && x.actual_at ? Math.round((x.actual_at - x.plan_at) / 60000) : '', uName.get(x.actual_by) || '', ROLE_EN[x.actual_role] || '', lagged(x.actual_at, x.received_at) ? bkk(x.received_at) : '', x.need_photo ? 'Yes' : 'No', n, photoState({ actual: x.actual_at, need_photo: x.need_photo }, n), x.photo_skip]; })], widths: [8, 24, 26, 5, 24, 17, 17, 10, 18, 11, 18, 14, 7, 13, 30] },
    { name: 'Activity', rows: [['Time', 'Job ID', 'Vessel', 'User', 'Detail'], ...activity.results.map(a => [bkk(a.at), a.job_id, jobName.get(a.job_id) || '', a.who || '', a.text])], widths: [17, 8, 24, 18, 70] },
    { name: 'Users', rows: [['ID', 'Employee code', 'Username', 'Name', 'Role', 'Title', 'Phone', 'Active', 'Profile photo'], ...users.results.map(x => [x.id, x.emp_code, x.username, x.name, x.role, x.title, x.phone, x.active ? 'Yes' : 'No', x.avatar_at ? 'Yes' : 'No'])], widths: [5, 14, 18, 24, 10, 22, 14, 8, 13] },
    { name: 'Vehicles', rows: [['ID', 'Name', 'Plate', 'Driver', 'Driver (EN)', 'Driver ID', 'Phone', 'Active', 'Driver account'], ...vehicles.results.map(v => [v.id, v.name, v.plate, v.driver, v.driver_en, v.driver_id, v.driver_phone, v.active ? 'Yes' : 'No', uName.get(v.user_id) || ''])] },
    { name: 'Hotels', rows: [['ID', 'Name', 'Phone', 'Active'], ...hotels.results.map(h => [h.id, h.name, h.phone, h.active ? 'Yes' : 'No'])] }
  ];
}

export const DUMP_TABLES = ['users', 'settings', 'vehicles', 'hotels', 'jobs', 'crew', 'checkpoints', 'notes', 'photos', 'crew_files', 'activity'];
const DAILY_KEEP = 35;

async function listBackups(env, u) {
  requireAdmin(u);
  const out = [];
  let cursor;
  do {
    const list = await env.FILES.list({ prefix: 'backups/', cursor });
    for (const o of list.objects) out.push({ name: o.key.slice(8), size: o.size, uploaded: o.uploaded });
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return json({ backups: out.sort((a, b) => b.name.localeCompare(a.name)) });
}

async function getBackup(env, u, name) {
  requireAdmin(u);
  const monthly = /^[0-9]{4}-[0-9]{2}\.xlsx$/.test(name);
  const nightly = /^daily\/[0-9]{4}-[0-9]{2}-[0-9]{2}\.json\.gz$/.test(name);
  if (!monthly && !nightly) throw new HttpError(404, 'ไม่พบไฟล์สำรอง');
  const obj = await env.FILES.get('backups/' + name);
  if (!obj) throw new HttpError(404, 'ไม่พบไฟล์สำรอง');
  const type = monthly ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/gzip';
  return new Response(obj.body, { headers: { 'content-type': type, 'content-disposition': `attachment; filename="crew-change-backup-${name.replace('daily/', '')}"`, 'cache-control': 'no-store' } });
}

export async function dumpAll(env) {
  const tables = {};
  // D1 batch is a transaction, so related tables describe the same snapshot.
  const rows = await env.DB.batch(DUMP_TABLES.map(t => env.DB.prepare(`SELECT * FROM ${t} ORDER BY rowid`)));
  DUMP_TABLES.forEach((t, i) => { tables[t] = rows[i].results; });
  return { format: 'cct-backup', version: 1, created: now(), tables };
}

async function gzip(textValue) {
  const stream = new Blob([textValue]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const dayKey = t => { const p = bkkParts(t); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };

export async function daily(env, t = now()) {
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t).run();
  const nightly = `backups/daily/${dayKey(t)}.json.gz`;
  await env.FILES.put(nightly, await gzip(JSON.stringify(await dumpAll(env))), { httpMetadata: { contentType: 'application/gzip' } });
  const cutoff = `backups/daily/${dayKey(t - DAILY_KEEP * 86400000)}.json.gz`;
  const old = await env.FILES.list({ prefix: 'backups/daily/' });
  const stale = old.objects.map(o => o.key).filter(k => k < cutoff);
  if (stale.length) await env.FILES.delete(stale);
  const p = bkkParts(t);
  if (p.d > 7) return;
  const prev = p.m === 1 ? `${p.y - 1}-12` : `${p.y}-${String(p.m - 1).padStart(2, '0')}`;
  const key = `backups/${prev}.xlsx`;
  if (await env.FILES.head(key)) return;
  await env.FILES.put(key, buildXlsx(await allData(env)), { httpMetadata: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
}
