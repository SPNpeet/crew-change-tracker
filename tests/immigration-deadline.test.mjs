import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepItems,MIN} from '../public/js/core.js';
const ctx={settings:{docs:[],late_min:15},vehicle:()=>null,hotelName:()=>''};
const crew=[{name:'Synthetic pending crew',type:'on',cps:[],s4:{imm:false}}];
for(const [minutes,level] of [[1441,null],[1440,'advance'],[361,'advance'],[360,'urgent'],[0,'urgent'],[-1,'overdue']])test(`IM deadline ${minutes} minutes has ${level||'no'} alert`,()=>{
 const out=prepItems({imm_deadline:200000000+minutes*MIN},crew,200000000,ctx).filter(x=>x.tag?.startsWith('ตม.'));
 assert.equal(out.length,level?1:0);if(level)assert.equal(out[0].deadline,level);
});
test('IM submitted flags suppress the deadline alert without asserting immigration approval',()=>{assert.equal(prepItems({imm_deadline:1},[{...crew[0],s4:{imm:true}}],200000000,ctx).filter(x=>x.tag?.startsWith('ตม.')).length,0);});
