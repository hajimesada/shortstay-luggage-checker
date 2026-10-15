'use strict';

const APP_VERSION = '0.4.6';
const DB_NAME = 'shortstay-luggage-db';
const DB_VERSION = 1;
const STORE = 'sessions';

const DEFAULT_CATEGORIES = [
  ['タオル','🟦'],['上着','🧥'],['シャツ','👕'],['ズボン','👖'],
  ['肌着','🩲'],['靴下','🧦'],['靴','👟'],['バッグ','👜'],
  ['パジャマ','🌙'],['その他','✏️']
];
let CATEGORIES = loadCategorySettings();

const state = {
  db: null,
  sessions: [],
  currentSession: null,
  photos: [],
  photoIndex: 0,
  selectedRect: null,
  selectionRatio: 0.44,
  selectionPointers: new Map(),
  selectionGesture: null,
  audioCtx: null,
  undo: [],
  redo: [],
  cameraStream: null,
  scanTimer: null,
  scanBusy: false,
  consecutiveKey: null,
  consecutiveHits: 0,
  lockUntilClear: false,
  clearFrames: 0,
  currentCandidate: null,
  lastMatchDetail: null,
  lastLogAt: 0,
  testLogs: [],
  registerBusy: false,
  lastCategoryActivation: 0,
  highThreshold: Number(localStorage.getItem('highThreshold') || 80) / 100,
  lowThreshold: Number(localStorage.getItem('lowThreshold') || 65) / 100,
  // バックグラウンド画像認識キュー管理
  bgQueue: [],
  bgTotal: 0,
  bgCompleted: 0,
  bgCurrentTask: null,
  bgCurrentProgress: 0,
  bgCurrentStepText: '',
  bgProcessing: false,
  bgHideTimer: null,
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const els = {};

window.addEventListener('DOMContentLoaded', init);

async function init(){
  cacheEls();
  bindUI();
  buildCategories();
  state.db = await openDB();
  await refreshSessions();
  loadSettings();
  renderCategoryManager();
  loadTestLogs();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=046').catch(()=>{});
  }
  setStatus(`v${APP_VERSION} / 端末内保存・サーバ送信なし`);
}

function cacheEls(){
  ['homeScreen','registerScreen','checkScreen','settingsScreen','statusText','homeSessions','residentName','newSessionBtn',
   'registerSessionSelect','photoInput','photoStage','registerCanvas','photoHint','photoNav','prevPhoto','nextPhoto','photoCounter',
   'selectionNote','categoryGrid','customRow','customCategory','customAddBtn','undoBtn','redoBtn','registerHistory','finishRegister',
   'summaryModal','summaryList','summaryTotal','summaryBgStatus','backToEdit','confirmRegister','checkSessionSelect','cameraVideo','cameraCanvas','matchBadge',
   'successPop','successText','candidateName','scoreText','scoreBar','matchQuestion','matchQuestionEmoji','matchQuestionMain','matchQuestionSub','startCamera','stopCamera','captureInput','manualConfirm','checkList',
   'resetChecks','highThreshold','lowThreshold','highThresholdLabel','lowThresholdLabel','exportBtn','importInput','homeBtn','settingsBtn',
   'goRegister','goCheck','matchDetails','testLogCount','exportLogBtn','clearLogBtn','categoryManager','newCategoryName','newCategoryEmoji','addCategoryBtn','resetCategoriesBtn',
   'registerSuccessPop','registerSuccessText','registerSuccessCount','selectionShrink','selectionGrow',
   'bgRecogPanel','bgRecogSpinner','bgRecogTitle','bgRecogMeta','bgRecogFill','bgRecogSub'].forEach(id=>els[id]=$(`#${id}`));
}

function bindUI(){
  els.goRegister.onclick=()=>showScreen('registerScreen');
  els.goCheck.onclick=()=>showScreen('checkScreen');
  els.homeBtn.onclick=()=>showScreen('homeScreen');
  els.settingsBtn.onclick=()=>showScreen('settingsScreen');
  els.newSessionBtn.onclick=newRegistration;
  els.registerSessionSelect.onchange=loadRegistrationSession;
  els.photoInput.onchange=loadPhotos;
  els.prevPhoto.onclick=()=>changePhoto(-1);
  els.nextPhoto.onclick=()=>changePhoto(1);
  bindSelectionCanvasGestures();
  $$('.size-selector button[data-size]').forEach(b=>b.onclick=()=>{
    $$('.size-selector button[data-size]').forEach(x=>x.classList.remove('selected'));
    b.classList.add('selected');
    state.selectionRatio=Number(b.dataset.size);
    if(state.selectedRect) recalcSelectionFromCenter();
  });
  els.selectionShrink.onclick=()=>scaleSelection(.86);
  els.selectionGrow.onclick=()=>scaleSelection(1.16);
  els.customAddBtn.onclick=()=>registerSelection(els.customCategory.value.trim() || 'その他');
  els.undoBtn.onclick=undo;
  els.redoBtn.onclick=redo;
  els.finishRegister.onclick=showSummary;
  els.backToEdit.onclick=()=>els.summaryModal.classList.add('hidden');
  els.confirmRegister.onclick=confirmRegistration;
  els.checkSessionSelect.onchange=renderCheckList;
  els.startCamera.onclick=startCamera;
  els.stopCamera.onclick=stopCamera;
  els.captureInput.onchange=matchCapturedPhoto;
  els.manualConfirm.onclick=manualConfirm;
  els.resetChecks.onclick=resetChecks;
  els.highThreshold.oninput=saveThresholds;
  els.lowThreshold.oninput=saveThresholds;
  els.exportBtn.onclick=exportBackup;
  els.importInput.onchange=importBackup;
  els.exportLogBtn.onclick=exportTestLog;
  els.clearLogBtn.onclick=clearTestLog;
  els.addCategoryBtn.onclick=addCategoryFromSettings;
  els.resetCategoriesBtn.onclick=resetCategories;
  document.addEventListener('visibilitychange',()=>{ if(document.hidden) stopCamera(); });
  document.addEventListener('pointerdown',()=>ensureAudio(),{once:true,capture:true});
}

function showScreen(id){
  if(id!=='checkScreen') stopCamera();
  $$('.screen').forEach(s=>s.classList.remove('active'));
  $(`#${id}`).classList.add('active');
  if(id==='homeScreen') renderHome();
  if(id==='checkScreen'){ populateCheckSelect(); renderCheckList(); }
  if(id==='registerScreen') populateRegisterSelect();
}

function setStatus(t){ els.statusText.textContent=t; }
function toast(t){
  const x=$('#toast'); x.textContent=t; x.classList.add('show');
  clearTimeout(toast._t); toast._t=setTimeout(()=>x.classList.remove('show'),1900);
}

function loadCategorySettings(){
  try{
    const saved=JSON.parse(localStorage.getItem('shortstayCategories')||'null');
    if(Array.isArray(saved) && saved.length){
      const out=[];
      for(const row of saved){
        if(!Array.isArray(row) || !String(row[0]||'').trim()) continue;
        const name=String(row[0]).trim();
        const emoji=String(row[1]||'📦').trim() || '📦';
        if(name!=='その他' && !out.some(x=>x[0]===name)) out.push([name,emoji]);
      }
      out.push(['その他','✏️']);
      return out;
    }
  }catch(e){}
  return DEFAULT_CATEGORIES.map(x=>[...x]);
}
function saveCategorySettings(){
  localStorage.setItem('shortstayCategories',JSON.stringify(CATEGORIES));
  buildCategories();
  renderCategoryManager();
}
function renderCategoryManager(){
  if(!els.categoryManager)return;
  els.categoryManager.innerHTML='';
  CATEGORIES.forEach(([name,emoji],idx)=>{
    const row=document.createElement('div'); row.className='category-manage-row';
    const fixed=name==='その他';
    row.innerHTML=`<div class="category-preview"><span>${escapeHtml(emoji)}</span><b>${escapeHtml(name)}</b>${fixed?'<small>固定</small>':''}</div><div class="category-actions"><button class="small-btn" data-up ${idx===0||fixed?'disabled':''}>↑</button><button class="small-btn" data-down ${idx>=CATEGORIES.length-2||fixed?'disabled':''}>↓</button><button class="small-btn" data-edit ${fixed?'disabled':''}>編集</button><button class="small-btn danger-lite" data-del ${fixed?'disabled':''}>削除</button></div>`;
    row.querySelector('[data-up]').onclick=()=>moveCategory(idx,-1);
    row.querySelector('[data-down]').onclick=()=>moveCategory(idx,1);
    row.querySelector('[data-edit]').onclick=()=>editCategory(idx);
    row.querySelector('[data-del]').onclick=()=>deleteCategory(idx);
    els.categoryManager.appendChild(row);
  });
}
function addCategoryFromSettings(){
  const name=String(els.newCategoryName.value||'').trim();
  const emoji=String(els.newCategoryEmoji.value||'').trim()||'📦';
  if(!name){toast('項目名を入力してください');return;}
  if(name==='その他' || CATEGORIES.some(x=>x[0]===name)){toast('同じ項目名があります');return;}
  CATEGORIES.splice(Math.max(0,CATEGORIES.length-1),0,[name,emoji]);
  els.newCategoryName.value=''; els.newCategoryEmoji.value='';
  saveCategorySettings(); toast(`${name} を追加しました`);
}
function moveCategory(idx,delta){
  const to=idx+delta;
  if(idx<0||to<0||idx>=CATEGORIES.length-1||to>=CATEGORIES.length-1)return;
  [CATEGORIES[idx],CATEGORIES[to]]=[CATEGORIES[to],CATEGORIES[idx]];
  saveCategorySettings();
}
async function editCategory(idx){
  const old=CATEGORIES[idx]; if(!old||old[0]==='その他')return;
  const newName=prompt('項目名を編集',old[0]); if(newName===null)return;
  const name=String(newName).trim(); if(!name){toast('項目名は空にできません');return;}
  if(name!=='その他' && CATEGORIES.some((x,i)=>i!==idx&&x[0]===name)){toast('同じ項目名があります');return;}
  const newEmoji=prompt('アイコン（絵文字）を編集',old[1]||'📦'); if(newEmoji===null)return;
  const emoji=String(newEmoji).trim()||'📦';
  const oldName=old[0]; CATEGORIES[idx]=[name,emoji]; saveCategorySettings();
  if(oldName!==name){
    for(const s of state.sessions){
      let changed=false; for(const it of (s.items||[])){if(it.category===oldName){it.category=name;changed=true;}}
      if(changed){s.updatedAt=new Date().toISOString(); await idbPut(s);}
    }
    if(state.currentSession){for(const it of (state.currentSession.items||[])){if(it.category===oldName)it.category=name;}}
    await refreshSessions();
    renderHistory();
  }
  toast(`${oldName} →${name} に変更しました`);
}
function deleteCategory(idx){
  const row=CATEGORIES[idx]; if(!row||row[0]==='その他')return;
  const name=row[0];
  if(!confirm(`${name} を項目一覧から削除しますか？\nすでに登録済みの荷物データは削除されません。`))return;
  CATEGORIES.splice(idx,1); saveCategorySettings(); toast(`${name} を項目一覧から削除しました`);
}
function resetCategories(){
  if(!confirm('項目一覧を初期状態に戻しますか？\n登録済みの荷物データは削除されません。'))return;
  CATEGORIES=DEFAULT_CATEGORIES.map(x=>[...x]); saveCategorySettings(); toast('項目一覧を初期状態に戻しました');
}

