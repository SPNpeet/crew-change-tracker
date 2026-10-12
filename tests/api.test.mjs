import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { png, pdf, sheetRows } from './gen.mjs';

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
  let r = await admin('POST', '/api/users', { username: 'office1', name: 'คุณปราณี', role: 'office', password: 'office12345' });
  assert.equal(r.status, 200);
  r = await admin('POST', '/api/users', { username: 'somsak', name: 'สมศักดิ์', role: 'field', title: 'Boarding agent', id_card: '3-1001-00000-00-0', emp_code: 'HR02', password: 'field12345' });
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
  const locked = await bad('POST', '/api/login', { username: 'user1', password: 'field12345' });
  assert.equal(locked.status, 401, 'a locked account refuses the correct password');
  assert.equal(locked.headers.get('set-cookie'), null);
  assert.equal((await anon('GET', '/api/me')).status, 401);
});

test('a locked account answers exactly like an unknown username', async () => {
  const unknown = await anon('POST', '/api/login', { username: 'no-such-user', password: 'field12345' });
  const wrong = await anon('POST', '/api/login', { username: 'user2', password: 'nope' });
  const locked = await anon('POST', '/api/login', { username: 'user1', password: 'field12345' });
  assert.equal(unknown.status, 401);
  assert.deepEqual([wrong.status, wrong.data], [unknown.status, unknown.data]);
  assert.deepEqual([locked.status, locked.data], [unknown.status, unknown.data]);
  const u1 = (await admin('GET', '/api/users')).data.users.find(x => x.username === 'user1');
  assert.equal(u1.locked, true, 'the admin still sees the lock');
});

test('field staff cannot use office or admin functions', async () => {
  assert.equal((await field('GET', '/api/jobs')).status, 403);
  assert.equal((await field('POST', '/api/jobs', { vessel: 'X' })).status, 403);
  assert.equal((await field('GET', '/api/users')).status, 403);
  assert.equal((await office('GET', '/api/users')).status, 403);
  const me = (await field('GET', '/api/me')).data;
  assert.equal(me.users[0].id_card, undefined, 'field staff must not see ID card numbers');
  assert.ok(me.users.every(x => x.emp_code === undefined), 'field staff must not see employee codes');
  let list = (await admin('GET', '/api/users')).data.users;
  assert.equal(list.find(x => x.id === S.somsak).emp_code, 'HR02');
  assert.equal(list.find(x => x.id === S.wichai).emp_code, '', 'employee code is optional');
  assert.equal((await office('GET', '/api/me')).data.users.find(x => x.id === S.somsak).emp_code, 'HR02');
  assert.equal((await admin('PATCH', `/api/users/${S.wichai}`, { emp_code: 'HR03' })).status, 200);
  assert.equal((await admin('PATCH', `/api/users/${S.wichai}`, { emp_code: '' })).status, 200);
  list = (await admin('GET', '/api/users')).data.users;
  assert.equal(list.find(x => x.id === S.wichai).emp_code, '');
  assert.equal((await office('PATCH', `/api/users/${S.wichai}`, { emp_code: 'X' })).status, 403);
  const [head, ...rows] = sheetRows((await admin('GET', '/api/export/all.xlsx')).data, 5);
  const col = head.indexOf('Employee code'), who = head.indexOf('Username');
  assert.equal(rows.find(x => x[who] === 'somsak')[col], 'HR02', 'whole-system Excel shows the employee code');
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
  assert.equal((await office('POST', `/api/crew/${S.c1}/confirm`, { idx: 0, at: at - 600000 })).status, 409, 'someone else confirming the same point is refused');
  r = await field('POST', `/api/crew/${S.c1}/confirm`, { idx: 1, at: Date.now() + 3600000 });
  assert.ok(Math.abs(r.data.at - Date.now()) < 5000, 'future time from device is replaced by server time');
  assert.equal((await field('POST', `/api/crew/${S.c1}/undo`)).status, 200);
  const c = (await office('GET', `/api/jobs/${S.job}`)).data.crew.find(x => x.id === S.c1);
  assert.ok(c.cps[0].actual);
  assert.equal(c.cps[1].actual, null);
  assert.equal(c.cps[0].by, S.somsak);
  assert.equal((await field('POST', `/api/crew/${S.c1}/notes`, { text: 'กระเป๋าตกค้าง รอ 30 นาที' })).status, 200);
});

