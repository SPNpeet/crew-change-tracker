// Forecast rule and its explanation, photo state and location wording. Pure functions, synthetic data, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../public/js/core.js';

const MIN = 60000, LATE = 10;
// 10 January 2031 23:00 Bangkok time: a fixed day that is never "today", so times print with their date.
const T0 = Date.UTC(2031, 0, 10, 16, 0);
const at = min => T0 + min * MIN;
function crew(name, plans, actuals, chainEnd) {
  return { id: 1, name, type: 'on', chain_end: chainEnd, notes: [], photos: [], docs: {}, s4: {}, agent_id: 1, vehicle_id: 1, hotel_id: 1,
    cps: plans.map((p, i) => ({ id: i+100, idx: i, name: ['เครื่องลง', 'ผ่าน ตม.', 'ขึ้นรถ', 'ถึงโรงแรม', 'ออกไปท่าเรือ'][i], name_en: 'P' + (i + 1), plan: p, actual: actuals[i] ?? null, need_photo: 0, skip: '' })) };
}
const plans = [0, 30, 50, 120, 600].map(at);

test('CF01 crew late by different amounts are forecast independently', () => {
  const a = crew('Synthetic A', plans, [at(0), at(55)], 3);
  const b = crew('Synthetic B', plans, [at(0), at(70)], 3);
  const c = crew('Synthetic C', plans, [at(0), at(31)], 3);
  const run = list => list.map(x => [core.expected(x, 2, LATE), core.expected(x, 3, LATE)]);
  const first = run([a, b, c]);
  assert.deepEqual(first, [[at(75), at(145)], [at(90), at(160)], [at(50), at(120)]]);
  assert.deepEqual(run([c, b, a]).reverse(), first, 'the order of evaluation changes nothing');
  assert.equal(core.lastDelay(a), 25);
  assert.equal(core.lastDelay(b), 40);
  assert.equal(core.expected(crew('Synthetic D', plans, [at(0), at(40)], 3), 2, LATE), at(50), 'a delay of exactly the limit is not shifted');
});

test('CF02 a forecast that passes midnight Bangkok time shows the next date', () => {
  const late = crew('Synthetic Night', [0, 30, 50, 80].map(at), [at(0), at(55)], 3);
  assert.equal(core.fmtD(core.expected(late, 2, LATE)), '11/01 00:15');
  assert.equal(core.fmtD(late.cps[2].plan), '10/01 23:50');
  const note = core.forecastNote(late, 2, LATE);
  assert.ok(note.includes('คาดว่า 11/01 00:15') && note.includes('แผน 10/01 23:50'), note);
});

test('CF03 points after the chain end keep their plan time', () => {
  const c = crew('Synthetic Chain', plans, [at(0), at(55)], 3);
  assert.equal(core.expected(c, 3, LATE), at(145));
  assert.equal(core.expected(c, 4, LATE), at(600));
  assert.equal(core.forecast(c, 4, LATE), null);
  assert.equal(core.forecastNote(c, 4, LATE), '');
  assert.ok(core.shiftNote(c, LATE).includes('เลื่อนถึงจุด ถึงโรงแรม'), core.shiftNote(c, LATE));
});

test('CF04 a crew member without plan times gets no forecast at all', () => {
  const c = crew('Synthetic No Plan', [null, null, null, null, null], [at(0), at(55)], 3);
  for (let j = 0; j < 5; j++) {
    assert.equal(core.expected(c, j, LATE), null);
    assert.equal(core.forecast(c, j, LATE), null);
    assert.equal(core.forecastNote(c, j, LATE), '');
    assert.equal(core.planCell(c, j, LATE), 'ยังไม่มีแผน');
  }
  assert.equal(core.shiftNote(c, LATE), '');
  assert.equal(core.status(c, at(60), LATE).k, 'noplan');
  const half = crew('Synthetic Half Plan', [at(0), at(30), null, at(120), at(600)], [at(0), at(55)], 3);
  assert.equal(core.forecast(half, 2, LATE), null, 'the point without a plan shows nothing');
  assert.equal(core.forecast(half, 3, LATE).at, at(145), 'a later point with a plan is still explained');
});

test('CF05 reordering the settings template later does not move an existing crew member\'s chain end', () => {
  const c = crew('Synthetic Copy', plans, [at(0), at(55)], 3);
  const before = [0, 1, 2, 3, 4].map(j => core.expected(c, j, LATE));
  const settings = order => ({ late_min: LATE, docs: [], cp_on_chain: 0, cp_on: order.map(i => ({ id: 'x' + i, th: c.cps[i].name, en: 'P', gap: 5, photo: false })) });
  const ctx = s => ({ settings: s, vehicle: () => ({ name: 'Synthetic van', driver: '' }), hotelName: () => 'Synthetic hotel' });
  const one = core.prepItems({ agent: '' }, [c], at(60), ctx(settings([0, 1, 2, 3, 4])));
  const two = core.prepItems({ agent: '' }, [c], at(60), ctx(settings([4, 3, 2, 1, 0])));
  assert.deepEqual(two, one);
  assert.deepEqual([0, 1, 2, 3, 4].map(j => core.expected(c, j, LATE)), before);
  assert.equal(c.chain_end, 3);
});

