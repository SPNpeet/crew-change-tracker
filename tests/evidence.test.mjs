// Drivers, photo-required points, profile photos and the checkpoint template. Local only, synthetic fixtures.
// Every test builds its own job, so one test can be run alone with --test-name-pattern.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { png, sheetRows } from './gen.mjs';

const PORT = 8952, BASE = `http://127.0.0.1:${PORT}`, KEY = 'test-setup-key', PW = 'evidence-fixture-only';
const CRON_NOW = Date.UTC(2026, 9, 20, 19, 0), NIGHTLY = 'daily/2026-10-21.json.gz';
const wr = join(process.cwd(), 'node_modules/wrangler/bin/wrangler.js');
const persist = mkdtempSync(join(tmpdir(), 'cct-evidence-'));
const wrangler = (args, opts = {}) => execFileSync(process.execPath, [wr, ...args], { stdio: 'pipe', windowsHide: true, ...opts }).toString();
const sql = command => wrangler(['d1', 'execute', 'cct', '--local', '--persist-to', persist, '--command', command]);
let server;
const S = {};

function client() {
  let cookie = '';
  return async (method, path, body, extra = {}) => {
    const bytes = body instanceof Uint8Array;
    const headers = { 'x-cct': '1', cookie, ...extra.headers };
    if (body !== undefined && !bytes) headers['content-type'] = 'application/json';
    const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : bytes ? body : JSON.stringify(body) });
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, headers: r.headers, data: (r.headers.get('content-type') || '').includes('json') ? await r.json() : new Uint8Array(await r.arrayBuffer()) };
  };
}
const ok = r => { assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300)); return r.data; };
const admin = client(), office = client(), agent = client(), agent2 = client(), driverA = client(), driverB = client(), lead = client(), anon = client();
const raw = type => ({ headers: { 'content-type': type } });
const jpg = (...mid) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, ...mid, 0xff, 0xd9]);
const photo = (who, crewId, q, body = jpg(1, 2, 3)) => who('POST', `/api/crew/${crewId}/photos?${new URLSearchParams(q)}`, body, raw('image/jpeg'));
const view = async job => ok(await office('GET', `/api/jobs/${job}`));
const crewIn = async (job, id) => (await view(job)).crew.find(c => c.id === id);
const pad = n => String(n).padStart(2, '0');
const bkk = ms => { const d = new Date(ms + 7 * 3600000); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const table = (bytes, n) => { const [head, ...rows] = sheetRows(bytes, n); return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : r[i]]))); };

async function fixture(vessel, crew) {
  const job = ok(await office('POST', '/api/jobs', { vessel, port: 'Synthetic port', eta: Date.now() + 3600000 })).id;
  const ids = ok(await office('POST', `/api/jobs/${job}/crew`, { crew })).ids;
  return { job, ids };
}

async function nightly() {
  const t0 = Date.now();
  assert.equal((await fetch(`${BASE}/__scheduled?cron=${encodeURIComponent('0 19 * * *')}`)).status, 200);
  for (let i = 0; i < 40; i++) {
    const f = await admin('GET', '/api/backups/' + NIGHTLY);
    if (f.status === 200) { const dump = JSON.parse(gunzipSync(f.data).toString('utf8')); if (dump.created >= t0) return { dump, bytes: f.data }; }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('nightly backup was not written');
}

before(async () => {
  try { await fetch(BASE + '/api/health'); throw new Error('Port occupied'); } catch (e) { if (e.message === 'Port occupied') throw e; }
  wrangler(['d1', 'migrations', 'apply', 'cct', '--local', '--persist-to', persist]);
  server = spawn(process.execPath, [wr, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(PORT), '--persist-to', persist, '--var', 'SETUP_KEY:' + KEY, '--var', 'CRON_NOW:' + CRON_NOW, '--test-scheduled'], { stdio: 'ignore', windowsHide: true });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(BASE + '/api/health')).ok; } catch {} if (!up) await new Promise(r => setTimeout(r, 300)); }
  if (!up) throw new Error('Local startup timeout');
  ok(await admin('POST', '/api/setup', { key: KEY, username: 'feadmin', name: 'Synthetic Admin', password: PW }));
  S.admin = ok(await admin('GET', '/api/me')).user.id;
  for (const [key, c, username, name, role, more] of [
    ['office', office, 'feoffice', 'Synthetic Office', 'office'], ['agent', agent, 'feagent', 'Synthetic Agent One', 'field'], ['agent2', agent2, 'feagent2', 'Synthetic Agent Two', 'field'],
    ['driverA', driverA, 'fedrivera', 'Synthetic Driver A', 'field', { phone: '000-000-0001', id_card: 'SYNTH-ID-A' }], ['driverB', driverB, 'fedriverb', 'Synthetic Driver B', 'field'], ['lead', lead, 'felead', 'Synthetic Lead', 'field', { see_all: true }]
  ]) {
    S[key] = ok(await admin('POST', '/api/users', { username, name, role, password: PW, ...more })).id;
    ok(await c('POST', '/api/login', { username, password: PW }));
  }
});

after(() => {
  if (server) try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { server.kill('SIGTERM'); }
  try { rmSync(persist, { recursive: true, force: true }); } catch {}
});

test('FE01 template points have stable ids and photo flags, and new crew copy the flags', async () => {
  const a = ok(await admin('GET', '/api/me')).settings, b = ok(await office('GET', '/api/me')).settings;
  assert.deepEqual(a.cp_on.map(x => x.id), ['on1', 'on2', 'on3', 'on4', 'on5', 'on6', 'on7', 'on8']);
  assert.deepEqual(a.cp_off.map(x => x.id), ['off1', 'off2', 'off3', 'off4', 'off5', 'off6', 'off7']);
  assert.deepEqual([b.cp_on, b.cp_off], [a.cp_on, a.cp_off], 'two reads give the same ids');
  assert.deepEqual(a.cp_on.map(x => x.photo), [false, false, true, true, true, true, true, true]);
  assert.deepEqual(a.cp_off.map(x => x.photo), [true, true, true, true, true, true, false]);
  const { job, ids } = await fixture('TEST FE01', [{ name: 'Synthetic On', type: 'on', agent_id: S.agent }, { name: 'Synthetic Off', type: 'off', agent_id: S.agent }]);
  const full = await view(job);
  assert.deepEqual(full.crew.map(c => c.cps.map(x => x.need_photo).join('')), ['00111111', '1111110']);
  assert.deepEqual(full.crew[0].cps[0], { idx: 0, name: 'เครื่องลง', name_en: 'Landed', plan: null, actual: null, by: null, role: '', received: null, need_photo: 0, skip: '' });
  const mine = ok(await agent('GET', '/api/field')).crew.find(c => c.id === ids[0]);
  assert.deepEqual([mine.cps[1].need_photo, mine.cps[2].need_photo, mine.mine], [0, 1, 'agent'], 'the phone knows which points need a photo');
  ok(await office('PATCH', `/api/crew/${ids[0]}`, { type: 'off' }));
  assert.equal((await crewIn(job, ids[0])).cps.map(x => x.need_photo).join(''), '1111110', 'changing the type rebuilds the points with the flags of the other list');
  const pub = ok(await anon('GET', `/api/public/${full.job.owner_token}`));
  assert.deepEqual(Object.keys(pub.crew[0]).sort(), ['chain_end', 'cps', 'flight', 'id', 'name', 'rank', 'type']);
  assert.deepEqual(Object.keys(pub.crew[0].cps[0]).sort(), ['actual', 'idx', 'name', 'name_en', 'plan'], 'the Owner link is unchanged');
});

