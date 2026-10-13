export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(method, path, body, opts = {}) {
  const headers = { 'x-cct': '1' };
  if (opts.userId != null) headers['x-cct-user'] = String(opts.userId);
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

export async function apiBytes(path) {
  let res;
  try {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  } catch (e) {
    throw new ApiError(0, 'ไม่มีสัญญาณอินเทอร์เน็ต กรุณาลองใหม่');
  }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('cct-logout'));
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error || 'ระบบขัดข้อง กรุณาลองใหม่');
  }
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime: (res.headers.get('content-type') || '').split(';')[0].trim() };
}

const OUTBOX = 'cct-outbox-v1';
export const LOGOUT_EVENT = 'cct-signed-out';
function readBox() {
  try { const v = JSON.parse(localStorage.getItem(OUTBOX) || '[]'); if (Array.isArray(v)) return v; } catch (e) {}
  throw new ApiError(0, 'อ่านงานที่เก็บไว้ในเครื่องไม่ได้ กรุณาอย่าล้างข้อมูลเบราว์เซอร์และติดต่อผู้ดูแล');
}
function writeBox(list) {
  try { localStorage.setItem(OUTBOX, JSON.stringify(list)); }
  catch (e) { throw new ApiError(0, 'บันทึกงานลงเครื่องไม่ได้ กรุณาเก็บรูปต้นฉบับไว้และลองใหม่เมื่อมีอินเทอร์เน็ต'); }
}
export const pendingCount = uid => readBox().filter(x => x.uid === uid).length;
export const pendingFor = (crewId, uid) => readBox().filter(x => x.crew === crewId && x.uid === uid);
export const pendingItems = uid => readBox().filter(x => x.uid === uid);
export const otherPendingCount = uid => readBox().filter(x => x.uid !== uid).length;
export const itemKey = it => it.photo || `${it.uid}:${it.crew}:${it.idx}:${it.at}`;
const keep = status => status === 0 || status === 401 || status === 429 || status >= 500;

