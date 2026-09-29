import { HttpError, json, readJson, randomId, now, str, text, ms, intOrNull, parseJson, bkk, bkkParts } from './util.js';
import { login, logout, currentUser, sessionCookie, hashPassword, checkPasswordRules, publicUser, isOffice, seesAllCrew, requireUser, requireOffice, requireAdmin } from './auth.js';
import { DEFAULTS, EDITABLE, loadSettings } from './settings.js';
import { buildXlsx } from './xlsx.js';

const MAX_PHOTO = 10 * 1024 * 1024;
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
  if (p === '/api/logout' && m === 'POST') { await logout(req, env); return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', url.protocol === 'https:') }); }
  if (seg[0] === 'public' && seg[1] && m === 'GET') return publicJob(env, seg[1]);

  const u = await currentUser(req, env);
  requireUser(u);

  if (p === '/api/me' && m === 'GET') return json(await boot(env, u));
  if (p === '/api/me/password' && m === 'POST') return changeOwnPassword(req, env, u);
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
  }
  if (seg[0] === 'photos' && seg[1]) {
    const id = intOrNull(seg[1]);
    if (m === 'GET') return getPhoto(env, u, id);
    if (m === 'DELETE') return deletePhoto(env, u, id);
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
    env.DB.prepare('SELECT id, name, role, see_all, title, phone, id_card, active FROM users ORDER BY active DESC, name').all(),
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
  const r = await env.DB.prepare('INSERT INTO users (username, name, role, see_all, title, phone, id_card, pw_hash, pw_salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(username, name, b.role, b.see_all ? 1 : 0, str(b.title, 80), str(b.phone, 30), str(b.id_card, 30), h.hash, h.salt, now()).run();
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
  if (id == null) {
    if (!vals.name) throw new HttpError(400, 'กรุณากรอกชื่อ');
    const keys = Object.keys(vals);
    const r = await env.DB.prepare(`INSERT INTO ${kind} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).bind(...keys.map(k => vals[k])).run();
    return json({ id: r.meta.last_row_id });
  }
  if ('name' in vals && !vals.name) throw new HttpError(400, 'กรุณากรอกชื่อ');
  const keys = Object.keys(vals);
  if (keys.length) await env.DB.prepare(`UPDATE ${kind} SET ${keys.map(k => k + ' = ?').join(', ')} WHERE id = ?`).bind(...keys.map(k => vals[k]), id).run();
  return json({ ok: true });
}

async function putSettings(req, env, u) {
  requireAdmin(u);
  const b = await readJson(req);
  const stmts = [];
  for (const k of Object.keys(b)) {
    if (!EDITABLE.includes(k) || k === 'max_users' || k === 'storage_gb') continue;
    const v = validateSetting(k, b[k]);
    stmts.push(env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, JSON.stringify(v)));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ settings: await loadSettings(env) });
}

function validateSetting(k, v) {
  const def = DEFAULTS[k];
  if (k === 'late_min') { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 240) throw new HttpError(400, 'เวลาช้ากว่าแผนต้องอยู่ระหว่าง 1–240 นาที'); return n; }
  if (k === 'cp_on_chain' || k === 'cp_off_chain') { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 30) throw new HttpError(400, 'ค่าไม่ถูกต้อง'); return n; }
  if (k === 'company') return { name: str(v.name, 120) || def.name, name_th: str(v.name_th, 120) || def.name_th, signature: text(v.signature, 400) || def.signature };
  if (k === 'docs' || k === 'services') {
    if (!Array.isArray(v)) throw new HttpError(400, 'รูปแบบไม่ถูกต้อง');
    const out = [...new Set(v.map(x => str(x, 60)).filter(Boolean))].slice(0, 20);
    if (!out.length) throw new HttpError(400, 'ต้องมีอย่างน้อย 1 รายการ');
    return out;
  }
  if (k === 'cp_on' || k === 'cp_off') {
    if (!Array.isArray(v)) throw new HttpError(400, 'รูปแบบไม่ถูกต้อง');
    const out = v.map(x => ({ th: str(x.th, 60), en: str(x.en, 60), gap: Math.max(0, Math.min(10080, Math.round(Number(x.gap) || 0))) })).filter(x => x.th).slice(0, 20);
    if (out.length < 2) throw new HttpError(400, 'จุดสถานะต้องมีอย่างน้อย 2 จุด');
    out.forEach(x => { if (!x.en) x.en = x.th; });
    return out;
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
  return { ...j, services: parseJson(j.services, []), steps: parseJson(j.steps, []), sent: parseJson(j.sent, {}) };
}

async function listJobs(env, u, url) {
  requireOffice(u);
  const status = url.searchParams.get('status') === 'closed' ? 'closed' : 'open';
  const { results } = await env.DB.prepare(
    `SELECT j.id, j.vessel, j.port, j.owner, j.eta, j.etb, j.steps, j.status, j.created_at, j.closed_at,
       (SELECT COUNT(*) FROM crew c WHERE c.job_id = j.id AND c.type = 'on') AS n_on,
       (SELECT COUNT(*) FROM crew c WHERE c.job_id = j.id AND c.type = 'off') AS n_off
     FROM jobs j WHERE j.status = ? ORDER BY ${status === 'open' ? 'COALESCE(j.eta, j.created_at) ASC' : 'j.closed_at DESC'} LIMIT 200`
  ).bind(status).all();
  return json({ jobs: results.map(j => ({ ...j, steps: parseJson(j.steps, []) })) });
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

async function deleteJob(env, u, id) {
  requireAdmin(u);
  await getJob(env, id);
  const { results } = await env.DB.prepare('SELECT p.r2_key FROM photos p JOIN crew c ON c.id = p.crew_id WHERE c.job_id = ?').bind(id).all();
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

async function crewRows(env, where, binds) {
  const { results: crew } = await env.DB.prepare(`SELECT * FROM crew WHERE ${where} ORDER BY job_id, CASE type WHEN 'on' THEN 0 ELSE 1 END, sort, id`).bind(...binds).all();
  if (!crew.length) return [];
  const ids = crew.map(c => c.id);
  const [cps, notes, photos] = await Promise.all(['checkpoints', 'notes', 'photos'].map(t => inChunks(env, `SELECT * FROM ${t} WHERE crew_id IN`, ids, t === 'checkpoints' ? 'ORDER BY idx' : 'ORDER BY at')));
  const by = (arr) => { const m = new Map(); for (const r of arr) { if (!m.has(r.crew_id)) m.set(r.crew_id, []); m.get(r.crew_id).push(r); } return m; };
  const mc = by(cps), mn = by(notes), mp = by(photos);
  return crew.map(c => ({
    ...c, docs: parseJson(c.docs, {}), s4: parseJson(c.s4, {}),
    cps: (mc.get(c.id) || []).map(x => ({ idx: x.idx, name: x.name, name_en: x.name_en, plan: x.plan_at, actual: x.actual_at, by: x.actual_by })),
    notes: (mn.get(c.id) || []).map(x => ({ id: x.id, at: x.at, by: x.user_id, text: x.text })),
    photos: (mp.get(c.id) || []).map(x => ({ id: x.id, at: x.at, by: x.user_id, point: x.point, lat: x.lat, lng: x.lng }))
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
    const mine = seesAllCrew(u) ? true : await env.DB.prepare('SELECT 1 FROM crew WHERE job_id = ? AND agent_id = ? LIMIT 1').bind(id, u.id).first();
    if (!mine) throw new HttpError(403, 'บัญชีนี้ไม่มีสิทธิ์ดูงานนี้');
  }
  const crew = await crewRows(env, isOffice(u) || seesAllCrew(u) ? 'job_id = ?' : 'job_id = ? AND agent_id = ?', isOffice(u) || seesAllCrew(u) ? [id] : [id, u.id]);
  const job = jobOut(j);
  if (!isOffice(u)) {
    for (const k of ['owner_token', 'owner_email', 'agent_email', 'remark']) delete job[k];
    return { job, crew: crew.map(fieldSafe), activity: [], now: now() };
  }
  const { results: activity } = await env.DB.prepare('SELECT a.at, a.kind, a.text, a.user_id, u.name AS who FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.job_id = ? ORDER BY a.at DESC, a.id DESC LIMIT 150').bind(id).all();
  return { job, crew, activity, now: now() };
}

function fieldSafe(c) {
  const { passport, ...rest } = c;
  return rest;
}

async function fieldList(env, u) {
  const all = isOffice(u) || seesAllCrew(u);
  const crew = await crewRows(env, all ? "job_id IN (SELECT id FROM jobs WHERE status = 'open')" : "agent_id = ? AND job_id IN (SELECT id FROM jobs WHERE status = 'open')", all ? [] : [u.id]);
  const jobIds = [...new Set(crew.map(c => c.job_id))];
  const jobs = jobIds.length ? await inChunks(env, 'SELECT id, vessel, port, eta, etb, etd, agent FROM jobs WHERE id IN', jobIds, 'ORDER BY eta') : [];
  return json({ jobs, crew: isOffice(u) ? crew : crew.map(fieldSafe), now: now() });
}

/* ---------- crew ---------- */

async function getCrew(env, id) {
  const c = await env.DB.prepare('SELECT c.*, j.status AS job_status FROM crew c JOIN jobs j ON j.id = c.job_id WHERE c.id = ?').bind(id).first();
  if (!c) throw new HttpError(404, 'ไม่พบลูกเรือ');
  return c;
}

function canField(u, c) {
  if (isOffice(u) || seesAllCrew(u)) return;
  if (c.agent_id !== u.id) throw new HttpError(403, 'ลูกเรือคนนี้ไม่ได้อยู่ในความดูแลของคุณ');
}

function openJob(c) {
  if (c.job_status !== 'open') throw new HttpError(409, 'งานนี้ปิดแล้ว แก้ไขไม่ได้');
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
    const type = x.type === 'off' ? 'off' : 'on';
    const tpl = type === 'on' ? settings.cp_on : settings.cp_off;
    return { name, type, tpl, agent: intOrNull(x.agent_id), chain: Math.min(tpl.length - 1, type === 'on' ? settings.cp_on_chain : settings.cp_off_chain), x };
  });
  const agents = [...new Set(rows.map(r => r.agent).filter(Boolean))];
  for (const a of agents) if (!(await env.DB.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'field'").bind(a).first())) throw new HttpError(400, 'ไม่พบพนักงานผู้ดูแลที่เลือก');
  const stmts = [];
  const crewStmt = [];
  const t = now();
  for (const r of rows) {
    crewStmt.push(stmts.length);
    stmts.push(env.DB.prepare('INSERT INTO crew (job_id, name, rank, type, nationality, flight, passport, agent_id, chain_end, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(jobId, r.name, str(r.x.rank, 40), r.type, str(r.x.nationality, 60), str(r.x.flight, 40), str(r.x.passport, 40), r.agent, r.chain, t));
    r.tpl.forEach((cp, i) => stmts.push(env.DB.prepare('INSERT INTO checkpoints (crew_id, idx, name, name_en) VALUES ((SELECT MAX(id) FROM crew WHERE job_id = ?), ?, ?, ?)').bind(jobId, i, cp.th, cp.en)));
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
  for (const [f, max] of [['name', 120], ['rank', 40], ['nationality', 60], ['flight', 40], ['passport', 40], ['room', 20]]) if (f in b) sets[f] = str(b[f], max);
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
      const row = await env.DB.prepare(`SELECT name FROM ${table} WHERE id = ?`).bind(v).first();
      if (!row) throw new HttpError(400, `ไม่พบ${label}ที่เลือก`);
      nm = row.name;
    }
    if (v !== c[f]) logs.push(`${c.name} · ${label}: ${nm || 'ยังไม่กำหนด'}`);
    sets[f] = v;
  }
  if ('type' in b && b.type !== c.type) {
    if (!['on', 'off'].includes(b.type)) throw new HttpError(400, 'ประเภทไม่ถูกต้อง');
    const started = await env.DB.prepare('SELECT 1 FROM checkpoints WHERE crew_id = ? AND actual_at IS NOT NULL LIMIT 1').bind(id).first();
    if (started) throw new HttpError(409, 'ลูกเรือคนนี้เริ่มบันทึกเวลาแล้ว เปลี่ยนประเภทไม่ได้');
    const tpl = b.type === 'on' ? settings.cp_on : settings.cp_off;
    sets.type = b.type;
    sets.chain_end = Math.min(tpl.length - 1, b.type === 'on' ? settings.cp_on_chain : settings.cp_off_chain);
    await env.DB.batch([env.DB.prepare('DELETE FROM checkpoints WHERE crew_id = ?').bind(id), ...tpl.map((cp, i) => env.DB.prepare('INSERT INTO checkpoints (crew_id, idx, name, name_en) VALUES (?, ?, ?, ?)').bind(id, i, cp.th, cp.en))]);
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
  const { results } = await env.DB.prepare('SELECT r2_key FROM photos WHERE crew_id = ?').bind(id).all();
  if (results.length) await env.FILES.delete(results.map(r => r.r2_key));
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
  let at = Number(b.at);
  const sentAt = Number(b.sent_at);
  if (Number.isFinite(at) && Number.isFinite(sentAt)) {
    const ago = Math.max(0, sentAt - at);
    at = ago > 72 * 3600000 ? t : t - ago;
  } else if (!Number.isFinite(at) || at > t + 120000 || at < t - 12 * 3600000) at = t;
  if (!Number.isInteger(idx) || idx < 0 || idx >= cps.length) throw new HttpError(400, 'จุดไม่ถูกต้อง');
  if (cps[idx].actual_at != null) {
    if (cps[idx].actual_by === u.id && Math.abs(cps[idx].actual_at - at) < 120000) return json({ ok: true, duplicate: true, at: cps[idx].actual_at });
    throw new HttpError(409, `จุด "${cps[idx].name}" ยืนยันไปแล้ว`);
  }
  if (idx !== next) throw new HttpError(409, `ต้องยืนยัน "${cps[next].name}" ก่อน`);
  if (idx > 0 && at < cps[idx - 1].actual_at) at = cps[idx - 1].actual_at;
  const lat = Number.isFinite(Number(b.lat)) && b.lat !== null ? Number(b.lat) : null;
  const lng = Number.isFinite(Number(b.lng)) && b.lng !== null ? Number(b.lng) : null;
  const res = await env.DB.batch([
    env.DB.prepare('UPDATE checkpoints SET actual_at = ?, actual_by = ?, lat = ?, lng = ? WHERE crew_id = ? AND idx = ? AND actual_at IS NULL').bind(at, u.id, lat, lng, id, idx),
    env.DB.prepare('INSERT INTO activity (job_id, at, user_id, kind, text) VALUES (?, ?, ?, ?, ?)').bind(c.job_id, t, u.id, 'cp', `${c.name} · ${cps[idx].name}`)
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
    env.DB.prepare('UPDATE checkpoints SET actual_at = NULL, actual_by = NULL, lat = NULL, lng = NULL WHERE id = ?').bind(last.id),
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

async function addPhoto(req, env, u, id, url) {
  const c = await getCrew(env, id);
  canField(u, c);
  openJob(c);
  const type = (req.headers.get('content-type') || '').split(';')[0].trim();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new HttpError(415, 'รองรับเฉพาะไฟล์รูป JPG / PNG / WEBP');
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_PHOTO) throw new HttpError(413, 'รูปใหญ่เกิน 10 MB');
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(400, 'ไม่พบไฟล์รูป');
  if (buf.byteLength > MAX_PHOTO) throw new HttpError(413, 'รูปใหญ่เกิน 10 MB');
  const settings = await loadSettings(env);
  const used = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM photos').first();
  if (used.n + buf.byteLength > settings.storage_gb * 1024 ** 3) throw new HttpError(507, 'พื้นที่เก็บไฟล์เต็มแล้ว กรุณาแจ้งผู้ดูแลระบบ');
  const key = `photos/${c.job_id}/${id}/${Date.now()}-${randomId(8)}.${type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'}`;
  await env.FILES.put(key, buf, { httpMetadata: { contentType: type } });
  const point = str(url.searchParams.get('point'), 80);
  const lat = url.searchParams.get('lat') ? Number(url.searchParams.get('lat')) : null;
  const lng = url.searchParams.get('lng') ? Number(url.searchParams.get('lng')) : null;
  const r = await env.DB.prepare('INSERT INTO photos (crew_id, point, r2_key, size, lat, lng, at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, point, key, buf.byteLength, Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null, now(), u.id).run();
  await log(env, c.job_id, u.id, `${c.name} · แนบรูป${point ? ' ' + point : ''}`, 'photo');
  return json({ id: r.meta.last_row_id });
}

async function photoRow(env, u, id) {
  const p = await env.DB.prepare('SELECT p.*, c.agent_id, c.job_id FROM photos p JOIN crew c ON c.id = p.crew_id WHERE p.id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'ไม่พบรูป');
  if (!isOffice(u) && !seesAllCrew(u) && p.agent_id !== u.id) throw new HttpError(403, 'ไม่มีสิทธิ์ดูรูปนี้');
  return p;
}

async function getPhoto(env, u, id) {
  const p = await photoRow(env, u, id);
  const obj = await env.FILES.get(p.r2_key);
  if (!obj) throw new HttpError(404, 'ไม่พบไฟล์รูป');
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" } });
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
  const crewSheet = [['No.', 'Name', 'Rank', 'Type', 'Nationality', 'Flight', 'Passport', 'Vehicle', 'Driver', 'Hotel', 'Room', 'Boarding agent', ...settings.docs.map(d => 'Doc: ' + d)],
    ...crew.map((c, i) => { const v = veh.get(c.vehicle_id); return [i + 1, c.name, c.rank, c.type === 'on' ? 'On signer' : 'Off signer', c.nationality, c.flight, c.passport, v ? `${v.name} ${v.plate}` : '', v ? v.driver : '', hot.get(c.hotel_id) || '', c.room, uName.get(c.agent_id) || '', ...settings.docs.map(d => (c.docs[d] ? 'Yes' : 'No'))]; })];
  const log = [['Name', 'Rank', 'Type', 'Checkpoint', 'Checkpoint (EN)', 'Plan', 'Actual', 'Diff (min)', 'Result', 'Confirmed by'],
    ...crew.flatMap(c => c.cps.map(x => { const d = x.actual != null && x.plan != null ? Math.round((x.actual - x.plan) / 60000) : ''; return [c.name, c.rank, c.type === 'on' ? 'On signer' : 'Off signer', x.name, x.name_en, bkk(x.plan), bkk(x.actual), d, x.actual == null ? '' : d !== '' && d > late ? 'Late' : 'On time', uName.get(x.by) || '']; }))];
  const notes = [['Name', 'Time', 'Note', 'By'], ...crew.flatMap(c => c.notes.map(n => [c.name, bkk(n.at), n.text, uName.get(n.by) || '']))];
  return xlsxResponse([
    { name: 'Summary', rows: summary, widths: [30, 50], header: false },
    { name: 'Crew', rows: crewSheet, widths: [5, 26, 10, 12, 14, 12, 14, 18, 18, 28, 8, 18, 14, 14, 14] },
    { name: 'Time log', rows: log, widths: [26, 10, 12, 24, 24, 18, 18, 10, 10, 18] },
    { name: 'Notes', rows: notes, widths: [26, 18, 60, 18] }
  ], `${j.vessel.replace(/[^A-Za-z0-9]+/g, '-')}-${fileDate()}.xlsx`);
}

async function allData(env) {
  const [jobs, crew, cps, users, vehicles, hotels, activity] = await Promise.all([
    env.DB.prepare('SELECT * FROM jobs ORDER BY id').all(),
    env.DB.prepare('SELECT * FROM crew ORDER BY job_id, id').all(),
    env.DB.prepare('SELECT * FROM checkpoints ORDER BY crew_id, idx').all(),
    env.DB.prepare('SELECT id, username, name, role, title, phone, active FROM users ORDER BY id').all(),
    env.DB.prepare('SELECT * FROM vehicles ORDER BY id').all(),
    env.DB.prepare('SELECT * FROM hotels ORDER BY id').all(),
    env.DB.prepare('SELECT a.*, u.name AS who FROM activity a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id').all()
  ]);
  const uName = new Map(users.results.map(x => [x.id, x.name]));
  const crewName = new Map(crew.results.map(x => [x.id, x]));
  const jobName = new Map(jobs.results.map(x => [x.id, x.vessel]));
  return [
    { name: 'Jobs', rows: [['Job ID', 'Vessel', 'Port', 'Owner', 'Owner email', 'Local agent', 'Agent email', 'ETA', 'ETB', 'ETD', 'Status', 'Created', 'Closed'], ...jobs.results.map(j => [j.id, j.vessel, j.port, j.owner, j.owner_email, j.agent, j.agent_email, bkk(j.eta), bkk(j.etb), bkk(j.etd), j.status, bkk(j.created_at), bkk(j.closed_at)])], widths: [8, 26, 18, 22, 26, 22, 26, 17, 17, 17, 8, 17, 17] },
    { name: 'Crew', rows: [['Crew ID', 'Job ID', 'Vessel', 'Name', 'Rank', 'Type', 'Nationality', 'Flight', 'Passport', 'Room', 'Boarding agent'], ...crew.results.map(c => [c.id, c.job_id, jobName.get(c.job_id) || '', c.name, c.rank, c.type, c.nationality, c.flight, c.passport, c.room, uName.get(c.agent_id) || ''])], widths: [8, 8, 24, 26, 10, 6, 14, 12, 14, 8, 18] },
    { name: 'Time log', rows: [['Job ID', 'Vessel', 'Name', 'No.', 'Checkpoint', 'Plan', 'Actual', 'Diff (min)', 'By'], ...cps.results.map(x => { const c = crewName.get(x.crew_id) || {}; return [c.job_id || '', jobName.get(c.job_id) || '', c.name || '', x.idx + 1, x.name, bkk(x.plan_at), bkk(x.actual_at), x.plan_at && x.actual_at ? Math.round((x.actual_at - x.plan_at) / 60000) : '', uName.get(x.actual_by) || '']; })], widths: [8, 24, 26, 5, 24, 17, 17, 10, 18] },
    { name: 'Activity', rows: [['Time', 'Job ID', 'Vessel', 'User', 'Detail'], ...activity.results.map(a => [bkk(a.at), a.job_id, jobName.get(a.job_id) || '', a.who || '', a.text])], widths: [17, 8, 24, 18, 70] },
    { name: 'Users', rows: [['ID', 'Username', 'Name', 'Role', 'Title', 'Phone', 'Active'], ...users.results.map(x => [x.id, x.username, x.name, x.role, x.title, x.phone, x.active ? 'Yes' : 'No'])], widths: [5, 18, 24, 10, 22, 14, 8] },
    { name: 'Vehicles', rows: [['ID', 'Name', 'Plate', 'Driver', 'Driver (EN)', 'Driver ID', 'Phone', 'Active'], ...vehicles.results.map(v => [v.id, v.name, v.plate, v.driver, v.driver_en, v.driver_id, v.driver_phone, v.active ? 'Yes' : 'No'])] },
    { name: 'Hotels', rows: [['ID', 'Name', 'Phone', 'Active'], ...hotels.results.map(h => [h.id, h.name, h.phone, h.active ? 'Yes' : 'No'])] }
  ];
}

export const DUMP_TABLES = ['users', 'settings', 'vehicles', 'hotels', 'jobs', 'crew', 'checkpoints', 'notes', 'photos', 'activity'];
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
  for (const t of DUMP_TABLES) tables[t] = (await env.DB.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()).results;
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
