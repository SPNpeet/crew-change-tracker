const BASE = process.env.BASE || 'http://127.0.0.1:8787';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE)) throw new Error('seed-local only runs against a local dev server');
const [user, pass] = [process.env.ADMIN_USER || 'jeerawan', process.env.ADMIN_PASS];
if (!pass) throw new Error('set ADMIN_PASS');

let cookie = '';
async function call(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'x-cct': '1', 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${data.error}`);
  return data;
}

const M = 60000, now = Date.now(), t = m => now + m * M;
await call('POST', '/api/login', { username: user, password: pass });
const pw = 'field-pass-2569';
const mk = async u => { try { return (await call('POST', '/api/users', { password: pw, ...u })).id; } catch (e) { const l = (await call('GET', '/api/users')).users; return l.find(x => x.username === u.username).id; } };
const somsak = await mk({ username: 'somsak', name: 'สมศักดิ์', role: 'field', title: 'Boarding agent · สนามบิน', phone: '081-000-1001', id_card: '3-1001-00000-00-1' });
const wichai = await mk({ username: 'wichai', name: 'วิชัย', role: 'field', title: 'Boarding agent · ท่าเรือ', phone: '081-000-1002', id_card: '3-1002-00000-00-2' });
await mk({ username: 'napa', name: 'นภา', role: 'field', see_all: true, title: 'หัวหน้างานภาคสนาม' });
await mk({ username: 'may', name: 'เมย์', role: 'office', title: 'Operation' });
const v1 = (await call('POST', '/api/vehicles', { name: 'รถตู้ 1', plate: 'ฮข 1234', driver: 'คุณประเสริฐ', driver_en: 'Prasert', driver_id: '3-2002-00000-00-1', driver_phone: '089-000-2002' })).id;
const v2 = (await call('POST', '/api/vehicles', { name: 'รถตู้ 2', plate: 'กท 5678', driver: 'คุณวีระ', driver_en: 'Weera', driver_id: '3-2003-00000-00-2', driver_phone: '089-000-2003' })).id;
const h1 = (await call('POST', '/api/hotels', { name: 'Harbour View Hotel ศรีราชา', phone: '038-000-000' })).id;
await call('POST', '/api/hotels', { name: 'Sriracha Bay Hotel' });

const job = (await call('POST', '/api/jobs', { vessel: 'MT OCEAN MERIDIAN', port: 'Laem Chabang B3', owner: 'Blue Harbour Shipping', owner_email: 'ops@blueharbour.example', agent: 'LCB Marine Agency', agent_email: 'ops@lcbmarine.example', eta: t(600), etb: t(690), etd: t(1560), imm_deadline: t(320) })).id;
await call('PATCH', `/api/jobs/${job}`, { eta: t(600), source: 'LCB Marine Agency · อีเมล' });
const crew = [
  ['Rafael Mendoza', 'Master', 'on', 'Filipino', 'PR 732', 'P1234567A', [-180, -135, -120, -110, -30, 600, 690, 720], [7, 10, 5, 8, 4], somsak, v1, h1, '512', 1],
  ['Arun Pillai', 'C/O', 'on', 'Indian', 'AI 332', 'Z9876543', [-90, -45, -30, -20, 60, 600, 690, 720], [8, 6, 5], somsak, v1, h1, '514', 0],
  ['Tran Minh Duc', '2/E', 'on', 'Vietnamese', 'VN 615', 'C4567890', [-200, -160, -145, -135, -60, 600, 690, 720], [3, 6, 4, 2, 5], somsak, v1, h1, '515', 1],
  ['Joel Castillo', 'AB', 'on', 'Filipino', 'PR 740', '', [90, 135, 150, 160, 240, 600, 690, 720], [], somsak, v2, null, '', 0],
  ['Oleg Marchenko', 'Master', 'off', 'Ukrainian', 'TG 974', 'FE123456', [780, 800, 810, 840, 1500, 1560, 1680], [], wichai, v2, h1, '520', 1],
  ['Somchai Wongdee', 'Bosun', 'off', 'Thai', 'FD 3012', 'AA1122334', [780, 800, 810, 840, 1500, 1545, 1650], [], wichai, v2, h1, '521', 1]
];
const ids = (await call('POST', `/api/jobs/${job}/crew`, { crew: crew.map(c => ({ name: c[0], rank: c[1], type: c[2], nationality: c[3], flight: c[4], passport: c[5], agent_id: c[8] })) })).ids;
for (let i = 0; i < crew.length; i++) {
  const c = crew[i], id = ids[i];
  await call('PATCH', `/api/crew/${id}`, { vehicle_id: c[9], hotel_id: c[10], room: c[11], docs: c[12] ? { Passport: 1, 'Seaman book': 1, 'ตั๋วเครื่องบิน': 1 } : { Passport: 1, 'Seaman book': i === 3 ? 1 : 0, 'ตั๋วเครื่องบิน': i === 3 ? 0 : 1 } });
  await call('PUT', `/api/crew/${id}/plan`, { plans: c[6].map(t) });
  if (c[2] === 'on' && c[12]) await call('PATCH', `/api/crew/${id}`, { s4: { oktb: true, meet: true, imm: true } });
}
await call('PATCH', `/api/jobs/${job}`, { services: ['Crew change'], steps: [1, 1, 1, 0, 0, 0, 1, 0, 0], sent: { appoint: true, sched: true } });
await call('POST', '/api/logout');
await call('POST', '/api/login', { username: 'somsak', password: pw });
for (let i = 0; i < crew.length; i++) {
  const c = crew[i];
  if (c[8] !== somsak) continue;
  for (let k = 0; k < c[7].length; k++) await call('POST', `/api/crew/${ids[i]}/confirm`, { idx: k, at: t(c[6][k] + c[7][k]) });
}
console.log(`seeded job ${job} with ${ids.length} crew · field password: ${pw}`);
