// Owner-run account creation through the app's own API (same checks as the "เพิ่มผู้ใช้" screen).
//   node scripts/provision-users.mjs <roster.json> [--base https://...] [--dry-run]
// roster.json: { "rows": [ { employee_id, authoritative_display_name, requested_username, backend_role, see_all } ] }
// The admin signs in by typing their own password (hidden). For each new user the owner types the first password
// (hidden) or presses Enter to get a random one, shown once on this screen only. Nothing is written to disk.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import readline from 'node:readline';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--base');
const bi = args.indexOf('--base');
const BASE = (bi >= 0 ? args[bi + 1] : 'https://crew-change-tracker.hr-932.workers.dev').replace(/\/+$/, '');
const dry = args.includes('--dry-run');
if (!file) { console.error('ใช้: node scripts/provision-users.mjs <roster.json> [--base URL] [--dry-run]'); process.exit(1); }

const rows = JSON.parse(readFileSync(file, 'utf8')).rows;
const ROLES = { admin: 'admin', office: 'office', field: 'field', driver: 'field' };

let rl = null;
let muted = false;
const lines = [];
const waiting = [];
function ask(q, hidden) {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (s) => { if (!muted) write(s); };
    rl.on('line', (l) => { const w = waiting.shift(); if (w) w(l); else lines.push(l); });
  }
  process.stdout.write(q);
  muted = hidden;
  const done = (a) => { muted = false; if (hidden) process.stdout.write('\n'); return a; };
  if (lines.length) return Promise.resolve(done(lines.shift()));
  return new Promise((resolve) => waiting.push((l) => resolve(done(l))));
}


let cookie = '';
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'x-cct': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function randomPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(12)].map((b) => abc[b % abc.length]).join('');
}

// Everything runs inside main() and the process ends on its own: calling process.exit right after closing
// a piped stdin trips a libuv assertion on Windows.
async function main() {
  console.log(`ระบบ: ${BASE}${dry ? '  (ทดลอง ไม่สร้างจริง)' : ''}`);
  const adminUser = (await ask('ชื่อผู้ใช้ admin ของพี่: ', false)).trim();
  const adminPass = await ask('รหัสผ่าน admin (ไม่แสดงบนจอ): ', true);
  const li = await api('POST', '/api/login', { username: adminUser, password: adminPass });
  if (li.status !== 200) { console.error(`เข้าสู่ระบบไม่ได้: ${li.data.error || li.status}`); return (1); }
  if (li.data.user.role !== 'admin') { console.error('บัญชีนี้ไม่ใช่ผู้ดูแลระบบ'); return (1); }

  const existing = new Map(((await api('GET', '/api/users')).data.users || []).map((u) => [u.username.toLowerCase(), u]));
  const plan = rows.map((r) => ({
    emp: r.employee_id, name: r.authoritative_display_name, username: String(r.requested_username).trim().toLowerCase(),
    role: ROLES[r.backend_role || r.requested_role], see_all: Boolean(r.see_all),
  }));
  const bad = plan.filter((p) => !p.role || !p.name || !p.username);
  if (bad.length) { console.error('รายชื่อไม่ครบ: ' + bad.map((p) => p.emp).join(', ')); return (1); }
  // Someone who already has an account under a short name (vacharaporn) must be renamed, not given a second account.
  const twins = plan.filter((p) => !existing.has(p.username) && existing.has(p.username.split('@')[0]));
  if (twins.length) {
    console.error('คนเหล่านี้มีบัญชีเดิมชื่อสั้นอยู่แล้ว ให้เปลี่ยนชื่อบัญชีเดิมก่อน แล้วค่อยรันใหม่ (จะไม่สร้างบัญชีซ้ำให้):');
    for (const p of twins) console.error(`  node scripts/reset-password.mjs ${p.username.split('@')[0]} --rename-to ${p.username}`);
    return (1);
  }

  console.log('\nแผน:');
  for (const p of plan) console.log(`  ${existing.has(p.username) ? 'มีแล้ว ข้าม ' : 'จะสร้าง    '} ${p.emp}  ${p.username}  ${p.name}  สิทธิ์ ${p.role}`);
  const todo = plan.filter((p) => !existing.has(p.username));
  if (!todo.length || dry) { console.log(dry ? '\nโหมดทดลอง ไม่ได้สร้างบัญชี' : '\nไม่มีบัญชีใหม่ต้องสร้าง'); return (0); }
  if ((await ask(`\nสร้าง ${todo.length} บัญชี? พิมพ์ yes: `, false)).trim() !== 'yes') { console.log('ยกเลิก'); return (0); }

  const shown = [];
  let fail = 0;
  for (const p of todo) {
    let pw = await ask(`รหัสแรกของ ${p.username} (Enter = สุ่มให้): `, true);
    if (!pw) { pw = randomPassword(); shown.push([p.username, pw]); }
    const r = await api('POST', '/api/users', { username: p.username, name: p.name, role: p.role, see_all: p.see_all, emp_code: p.emp, password: pw });
    if (r.status === 200) console.log(`  สร้างแล้ว ${p.username}`);
    else { fail++; console.log(`  ไม่สำเร็จ ${p.username}: ${r.data.error || r.status}`); }
  }
  const after = new Set(((await api('GET', '/api/users')).data.users || []).map((u) => u.username.toLowerCase()));
  const missing = plan.filter((p) => !after.has(p.username)).map((p) => p.username);
  console.log(`\nตรวจซ้ำจากระบบ: มีครบ ${plan.length - missing.length}/${plan.length} บัญชี${missing.length ? ' ขาด: ' + missing.join(', ') : ''}`);
  if (shown.length) {
    console.log('\nรหัสที่สุ่มให้ (แสดงครั้งเดียว ส่งให้แต่ละคนทางแชตส่วนตัว และให้เปลี่ยนเองที่เมนูเปลี่ยนรหัสผ่าน):');
    for (const [u, pw] of shown) console.log(`  ${u}  ${pw}`);
  }
  await api('POST', '/api/logout');
  return fail || missing.length ? 1 : 0;
}

const code = await main();
if (rl) rl.close();
process.exitCode = code;