// One device queue operation at a time, including other tabs where Web Locks is supported.
let serial = Promise.resolve();
function deviceTask(fn) {
  const run = () => navigator.locks ? navigator.locks.request('cct-device-work', fn) : fn();
  const result = serial.then(run);
  serial = result.catch(() => {});
  return result;
}
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
const confirmBody = it => ({ assignment_revision: it.assignment_revision, cp_id: it.cp_id, idx: it.idx, at: it.at, lat: it.lat, lng: it.lng, sent_at: Date.now(), ...(it.upload ? { upload_id: it.upload } : {}), ...(it.skip ? { skip_reason: it.skip } : {}) });
function photoPath(it) {
  const q = new URLSearchParams({ upload_id: it.photo, point: it.point, at: it.at, sent_at: Date.now() });
  if (it.lat != null) { q.set('lat', it.lat); q.set('lng', it.lng); }
  if (it.cp != null) q.set('cp_idx', it.cp);
  if (it.assignment_revision != null) q.set('assignment_revision',it.assignment_revision);
  if (it.cp_id != null) q.set('cp_id', it.cp_id);
  if (it.acc != null) q.set('acc', it.acc);
  if (it.gps) q.set('gps', it.gps);
  return `/api/crew/${it.crew}/photos?${q}`;
}
// extra.at is the capture time of the photo taken with this point; extra.upload its upload id; extra.skip the reason for no photo.
export function confirmPoint(crewId, idx, extra, uid) {
  return deviceTask(async () => {
    const item = { uid, crew: crewId, assignment_revision: extra.assignment_revision, cp_id: extra.cp_id, idx, at: extra.at || Date.now(), lat: extra.lat, lng: extra.lng, label: extra.label, upload: extra.upload, skip: extra.skip };
    try { return await api('POST', `/api/crew/${crewId}/confirm`, confirmBody(item), { userId: uid, allow401: true }); }
    catch (e) {
      if (!keep(e.status)) throw e;
      writeBox(readBox().concat(item));
      return { queued: true, at: item.at };
    }
  });
}
async function upload(crewId, blob, extra, uid) {
  const item = { uid, crew: crewId, assignment_revision: extra.assignment_revision, photo: extra.uploadId || crypto.randomUUID(), point: extra.point, cp: extra.cp, cp_id: extra.cp_id, lat: extra.lat, lng: extra.lng, acc: extra.acc, gps: extra.gps, at: extra.at || Date.now(), label: extra.label };
  try { return await api('POST', photoPath(item), blob, { userId: uid, allow401: true }); }
  catch (e) {
    // Camera captures may not exist in the device gallery. Preserve even a
    // definitive rejection so the owner can save a copy or explicitly discard.
    if (!keep(e.status)) item.error = `รูป ${item.label || 'ที่บันทึกไว้'} ส่งไม่สำเร็จ: ${e.message}`;
    try { await blobs('readwrite', s => s.put(blob, item.photo)); } catch (x) { throw new ApiError(0, 'เก็บรูปไว้ในเครื่องไม่ได้ กรุณาเก็บรูปต้นฉบับไว้และลองใหม่'); }
    writeBox(readBox().filter(x => x.photo !== item.photo).concat(item));
    return { queued: true, at: item.at, error: item.error };
  }
}
export const uploadPhoto = (crewId, blob, extra, uid) => deviceTask(() => upload(crewId, blob, extra, uid));
const selections = new Map();
export function prepareAndUploadPhoto(crewId, file, extra, prepare, uid) {
  return deviceTask(async () => {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(x => x.toString(16).padStart(2, '0')).join('');
    const key = `${uid}:${crewId}:${extra.assignment_revision}:${extra.cp_id ?? "unlinked"}:${extra.point}:${hash}`;
    let selected = selections.get(key);
    if (selected?.result) return { ...selected.result, repeated: true };
    if (!selected) {
      selected = { uploadId: crypto.randomUUID(), at: Date.now() };
      selections.set(key, selected);
      if (selections.size > 20) selections.delete(selections.keys().next().value);
    }
    if (!selected.prepared) selected.prepared = await prepare();
    const out = selected.prepared;
    const result = await upload(crewId, out.blob, { ...extra, uploadId: selected.uploadId, at: selected.at, lat: out.gps?.lat.toFixed(6), lng: out.gps?.lng.toFixed(6), acc: out.gps && Number.isFinite(out.gps.acc) ? Math.round(out.gps.acc) : undefined, gps: out.fix?.status }, uid);
    selected.result = { ...result, gps: !!out.gps, at: selected.at, uploadId: selected.uploadId, lat: out.gps?.lat, lng: out.gps?.lng };
    delete selected.prepared;
    return selected.result;
  });
}
async function send(it) {
  if (!it.photo) return api('POST', `/api/crew/${it.crew}/confirm`, confirmBody(it), { allow401: true, userId: it.uid });
  const blob = await blobs('readonly', s => s.get(it.photo)).catch(() => undefined);
  if (!blob) throw new ApiError(410, 'ไม่พบไฟล์รูปในเครื่องแล้ว');
  return api('POST', photoPath(it), blob, { allow401: true, userId: it.uid });
}
export function flushOutbox(uid) {
  return deviceTask(async () => {
    const out = { sent: 0, failed: [] };
    if (uid == null) return out;
    for (;;) {
      const it = readBox().find(x => x.uid === uid && !x.error);
      if (!it) break;
      try { await send(it); out.sent++; }
      catch (e) {
        if (keep(e.status)) break;
        const error = `${it.photo ? 'รูป' : 'จุด'} ${it.label || 'ที่บันทึกไว้'} ส่งไม่สำเร็จ: ${e.message}`;
        out.failed.push(error);
        writeBox(readBox().map(x => itemKey(x) === itemKey(it) ? { ...x, error } : x));
        continue; // Keep rejected work until its owner explicitly retries or discards it.
      }
      writeBox(readBox().filter(x => itemKey(x) !== itemKey(it)));
      if (it.photo) await blobs('readwrite', s => s.delete(it.photo)).catch(() => {});
    }
    return out;
  });
}
export async function retryPending(uid) {
  await deviceTask(() => writeBox(readBox().map(x => x.uid === uid ? { ...x, error: undefined } : x)));
  return flushOutbox(uid);
}
export function pendingFile(key, uid) {
  return deviceTask(async () => {
    const it = readBox().find(x => itemKey(x) === key && x.uid === uid);
    if (!it) throw new Error('ไม่พบรายการนี้');
    if (it.photo) {
      const blob = await blobs('readonly', s => s.get(it.photo));
      if (!blob) throw new Error('ไม่พบไฟล์รูปในเครื่อง');
      return { blob, name: `crew-photo-${it.photo}.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}` };
    }
    return { blob: new Blob([`รายการที่ยังส่งไม่สำเร็จ\n${it.label || 'จุดสถานะ'}\nเวลา: ${new Date(it.at).toISOString()}\n${it.error || ''}\n`], { type: 'text/plain;charset=utf-8' }), name: `crew-pending-${it.at}.txt` };
  });
}
export function discardPending(key, uid) {
  return deviceTask(async () => {
    const it = readBox().find(x => itemKey(x) === key && x.uid === uid);
    if (!it) return;
    writeBox(readBox().filter(x => itemKey(x) !== key));
    if (it.photo) await blobs('readwrite', s => s.delete(it.photo));
    selections.clear();
  });
}
export function logoutDevice(uid) {
  return deviceTask(async () => {
    const items = readBox(), count = items.filter(x => x.uid === uid).length;
    if (count) throw new ApiError(409, `ยังมีงานรอส่ง ${count} รายการในเครื่องนี้ กรุณาส่งให้ครบ หรือบันทึกสำเนาแล้วลบรายการด้วยตัวเองก่อนออกจากระบบ`);
    // Never clear origin storage wholesale: an unsent queue must never be discarded by logout.
    // Older clients may have left another account's unsent work on this device.
    // Preserve it so its owner can sign in and recover it; never expose it here.
    if (!items.length) await blobs('readwrite', s => s.clear());
    await api('POST', '/api/logout');
    selections.clear();
    try { localStorage.setItem(LOGOUT_EVENT, crypto.randomUUID()); } catch (e) {}
  });
}