function buildCategories(){
  els.categoryGrid.innerHTML='';
  for(const [name,emoji] of CATEGORIES){
    const b=document.createElement('button');
    b.type='button';
    b.className='cat-btn';
    b.dataset.category=name;
    b.innerHTML=`<span class="emoji">${emoji}</span>${name}`;

    const activate=()=>{
      const now=Date.now();
      if(now-state.lastCategoryActivation<420)return;
      state.lastCategoryActivation=now;
      b.classList.add('cat-tapped');
      setTimeout(()=>b.classList.remove('cat-tapped'),260);
      if(name==='その他'){
        els.customRow.classList.toggle('hidden');
        if(!els.customRow.classList.contains('hidden')) els.customCategory.focus();
      }else{
        registerSelection(name,b);
      }
    };
    b.addEventListener('pointerup',activate);
    b.addEventListener('click',activate);
    els.categoryGrid.appendChild(b);
  }
}

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'id'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

function idbAll(){
  return new Promise((resolve,reject)=>{
    const tx=state.db.transaction(STORE,'readonly'); const req=tx.objectStore(STORE).getAll();
    req.onsuccess=()=>resolve(req.result||[]); req.onerror=()=>reject(req.error);
  });
}
function idbPut(obj){
  return new Promise((resolve,reject)=>{
    const tx=state.db.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(obj);
    tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);
  });
}
function idbDelete(id){
  return new Promise((resolve,reject)=>{
    const tx=state.db.transaction(STORE,'readwrite'); tx.objectStore(STORE).delete(id);
    tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);
  });
}

async function refreshSessions(){
  state.sessions=(await idbAll()).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  renderHome(); populateRegisterSelect(); populateCheckSelect();
}

function renderHome(){
  if(!state.sessions.length){ els.homeSessions.className='session-list empty'; els.homeSessions.textContent='まだ登録はありません'; return; }
  els.homeSessions.className='session-list'; els.homeSessions.innerHTML='';
  for(const s of state.sessions){
    const row=document.createElement('div'); row.className='session-row';
    const done=(s.items||[]).filter(x=>x.checked).length, total=(s.items||[]).length;
    row.innerHTML=`<div class="grow"><b>${escapeHtml(s.name||'名称未設定')}</b><div><span class="chip">${total}点</span> <span class="chip">確認 ${done}/${total}</span></div></div><button class="small-btn" data-check>確認</button><button class="small-btn danger-lite" data-del>削除</button>`;
    row.querySelector('[data-check]').onclick=()=>{ showScreen('checkScreen'); els.checkSessionSelect.value=s.id; renderCheckList(); };
    row.querySelector('[data-del]').onclick=async()=>{ if(confirm(`${s.name} の登録を削除しますか？`)){ await idbDelete(s.id); await refreshSessions(); } };
    els.homeSessions.appendChild(row);
  }
}

function populateRegisterSelect(){
  const currentId = state.currentSession?.id || '';
  els.registerSessionSelect.innerHTML='<option value="">新規登録</option>' + state.sessions.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}（${s.items.length}点）</option>`).join('');
  if(currentId && state.sessions.some(s=>s.id===currentId)){
    els.registerSessionSelect.value=currentId;
  }else{
    els.registerSessionSelect.value='';
  }
}
function populateCheckSelect(){
  const current=els.checkSessionSelect.value;
  els.checkSessionSelect.innerHTML='<option value="">対象を選択</option>' + state.sessions.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}（${s.items.length}点）</option>`).join('');
  if(state.sessions.some(s=>s.id===current)) els.checkSessionSelect.value=current;
}

function makeId(){
  try{
    if(window.crypto && typeof window.crypto.randomUUID==='function') return window.crypto.randomUUID();
  }catch(e){}
  return 'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
}
function safeClone(value){
  try{
    if(typeof structuredClone==='function') return structuredClone(value);
  }catch(e){}
  return JSON.parse(JSON.stringify(value));
}

function resetRegistrationState(){
  state.currentSession={id:makeId(),name:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),items:[]};
  state.photos=[]; state.photoIndex=0; state.selectedRect=null; state.undo=[]; state.redo=[];
  if(els.registerSessionSelect) els.registerSessionSelect.value='';
  if(els.residentName) els.residentName.value='';
  if(els.photoInput) els.photoInput.value='';
  clearRegisterCanvas(); renderHistory(); updateUndoRedo();
}

function newRegistration(){
  resetRegistrationState();
  toast('新規登録を開始しました');
}

function ensureCurrentSession(){
  if(state.currentSession) return state.currentSession;
  state.currentSession={
    id:makeId(),
    name:'',
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString(),
    items:[]
  };
  return state.currentSession;
}

function loadRegistrationSession(){
  const id=els.registerSessionSelect.value;
  if(!id){ newRegistration(); return; }
  const s=state.sessions.find(x=>x.id===id); if(!s) return;
  state.currentSession=safeClone(s); state.photos=[]; state.photoIndex=0; state.selectedRect=null; state.undo=[]; state.redo=[];
  els.residentName.value=s.name||''; clearRegisterCanvas(); renderHistory(); updateUndoRedo();
}

async function loadPhotos(e){
  const files=[...(e.target.files||[])]; if(!files.length) return;
  const loaded=[];
  for(const f of files){
    try{
      const data=await fileToDataURL(f); const img=await loadImage(data);
      const normalized=await normalizeImage(img,1600,.84);
      const nimg=await loadImage(normalized);
      loaded.push({data:normalized,img:nimg,name:f.name});
    }catch(err){ console.error(err); }
  }
  if(!loaded.length){ toast('写真を読み込めませんでした'); return; }
  state.photos=loaded; state.photoIndex=0; state.selectedRect=null;
  drawRegisterPhoto();
}

function clearRegisterCanvas(){
  if(!els.registerCanvas) return;
  const c=els.registerCanvas,ctx=c.getContext('2d'); c.width=800;c.height=520;ctx.clearRect(0,0,c.width,c.height);
  els.photoHint?.classList.remove('hidden'); els.photoNav?.classList.add('hidden');
}

function changePhoto(delta){
  if(!state.photos.length) return;
  state.photoIndex=(state.photoIndex+delta+state.photos.length)%state.photos.length; state.selectedRect=null; drawRegisterPhoto();
}