test('review fixes: private data, clock skew, undo guard, atomic add, plan order', async () => {
  const f = (await field('GET', '/api/field')).data;
  assert.ok(f.crew.every(c => !('passport' in c)), 'field list has no passport numbers');
  const jv = (await field('GET', `/api/jobs/${S.job}`)).data;
  assert.equal(jv.activity.length, 0, 'field user gets no job-wide activity feed');
  assert.equal(jv.job.owner_email, undefined);
  assert.equal(jv.job.agent_email, undefined);
  assert.ok(jv.crew.every(c => !('passport' in c)));
  const me = (await field('GET', '/api/me')).data;
  assert.ok(me.vehicles.every(v => !('driver_id' in v)), 'field user gets no driver ID numbers');
  assert.ok((await office('GET', '/api/me')).data.vehicles.some(v => 'driver_id' in v), 'office still sees driver IDs');

  const realNow = Date.now();
  const deviceNow = realNow - 30 * 60000;
  let r = await field('POST', `/api/crew/${S.c2}/confirm`, { idx: 0, at: deviceNow - 5 * 60000, sent_at: deviceNow });
  assert.equal(r.status, 200);
  assert.ok(Math.abs(r.data.at - (realNow - 5 * 60000)) < 5000, 'slow phone clock is corrected to server time');
  r = await field('POST', `/api/crew/${S.c2}/confirm`, { idx: 1, at: deviceNow - 60000, sent_at: deviceNow + 1000 });
  assert.equal(r.status, 200);
  assert.equal((await field('POST', `/api/crew/${S.c2}/undo`, { idx: 0 })).status, 409, 'undo refuses when the last point changed');
  assert.equal((await field('POST', `/api/crew/${S.c2}/undo`, { idx: 1 })).status, 200);

  const before = (await office('GET', `/api/jobs/${S.job}`)).data.crew.length;
  assert.equal((await office('POST', `/api/jobs/${S.job}/crew`, { crew: [{ name: 'Alpha' }, { name: '' }] })).status, 400);
  assert.equal((await office('GET', `/api/jobs/${S.job}`)).data.crew.length, before, 'failed batch adds nobody');
  r = await office('POST', `/api/jobs/${S.job}/crew`, { crew: [{ name: 'Bravo', type: 'on' }, { name: 'Charlie', type: 'off' }] });
  const added = (await office('GET', `/api/jobs/${S.job}`)).data.crew.filter(c => r.data.ids.includes(c.id));
  assert.deepEqual(added.map(c => [c.name, c.cps.length]).sort(), [['Bravo', 8], ['Charlie', 7]], 'each new crew gets its own checkpoints');
  const t0 = Date.now();
  assert.equal((await office('PUT', `/api/crew/${added[0].id}/plan`, { plans: [t0 + 3600000, null, t0, null, null, null, null, null].slice(0, added[0].cps.length) })).status, 400, 'order checked across blank points');
  for (const c of added) await office('DELETE', `/api/crew/${c.id}`);
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

test('a photo sent later keeps the time it was taken, corrected for the phone clock', async () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 0xff, 0xd9]);
  const realNow = Date.now();
  const deviceNow = realNow - 30 * 60000;
  const send = q => field('POST', `/api/crew/${S.c1}/photos?point=${encodeURIComponent('ถึงโรงแรม')}&${q}`, jpg, { headers: { 'content-type': 'image/jpeg' } });
  const late = await send(`at=${deviceNow - 40 * 60000}&sent_at=${deviceNow}`);
  const plain = await send('lat=13.2&lng=100.8');
  assert.equal(late.status, 200);
  assert.equal(plain.status, 200);
  const photos = (await office('GET', `/api/jobs/${S.job}`)).data.crew.find(x => x.id === S.c1).photos;
  assert.ok(Math.abs(photos.find(p => p.id === late.data.id).at - (realNow - 40 * 60000)) < 5000, 'queued photo keeps its own time');
  assert.ok(Math.abs(photos.find(p => p.id === plain.data.id).at - Date.now()) < 5000, 'without a time the server time is used');
});

test('photo retries reuse one record and reject a changed payload', async () => {
  const jpg = new Uint8Array([255, 216, 255, 217]);
  const path = `/api/crew/${S.c1}/photos?upload_id=regression-retry-photo-0001&point=retry&at=${Date.now()}`;
  const before = (await office('GET', `/api/jobs/${S.job}`)).data.crew.find(c => c.id === S.c1).photos.length;
  const first = await field('POST', path, jpg, { headers: { 'content-type': 'image/jpeg' } });
  S.photoRetryPath = path; S.photoRetryId = first.data.id;
  const again = await field('POST', path, jpg, { headers: { 'content-type': 'image/jpeg' } });
  assert.equal(first.status, 200);
  assert.equal(again.status, 200);
  assert.equal(again.data.id, first.data.id, 'a lost response must not create another photo');
  assert.equal(again.data.duplicate, true);
  const after = (await office('GET', `/api/jobs/${S.job}`)).data.crew.find(c => c.id === S.c1).photos.length;
  assert.equal(after, before + 1);
  const changed = await field('POST', path, new Uint8Array([255, 216, 1, 255, 217]), { headers: { 'content-type': 'image/jpeg' } });
  assert.equal(changed.status, 409, 'reusing an upload id cannot overwrite a different photo');
  const original = await field('GET', `/api/photos/${first.data.id}`);
  assert.deepEqual([...original.data], [...jpg]);
});

test('simultaneous photo retries create one photo and one activity entry', async () => {
  const jpg = new Uint8Array([255, 216, 255, 217]);
  const path = `/api/crew/${S.c1}/photos?upload_id=regression-parallel-photo-0001&point=parallel&at=${Date.now()}`;
  const replies = await Promise.all(Array.from({ length: 5 }, () => field('POST', path, jpg, { headers: { 'content-type': 'image/jpeg' } })));
  assert.ok(replies.every(r => r.status === 200), JSON.stringify(replies));
  assert.equal(new Set(replies.map(r => r.data.id)).size, 1);
  const full = (await office('GET', `/api/jobs/${S.job}`)).data;
  assert.equal(full.crew.find(c => c.id === S.c1).photos.filter(p => p.point === 'parallel').length, 1);
  assert.equal(full.activity.filter(a => a.kind === 'photo' && a.text.endsWith('parallel')).length, 1);
});

