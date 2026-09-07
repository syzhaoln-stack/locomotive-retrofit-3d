import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STEPS, COVER_IDS, poseFor, ownStepVisible, effectiveVisible, ancestors, parseHash } from './state.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const stage=$('#stage'),canvas=$('#model-canvas');
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let renderer,scene,camera,controls,model,light,ground;
let parts=[],partMap=new Map(),groups=new Map(),meshes=[];
let step=0,hidden=new Set(),isolated=null,selected=null,hideHistory=[],view='overall';
let ready=false,dirty=true,playing=false,autoNext=0,autoRotate=false,shadows=innerWidth>700;
let poseAnimation=null,cameraAnimation=null,lastTimestamp=0,toastTimer,resizeTimer;
let focusedIds=null;
const BASE=import.meta.env.BASE_URL;
const visibleMeshes=()=>meshes.filter(m=>{let a=m;while(a&&a!==scene){if(!a.visible)return false;a=a.parent;}return true;});

function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2600);}
function setPanel(name){$$('[data-panel]').forEach(b=>{b.classList.toggle('active',b.dataset.panel===name);b.setAttribute('aria-selected',b.dataset.panel===name);});$$('.panel-content').forEach(p=>p.classList.toggle('active',p.id===`panel-${name}`));}
$$('[data-panel]').forEach(b=>b.addEventListener('click',()=>setPanel(b.dataset.panel)));
function openHelp(){pause();$('#help-dialog').showModal();}
$('#help').onclick=openHelp;$('#model-note').onclick=openHelp;
$$('[data-close]').forEach(b=>b.onclick=()=>{b.closest('dialog').close();$('#video-dialog video').pause();});
$$('dialog').forEach(d=>{d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});d.addEventListener('close',()=>$('#video-dialog video').pause());});
$('#fallback-video').onclick=()=>{$('#video-dialog').showModal();$('#video-dialog video').load();};
$('#retry').onclick=()=>location.reload();
$('#step-list').innerHTML=STEPS.map((s,i)=>`<button class="step-button${i===0?' active':''}" data-step="${i}" aria-current="${i===0?'step':'false'}"><span class="number">${String(i+1).padStart(2,'0')}</span><span><strong>${s.title}</strong><small>${s.detail}</small></span></button>`).join('');
$$('[data-step]').forEach(b=>b.onclick=()=>setStep(Number(b.dataset.step)));
function updateStepUI(){
 $('#stage-number').textContent=String(step+1).padStart(2,'0');$('#stage-title').textContent=STEPS[step].title;$('#stage-subtitle').textContent=STEPS[step].subtitle;
 $$('[data-step]').forEach(b=>{const active=Number(b.dataset.step)===step;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'step':'false');});
 $('#previous').disabled=step===0;$('#next').disabled=step===7;
 document.title=`${STEPS[step].title} · 机车油改电`;
 stage.dataset.step=String(step);
}
function pause(){playing=false;$('#play-symbol').textContent='▶';$('#play-text').textContent='自动演示';}
function play(){if(!ready)return;if(playing){pause();return;}if(step===7)setStep(0,{auto:true});playing=true;autoNext=performance.now()+STEPS[step].duration;$('#play-symbol').textContent='Ⅱ';$('#play-text').textContent='暂停演示';}
$('#play').onclick=play;$('#previous').onclick=()=>setStep(step-1);$('#next').onclick=()=>setStep(step+1);