test('FE02 template edits keep ids on reorder, need a fresh precondition and never touch existing crew', async () => {
  const s0 = ok(await admin('GET', '/api/me')).settings;
  const pick = s => ({ cp_on: s.cp_on, cp_off: s.cp_off, cp_on_chain: s.cp_on_chain, cp_off_chain: s.cp_off_chain });
  const body = (s, change = {}) => ({ cp_on: s.cp_on, cp_off: s.cp_off, cp_on_chain_id: s.cp_on[s.cp_on_chain].id, cp_off_chain_id: s.cp_off[s.cp_off_chain].id, cp_expected: pick(s), ...change });
  const now = async () => ok(await admin('GET', '/api/me')).settings;
  const { job, ids } = await fixture('TEST FE02', [{ name: 'Synthetic Before On', type: 'on', agent_id: S.agent }, { name: 'Synthetic Before Off', type: 'off', agent_id: S.agent }]);
  ok(await office('PUT', `/api/crew/${ids[0]}/plan`, { plans: s0.cp_on.map((x, i) => Date.now() + i * 600000) }));
  ok(await agent('POST', `/api/crew/${ids[0]}/confirm`, { idx: 0 }));
  ok(await agent('POST', `/api/crew/${ids[0]}/confirm`, { idx: 1 }));
  const snap = async () => {
    const xlsx = (await office('GET', `/api/jobs/${job}/export.xlsx`)).data;
    return [(await view(job)).crew.map(c => [c.id, c.type, c.chain_end, c.cps.map(x => [x.idx, x.name, x.name_en, x.need_photo, x.plan, x.actual, x.by, x.role])]), sheetRows(xlsx, 2), sheetRows(xlsx, 3)];
  };
  const before = await snap();
  try {
    const { cp_expected, ...noPrecondition } = body(s0);
    assert.equal((await admin('PUT', '/api/settings', noPrecondition)).status, 428);
    assert.equal((await admin('PUT', '/api/settings', { cp_on: s0.cp_on.map(({ id, photo, ...x }) => x), cp_on_chain: 2 })).status, 428, 'a page from before this version must reload');
    for (const [why, bad] of [
      ['mixed with another setting', body(s0, { late_min: 20 })],
      ['photo flag is not true/false', body(s0, { cp_on: s0.cp_on.map((x, i) => i ? x : { ...x, photo: 'yes' }) })],
      ['photo flag is a number', body(s0, { cp_on: s0.cp_on.map((x, i) => i ? x : { ...x, photo: 1 }) })],
      ['malformed id', body(s0, { cp_on: s0.cp_on.map((x, i) => i ? x : { ...x, id: 'a b' }) })],
      ['duplicate ids', body(s0, { cp_on: s0.cp_on.map(x => ({ ...x, id: 'same' })) })],
      ['only one list', (({ cp_off, ...x }) => x)(body(s0))],
      ['unknown point chosen for the forecast shift', body(s0, { cp_on_chain_id: 'gone' })],
      ['no point chosen', (({ cp_off_chain_id, ...x }) => x)(body(s0))],
      ['fewer than two points', body(s0, { cp_off: s0.cp_off.slice(0, 1), cp_off_chain_id: 'off1' })],
      ['precondition is not an object', body(s0, { cp_expected: 'x' })]
    ]) assert.equal((await admin('PUT', '/api/settings', bad)).status, 400, why);
    assert.equal((await office('PUT', '/api/settings', body(s0))).status, 403);
    assert.equal((await agent('PUT', '/api/settings', body(s0))).status, 403);
    assert.deepEqual(pick(await now()), pick(s0), 'refused writes change nothing');

    const [on1, on2, on3, on4, on5, ...rest] = s0.cp_on;
    const edited = [{ ...on3, th: 'พบที่จุดนัด', photo: false }, on1, on2, on5, ...rest, { th: 'จุดใหม่', en: 'New point', gap: 12, photo: true }];
    const lost = await admin('PUT', '/api/settings', body(s0, { cp_on: edited, cp_on_chain_id: on4.id }));
    assert.equal(lost.status, 400, 'the chosen point was deleted');
    assert.ok(lost.data.error.includes('ไม่อยู่ในรายการแล้ว') && lost.data.error.includes('On signer'), lost.data.error);
    const saved = ok(await admin('PUT', '/api/settings', body(s0, { cp_on: edited, cp_on_chain_id: on5.id }))).settings;
    assert.deepEqual(saved.cp_on.slice(0, 7).map(x => x.id), ['on3', 'on1', 'on2', 'on5', 'on6', 'on7', 'on8'], 'ids follow the points, not the positions');
    assert.match(saved.cp_on[7].id, /^[A-Za-z0-9_-]{8}$/, 'a new point gets its own id');
    assert.deepEqual(saved.cp_on[0], { id: 'on3', th: 'พบที่จุดนัด', en: on3.en, gap: on3.gap, photo: false });
    for (const p of [on1, on2, on5, ...rest]) assert.deepEqual(saved.cp_on.find(x => x.id === p.id), p, 'name, minutes and photo flag stay with their point');
    assert.equal(saved.cp_on_chain, 3, 'the stored index is derived from the chosen id in the saved order');
    assert.deepEqual([saved.cp_off, saved.cp_off_chain], [s0.cp_off, s0.cp_off_chain]);

    const stale = await admin('PUT', '/api/settings', body(s0, { cp_on: s0.cp_on.slice(0, 3), cp_on_chain_id: 'on1' }));
    assert.equal(stale.status, 409, 'an editor who loaded the old list cannot overwrite the new one');
    assert.ok(stale.data.error.includes('มีผู้แก้จุดสถานะ'));
    assert.deepEqual(pick(await now()), pick(saved));
    const a = body(saved, { cp_on: saved.cp_on.map((x, i) => i === 1 ? { ...x, gap: 111 } : x) }), b = body(saved, { cp_on: saved.cp_on.map((x, i) => i === 2 ? { ...x, gap: 222 } : x) });
    const both = await Promise.all([admin('PUT', '/api/settings', a), admin('PUT', '/api/settings', b)]);
    assert.deepEqual(both.map(r => r.status).sort(), [200, 409], 'two admins saving at once: one wins, one is told');
    const after2 = await now();
    assert.deepEqual(after2.cp_on, (both[0].status === 200 ? a : b).cp_on);

    assert.deepEqual(await snap(), before, 'crew added before the edit keep names, order, photo flags, chain end, times and export rows');
    const later = await fixture('TEST FE02 AFTER', [{ name: 'Synthetic After', type: 'on' }]);
    const made = await crewIn(later.job, later.ids[0]);
    assert.deepEqual(made.cps.map(x => [x.name, x.need_photo]), after2.cp_on.map(x => [x.th, x.photo ? 1 : 0]));
    assert.equal(made.chain_end, 3);

    sql(`INSERT INTO settings (key, value) VALUES ('cp_off', '[{"th":"Legacy A","en":"Legacy A","gap":0},{"th":"Legacy B","en":"Legacy B","gap":5},{"th":"Legacy C","en":"Legacy C","gap":7}]') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    sql("INSERT INTO settings (key, value) VALUES ('cp_off_chain', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    const legacy = await now(), again = ok(await office('GET', '/api/me')).settings;
    assert.deepEqual(legacy.cp_off, [{ id: 'off1', th: 'Legacy A', en: 'Legacy A', gap: 0, photo: false }, { id: 'off2', th: 'Legacy B', en: 'Legacy B', gap: 5, photo: false }, { id: 'off3', th: 'Legacy C', en: 'Legacy C', gap: 7, photo: false }], 'a list saved before this version reads with ids by position and no photo flags');
    assert.deepEqual(again.cp_off, legacy.cp_off);
    const moved = ok(await admin('PUT', '/api/settings', body(legacy, { cp_off: [legacy.cp_off[2], legacy.cp_off[0], legacy.cp_off[1]], cp_off_chain_id: 'off2' }))).settings;
    assert.deepEqual([moved.cp_off.map(x => x.id), moved.cp_off_chain], [['off3', 'off1', 'off2'], 2]);
    assert.deepEqual(await snap(), before, 'later template edits and new crew change nothing for them either');
  } finally {
    const cur = await now();
    ok(await admin('PUT', '/api/settings', { cp_on: s0.cp_on, cp_off: s0.cp_off, cp_on_chain_id: s0.cp_on[s0.cp_on_chain].id, cp_off_chain_id: s0.cp_off[s0.cp_off_chain].id, cp_expected: pick(cur) }));
  }
  assert.deepEqual(pick(await now()), pick(s0));
});

test('FE03 driver access is the explicit assignment made when the office picks the vehicle', async () => {
  const van = ok(await office('POST', '/api/vehicles', { name: 'Synthetic van A', plate: 'TEST 1', driver: 'Synthetic Driver A', user_id: S.driverA })).id;
  for (const [why, user_id] of [['office account', S.office], ['admin account', S.admin], ['unknown account', 999999], ['not a number', 'x']]) assert.equal((await office('PATCH', `/api/vehicles/${van}`, { user_id })).status, 400, why);
  assert.equal((await driverA('PATCH', `/api/vehicles/${van}`, { user_id: S.driverA })).status, 403);
  assert.equal(ok(await office('GET', '/api/me')).vehicles.find(v => v.id === van).user_id, S.driverA);
  assert.ok(ok(await driverA('GET', '/api/me')).vehicles.every(v => !('user_id' in v) && !('driver_id' in v)), 'field staff are not told which accounts drive which vehicle');

  const { job, ids: [c1, c2, c3] } = await fixture('TEST FE03', [
    { name: 'Synthetic C1', type: 'on', agent_id: S.agent, passport: 'SYNTH-PASSPORT-1', passport_exp: '2031-01-01', sirb_no: 'SYNTH-SIRB-1', sirb_exp: '2030-01-01' },
    { name: 'Synthetic C2', type: 'on', agent_id: S.agent2, passport: 'SYNTH-PASSPORT-2' },
    { name: 'Synthetic C3', type: 'on', agent_id: S.agent2, passport: 'SYNTH-PASSPORT-3' }
  ]);
  const other = await fixture('TEST FE03 OTHER', [{ name: 'Synthetic Elsewhere', type: 'on', agent_id: S.agent2 }]);
  const list = async who => ok(await who('GET', '/api/field')).crew.filter(c => c.job_id === job).map(c => [c.id, c.mine]);
  assert.deepEqual(await list(driverA), [], 'linking the vehicle alone gives nothing');
  assert.equal((await driverA('POST', `/api/crew/${c1}/confirm`, { idx: 0 })).status, 403);
  ok(await office('PATCH', `/api/crew/${c1}`, { vehicle_id: van }));
  ok(await office('PATCH', `/api/crew/${c2}`, { vehicle_id: van }));
  let full = await view(job);
  assert.deepEqual(full.crew.map(c => c.driver_id), [S.driverA, S.driverA, null]);
  assert.ok(full.activity.some(a => a.text === 'Synthetic C1 · คนขับในมือถือ: Synthetic Driver A'));
  assert.deepEqual(await list(driverA), [[c1, 'driver'], [c2, 'driver']]);
  assert.deepEqual(await list(agent), [[c1, 'agent']]);
  assert.deepEqual(await list(driverB), []);

  const file = ok(await office('POST', `/api/crew/${c1}/files?kind=passport&name=synthetic.png`, png(8, 8), raw('image/png'))).id;
  const theirs = ok(await photo(agent2, c3, { point: 'x' })).id;
  const seen = [ok(await driverA('GET', '/api/field')), ok(await driverA('GET', `/api/jobs/${job}`))];
  assert.deepEqual(seen[1].crew.map(c => c.id), [c1, c2], 'the job view lists only assigned crew');
  for (const d of seen) {
    assert.ok(!/SYNTH-PASSPORT|SYNTH-SIRB|2031-01-01|synthetic\.png/.test(JSON.stringify(d)), 'no passport, seaman book or file data');
    for (const c of d.crew) for (const k of ['files', 'passport', 'passport_exp', 'sirb_no', 'sirb_exp']) assert.ok(!(k in c), k);
  }
  assert.deepEqual([seen[1].job.owner_token, seen[1].job.owner_email, seen[1].job.oktb, seen[1].activity.length], [undefined, undefined, undefined, 0]);

  assert.equal(ok(await driverA('POST', `/api/crew/${c2}/confirm`, { idx: 0 })).ok, true);
  ok(await driverA('POST', `/api/crew/${c2}/notes`, { text: 'synthetic driver note' }));
  const own = ok(await photo(driverA, c2, { point: 'เครื่องลง', cp_idx: 0 })).id;
  assert.equal((await driverA('GET', `/api/photos/${own}`)).status, 200);
  assert.equal((await agent('GET', `/api/photos/${own}`)).status, 403, 'another agent still cannot open it');
  const c2row = await crewIn(job, c2);
  assert.deepEqual([c2row.cps[0].by, c2row.cps[0].role], [S.driverA, 'driver']);
  ok(await driverA('POST', `/api/crew/${c2}/undo`, { idx: 0 }));
  assert.deepEqual([(await crewIn(job, c2)).cps[0].role, (await crewIn(job, c2)).cps[0].received], ['', null], 'undo clears who and when');

  for (const [what, method, path, body, extra, want] of [
    ['confirm', 'POST', `/api/crew/${c3}/confirm`, { idx: 0 }, {}, 403], ['undo', 'POST', `/api/crew/${c3}/undo`, {}, {}, 403], ['note', 'POST', `/api/crew/${c3}/notes`, { text: 'x' }, {}, 403],
    ['photo', 'POST', `/api/crew/${c3}/photos`, jpg(9), raw('image/jpeg'), 403], ['open photo', 'GET', `/api/photos/${theirs}`, undefined, {}, 403], ['delete photo', 'DELETE', `/api/photos/${theirs}`, undefined, {}, 403],
    ['edit crew', 'PATCH', `/api/crew/${c1}`, { room: '1' }, {}, 403], ['take a crew member', 'PATCH', `/api/crew/${c3}`, { driver_id: S.driverA }, {}, 403], ['plan', 'PUT', `/api/crew/${c1}/plan`, { plans: [] }, {}, 403], ['delete crew', 'DELETE', `/api/crew/${c1}`, undefined, {}, 403],
    ['upload document', 'POST', `/api/crew/${c1}/files?kind=passport&name=x.png`, png(4, 4), raw('image/png'), 403], ['open document', 'GET', `/api/files/${file}`, undefined, {}, 403], ['delete document', 'DELETE', `/api/files/${file}`, undefined, {}, 403],
    ['job export', 'GET', `/api/jobs/${job}/export.xlsx`, undefined, {}, 403], ['system export', 'GET', '/api/export/all.xlsx', undefined, {}, 403], ['backups', 'GET', '/api/backups', undefined, {}, 403],
    ['settings', 'PUT', '/api/settings', { late_min: 5 }, {}, 403], ['users', 'GET', '/api/users', undefined, {}, 403], ['jobs', 'GET', '/api/jobs', undefined, {}, 403], ['storage', 'GET', '/api/storage', undefined, {}, 403],
    ['brand image', 'GET', '/api/brand/letterhead', undefined, {}, 403], ['edit job', 'PATCH', `/api/jobs/${job}`, { remark: 'x' }, {}, 403], ['job without assignment', 'GET', `/api/jobs/${other.job}`, undefined, {}, 403],
    ['unknown crew', 'POST', '/api/crew/999999/confirm', { idx: 0 }, {}, 404]
  ]) {
    const r = await driverA(method, path, body, extra);
    assert.equal(r.status, want, what);
    assert.ok(r.data.error && !('length' in r.data), what + ' answers with an error, not data');
  }

  ok(await office('PATCH', `/api/vehicles/${van}`, { user_id: S.driverB }));
  assert.deepEqual((await view(job)).crew.map(c => c.driver_id), [S.driverA, S.driverA, null], 'relinking the vehicle changes nobody already assigned');
  assert.deepEqual(await list(driverA), [[c1, 'driver'], [c2, 'driver']]);
  assert.deepEqual(await list(driverB), []);
  assert.equal((await driverB('POST', `/api/crew/${c1}/confirm`, { idx: 0 })).status, 403);
  assert.equal((await driverB('GET', `/api/photos/${own}`)).status, 403);
  assert.equal((await driverB('GET', `/api/jobs/${job}`)).status, 403);
  assert.equal((await office('PATCH', `/api/crew/${c1}`, { driver_id: S.driverA + 1000 })).status, 400);
  assert.equal((await office('PATCH', `/api/crew/${c1}`, { driver_id: S.agent })).status, 400, 'only the account linked to the crew member\'s vehicle can be chosen');
  ok(await office('PATCH', `/api/crew/${c1}`, { vehicle_id: van }));
  assert.equal((await crewIn(job, c1)).driver_id, S.driverA, 'saving the same vehicle again is not a re-assignment');
  ok(await office('PATCH', `/api/crew/${c1}`, { driver_id: S.driverB }));
  assert.deepEqual(await list(driverB), [[c1, 'driver']]);
  assert.deepEqual(await list(driverA), [[c2, 'driver']]);
  assert.equal((await driverA('POST', `/api/crew/${c1}/confirm`, { idx: 0 })).status, 403, 'after the office switches the driver the old one is refused');
  assert.equal(ok(await driverB('POST', `/api/crew/${c1}/confirm`, { idx: 0 })).ok, true);
  ok(await office('PATCH', `/api/crew/${c3}`, { vehicle_id: van }));
  assert.equal((await crewIn(job, c3)).driver_id, S.driverB, 'a new assignment copies the account linked now');
  ok(await office('PATCH', `/api/crew/${c2}`, { vehicle_id: null }));
  assert.equal((await crewIn(job, c2)).driver_id, null);
  assert.equal((await driverA('POST', `/api/crew/${c2}/confirm`, { idx: 0 })).status, 403, 'removing the vehicle removes the driver');
  assert.equal((await driverA('GET', `/api/photos/${own}`)).status, 403);
  ok(await office('PATCH', `/api/vehicles/${van}`, { user_id: null }));
  assert.equal((await crewIn(job, c1)).driver_id, S.driverB, 'unlinking the vehicle changes nobody already assigned');
  ok(await office('PATCH', `/api/crew/${c1}`, { driver_id: null }));
  assert.deepEqual(await list(driverB), [[c3, 'driver']]);

  const van2 = ok(await office('POST', '/api/vehicles', { name: 'Synthetic van B', user_id: S.agent })).id;
  ok(await office('PATCH', `/api/crew/${c1}`, { vehicle_id: van2 }));
  assert.deepEqual(await list(agent), [[c1, 'both']]);
  ok(await agent('POST', `/api/crew/${c1}/confirm`, { idx: 1 }));
  ok(await lead('POST', `/api/crew/${c2}/confirm`, { idx: 0 }));
  ok(await office('POST', `/api/crew/${c2}/confirm`, { idx: 1 }));
  ok(await admin('POST', `/api/crew/${c3}/confirm`, { idx: 0 }));
  full = await view(job);
  assert.deepEqual([full.crew[0].cps[0].role, full.crew[0].cps[1].role, full.crew[1].cps[0].role, full.crew[1].cps[1].role, full.crew[2].cps[0].role], ['driver', 'agent', 'lead', 'office', 'admin'], 'the capacity of the confirmer is recorded at that moment');
  const log = table((await office('GET', `/api/jobs/${job}/export.xlsx`)).data, 3);
  assert.deepEqual(log.filter(r => r.Actual).map(r => [r.Name, r['Confirmed by'], r.Role]), [
    ['Synthetic C1', 'Synthetic Driver B', 'Driver'], ['Synthetic C1', 'Synthetic Agent One', 'Agent'], ['Synthetic C2', 'Synthetic Lead', 'Field lead'], ['Synthetic C2', 'Synthetic Office', 'Office'], ['Synthetic C3', 'Synthetic Admin', 'Admin']]);

  ok(await admin('PATCH', `/api/users/${S.driverB}`, { active: false }));
  try {
    assert.equal((await driverB('GET', '/api/field')).status, 401, 'a deactivated driver is signed out');
    assert.equal((await driverB('POST', `/api/crew/${c3}/confirm`, { idx: 1 })).status, 401);
    assert.equal((await office('PATCH', `/api/vehicles/${van}`, { user_id: S.driverB })).status, 400, 'a deactivated account cannot be linked');
    const van3 = ok(await office('POST', '/api/vehicles', { name: 'Synthetic van C' })).id;
    sql(`UPDATE vehicles SET user_id = ${S.driverB} WHERE id = ${van3}`);
    ok(await office('PATCH', `/api/crew/${c2}`, { vehicle_id: van3 }));
    assert.equal((await crewIn(job, c2)).driver_id, null, 'a vehicle whose account was closed assigns no driver');
  } finally {
    ok(await admin('PATCH', `/api/users/${S.driverB}`, { active: true }));
    ok(await driverB('POST', '/api/login', { username: 'fedriverb', password: PW }));
  }
  assert.deepEqual(await list(driverB), [[c3, 'driver']]);
  ok(await office('PATCH', `/api/jobs/${job}`, { status: 'closed' }));
  assert.deepEqual(await list(driverB), [], 'a closed job leaves the driver\'s list');
  assert.equal((await driverB('POST', `/api/crew/${c3}/confirm`, { idx: 1 })).status, 409);
  assert.equal((await driverB('POST', `/api/crew/${c3}/notes`, { text: 'x' })).status, 409);
  assert.equal((await photo(driverB, c3, { upload_id: 'closed-job-driver-0001', point: 'x' })).status, 409);
});

test('FE04 a photo-required point needs a photo or a reason, and its photo state is read from stored photos', async () => {
  const { job, ids: [c1] } = await fixture('TEST FE04', [{ name: 'Synthetic Photo Crew', type: 'on', agent_id: S.agent }]);
  const cps = async () => (await crewIn(job, c1)).cps;
  const confirm = (who, body) => who('POST', `/api/crew/${c1}/confirm`, body);
  ok(await confirm(agent, { idx: 0, at: Date.now() - 20 * 60000, sent_at: Date.now() }));
  ok(await confirm(agent, { idx: 1, at: Date.now() - 18 * 60000, sent_at: Date.now() }));
  assert.deepEqual((await cps()).slice(0, 2).map(x => [x.need_photo, x.skip, x.role]), [[0, '', 'agent'], [0, '', 'agent']], 'points without the flag behave as before');

  let r = await confirm(agent, { idx: 2 });
  assert.equal(r.status, 400);
  assert.ok(r.data.error.includes('ต้องถ่ายรูป'), r.data.error);
  for (const [why, body] of [['reason too short', { skip_reason: 'ab' }], ['reason only spaces', { skip_reason: '      ' }], ['reason too long', { skip_reason: 'x'.repeat(121) }], ['malformed upload id', { upload_id: 'short' }], ['empty reason', { skip_reason: '' }]]) assert.equal((await confirm(agent, { idx: 2, ...body })).status, 400, why);
  assert.equal((await confirm(agent2, { idx: 2, skip_reason: 'กล้องใช้ไม่ได้' })).status, 403, 'only people who may confirm the point may skip its photo');
  assert.equal((await confirm(anon, { idx: 2, skip_reason: 'กล้องใช้ไม่ได้' })).status, 401);
  assert.equal((await cps())[2].actual, null, 'nothing was confirmed by the refused calls');

  r = ok(await confirm(agent, { idx: 2, skip_reason: '  กล้องใช้ไม่ได้  ', at: Date.now() - 15 * 60000, sent_at: Date.now() }));
  let p = (await cps())[2];
  assert.deepEqual([p.skip, p.role, p.by, p.need_photo], ['กล้องใช้ไม่ได้', 'agent', S.agent, 1]);
  assert.ok(Math.abs(p.actual - (Date.now() - 15 * 60000)) < 5000 && Math.abs(p.received - Date.now()) < 5000, 'device time and server receipt time are both kept');
  let full = await view(job);
  assert.ok(full.activity.some(a => a.kind === 'cp' && a.text === 'Synthetic Photo Crew · พบ Meeting point · ยืนยันโดยไม่มีรูป: กล้องใช้ไม่ได้' && a.who === 'Synthetic Agent One'), 'the reason is in the activity log with the user');
  assert.equal(full.crew[0].photos.filter(x => x.cp_idx === 2).length, 0);
  const row = async () => table((await office('GET', `/api/jobs/${job}/export.xlsx`)).data, 3);
  let x = (await row())[2];
  assert.deepEqual([x['Photo required'], x.Photo, x['Photo status'], x['No-photo reason'], x.Role, x['Confirmed by']], ['Yes', 0, 'Pending', 'กล้องใช้ไม่ได้', 'Agent', 'Synthetic Agent One']);
  assert.equal(x['Received by system'], bkk(p.received), 'both times are listed when they are more than 2 minutes apart');
  ok(await confirm(agent, { idx: 3, upload_id: 'fe04-never-arrives-0001' }));
  assert.equal((await row())[3]['Received by system'], '', 'one time is listed when the confirmation arrived at once');

  for (const [why, q] of [['unknown point', { cp_idx: 99 }], ['negative point', { cp_idx: -1 }], ['point is not a number', { cp_idx: 'x' }], ['unknown location status', { gps: 'maybe' }], ['status ok without coordinates', { gps: 'ok' }], ['coordinates with a no-location status', { gps: 'denied', lat: 13, lng: 100 }], ['negative accuracy', { gps: 'ok', lat: 13, lng: 100, acc: -1 }], ['latitude out of range', { gps: 'ok', lat: 91, lng: 100 }], ['longitude out of range', { gps: 'ok', lat: 13, lng: 181 }]]) assert.equal((await photo(agent, c1, { point: 'x', ...q })).status, 400, why);
  const later = ok(await photo(agent, c1, { upload_id: 'fe04-later-photo-0001', point: 'พบ Meeting point', cp_idx: 2, lat: '13.089700', lng: '100.883200', acc: 12, gps: 'ok', at: Date.now() - 5 * 60000, sent_at: Date.now() })).id;
  full = await view(job);
  const stored = full.crew[0].photos.find(q => q.id === later);
  assert.deepEqual([stored.cp_idx, stored.lat, stored.lng, stored.acc, stored.gps, stored.by], [2, 13.0897, 100.8832, 12, 'ok', S.agent]);
  assert.ok(Math.abs(stored.at - (Date.now() - 5 * 60000)) < 5000 && Math.abs(stored.received - Date.now()) < 5000);
  assert.equal(full.crew[0].cps[2].skip, 'กล้องใช้ไม่ได้', 'the reason stays on record after a photo is added');
  x = (await row())[2];
  assert.deepEqual([x.Photo, x['Photo status'], x['No-photo reason']], [1, 'Attached', 'กล้องใช้ไม่ได้']);
  const denied = ok(await photo(agent, c1, { upload_id: 'fe04-denied-photo-0001', point: 'พบ Meeting point', cp_idx: 2, gps: 'denied' })).id;
  assert.deepEqual((({ lat, lng, acc, gps }) => [lat, lng, acc, gps])((await crewIn(job, c1)).photos.find(q => q.id === denied)), [null, null, null, 'denied']);

  p = (await cps())[3];
  assert.deepEqual([p.actual != null, p.skip], [true, '']);
  assert.equal((await crewIn(job, c1)).photos.filter(q => q.cp_idx === 3).length, 0, 'a promised upload that never arrives leaves the point without a photo');
  assert.equal((await row())[3]['Photo status'], 'Pending', 'the state comes from stored photos, not from the claim');
  ok(await photo(agent, c1, { upload_id: 'fe04-idx4-photo-00001', point: 'ถึงโรงแรม / เช็คอิน', cp_idx: 4 }));
  ok(await confirm(agent, { idx: 4, upload_id: 'fe04-idx4-photo-00001' }));
  assert.equal((await row())[4]['Photo status'], 'Attached');

  ok(await agent('POST', `/api/crew/${c1}/undo`, { idx: 4 }));
  assert.deepEqual((({ actual, skip, role, received }) => [actual, skip, role, received])((await cps())[4]), [null, '', '', null]);
  ok(await confirm(agent, { idx: 4 }));
  assert.equal((await cps())[4].actual != null, true, 'a point that already has a stored photo can be confirmed again without another one');
  ok(await agent('DELETE', `/api/photos/${later}`));
  ok(await agent('DELETE', `/api/photos/${denied}`));
  assert.equal((await row())[2]['Photo status'], 'Pending', 'removing the photo brings the pending state back; nothing else clears it');

  const all = table((await admin('GET', '/api/export/all.xlsx')).data, 3).filter(q => q.Name === 'Synthetic Photo Crew');
  assert.deepEqual(all.slice(0, 5).map(q => [q['Photo required'], q.Photo, q['Photo status'], q['No-photo reason'], q.Role]), [['No', 0, '', '', 'Agent'], ['No', 0, '', '', 'Agent'], ['Yes', 0, 'Pending', 'กล้องใช้ไม่ได้', 'Agent'], ['Yes', 0, 'Pending', '', 'Agent'], ['Yes', 1, 'Attached', '', 'Agent']]);
  const pub = ok(await anon('GET', `/api/public/${full.job.owner_token}`));
  assert.ok(!/กล้องใช้ไม่ได้|skip|photo|Synthetic Agent|13\.08|received|role/.test(JSON.stringify(pub)), 'the Owner link shows none of it');
});

test('FE05 retries and races leave one photo, one checkpoint event and one activity line', async () => {
  const { job, ids: [c1] } = await fixture('TEST FE05', [{ name: 'Synthetic Retry Crew', type: 'on', agent_id: S.agent }]);
  const van = ok(await office('POST', '/api/vehicles', { name: 'Synthetic retry van', user_id: S.driverA })).id;
  ok(await office('PATCH', `/api/crew/${c1}`, { vehicle_id: van }));
  const at = Date.now() - 60000;
  const q = { upload_id: 'fe05-queued-photo-00001', point: 'เครื่องลง', cp_idx: 0, at, lat: '13.100000', lng: '100.900000', acc: 8, gps: 'ok' };
  const first = ok(await photo(agent, c1, { ...q, sent_at: Date.now() }));
  const second = ok(await photo(agent, c1, { ...q, sent_at: Date.now() + 5000 }));
  const many = await Promise.all(Array.from({ length: 5 }, (_, i) => photo(agent, c1, { ...q, sent_at: Date.now() + i })));
  assert.deepEqual([second.id, second.duplicate, ...many.map(r => r.status), new Set(many.map(r => r.data.id)).size], [first.id, true, 200, 200, 200, 200, 200, 1]);
  assert.equal((await photo(agent, c1, { ...q, cp_idx: 1 })).status, 409, 'the same upload id cannot be reused for another point');
  assert.equal((await photo(agent, c1, { ...q, acc: 9 })).status, 409);

  const body = { idx: 0, at, lat: 13.1, lng: 100.9, upload_id: q.upload_id };
  const one = ok(await agent('POST', `/api/crew/${c1}/confirm`, { ...body, sent_at: Date.now() }));
  const again = ok(await agent('POST', `/api/crew/${c1}/confirm`, { ...body, sent_at: Date.now() + 3000 }));
  assert.deepEqual([again.duplicate, again.at], [true, one.at], 'a queued confirmation sent twice is acknowledged, not repeated');
  const reason = { idx: 1, skip_reason: 'synthetic race reason', at: Date.now() - 1000 };
  const race = await Promise.all([...Array.from({ length: 4 }, () => agent('POST', `/api/crew/${c1}/confirm`, { ...reason, sent_at: Date.now() })), ...Array.from({ length: 4 }, () => driverA('POST', `/api/crew/${c1}/confirm`, { ...reason, sent_at: Date.now() }))]);
  assert.ok(race.every(r => [200, 409].includes(r.status)), JSON.stringify(race.map(r => r.status)));
  assert.equal(race.filter(r => r.status === 200 && !r.data.duplicate).length, 1, 'exactly one of the racing confirmations wins');

  const full = await view(job);
  assert.equal(full.crew[0].photos.length, 1);
  assert.equal(full.activity.filter(a => a.kind === 'photo').length, 1);
  assert.deepEqual(full.activity.filter(a => a.kind === 'cp').map(a => a.text).sort(), ['Synthetic Retry Crew · ผ่าน ตม.', 'Synthetic Retry Crew · เครื่องลง'], 'one activity line per confirmed point');
  assert.ok(['agent', 'driver'].includes(full.crew[0].cps[1].role) && full.crew[0].cps[1].skip === '', 'a reason is stored only for photo-required points');

  const legacy = jpg(7, 7, 7), legacyAt = String(Date.now() - 30000);
  const a = ok(await photo(agent, c1, { point: 'legacy-outbox', at: legacyAt, lat: '13.2', lng: '100.8', sent_at: Date.now() }, legacy));
  const b = ok(await photo(agent, c1, { point: 'legacy-outbox', at: legacyAt, lat: '13.2', lng: '100.8', sent_at: Date.now() + 9000 }, legacy));
  assert.deepEqual([b.id, b.duplicate], [a.id, true], 'a photo queued by the previous version of the phone page still retries safely');
  const sha = s => createHash('sha256').update(s).digest('hex');
  const { dump } = await nightly();
  const rowOf = id => dump.tables.photos.find(r => r.id === id);
  assert.equal(rowOf(a.id).request_hash, sha(JSON.stringify([c1, 'image/jpeg', 'legacy-outbox', 13.2, 100.8, legacyAt, sha(legacy)])), 'requests without the new fields keep the request hash of the previous version');
  assert.deepEqual([rowOf(a.id).cp_idx, rowOf(a.id).gps, rowOf(first.id).cp_idx, rowOf(first.id).gps, rowOf(first.id).acc], [null, '', 0, 'ok', 8]);
  assert.equal(dump.tables.checkpoints.filter(r => r.crew_id === c1 && r.actual_at != null).length, 2);
});

test('FE06 profile photos: own photo only, checked content, no camera metadata, counted in storage', async () => {
  const exif = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0xff, 0xd9]);
  const exifAfterJfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xff, 0xd9]);
  const xmp = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x1f, ...new TextEncoder().encode('http://ns.adobe.com/xap/1.0/'), 0x00, 0xff, 0xd9]);
  const clean = png(40, 26), cleanJpg = jpg(0xff, 0xdb, 0x00, 0x04, 1, 2);
  const withChunk = (type, data) => { const out = new Uint8Array(clean.length + 12 + data.length), cut = clean.length - 12; out.set(clean.subarray(0, cut)); out.set([0, 0, 0, data.length, ...new TextEncoder().encode(type), ...data, 0, 0, 0, 0], cut); out.set(clean.subarray(cut), cut + 12 + data.length); return out; };
  const riff = (...chunks) => { const body = [...new TextEncoder().encode('WEBP'), ...chunks.flat()]; return new Uint8Array([...new TextEncoder().encode('RIFF'), body.length & 255, body.length >> 8, 0, 0, ...body]); };
  const chunk = (name, data) => [...new TextEncoder().encode(name), data.length, 0, 0, 0, ...data];
  const put = (who, body, type) => who('PUT', '/api/me/avatar', body, raw(type));
  const used = async () => ok(await office('GET', '/api/storage')).usedBytes;
  const u0 = await used();

  assert.equal((await agent('GET', `/api/avatar/${S.agent}`)).status, 404);
  assert.equal(ok(await agent('GET', '/api/me')).user.avatar_at, 0);
  for (const [why, body, type, want] of [
    ['JPEG with EXIF', exif, 'image/jpeg', 400], ['JPEG with EXIF after JFIF', exifAfterJfif, 'image/jpeg', 400], ['JPEG with XMP', xmp, 'image/jpeg', 400], ['PNG with eXIf', withChunk('eXIf', [0x4d, 0x4d, 0, 0x2a]), 'image/png', 400],
    ['WebP with EXIF', riff(chunk('VP8X', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), chunk('EXIF', [0x4d, 0x4d, 0, 0x2a])), 'image/webp', 400],
    ['text labelled as PNG', new TextEncoder().encode('not an image'), 'image/png', 400], ['empty file', new Uint8Array(0), 'image/png', 400],
    ['GIF', new TextEncoder().encode('GIF89a'), 'image/gif', 415], ['PDF', new TextEncoder().encode('%PDF-1.4'), 'application/pdf', 415], ['SVG', new TextEncoder().encode('<svg/>'), 'image/svg+xml', 415]
  ]) {
    const r = await put(agent, body, type);
    assert.equal(r.status, want, why);
    assert.ok(/[ก-๙]/.test(r.data.error), why + ' is explained in Thai');
  }
  assert.ok((await put(agent, exif, 'image/jpeg')).data.error.includes('ข้อมูลแฝง'));
  const big = new Uint8Array(1024 * 1024 + 1);
  big.set(clean.subarray(0, 8));
  assert.equal((await put(agent, big, 'image/png')).status, 413);
  assert.equal((await put(anon, clean, 'image/png')).status, 401);
  assert.deepEqual([(await agent('GET', `/api/avatar/${S.agent}`)).status, await used()], [404, u0], 'refused uploads store nothing');

  const first = ok(await put(agent, clean, 'image/png'));
  assert.ok(first.avatar_at > Date.now() - 10000);
  assert.equal(await used(), u0 + clean.length, 'profile photos count toward storage');
  for (const who of [agent, agent2, driverA, office, admin, lead]) {
    const r = await who('GET', `/api/avatar/${S.agent}`);
    assert.equal(r.status, 200);
    assert.deepEqual([...r.data], [...clean]);
    assert.deepEqual([r.headers.get('content-type'), r.headers.get('cache-control'), r.headers.get('x-content-type-options'), r.headers.get('content-security-policy')], ['image/png', 'private, max-age=300', 'nosniff', "default-src 'none'"]);
  }
  assert.equal((await anon('GET', `/api/avatar/${S.agent}`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/avatar/${S.agent}`)).status, 401, 'no session, no photo');
  assert.equal(ok(await agent('GET', '/api/me')).user.avatar_at, first.avatar_at);
  assert.equal(ok(await admin('GET', '/api/users')).users.find(u => u.id === S.agent).avatar_at, first.avatar_at);
  assert.ok(ok(await agent2('GET', '/api/me')).users.every(u => !('avatar_key' in u)), 'storage keys are never sent');

  for (const [method, path] of [['PUT', `/api/avatar/${S.agent}`], ['DELETE', `/api/avatar/${S.agent}`], ['PUT', `/api/users/${S.agent}/avatar`], ['DELETE', `/api/users/${S.agent}/avatar`]]) assert.equal((await admin(method, path, method === 'PUT' ? cleanJpg : undefined, method === 'PUT' ? raw('image/jpeg') : {})).status, 404, `${method} ${path}: nobody can write another person's photo`);
  ok(await admin('PATCH', `/api/users/${S.agent}`, { avatar_key: 'avatars/forged.jpg', avatar_at: 5, avatar_size: 7, title: 'Synthetic title' }));
  assert.equal(ok(await admin('GET', '/api/users')).users.find(u => u.id === S.agent).avatar_at, first.avatar_at, 'the admin user form cannot change a photo');
  assert.deepEqual([...(await office('GET', `/api/avatar/${S.agent}`)).data], [...clean]);
  for (const id of ['abc', '0', '999999', '1e3', `${S.agent}.jpg`]) assert.equal((await office('GET', `/api/avatar/${id}`)).status, 404, id);

  await new Promise(r => setTimeout(r, 5));
  const second = ok(await put(agent, cleanJpg, 'image/jpeg'));
  assert.ok(second.avatar_at > first.avatar_at);
  const got = await office('GET', `/api/avatar/${S.agent}`);
  assert.deepEqual([[...got.data], got.headers.get('content-type')], [[...cleanJpg], 'image/jpeg'], 'the new photo replaces the old one');
  assert.equal(await used(), u0 + cleanJpg.length, 'the replaced photo no longer counts');
  ok(await put(agent2, riff(chunk('VP8 ', [1, 2, 3, 4])), 'image/webp'));
  assert.equal((await agent('GET', `/api/avatar/${S.agent2}`)).headers.get('content-type'), 'image/webp');
  ok(await agent2('DELETE', '/api/me/avatar'));

  const { job } = await fixture('TEST FE06', [{ name: 'Synthetic Avatar Crew', type: 'on', agent_id: S.agent }]);
  const full = await view(job);
  const pub = ok(await anon('GET', `/api/public/${full.job.owner_token}`));
  assert.ok(!JSON.stringify(pub).includes('avatar'), 'the Owner link knows nothing about profile photos');
  const xlsx = (await office('GET', `/api/jobs/${job}/export.xlsx`)).data;
  assert.ok(!Buffer.from(xlsx).toString('utf8').includes('avatar'), 'profile photos are not in job exports');
  assert.deepEqual(table((await admin('GET', '/api/export/all.xlsx')).data, 5).filter(r => ['feagent', 'feagent2'].includes(r.Username)).map(r => [r.Username, r['Profile photo']]), [['feagent', 'Yes'], ['feagent2', 'No']]);

  sql(`UPDATE users SET avatar_size = ${10 * 1024 ** 3} WHERE id = ${S.lead}`);
  try {
    assert.equal(ok(await office('GET', '/api/storage')).level, 'full');
    const [c1] = full.crew.map(c => c.id);
    assert.equal((await photo(agent, c1, { upload_id: 'fe06-quota-photo-00001', point: 'x' })).status, 507, 'the quota for job photos includes profile photos');
    assert.equal((await office('POST', `/api/crew/${c1}/files?kind=other&name=x.png`, clean, raw('image/png'))).status, 507);
    assert.equal((await put(agent2, clean, 'image/png')).status, 507, 'a profile photo cannot be added beyond the quota');
  } finally { sql(`UPDATE users SET avatar_size = 0 WHERE id = ${S.lead}`); }

  ok(await admin('PATCH', `/api/users/${S.agent}`, { active: false }));
  try { assert.equal((await office('GET', `/api/avatar/${S.agent}`)).status, 200, 'closing an account keeps its photo'); }
  finally { ok(await admin('PATCH', `/api/users/${S.agent}`, { active: true })); ok(await agent('POST', '/api/login', { username: 'feagent', password: PW })); }
  assert.equal((await anon('DELETE', '/api/me/avatar')).status, 401);
  assert.equal(ok(await agent('DELETE', '/api/me/avatar')).avatar_at, 0);
  assert.equal((await office('GET', `/api/avatar/${S.agent}`)).status, 404);
  assert.deepEqual([ok(await agent('GET', '/api/me')).user.avatar_at, await used()], [0, u0], 'deleting clears the time and the size');
  const { dump } = await nightly();
  assert.deepEqual((({ avatar_key, avatar_at, avatar_size }) => [avatar_key, avatar_at, avatar_size])(dump.tables.users.find(u => u.id === S.agent)), ['', 0, 0]);
});