function drawRegisterPhoto(){
  const p=state.photos[state.photoIndex]; if(!p){ clearRegisterCanvas(); return; }
  const c=els.registerCanvas,ctx=c.getContext('2d'),img=p.img;
  const maxW=1200,maxH=900,scale=Math.min(maxW/img.width,maxH/img.height,1);
  c.width=Math.max(1,Math.round(img.width*scale)); c.height=Math.max(1,Math.round(img.height*scale));
  ctx.drawImage(img,0,0,c.width,c.height);
  const items=(state.currentSession?.items||[]).filter(x=>x.sourcePhotoIndex===state.photoIndex && x.marker);
  items.forEach((it,i)=>{
    const r=it.marker; ctx.strokeStyle='rgba(77,255,195,.95)';ctx.lineWidth=4;ctx.strokeRect(r.x*c.width,r.y*c.height,r.w*c.width,r.h*c.height);
    ctx.fillStyle='rgba(18,48,54,.82)';ctx.fillRect(r.x*c.width,r.y*c.height,Math.min(155,r.w*c.width),28);
    ctx.fillStyle='#fff';ctx.font='bold 16px sans-serif';ctx.fillText(`${it.category}${i+1}`,r.x*c.width+7,r.y*c.height+20);
  });
  if(state.selectedRect){
    const r=state.selectedRect; ctx.fillStyle='rgba(255,207,74,.10)';ctx.fillRect(r.x*c.width,r.y*c.height,r.w*c.width,r.h*c.height);ctx.strokeStyle='#ffcf4a';ctx.lineWidth=5;ctx.setLineDash([12,7]);ctx.strokeRect(r.x*c.width,r.y*c.height,r.w*c.width,r.h*c.height);ctx.setLineDash([]);
    ctx.fillStyle='#ffcf4a';[[r.x,r.y],[r.x+r.w,r.y],[r.x,r.y+r.h],[r.x+r.w,r.y+r.h]].forEach(([hx,hy])=>{ctx.beginPath();ctx.arc(hx*c.width,hy*c.height,8,0,Math.PI*2);ctx.fill();});
  }
  els.photoHint.classList.add('hidden'); els.photoNav.classList.toggle('hidden',state.photos.length<2);
  els.photoCounter.textContent=`${state.photoIndex+1} /${state.photos.length}`;
  els.selectionNote.textContent=state.selectedRect?'選択中：1本指で移動 / 2本指で拡大・縮小 → 下の項目をタップ':'物品をタップ → 1本指で移動 / 2本指で拡大・縮小できます';
}

function canvasPointerPos(ev){
  const rect=els.registerCanvas.getBoundingClientRect();
  return {
    x:clamp((ev.clientX-rect.left)/Math.max(1,rect.width),0,1),
    y:clamp((ev.clientY-rect.top)/Math.max(1,rect.height),0,1),
    clientX:ev.clientX,clientY:ev.clientY
  };
}
function pointInSelection(p,r=state.selectedRect){
  return !!r && p.x>=r.x && p.x<=r.x+r.w && p.y>=r.y && p.y<=r.y+r.h;
}
function makeSelectionAt(x,y,size=state.selectionRatio){
  const c=els.registerCanvas,ratio=c.height/Math.max(1,c.width);
  let w=clamp(size,.10,.92),h=clamp(size/Math.max(.6,ratio),.10,.92);
  const cx=clamp(x,w/2,1-w/2),cy=clamp(y,h/2,1-h/2);
  return {x:cx-w/2,y:cy-h/2,w,h,cx,cy};
}
function normalizeRectFromCenter(cx,cy,w,h){
  w=clamp(w,.08,.96);h=clamp(h,.08,.96);
  cx=clamp(cx,w/2,1-w/2);cy=clamp(cy,h/2,1-h/2);
  return {x:cx-w/2,y:cy-h/2,w,h,cx,cy};
}
function bindSelectionCanvasGestures(){
  const c=els.registerCanvas;
  c.style.touchAction='none';
  c.addEventListener('pointerdown',selectionPointerDown,{passive:false});
  c.addEventListener('pointermove',selectionPointerMove,{passive:false});
  c.addEventListener('pointerup',selectionPointerUp,{passive:false});
  c.addEventListener('pointercancel',selectionPointerUp,{passive:false});
}
function selectionPointerDown(ev){
  if(!state.photos.length)return;
  ev.preventDefault();ensureAudio();
  try{els.registerCanvas.setPointerCapture(ev.pointerId);}catch(e){}
  const p=canvasPointerPos(ev);state.selectionPointers.set(ev.pointerId,p);
  if(state.selectionPointers.size===1){
    if(!pointInSelection(p)){state.selectedRect=makeSelectionAt(p.x,p.y);drawRegisterPhoto();}
    state.selectionGesture={mode:'drag',start:p,startRect:{...state.selectedRect}};
  }else if(state.selectionPointers.size>=2){
    const pts=[...state.selectionPointers.values()].slice(0,2);
    const mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
    if(!state.selectedRect)state.selectedRect=makeSelectionAt(mid.x,mid.y);
    state.selectionGesture={
      mode:'pinch',
      startDist:Math.max(8,Math.hypot(pts[0].clientX-pts[1].clientX,pts[0].clientY-pts[1].clientY)),
      startMid:mid,startRect:{...state.selectedRect}
    };
  }
}
function selectionPointerMove(ev){
  if(!state.selectionPointers.has(ev.pointerId)||!state.photos.length)return;
  ev.preventDefault();
  state.selectionPointers.set(ev.pointerId,canvasPointerPos(ev));
  const pts=[...state.selectionPointers.values()];
  if(pts.length>=2){
    if(!state.selectionGesture||state.selectionGesture.mode!=='pinch'){
      const mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
      state.selectionGesture={mode:'pinch',startDist:Math.max(8,Math.hypot(pts[0].clientX-pts[1].clientX,pts[0].clientY-pts[1].clientY)),startMid:mid,startRect:{...state.selectedRect}};
    }
    const g=state.selectionGesture,curDist=Math.max(8,Math.hypot(pts[0].clientX-pts[1].clientX,pts[0].clientY-pts[1].clientY));
    const scale=clamp(curDist/g.startDist,.35,3.2),mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
    const sr=g.startRect,cx=sr.cx+(mid.x-g.startMid.x),cy=sr.cy+(mid.y-g.startMid.y);
    state.selectedRect=normalizeRectFromCenter(cx,cy,sr.w*scale,sr.h*scale);
    state.selectionRatio=state.selectedRect.w;
    $$('.size-selector button[data-size]').forEach(x=>x.classList.remove('selected'));
    drawRegisterPhoto();
    return;
  }
  if(pts.length===1&&state.selectionGesture?.mode==='drag'&&state.selectionGesture.startRect){
    const g=state.selectionGesture,p=pts[0],sr=g.startRect;
    state.selectedRect=normalizeRectFromCenter(sr.cx+(p.x-g.start.x),sr.cy+(p.y-g.start.y),sr.w,sr.h);
    drawRegisterPhoto();
  }
}
function selectionPointerUp(ev){
  if(state.selectionPointers.has(ev.pointerId)){ev.preventDefault();state.selectionPointers.delete(ev.pointerId);}
  try{els.registerCanvas.releasePointerCapture(ev.pointerId);}catch(e){}
  if(state.selectionPointers.size<=1)state.selectionGesture=null;
}
function scaleSelection(factor){
  if(!state.selectedRect){toast('先に写真の物品をタップしてください');return;}
  const r=state.selectedRect;state.selectedRect=normalizeRectFromCenter(r.cx,r.cy,r.w*factor,r.h*factor);
  state.selectionRatio=state.selectedRect.w;
  $$('.size-selector button[data-size]').forEach(x=>x.classList.remove('selected'));
  drawRegisterPhoto();
}
function recalcSelectionFromCenter(){
  const old=state.selectedRect;if(!old)return;
  const next=makeSelectionAt(old.cx,old.cy,state.selectionRatio);state.selectedRect=next;drawRegisterPhoto();
}

async function registerSelection(category, sourceButton=null){
  ensureAudio();
  if(state.registerBusy){ toast('登録処理中です'); return; }
  if(!state.photos.length){ toast('先に写真を読み込んでください'); return; }
  if(!state.selectedRect){ toast('先に写真の物品をタップして範囲を選んでください'); return; }

  const enteredName=els.residentName.value.trim();
  ensureCurrentSession();
  if(enteredName) state.currentSession.name=enteredName;
  if(!Array.isArray(state.currentSession.items)) state.currentSession.items=[];

  const rect={...state.selectedRect};
  const photoIndex=state.photoIndex;
  const p=state.photos[photoIndex];
  if(!p || !p.img){ toast('選択中の写真を取得できませんでした'); return; }

  state.registerBusy=true;
  setCategoryButtonsDisabled(true);
  if(sourceButton) sourceButton.classList.add('cat-working');
  els.selectionNote.textContent=`〇 ${category} を登録しています…`;

  try{
    await new Promise(resolve=>setTimeout(resolve,0));

    const cropCanvas=makeCropCanvas(p.img,rect,280);
    const crop=cropCanvas.toDataURL('image/jpeg',.84);
    const descriptor=extractBasicDescriptor(cropCanvas);

    pushUndo();
    const item={
      id:makeId(), category, crop, descriptor, checked:false,
      sourcePhotoIndex:photoIndex, marker:{...rect},
      createdAt:new Date().toISOString(),
      descriptorLevel:'pending',
      recogProgress: 10
    };

    state.currentSession.items.push(item);
    reconcileGroups(state.currentSession.items);
    state.redo=[];

    // ピコン登録はここで即完了させ、次の選択へすぐ移れるようにする
    state.selectedRect=null;
    els.customCategory.value='';
    els.customRow.classList.add('hidden');
    renderHistory();
    updateUndoRedo();
    drawRegisterPhoto();

    const count=state.currentSession.items.filter(x=>x.category===category).length;
    successChime();
    showRegisterSuccess(category,count,rect);
    els.selectionNote.textContent=`登録完了：${category} ×${count}（裏で高精度認識中… 次の物品も続けて選べます）`;
    toast(`✨ ${category} 登録！ ×${count}`);

    // バックグラウンド高精度画像認識キューへ追加
    enqueueBackgroundRecognition(state.currentSession.id, item.id, category, crop);

  }catch(err){
    console.error('物品登録エラー',err);
    const msg=(err && err.message) ? err.message : String(err||'処理エラー');
    toast(`登録できませんでした：${msg}`);
    els.selectionNote.textContent=`登録エラー：${msg}`;
  }finally{
    state.registerBusy=false;
    setCategoryButtonsDisabled(false);
    if(sourceButton) sourceButton.classList.remove('cat-working');
  }
}

