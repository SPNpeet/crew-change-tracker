import { parseJson } from './util.js';
import { DEFAULT_TPL } from '../public/js/core.js';

export const DEFAULTS = {
  company: {
    name: 'Success Marine Service Co., Ltd.',
    name_th: 'บริษัท ซัคเซส มารีน เซอร์วิส จำกัด',
    signature: 'Best regards,\nSuccess Marine Service Co., Ltd.'
  },
  late_min: 10,
  max_users: 15,
  storage_gb: 10,
  docs: ['Passport', 'Seaman book', 'ตั๋วเครื่องบิน'],
  services: ['Crew change', 'Husbandry', 'Spare parts', 'Provision', 'Medical'],
  cp_on: [
    { th: 'เครื่องลง', en: 'Landed', gap: 0 },
    { th: 'ผ่าน ตม.', en: 'Immigration cleared', gap: 45 },
    { th: 'พบ Meeting point', en: 'Met at meeting point', gap: 15 },
    { th: 'ขึ้นรถ', en: 'In transfer', gap: 10 },
    { th: 'ถึงโรงแรม / เช็คอิน', en: 'At hotel', gap: 80 },
    { th: 'ออกไปท่าเรือ', en: 'Transfer to port', gap: 600 },
    { th: 'ผ่าน Gate', en: 'Gate cleared', gap: 60 },
    { th: 'ขึ้นเรือ', en: 'On board', gap: 30 }
  ],
  cp_on_chain: 4,
  cp_off: [
    { th: 'ลงจากเรือ', en: 'Signed off', gap: 0 },
    { th: 'ผ่าน Gate', en: 'Gate cleared', gap: 20 },
    { th: 'ขึ้นรถ', en: 'In transfer', gap: 10 },
    { th: 'ถึงโรงแรม / เช็คอิน', en: 'At hotel', gap: 30 },
    { th: 'ออกไปสนามบิน', en: 'Transfer to airport', gap: 660 },
    { th: 'เช็คอินสายการบิน', en: 'Checked in at airport', gap: 60 },
    { th: 'เครื่องออก', en: 'Departed', gap: 120 }
  ],
  cp_off_chain: 3,
  mail_tpl: DEFAULT_TPL
};

export const EDITABLE = Object.keys(DEFAULTS);

export async function loadSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = structuredClone(DEFAULTS);
  for (const r of results) if (r.key in s) s[r.key] = parseJson(r.value, s[r.key]);
  return s;
}
