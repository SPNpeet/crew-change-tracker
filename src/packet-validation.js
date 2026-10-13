import {HttpError,ymd} from './util.js';
import {revisionOf} from './packet-workflow.js';
export const identityFields=['name','rank','nationality','passport','passport_exp','sirb_no','sirb_exp'];
export const identityHash=c=>revisionOf(Object.fromEntries(identityFields.map(k=>[k,c[k]||''])));
const fail=m=>{throw new HttpError(400,m);};
function instant(value,zone) {
  if(typeof zone!=='string'||!zone.trim())fail('A named IANA time zone is required.');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(value||''))fail('Flight time requires local date, time and UTC offset (YYYY-MM-DDTHH:mm+HH:mm).');
  ymd(value.slice(0,10));
  const at=Date.parse(value);if(!Number.isFinite(at))fail('Invalid flight time.');
  try {
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(p=>[p.type,p.value]));
    if(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`!==value.slice(0,16))fail('The flight UTC offset does not match the named time zone.');
  } catch(e){if(e instanceof HttpError)throw e;fail('A valid IANA time zone is required.');}
  return at;
}
export function validateLegs(legs) {
  if(!Array.isArray(legs)||legs.length>8)fail('Use up to eight ordered flight legs.');
  let previous=null;
  return legs.map(l=>{
    if(!l||typeof l!=='object'||Array.isArray(l))fail('Each flight leg must be an object.');
    if(!/^[A-Z0-9][A-Z0-9 -]{1,14}$/i.test(l.flight||'')||! /^[A-Z]{3}$/.test(l.from||'')||! /^[A-Z]{3}$/.test(l.to||''))fail('Flight number and three-letter airport codes are required.');
    const dep=instant(l.departure,l.departure_zone),arr=instant(l.arrival,l.arrival_zone);
    if(arr<=dep||arr-dep>48*3600000)fail('Arrival must follow departure within 48 hours.');
    if(previous&&(dep<previous.arrival_at||l.from!==previous.to))fail('Connecting flights must be ordered and use the preceding arrival airport.');
    const out={flight:l.flight.toUpperCase(),from:l.from,to:l.to,departure:l.departure,departure_zone:l.departure_zone,arrival:l.arrival,arrival_zone:l.arrival_zone,departure_at:dep,arrival_at:arr};previous=out;return out;
  });
}
export function expiryMissing(c,legs) {
  if(!legs.length)return ['flight_legs'];
  const travel=legs.flatMap(l=>[l.departure.slice(0,10),l.arrival.slice(0,10)]).sort().at(-1),missing=[];
  for(const k of ['passport_exp','sirb_exp'])if(c[k]&&c[k]<travel)missing.push(k+':expired_before_travel');
  return missing;
}