function makeCropCanvas(img,r,maxSize=280){
  const iw=Number(img?.naturalWidth||img?.width||0);
  const ih=Number(img?.naturalHeight||img?.height||0);
  if(!iw||!ih) throw new Error('写真サイズを取得できません');

  const rx=clamp(Number(r.x)||0,0,.999);
  const ry=clamp(Number(r.y)||0,0,.999);
  const rw=clamp(Number(r.w)||.2,.01,1-rx);
  const rh=clamp(Number(r.h)||.2,.01,1-ry);

  const sx=Math.floor(rx*iw), sy=Math.floor(ry*ih);
  const sw=Math.max(2,Math.floor(rw*iw)), sh=Math.max(2,Math.floor(rh*ih));
  const scale=Math.min(maxSize/sw,maxSize/sh,1.5);

  const c=document.createElement('canvas');
  c.width=Math.max(2,Math.round(sw*scale));
  c.height=Math.max(2,Math.round(sh*scale));
  const ctx=c.getContext('2d',{alpha:false});
  if(!ctx) throw new Error('画像処理を開始できません');
  ctx.drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
  return c;
}

// --- バックグラウンド高精度画像認識キュー ---
function enqueueBackgroundRecognition(sessionId, itemId, category, crop){
  if(state.bgHideTimer){
    clearTimeout(state.bgHideTimer);
    state.bgHideTimer = null;
  }
  if(!state.bgProcessing && state.bgQueue.length===0){
    state.bgTotal = 0;
    state.bgCompleted = 0;
  }
  state.bgQueue.push({sessionId, itemId, category, crop});
  state.bgTotal++;
  updateBgRecogUI();
  processBgQueue();
}

async function processBgQueue(){
  if(state.bgProcessing || state.bgQueue.length===0) return;
  state.bgProcessing = true;

  while(state.bgQueue.length > 0){
    const task = state.bgQueue.shift();
    state.bgCurrentTask = task;
    state.bgCurrentProgress = 0.08;
    state.bgCurrentStepText = `${task.category} の画像を展開しています…`;
    setItemRecogState(task.sessionId, task.itemId, 'working', 15);
    updateBgRecogUI();

    try{
      await yieldToMain();
      const cropImg = await loadImage(task.crop);
      const detailed = await extractDescriptorAsync(cropImg, (ratio, stepLabel) => {
        state.bgCurrentProgress = ratio;
        state.bgCurrentStepText = `${task.category}：${stepLabel}`;
        setItemRecogState(task.sessionId, task.itemId, 'working', Math.round(ratio * 100));
        updateBgRecogUI();
      });

      if(detailed){
        await applyUpgradedDescriptor(task.sessionId, task.itemId, detailed);
      }else{
        setItemRecogState(task.sessionId, task.itemId, 'basic', 100);
      }
    }catch(err){
      console.warn('高精度特徴の抽出をスキップしました', err);
      setItemRecogState(task.sessionId, task.itemId, 'basic', 100);
    }

    state.bgCompleted++;
    state.bgCurrentTask = null;
    state.bgCurrentProgress = 0;
    updateBgRecogUI();
    renderHistory();
  }

  state.bgProcessing = false;
  state.bgCurrentStepText = 'すべての物品の高精度画像認識が完了しました';
  updateBgRecogUI();

  state.bgHideTimer = setTimeout(()=>{
    if(!state.bgProcessing && state.bgQueue.length===0){
      els.bgRecogPanel?.classList.add('hidden');
    }
  }, 4000);
}

function setItemRecogState(sessionId, itemId, level, progressPct){
  const updateList = (list) => {
    const target = (list||[]).find(x=>x.id===itemId);
    if(target){
      target.descriptorLevel = level;
      target.recogProgress = progressPct;
    }
  };
  if(state.currentSession?.id === sessionId){
    updateList(state.currentSession.items);
  }
  const saved = state.sessions.find(s=>s.id===sessionId);
  if(saved) updateList(saved.items);
  renderHistory();
}

async function applyUpgradedDescriptor(sessionId, itemId, detailed){
  const patchItems = (items) => {
    if(!Array.isArray(items)) return false;
    const target = items.find(x=>x.id===itemId);
    if(!target) return false;
    target.descriptor = detailed;
    target.descriptorLevel = 'detailed';
    target.recogProgress = 100;
    reconcileGroups(items);
    return true;
  };

  if(state.currentSession?.id === sessionId){
    patchItems(state.currentSession.items);
    state.undo.forEach(snap => patchItems(snap));
    state.redo.forEach(snap => patchItems(snap));
  }

  const savedSession = state.sessions.find(s=>s.id===sessionId);
  if(savedSession && patchItems(savedSession.items)){
    savedSession.updatedAt = new Date().toISOString();
    try{ await idbPut(savedSession); }catch(e){}
  }
}

function updateBgRecogUI(){
  const panel = els.bgRecogPanel;
  if(!panel) return;

  const remaining = state.bgQueue.length + (state.bgCurrentTask ? 1 : 0);
  const total = Math.max(1, state.bgTotal);
  const effectiveDone = state.bgCompleted + (state.bgCurrentTask ? state.bgCurrentProgress : 0);
  const pct = Math.min(100, Math.round((effectiveDone / total) * 100));

  if(remaining === 0 && state.bgTotal === 0){
    panel.classList.add('hidden');
    if(els.summaryBgStatus) els.summaryBgStatus.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');

  if(remaining > 0){
    panel.classList.remove('done');
    const currentNum = Math.min(total, state.bgCompleted + 1);
    const curCat = state.bgCurrentTask ? state.bgCurrentTask.category : '物品';
    const estSec = Math.max(1, Math.ceil((remaining - state.bgCurrentProgress) * 0.45));
    els.bgRecogTitle.textContent = `画像認識中：${curCat}（${currentNum}/${total}件目）`;
    els.bgRecogMeta.textContent = `残り ${remaining} 件（約${estSec}秒）・${pct}%`;
    els.bgRecogFill.style.width = `${pct}%`;
    els.bgRecogSub.textContent = state.bgCurrentStepText || '生地・縫い目・局所特徴を解析しています…';

    if(els.summaryBgStatus){
      els.summaryBgStatus.classList.remove('hidden','done');
      els.summaryBgStatus.textContent = `🔄 バックグラウンド画像認識中… 残り ${remaining} 件 (${pct}%)`;
    }
  }else{
    panel.classList.add('done');
    els.bgRecogTitle.textContent = `✓ バックグラウンド画像認識が完了しました`;
    els.bgRecogMeta.textContent = `全 ${state.bgTotal} 件 完了 (100%)`;
    els.bgRecogFill.style.width = '100%';
    els.bgRecogSub.textContent = '色・生地テクスチャ・縫い目・局所特徴の保存が完了しました';

    if(els.summaryBgStatus){
      els.summaryBgStatus.classList.remove('hidden');
      els.summaryBgStatus.classList.add('done');
      els.summaryBgStatus.textContent = `✅ すべての画像認識が完了しています（全 ${state.bgTotal} 件）`;
    }
  }
}

function yieldToMain(){
  return new Promise(resolve=>setTimeout(resolve, 0));
}

function reconcileGroups(items){
  if(!Array.isArray(items)) return;
  items.forEach(it => { it.groupId = null; });
  for(let i=0; i<items.length; i++){
    const a = items[i];
    if(!a.descriptor) continue;
    for(let j=0; j<i; j++){
      const b = items[j];
      if(b.category !== a.category || !b.descriptor) continue;
      try{
        if(descriptorSimilarity(a.descriptor, b.descriptor) >= 0.94){
          const gid = b.groupId || b.id;
          b.groupId = gid;
          a.groupId = gid;
          break;
        }
      }catch(e){}
    }
  }
}

function setCategoryButtonsDisabled(disabled){
  $$('.cat-btn').forEach(b=>{b.disabled=!!disabled;});
  if(els.customAddBtn) els.customAddBtn.disabled=!!disabled;
}

function extractBasicDescriptor(img){
  const c=document.createElement('canvas');
  c.width=64;c.height=64;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  drawCover(ctx,img,64,64);
  const d=ctx.getImageData(0,0,64,64).data;
  const color=new Array(12*4*4).fill(0), gray=new Float32Array(64*64);
  let mean=0;
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    const i=(y*64+x)*4,r=d[i],g=d[i+1],b=d[i+2];
    const [h,s,v]=rgbToHsv(r,g,b);
    const hi=Math.min(11,Math.floor(h*12)),si=Math.min(3,Math.floor(s*4)),vi=Math.min(3,Math.floor(v*4));
    color[(hi*4+si)*4+vi]++;
    const gr=.299*r+.587*g+.114*b; gray[y*64+x]=gr; mean+=gr;
  }
  normalizeHist(color);mean/=gray.length;
  const lbp=new Array(32).fill(0);
  for(let y=2;y<62;y+=2)for(let x=2;x<62;x+=2){
    const c0=gray[y*64+x],n=[gray[(y-1)*64+x],gray[(y-1)*64+x+1],gray[y*64+x+1],gray[(y+1)*64+x+1],gray[(y+1)*64+x],gray[(y+1)*64+x-1],gray[y*64+x-1],gray[(y-1)*64+x-1]];
    let code=0;n.forEach((v,k)=>{if(v>=c0)code|=(1<<k);});lbp[Math.floor(code/8)]++;
  }
  normalizeHist(lbp);
  const edge=new Array(12).fill(0);let edgeEnergy=0;
  for(let y=1;y<63;y+=2)for(let x=1;x<63;x+=2){
    const gx=gray[y*64+x+1]-gray[y*64+x-1],gy=gray[(y+1)*64+x]-gray[(y-1)*64+x];const mag=Math.hypot(gx,gy);if(mag<12)continue;
    let a=Math.atan2(gy,gx);if(a<0)a+=Math.PI;if(a>=Math.PI)a-=Math.PI;const bin=Math.min(11,Math.floor(a/Math.PI*12));edge[bin]+=mag;edgeEnergy+=mag;
  }
  normalizeHist(edge);
  return {color,lbp,edge,dhash:makeDHash(c),brief:[],mean:Math.round(mean*10)/10,edgeEnergy:Math.round(edgeEnergy),fallback:true};
}

