import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8931;
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = 'test-setup-key';
const persist = mkdtempSync(join(tmpdir(), 'cct-test-'));
const WR = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let server;

function client() {
  let cookie = '';
  return async function call(method, path, body, extra = {}) {
    const headers = { 'x-cct': '1', ...(extra.headers || {}) };
    if (cookie) headers.cookie = cookie;
    let payload = body;
    if (body !== undefined && !(body instanceof Uint8Array)) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  };
}

before(async () => {
  try { await fetch(BASE + '/'); throw new Error(`port ${PORT} is already in use by another program`); } catch (e) { if (String(e.message).includes('already in use')) throw e; }
  execFileSync(WR, ['wrangler', 'd1', 'migrations', 'apply', 'cct', '--local', '--persist-to', persist], { stdio: 'ignore', shell: process.platform === 'win32' });
  server = spawn(WR, ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', persist, '--var', `SETUP_KEY:${KEY}`, '--var', `CRON_NOW:${Date.UTC(2026, 8, 30, 19, 0)}`, '--test-scheduled'], { stdio: 'ignore', shell: process.platform === 'win32' });
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch (e) {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('dev server did not start');
});

after(() => {
  if (server) {
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {} }
    else server.kill('SIGTERM');
  }
  try { rmSync(persist, { recursive: true, force: true }); } catch (e) {}
});

const admin = client();
const office = client();
const field = client();
const field2 = client();
const anon = client();
const S = {};

test('setup requires the key and only works once', async () => {
  assert.equal((await anon('GET', '/api/setup')).data.needed, true);
  assert.equal((await anon('POST', '/api/setup', { key: 'wrong', username: 'admin', name: 'Admin', password: 'password123' })).status, 403);
  const r = await admin('POST', '/api/setup', { key: KEY, username: 'admin', name: 'ผู้ดูแลระบบ', password: 'password123' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'admin');
  assert.equal((await anon('POST', '/api/setup', { key: KEY, username: 'x', name: 'X', password: 'password123' })).status, 409);
});

test('writes without the app header or from another origin are refused', async () => {
  const res = await fetch(BASE + '/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
  const res2 = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cct': '1', origin: 'https://evil.example' }, body: '{}' });
  assert.equal(res2.status, 403);
});

test('admin creates users; the 15 account limit is enforced', async () => {
  let r = await admin('POST', '/api/users', { username: 'office1', name: 'คุณจีรวรรณ', role: 'office', password: 'office12345' });
  assert.equal(r.status, 200);
  r = await admin('POST', '/api/users', { username: 'somsak', name: 'สมศักดิ์', role: 'field', title: 'Boarding agent', id_card: '3-1001-00000-00-0', password: 'field12345' });
  S.somsak = r.data.id;
  r = await admin('POST', '/api/users', { username: 'wichai', name: 'วิชัย', role: 'field', password: 'field12345' });
  S.wichai = r.data.id;
  assert.equal((await admin('POST', '/api/users', { username: 'somsak', name: 'dup', role: 'field', password: 'field12345' })).status, 409);
  assert.equal((await admin('POST', '/api/users', { username: 'x y', name: 'bad', role: 'field', password: 'field12345' })).status, 400);
  assert.equal((await admin('POST', '/api/users', { username: 'short', name: 'pw', role: 'field', password: '123' })).status, 400);
  for (let i = 0; i < 11; i++) assert.equal((await admin('POST', '/api/users', { username: 'user' + i, name: 'User ' + i, role: 'field', password: 'field12345' })).status, 200);
  const over = await admin('POST', '/api/users', { username: 'user99', name: 'User 99', role: 'field', password: 'field12345' });
  assert.equal(over.status, 409);
  const list = (await admin('GET', '/api/users')).data.users;
  const u0 = list.find(x => x.username === 'user0');
  assert.equal((await admin('PATCH', '/api/users/' + u0.id, { active: false })).status, 200);
  assert.equal((await admin('POST', '/api/users', { username: 'user99', name: 'User 99', role: 'field', password: 'field12345' })).status, 200);
});

test('login, wrong password, lockout', async () => {
  assert.equal((await office('POST', '/api/login', { username: 'office1', password: 'office12345' })).status, 200);
  assert.equal((await field('POST', '/api/login', { username: 'somsak', password: 'field12345' })).status, 200);
  assert.equal((await field2('POST', '/api/login', { username: 'wichai', password: 'field12345' })).status, 200);
  const bad = client();
  for (let i = 0; i < 7; i++) assert.equal((await bad('POST', '/api/login', { username: 'user1', password: 'nope' })).status, 401);
  assert.equal((await bad('POST', '/api/login', { username: 'user1', password: 'nope' })).status, 401);
  assert.equal((await bad('POST', '/api/login', { username: 'user1', password: 'field12345' })).status, 429);
  assert.equal((await anon('GET', '/api/me')).status, 401);
});

test('field staff cannot use office or admin functions', async () => {
  assert.equal((await field('GET', '/api/jobs')).status, 403);
  assert.equal((await field('POST', '/api/jobs', { vessel: 'X' })).status, 403);
  assert.equal((await field('GET', '/api/users')).status, 403);
  assert.equal((await office('GET', '/api/users')).status, 403);
  const me = (await field('GET', '/api/me')).data;
  assert.equal(me.users[0].id_card, undefined, 'field staff must not see ID card numbers');
});

test('office runs a job through the 9 steps', async () => {
  const eta = Date.now() + 10 * 3600000;
  let r = await office('POST', '/api/jobs', { vessel: 'mt ocean meridian', port: 'Laem Chabang B3', owner: 'Blue Harbour', owner_email: 'ops@example.com', agent: 'LCB Marine', agent_email: 'lcb@example.com', eta, etb: eta + 90 * 60000 });
  assert.equal(r.status, 200);
  S.job = r.data.id;
  r = await office('POST', `/api/jobs/${S.job}/crew`, { crew: [
    { name: 'Rafael Mendoza', rank: 'Master', type: 'on', flight: 'PR 732', agent_id: S.somsak },
    { name: 'Arun Pillai', rank: 'C/O', type: 'on', flight: 'AI 332', agent_id: S.somsak },
    { name: 'Oleg Marchenko', rank: 'Master', type: 'off', agent_id: S.wichai }
  ] });
  assert.equal(r.status, 200);
  [S.c1, S.c2, S.c3] = r.data.ids;
  const full = (await office('GET', `/api/jobs/${S.job}`)).data;
  assert.equal(full.job.vessel, 'MT OCEAN MERIDIAN');
  assert.equal(full.crew.length, 3);
  assert.equal(full.crew[0].cps.length, 8);
  assert.equal(full.crew.find(c => c.type === 'off').cps.length, 7);

  assert.equal((await office('PATCH', `/api/crew/${S.c1}`, { s4: { oktb: true } })).status, 409, 'OKTB blocked until documents complete');
  assert.equal((await office('PATCH', `/api/crew/${S.c1}`, { docs: { Passport: 1, 'Seaman book': 1, 'ตั๋วเครื่องบิน': 1 } })).status, 200);
  assert.equal((await office('PATCH', `/api/crew/${S.c1}`, { s4: { oktb: true, meet: true } })).status, 200);

  r = await office('PATCH', `/api/jobs/${S.job}`, { eta: eta + 2 * 3600000, source: 'LCB Marine · email' });
  assert.equal(r.status, 200);
  r = await office('PATCH', `/api/jobs/${S.job}`, { services: ['Crew change', 'Husbandry'], sent: { appoint: true }, steps: [1, 1, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(r.status, 200);
  const after = (await office('GET', `/api/jobs/${S.job}`)).data;
  assert.deepEqual(after.job.services, ['Crew change', 'Husbandry']);
  assert.ok(after.job.sent.appoint > 0);
  assert.ok(after.activity.some(a => a.kind === 'eta' && a.text.includes('เปลี่ยนจาก')));

  const t0 = Date.now() - 3 * 3600000;
  const plans = [0, 45, 60, 70, 150, 600, 660, 690].map(m => t0 + m * 60000);
  assert.equal((await office('PUT', `/api/crew/${S.c1}/plan`, { plans })).status, 200);
  assert.equal((await office('PUT', `/api/crew/${S.c1}/plan`, { plans: [plans[1], plans[0], ...plans.slice(2)] })).status, 400, 'plan must be in order');

  const v = await office('POST', '/api/vehicles', { name: 'รถตู้ 1', plate: 'ฮข 1234', driver: 'คุณประเสริฐ', driver_en: 'Prasert', driver_id: '3-2002' });
  const h = await office('POST', '/api/hotels', { name: 'Harbour View Hotel' });
  assert.equal((await office('PATCH', `/api/crew/${S.c1}`, { vehicle_id: v.data.id, hotel_id: h.data.id, room: '512' })).status, 200);
  assert.equal((await office('PATCH', `/api/crew/${S.c1}`, { hotel_id: 9999 })).status, 400);
});

test('field staff only see and update their own crew', async () => {
  const mine = (await field('GET', '/api/field')).data;
  assert.deepEqual(mine.crew.map(c => c.name).sort(), ['Arun Pillai', 'Rafael Mendoza']);
  const other = (await field2('GET', '/api/field')).data;
  assert.deepEqual(other.crew.map(c => c.name), ['Oleg Marchenko']);
  assert.equal((await field2('POST', `/api/crew/${S.c1}/confirm`, { idx: 0 })).status, 403);
  assert.equal((await field('PATCH', `/api/crew/${S.c1}`, { room: '1' })).status, 403);
});

test('confirm checkpoints in order, idempotent retry, undo', async () => {
  assert.equal((await field('POST', `/api/crew/${S.c1}/confirm`, { idx: 1 })).status, 409, 'cannot skip a checkpoint');
  const at = Date.now() - 60000;
  let r = await field('POST', `/api/crew/${S.c1}/confirm`, { idx: 0, at, lat: 13.08, lng: 100.9 });
  assert.equal(r.status, 200);
  assert.equal(r.data.at, at);
  r = await field('POST', `/api/crew/${S.c1}/confirm`, { idx: 0, at });
  assert.equal(r.data.duplicate, true, 'offline retry with same time is accepted once');
  assert.equal((await field('POST', `/api/crew/${S.c1}/confirm`, { idx: 0, at: at + 5000 })).status, 409);
  r = await field('POST', `/api/crew/${S.c1}/confirm`, { idx: 1, at: Date.now() + 3600000 });
  assert.ok(Math.abs(r.data.at - Date.now()) < 5000, 'future time from device is replaced by server time');
  assert.equal((await field('POST', `/api/crew/${S.c1}/undo`)).status, 200);
  const c = (await office('GET', `/api/jobs/${S.job}`)).data.crew.find(x => x.id === S.c1);
  assert.ok(c.cps[0].actual);
  assert.equal(c.cps[1].actual, null);
  assert.equal(c.cps[0].by, S.somsak);
  assert.equal((await field('POST', `/api/crew/${S.c1}/notes`, { text: 'กระเป๋าตกค้าง รอ 30 นาที' })).status, 200);
});

test('photos upload, view by allowed users only, size and type checks', async () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
  let r = await field('POST', `/api/crew/${S.c1}/photos?point=${encodeURIComponent('เครื่องลง')}&lat=13.1&lng=100.9`, jpg, { headers: { 'content-type': 'image/jpeg' } });
  assert.equal(r.status, 200);
  S.photo = r.data.id;
  r = await field('GET', `/api/photos/${S.photo}`);
  assert.equal(r.status, 200);
  assert.deepEqual([...r.data], [...jpg]);
  assert.equal((await field2('GET', `/api/photos/${S.photo}`)).status, 403);
  assert.equal((await office('GET', `/api/photos/${S.photo}`)).status, 200);
  assert.equal((await field('POST', `/api/crew/${S.c1}/photos`, new Uint8Array([1, 2]), { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await field2('DELETE', `/api/photos/${S.photo}`)).status, 403);
});

test('owner link shows status only, without personal data', async () => {
  const full = (await office('GET', `/api/jobs/${S.job}`)).data;
  assert.ok(full.job.owner_token);
  const r = await anon('GET', `/api/public/${full.job.owner_token}`);
  assert.equal(r.status, 200);
  const body = JSON.stringify(r.data);
  assert.ok(!body.includes('Passport') && !body.includes('กระเป๋า') && !body.includes('3-1001'), 'no documents, notes or ID numbers');
  assert.equal(r.data.crew[0].cps[0].name, 'Landed');
  const nt = (await office('POST', `/api/jobs/${S.job}/token`)).data.owner_token;
  assert.equal((await anon('GET', `/api/public/${full.job.owner_token}`)).status, 404, 'old link stops working');
  assert.equal((await anon('GET', `/api/public/${nt}`)).status, 200);
  const fieldView = (await field('GET', `/api/jobs/${S.job}`)).data;
  assert.equal(fieldView.job.owner_token, undefined);
});

test('excel exports are valid xlsx files', async () => {
  let r = await office('GET', `/api/jobs/${S.job}/export.xlsx`);
  assert.equal(r.status, 200);
  assert.equal(r.data[0], 0x50); assert.equal(r.data[1], 0x4b);
  const txt = Buffer.from(r.data).toString('utf8');
  assert.ok(txt.includes('xl/worksheets/sheet3.xml'));
  assert.ok(txt.includes('Rafael Mendoza'));
  r = await office('GET', '/api/export/all.xlsx');
  assert.equal(r.status, 200);
  assert.equal((await field('GET', `/api/jobs/${S.job}/export.xlsx`)).status, 403);
});

test('settings validation and closing a job', async () => {
  assert.equal((await admin('PUT', '/api/settings', { late_min: 0 })).status, 400);
  const r = await admin('PUT', '/api/settings', { late_min: 15, docs: ['Passport', 'Seaman book', 'ตั๋วเครื่องบิน', 'Visa'] });
  assert.equal(r.data.settings.late_min, 15);
  assert.equal((await office('PUT', '/api/settings', { late_min: 20 })).status, 403);
  assert.equal((await office('PATCH', `/api/jobs/${S.job}`, { status: 'closed' })).status, 200);
  assert.equal((await field('POST', `/api/crew/${S.c1}/confirm`, { idx: 1 })).status, 409, 'closed job is read-only');
  assert.equal((await field('GET', '/api/field')).data.crew.length, 0, 'closed jobs leave the field list');
  const closed = (await office('GET', '/api/jobs?status=closed')).data.jobs;
  assert.equal(closed.length, 1);
});

test('monthly backup is written on the 1st (Bangkok time)', async () => {
  const res = await fetch(`${BASE}/__scheduled?cron=${encodeURIComponent('0 19 * * *')}`);
  assert.equal(res.status, 200);
  let list = [];
  for (let i = 0; i < 20 && !list.length; i++) { await new Promise(r => setTimeout(r, 300)); list = (await admin('GET', '/api/backups')).data.backups; }
  assert.ok(list.some(b => b.name === '2026-09.xlsx'), JSON.stringify(list));
  const f = await admin('GET', '/api/backups/2026-09.xlsx');
  assert.equal(f.status, 200);
  assert.equal((await office('GET', '/api/backups')).status, 403);
});

test('password change signs out other sessions', async () => {
  const other = client();
  await other('POST', '/api/login', { username: 'wichai', password: 'field12345' });
  assert.equal((await field2('POST', '/api/me/password', { current: 'wrong', password: 'newpass123' })).status, 400);
  assert.equal((await field2('POST', '/api/me/password', { current: 'field12345', password: 'newpass123' })).status, 200);
  assert.equal((await other('GET', '/api/me')).status, 401);
  assert.equal((await field2('GET', '/api/me')).status, 200);
  assert.equal((await field2('POST', '/api/logout')).status, 200);
  assert.equal((await field2('GET', '/api/me')).status, 401);
});
