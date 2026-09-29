import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/backup-to-sql.mjs <backup.json.gz> <restore.sql>');
  process.exit(1);
}

const raw = readFileSync(input);
const dump = JSON.parse((input.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'));
if (dump.format !== 'cct-backup' || dump.version !== 1) throw new Error('not a Crew Change Tracker backup file');

const ORDER = ['users', 'settings', 'vehicles', 'hotels', 'jobs', 'crew', 'checkpoints', 'notes', 'photos', 'activity'];
const lit = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

const lines = ['PRAGMA defer_foreign_keys = on;', 'DELETE FROM sessions;'];
for (const t of [...ORDER].reverse()) lines.push(`DELETE FROM ${t};`);
let rows = 0;
for (const t of ORDER) {
  for (const r of dump.tables[t] || []) {
    const cols = Object.keys(r);
    lines.push(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(c => lit(r[c])).join(', ')});`);
    rows++;
  }
}
writeFileSync(output, lines.join('\n') + '\n');
console.log(`restore file ${output}: ${rows} rows from backup created ${new Date(dump.created).toISOString()}`);