function pushUndo(){
  if(!state.currentSession) return;
  state.undo.push(safeClone(state.currentSession.items)); if(state.undo.length>30) state.undo.shift();
}
function undo(){
  if(!state.undo.length||!state.currentSession)return;
  state.redo.push(safeClone(state.currentSession.items)); state.currentSession.items=state.undo.pop();
  reconcileGroups(state.currentSession.items);
  renderHistory();updateUndoRedo();drawRegisterPhoto();toast('1つ前に戻しました');
}
function redo(){
  if(!state.redo.length||!state.currentSession)return;
  state.undo.push(safeClone(state.currentSession.items)); state.currentSession.items=state.redo.pop();
  reconcileGroups(state.currentSession.items);
  renderHistory();updateUndoRedo();drawRegisterPhoto();toast('やり直しました');
}
function updateUndoRedo(){ els.undoBtn.disabled=!state.undo.length;els.redoBtn.disabled=!state.redo.length; }

function renderHistory(){
  const items=state.currentSession?.items||[];
  if(!items.length){els.registerHistory.className='history empty';els.registerHistory.textContent='まだ物品は登録されていません';return;}
  els.registerHistory.className='history';els.registerHistory.innerHTML='';
  [...items].reverse().forEach((it,revIdx)=>{
    const idx=items.length-1-revIdx,row=document.createElement('div');row.className='history-row';
    let statusChip = '';
    if(it.descriptorLevel==='pending'){
      statusChip = `<span class="chip status-pending">⏳ 認識待ち</span>`;
    }else if(it.descriptorLevel==='working'){
      statusChip = `<span class="chip status-working">🔄 画像認識中 ${it.recogProgress||20}%</span>`;
    }else if(it.descriptorLevel==='detailed'){
      statusChip = `<span class="chip status-done">✓ 認識完了</span>`;
    }else{
      statusChip = `<span class="chip status-basic">基本特徴</span>`;
    }
    const thumbHtml = it.crop ? `<img class="history-thumb" src="${it.crop}" alt="" />` : `<span class="check-icon">${emojiFor(it.category)}</span>`;
    row.innerHTML=`${thumbHtml}<div class="grow"><b>${escapeHtml(emojiFor(it.category))}${escapeHtml(it.category)}</b><div class="chip-row"><span class="chip">#${idx+1}${it.groupId?' / 同一候補':''}</span>${statusChip}</div></div><button class="small-btn" data-del>削除</button>`;
    row.querySelector('[data-del]').onclick=()=>{
      pushUndo();
      const removed = state.currentSession.items.splice(idx,1)[0];
      if(removed){
        state.bgQueue = state.bgQueue.filter(q=>q.itemId!==removed.id);
      }
      reconcileGroups(state.currentSession.items);
      state.redo=[];
      renderHistory();updateUndoRedo();drawRegisterPhoto();updateBgRecogUI();
    };
    els.registerHistory.appendChild(row);
  });
}

function showRegisterSuccess(category,count){
  if(!els.registerSuccessPop)return;
  els.registerSuccessText.textContent=`${category} 登録！`;
  els.registerSuccessCount.textContent=`${emojiFor(category)} ×${count}`;
  els.registerSuccessPop.classList.remove('show');void els.registerSuccessPop.offsetWidth;els.registerSuccessPop.classList.add('show');
  els.photoStage.classList.remove('register-flash');void els.photoStage.offsetWidth;els.photoStage.classList.add('register-flash');
  clearTimeout(showRegisterSuccess._t);showRegisterSuccess._t=setTimeout(()=>{els.registerSuccessPop.classList.remove('show');els.photoStage.classList.remove('register-flash');},1150);
}

function showSummary(){
  if(!state.currentSession||!state.currentSession.items.length){toast('物品を1つ以上登録してください');return;}
  const finalName=els.residentName.value.trim();
  if(!finalName){toast('最後に利用者名・識別名を入力してください');els.residentName.focus();return;}
  state.currentSession.name=finalName;
  const counts=countCategories(state.currentSession.items);els.summaryList.innerHTML='';
  Object.entries(counts).forEach(([k,v])=>{const d=document.createElement('div');d.className='summary-row';d.innerHTML=`<span>${emojiFor(k)} ${escapeHtml(k)}</span><b>×${v}</b>`;els.summaryList.appendChild(d);});
  els.summaryTotal.textContent=`合計 ${state.currentSession.items.length} 点`;
  updateBgRecogUI();
  els.summaryModal.classList.remove('hidden');
}

async function confirmRegistration(){
  ensureAudio();
  state.currentSession.name=els.residentName.value.trim();
  state.currentSession.updatedAt=new Date().toISOString();
  const savedCopy = safeClone(state.currentSession);
  await idbPut(savedCopy);
  els.summaryModal.classList.add('hidden');
  beep(880,.1);setTimeout(()=>beep(1100,.1),110);
  showSuccessOverlay('登録完了！');
  toast(`🎉 ${savedCopy.items.length}点 登録しました`);
  await refreshSessions();
  // 次の利用者登録時に前回のデータが残らないよう初期化
  resetRegistrationState();
  setTimeout(()=>showScreen('homeScreen'),900);
}

function countCategories(items){return items.reduce((a,x)=>(a[x.category]=(a[x.category]||0)+1,a),{});}

function renderCheckList(){
  const id=els.checkSessionSelect.value,s=state.sessions.find(x=>x.id===id);
  if(!s){els.checkList.className='check-list empty';els.checkList.textContent='対象を選択してください';return;}
  els.checkList.className='check-list';els.checkList.innerHTML='';
  s.items.forEach((it,i)=>{
    const row=document.createElement('div');row.className='check-row'+(it.checked?' done':'');
    row.innerHTML=`<span class="check-icon">${it.checked?'✅':emojiFor(it.category)}</span><div class="grow"><b>${escapeHtml(it.category)} #${i+1}</b>${it.groupId?'<div class="chip">同一グループ</div>':''}</div><span>${it.checked?'確認済み':'未確認'}</span>`;
    els.checkList.appendChild(row);
  });
  const done=s.items.filter(x=>x.checked).length;
  if(done===s.items.length && s.items.length){setTimeout(()=>showSuccessOverlay('全品チェック完了！ 🎉'),120);}
}