test('FE07 connected flow: office view, Owner link, both Excel files and the nightly dump agree', async () => {
  const flowAgent = client(), flowDriver = client();
  const agentId = ok(await admin('POST', '/api/users', { username: 'flowagent', name: 'Synthetic Flow Agent', role: 'field', password: PW })).id;
  const driverId = ok(await admin('POST', '/api/users', { username: 'flowdriver', name: 'Synthetic Flow Driver', role: 'field', password: PW })).id;
  ok(await flowAgent('POST', '/api/login', { username: 'flowagent', password: PW }));
  ok(await flowDriver('POST', '/api/login', { username: 'flowdriver', password: PW }));
  assert.equal((await flowAgent('POST', '/api/vehicles', { name: 'x', user_id: driverId })).status, 403);
  const van = ok(await admin('POST', '/api/vehicles', { name: 'Synthetic flow van', plate: 'TEST 77', driver: 'Synthetic Flow Driver', user_id: driverId })).id;
  const job = ok(await office('POST', '/api/jobs', { vessel: 'TEST FLOW VESSEL', port: 'Synthetic port', eta: Date.now() + 3600000 })).id;
  const crewId = ok(await office('POST', `/api/jobs/${job}/crew`, { crew: [{ name: 'Synthetic Flow Crew', rank: 'AB', type: 'on', passport: 'SYNTH-FLOW-PASSPORT' }] })).ids[0];
  const send = (who, body) => who('POST', `/api/crew/${crewId}/confirm`, { ...body, sent_at: Date.now() });
  assert.deepEqual(ok(await flowDriver('GET', '/api/field')).crew, [], 'nothing is visible before the office assigns');
  assert.equal((await send(flowDriver, { idx: 0 })).status, 403);
  assert.equal((await flowAgent('PATCH', `/api/crew/${crewId}`, { vehicle_id: van })).status, 403);
  ok(await office('PATCH', `/api/crew/${crewId}`, { agent_id: agentId, vehicle_id: van }));
  const t0 = Date.now() - 40 * 60000;
  ok(await office('PUT', `/api/crew/${crewId}/plan`, { plans: [0, 5, 10, 15, 20, 600, 660, 690].map(m => t0 + m * 60000) }));

  ok(await send(flowAgent, { idx: 0, at: t0 + 1 * 60000 }));
  ok(await send(flowAgent, { idx: 1, at: t0 + 6 * 60000 }));
  assert.equal((await send(flowDriver, { idx: 2, at: t0 + 12 * 60000 })).status, 400, 'the photo-required point is refused without a photo or reason');
  const shot = t0 + 12 * 60000, uploadId = 'fe07-driver-photo-000001';
  ok(await photo(flowDriver, crewId, { upload_id: uploadId, point: 'พบ Meeting point', cp_idx: 2, at: shot, sent_at: Date.now(), lat: '13.089700', lng: '100.883200', acc: 9, gps: 'ok' }));
  ok(await send(flowDriver, { idx: 2, at: shot, upload_id: uploadId, lat: 13.0897, lng: 100.8832 }));
  ok(await send(flowAgent, { idx: 3, at: t0 + 18 * 60000, skip_reason: 'พื้นที่ห้ามถ่ายรูป' }));
  assert.equal((await send(agent2, { idx: 4, skip_reason: 'synthetic outsider' })).status, 403);
  assert.equal((await send(anon, { idx: 4, skip_reason: 'synthetic outsider' })).status, 401);
  assert.equal((await flowDriver('GET', `/api/jobs/${job}/export.xlsx`)).status, 403);
  const race = await Promise.all([send(flowAgent, { idx: 4, at: Date.now() - 2000, skip_reason: 'ลูกเรือไม่สะดวก' }), send(flowDriver, { idx: 4, at: Date.now() - 1000, skip_reason: 'ลูกเรือไม่สะดวก' })]);
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409], 'two people confirming the same point: one event');

  const full = await view(job), c = full.crew[0], winner = race[0].status === 200 ? ['Synthetic Flow Agent', 'agent', 'Agent'] : ['Synthetic Flow Driver', 'driver', 'Driver'];
  const times = c.cps.map(x => x.actual);
  assert.deepEqual(times.map(t => t != null), [true, true, true, true, true, false, false, false]);
  assert.ok(Math.abs(times[2] - shot) < 5000, 'the point taken with a photo carries the capture time');
  assert.ok(Math.abs(c.photos[0].at - times[2]) < 5000, 'photo and checkpoint show the same moment');
  assert.deepEqual(c.cps.slice(0, 5).map(x => x.role), ['agent', 'agent', 'driver', 'agent', winner[1]]);
  assert.deepEqual(c.cps.slice(0, 5).map(x => x.skip), ['', '', '', 'พื้นที่ห้ามถ่ายรูป', 'ลูกเรือไม่สะดวก']);
  assert.deepEqual(c.cps.slice(0, 5).map(x => c.photos.filter(p => p.cp_idx === x.idx).length), [0, 0, 1, 0, 0]);
  assert.deepEqual([c.driver_id, c.agent_id], [driverId, agentId]);
  assert.equal(full.activity.filter(a => a.kind === 'cp').length, 5, 'five confirmed points, five events');

  const pub = ok(await anon('GET', `/api/public/${full.job.owner_token}`));
  assert.deepEqual(pub.crew[0].cps.map(x => x.actual), times, 'the Owner link shows the same times');
  assert.ok(!/Synthetic Flow Agent|Synthetic Flow Driver|ห้ามถ่ายรูป|ไม่สะดวก|skip|photo|13\.08|100\.88|"lat"|role|received|SYNTH-FLOW-PASSPORT|driver/.test(JSON.stringify(pub)), 'and no staff names, photos, coordinates or reasons');

  const names = ['Synthetic Flow Agent', 'Synthetic Flow Agent', 'Synthetic Flow Driver', 'Synthetic Flow Agent', winner[0]], roles = ['Agent', 'Agent', 'Driver', 'Agent', winner[2]];
  const want = k => k < 5 ? [bkk(times[k]), names[k], roles[k], k < 2 ? 'No' : 'Yes', k === 2 ? 1 : 0, k < 2 ? '' : k === 2 ? 'Attached' : 'Pending', c.cps[k].skip] : ['', '', '', 'Yes', 0, '', ''];
  const jobLog = table((await office('GET', `/api/jobs/${job}/export.xlsx`)).data, 3);
  assert.deepEqual(jobLog.map(r => [r.Actual, r['Confirmed by'], r.Role, r['Photo required'], r.Photo, r['Photo status'], r['No-photo reason']]), [0, 1, 2, 3, 4, 5, 6, 7].map(want), 'job Excel');
  assert.equal(jobLog[0]['Received by system'], bkk(c.cps[0].received), 'the first point was sent 39 minutes after it happened');
  assert.equal(jobLog[4]['Received by system'], '', 'a point sent at once lists one time');
  const allLog = table((await admin('GET', '/api/export/all.xlsx')).data, 3).filter(r => r.Name === 'Synthetic Flow Crew');
  assert.deepEqual(allLog.map(r => [r.Actual, r.By, r.Role, r['Photo required'], r.Photo, r['Photo status'], r['No-photo reason']]), [0, 1, 2, 3, 4, 5, 6, 7].map(want), 'whole-system Excel');
  assert.deepEqual(table((await admin('GET', '/api/export/all.xlsx')).data, 6).filter(r => r.Name === 'Synthetic flow van').map(r => r['Driver account']), ['Synthetic Flow Driver']);
  assert.deepEqual(table((await admin('GET', '/api/export/all.xlsx')).data, 2).filter(r => r.Name === 'Synthetic Flow Crew').map(r => [r['Boarding agent'], r['Driver account']]), [['Synthetic Flow Agent', 'Synthetic Flow Driver']]);

  const { dump } = await nightly();
  const rows = dump.tables.checkpoints.filter(r => r.crew_id === crewId).sort((a, b) => a.idx - b.idx);
  assert.deepEqual(rows.map(r => r.actual_at), times, 'nightly dump: times');
  assert.deepEqual(rows.slice(0, 5).map(r => [r.actual_by, r.actual_role, r.photo_skip, r.need_photo]), c.cps.slice(0, 5).map(x => [x.by, x.role, x.skip, x.need_photo]), 'nightly dump: confirmer, capacity, reason, flag');
  assert.ok(rows.slice(0, 5).every(r => r.received_at >= r.actual_at) && rows.slice(5).every(r => r.received_at === null));
  const shots = dump.tables.photos.filter(r => r.crew_id === crewId);
  assert.deepEqual(shots.map(r => [r.cp_idx, r.gps, r.acc, r.lat, r.lng, r.user_id, r.upload_id]), [[2, 'ok', 9, 13.0897, 100.8832, driverId, uploadId]], 'nightly dump: the photo and its point');
  assert.ok(shots[0].received_at >= shots[0].at);
  assert.deepEqual([dump.tables.vehicles.find(v => v.id === van).user_id, dump.tables.crew.find(r => r.id === crewId).driver_id], [driverId, driverId]);
});

