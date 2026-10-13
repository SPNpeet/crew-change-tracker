import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {browser,login,OUT,FIELD_PASS} from './cdp.mjs';
const token=await login('pranee',FIELD_PASS),b=await browser(),results=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
const expected={3:'ร่างอีเมลแจ้ง Local Agent',5:'ร่างอีเมลแผนส่ง Owner / กัปตัน',6:'ร่างอีเมล GATE PERMISSION',8:'อีเมลอัปเดต Owner'};
try{
 await b.size(1180,757);await b.go('/api/health',50);await b.cookie(token);await b.send('Accessibility.enable');
 for(const [step,name]of Object.entries(expected)){
  await b.go('/jobs/1/'+step,100);let ready=false;for(let i=0;i<80;i++){if(await b.eval('!!document.querySelector("#mailtext")')){ready=true;break;}await sleep(100);}assert.ok(ready,'draft exists');
  const root=await b.send('DOM.getDocument'),found=await b.send('DOM.querySelector',{nodeId:root.root.nodeId,selector:'#mailtext'}),node=await b.send('DOM.describeNode',{nodeId:found.nodeId});
  const tree=await b.send('Accessibility.getPartialAXTree',{backendNodeId:node.node.backendNodeId,fetchRelatives:false}),ax=tree.nodes.find(n=>n.backendDOMNodeId===node.node.backendNodeId);
  const dom=await b.eval('(()=>{const e=document.querySelector("#mailtext"),id=e.getAttribute("aria-labelledby"),h=id&&document.getElementById(id);e.focus();return{labelledby:id,heading:h?.textContent,headingVisible:!!h&&h.getBoundingClientRect().height>0,editable:!e.readOnly&&!e.disabled,focused:document.activeElement===e};})()');
  const passed=ax?.role?.value==='textbox'&&ax?.name?.value===name&&dom.heading===name&&dom.headingVisible&&dom.editable&&dom.focused;
  results.push({step,expected:name,computedAccessibleName:ax?.name?.value||'',role:ax?.role?.value,passed,...dom});
  console.log((passed?'PASS ':'FAIL ')+'email draft has a visible associated heading in accessibility tree at step '+step+' '+JSON.stringify(results.at(-1)));
 }
 await b.go('/account',100);for(let i=0;i<80;i++){if(await b.eval('!!document.querySelector("#pwf")'))break;await sleep(100);}
 const accountHeadings=await b.eval('[...document.querySelectorAll("main h1, main h2, main h3")].map(e=>({tag:e.tagName,text:e.textContent}))');console.log('INFO candidate account headings '+JSON.stringify(accountHeadings));
 mkdirSync(OUT,{recursive:true});writeFileSync(join(OUT,'email-draft-accessibility.json'),JSON.stringify({baseCommit:'41b67b155d304d1cea72dc0fbe18e3509a97b2c4',role:'synthetic office account',results,accountHeadings},null,2));if(results.some(r=>!r.passed))process.exitCode=1;
}finally{b.close();}
