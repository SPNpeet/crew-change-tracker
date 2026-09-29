export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const now = () => Date.now();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

export async function readJson(req, max = 256 * 1024) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > max) throw new HttpError(413, 'ข้อมูลใหญ่เกินไป');
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'ข้อมูลใหญ่เกินไป');
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object') return v;
  } catch (e) {}
  throw new HttpError(400, 'รูปแบบข้อมูลไม่ถูกต้อง');
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function randomId(len = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (const b of bytes) out += B64URL[b & 63];
  return out;
}

export function b64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

export function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function str(v, max = 200) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

export function text(v, max = 4000) {
  if (v == null) return '';
  return String(v).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

export function ms(v) {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 946684800000 || n > 4102444800000) throw new HttpError(400, 'วันเวลาไม่ถูกต้อง');
  return Math.round(n);
}

export function intOrNull(v) {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'ค่าที่เลือกไม่ถูกต้อง');
  return n;
}

export function parseJson(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

const TZ = 7 * 3600000;
const pad = n => String(n).padStart(2, '0');
export function bkk(msv, withYear = true) {
  if (msv == null) return '';
  const d = new Date(msv + TZ);
  const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}${withYear ? '/' + d.getUTCFullYear() : ''}`;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
export function bkkParts(msv) {
  const d = new Date(msv + TZ);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours() };
}
