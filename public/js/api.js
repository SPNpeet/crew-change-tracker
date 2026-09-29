export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(method, path, body, opts = {}) {
  const headers = { 'x-cct': '1' };
  let payload = body;
  if (body !== undefined && !(body instanceof Blob)) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (body instanceof Blob) headers['content-type'] = body.type || 'image/jpeg';
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', signal: opts.signal });
  } catch (e) {
    throw new ApiError(0, 'ไม่มีสัญญาณอินเทอร์เน็ต กรุณาลองใหม่');
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    if (res.status === 401 && !opts.allow401) window.dispatchEvent(new CustomEvent('cct-logout'));
    throw new ApiError(res.status, (data && data.error) || 'ระบบขัดข้อง กรุณาลองใหม่');
  }
  return data;
}

const OUTBOX = 'cct-outbox-v1';
function readBox() { try { return JSON.parse(localStorage.getItem(OUTBOX) || '[]'); } catch (e) { return []; } }
function writeBox(list) { try { localStorage.setItem(OUTBOX, JSON.stringify(list)); } catch (e) {} }
export const pendingCount = uid => readBox().filter(x => x.uid === uid).length;
export const pendingFor = (crewId, uid) => readBox().filter(x => x.crew === crewId && x.uid === uid);
const keep = status => status === 0 || status === 401 || status === 429 || status >= 500;

export async function confirmPoint(crewId, idx, extra, uid) {
  const item = { uid, crew: crewId, idx, at: Date.now(), lat: extra.lat, lng: extra.lng };
  try {
    return await api('POST', `/api/crew/${crewId}/confirm`, { ...item, sent_at: Date.now() });
  } catch (e) {
    if (keep(e.status)) {
      writeBox(readBox().concat(item));
      return { queued: true, at: item.at };
    }
    throw e;
  }
}

let flushing = false;
export async function flushOutbox(uid) {
  if (flushing || uid == null) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (;;) {
      const it = readBox().find(x => x.uid === uid);
      if (!it) break;
      try {
        await api('POST', `/api/crew/${it.crew}/confirm`, { ...it, sent_at: Date.now() }, { allow401: true });
        sent++;
      } catch (e) {
        if (keep(e.status)) break;
      }
      writeBox(readBox().filter(x => x !== it && !(x.uid === it.uid && x.crew === it.crew && x.idx === it.idx && x.at === it.at)));
    }
  } finally {
    flushing = false;
  }
  return sent;
}