function setStep(n,{auto=false,initial=false}={}){
 if(!ready)return;
 n=Math.max(0,Math.min(7,n));if(!auto)pause();
 const prev=step;const hadOverride=hidden.size||isolated;
 step=n;hidden.clear();isolated=null;hideHistory=[];selectPart(null);updateStepUI();
 const records=[];
 for(const [id,g]of groups){
  const from=g.position.clone();const to=new THREE.Vector3(...poseFor(id,step));
  if(step===4&&prev<4&&/^battery_|^(hv|inverter|lv|cooling)$/.test(id))from.y=3.5+(id.startsWith('battery_')?Number(id.split('_')[1])*.18:0);
  if(step===6&&prev<6&&COVER_IDS.includes(id)){from.copy(new THREE.Vector3(...poseFor(id,1)));}
  g.position.copy(initial||reducedMotion?to:from);records.push({g,from,to});
 }
 poseAnimation=initial||reducedMotion?null:{start:performance.now(),duration:step===4?1900:950,records};
 applyVisibility();fitToModel({animate:!initial,targetPose:true});updatePartsUI();
 if(hadOverride&&!initial)toast('已恢复本步骤的默认显示');
 dirty=true;
 if(auto)autoNext=performance.now()+STEPS[step].duration;
}
function applyVisibility(){
 for(const [id,g]of groups)g.visible=effectiveVisible(id,step,hidden,isolated,partMap);
 // Ancestor groups keep child transforms; their own geometry must not enter an isolated child view.
 for(const mesh of meshes){const id=mesh.userData.semanticId;mesh.visible=!isolated||id===isolated||ancestors(id,partMap).includes(isolated);}
 const visible=parts.filter(p=>p.partId!=='track'&&effectiveVisible(p.partId,step,hidden,isolated,partMap));
 $('#empty-stage').hidden=visible.length>0;
 const modified=hidden.size>0||isolated;
 $('#visibility-status').hidden=!modified;$('#visibility-status').textContent=isolated?'正在隔离部件':`已隐藏 ${hidden.size} 项`;
 $('#quick-restore').hidden=!modified;$('#undo-hide').disabled=hideHistory.length===0;
 stage.dataset.hiddenCount=String(hidden.size);stage.dataset.isolated=isolated||'';
 dirty=true;
}
function snapshotVisibility(){hideHistory.push({hidden:new Set(hidden),isolated});if(hideHistory.length>30)hideHistory.shift();}
function restore(){if(!ready)return;hidden.clear();isolated=null;hideHistory=[];selectPart(null);applyVisibility();updatePartsUI();toast('已恢复本步骤');fitToModel();}
$('#restore-parts').onclick=restore;$('#quick-restore').onclick=restore;$('#empty-restore').onclick=restore;
$('#undo-hide').onclick=()=>{const last=hideHistory.pop();if(!last)return;hidden=last.hidden;isolated=last.isolated;applyVisibility();updatePartsUI();};
function hidePart(id){if(!id)return;pause();snapshotVisibility();hidden.add(id);if(isolated===id)isolated=null;selectPart(null);applyVisibility();updatePartsUI();toast(`已隐藏：${partMap.get(id)?.label||id}`);}
function isolatePart(id){if(!id)return;pause();snapshotVisibility();isolated=id;hidden.delete(id);for(const a of ancestors(id,partMap))hidden.delete(a);applyVisibility();updatePartsUI();fitToModel();toast('仅看所选部件，点击“恢复显示”返回');}
$('#hide-selected').onclick=()=>hidePart(selected);$('#isolate-selected').onclick=()=>isolatePart(selected);$('#clear-selection').onclick=()=>selectPart(null);
function selectPart(id){
 selected=id;$('#selection').hidden=!id;$('#selection-name').textContent=id?(partMap.get(id)?.label||id):'';
 for(const m of meshes){
  const pid=m.userData.semanticId;const active=id&&(pid===id||ancestors(pid,partMap).includes(id));
  if(active){if(!m.userData.selectedMaterial){m.userData.selectedMaterial=m.userData.originalMaterial.clone();m.userData.selectedMaterial.emissive=new THREE.Color('#bd682d');m.userData.selectedMaterial.emissiveIntensity=.22;}m.material=m.userData.selectedMaterial;}else m.material=m.userData.originalMaterial;
 }
 $$('.part-row').forEach(r=>r.classList.toggle('selected',r.dataset.part===id));stage.dataset.selected=id||'';dirty=true;
}
function categoryFor(p){if(p.partId.startsWith('motor_'))return'mechanical';return p.category;}
function buildPartList(){
 const categories=[['shell','车体包覆'],['mechanical','机械底盘'],['electrical','电气设备与连接'],['legacy','原柴油系统'],['track','轨道']];
 const list=$('#parts-list');list.replaceChildren();
 for(const [cat,label]of categories){
  const items=parts.filter(p=>categoryFor(p)===cat);if(!items.length)continue;
  const d=document.createElement('details');d.className='part-category';d.open=['shell','mechanical','electrical'].includes(cat);
  const summary=document.createElement('summary');summary.append(document.createTextNode(label));const count=document.createElement('span');count.className='category-count';count.textContent=String(items.length);summary.append(count);d.append(summary);
  for(const p of items){
   const row=document.createElement('label');row.className='part-row'+(p.parent?' child':'');row.dataset.part=p.partId;
   const input=document.createElement('input');input.type='checkbox';input.setAttribute('aria-label',`显示${p.label}`);
   input.onchange=()=>{pause();snapshotVisibility();if(input.checked){hidden.delete(p.partId);for(const a of ancestors(p.partId,partMap))hidden.delete(a);isolated=null;}else hidden.add(p.partId);if(selected===p.partId&&!input.checked)selectPart(null);applyVisibility();updatePartsUI();};
   const labelSpan=document.createElement('span');labelSpan.className='row-label';labelSpan.textContent=p.label;
   const hint=document.createElement('span');hint.className='unavailable-label';hint.textContent='本步未显示';
   const focus=document.createElement('button');focus.type='button';focus.className='focus-part';focus.textContent='◎';focus.setAttribute('aria-label',`定位${p.label}`);focus.onclick=e=>{e.preventDefault();pause();selectPart(p.partId);fitToModel({ids:[p.partId]});};
   row.append(input,labelSpan,hint,focus);d.append(row);
  }
  list.append(d);
 }
 updatePartsUI();
}
function updatePartsUI(){
 $('#track-toggle').checked=effectiveVisible('track',step,hidden,isolated,partMap);
 for(const r of $$('.part-row')){const id=r.dataset.part;const available=[id,...ancestors(id,partMap)].every(k=>ownStepVisible(k,step));const cb=r.querySelector('input');cb.checked=effectiveVisible(id,step,hidden,isolated,partMap);cb.disabled=!available;r.classList.toggle('unavailable',!available);r.querySelector('.unavailable-label').hidden=available;r.querySelector('button').disabled=!cb.checked;r.classList.toggle('selected',id===selected);}
 $('#undo-hide').disabled=hideHistory.length===0;
}
$('#part-search').oninput=e=>{const q=e.target.value.trim().toLocaleLowerCase();for(const r of $$('.part-row'))r.hidden=!r.querySelector('.row-label').textContent.toLocaleLowerCase().includes(q);for(const d of $$('.part-category')){d.hidden=![...d.querySelectorAll('.part-row')].some(r=>!r.hidden);if(q)d.open=true;}};
$('#show-electric').onclick=()=>{setStep(5);setPanel('parts');};$('#show-mechanical').onclick=()=>{setStep(3);setPanel('parts');};