async function startCamera(){
  ensureAudio();
  if(!els.checkSessionSelect.value){toast('先に対象を選択してください');return;}

  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
  const secure = window.isSecureContext;
  if(!secure){
    els.matchBadge.textContent='カメラ不可：HTTPSではありません';
    toast('カメラにはHTTPS接続が必要です');
    return;
  }
  if(!navigator.mediaDevices?.getUserMedia){
    els.matchBadge.textContent='連続カメラ非対応：1枚撮って照合を使用';
    toast(standalone ? 'ホーム画面版で連続カメラを利用できません。Safariで開くか「1枚撮って照合」を使ってください' : 'この環境では連続カメラを利用できません。「1枚撮って照合」を使ってください');
    return;
  }
  try{
    stopCamera();
    els.matchBadge.textContent='カメラ許可を確認中…';
    state.cameraStream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}},
      audio:false
    });
    els.cameraVideo.srcObject=state.cameraStream;
    await els.cameraVideo.play();
    els.startCamera.disabled=true;els.stopCamera.disabled=false;els.matchBadge.textContent='照合中…';
    state.lockUntilClear=false;state.clearFrames=0;state.consecutiveHits=0;state.consecutiveKey=null;state.currentCandidate=null;state.lastMatchDetail=null;
    renderMatchDetails(null);setMatchQuestion();
    state.scanTimer=setInterval(scanVideoFrame,500);
  }catch(e){
    console.error('camera start failed', e);
    const name=String(e?.name||'UnknownError');
    let msg='カメラ開始失敗：'+name;
    if(name==='NotAllowedError' || name==='SecurityError'){
      msg = standalone
        ? 'カメラが許可されていません。設定→アプリ→Safari→カメラを「許可」にし、Safari本体でも公開URLを開いてカメラを許可してください。'
        : 'カメラが拒否されています。Safariのページメニュー→Webサイトの設定→カメラ→「許可」を選んでください。';
    }else if(name==='NotFoundError' || name==='DevicesNotFoundError'){
      msg='使用できるカメラが見つかりません。';
    }else if(name==='NotReadableError' || name==='TrackStartError'){
      msg='カメラを他のアプリが使用中の可能性があります。カメラ等を閉じて再試行してください。';
    }else if(name==='OverconstrainedError'){
      msg='カメラ条件に対応できません。再試行してください。';
    }else if(name==='AbortError'){
      msg='カメラ開始が中断されました。もう一度お試しください。';
    }
    els.matchBadge.textContent='⚠ '+msg;
    setStatus(`v${APP_VERSION} / Camera:${name}`);
    toast(msg);
  }
}
function stopCamera(){
  if(state.scanTimer){clearInterval(state.scanTimer);state.scanTimer=null;}
  state.scanBusy=false;
  if(state.cameraStream){state.cameraStream.getTracks().forEach(t=>t.stop());state.cameraStream=null;}
  if(els.startCamera){els.startCamera.disabled=false;els.stopCamera.disabled=true;els.matchBadge.textContent='カメラ停止中';setMatchQuestion();}
}

async function scanVideoFrame(){
  if(state.scanBusy) return;
  const v=els.cameraVideo;if(!v.videoWidth||!v.videoHeight)return;
  state.scanBusy=true;
  try{
    const c=els.cameraCanvas,ctx=c.getContext('2d');c.width=420;c.height=315;
    const sw=v.videoWidth*.64,sh=v.videoHeight*.64,sx=(v.videoWidth-sw)/2,sy=(v.videoHeight-sh)/2;
    ctx.drawImage(v,sx,sy,sw,sh,0,0,c.width,c.height);
    const desc=extractDescriptorFromCanvas(c);
    await evaluateDescriptor(desc);
  }finally{
    state.scanBusy=false;
  }
}

async function matchCapturedPhoto(e){
  const f=e.target.files?.[0];if(!f)return;if(!els.checkSessionSelect.value){toast('先に対象を選択してください');return;}
  try{const data=await fileToDataURL(f),img=await loadImage(data),desc=extractDescriptor(img);await evaluateDescriptor(desc,true);}catch(err){toast('画像を照合できませんでした');}
  e.target.value='';
}

function categoryEmoji(category){
  const row=CATEGORIES.find(x=>x[0]===category);
  return row?.[1] || emojiFor(category) || '📦';
}

function setMatchQuestion({category='',score=0,mode='waiting',hits=0}={}){
  if(!els.matchQuestion)return;
  els.matchQuestion.classList.remove('waiting','possible','confident','locked','complete');
  els.matchQuestion.classList.add(mode);
  if(mode==='complete'){
    els.matchQuestionEmoji.textContent='🎉';
    els.matchQuestionMain.textContent='全品チェック完了！';
    els.matchQuestionSub.textContent='お荷物の確認がすべて終わりました';
    return;
  }
  if(mode==='locked'){
    els.matchQuestionEmoji.textContent='↔️';
    els.matchQuestionMain.textContent='次の物品をどうぞ';
    els.matchQuestionSub.textContent='同じ物品の二重カウント防止のため、一度枠から外してください';
    return;
  }
  if(!category){
    els.matchQuestionEmoji.textContent='🔎';
    els.matchQuestionMain.textContent='物品を枠に入れてください';
    els.matchQuestionSub.textContent='候補が見つかると「上着ですか？」のように大きく表示します';
    return;
  }
  const pct=Math.round(score*100);
  els.matchQuestionEmoji.textContent=categoryEmoji(category);
  els.matchQuestionMain.textContent=`${category}ですか？`;
  if(mode==='confident'){
    els.matchQuestionSub.textContent=`一致度 ${pct}% ・ 確認中 ${Math.max(1,hits)}/3`;
  }else{
    els.matchQuestionSub.textContent=`一致度 ${pct}% ・ 候補です。合っていれば下のボタンで確認`;
  }
}

async function evaluateDescriptor(desc,singleShot=false){
  const s=state.sessions.find(x=>x.id===els.checkSessionSelect.value);if(!s)return;
  const pending=s.items.filter(x=>!x.checked);if(!pending.length){setMatchQuestion({mode:'complete'});showSuccessOverlay('全品チェック完了！ 🎉');return;}
  let scored=pending.map(x=>{const detail=descriptorSimilarityDetailed(desc,x.descriptor);return {item:x,score:detail.score,detail};}).sort((a,b)=>b.score-a.score);
  const best=scored[0],second=scored[1];
  state.currentCandidate=best||null;
  state.lastMatchDetail=best?.detail||null;
  renderMatchDetails(state.lastMatchDetail, second?.score);
  const score=best?.score||0;
  els.candidateName.textContent=best?best.item.category:'—';els.scoreText.textContent=best?`${Math.round(score*100)}%`:'—';els.scoreBar.style.width=`${Math.round(score*100)}%`;

  if(state.lockUntilClear){
    setMatchQuestion({mode:'locked'});
    if(score<.53){state.clearFrames++;els.matchBadge.textContent=`次の物品をどうぞ… ${state.clearFrames}/2`;}
    else{state.clearFrames=0;els.matchBadge.textContent='同じ物品を検出中：いったん枠から外してください';}
    if(state.clearFrames>=2){state.lockUntilClear=false;state.clearFrames=0;state.consecutiveHits=0;state.consecutiveKey=null;els.matchBadge.textContent='照合中…';setMatchQuestion();}
    return;
  }

  const key=best?(best.item.groupId||best.item.id):null;
  const margin=best&&second ? best.score-second.score : .2;
  const high=score>=state.highThreshold;
  const confident=high && (margin>=.035 || !!best?.item.groupId || pending.length===1);

  const now=Date.now();
  if(singleShot || now-state.lastLogAt>=2200){
    state.lastLogAt=now;
    logMatchResult({
      mode: singleShot?'single':'camera',
      category: best?.item?.category||'',
      score,
      secondScore: second?.score||0,
      margin,
      detail: best?.detail||null,
      decision: confident?'auto-candidate':(score>=state.lowThreshold?'manual-candidate':'low')
    });
  }

  if(score>=state.lowThreshold && !confident){
    setMatchQuestion({category:best.item.category,score,mode:'possible'});
    els.matchBadge.textContent=`候補：${best.item.category} ${Math.round(score*100)}%`;
    els.manualConfirm.textContent=`はい、${best.item.category}です ✓`;
    els.manualConfirm.classList.remove('hidden');
  }else{
    els.manualConfirm.classList.add('hidden');
    if(!confident) setMatchQuestion();
  }

  if(!confident){state.consecutiveHits=0;state.consecutiveKey=null;return;}

  if(key===state.consecutiveKey) state.consecutiveHits++; else{state.consecutiveKey=key;state.consecutiveHits=1;}
  setMatchQuestion({category:best.item.category,score,mode:'confident',hits:state.consecutiveHits});
  els.matchBadge.textContent=`${best.item.category} 一致候補 ${state.consecutiveHits}/3`;
  if(singleShot || state.consecutiveHits>=3) await acceptMatch(best.item,s);
}

async function acceptMatch(item,session){
  ensureAudio();
  let target=item;
  if(item.groupId){target=session.items.find(x=>!x.checked&&(x.groupId===item.groupId||x.id===item.groupId))||item;}
  target.checked=true;session.updatedAt=new Date().toISOString();await idbPut(session);
  logMatchResult({mode:'accepted',category:target.category,score:state.currentCandidate?.score||0,secondScore:0,margin:0,detail:state.lastMatchDetail,decision:'accepted'});
  const idx=state.sessions.findIndex(x=>x.id===session.id);if(idx>=0)state.sessions[idx]=session;
  state.lockUntilClear=true;state.clearFrames=0;state.consecutiveHits=0;state.consecutiveKey=null;
  els.manualConfirm.classList.add('hidden');
  setMatchQuestion({mode:'locked'});beep(900,.08);setTimeout(()=>beep(1250,.08),90);showSuccessOverlay(`${target.category} 確認！`);renderCheckList();
}

async function manualConfirm(){
  const s=state.sessions.find(x=>x.id===els.checkSessionSelect.value);if(!s||!state.currentCandidate)return;
  await acceptMatch(state.currentCandidate.item,s);
}

async function resetChecks(){
  const s=state.sessions.find(x=>x.id===els.checkSessionSelect.value);if(!s)return;
  if(!confirm('この利用者の退所確認チェックをすべてリセットしますか？'))return;
  s.items.forEach(x=>x.checked=false);s.updatedAt=new Date().toISOString();await idbPut(s);await refreshSessions();els.checkSessionSelect.value=s.id;renderCheckList();toast('確認状態をリセットしました');
}