test('FE08 the nightly dump with the new columns restores into an empty database, and an older dump still restores', async () => {
  const { job, ids: [c1] } = await fixture('TEST FE08', [{ name: 'Synthetic Restore Crew', type: 'on', agent_id: S.agent }]);
  const van = ok(await office('POST', '/api/vehicles', { name: 'Synthetic restore van', user_id: S.driverA })).id;
  ok(await office('PATCH', `/api/crew/${c1}`, { vehicle_id: van }));
  ok(await agent('POST', `/api/crew/${c1}/confirm`, { idx: 0 }));
  ok(await agent('POST', `/api/crew/${c1}/confirm`, { idx: 1 }));
  ok(await photo(driverA, c1, { upload_id: 'fe08-restore-photo-0001', point: 'พบ Meeting point', cp_idx: 2, lat: '13.1', lng: '100.9', acc: 15, gps: 'ok' }));
  ok(await driverA('POST', `/api/crew/${c1}/confirm`, { idx: 2, upload_id: 'fe08-restore-photo-0001' }));
  ok(await agent('POST', `/api/crew/${c1}/confirm`, { idx: 3, skip_reason: 'synthetic restore reason' }));
  ok(await driverA('PUT', '/api/me/avatar', png(12, 12), raw('image/png')));
  const { dump, bytes } = await nightly(), live = dump.tables;
  for (const [t, cols] of [['users', ['avatar_key', 'avatar_at', 'avatar_size']], ['vehicles', ['user_id']], ['crew', ['driver_id']], ['checkpoints', ['need_photo', 'photo_skip', 'actual_role', 'received_at']], ['photos', ['cp_idx', 'acc', 'gps', 'received_at']]]) for (const col of cols) assert.ok(live[t].length && live[t].every(r => col in r), `${t}.${col} is in the dump`);
  assert.ok(live.users.some(u => u.avatar_key.startsWith('avatars/') && u.avatar_at > 0 && u.avatar_size > 0));

  const dir = mkdtempSync(join(tmpdir(), 'cct-evidence-restore-')), db = join(dir, 'db');
  const count = () => { const out = wrangler(['d1', 'execute', 'cct', '--local', '--persist-to', db, '--json', '--command', "SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM users WHERE avatar_at > 0 AND avatar_size > 0 AND LENGTH(avatar_key) > 0) av, (SELECT COUNT(*) FROM vehicles WHERE user_id IS NOT NULL) vd, (SELECT COUNT(*) FROM crew WHERE driver_id IS NOT NULL) cd, (SELECT COALESCE(SUM(need_photo), 0) FROM checkpoints) np, (SELECT COUNT(*) FROM checkpoints WHERE LENGTH(photo_skip) > 0) sk, (SELECT COUNT(*) FROM checkpoints WHERE LENGTH(actual_role) > 0) ro, (SELECT COALESCE(SUM(received_at), 0) FROM checkpoints) rc, (SELECT COUNT(*) FROM photos WHERE cp_idx IS NOT NULL) pc, (SELECT COUNT(*) FROM photos WHERE gps = 'ok' AND acc IS NOT NULL) pg, (SELECT COUNT(*) FROM checkpoints) k, (SELECT COALESCE(SUM(actual_at), 0) FROM checkpoints) s"]); return JSON.parse(out.slice(out.indexOf('[')))[0].results[0]; };
  try {
    const gz = join(dir, 'b.json.gz'), restore = join(dir, 'r.sql');
    writeFileSync(gz, bytes);
    execFileSync(process.execPath, ['scripts/backup-to-sql.mjs', gz, restore], { stdio: 'pipe', windowsHide: true });
    wrangler(['d1', 'migrations', 'apply', 'cct', '--local', '--persist-to', db], { input: 'y\n' });
    wrangler(['d1', 'execute', 'cct', '--local', '--persist-to', db, '--file', restore]);
    const sum = (rows, f) => rows.reduce((a, r) => a + (f(r) || 0), 0);
    const expected = { u: live.users.length, av: live.users.filter(u => u.avatar_at > 0).length, vd: live.vehicles.filter(v => v.user_id != null).length, cd: live.crew.filter(r => r.driver_id != null).length, np: sum(live.checkpoints, r => r.need_photo), sk: live.checkpoints.filter(r => r.photo_skip).length, ro: live.checkpoints.filter(r => r.actual_role).length, rc: sum(live.checkpoints, r => r.received_at), pc: live.photos.filter(r => r.cp_idx != null).length, pg: live.photos.filter(r => r.gps === 'ok' && r.acc != null).length, k: live.checkpoints.length, s: sum(live.checkpoints, r => r.actual_at) };
    assert.deepEqual(count(), expected, 'every new column comes back with the same values');
    assert.ok(expected.av >= 1 && expected.vd >= 1 && expected.cd >= 1 && expected.np >= 6 && expected.sk >= 1 && expected.ro >= 4 && expected.pc >= 1 && expected.pg >= 1, JSON.stringify(expected));

    const strip = (rows, cols) => rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !cols.includes(k))));
    const old = { format: 'cct-backup', version: 1, created: Date.now(), tables: { ...live, users: strip(live.users, ['avatar_key', 'avatar_at', 'avatar_size']), vehicles: strip(live.vehicles, ['user_id']), crew: strip(live.crew, ['driver_id']), checkpoints: strip(live.checkpoints, ['need_photo', 'photo_skip', 'actual_role', 'received_at']), photos: strip(live.photos, ['cp_idx', 'acc', 'gps', 'received_at']) } };
    const oldJson = join(dir, 'old.json'), oldSql = join(dir, 'old.sql');
    writeFileSync(oldJson, JSON.stringify(old));
    execFileSync(process.execPath, ['scripts/backup-to-sql.mjs', oldJson, oldSql], { stdio: 'pipe', windowsHide: true });
    wrangler(['d1', 'execute', 'cct', '--local', '--persist-to', db, '--file', oldSql]);
    assert.deepEqual(count(), { ...expected, av: 0, vd: 0, cd: 0, np: 0, sk: 0, ro: 0, rc: 0, pc: 0, pg: 0 }, 'a dump made before this version restores with the new columns at their defaults');
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
  ok(await driverA('DELETE', '/api/me/avatar'));
  assert.ok(job > 0);
});