test('CF06 the explanation names its source and adds up on the clock the user sees', () => {
  const c = crew('Synthetic Sum', plans, [at(0), at(54.6)], 3);
  const f = core.forecast(c, 2, LATE);
  assert.deepEqual([f.plan, f.late, f.from], [at(50), 24, 'ผ่าน ตม.']);
  assert.equal(core.fmtD(f.at), '11/01 00:14', '23:50 + 24 minutes');
  assert.equal(core.forecastNote(c, 2, LATE), 'คาดว่า 11/01 00:14 = แผน 10/01 23:50 + ช้า 24 นาที จากจุด ผ่าน ตม.');
  assert.equal(core.forecastWhy(c, 2, LATE), 'แผน 10/01 23:50 + ช้า 24 นาที จากจุด ผ่าน ตม.');
  const item = core.prepItems({ agent: '' }, [c], at(56), { settings: { late_min: LATE, docs: [] }, vehicle: () => null, hotelName: () => '' }).find(x => x.tag === 'ด่วน');
  assert.ok(item.text.includes('(= แผน 10/01 23:50 + ช้า 24 นาที จากจุด ผ่าน ตม.)'), item.text);
});

test('CF07 photo state is read from stored photos of that point only', () => {
  const c = crew('Synthetic Photo', plans, [at(0), at(31), at(52)], 3);
  c.cps[1].need_photo = 1; c.cps[2].need_photo = 1; c.cps[3].need_photo = 1; c.cps[2].skip = 'กล้องใช้ไม่ได้';
  c.photos = [{ id: 1, point: 'ขึ้นรถ', cp_idx: null }, { id: 2, point: 'x', cp_idx: 1, cp_id:101 }];
  assert.deepEqual(core.evidence(c), { need: 2, have: 1 }, 'a point that is not confirmed yet is not counted');
  assert.equal(core.photoDue(c, c.cps[1]), false);
  assert.equal(core.photoDue(c, c.cps[2]), true, 'a photo that only matches by name is not attached to the point');
  assert.equal(core.photoDue(c, c.cps[3]), false, 'not confirmed yet');
  assert.equal(core.cpPhotos(c, 1).length, 1);
  const due = core.prepItems({ agent: '' }, [c], at(60), { settings: { late_min: LATE, docs: [] }, vehicle: () => null, hotelName: () => '' }).filter(x => x.tag === 'รูป');
  assert.deepEqual(due.map(x => x.text), ['Synthetic Photo · ขึ้นรถ รูปค้าง (กล้องใช้ไม่ได้)']);
  c.photos.push({ id: 3, point: 'ขึ้นรถ', cp_idx: 2, cp_id:102 });
  assert.deepEqual(core.evidence(c), { need: 2, have: 2 });
});

test('CF08 location and time labels state their source and never claim proof', () => {
  assert.equal(core.gpsText({ lat: 13.0897, lng: 100.8832, acc: 12.4, gps: 'ok' }), 'พิกัดจากมือถือ 13.08970, 100.88320 (±12 ม.)');
  assert.equal(core.gpsText({ lat: 13.0897, lng: 100.8832, acc: null }), 'พิกัดจากมือถือ 13.08970, 100.88320');
  assert.equal(core.gpsText({ lat: null, lng: null, gps: 'denied' }), 'ไม่มีพิกัด (ไม่อนุญาตตำแหน่ง)');
  assert.equal(core.gpsText({ lat: null, lng: null, gps: 'timeout' }), 'ไม่มีพิกัด (หมดเวลาหาตำแหน่ง)');
  assert.equal(core.gpsText({ lat: null, lng: null, gps: 'unavailable' }), 'ไม่มีพิกัด (หาตำแหน่งไม่ได้)');
  assert.equal(core.gpsText({ lat: null, lng: null, gps: '' }), 'ไม่มีพิกัด');
  assert.equal(core.lagged(at(0), at(2)), false);
  assert.equal(core.lagged(at(0), at(2) + 1), true);
  assert.equal(core.lagged(at(0), null), false);
  for (const s of [...Object.values(core.GPS_WHY), ...Object.values(core.CAPACITY), ...core.SKIP_REASONS]) assert.ok(!/พิสูจน์|หลักฐาน|ยืนยันตัวตน/.test(s), s);
});