function currentDirection(){return camera.position.clone().sub(controls.target).normalize();}
function defaultDirection(){return stage.clientWidth/stage.clientHeight<.95?new THREE.Vector3(1.9,1.28,1):new THREE.Vector3(1.05,.72,1.34);}
function getBounds(ids=null,targetPose=false){
 const restorePos=[];
 if(targetPose&&poseAnimation)for(const r of poseAnimation.records){restorePos.push([r.g,r.g.position.clone()]);r.g.position.copy(r.to);}
 model.updateMatrixWorld(true);
 const b=new THREE.Box3();
 for(const m of visibleMeshes()){
  const pid=m.userData.semanticId;if(pid==='track')continue;
  if(ids&&!ids.includes(pid)&&!ids.some(id=>ancestors(pid,partMap).includes(id)))continue;
  if(!m.geometry.boundingBox)m.geometry.computeBoundingBox();b.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld));
 }
 for(const [g,pos]of restorePos)g.position.copy(pos);if(restorePos.length)model.updateMatrixWorld(true);
 return b.isEmpty()?new THREE.Box3(new THREE.Vector3(-9,0,-1.7),new THREE.Vector3(9,4.7,1.7)):b;
}
function fitToModel({animate=true,ids=null,direction=null,targetPose=false}={}){
 if(!ready)return;
 focusedIds=ids;
 const bounds=getBounds(ids,targetPose),target=bounds.getCenter(new THREE.Vector3());
 const dir=(direction||currentDirection()).clone().normalize();
 const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),dir).normalize();
 if(right.length()<.1)right.set(1,0,0);
 const up=new THREE.Vector3().crossVectors(dir,right).normalize();
 const tanV=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));const tanH=tanV*camera.aspect;
 let distance=1;
 for(let a=0;a<8;a++){const p=new THREE.Vector3(a&1?bounds.max.x:bounds.min.x,a&2?bounds.max.y:bounds.min.y,a&4?bounds.max.z:bounds.min.z).sub(target);distance=Math.max(distance,Math.abs(p.dot(right))/tanH+p.dot(dir),Math.abs(p.dot(up))/tanV+p.dot(dir));}
 const pad=ids?1.27:(camera.aspect<1?1.17:1.15);distance*=pad;
 const dest=target.clone().addScaledVector(dir,distance);
 camera.near=Math.max(.02,distance/1000);camera.far=500;camera.updateProjectionMatrix();controls.maxDistance=Math.max(85,distance*3);controls.minDistance=1.2;
 if(animate&&!reducedMotion)cameraAnimation={start:performance.now(),duration:800,from:camera.position.clone(),to:dest,fromTarget:controls.target.clone(),toTarget:target};
 else{camera.position.copy(dest);controls.target.copy(target);camera.lookAt(target);controls.update();cameraAnimation=null;}
 dirty=true;
}
$('#fit').onclick=()=>{pause();fitToModel();};
function setView(name){
 if(!ready)return;pause();view=name;
 if(name==='electrical'&&step!==5)setStep(5);
 if(name==='bogie'&&step!==3)setStep(3);
 const directions={overall:defaultDirection(),side:new THREE.Vector3(0,.13,1),front:new THREE.Vector3(1,.16,0),top:new THREE.Vector3(0,1,.0001),bogie:new THREE.Vector3(1,.72,1.5),electrical:defaultDirection()};
 const ids=name==='bogie'?['bogie_front']:null;
 fitToModel({ids,direction:directions[name]||defaultDirection(),targetPose:true});
 $$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
}
$$('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
function toggleRotate(){if(!ready)return;pause();autoRotate=!autoRotate;controls.autoRotate=autoRotate;$('#rotate-toggle').setAttribute('aria-pressed',autoRotate);$('#rotate-toggle').setAttribute('aria-label',autoRotate?'停止自动旋转':'开启自动旋转');dirty=true;}
$('#rotate-toggle').onclick=toggleRotate;
$('#track-toggle').onchange=e=>{pause();snapshotVisibility();if(e.target.checked)hidden.delete('track');else hidden.add('track');applyVisibility();updatePartsUI();};
$('#shadow-toggle').checked=shadows;
$('#shadow-toggle').onchange=e=>{shadows=e.target.checked;renderer.shadowMap.enabled=shadows;light.castShadow=shadows;for(const m of meshes)m.material.needsUpdate=true;dirty=true;};
$('#fullscreen').onclick=async()=>{
 pause();
 try{if(document.fullscreenElement){await document.exitFullscreen();}else if(stage.requestFullscreen){await stage.requestFullscreen();}else{document.body.classList.toggle('full-stage');resize();}}
 catch{document.body.classList.toggle('full-stage');resize();}
};
document.addEventListener('fullscreenchange',()=>{setTimeout(resize,50);$('#fullscreen').setAttribute('aria-label',document.fullscreenElement?'退出全屏':'全屏查看');});

$('#share').onclick=async()=>{
 if(!ready){toast('模型加载完成后可分享当前步骤');return;}
 const p=new URLSearchParams({step:String(step),view});const sharedHidden=new Set(hidden);if(sharedHidden.size)p.set('hide',[...sharedHidden].join(','));if(isolated)p.set('only',isolated);if(focusedIds?.length)p.set('focus',focusedIds.join(','));
 const dir=currentDirection();p.set('angle',[dir.x,dir.y,dir.z].map(n=>n.toFixed(3)).join(','));
 const url=new URL(location.href);url.hash=p.toString();
 try{await navigator.clipboard.writeText(url.href);history.replaceState(null,'',url);toast('分享链接已复制，包含当前步骤与消隐状态');}
 catch{if(navigator.share){try{await navigator.share({title:'机车油改电 · 三维拆换',url:url.href});}catch{}}else{history.replaceState(null,'',url);toast('当前视图已写入地址，请复制浏览器地址分享');}}
};
canvas.addEventListener('keydown',e=>{if(!ready)return;if(['ArrowLeft','ArrowRight',' ','Home','Escape'].includes(e.key))e.preventDefault();if(e.key==='ArrowLeft')setStep(step-1);if(e.key==='ArrowRight')setStep(step+1);if(e.key===' ')play();if(e.key==='Home')fitToModel();if(e.key==='Escape'){if(document.body.classList.contains('full-stage')){document.body.classList.remove('full-stage');resize();}else if(isolated)restore();else selectPart(null);}});
let down=null,moved=0,multiTouch=false;const pointers=new Set();
canvas.addEventListener('pointerdown',e=>{pointers.add(e.pointerId);if(pointers.size>1)multiTouch=true;if(e.button===0){down={x:e.clientX,y:e.clientY,t:performance.now()};moved=0;}});
canvas.addEventListener('pointermove',e=>{if(down)moved=Math.max(moved,Math.hypot(e.clientX-down.x,e.clientY-down.y));});
canvas.addEventListener('pointerup',e=>{
 pointers.delete(e.pointerId);
 if(ready&&down&&!multiTouch&&moved<7&&performance.now()-down.t<600&&e.button===0){const rect=canvas.getBoundingClientRect();const pointer=new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);const ray=new THREE.Raycaster();ray.setFromCamera(pointer,camera);const hits=ray.intersectObjects(visibleMeshes(),false);selectPart(hits[0]?.object.userData.semanticId??null);}
 down=null;if(!pointers.size)multiTouch=false;
});
canvas.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);down=null;if(!pointers.size)multiTouch=false;});
function resize(){
 if(!renderer)return;const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);renderer.setPixelRatio(Math.min(devicePixelRatio,w<700?1.5:1.75));
 $('#gesture-hint').textContent=matchMedia('(pointer:coarse)').matches?'单指旋转 · 双指缩放 / 平移 · 点击部件':'拖动旋转 · 滚轮缩放 · 点击部件';
 clearTimeout(resizeTimer);if(ready)resizeTimer=setTimeout(()=>fitToModel({animate:false,ids:focusedIds,direction:view==='overall'?defaultDirection():currentDirection(),targetPose:true}),120);dirty=true;
}
new ResizeObserver(resize).observe(stage);document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();autoRotate=false;if(controls)controls.autoRotate=false;$('#rotate-toggle').setAttribute('aria-pressed','false');}else dirty=true;});
function tick(time){
 requestAnimationFrame(tick);if(!renderer||document.hidden)return;const dt=Math.min((time-lastTimestamp)/1000,.06);lastTimestamp=time;
 if(poseAnimation){const t=Math.min((time-poseAnimation.start)/poseAnimation.duration,1),s=t*t*(3-2*t);for(const r of poseAnimation.records)r.g.position.lerpVectors(r.from,r.to,s);if(t===1)poseAnimation=null;dirty=true;}
 if(cameraAnimation){const t=Math.min((time-cameraAnimation.start)/cameraAnimation.duration,1),s=t*t*(3-2*t);camera.position.lerpVectors(cameraAnimation.from,cameraAnimation.to,s);controls.target.lerpVectors(cameraAnimation.fromTarget,cameraAnimation.toTarget,s);if(t===1)cameraAnimation=null;dirty=true;}
 if(controls?.update(dt))dirty=true;
 if(ready&&playing&&time>=autoNext){if(step<7)setStep(step+1,{auto:true});else pause();}
 if(dirty){renderer.render(scene,camera);dirty=false;}
}
function fail(message){$('#loading').hidden=false;$('.loader-dot').hidden=true;$('#loading-title').textContent='三维模型暂未加载';$('#loading-progress').textContent=message;$('.loading-track').hidden=true;$('#retry').hidden=false;$('#fallback-video').hidden=false;pause();stage.dataset.ready='error';}
async function init(){
 try{
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;renderer.shadowMap.enabled=shadows;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.setClearColor(0x000000,0);
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(38,1,.05,500);camera.position.set(24,16,28);
  const pmrem=new THREE.PMREMGenerator(renderer);const room=new RoomEnvironment();const env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.85;room.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xeaf6ff,0x899878,1.15));light=new THREE.DirectionalLight(0xfff4df,2.4);light.position.set(6,17,8);light.castShadow=shadows;light.shadow.mapSize.set(1024,1024);light.shadow.camera.left=-15;light.shadow.camera.right=15;light.shadow.camera.top=15;light.shadow.camera.bottom=-15;light.shadow.normalBias=.08;light.shadow.bias=-.0003;scene.add(light);scene.add(light.target);
  const fill=new THREE.DirectionalLight(0xcde6ef,1.0);fill.position.set(-10,8,-9);scene.add(fill);
  ground=new THREE.Mesh(new THREE.PlaneGeometry(180,180),new THREE.ShadowMaterial({color:0x46614a,opacity:.16}));ground.rotation.x=-Math.PI/2;ground.position.y=-.12;ground.receiveShadow=true;scene.add(ground);
  controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.085;controls.target.set(0,2,0);controls.maxPolarAngle=Math.PI*.51;controls.minDistance=1.2;controls.maxDistance=120;controls.autoRotateSpeed=.45;controls.screenSpacePanning=true;controls.addEventListener('change',()=>dirty=true);controls.addEventListener('start',()=>{pause();cameraAnimation=null;if(autoRotate){autoRotate=false;controls.autoRotate=false;$('#rotate-toggle').setAttribute('aria-pressed','false');}});
  resize();requestAnimationFrame(tick);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();fail('图形资源不足。关闭其他页面后重试，或先观看拆换视频。');});
  const manifestResponse=await fetch(`${BASE}assets/model-manifest.json`);if(!manifestResponse.ok)throw new Error('模型目录不可用');const manifest=await manifestResponse.json();parts=manifest.parts;partMap=new Map(parts.map(p=>[p.partId,p]));
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf=await loader.loadAsync(`${BASE}assets/model.glb`,ev=>{const progress=ev.total?ev.loaded/ev.total:Math.min(ev.loaded/2400000,.96);$('#loading-bar').style.width=`${Math.round(progress*100)}%`;$('#loading-progress').textContent=progress>=1?'模型已下载，正在准备材质…':`已下载 ${Math.round(progress*100)}%`;});
  model=gltf.scene;scene.add(model);
  model.traverse(o=>{const id=o.userData.partId;if(id&&partMap.has(id)&&!groups.has(id))groups.set(id,o);});
  if(groups.size!==parts.length)throw new Error('模型部件不完整');
  model.traverse(o=>{if(!o.isMesh)return;let node=o,id;while(node&&!id){id=node.userData.partId;node=node.parent;}if(!id)return;o.userData.semanticId=id;meshes.push(o);o.castShadow=true;o.receiveShadow=true;const m=o.material;if(m.isMeshStandardMaterial){m.envMapIntensity=.75;m.metalness=Math.min(m.metalness,.88);m.roughness=Math.max(m.roughness,.28);}o.userData.originalMaterial=m;});
  ready=true;stage.dataset.ready='true';stage.dataset.parts=String(parts.length);buildPartList();
  const shared=parseHash(location.hash,partMap);step=shared.step;setStep(step,{initial:true});hidden=shared.hidden;isolated=shared.isolate;view=shared.view;applyVisibility();updatePartsUI();
  const params=new URLSearchParams(location.hash.slice(1));const a=(params.get('angle')||'').split(',').map(Number);let direction=defaultDirection();if(a.length===3&&a.every(n=>Number.isFinite(n)&&Math.abs(n)<=1)&&Math.hypot(...a)>.8)direction=new THREE.Vector3(...a);
  else if(view==='side')direction=new THREE.Vector3(0,.13,1);else if(view==='front')direction=new THREE.Vector3(1,.16,0);else if(view==='top')direction=new THREE.Vector3(0,1,.0001);
  const focus=(params.get('focus')||'').split(',').filter(id=>partMap.has(id)&&effectiveVisible(id,step,hidden,isolated,partMap));
  fitToModel({animate:false,direction,ids:focus.length?focus:null});$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('#track-toggle').checked=effectiveVisible('track',step,hidden,isolated,partMap);$('#loading').hidden=true;updateStepUI();dirty=true;
 }catch(error){console.error(error);fail(renderer?'请检查网络后重试。也可先观看拆换视频。':'当前浏览器不能使用三维图形。请换用较新的浏览器，或观看拆换视频。');}
}
init();
