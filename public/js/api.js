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

function blobs(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('cct-photos', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('blobs');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('blobs', mode), req = fn(tx.objectStore('blobs'));
      tx.oncomplete = () => { db.close(); resolve(req.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

const confirmBody = it => ({ idx: it.idx, at: it.at, lat: it.lat, lng: it.lng, sent_at: Date.now() });
function photoPath(it) {
  const q = new URLSearchParams({ point: it.point, at: it.at, sent_at: Date.now() });
  if (it.lat != null) { q.set('lat', it.lat); q.set('lng', it.lng); }
  return `/api/crew/${it.crew}/photos?${q}`;
}

export async function confirmPoint(crewId, idx, extra, uid) {
  const item = { uid, crew: crewId, idx, at: Date.now(), lat: extra.lat, lng: extra.lng, label: extra.label };
  try {
    return await api('POST', `/api/crew/${crewId}/confirm`, confirmBody(item));
  } catch (e) {
    if (keep(e.status)) {
      writeBox(readBox().concat(item));
      return { queued: true, at: item.at };
    }
    throw e;
  }
}

export async function uploadPhoto(crewId, blob, extra, uid) {
  const item = { uid, crew: crewId, photo: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, point: extra.point, lat: extra.lat, lng: extra.lng, at: Date.now(), label: extra.label };
  try {
    return await api('POST', photoPath(item), blob);
  } catch (e) {
    if (!keep(e.status)) throw e;
    try { await blobs('readwrite', s => s.put(blob, item.photo)); } catch (x) { throw e; }
    writeBox(readBox().concat(item));
    return { queued: true, at: item.at };
  }
}

async function send(it) {
  if (!it.photo) return api('POST', `/api/crew/${it.crew}/confirm`, confirmBody(it), { allow401: true });
  const blob = await blobs('readonly', s => s.get(it.photo)).catch(() => undefined);
  if (!blob) throw new ApiError(410, 'ไม่พบไฟล์รูปในเครื่องแล้ว');
  return api('POST', photoPath(it), blob, { allow401: true });
}

let flushing = false;
export async function flushOutbox(uid) {
  const out = { sent: 0, failed: [] };
  if (flushing || uid == null) return out;
  flushing = true;
  try {
    for (;;) {
      const it = readBox().find(x => x.uid === uid);
      if (!it) break;
      try {
        await send(it);
        out.sent++;
      } catch (e) {
        if (keep(e.status)) break;
        out.failed.push(`${it.photo ? 'รูป' : 'จุด'} ${it.label || 'ที่บันทึกไว้'} ส่งไม่สำเร็จ: ${e.message}`);
      }
      if (it.photo) await blobs('readwrite', s => s.delete(it.photo)).catch(() => {});
      writeBox(readBox().filter(x => !(x.uid === it.uid && x.crew === it.crew && x.idx === it.idx && x.at === it.at && x.photo === it.photo)));
    }
  } finally {
    flushing = false;
  }
  return out;
}
