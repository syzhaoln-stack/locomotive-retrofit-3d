import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ownStepVisible,effectiveVisible,poseFor,parseHash} from '../src/state.js';
const parts=JSON.parse(readFileSync(new URL('../public/assets/model-manifest.json',import.meta.url),'utf8')).parts;
const map=new Map(parts.map(p=>[p.partId,p]));
const visible=(id,step,hidden=new Set(),only=null)=>effectiveVisible(id,step,hidden,only,map);
test('diesel and replacement equipment are never presented as installed together',()=>{
 for(let s=0;s<8;s++){if(visible('diesel',s))assert.equal(visible('battery_1',s),false);}
 assert.equal(visible('diesel',0),true);assert.equal(visible('tank',0),true);
 assert.equal(visible('diesel',5),false);assert.equal(visible('battery_6',5),true);
});
test('six retained traction motors remain available in diesel and electric configurations',()=>{
 for(const end of ['front','rear'])for(let i=1;i<=3;i++)for(const step of [0,3,5,7])assert.equal(visible(`motor_${end}_${i}`,step),true);
});
test('installation precedes cable connection and complete body is restored last',()=>{
 for(const id of ['wiring_hv','wiring_ac','wiring_lv','wiring_cooling']){assert.equal(visible(id,4),false);assert.equal(visible(id,5),true);}
 assert.equal(visible('roof',5),false);assert.equal(visible('roof',7),true);
 assert.notDeepEqual(poseFor('roof',6),poseFor('roof',7));
});
test('hiding a bogie hides its children; restoring stays within the current stage',()=>{
 const hidden=new Set(['bogie_front']);assert.equal(visible('axle_front_1',3,hidden),false);assert.equal(visible('motor_front_3',3,hidden),false);assert.equal(visible('bogie_rear',3,hidden),true);
 hidden.clear();assert.equal(visible('motor_front_3',3,hidden),true);assert.equal(visible('diesel',3,hidden),false);
});
test('isolating a motor keeps its transform parent and excludes sibling axles',()=>{
 assert.equal(visible('bogie_front',3,new Set(),'motor_front_1'),true);
 assert.equal(visible('motor_front_1',3,new Set(),'motor_front_1'),true);
 assert.equal(visible('axle_front_1',3,new Set(),'motor_front_1'),false);
 assert.equal(visible('bogie_rear',3,new Set(),'motor_front_1'),false);
});
test('share state is bounded and only accepts known model parts',()=>{
 const a=parseHash('#step=500&hide=frame,unknown&only=bad&view=javascript',map);assert.equal(a.step,7);assert.deepEqual([...a.hidden],['frame']);assert.equal(a.isolate,null);assert.equal(a.view,'overall');
 assert.equal(parseHash('#step=NaN',map).step,0);
});
test('all exported groups have explicit stable stages and finite presentation poses',()=>{
 assert.equal(parts.length,42);
 for(const p of parts)for(let s=0;s<8;s++){assert.equal(typeof ownStepVisible(p.partId,s),'boolean');assert.ok(poseFor(p.partId,s).every(Number.isFinite));}
});