test('legacy photo retries are deduplicated and cross-session uploads are refused', async () => {
  const jpg = new Uint8Array([255, 216, 255, 217]);
  const path = `/api/crew/${S.c1}/photos?point=legacy-retry&at=${Date.now()}`;
  const a = await field('POST', path, jpg, { headers: { 'content-type': 'image/jpeg' } });
  const b = await field('POST', path, jpg, { headers: { 'content-type': 'image/jpeg' } });
  assert.equal(a.status, 200);
  assert.equal(b.data.id, a.data.id);
  const wrongSession = await field('POST', path, jpg, { headers: { 'content-type': 'image/jpeg', 'x-cct-user': String(S.wichai) } });
  assert.equal(wrongSession.status, 401);
});

test('authenticated photos must not be stored in the browser cache', async () => {
  const r = await field('GET', `/api/photos/${S.photo}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /no-store/);
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
  assert.ok(txt.includes('Crew change summary') && txt.includes('Checkpoint (EN)') && txt.includes('Landed'));
  assert.ok(txt.includes('Doc: Flight ticket') && !txt.includes('Doc: ตั๋วเครื่องบิน'), 'built-in document heading is English without changing stored document keys');
  r = await office('GET', '/api/export/all.xlsx');
  assert.equal(r.status, 200);
  assert.equal((await field('GET', `/api/jobs/${S.job}/export.xlsx`)).status, 403);
});

test('email templates are editable by the admin only', async () => {
  const def = (await admin('GET', '/api/me')).data.settings.mail_tpl;
  assert.deepEqual(Object.keys(def).sort(), ['appoint', 'gate', 'morning', 'night', 'plan', 'sched', 'update']);
  assert.ok(def.appoint.includes('{{services_line}}') && def.morning.includes('MORNING UPDATE'));
  const mine = { ...def, appoint: 'Subject: TEMPLATE-CHANGED {{vessel}}\r\n\r\n{{signature}}' };
  let r = await admin('PUT', '/api/settings', { mail_tpl: mine, mail_tpl_expected: def });
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.mail_tpl.appoint, 'Subject: TEMPLATE-CHANGED {{vessel}}\n\n{{signature}}');
  assert.equal((await office('GET', '/api/me')).data.settings.mail_tpl.appoint, r.data.settings.mail_tpl.appoint);
  const { night, ...missing } = def;
  assert.equal((await admin('PUT', '/api/settings', { mail_tpl: missing })).status, 400);
  assert.equal((await admin('PUT', '/api/settings', { mail_tpl: { ...def, night: 5 } })).status, 400);
  assert.equal((await admin('PUT', '/api/settings', { mail_tpl: { ...def, extra: 'x' } })).status, 400);
  assert.equal((await admin('PUT', '/api/settings', { mail_tpl: { ...def, gate: 'x'.repeat(4001) } })).status, 400);
  assert.equal((await admin('PUT', '/api/settings', { mail_tpl: { ...def, gate: '  ' } })).status, 400);
  assert.equal((await admin('PUT', '/api/settings', { mail_tpl: 'text' })).status, 400);
  assert.equal((await field('PUT', '/api/settings', { mail_tpl: def })).status, 403);
  assert.equal((await office('PUT', '/api/settings', { mail_tpl: def })).status, 403);
  assert.equal((await admin('GET', '/api/me')).data.settings.mail_tpl.appoint, r.data.settings.mail_tpl.appoint, 'refused writes change nothing');
  assert.deepEqual((await admin('PUT', '/api/settings', { mail_tpl: def, mail_tpl_expected: r.data.settings.mail_tpl })).data.settings.mail_tpl, def);
});

const PRIVATE = ['TEST-PP-778899', 'SIRB-TEST', '2031-04-17', '2029-12-01', 'scan-test'];
const leaks = data => PRIVATE.filter(x => JSON.stringify(data).includes(x));
const raw = (type, extra = {}) => ({ headers: { 'content-type': type, ...extra } });

test('passport expiry and seaman book fields are saved, validated and exported', async () => {
  let r = await office('POST', `/api/jobs/${S.job}/crew`, { crew: [{ name: 'Doc Tester', rank: '3/O', type: 'on', passport: 'TEST-PP-778899', passport_exp: '2031-04-17', sirb_no: 'SIRB-TEST-445566', sirb_exp: '2029-12-01', agent_id: S.somsak }] });
  assert.equal(r.status, 200);
  S.cd = r.data.ids[0];
  const read = async () => (await office('GET', `/api/jobs/${S.job}`)).data.crew.find(c => c.id === S.cd);
  let c = await read();
  assert.deepEqual([c.passport_exp, c.sirb_no, c.sirb_exp], ['2031-04-17', 'SIRB-TEST-445566', '2029-12-01']);
  assert.deepEqual(c.files, []);
  const before = (await office('GET', `/api/jobs/${S.job}`)).data.crew.length;
  for (const bad of ['17/04/2031', '2031-4-17', '2031-02-30', 'soon', 20310417]) assert.equal((await office('POST', `/api/jobs/${S.job}/crew`, { crew: [{ name: 'Bad Date', passport_exp: bad }] })).status, 400, 'create refuses ' + bad);
  assert.equal((await office('POST', `/api/jobs/${S.job}/crew`, { crew: [{ name: 'Bad Date', sirb_exp: '2029-13-01' }] })).status, 400);
  assert.equal((await office('GET', `/api/jobs/${S.job}`)).data.crew.length, before, 'a refused date adds nobody');
  assert.equal((await office('PATCH', `/api/crew/${S.cd}`, { sirb_exp: '2029-02-30' })).status, 400);
  assert.equal((await office('PATCH', `/api/crew/${S.cd}`, { passport_exp: '01-05-2032' })).status, 400);
  assert.deepEqual([(c = await read()).passport_exp, c.sirb_exp], ['2031-04-17', '2029-12-01'], 'refused edits change nothing');
  assert.equal((await office('PATCH', `/api/crew/${S.cd}`, { passport_exp: '', sirb_no: '  SIRB-TEST-999  ', sirb_exp: '2030-06-30' })).status, 200);
  assert.deepEqual([(c = await read()).passport_exp, c.sirb_no, c.sirb_exp], ['', 'SIRB-TEST-999', '2030-06-30']);
  assert.equal((await office('PATCH', `/api/crew/${S.cd}`, { passport_exp: '2031-04-17', sirb_exp: '2029-12-01' })).status, 200);
  assert.equal((await field('PATCH', `/api/crew/${S.cd}`, { sirb_no: 'x' })).status, 403);
  const txt = Buffer.from((await office('GET', `/api/jobs/${S.job}/export.xlsx`)).data).toString('utf8');
  assert.ok(txt.includes('Passport expiry') && txt.includes('SIRB no.') && txt.includes('SIRB expiry') && txt.includes('SIRB-TEST-999') && txt.includes('2031-04-17'), 'excel has the new columns');
});

test('crew documents: office uploads an image and a PDF with type, content and size checks', async () => {
  const img = png(40, 26), doc = pdf(['SAMPLE E-TICKET page 1', 'SAMPLE E-TICKET page 2']);
  const name = 'scan-test พาสปอร์ต (1).png';
  let r = await office('POST', `/api/crew/${S.cd}/files?kind=passport&name=${encodeURIComponent(name)}`, img, raw('image/png'));
  assert.equal(r.status, 200);
  S.f1 = r.data.id;
  r = await office('POST', `/api/crew/${S.cd}/files?kind=ticket&name=scan-test-ticket.pdf`, doc, raw('application/pdf'));
  assert.equal(r.status, 200);
  S.f2 = r.data.id;
  const full = (await office('GET', `/api/jobs/${S.job}`)).data;
  const files = full.crew.find(c => c.id === S.cd).files;
  assert.deepEqual(files.map(f => [f.id, f.kind, f.name, f.mime, f.size]), [[S.f1, 'passport', name, 'image/png', img.length], [S.f2, 'ticket', 'scan-test-ticket.pdf', 'application/pdf', doc.length]]);
  assert.deepEqual(Object.keys(files[0]).sort(), ['at', 'id', 'kind', 'mime', 'name', 'size'], 'storage keys are not sent to the browser');
  assert.ok(Math.abs(files[0].at - Date.now()) < 10000);
  assert.ok(full.activity.some(a => a.text === 'Doc Tester · แนบไฟล์ พาสปอร์ต') && full.activity.some(a => a.text === 'Doc Tester · แนบไฟล์ ตั๋วเครื่องบิน'));

  r = await office('GET', `/api/files/${S.f1}`);
  assert.equal(r.status, 200);
  assert.deepEqual([...r.data], [...img]);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('content-security-policy'), "default-src 'none'");
  assert.equal(r.headers.get('content-disposition'), "inline; filename*=UTF-8''scan-test%20%E0%B8%9E%E0%B8%B2%E0%B8%AA%E0%B8%9B%E0%B8%AD%E0%B8%A3%E0%B9%8C%E0%B8%95%20%281%29.png");
  r = await office('GET', `/api/files/${S.f2}`);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.deepEqual([...r.data], [...doc]);
  assert.equal((await admin('GET', `/api/files/${S.f2}`)).status, 200);

  const up = (q, body, type) => office('POST', `/api/crew/${S.cd}/files?${q}`, body, raw(type));
  assert.equal((await up('kind=passport&name=a.txt', new Uint8Array([1, 2, 3]), 'text/plain')).status, 415);
  assert.equal((await up('kind=passport&name=a.heic', img, 'image/heic')).status, 415);
  assert.equal((await up('kind=passport&name=a.html', new TextEncoder().encode('<script>alert(1)</script>'), 'text/html')).status, 415);
  assert.equal((await up('kind=passport&name=fake.png', new TextEncoder().encode('<script>alert(1)</script>'), 'image/png')).status, 400, 'content must match the declared type');
  assert.equal((await up('kind=ticket&name=fake.pdf', img, 'application/pdf')).status, 400);
  assert.equal((await up('kind=visa&name=a.png', img, 'image/png')).status, 400, 'unknown document kind');
  assert.equal((await up('name=a.png', img, 'image/png')).status, 400);
  assert.equal((await up('kind=passport&name=a.png', new Uint8Array(0), 'image/png')).status, 400);
  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  big.set(img.subarray(0, 8));
  r = await up('kind=passport&name=big.png', big, 'image/png');
  assert.equal(r.status, 413);
  assert.ok(r.data.error.includes('10 MB'));
  assert.equal((await office('POST', '/api/crew/999999/files?kind=passport', img, raw('image/png'))).status, 404);
  assert.equal((await office('GET', '/api/files/999999')).status, 404);
  assert.equal((await office('GET', `/api/jobs/${S.job}`)).data.crew.find(c => c.id === S.cd).files.length, 2, 'refused uploads store nothing');
  r = await up('kind=other&name=' + encodeURIComponent('..\\..\\evil/name?.jpg'), new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9]), 'image/jpeg');
  assert.equal(r.status, 200);
  S.f3 = r.data.id;
  assert.equal((await office('GET', `/api/jobs/${S.job}`)).data.crew.find(c => c.id === S.cd).files[2].name, '.._.._evil_name_.jpg', 'path characters are removed from file names');
});

test('field staff, the Owner link and visitors cannot reach documents or the new personal fields', async () => {
  const img = png(8, 8);
  const lead = client();
  const u2 = (await admin('GET', '/api/users')).data.users.find(x => x.username === 'user2');
  assert.equal((await admin('PATCH', `/api/users/${u2.id}`, { see_all: true })).status, 200);
  assert.equal((await lead('POST', '/api/login', { username: 'user2', password: 'field12345' })).status, 200);
  for (const [who, call, code] of [['assigned field agent', field, 403], ['field supervisor who sees all crew', lead, 403], ['visitor', anon, 401]]) {
    assert.equal((await call('POST', `/api/crew/${S.cd}/files?kind=passport&name=x.png`, img, raw('image/png'))).status, code, who + ' upload');
    for (const id of [S.f1, S.f2]) {
      const r = await call('GET', `/api/files/${id}`);
      assert.equal(r.status, code, who + ' fetch');
      assert.ok(r.data.error && !('length' in r.data), who + ' gets an error message, not file bytes');
    }
    assert.equal((await call('DELETE', `/api/files/${S.f1}`)).status, code, who + ' delete');
    assert.equal((await call('GET', '/api/brand/letterhead')).status, code, who + ' brand image');
  }
  assert.equal((await fetch(BASE + `/api/files/${S.f1}`)).status, 401, 'no cookie, no header');
  assert.equal((await office('GET', `/api/jobs/${S.job}`)).data.crew.find(c => c.id === S.cd).files.length, 3, 'nothing was added or removed');

  for (const [who, call] of [['agent', field], ['supervisor', lead]]) {
    const list = (await call('GET', '/api/field')).data;
    const jv = (await call('GET', `/api/jobs/${S.job}`)).data;
    for (const c of [list.crew.find(x => x.id === S.cd), jv.crew.find(x => x.id === S.cd)]) {
      assert.ok(c, who + ' is allowed to see this crew member');
      for (const k of ['files', 'passport', 'passport_exp', 'sirb_no', 'sirb_exp']) assert.ok(!(k in c), `${who} payload has no ${k}`);
    }
    assert.deepEqual(leaks(list), [], who + ' field list');
    assert.deepEqual(leaks(jv), [], who + ' job view');
    assert.equal(jv.job.oktb, undefined);
    const me = (await call('GET', '/api/me')).data;
    assert.equal(me.brand, undefined);
    assert.equal(me.settings.oktb, undefined);
  }
  const token = (await office('GET', `/api/jobs/${S.job}`)).data.job.owner_token;
  const pub = await anon('GET', `/api/public/${token}`);
  assert.equal(pub.status, 200);
  assert.ok(pub.data.crew.some(c => c.name === 'Doc Tester'));
  assert.deepEqual(leaks(pub.data), [], 'owner link');
  assert.ok(pub.data.crew.every(c => !('files' in c) && !('passport_exp' in c) && !('sirb_no' in c) && !('sirb_exp' in c)));
  assert.ok(!JSON.stringify(pub.data).includes('oktb'));
  assert.deepEqual(leaks((await office('GET', `/api/jobs/${S.job}`)).data).sort(), [...PRIVATE].sort(), 'the same check does find the data in the office view');
  assert.equal((await admin('PATCH', `/api/users/${u2.id}`, { see_all: false })).status, 200);
});

test('deleting a document or a crew member removes the stored files', async () => {
  let r = await office('DELETE', `/api/files/${S.f3}`);
  assert.equal(r.status, 200);
  assert.equal((await office('GET', `/api/files/${S.f3}`)).status, 404);
  assert.equal((await office('DELETE', `/api/files/${S.f3}`)).status, 404);
  let full = (await office('GET', `/api/jobs/${S.job}`)).data;
  assert.deepEqual(full.crew.find(c => c.id === S.cd).files.map(f => f.id), [S.f1, S.f2]);
  assert.ok(full.activity.some(a => a.text === 'Doc Tester · ลบไฟล์ อื่น ๆ'));
  const tmp = (await office('POST', `/api/jobs/${S.job}/crew`, { crew: [{ name: 'Temp Docs', type: 'on' }] })).data.ids[0];
  const ids = [];
  for (const kind of ['passport', 'sirb']) ids.push((await office('POST', `/api/crew/${tmp}/files?kind=${kind}&name=t.png`, png(6, 6), raw('image/png'))).data.id);
  assert.equal((await office('GET', `/api/files/${ids[1]}`)).status, 200);
  assert.equal((await office('DELETE', `/api/crew/${tmp}`)).status, 200);
  for (const id of ids) assert.equal((await office('GET', `/api/files/${id}`)).status, 404, 'file rows go with the crew member');
  const job = (await office('POST', '/api/jobs', { vessel: 'MV DELETE ME' })).data.id;
  const who = (await office('POST', `/api/jobs/${job}/crew`, { crew: [{ name: 'Gone Soon', type: 'on' }] })).data.ids[0];
  r = await office('POST', `/api/crew/${who}/files?kind=passport&name=gone.png`, png(6, 6), raw('image/png'));
  assert.equal((await office('GET', `/api/files/${r.data.id}`)).status, 200);
  assert.equal((await office('DELETE', `/api/jobs/${job}`)).status, 403, 'only the admin deletes a job');
  assert.equal((await admin('DELETE', `/api/jobs/${job}`)).status, 200);
  assert.equal((await office('GET', `/api/files/${r.data.id}`)).status, 404, 'file rows go with the job');
  assert.equal((await office('GET', `/api/files/${S.f1}`)).status, 200, 'other crew keep their files');
});

test('a job keeps the last OK TO BOARD options', async () => {
  const opt = { to: 'Example Airways', date: '2026-09-18', call_date: '2026-09-19', flights: 'EX974 19SEP MNL-HKG 0530-0750 LT.\nEX701 19SEP HKG-BKK 0900-1100 LT.', company: 'Example Agency Co., Ltd.', pic_name: 'คุณทดสอบ', pic_mobile: '081-000-0000', letterhead: false, sign: true, attach: true, crew: [S.c1, S.cd] };
  assert.deepEqual((await office('GET', `/api/jobs/${S.job}`)).data.job.oktb, {});
  assert.equal((await office('PATCH', `/api/jobs/${S.job}`, { oktb: { ...opt, flights: opt.flights.replace('\n', '\r\n'), junk: 1 } })).status, 200);
  assert.deepEqual((await office('GET', `/api/jobs/${S.job}`)).data.job.oktb, opt);
  for (const bad of [{ ...opt, date: '18/09/2026' }, { ...opt, call_date: '2026-02-31' }, 'text', [], null]) assert.equal((await office('PATCH', `/api/jobs/${S.job}`, { oktb: bad })).status, 400);
  assert.equal((await field('PATCH', `/api/jobs/${S.job}`, { oktb: opt })).status, 403);
  assert.deepEqual((await office('GET', `/api/jobs/${S.job}`)).data.job.oktb, opt, 'refused writes change nothing');
  assert.equal((await office('PATCH', `/api/jobs/${S.job}`, { oktb: { to: 'x'.repeat(500), date: '', crew: [S.c1, 'x', -1, 2.5, S.c1], letterhead: 1 } })).status, 200);
  const o = (await office('GET', `/api/jobs/${S.job}`)).data.job.oktb;
  assert.deepEqual([o.to.length, o.date, o.crew, o.letterhead, o.sign, o.flights], [200, '', [S.c1], true, false, '']);
  assert.equal((await office('PATCH', `/api/jobs/${S.job}`, { oktb: opt })).status, 200);
});

test('letterhead, signature and stamp: admin uploads, office reads, field cannot', async () => {
  const head = png(60, 12), sign = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 0xff, 0xd9]);
  assert.deepEqual((await office('GET', '/api/me')).data.brand, { letterhead: 0, signature: 0, stamp: 0 });
  assert.equal((await office('GET', '/api/brand/letterhead')).status, 404);
  assert.equal((await office('PUT', '/api/brand/letterhead', head, raw('image/png'))).status, 403);
  assert.equal((await field('PUT', '/api/brand/letterhead', head, raw('image/png'))).status, 403);
  assert.equal((await anon('PUT', '/api/brand/letterhead', head, raw('image/png'))).status, 401);
  assert.equal((await office('GET', '/api/me')).data.brand.letterhead, 0);
  let r = await admin('PUT', '/api/brand/letterhead', head, raw('image/png'));
  assert.equal(r.status, 200);
  assert.ok(r.data.brand.letterhead > Date.now() - 10000 && r.data.brand.signature === 0);
  assert.equal((await admin('PUT', '/api/brand/signature', sign, raw('image/jpeg'))).status, 200);
  assert.equal((await admin('PUT', '/api/brand/stamp', head, raw('image/webp'))).status, 415);
  assert.equal((await admin('PUT', '/api/brand/stamp', pdf(['x']), raw('application/pdf'))).status, 415);
  assert.equal((await admin('PUT', '/api/brand/stamp', new TextEncoder().encode('not an image'), raw('image/png'))).status, 400);
  assert.equal((await admin('PUT', '/api/brand/logo', head, raw('image/png'))).status, 404);
  const big = new Uint8Array(2 * 1024 * 1024 + 1);
  big.set(head.subarray(0, 8));
  assert.equal((await admin('PUT', '/api/brand/stamp', big, raw('image/png'))).status, 413);
  r = await office('GET', '/api/brand/letterhead');
  assert.equal(r.status, 200);
  assert.deepEqual([...r.data], [...head]);
  assert.deepEqual([r.headers.get('content-type'), r.headers.get('cache-control'), r.headers.get('x-content-type-options')], ['image/png', 'no-store', 'nosniff']);
  assert.equal((await office('GET', '/api/brand/signature')).headers.get('content-type'), 'image/jpeg');
  assert.equal((await office('GET', '/api/brand/stamp')).status, 404);
  assert.equal((await field('GET', '/api/brand/letterhead')).status, 403);
  assert.equal((await anon('GET', '/api/brand/letterhead')).status, 401);
  const b = (await office('GET', '/api/me')).data.brand;
  assert.ok(b.letterhead > 0 && b.signature > 0 && b.stamp === 0);
  assert.equal((await field('GET', '/api/me')).data.brand, undefined);
  r = await admin('PUT', '/api/settings', { brand: { letterhead: 0, signature: 0, stamp: 123 } });
  assert.equal(r.data.settings.brand, undefined);
  assert.deepEqual((await office('GET', '/api/me')).data.brand, b, 'the settings form cannot change which images exist');
  assert.equal((await office('DELETE', '/api/brand/signature')).status, 403);
  assert.equal((await field('DELETE', '/api/brand/signature')).status, 403);
  r = await admin('DELETE', '/api/brand/signature');
  assert.deepEqual([r.status, r.data.brand.signature, r.data.brand.letterhead], [200, 0, b.letterhead]);
  assert.equal((await office('GET', '/api/brand/signature')).status, 404);
});

test('OK TO BOARD letter settings are validated and editable by the admin only', async () => {
  const def = (await admin('GET', '/api/me')).data.settings.oktb;
  assert.deepEqual(Object.keys(def), ['pic_name', 'pic_mobile', 'signer_name', 'signer_title', 'footer', 'subject', 'intro', 'guarantee']);
  assert.deepEqual([def.signer_title, def.footer, def.subject], ['Operation', 'As Agents Only, E.&.O.E.', 'Letter of Guarantee / OK to Board']);
  assert.ok(['{{company}}', '{{vessel}}', '{{port}}', '{{call_date}}'].every(v => def.intro.includes(v)) && def.guarantee.includes('{{company}} is sponsoring him'));
  const mine = { ...def, pic_name: 'คุณทดสอบ', pic_mobile: '081-000-0000', signer_name: 'Test Signer', guarantee: 'Line one {{company}}\r\n\r\nLine two  ' };
  let r = await admin('PUT', '/api/settings', { oktb: mine });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.settings.oktb, { ...mine, guarantee: 'Line one {{company}}\n\nLine two' });
  assert.equal((await office('GET', '/api/me')).data.settings.oktb.signer_name, 'Test Signer');
  const { footer, ...missing } = def;
  assert.equal((await admin('PUT', '/api/settings', { oktb: missing })).status, 400);
  assert.equal((await admin('PUT', '/api/settings', { oktb: { ...def, pic_mobile: 81000 } })).status, 400);
  assert.equal((await admin('PUT', '/api/settings', { oktb: { ...def, intro: 'x'.repeat(2001) } })).status, 400);
  assert.equal((await admin('PUT', '/api/settings', { oktb: { ...def, extra: 'x' } })).status, 400);
  assert.equal((await admin('PUT', '/api/settings', { oktb: { ...missing, extra: 'x' } })).status, 400);
  assert.equal((await admin('PUT', '/api/settings', { oktb: [] })).status, 400);
  assert.equal((await admin('PUT', '/api/settings', { oktb: 'text' })).status, 400);
  assert.equal((await office('PUT', '/api/settings', { oktb: def })).status, 403);
  assert.equal((await field('PUT', '/api/settings', { oktb: def })).status, 403);
  assert.equal((await admin('GET', '/api/me')).data.settings.oktb.signer_name, 'Test Signer', 'refused writes change nothing');
  assert.equal((await admin('PUT', '/api/settings', { oktb: { ...def, intro: 'x'.repeat(2000) } })).status, 200, '2000 characters is allowed');
  assert.deepEqual((await admin('PUT', '/api/settings', { oktb: def })).data.settings.oktb, def);
});

test('settings validation and closing a job', async () => {
  assert.equal((await admin('PUT', '/api/settings', { late_min: 0 })).status, 400);
  const r = await admin('PUT', '/api/settings', { late_min: 15, docs: ['Passport', 'Seaman book', 'ตั๋วเครื่องบิน', 'Visa'] });
  assert.equal(r.data.settings.late_min, 15);
  assert.equal((await office('PUT', '/api/settings', { late_min: 20 })).status, 403);
  assert.equal((await office('PATCH', `/api/jobs/${S.job}`, { status: 'closed' })).status, 200);
  const retry = await field('POST', S.photoRetryPath, new Uint8Array([255, 216, 255, 217]), { headers: { 'content-type': 'image/jpeg' } });
  assert.equal(retry.status, 200, 'a response lost before closure can still be acknowledged');
  assert.equal(retry.data.id, S.photoRetryId);
  assert.equal((await field('POST', `/api/crew/${S.c1}/photos?upload_id=new-after-closure-0001`, new Uint8Array([255, 216, 255, 217]), { headers: { 'content-type': 'image/jpeg' } })).status, 409);
  assert.equal((await field('POST', `/api/crew/${S.c1}/confirm`, { idx: 1 })).status, 409, 'closed job is read-only');
  assert.equal((await field('GET', '/api/field')).data.crew.length, 0, 'closed jobs leave the field list');
  const closed = (await office('GET', '/api/jobs?status=closed')).data.jobs;
  assert.equal(closed.length, 1);
});

test('a closed job refuses document upload and delete but the office can still open the files', async () => {
  const r = await office('POST', `/api/crew/${S.cd}/files?kind=sirb&name=late.png`, png(6, 6), raw('image/png'));
  assert.equal(r.status, 409);
  assert.ok(r.data.error.includes('ปิดแล้ว'));
  assert.equal((await office('DELETE', `/api/files/${S.f1}`)).status, 409);
  assert.equal((await admin('DELETE', `/api/files/${S.f2}`)).status, 409);
  assert.equal((await office('PATCH', `/api/crew/${S.cd}`, { sirb_no: 'changed' })).status, 409);
  assert.equal((await office('GET', `/api/files/${S.f1}`)).status, 200);
  assert.deepEqual((await office('GET', `/api/jobs/${S.job}`)).data.crew.find(c => c.id === S.cd).files.map(f => f.id), [S.f1, S.f2]);
  assert.equal((await field('GET', `/api/files/${S.f1}`)).status, 403);
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
  assert.ok(list.some(b => b.name === 'daily/2026-10-01.json.gz'), 'nightly full backup written');
});

test('nightly backup restores into an empty database with identical data', async () => {
  const f = await admin('GET', '/api/backups/daily/2026-10-01.json.gz');
  assert.equal(f.status, 200);
  const dir = mkdtempSync(join(tmpdir(), 'cct-restore-'));
  const gz = join(dir, 'b.json.gz'), sql = join(dir, 'r.sql'), db = join(dir, 'db');
  writeFileSync(gz, f.data);
  const sh = { stdio: 'pipe', shell: process.platform === 'win32' };
  execFileSync('node', ['scripts/backup-to-sql.mjs', gz, sql], sh);
  execFileSync(WR, ['wrangler', 'd1', 'migrations', 'apply', 'cct', '--local', '--persist-to', db], sh);
  execFileSync(WR, ['wrangler', 'd1', 'execute', 'cct', '--local', '--persist-to', db, '--file', sql], sh);
  const count = where => { const out = execFileSync(WR, ['wrangler', 'd1', 'execute', 'cct', '--local', '--persist-to', where, '--json', '--command', `"SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM jobs) j, (SELECT COUNT(*) FROM crew) c, (SELECT COUNT(*) FROM checkpoints) k, (SELECT COUNT(*) FROM notes) n, (SELECT COUNT(*) FROM photos) p, (SELECT COUNT(*) FROM activity) a, (SELECT SUM(actual_at) FROM checkpoints) s, (SELECT COUNT(*) FROM crew_files) f, (SELECT SUM(size) FROM crew_files) fs, (SELECT COUNT(*) FROM crew WHERE LENGTH(passport_exp) = 10 AND LENGTH(sirb_exp) = 10) x, (SELECT COUNT(*) FROM jobs WHERE LENGTH(oktb) > 2) o"`], sh).toString(); return JSON.parse(out.slice(out.indexOf('[')))[0].results[0]; };
  const restored = count(db);
  const live = JSON.parse(Buffer.from(gunzipSync(f.data)).toString('utf8')).tables;
  assert.equal(restored.u, live.users.length);
  assert.equal(restored.c, live.crew.length);
  assert.equal(restored.k, live.checkpoints.length);
  assert.equal(restored.a, live.activity.length);
  assert.equal(restored.s, live.checkpoints.reduce((x, r) => x + (r.actual_at || 0), 0));
  assert.ok(restored.j >= 1 && restored.p >= 1 && restored.n >= 1, 'jobs, photos and notes restored');
  assert.equal(live.crew_files.length, 2, 'the backup lists the crew documents');
  assert.equal(restored.f, live.crew_files.length);
  assert.equal(restored.fs, live.crew_files.reduce((x, r) => x + r.size, 0));
  assert.ok(live.crew_files.every(r => r.r2_key.startsWith('docs/') && r.name.startsWith('scan-test')));
  assert.equal(restored.x, 1, 'passport and seaman book expiry dates restored');
  assert.equal(restored.o, 1, 'OK TO BOARD options restored');
  assert.ok(live.settings.some(r => r.key === 'brand'), 'the backup records which brand images exist');

  const old = { format: 'cct-backup', version: 1, created: Date.now(), tables: { ...live } };
  delete old.tables.crew_files;
  old.tables.crew = live.crew.map(({ passport_exp, sirb_no, sirb_exp, ...r }) => r);
  old.tables.jobs = live.jobs.map(({ oktb, ...r }) => r);
  const oldJson = join(dir, 'old.json'), oldSql = join(dir, 'old.sql');
  writeFileSync(oldJson, JSON.stringify(old));
  execFileSync('node', ['scripts/backup-to-sql.mjs', oldJson, oldSql], sh);
  execFileSync(WR, ['wrangler', 'd1', 'execute', 'cct', '--local', '--persist-to', db, '--file', oldSql], sh);
  const before = count(db);
  assert.deepEqual([before.u, before.c, before.k, before.a, before.s], [restored.u, restored.c, restored.k, restored.a, restored.s], 'a backup made before this version still restores');
  assert.deepEqual([before.f, before.x, before.o], [0, 0, 0]);
  rmSync(dir, { recursive: true, force: true });
});

test('password change signs out other sessions', async () => {
  const other = client();
  await other('POST', '/api/login', { username: 'wichai', password: 'field12345' });
  assert.equal((await field2('POST', '/api/me/password', { current: 'wrong', password: 'newpass123' })).status, 400);
  assert.equal((await field2('POST', '/api/me/password', { current: 'field12345', password: 'newpass123' })).status, 200);
  assert.equal((await other('GET', '/api/me')).status, 401);
  assert.equal((await field2('GET', '/api/me')).status, 200);
  const logout = await field2('POST', '/api/logout');
  assert.equal(logout.status, 200);
  assert.equal(logout.headers.get('clear-site-data'), '"cache"', 'clear legacy cached photos without deleting unsent storage');
  assert.equal((await field2('GET', '/api/me')).status, 401);
});
