import { parseJson } from './util.js';
import { DEFAULT_TPL, DEFAULT_OKTB } from '../public/js/core.js';

export const DEFAULTS = {
  company: {
    name: 'Success Marine Service Co., Ltd.',
    name_th: 'บริษัท ซัคเซส มารีน เซอร์วิส จำกัด',
    signature: 'Best regards,\nSuccess Marine Service Co., Ltd.'
  },
  late_min: 10,
  max_users: 15,
  storage_gb: 10,
  storage_warning_percent: 80,
  docs: ['Passport', 'Seaman book', 'ตั๋วเครื่องบิน'],
  services: ['Crew change', 'Husbandry', 'Spare parts', 'Provision', 'Medical'],
  cp_on: [
    { th: 'เครื่องลง', en: 'Landed', gap: 0, photo: false },
    { th: 'ผ่าน ตม.', en: 'Immigration cleared', gap: 45, photo: false },
    { th: 'พบ Meeting point', en: 'Met at meeting point', gap: 15, photo: true },
    { th: 'ขึ้นรถ', en: 'In transfer', gap: 10, photo: true },
    { th: 'ถึงโรงแรม / เช็คอิน', en: 'At hotel', gap: 80, photo: true },
    { th: 'ออกไปท่าเรือ', en: 'Transfer to port', gap: 600, photo: true },
    { th: 'ผ่าน Gate', en: 'Gate cleared', gap: 60, photo: true },
    { th: 'ขึ้นเรือ', en: 'On board', gap: 30, photo: true }
  ],
  cp_on_chain: 4,
  cp_off: [
    { th: 'ลงจากเรือ', en: 'Signed off', gap: 0, photo: true },
    { th: 'ผ่าน Gate', en: 'Gate cleared', gap: 20, photo: true },
    { th: 'ขึ้นรถ', en: 'In transfer', gap: 10, photo: true },
    { th: 'ถึงโรงแรม / เช็คอิน', en: 'At hotel', gap: 30, photo: true },
    { th: 'ออกไปสนามบิน', en: 'Transfer to airport', gap: 660, photo: true },
    { th: 'เช็คอินสายการบิน', en: 'Checked in at airport', gap: 60, photo: true },
    { th: 'เครื่องออก', en: 'Departed', gap: 120, photo: false }
  ],
  cp_off_chain: 3,
  mail_tpl: DEFAULT_TPL,
  oktb: DEFAULT_OKTB
};

export const EDITABLE = Object.keys(DEFAULTS);
export const BRAND_KINDS = ['letterhead', 'signature', 'stamp'];

export async function loadSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = structuredClone(DEFAULTS);
  for (const r of results) if (r.key in s) s[r.key] = parseJson(r.value, s[r.key]);
  for (const k of ['cp_on', 'cp_off']) s[k] = withIds(k, s[k]);
  return s;
}

// Points saved before ids existed get the same id on every read (on1, on2, ... by position) until an admin saves the list.
export function withIds(key, list) {
  const used = new Set(list.map(x => x.id).filter(Boolean));
  return list.map((x, i) => {
    let id = x.id;
    for (let n = i + 1; !id; n++) { const tryId = (key === 'cp_on' ? 'on' : 'off') + n; if (!used.has(tryId)) { id = tryId; used.add(id); } }
    return { id, th: x.th, en: x.en, gap: x.gap, photo: !!x.photo };
  });
}

export async function loadBrand(env) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'brand'").first();
  const v = parseJson(r && r.value, {});
  return Object.fromEntries(BRAND_KINDS.map(k => [k, Number(v[k]) || 0]));
}
