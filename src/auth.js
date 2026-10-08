import { HttpError, b64, unb64, sha256, randomId, now } from './util.js';

const ITER = 100000;
const SESSION_DAYS = 60;
const MAX_FAILED = 8;
const LOCK_MS = 15 * 60000;
const DENIED = `ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (ใส่ผิด ${MAX_FAILED} ครั้งติดกัน บัญชีจะถูกล็อก ${LOCK_MS / 60000} นาที)`;
export const COOKIE = 'cct_s';

export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
  return { hash: b64(bits), salt: b64(salt) };
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function checkPasswordRules(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  if (pw.length > 128) throw new HttpError(400, 'รหัสผ่านยาวเกินไป');
}

function readCookie(req, name) {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

export function sessionCookie(token, secure) {
  const maxAge = token ? SESSION_DAYS * 86400 : 0;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export async function login(env, username, password) {
  const u = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(String(username || '').trim()).first();
  const t = now();
  if (!u || !u.active || u.locked_until > t) {
    await hashPassword(String(password || 'x'));
    throw new HttpError(401, DENIED);
  }
  const { hash } = await hashPassword(String(password || ''), u.pw_salt);
  if (!sameBytes(hash, u.pw_hash)) {
    const row = await env.DB.prepare('UPDATE users SET failed = failed + 1 WHERE id = ? RETURNING failed').bind(u.id).first();
    if (row.failed >= MAX_FAILED) await env.DB.prepare('UPDATE users SET failed = 0, locked_until = ? WHERE id = ?').bind(t + LOCK_MS, u.id).run();
    throw new HttpError(401, DENIED);
  }
  const token = randomId(32);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET failed = 0, locked_until = 0 WHERE id = ?').bind(u.id),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(await sha256(token), u.id, t + SESSION_DAYS * 86400000, t)
  ]);
  return { token, user: u };
}

export async function currentUser(req, env) {
  const token = readCookie(req, COOKIE);
  if (!token || token.length > 100) return null;
  const row = await env.DB.prepare(
    'SELECT u.*, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1'
  ).bind(await sha256(token), now()).first();
  return row || null;
}

export async function logout(req, env) {
  const token = readCookie(req, COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

export function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role, see_all: !!u.see_all, title: u.title, phone: u.phone, id_card: u.id_card, active: !!u.active };
}

export const isOffice = u => u && (u.role === 'admin' || u.role === 'office');
export const seesAllCrew = u => u && (u.role !== 'field' || !!u.see_all);

export function requireUser(u) {
  if (!u) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  return u;
}
export function requireOffice(u) {
  requireUser(u);
  if (!isOffice(u)) throw new HttpError(403, 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้');
  return u;
}
export function requireAdmin(u) {
  requireUser(u);
  if (u.role !== 'admin') throw new HttpError(403, 'เฉพาะผู้ดูแลระบบเท่านั้น');
  return u;
}
