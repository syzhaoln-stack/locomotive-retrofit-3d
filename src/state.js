export const STEPS = [
 {title:'原车总览',subtitle:'柴油动力单元仍在车内',detail:'完整外观 · 原柴油系统',duration:4200},
 {title:'拆开机罩',subtitle:'顶盖、侧门板与端壁分离',detail:'看清包覆与内部空间',duration:5000},
 {title:'移出旧动力',subtitle:'柴油机、发电机和燃油箱移出',detail:'拆除旧动力与燃油系统',duration:5000},
 {title:'展开机械底盘',subtitle:'移开甲板，查看构架、轮对与牵引',detail:'车架 · 悬挂 · 制动',duration:5500},
 {title:'装入电气设备',subtitle:'电池架、高低压柜和冷却机组入位',detail:'六组电池架与设备柜',duration:5500},
 {title:'查看系统连接',subtitle:'电源、控制与液冷各自独立',detail:'四色管线 · 可逐件消隐',duration:6500},
 {title:'复装车体',subtitle:'新设备已安装，机罩逐步复位',detail:'确认设备与包覆关系',duration:4500},
 {title:'改造完成',subtitle:'电池机车完整外观',detail:'恢复整体 · 自由查看',duration:5000},
];
export const COVER_IDS=['roof','shell_left','shell_right','hood_ends','short_hood'];
export const OPEN_POSES={roof:[0,4,-4.3],shell_left:[0,4.7,4.5],shell_right:[0,2.6,-5.3],hood_ends:[3,4.5,-3.5],short_hood:[0,3.3,-4.2]};
export function isNew(id){return /^(battery_|wiring_)/.test(id)||['hv','inverter','lv','cooling','aux'].includes(id);}
export function ownStepVisible(id,step){
 if(id==='track')return true;
 if(id==='diesel'||id==='tank')return step<=2;
 if(isNew(id)){if(step<4)return false;return !/^wiring_(hv|ac|lv|cooling)$/.test(id)||step>=5;}
 if(COVER_IDS.includes(id))return step<=1||step>=6;
 if(id==='deck')return step!==3;
 if(id==='cab'||id==='fittings')return step!==3 && !(id==='cab'&&step===5);
 return true;
}
export function poseFor(id,step){
 if(COVER_IDS.includes(id))return step===1?OPEN_POSES[id]:(step===6?OPEN_POSES[id].map(v=>v*.28):[0,0,0]);
 if(step===2){if(id==='diesel')return[0,3.8,-5.5];if(id==='tank')return[0,-.1,4.3];}
 if(step===3&&id.startsWith('bogie_'))return[id==='bogie_front'?.7:-.7,0,3.8];
 return[0,0,0];
}
export function ancestors(id,partMap){let ids=[];let p=partMap.get(id);while(p?.parent){ids.push(p.parent);p=partMap.get(p.parent);if(ids.length>100)break;}return ids;}
export function relatedTo(id,isolate,partMap){return !isolate||id===isolate||ancestors(id,partMap).includes(isolate)||ancestors(isolate,partMap).includes(id);}
export function effectiveVisible(id,step,hidden,isolate,partMap,track=true){
 const chain=[id,...ancestors(id,partMap)];
 return (track||id!=='track')&&chain.every(k=>ownStepVisible(k,step)&&!hidden.has(k))&&relatedTo(id,isolate,partMap);
}
export function parseHash(hash,partMap){
 const p=new URLSearchParams(hash.replace(/^#/,''));const n=Number(p.get('step')??'0');
 return{step:Number.isInteger(n)?Math.min(7,Math.max(0,n)):0,view:['overall','side','top','front','bogie','electrical'].includes(p.get('view'))?p.get('view'):'overall',hidden:new Set((p.get('hide')||'').split(',').filter(k=>partMap.has(k))),isolate:partMap.has(p.get('only'))?p.get('only'):null};
}
