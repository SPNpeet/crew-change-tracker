// Owner-run account recovery for the production database.
//   node scripts/reset-password.mjs list              show usernames, role, active, lock state (no passwords)
//   node scripts/reset-password.mjs <username>        set a new password for that user (typed hidden, twice)
// Add --local to work on the local dev database instead of production.
// The new password never touches disk: only its PBKDF2 hash goes into a temporary SQL file, deleted right after.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';
import { hashPassword } from '../src/auth.js';

const args = process.argv.slice(2);
const local = args.includes('--local');
const target = args.filter((a) => a !== '--local')[0];
const DB = 'cct';

function env() {
  const e = { ...process.env };
  if (existsSync('.env')) {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !e[m[1]]) e[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return e;
}

function d1(extra) {
  const bin = join('node_modules', 'wrangler', 'bin', 'wrangler.js');
  const r = spawnSync(process.execPath, [bin, 'd1', 'execute', DB, local ? '--local' : '--remote', '--json', ...extra], { env: env(), encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
  return JSON.parse(r.stdout)[0].results;
}

function sql(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// One reader with a line queue: a line that arrives before its question is asked is kept, not dropped.
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

const where = local ? 'ฐานข้อมูลในเครื่อง' : 'ฐานข้อมูล PRODUCTION ของลูกค้า';

if (!target || target === 'list') {
  const rows = d1(['--command', 'SELECT id, username, name, role, active, failed, locked_until FROM users ORDER BY id']);
  const t = Date.now();
  console.log(`บัญชีใน${where}:`);
  for (const r of rows) {
    const lock = r.locked_until > t ? `ล็อกอยู่อีก ${Math.ceil((r.locked_until - t) / 60000)} นาที` : 'ไม่ล็อก';
    console.log(`  ${r.username}  (${r.name})  สิทธิ์ ${r.role}  ${r.active ? 'ใช้งาน' : 'ปิดอยู่'}  ใส่ผิดสะสม ${r.failed}  ${lock}`);
  }
  process.exit(0);
}

const found = d1(['--command', `SELECT id, username, name, role, active FROM users WHERE username = ${sql(target)}`]);
if (!found.length) {
  console.error(`ไม่พบชื่อผู้ใช้ "${target}" ใน${where} ดูรายชื่อด้วย: node scripts/reset-password.mjs list${local ? ' --local' : ''}`);
  process.exit(1);
}
const u = found[0];
// Optional: --rename-to name@company.com changes the sign-in name in the same step (the app cannot rename users).
const ri = process.argv.indexOf('--rename-to');
const rename = ri > 0 ? String(process.argv[ri + 1] || '').trim().toLowerCase() : '';
if (ri > 0) {
  const okName = /^[a-z0-9._-]{3,40}$/.test(rename) || /^[a-z0-9._+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(rename);
  if (!okName) { console.error(`ชื่อใหม่ "${rename}" ใช้ไม่ได้ ต้องเป็น a-z 0-9 . _ - หรืออีเมล`); process.exit(1); }
  if (d1(['--command', `SELECT id FROM users WHERE username = ${sql(rename)} AND id <> ${Number(u.id)}`]).length) {
    console.error(`มีบัญชีชื่อ "${rename}" อยู่แล้ว ยังไม่ได้เปลี่ยนอะไร`); process.exit(1);
  }
  console.log(`จะเปลี่ยนชื่อเข้าสู่ระบบจาก ${u.username} เป็น ${rename}`);
}
console.log(`ตั้งรหัสผ่านใหม่ให้ ${u.username} (${u.name}, สิทธิ์ ${u.role}) ใน${where}`);
const p1 = await ask('รหัสผ่านใหม่ (อย่างน้อย 8 ตัว ไม่แสดงบนจอ): ', true);
const p2 = await ask('พิมพ์ซ้ำอีกครั้ง: ', true);
if (p1 !== p2) { console.error('สองครั้งไม่ตรงกัน ยังไม่ได้เปลี่ยนอะไร'); process.exit(1); }
if (p1.length < 8 || p1.length > 128) { console.error('รหัสผ่านต้องยาว 8 ถึง 128 ตัวอักษร ยังไม่ได้เปลี่ยนอะไร'); process.exit(1); }
const ok = await ask(`ยืนยันเปลี่ยนรหัสใน${where}? พิมพ์ yes: `, false);
rl.close();
if (ok.trim() !== 'yes') { console.log('ยกเลิก'); process.exit(0); }

const h = await hashPassword(p1);
const file = join(tmpdir(), `cct-reset-${process.pid}.sql`);
writeFileSync(file, [
  `UPDATE users SET ${rename ? `username = ${sql(rename)}, ` : ''}pw_hash = ${sql(h.hash)}, pw_salt = ${sql(h.salt)}, failed = 0, locked_until = 0, active = 1 WHERE id = ${Number(u.id)};`,
  `DELETE FROM sessions WHERE user_id = ${Number(u.id)};`,
].join('\n'));
try {
  d1(['--file', file, '--yes']);
} finally {
  unlinkSync(file);
}
console.log(`เปลี่ยนรหัสของ ${rename || u.username} แล้ว${rename ? ` (ชื่อเข้าสู่ระบบใหม่: ${rename})` : ''} ปลดล็อกบัญชีแล้ว และออกจากระบบทุกเครื่องของบัญชีนี้แล้ว เข้าสู่ระบบด้วยรหัสใหม่ได้เลย`);
