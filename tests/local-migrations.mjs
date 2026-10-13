// Use the pinned local Wrangler and retain diagnostics; a failed setup must fail the suite.
// Wrangler 4.130's version banner can leave an npm-registry TLS socket alive after
// command completion on this host. Disable only that optional check for local tests.
// The CLI still applies/validates every migration and reports its real exit status.
process.env.WRANGLER_HIDE_BANNER = 'true';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
export function migrateLocal(persist) {
  const wr=join(process.cwd(),'node_modules/wrangler/bin/wrangler.js');
  try {
    const out=execFileSync(process.execPath,[wr,'d1','migrations','apply','cct','--local','--persist-to',persist],{encoding:'utf8',windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    writeFileSync(join(persist,'migration.log'),out);
  } catch(e) {
    const diagnostic=String(e.stdout||'')+'\n'+String(e.stderr||'');
    writeFileSync(join(persist,'migration.log'),diagnostic);
    throw new Error('Local migrations failed; inspect '+join(persist,'migration.log')+'\n'+diagnostic,{cause:e});
  }
}