function showSuccessOverlay(text){
  if(!els.successPop)return;els.successText.textContent=text;els.successPop.classList.remove('show');void els.successPop.offsetWidth;els.successPop.classList.add('show');
}

function loadSettings(){
  els.highThreshold.value=Math.round(state.highThreshold*100);els.lowThreshold.value=Math.round(state.lowThreshold*100);updateThresholdLabels();
}
function saveThresholds(){
  let hi=Number(els.highThreshold.value),lo=Number(els.lowThreshold.value);if(lo>=hi){lo=hi-1;els.lowThreshold.value=lo;}
  state.highThreshold=hi/100;state.lowThreshold=lo/100;localStorage.setItem('highThreshold',hi);localStorage.setItem('lowThreshold',lo);updateThresholdLabels();
}
function updateThresholdLabels(){els.highThresholdLabel.textContent=`${Math.round(state.highThreshold*100)}%`;els.lowThresholdLabel.textContent=`${Math.round(state.lowThreshold*100)}%`;}

async function exportBackup(){
  const payload={app:'ShortStay荷物チェッカー',version:APP_VERSION,exportedAt:new Date().toISOString(),sessions:state.sessions};
  const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`shortstay_luggage_backup_${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('バックアップを書き出しました');
}
async function importBackup(e){
  const f=e.target.files?.[0];if(!f)return;
  try{
    const data=JSON.parse(await f.text());if(!Array.isArray(data.sessions))throw new Error('invalid');
    if(!confirm(`${data.sessions.length}件の登録データを復元しますか？同じIDは上書きされます。`))return;
    for(const s of data.sessions) await idbPut(s);await refreshSessions();toast('復元しました');
  }catch(err){toast('バックアップ形式を読み取れませんでした');}
  e.target.value='';
}

// 段階的進捗コールバック対応の非同期高精度特徴抽出
async function extractDescriptorAsync(img, onProgress){
  const c=document.createElement('canvas');c.width=96;c.height=96;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  drawCover(ctx,img,96,96);
  const d=ctx.getImageData(0,0,96,96),px=d.data;

  if(onProgress) onProgress(0.25, '色分布を解析中…');
  await yieldToMain();

  const color=new Array(12*4*4).fill(0),gray=new Float32Array(96*96);
  let mean=0;
  for(let y=0;y<96;y++)for(let x=0;x<96;x++){
    const i=(y*96+x)*4,r=px[i],g=px[i+1],b=px[i+2];const [h,s,v]=rgbToHsv(r,g,b);
    const hi=Math.min(11,Math.floor(h*12)),si=Math.min(3,Math.floor(s*4)),vi=Math.min(3,Math.floor(v*4));color[(hi*4+si)*4+vi]++;
    const gr=.299*r+.587*g+.114*b;gray[y*96+x]=gr;mean+=gr;
  }
  normalizeHist(color);mean/=gray.length;

  if(onProgress) onProgress(0.50, '生地テクスチャ(LBP)を解析中…');
  await yieldToMain();

  const lbp=new Array(32).fill(0);
  for(let y=2;y<94;y+=2)for(let x=2;x<94;x+=2){
    const c0=gray[y*96+x],n=[gray[(y-1)*96+x],gray[(y-1)*96+x+1],gray[y*96+x+1],gray[(y+1)*96+x+1],gray[(y+1)*96+x],gray[(y+1)*96+x-1],gray[y*96+x-1],gray[(y-1)*96+x-1]];
    let code=0;n.forEach((v,k)=>{if(v>=c0)code|=(1<<k);});lbp[Math.floor(code/8)]++;
  }
  normalizeHist(lbp);

  if(onProgress) onProgress(0.75, '縫い目・エッジ方向を解析中…');
  await yieldToMain();

  const edge=new Array(12).fill(0);let edgeEnergy=0;
  for(let y=1;y<95;y+=2)for(let x=1;x<95;x+=2){
    const gx=gray[y*96+x+1]-gray[y*96+x-1],gy=gray[(y+1)*96+x]-gray[(y-1)*96+x];const mag=Math.hypot(gx,gy);if(mag<12)continue;
    let a=Math.atan2(gy,gx);if(a<0)a+=Math.PI;if(a>=Math.PI)a-=Math.PI;const bin=Math.min(11,Math.floor(a/Math.PI*12));edge[bin]+=mag;edgeEnergy+=mag;
  }
  normalizeHist(edge);
  const dhash=makeDHash(c);

  if(onProgress) onProgress(0.92, 'ポケット・ボタン等の局所特徴を抽出中…');
  await yieldToMain();

  const brief=extractLocalBrief(gray,96,96);
  if(onProgress) onProgress(1.0, '解析完了');
  return {color,lbp,edge,dhash,brief,mean:Math.round(mean*10)/10,edgeEnergy:Math.round(edgeEnergy)};
}

function extractDescriptor(img){
  const c=document.createElement('canvas');c.width=96;c.height=96;const ctx=c.getContext('2d',{willReadFrequently:true});
  drawCover(ctx,img,96,96);return extractDescriptorFromCanvas(c);
}
function extractDescriptorFromCanvas(c){
  const work=document.createElement('canvas');work.width=96;work.height=96;const wctx=work.getContext('2d',{willReadFrequently:true});
  drawCover(wctx,c,96,96);
  const d=wctx.getImageData(0,0,96,96),px=d.data;
  const color=new Array(12*4*4).fill(0),gray=new Float32Array(96*96);
  let mean=0;
  for(let y=0;y<96;y++)for(let x=0;x<96;x++){
    const i=(y*96+x)*4,r=px[i],g=px[i+1],b=px[i+2];const [h,s,v]=rgbToHsv(r,g,b);
    const hi=Math.min(11,Math.floor(h*12)),si=Math.min(3,Math.floor(s*4)),vi=Math.min(3,Math.floor(v*4));color[(hi*4+si)*4+vi]++;
    const gr=.299*r+.587*g+.114*b;gray[y*96+x]=gr;mean+=gr;
  }
  normalizeHist(color);mean/=gray.length;
  const lbp=new Array(32).fill(0);
  for(let y=2;y<94;y+=2)for(let x=2;x<94;x+=2){
    const c0=gray[y*96+x],n=[gray[(y-1)*96+x],gray[(y-1)*96+x+1],gray[y*96+x+1],gray[(y+1)*96+x+1],gray[(y+1)*96+x],gray[(y+1)*96+x-1],gray[y*96+x-1],gray[(y-1)*96+x-1]];
    let code=0;n.forEach((v,k)=>{if(v>=c0)code|=(1<<k);});lbp[Math.floor(code/8)]++;
  }
  normalizeHist(lbp);
  const edge=new Array(12).fill(0);let edgeEnergy=0;
  for(let y=1;y<95;y+=2)for(let x=1;x<95;x+=2){
    const gx=gray[y*96+x+1]-gray[y*96+x-1],gy=gray[(y+1)*96+x]-gray[(y-1)*96+x];const mag=Math.hypot(gx,gy);if(mag<12)continue;
    let a=Math.atan2(gy,gx);if(a<0)a+=Math.PI;if(a>=Math.PI)a-=Math.PI;const bin=Math.min(11,Math.floor(a/Math.PI*12));edge[bin]+=mag;edgeEnergy+=mag;
  }
  normalizeHist(edge);
  const dhash=makeDHash(work);
  const brief=extractLocalBrief(gray,96,96);
  return {color,lbp,edge,dhash,brief,mean:Math.round(mean*10)/10,edgeEnergy:Math.round(edgeEnergy)};
}

function descriptorSimilarity(a,b){
  return descriptorSimilarityDetailed(a,b).score;
}

function descriptorSimilarityDetailed(a,b){
  if(!a||!b)return {score:0,color:0,texture:0,edge:0,hash:0,local:0,brightnessPenalty:0,localUsed:false};
  const color=histIntersection(a.color,b.color);
  const texture=cosine(a.lbp,b.lbp);
  const edge=cosine(a.edge,b.edge);
  const hash=1-hammingHex(a.dhash,b.dhash)/64;
  const local=localBriefSimilarity(a.brief||[],b.brief||[]);
  const localUsed=(a.brief||[]).length>=4 && (b.brief||[]).length>=4;
  const parts=[[color,.28],[texture,.26],[edge,.13],[hash,.05]];
  if(localUsed) parts.push([local,.28]);
  const wsum=parts.reduce((z,x)=>z+x[1],0);
  let score=parts.reduce((z,x)=>z+x[0]*x[1],0)/wsum;
  const bright=Math.abs((a.mean||0)-(b.mean||0))/255;
  const brightnessPenalty=Math.max(0,bright-.28)*.12;
  score-=brightnessPenalty;
  return {score:clamp(score,0,1),color,texture,edge,hash,local,brightnessPenalty,localUsed};
}

function renderMatchDetails(detail,secondScore=0){
  if(!els.matchDetails)return;
  if(!detail){els.matchDetails.innerHTML='<span>まだ照合していません</span>';return;}
  const pct=v=>`${Math.round(clamp(v||0,0,1)*100)}%`;
  const cells=[
    ['色',detail.color],['生地',detail.texture],['局所特徴',detail.localUsed?detail.local:null],
    ['縫い目/エッジ',detail.edge],['全体形状',detail.hash],['2位との差',Math.max(0,(detail.score||0)-(secondScore||0))]
  ];
  els.matchDetails.innerHTML=cells.map(([n,v])=>`<div class="detail-cell"><span>${n}</span><b>${v===null?'判定なし':pct(v)}</b></div>`).join('');
}

function loadTestLogs(){
  try{state.testLogs=JSON.parse(localStorage.getItem('shortstayTestLogs')||'[]');if(!Array.isArray(state.testLogs))state.testLogs=[];}catch(e){state.testLogs=[];}
  updateTestLogCount();
}
function updateTestLogCount(){if(els.testLogCount)els.testLogCount.textContent=`${state.testLogs.length}件`;}
function logMatchResult(r){
  const d=r.detail||{};
  state.testLogs.push({
    time:new Date().toISOString(),mode:r.mode||'',category:r.category||'',
    score:+(r.score||0).toFixed(4),secondScore:+(r.secondScore||0).toFixed(4),margin:+(r.margin||0).toFixed(4),
    color:+(d.color||0).toFixed(4),texture:+(d.texture||0).toFixed(4),local:d.localUsed?+(d.local||0).toFixed(4):'',
    edge:+(d.edge||0).toFixed(4),shape:+(d.hash||0).toFixed(4),decision:r.decision||''
  });
  if(state.testLogs.length>300)state.testLogs=state.testLogs.slice(-300);
  try{localStorage.setItem('shortstayTestLogs',JSON.stringify(state.testLogs));}catch(e){}
  updateTestLogCount();
}
function exportTestLog(){
  if(!state.testLogs.length){toast('テストログはまだありません');return;}
  const headers=['time','mode','category','score','secondScore','margin','color','texture','local','edge','shape','decision'];
  const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const csv='\ufeff'+[headers.join(','),...state.testLogs.map(r=>headers.map(h=>esc(r[h])).join(','))].join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`shortstay_match_log_${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('判定ログCSVを書き出しました');
}
function clearTestLog(){
  if(!state.testLogs.length)return;
  if(!confirm('実機テストログを消去しますか？登録した荷物データは消えません。'))return;
  state.testLogs=[];localStorage.removeItem('shortstayTestLogs');updateTestLogCount();toast('テストログを消去しました');
}

function extractLocalBrief(gray,w,h){
  const candidates=[];
  for(let y=9;y<h-9;y+=2) for(let x=9;x<w-9;x+=2){
    const gx=gray[y*w+x+1]-gray[y*w+x-1];
    const gy=gray[(y+1)*w+x]-gray[(y-1)*w+x];
    const gd1=gray[(y+1)*w+x+1]-gray[(y-1)*w+x-1];
    const gd2=gray[(y+1)*w+x-1]-gray[(y-1)*w+x+1];
    const score=Math.min(Math.abs(gx)+Math.abs(gy),Math.abs(gd1)+Math.abs(gd2));
    if(score>26)candidates.push({x,y,score});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const chosen=[];
  for(const c of candidates){
    if(chosen.every(k=>(k.x-c.x)**2+(k.y-c.y)**2>55)) chosen.push(c);
    if(chosen.length>=36)break;
  }
  const pairs=[[-7,-3,6,2],[-5,6,5,-5],[-6,0,4,0],[-2,-7,2,7],[-7,7,7,-7],[-4,-4,4,4],[-7,2,6,-2],[-3,5,3,-6],
    [-6,-6,1,5],[-1,-5,7,4],[-5,2,2,-7],[-2,6,6,6],[-7,-1,7,1],[-3,-3,5,2],[-5,-7,2,4],[-1,7,5,-4],
    [-7,4,4,-6],[-6,6,6,-4],[-4,1,7,-2],[-2,-6,1,6],[-7,-5,5,6],[-5,5,7,3],[-6,-2,3,7],[-1,-7,6,5],
    [-7,6,2,-3],[-4,-6,7,-1],[-6,3,5,-7],[-3,7,4,-1],[-7,0,1,7],[-2,4,6,-6],[-5,-2,3,5],[-1,5,7,-5],
    [-6,-4,4,6],[-4,7,6,0],[-7,3,7,-3],[-3,-7,5,5],[-5,0,5,3],[-2,7,2,-5],[-6,5,6,2],[-1,-6,7,6],
    [-7,-2,4,5],[-4,5,5,-3],[-5,-5,3,6],[-2,-4,6,4],[-6,1,7,0],[-3,6,3,-7],[-7,-6,5,1],[-1,6,6,-2],
    [-6,4,4,-4],[-5,7,7,-6],[-7,1,2,6],[-4,-7,6,3],[-5,3,5,-1],[-2,5,7,-4],[-6,-1,4,7],[-3,-5,6,5],
    [-7,5,3,-4],[-4,6,7,-5],[-6,-3,5,4],[-2,-7,7,2],[-5,1,4,-7],[-1,4,6,-5],[-7,-4,2,5],[-3,4,5,-6]];
  return chosen.map(k=>{
    let bits='',hex='';
    for(const [x1,y1,x2,y2] of pairs){
      const a=gray[(k.y+y1)*w+k.x+x1],b=gray[(k.y+y2)*w+k.x+x2]; bits+=a>b?'1':'0';
    }
    for(let i=0;i<64;i+=4)hex+=parseInt(bits.slice(i,i+4),2).toString(16);
    return hex;
  });
}
function localBriefSimilarity(a,b){
  if(!a.length||!b.length)return 0;
  let good=0,total=0;
  const shorter=a.length<=b.length?a:b,longer=a.length<=b.length?b:a;
  for(const da of shorter){
    let best=64;
    for(const db of longer){best=Math.min(best,hammingHex(da,db));if(best<=8)break;}
    const s=clamp(1-(best-8)/20,0,1); total+=s; if(best<=16)good++;
  }
  const avg=total/shorter.length,coverage=good/Math.max(6,shorter.length);
  return clamp(.72*avg+.28*Math.min(1,coverage),0,1);
}

function rgbToHsv(r,g,b){
  r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0;
  if(d){if(max===r)h=((g-b)/d)%6;else if(max===g)h=(b-r)/d+2;else h=(r-g)/d+4;h/=6;if(h<0)h+=1;}
  return [h,max?d/max:0,max];
}
function normalizeHist(a){const s=a.reduce((x,y)=>x+y,0)||1;for(let i=0;i<a.length;i++)a[i]/=s;return a;}
function histIntersection(a,b){let s=0;for(let i=0;i<Math.min(a.length,b.length);i++)s+=Math.min(a[i],b[i]);return clamp(s,0,1);}
function cosine(a,b){let dot=0,aa=0,bb=0;for(let i=0;i<Math.min(a.length,b.length);i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?clamp(dot/Math.sqrt(aa*bb),0,1):0;}
function makeDHash(source){
  const c=document.createElement('canvas');c.width=9;c.height=8;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,9,8);const d=ctx.getImageData(0,0,9,8).data;let bits='',hex='';
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){const i=(y*9+x)*4,j=(y*9+x+1)*4;const a=.299*d[i]+.587*d[i+1]+.114*d[i+2],b=.299*d[j]+.587*d[j+1]+.114*d[j+2];bits+=a>b?'1':'0';}
  for(let i=0;i<64;i+=4)hex+=parseInt(bits.slice(i,i+4),2).toString(16);return hex;
}
function hammingHex(a,b){if(!a||!b)return 64;let n=0;for(let i=0;i<Math.min(a.length,b.length);i++){let x=parseInt(a[i],16)^parseInt(b[i],16);while(x){n+=x&1;x>>=1;}}return n+Math.abs(a.length-b.length)*4;}

function drawCover(ctx,img,w,h){
  const iw=Number(img?.naturalWidth||img?.width||w), ih=Number(img?.naturalHeight||img?.height||h);
  const s=Math.max(w/iw,h/ih),sw=w/s,sh=h/s,sx=(iw-sw)/2,sy=(ih-sh)/2;
  ctx.drawImage(img,sx,sy,sw,sh,0,0,w,h);
}
async function normalizeImage(img,maxDim=1600,quality=.84){
  const s=Math.min(1,maxDim/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/jpeg',quality);
}
function loadImage(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});}
function fileToDataURL(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f);});}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function escapeHtml(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function emojiFor(cat){return (CATEGORIES.find(x=>x[0]===cat)||['','📦'])[1] || '📦';}
function ensureAudio(){
  try{
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;
    if(!state.audioCtx||state.audioCtx.state==='closed')state.audioCtx=new AC();
    if(state.audioCtx.state==='suspended')state.audioCtx.resume().catch(()=>{});
    return state.audioCtx;
  }catch(e){return null;}
}
function beep(freq=880,dur=.08){
  try{
    const ac=ensureAudio();if(!ac)return;const t=ac.currentTime,o=ac.createOscillator(),g=ac.createGain();
    o.frequency.value=freq;o.type='sine';g.gain.setValueAtTime(.001,t);g.gain.exponentialRampToValueAtTime(.18,t+.008);g.gain.exponentialRampToValueAtTime(.001,t+dur);o.connect(g);g.connect(ac.destination);o.start(t);o.stop(t+dur+.02);
  }catch(e){}
}
function successChime(){beep(720,.07);setTimeout(()=>beep(1080,.09),80);}

if(!state.currentSession){ state.currentSession={id:makeId(),name:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),items:[]}; }
