
(()=>{'use strict';

const VERSION='1.3.1';
const APP=document.getElementById('app');
const DB_NAME='scc_housechecks_db';
const STORE='kv', META='meta', DATA='data';
const ENC=new TextEncoder(), DEC=new TextDecoder();
let cryptoKey=null,state=null,screen='tonight',activePropertyId=null,editPropertyId=null,editLocationId=null;
let revealCode=false,reportApproved=false,historyOpenId=null,autoLockTimer=null;
let showFullNames=false,nameRevealTimer=null,clientSearchQuery='';
let historyCalendarDate=new Date(),historySelectedDate=null;

const deepClone=o=>typeof structuredClone==='function'?structuredClone(o):JSON.parse(JSON.stringify(o));
const uuid=()=>crypto.randomUUID?crypto.randomUUID():('id_'+Date.now()+'_'+Math.random().toString(16).slice(2));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const digits=s=>String(s??'').replace(/\D/g,'');
const fmtPhone=n=>{const d=digits(n);return d.length===11&&d[0]==='1'?`1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`:d.length===10?`(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`:String(n??'')};
const partsOfName=name=>String(name||'').trim().split(/\s+/).filter(Boolean);
function maskClientName(name){
  const parts=partsOfName(name);
  if(!parts.length)return '';
  const first=parts[0].slice(0,3);
  const last=(parts.length>1?parts[parts.length-1]:'').slice(0,3);
  return last?`${first} ${last}`:first;
}
function clientSearchKey(name){
  return maskClientName(name).replace(/[^a-z0-9]/gi,'').toLowerCase();
}
function displayClientName(name){
  return showFullNames?String(name||''):maskClientName(name);
}
function hideFullNames(){
  showFullNames=false;
  clearTimeout(nameRevealTimer);
  nameRevealTimer=null;
}
function revealFullNamesTemporarily(){
  showFullNames=true;
  clearTimeout(nameRevealTimer);
  nameRevealTimer=setTimeout(()=>{
    showFullNames=false;
    if(state)render();
  },45000);
}
function nameRevealButton(label='Show All Names'){
  return `<button class="btn privacy-btn" id="toggleNames">${showFullNames?'Hide Full Names':label}</button>`;
}
const clients=p=>p.rooms.filter(r=>r.type==='client');
const checkKey=(pid,room)=>`${pid}::${room}`;

function defaultState(){
  return {
    schemaVersion:2,
    properties:[],
    locations:[],
    route:{stops:[]},
    settings:{
      driverName:'Steven Mowery',
      organization:'Shawnee Counseling Center',
      reportTextLabel:'Report Recipient',
      reportTextNumber:'',
      autoLockMinutes:15
    },
    currentRun:{id:uuid(),startedAt:new Date().toISOString(),checks:{}},
    history:[]
  };
}
function normalizeRoom(r,i){
  return {
    room:String(r?.room??i+1),
    type:['client','open','nobed'].includes(r?.type)?r.type:'open',
    name:r?.name??(r?.type==='nobed'?'NO BED':'OPEN'),
    phone:r?.phone??'',
    color:['green','gray'].includes(r?.color)?r.color:'',
    note:r?.note??r?.permanentNote??''
  };
}
function normalizeProperty(p,i){
  const rooms=Array.isArray(p?.rooms)?p.rooms.map(normalizeRoom):[];
  return {
    id:String(p?.id??('p'+i+'_'+Date.now())),
    address:p?.address??'Unnamed Property',
    doorCode:p?.doorCode??'',
    beds:Number(p?.beds)||rooms.length||1,
    checkRequired:p?.checkRequired!==false,
    houseColor:['green','gray','yellow','red'].includes(p?.houseColor)?p.houseColor:'',
    rooms:rooms.length?rooms:[{room:'1',type:'open',name:'OPEN',phone:'',color:'',note:''}]
  };
}
function normalizeState(raw){
  const d=defaultState(), s=raw&&typeof raw==='object'?raw:{};
  d.properties=Array.isArray(s.properties)?s.properties.map(normalizeProperty):[];
  d.locations=Array.isArray(s.locations)?s.locations.map((l,i)=>({
    id:String(l?.id??('l'+i+'_'+Date.now())),name:l?.name??'Unnamed Location',address:l?.address??'',
    type:l?.type??'Other',phone:l?.phone??'',notes:l?.notes??''
  })):[];
  d.route=s.route&&Array.isArray(s.route.stops)?s.route:{stops:[]};
  const oldNum=s.settings?.reportTextNumber||s.settings?.transportNumber||'';
  d.settings={...d.settings,...(s.settings||{}),reportTextNumber:oldNum,reportTextLabel:s.settings?.reportTextLabel||s.settings?.transportLabel||'Report Recipient'};
  d.currentRun=s.currentRun&&s.currentRun.checks?{...s.currentRun,id:s.currentRun.id||uuid(),startedAt:s.currentRun.startedAt||new Date().toISOString()}:{id:uuid(),startedAt:new Date().toISOString(),checks:{}};
  d.history=Array.isArray(s.history)?s.history:[];
  d.schemaVersion=2;
  return d;
}
function getCheck(pid,room){
  const k=checkKey(pid,room);
  return state.currentRun.checks[k]||(state.currentRun.checks[k]={status:'',note:''});
}
function requiresNote(status){
  return !!status && status!=='Home';
}
function checkResolved(c){
  if(!c?.status)return false;
  return !requiresNote(c.status) || !!String(c.note||'').trim();
}
function requiredNoteIssues(properties=state.properties,checks=state.currentRun.checks){
  const issues=[];
  for(const p of properties){
    if(p.checkRequired===false)continue;
    for(const r of p.rooms){
      if(r.type!=='client')continue;
      const c=checks[checkKey(p.id,r.room)];
      if(c?.status && requiresNote(c.status) && !String(c.note||'').trim()){
        issues.push({propertyId:p.id,address:p.address,room:r.room,name:r.name,status:c.status});
      }
    }
  }
  return issues;
}
function progress(p){
  if(!p.checkRequired)return {done:0,total:0,pct:100,missing:0};
  const list=clients(p), done=list.filter(r=>checkResolved(getCheck(p.id,r.room))).length;
  return {done,total:list.length,pct:list.length?Math.round(done/list.length*100):100,missing:list.length-done};
}
function totalsFor(properties=state.properties,checks=state.currentRun.checks){
  let required=0,checked=0,missing=0,notRequired=0;
  for(const p of properties){
    if(p.checkRequired===false){notRequired++;continue}
    for(const r of p.rooms){
      if(r.type!=='client')continue;
      required++;
      const c=checks[checkKey(p.id,r.room)];
      if(checkResolved(c))checked++;else missing++;
    }
  }
  return {required,checked,missing,notRequired};
}

/* ---------- IndexedDB + AES-GCM ---------- */
function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE)};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function kvGet(k){
  const db=await openDb();
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE,'readonly'), req=tx.objectStore(STORE).get(k);
    req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);
  });
}
async function kvPut(k,v){
  const db=await openDb();
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(v,k);
    tx.oncomplete=res;tx.onerror=()=>rej(tx.error);
  });
}
function bytesToB64(bytes){
  const CHUNK=0x8000;let out='';
  for(let i=0;i<bytes.length;i+=CHUNK)out+=String.fromCharCode(...bytes.subarray(i,i+CHUNK));
  return btoa(out);
}
function b64ToBytes(s){
  const raw=atob(s), out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
  return out;
}
async function deriveKey(pin,salt){
  const material=await crypto.subtle.importKey('raw',ENC.encode(pin),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:180000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encryptState(obj){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const plain=ENC.encode(JSON.stringify(obj));
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},cryptoKey,plain));
  return {v:2,iv:bytesToB64(iv),data:bytesToB64(cipher)};
}
async function decryptState(payload,k){
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(payload.iv)},k,b64ToBytes(payload.data));
  return normalizeState(JSON.parse(DEC.decode(plain)));
}
async function databaseExists(){return !!(await kvGet(META))}
async function saveState(){if(state&&cryptoKey)await kvPut(DATA,await encryptState(state))}
async function setupDatabase(pin,reportNumber){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  cryptoKey=await deriveKey(pin,salt);
  state=defaultState();
  state.settings.reportTextNumber=digits(reportNumber);
  await kvPut(META,{salt:bytesToB64(salt),createdAt:new Date().toISOString(),schemaVersion:2});
  await saveState();
  try{if(navigator.storage?.persist)await navigator.storage.persist()}catch{}
}
async function unlockDatabase(pin){
  const meta=await kvGet(META), payload=await kvGet(DATA);
  if(!meta||!payload)throw new Error('Local database is missing.');
  const k=await deriveKey(pin,b64ToBytes(meta.salt));
  state=await decryptState(payload,k);cryptoKey=k;
  await saveState(); // migration save
}
function bumpLock(){
  clearTimeout(autoLockTimer);
  if(!state)return;
  const mins=Math.max(1,Number(state.settings.autoLockMinutes)||15);
  autoLockTimer=setTimeout(()=>{cryptoKey=null;state=null;showLock()},mins*60000);
}
['pointerdown','keydown','touchstart'].forEach(ev=>addEventListener(ev,()=>{if(state)bumpLock()},{passive:true}));

/* ---------- Startup ---------- */
function fatalStartup(title,detail){
  APP.innerHTML=`<section class="startup-error"><h2>${esc(title)}</h2><p>${esc(detail)}</p><p class="muted">This build is intended to run from an HTTPS web address in Safari, then be added to the Home Screen.</p></section>`;
}
window.addEventListener('error',e=>{if(!state&&APP)fatalStartup('House Checks could not start',e.message||'Unknown JavaScript error')});
window.addEventListener('unhandledrejection',e=>{if(!state&&APP)fatalStartup('House Checks database could not start',e.reason?.message||String(e.reason||'Unknown startup error'))});

async function compatibilityCheck(){
  if(!window.isSecureContext && location.hostname!=='localhost')throw new Error('This app must be opened from a secure HTTPS address.');
  if(!('indexedDB'in window))throw new Error('IndexedDB is unavailable in this browser.');
  if(!window.crypto?.subtle)throw new Error('WebCrypto is unavailable. Open the hosted app in Safari.');
  await openDb();
}
async function start(){
  try{
    await compatibilityCheck();
    showLock();
    if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }catch(e){fatalStartup('Phone startup check failed',e.message)}
}

/* ---------- Lock / Setup ---------- */
async function showLock(){
  clearTimeout(autoLockTimer);
  hideFullNames();
  const exists=await databaseExists();
  APP.innerHTML=`<section class="lock panel">
    <div class="logo"><img src="icon-192.png" alt="House Checks"></div>
    <h1 class="title">${exists?'Unlock House Checks':'Set Up House Checks'} <span class="version">v${VERSION}</span></h1>
    <p class="muted">${exists?'Enter your PIN to unlock the encrypted internal database.':'Create the encrypted internal database on this phone. The report-text number can be your own cell while testing.'}</p>
    <form id="lockForm" class="setup-grid">
      <div class="field"><label>${exists?'PIN':'Create PIN'}</label><input id="pin" type="password" inputmode="numeric" minlength="4" required autocomplete="off"></div>
      ${exists?'':`
        <div class="field"><label>Confirm PIN</label><input id="pin2" type="password" inputmode="numeric" minlength="4" required autocomplete="off"></div>
        <div class="field"><label>Report Text Cell Number</label><input id="setupTextNumber" type="tel" inputmode="tel" placeholder="(555) 555-1212" required></div>
        <div class="setup-test"><button class="btn" id="setupTestText" type="button">Test Text Number</button><span class="muted">Opens a harmless test draft. It does not send automatically.</span></div>
      `}
      <div class="error" id="lockError"></div>
      <button class="btn primary" type="submit">${exists?'Unlock':'Create Secure Database'}</button>
    </form>
  </section>`;
  if(!exists){
    document.getElementById('setupTestText').onclick=()=>{
      const n=digits(document.getElementById('setupTextNumber').value);
      if(n.length<10){document.getElementById('lockError').textContent='Enter a valid cell number first.';return}
      openSms(n,'SCC-CTD House Checks TEST: report texting is configured correctly.');
    };
  }
  document.getElementById('lockForm').onsubmit=async e=>{
    e.preventDefault();
    const err=document.getElementById('lockError'), pin=document.getElementById('pin').value;
    err.textContent='';
    if(pin.length<4){err.textContent='Use at least 4 characters for the PIN.';return}
    try{
      if(exists){
        await unlockDatabase(pin);
      }else{
        if(pin!==document.getElementById('pin2').value){err.textContent='PINs do not match.';return}
        const n=digits(document.getElementById('setupTextNumber').value);
        if(n.length<10){err.textContent='Enter the report-text cell number.';return}
        await setupDatabase(pin,n);
      }
      renderShell();
    }catch(ex){err.textContent='Could not open the secure database. '+(ex?.message||'Check the PIN.')}
  };
}

/* ---------- Shell / navigation ---------- */
function renderShell(){
  bumpLock();
  APP.innerHTML=`<div class="shell">
    <div class="top">
      <div class="brandrow"><img class="appmark" src="icon-192.png" alt=""><div><div class="brand">SCC-CTD • House Checks <span class="version">v${VERSION}</span></div><div class="sub">Encrypted internal database • complete reports • local history</div></div></div>
      <div class="nav" id="nav"></div>
    </div>
    <div id="view"></div>
    <div class="footer">Client names and door codes live in the encrypted internal database on this device. The hosted app package itself contains no private roster. <span class="version">v${VERSION}</span></div>
  </div>`;
  render();
}
function drawNav(){
  const nav=document.getElementById('nav');
  const items=[['tonight','Tonight'],['search','Client Search'],['route','Route'],['report','Report'],['history','History'],['properties','Properties'],['locations','Locations'],['database','Database'],['settings','Settings']];
  nav.innerHTML=items.map(([k,l])=>`<button data-nav="${k}" class="${screen===k?'active':''}">${l}</button>`).join('');
  nav.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{
    hideFullNames();
    screen=b.dataset.nav;activePropertyId=editPropertyId=editLocationId=null;reportApproved=false;historyOpenId=null;render();
  });
}
function render(){
  drawNav();
  if(activePropertyId)return renderHouse();
  if(screen==='search')return renderClientSearch();
  if(screen==='route')return renderRoute();
  if(screen==='report')return renderReport();
  if(screen==='history')return renderHistory();
  if(screen==='properties')return renderProperties();
  if(screen==='locations')return renderLocations();
  if(screen==='database')return renderDatabase();
  if(screen==='settings')return renderSettings();
  renderTonight();
}

/* ---------- Tonight ---------- */
function houseClass(p){return `house-${p.houseColor||'none'} ${p.checkRequired===false?'not-required':''}`}
function renderTonight(){
  const view=document.getElementById('view'),T=totalsFor();
  view.innerHTML=`<section class="panel">
    <div class="titlebar"><div class="title">Tonight’s House Checks</div>${nameRevealButton()}</div>
    <div class="kpirow">
      <div class="kpi"><strong>${T.checked}</strong>Checked</div>
      <div class="kpi"><strong>${T.missing}</strong>Missing</div>
      <div class="kpi"><strong>${T.notRequired}</strong>Not Required</div>
      <div class="kpi"><strong>${state.properties.length}</strong>Total Houses</div>
    </div>
    <div class="muted" style="margin-top:8px">Every configured house will appear on the final report, including houses marked Not Required Tonight.</div>
  </section>
  <section class="grid">${state.properties.map(p=>{
    const g=progress(p),open=p.rooms.filter(r=>r.type==='open').length,noBed=p.rooms.filter(r=>r.type==='nobed').length;
    return `<article class="card ${houseClass(p)}">
      <h3>${p.houseColor?`<span class="house-color ${p.houseColor}"></span> `:''}${esc(p.address)}</h3>
      <div class="houseflag">${
        p.checkRequired===false
          ? `<span class="notrequired">● NOT REQUIRED TONIGHT</span>`
          : g.missing>0
            ? `<span class="required">● CHECKS REQUIRED</span>`
            : `<span class="complete">● COMPLETE</span>`
      }</div>
      <div class="meta">${p.beds} beds • ${p.checkRequired===false?'excluded from missing count':`${g.done}/${g.total} checked`} • ${open} open • ${noBed} no bed</div>
      <div class="progress"><span style="width:${g.pct}%"></span></div>
      <div class="actions"><button class="btn ${p.checkRequired!==false?'primary':''}" data-open="${esc(p.id)}">${p.checkRequired!==false?'Open House':'View House'}</button>${p.checkRequired!==false?`<span class="badge">${g.pct}%</span>`:'<span class="badge">N/R</span>'}</div>
    </article>`;
  }).join('')||'<div class="panel"><div class="muted">No properties are loaded yet. Import the private starter data from Database, or add properties manually.</div></div>'}</section>
  <div class="actions"><button class="btn primary" id="finishRun">Finish Run → Preview Complete Report</button></div>`;
  const nameToggle=document.getElementById('toggleNames');
  if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderTonight()};
  view.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{activePropertyId=b.dataset.open;revealCode=false;render()});
  document.getElementById('finishRun').onclick=()=>{hideFullNames();screen='report';reportApproved=false;render()};
}
function roomCheckHtml(p,r,i){
  if(r.type==='open')return `<div class="room"><div class="roomno">${esc(r.room)}</div><div><span class="tag open">OPEN / EMPTY</span></div></div>`;
  if(r.type==='nobed')return `<div class="room"><div class="roomno">${esc(r.room)}</div><div><span class="tag nobed">NO BED</span></div></div>`;
  const c=getCheck(p.id,r.room),noteNeeded=requiresNote(c.status),noteMissing=noteNeeded&&!String(c.note||'').trim();
  return `<div class="room"><div class="roomno">${esc(r.room)}</div><div>
    <div class="name ${r.color||'none'}">${esc(displayClientName(r.name))}</div>
    ${r.phone?`<div class="muted"><a href="tel:${esc(r.phone)}">${esc(fmtPhone(r.phone))}</a></div>`:''}
    ${r.note?`<div class="muted">${esc(r.note)}</div>`:''}
    ${p.checkRequired===false
      ?`<div class="status-note">No house check required tonight. This client will still appear on the complete final report.</div>`
      :`<div class="statuses">${['Home','Not Home','Sleep','Pass'].map(s=>`<button class="status ${c.status===s?'sel':''}" data-i="${i}" data-status="${s}">${s}</button>`).join('')}</div>
        ${noteMissing?`<div class="required-note-alert">NOTE REQUIRED for ${esc(c.status)} before this client is resolved.</div>`:''}
        <textarea class="note ${noteMissing?'note-required':''}" data-note="${i}" ${noteNeeded?'required':''} placeholder="${noteNeeded?'Required note — explain '+esc(c.status)+'…':'Optional note…'}">${esc(c.note)}</textarea>`}
  </div></div>`;
}
function renderHouse(){
  const p=state.properties.find(x=>x.id===activePropertyId);if(!p){activePropertyId=null;return render()}
  const g=progress(p),view=document.getElementById('view');
  view.innerHTML=`<section class="panel"><div class="househead">
    <div><div class="actions"><button class="btn" id="backHouses">← Houses</button>${nameRevealButton()}</div><h2 class="title" style="margin-top:10px">${esc(p.address)}</h2><div class="houseflag">${
      p.checkRequired===false
        ? '<span class="notrequired">NOT REQUIRED TONIGHT</span>'
        : g.missing>0
          ? '<span class="required">CHECKS REQUIRED</span>'
          : '<span class="complete">COMPLETE</span>'
    }</div><div class="muted">${p.beds} beds ${p.checkRequired!==false?`• ${g.done}/${g.total} checked`:''}</div></div>
    <div class="codebox"><b>Door code:</b> ${revealCode?esc(p.doorCode||'Not entered'):'••••••'} <button class="btn" id="toggleCode">${revealCode?'Hide':'Reveal'}</button></div>
  </div></section>
  <section class="panel">${p.rooms.map((r,i)=>roomCheckHtml(p,r,i)).join('')}</section>
  <div class="actions"><button class="btn primary" id="doneHouse">Done With House</button><button class="btn" id="editHouse">Edit Property</button></div>`;
  document.getElementById('backHouses').onclick=()=>{hideFullNames();activePropertyId=null;render()};
  const nameToggle=document.getElementById('toggleNames');
  if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderHouse()};
  document.getElementById('toggleCode').onclick=()=>{revealCode=!revealCode;renderHouse()};
  document.getElementById('doneHouse').onclick=async()=>{
    view.querySelectorAll('[data-note]').forEach(n=>{
      const r=p.rooms[+n.dataset.note];
      getCheck(p.id,r.room).note=n.value;
    });
    const issues=requiredNoteIssues([p],state.currentRun.checks);
    if(issues.length){
      await saveState();
      alert(`A note is required for ${displayClientName(issues[0].name)} because ${issues[0].status} is selected.`);
      renderHouse();
      const target=[...document.querySelectorAll('[data-note]')].find(n=>{
        const r=p.rooms[+n.dataset.note];
        return r && r.room===issues[0].room;
      });
      target?.focus();
      return;
    }
    await saveState();
    activePropertyId=null;render();
  };
  document.getElementById('editHouse').onclick=()=>{editPropertyId=p.id;activePropertyId=null;screen='properties';render()};
  view.querySelectorAll('.status').forEach(b=>b.onclick=async()=>{
    const r=p.rooms[+b.dataset.i],c=getCheck(p.id,r.room);
    c.status=b.dataset.status;
    await saveState();
    const needsNote=requiresNote(c.status)&&!String(c.note||'').trim();
    renderHouse();
    if(needsNote){
      const target=document.querySelector(`[data-note="${b.dataset.i}"]`);
      target?.focus();
    }
  });
  view.querySelectorAll('[data-note]').forEach(n=>n.onchange=async()=>{
    const r=p.rooms[+n.dataset.note];getCheck(p.id,r.room).note=n.value;await saveState();renderHouse();
  });
}

/* ---------- Properties ---------- */
function renderProperties(){
  const view=document.getElementById('view');
  view.innerHTML=`<section class="panel"><div class="titlebar"><div class="title">Properties & Rosters</div>${nameRevealButton('Show Full Names')}</div><div class="muted">Manage addresses, bed capacity, door codes, house colors, and whether a house requires a check tonight. Client names are masked by default.</div></section>
  <section class="grid">${state.properties.map(p=>`<article class="card ${houseClass(p)}"><h3>${esc(p.address)}</h3><div class="meta">${p.beds} beds • ${clients(p).length} clients • ${p.checkRequired!==false?'check required':'not required tonight'}</div><div class="actions"><button class="btn" data-edit="${esc(p.id)}">Edit</button><button class="btn red" data-delete="${esc(p.id)}">Remove</button></div></article>`).join('')}</section>
  <div class="actions"><button class="btn primary" id="addProperty">+ Add Property</button></div><div id="propertyEditor"></div>`;
  const nameToggle=document.getElementById('toggleNames');
  if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderProperties()};
  view.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{editPropertyId=b.dataset.edit;renderProperties()});
  view.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{
    const p=state.properties.find(x=>x.id===b.dataset.delete);if(!p||!confirm(`Remove ${p.address}?`))return;
    state.properties=state.properties.filter(x=>x.id!==p.id);state.route.stops=state.route.stops.filter(s=>!(s.kind==='property'&&s.id===p.id));await saveState();renderProperties();
  });
  document.getElementById('addProperty').onclick=()=>{
    const p=normalizeProperty({id:uuid(),address:'New Property',doorCode:'',beds:1,checkRequired:true,houseColor:'',rooms:[{room:'1',type:'open',name:'OPEN'}]});
    state.properties.push(p);editPropertyId=p.id;renderProperties();
  };
  if(editPropertyId)renderPropertyEditor(state.properties.find(p=>p.id===editPropertyId));
}
function roomEditorHtml(r,i){
  return `<div class="roomedit" data-row="${i}">
    <input data-f="room" value="${esc(r.room)}" aria-label="Room">
    <select data-f="type"><option value="client" ${r.type==='client'?'selected':''}>Client</option><option value="open" ${r.type==='open'?'selected':''}>Open</option><option value="nobed" ${r.type==='nobed'?'selected':''}>No Bed</option></select>
    <input data-f="name" value="${esc(r.type==='client'?(showFullNames?r.name:maskClientName(r.name)):'')}" data-fullname="${esc(r.name||'')}" placeholder="Client name">
    <input class="wide" data-f="phone" value="${esc(r.phone||'')}" placeholder="Cell phone">
    <select data-f="color"><option value="" ${!r.color?'selected':''}>No color</option><option value="green" ${r.color==='green'?'selected':''}>Green</option><option value="gray" ${r.color==='gray'?'selected':''}>Gray</option></select>
    <button class="btn red" data-remove="${i}">Remove</button>
  </div>`;
}
function renderPropertyEditor(p){
  if(!p)return;
  const e=document.getElementById('propertyEditor');
  e.innerHTML=`<section class="panel"><div class="title">Editing ${esc(p.address)}</div>
    <div class="formgrid">
      <div class="field"><label>Address</label><input id="propAddress" value="${esc(p.address)}"></div>
      <div class="field"><label>Door code</label><input id="propCode" value="${esc(p.doorCode)}"></div>
      <div class="field"><label>Number of beds</label><input id="propBeds" type="number" min="1" max="60" value="${p.beds}"></div>
      <div class="field"><label>House color</label><select id="propColor"><option value="" ${!p.houseColor?'selected':''}>No house color</option><option value="green" ${p.houseColor==='green'?'selected':''}>Green</option><option value="gray" ${p.houseColor==='gray'?'selected':''}>Gray</option><option value="yellow" ${p.houseColor==='yellow'?'selected':''}>Yellow</option><option value="red" ${p.houseColor==='red'?'selected':''}>Red</option></select></div>
      <label class="checkboxline"><input id="propRequired" type="checkbox" ${p.checkRequired!==false?'checked':''}> House check required tonight</label>
    </div>
    <div class="notice">A property marked Not Required Tonight remains on the complete final report. It is not counted as missing.</div>
    <h3>Beds / Rooms</h3>${p.rooms.map(roomEditorHtml).join('')}
    <div class="actions"><button class="btn" id="addBed">+ Bed</button><button class="btn primary" id="saveProperty">Save Property</button><button class="btn" id="cancelProperty">Cancel</button></div>
  </section>`;
  document.getElementById('propBeds').onchange=()=>{
    const input=document.getElementById('propBeds'),n=Math.max(1,Math.min(60,+input.value||1));
    if(n<p.rooms.length){
      const occupied=p.rooms.slice(n).filter(r=>r.type==='client');
      if(occupied.length&&!confirm(`Reducing capacity removes: ${occupied.map(r=>r.name).join(', ')}. Continue?`)){input.value=p.rooms.length;return}
      p.rooms=p.rooms.slice(0,n);
    }else while(p.rooms.length<n)p.rooms.push(normalizeRoom({room:p.rooms.length+1,type:'open',name:'OPEN'},p.rooms.length));
    p.beds=p.rooms.length;renderPropertyEditor(p);
  };
  document.getElementById('addBed').onclick=()=>{p.rooms.push(normalizeRoom({room:p.rooms.length+1,type:'open',name:'OPEN'},p.rooms.length));p.beds=p.rooms.length;renderPropertyEditor(p)};
  e.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{
    const r=p.rooms[+b.dataset.remove];if(r.type==='client'&&!confirm(`Remove ${r.name}?`))return;p.rooms.splice(+b.dataset.remove,1);p.beds=p.rooms.length;renderPropertyEditor(p);
  });
  document.getElementById('cancelProperty').onclick=()=>{editPropertyId=null;renderProperties()};
  document.getElementById('saveProperty').onclick=async()=>{
    p.address=document.getElementById('propAddress').value.trim()||'Unnamed Property';
    p.doorCode=document.getElementById('propCode').value.trim();
    p.houseColor=document.getElementById('propColor').value;
    p.checkRequired=document.getElementById('propRequired').checked;
    e.querySelectorAll('[data-row]').forEach(row=>{
      const r=p.rooms[+row.dataset.row];r.room=row.querySelector('[data-f="room"]').value.trim()||String(+row.dataset.row+1);r.type=row.querySelector('[data-f="type"]').value;
      if(r.type==='client'){
        const nameInput=row.querySelector('[data-f="name"]'),typed=nameInput.value.trim(),original=nameInput.dataset.fullname||'';
        r.name=(!showFullNames && typed===maskClientName(original)) ? original : (typed||'Unnamed Client');
      }else r.name=r.type==='open'?'OPEN':'NO BED';
      r.phone=r.type==='client'?row.querySelector('[data-f="phone"]').value.trim():'';r.color=r.type==='client'?row.querySelector('[data-f="color"]').value:'';
    });
    p.beds=p.rooms.length;await saveState();editPropertyId=null;renderProperties();
  };
}


/* ---------- 3x3 Client Search ---------- */
function clientSearchResults(query){
  const q=String(query||'').replace(/[^a-z0-9]/gi,'').toLowerCase();
  if(q.length<3)return [];
  const out=[];
  for(const p of state.properties){
    for(const r of p.rooms){
      if(r.type!=='client')continue;
      const key=clientSearchKey(r.name);
      if(key.includes(q) || q.includes(key)){
        out.push({property:p,room:r,key});
      }
    }
  }
  return out;
}
function renderClientSearch(){
  const view=document.getElementById('view'),results=clientSearchResults(clientSearchQuery);
  view.innerHTML=`<section class="panel">
    <div class="titlebar"><div><div class="title">3×3 Client Search</div><div class="muted">Search using the first 3 letters of the first name + first 3 letters of the last name. Example: Bra Wal or BraWal.</div></div>${nameRevealButton()}</div>
    <div class="searchbar"><input id="clientSearch" autocomplete="off" placeholder="e.g. Bra Wal" value="${esc(clientSearchQuery)}"><button class="btn" id="clearSearch">Clear</button></div>
    <div class="privacy-hint">Full names are hidden by default. “Show All Names” is temporary and automatically hides again.</div>
  </section>
  <section class="search-results">${
    clientSearchQuery.replace(/[^a-z0-9]/gi,'').length<3
      ? '<div class="panel"><div class="muted">Enter at least 3 letters to search.</div></div>'
      : results.length
        ? results.map(x=>`<article class="card search-result"><div><div class="name ${x.room.color||'none'}">${esc(displayClientName(x.room.name))}</div><div class="meta">${esc(x.property.address)} • Room ${esc(x.room.room)}</div></div><button class="btn primary" data-findhouse="${esc(x.property.id)}">Open House</button></article>`).join('')
        : '<div class="panel"><div class="muted">No matching client found.</div></div>'
  }</section>`;
  const input=document.getElementById('clientSearch');
  input.oninput=()=>{clientSearchQuery=input.value;renderClientSearch();const again=document.getElementById('clientSearch');again?.focus();again?.setSelectionRange(again.value.length,again.value.length)};
  document.getElementById('clearSearch').onclick=()=>{clientSearchQuery='';renderClientSearch()};
  const nameToggle=document.getElementById('toggleNames');
  if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderClientSearch()};
  view.querySelectorAll('[data-findhouse]').forEach(b=>b.onclick=()=>{hideFullNames();activePropertyId=b.dataset.findhouse;revealCode=false;render()});
}

/* ---------- Locations + Route ---------- */
function renderLocations(){
  const view=document.getElementById('view');
  view.innerHTML=`<section class="panel"><div class="title">Other Relevant Locations</div><div class="muted">Non-residential places can be stored and routed without appearing on the house-check report.</div></section>
  <section class="grid">${state.locations.map(l=>`<article class="card"><h3>${esc(l.name)}</h3><div class="meta">${esc(l.type)} • ${esc(l.address)}</div>${l.phone?`<div class="muted">${esc(fmtPhone(l.phone))}</div>`:''}<div class="actions"><button class="btn" data-editloc="${esc(l.id)}">Edit</button><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.address)}">Map</a><button class="btn red" data-delloc="${esc(l.id)}">Remove</button></div></article>`).join('')||'<div class="muted">No extra locations saved yet.</div>'}</section>
  <div class="actions"><button class="btn primary" id="addLocation">+ Add Location</button></div><div id="locationEditor"></div>`;
  view.querySelectorAll('[data-editloc]').forEach(b=>b.onclick=()=>{editLocationId=b.dataset.editloc;renderLocations()});
  view.querySelectorAll('[data-delloc]').forEach(b=>b.onclick=async()=>{state.locations=state.locations.filter(l=>l.id!==b.dataset.delloc);state.route.stops=state.route.stops.filter(s=>!(s.kind==='location'&&s.id===b.dataset.delloc));await saveState();renderLocations()});
  document.getElementById('addLocation').onclick=()=>{const l={id:uuid(),name:'New Location',address:'',type:'Other',phone:'',notes:''};state.locations.push(l);editLocationId=l.id;renderLocations()};
  if(editLocationId)renderLocationEditor(state.locations.find(l=>l.id===editLocationId));
}
function renderLocationEditor(l){
  if(!l)return;
  const e=document.getElementById('locationEditor');
  e.innerHTML=`<section class="panel"><div class="title">Edit Location</div><div class="formgrid">
    <div class="field"><label>Name</label><input id="locName" value="${esc(l.name)}"></div>
    <div class="field"><label>Address</label><input id="locAddress" value="${esc(l.address)}"></div>
    <div class="field"><label>Type</label><select id="locType">${['Office','Meeting Site','Pickup / Drop-off','Medical','Pharmacy','Other'].map(t=>`<option ${l.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="field"><label>Phone</label><input id="locPhone" value="${esc(l.phone)}"></div>
  </div><div class="field" style="margin-top:8px"><label>Notes</label><textarea id="locNotes">${esc(l.notes)}</textarea></div><div class="actions"><button class="btn primary" id="saveLocation">Save Location</button></div></section>`;
  document.getElementById('saveLocation').onclick=async()=>{l.name=document.getElementById('locName').value.trim()||'Unnamed Location';l.address=document.getElementById('locAddress').value.trim();l.type=document.getElementById('locType').value;l.phone=document.getElementById('locPhone').value.trim();l.notes=document.getElementById('locNotes').value.trim();await saveState();editLocationId=null;renderLocations()};
}
function stopObj(s){return s.kind==='property'?state.properties.find(p=>p.id===s.id):state.locations.find(l=>l.id===s.id)}
function stopLabel(s){const o=stopObj(s);return o?(s.kind==='property'?o.address:`${o.name} • ${o.address}`):'Missing stop'}
function stopAddress(s){return stopObj(s)?.address||''}
function renderRoute(){
  const view=document.getElementById('view');
  view.innerHTML=`<section class="panel"><div class="title">Circular Route Planner</div><div class="muted">Properties and saved locations can both be route stops.</div></section>
  <section class="panel"><h3>Properties</h3><div class="grid">${state.properties.map(p=>`<label class="checkline"><input type="checkbox" data-kind="property" data-id="${esc(p.id)}" ${state.route.stops.some(s=>s.kind==='property'&&s.id===p.id)?'checked':''}>${esc(p.address)}</label>`).join('')}</div>
  <h3>Other Locations</h3><div class="grid">${state.locations.map(l=>`<label class="checkline"><input type="checkbox" data-kind="location" data-id="${esc(l.id)}" ${state.route.stops.some(s=>s.kind==='location'&&s.id===l.id)?'checked':''}>${esc(l.name)} • ${esc(l.address)}</label>`).join('')||'<div class="muted">No extra locations stored.</div>'}</div></section>
  <section class="panel"><div class="title">Route Order</div><div id="routeOrder"></div><div class="actions"><a id="mapsLink" class="btn primary" target="_blank" rel="noopener">Open Circular Trip in Google Maps</a></div></section>`;
  view.querySelectorAll('[data-kind]').forEach(c=>c.onchange=async()=>{
    const s={kind:c.dataset.kind,id:c.dataset.id};
    if(c.checked&&!state.route.stops.some(x=>x.kind===s.kind&&x.id===s.id))state.route.stops.push(s);
    if(!c.checked)state.route.stops=state.route.stops.filter(x=>!(x.kind===s.kind&&x.id===s.id));
    await saveState();renderRoute();
  });
  const stops=state.route.stops.filter(s=>stopAddress(s)),box=document.getElementById('routeOrder');
  box.innerHTML=stops.map((s,i)=>`<div class="route"><b>${i+1}</b><span>${esc(stopLabel(s))}</span><span><button class="btn" data-up="${i}" ${i===0?'disabled':''}>↑</button><button class="btn" data-down="${i}" ${i===stops.length-1?'disabled':''}>↓</button></span></div>`).join('')||'<div class="muted">Select at least two stops.</div>';
  box.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>moveRoute(+b.dataset.up,-1));
  box.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>moveRoute(+b.dataset.down,1));
  const a=document.getElementById('mapsLink');
  if(stops.length<2){a.style.opacity='.45';a.removeAttribute('href')}else{const ads=stops.map(stopAddress),start=ads[0];a.href=`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(start)}&destination=${encodeURIComponent(start)}&waypoints=${encodeURIComponent(ads.slice(1).join('|'))}&travelmode=driving`}
}
async function moveRoute(i,d){const j=i+d;if(j<0||j>=state.route.stops.length)return;[state.route.stops[i],state.route.stops[j]]=[state.route.stops[j],state.route.stops[i]];await saveState();renderRoute()}

/* ---------- Report ---------- */
function currentSnapshot(completedAt=null){
  return {
    id:state.currentRun.id,
    startedAt:state.currentRun.startedAt,
    completedAt,
    driverName:state.settings.driverName,
    properties:deepClone(state.properties),
    checks:deepClone(state.currentRun.checks)
  };
}
function statusFor(snapshot,p,r){
  if(r.type==='open')return 'OPEN';
  if(r.type==='nobed')return 'NO BED';
  if(p.checkRequired===false)return 'NOT REQ';
  const c=snapshot.checks[checkKey(p.id,r.room)];
  if(!c?.status)return 'MISSING';
  if(requiresNote(c.status)&&!String(c.note||'').trim())return `${c.status} • NOTE REQ`;
  return c.status;
}
function reportPaper(snapshot,id='reportPaper'){
  const T=totalsFor(snapshot.properties,snapshot.checks),stamp=snapshot.completedAt?new Date(snapshot.completedAt):new Date();
  return `<div class="paper" id="${id}">
    <div class="paperhead"><div class="papertitle">HOUSE CHECK REPORT</div><div class="papermeta">${esc(snapshot.driverName||'Driver')} • ${esc(stamp.toLocaleString())} • ${T.checked}/${T.required} checked • ${T.missing} missing • ${T.notRequired} houses N/R</div></div>
    <div class="papergrid">${snapshot.properties.map(p=>`<div class="paperhouse house-${p.houseColor||'none'}"><h4>${esc(p.address)} • ${p.beds} beds${p.checkRequired===false?' • NOT REQUIRED TONIGHT':''}</h4>${p.rooms.map(r=>{
      const status=statusFor(snapshot,p,r),c=snapshot.checks[checkKey(p.id,r.room)],nightNote=String(c?.note||'').trim(), cls=r.type==='open'?'open':r.type==='nobed'?'nobed':p.checkRequired===false?'notrequired':(status==='MISSING'||status.includes('NOTE REQ'))?'missing':r.color||'';
      return `<div class="paperrow ${cls}"><span>${esc(r.room)}</span><span>${esc(displayClientName(r.name))}${nightNote?`<small class="report-note">${esc(nightNote)}</small>`:''}</span><span>${esc(status)}</span></div>`;
    }).join('')}</div>`).join('')}</div>
    <div class="paperfoot">Complete roster report. Houses marked NOT REQUIRED remain included. MISSING means a required client has no recorded check result. Report anyone you can't reach and can't see to the on-call person.</div>
  </div>`;
}
function renderReport(){
  const view=document.getElementById('view'),snap=currentSnapshot(),T=totalsFor();
  view.innerHTML=`<section class="panel"><div class="titlebar"><div class="title">${reportApproved?'Final Report':'Preview Complete Final Report'}</div>${nameRevealButton()}</div><div class="muted">${reportApproved?'Approved and ready to print, save, email, text, or archive.':'Every configured property is included. Verify missing vs not-required before approval.'} Client names are masked by default.</div></section>
  <section class="reportwrap">${reportPaper(snap)}</section>
  <section class="panel">${reportApproved?`<div class="delivery">
    <button class="btn" id="previewAgain">Preview Again</button><button class="btn" id="printReport">Print</button><button class="btn" id="saveReport">Save Snapshot</button><button class="btn" id="emailReport">Email Report</button><button class="btn green" id="textReport">Text Report</button><button class="btn primary" id="completeRun">Complete & Save to History</button>
  </div>`:`<div class="actions"><button class="btn" id="backChecks">← Back to Checks</button><button class="btn primary" id="approveReport">Approve Complete Report</button></div>`}
  <div class="notice">${reportApproved?`Report text recipient: ${esc(fmtPhone(state.settings.reportTextNumber))}. No message is sent until you finish it in Messages.`:`${T.checked} checked • ${T.missing} missing • ${T.notRequired} houses not required • ${state.properties.length} total houses in report.`}</div></section>`;
  const nameToggle=document.getElementById('toggleNames');
  if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderReport()};
  if(!reportApproved){
    document.getElementById('backChecks').onclick=()=>{hideFullNames();screen='tonight';render()};
    document.getElementById('approveReport').onclick=()=>{
      const issues=requiredNoteIssues();
      if(issues.length){
        alert(`${issues.length} non-Home result${issues.length===1?'':'s'} still require${issues.length===1?'s':''} a note. First: ${displayClientName(issues[0].name)} at ${issues[0].address} (${issues[0].status}).`);
        return;
      }
      reportApproved=true;renderReport();
    };
  }else{
    document.getElementById('previewAgain').onclick=()=>{reportApproved=false;renderReport()};
    document.getElementById('printReport').onclick=()=>window.print();
    document.getElementById('saveReport').onclick=()=>downloadSnapshot(snap);
    document.getElementById('emailReport').onclick=()=>emailSnapshot(snap);
    document.getElementById('textReport').onclick=()=>textSnapshot(snap);
    document.getElementById('completeRun').onclick=completeRun;
  }
}
async function makeReportPng(snapshot){
  const W=1650,H=1275,c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');
  x.fillStyle='#fff';x.fillRect(0,0,W,H);x.fillStyle='#111';x.font='bold 28px system-ui';x.textAlign='left';x.fillText('HOUSE CHECK REPORT',28,38);
  const stamp=snapshot.completedAt?new Date(snapshot.completedAt):new Date();x.textAlign='right';x.font='16px system-ui';x.fillText(`${snapshot.driverName||'Driver'} • ${stamp.toLocaleString()}`,W-28,38);
  x.strokeStyle='#17365d';x.lineWidth=3;x.beginPath();x.moveTo(28,52);x.lineTo(W-28,52);x.stroke();
  const cols=4,gap=12,left=28,top=68,cw=(W-left*2-gap*(cols-1))/cols,ys=[top,top,top,top],rh=20,hh=28;
  const headColors={green:'#3d856d',gray:'#65717a',yellow:'#b59c34',red:'#a84742'};
  for(const p of snapshot.properties){
    const col=ys.indexOf(Math.min(...ys)),px=left+col*(cw+gap),py=ys[col],h=hh+p.rooms.length*rh+5;
    x.strokeStyle='#555';x.strokeRect(px,py,cw,h);x.fillStyle=headColors[p.houseColor]||'#2d6f9f';x.fillRect(px,py,cw,hh);
    x.fillStyle=p.houseColor==='yellow'?'#111':'#fff';x.font='bold 11px system-ui';x.textAlign='left';x.fillText(`${p.address} • ${p.beds} beds${p.checkRequired===false?' • NOT REQUIRED':''}`,px+6,py+18);
    p.rooms.forEach((r,i)=>{
      const ry=py+hh+i*rh,status=statusFor(snapshot,p,r),c=snapshot.checks[checkKey(p.id,r.room)],nightNote=String(c?.note||'').trim();
      let fill='#fff';
      if(r.type==='open')fill='#fff4a6';else if(r.type==='nobed')fill='#e46a61';else if(p.checkRequired===false)fill='#f2edcf';else if(status==='MISSING')fill='#ffd9d6';else if(r.color==='green')fill='#cdebe3';else if(r.color==='gray')fill='#ddd';
      x.fillStyle=fill;x.fillRect(px,ry,cw,rh);x.strokeStyle='#bbb';x.strokeRect(px,ry,cw,rh);x.fillStyle='#111';x.font='10px system-ui';x.textAlign='left';x.fillText(`${r.room}  ${maskClientName(r.name)}${nightNote?' • '+nightNote:''}`.slice(0,52),px+5,ry+14);x.textAlign='right';x.fillText(status,px+cw-5,ry+14);
    });ys[col]+=h+8;
  }
  x.fillStyle='#111';x.textAlign='left';x.font='12px system-ui';x.fillText("Complete roster report. NOT REQUIRED remains included; MISSING means a required client has no result.",28,H-24);
  return new Promise(res=>c.toBlob(res,'image/png',.95));
}
function reportFilename(snapshot){const d=(snapshot.completedAt?new Date(snapshot.completedAt):new Date()).toISOString().slice(0,10);return `house-check-report-${d}.png`}
async function downloadSnapshot(snapshot){const b=await makeReportPng(snapshot),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=reportFilename(snapshot);a.click();setTimeout(()=>URL.revokeObjectURL(u),1200)}
function openSms(number,body){const n=digits(number);if(!n)return;location.href=`sms:${n}?body=${encodeURIComponent(body)}`}
function reportMessage(snapshot){const T=totalsFor(snapshot.properties,snapshot.checks),when=snapshot.completedAt?new Date(snapshot.completedAt).toLocaleString():new Date().toLocaleString();return `SCC-CTD House Check Report ${when}. ${T.checked}/${T.required} required client checks recorded; ${T.missing} missing; ${T.notRequired} houses marked not required. Report image prepared.`}
async function textSnapshot(snapshot){
  const n=digits(state.settings.reportTextNumber);if(n.length<10){alert('Set the Report Text Cell Number in Settings first.');screen='settings';render();return}
  const b=await makeReportPng(snapshot),f=new File([b],reportFilename(snapshot),{type:'image/png'}),msg=reportMessage(snapshot);
  try{
    if(navigator.canShare&&navigator.share&&navigator.canShare({files:[f]})){
      if(confirm(`Share the report image now? Choose Messages and send it to ${fmtPhone(n)}. Cancel opens a text draft to that number instead.`)){await navigator.share({title:'House Check Report',text:`Recipient: ${fmtPhone(n)}\n${msg}`,files:[f]});return}
    }
  }catch{}
  openSms(n,msg+' Attach the saved report image if needed.');
}
async function emailSnapshot(snapshot){
  const b=await makeReportPng(snapshot),f=new File([b],reportFilename(snapshot),{type:'image/png'}),msg=reportMessage(snapshot);
  try{if(navigator.canShare&&navigator.share&&navigator.canShare({files:[f]})){await navigator.share({title:'House Check Report',text:msg,files:[f]});return}}catch{}
  await downloadSnapshot(snapshot);location.href=`mailto:?subject=${encodeURIComponent('House Check Report')}&body=${encodeURIComponent(msg+' Report image saved for attachment.')}`;
}
async function completeRun(){
  const issues=requiredNoteIssues();
  if(issues.length){
    alert(`Cannot complete this run yet. ${issues.length} non-Home result${issues.length===1?'':'s'} still need${issues.length===1?'s':''} a note.`);
    reportApproved=false;
    renderReport();
    return;
  }
  const snap=currentSnapshot(new Date().toISOString()),T=totalsFor(snap.properties,snap.checks);
  state.history.push({...snap,checked:T.checked,required:T.required,missing:T.missing,notRequired:T.notRequired});
  state.currentRun={id:uuid(),startedAt:new Date().toISOString(),checks:{}};
  reportApproved=false;hideFullNames();await saveState();alert('Completed report saved to History. A fresh nightly run is ready.');screen='history';historyCalendarDate=new Date();historySelectedDate=historyLocalDateKey(snap.completedAt);render();
}

/* ---------- History ---------- */
function historyLocalDateKey(iso){
  const d=new Date(iso);
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function calendarMonthData(date){
  const y=date.getFullYear(),m=date.getMonth();
  const first=new Date(y,m,1),last=new Date(y,m+1,0);
  return {y,m,firstDay:first.getDay(),days:last.getDate()};
}
function shiftHistoryMonth(delta){
  historyCalendarDate=new Date(historyCalendarDate.getFullYear(),historyCalendarDate.getMonth()+delta,1);
  historySelectedDate=null;
  renderHistory();
}
function renderHistory(){
  const view=document.getElementById('view');
  if(historyOpenId){
    const h=state.history.find(x=>x.id===historyOpenId);if(!h){historyOpenId=null;return renderHistory()}
    view.innerHTML=`<section class="panel"><div class="titlebar"><div><button class="btn" id="backHistory">← Calendar</button><div class="title" style="margin-top:10px">Completed Report • ${esc(new Date(h.completedAt).toLocaleString())}</div><div class="muted">Saved final report. It does not change when the current roster changes.</div></div>${nameRevealButton()}</div></section>
    <section class="reportwrap">${reportPaper(h)}</section><section class="panel"><div class="delivery"><button class="btn" id="histPrint">Print</button><button class="btn" id="histSave">Save Snapshot</button><button class="btn" id="histEmail">Email</button><button class="btn green" id="histText">Text Again</button></div></section>`;
    document.getElementById('backHistory').onclick=()=>{hideFullNames();historyOpenId=null;renderHistory()};
    const nameToggle=document.getElementById('toggleNames');
    if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderHistory()};
    document.getElementById('histPrint').onclick=()=>window.print();document.getElementById('histSave').onclick=()=>downloadSnapshot(h);document.getElementById('histEmail').onclick=()=>emailSnapshot(h);document.getElementById('histText').onclick=()=>textSnapshot(h);return;
  }

  const {y,m,firstDay,days}=calendarMonthData(historyCalendarDate);
  const monthName=historyCalendarDate.toLocaleString(undefined,{month:'long',year:'numeric'});
  const counts={};
  for(const h of state.history){
    if(!h.completedAt)continue;
    const key=historyLocalDateKey(h.completedAt);
    counts[key]=(counts[key]||0)+1;
  }
  const cells=[];
  for(let i=0;i<firstDay;i++)cells.push('<div class="calcell empty"></div>');
  for(let day=1;day<=days;day++){
    const key=`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`,count=counts[key]||0;
    cells.push(`<button class="calcell ${count?'has-report':''} ${historySelectedDate===key?'selected':''}" data-date="${key}"><span class="daynum">${day}</span>${count?`<span class="report-dot">${count} report${count===1?'':'s'}</span>`:''}</button>`);
  }
  const selected=historySelectedDate ? state.history.filter(h=>historyLocalDateKey(h.completedAt)===historySelectedDate).slice().reverse() : [];
  view.innerHTML=`<section class="panel"><div class="title">History Report Calendar</div><div class="muted">Choose any month, then tap a highlighted date to open completed reports. History can go back as far as reports exist.</div></section>
  <section class="panel calendar-panel">
    <div class="calendar-head"><button class="btn" id="prevMonth">←</button><strong>${esc(monthName)}</strong><button class="btn" id="nextMonth">→</button></div>
    <div class="calweek">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<span>${d}</span>`).join('')}</div>
    <div class="calendar-grid">${cells.join('')}</div>
    <div class="actions"><button class="btn" id="calendarToday">Current Month</button></div>
  </section>
  ${historySelectedDate?`<section class="panel"><div class="title">Reports for ${esc(new Date(historySelectedDate+'T12:00:00').toLocaleDateString())}</div>
    <div class="history-list">${selected.length?selected.map(h=>`<article class="card history-card"><div><b>${esc(new Date(h.completedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}))}</b><div class="meta">${h.checked??0}/${h.required??h.total??0} checked • ${h.missing??0} missing • ${h.notRequired??0} houses N/R</div></div><button class="btn primary" data-history="${esc(h.id)}">Open Report</button></article>`).join(''):'<div class="muted">No completed report on this date.</div>'}</div>
  </section>`:''}`;
  document.getElementById('prevMonth').onclick=()=>shiftHistoryMonth(-1);
  document.getElementById('nextMonth').onclick=()=>shiftHistoryMonth(1);
  document.getElementById('calendarToday').onclick=()=>{historyCalendarDate=new Date();historySelectedDate=null;renderHistory()};
  view.querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>{historySelectedDate=b.dataset.date;renderHistory()});
  view.querySelectorAll('[data-history]').forEach(b=>b.onclick=()=>{historyOpenId=b.dataset.history;renderHistory()});
}

/* ---------- Private import / Database ---------- */
async function importPrivateData(file){
  const incoming=JSON.parse(await file.text());
  if(!incoming||!Array.isArray(incoming.properties))throw new Error('Not a House Checks starter-data file.');
  const keepText=state.settings.reportTextNumber;
  state.properties=incoming.properties.map(normalizeProperty);
  state.locations=Array.isArray(incoming.locations)?incoming.locations:[];
  state.route=incoming.route&&Array.isArray(incoming.route.stops)?incoming.route:{stops:[]};
  const incomingSettings=incoming.settings||{};
  state.settings={...state.settings,...incomingSettings,reportTextLabel:incomingSettings.reportTextLabel||incomingSettings.transportLabel||state.settings.reportTextLabel,reportTextNumber:keepText||incomingSettings.reportTextNumber||incomingSettings.transportNumber||''};
  state.currentRun={id:uuid(),startedAt:new Date().toISOString(),checks:{}};
  await saveState();
}
function exportPrivateData(){
  const payload={schemaVersion:2,properties:state.properties,locations:state.locations,route:state.route,settings:state.settings};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download='SCC_CTD_House_Checks_PRIVATE_Backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1200);
}
function renderDatabase(){
  const view=document.getElementById('view'),beds=state.properties.reduce((n,p)=>n+p.beds,0),people=state.properties.reduce((n,p)=>n+clients(p).length,0);
  view.innerHTML=`<section class="panel"><div class="title">Private Data Import / Backup</div><div class="muted">The hosted app package contains no client roster or door codes. Import the private starter data once on this phone.</div><div class="actions"><label class="btn primary" for="importData">Import Private Data</label><input id="importData" type="file" accept=".json,application/json" style="display:none"><button class="btn" id="exportData">Export Private Backup</button></div><div id="importMessage" class="muted" style="margin-top:6px"></div></section>
  <section class="panel"><div class="title">Internal Database</div><div class="dbstats"><div class="stat"><strong>${state.properties.length}</strong>Properties</div><div class="stat"><strong>${beds}</strong>Beds</div><div class="stat"><strong>${people}</strong>Clients</div><div class="stat"><strong>${state.locations.length}</strong>Locations</div><div class="stat"><strong>${state.history.length}</strong>Reports</div></div></section>`;
  document.getElementById('importData').onchange=async()=>{
    const f=document.getElementById('importData').files?.[0];if(!f)return;const msg=document.getElementById('importMessage');
    try{await importPrivateData(f);msg.textContent='Private roster imported into the encrypted local database.';setTimeout(renderDatabase,450)}catch(e){msg.textContent='Import failed: '+e.message}
  };
  document.getElementById('exportData').onclick=exportPrivateData;
}

/* ---------- Settings ---------- */
function renderSettings(){
  const s=state.settings,view=document.getElementById('view');
  view.innerHTML=`<section class="panel"><div class="title">Setup & Settings</div><div class="muted">The report-text cell number is intentionally editable so you can test with your own phone before switching to the real recipient.</div></section>
  <section class="panel"><div class="formgrid">
    <div class="field"><label>Driver name</label><input id="driverName" value="${esc(s.driverName)}"></div>
    <div class="field"><label>Organization</label><input id="organization" value="${esc(s.organization)}"></div>
    <div class="field"><label>Report recipient label</label><input id="reportLabel" value="${esc(s.reportTextLabel)}"></div>
    <div class="field"><label>Report Text Cell Number</label><input id="reportNumber" type="tel" inputmode="tel" value="${esc(fmtPhone(s.reportTextNumber))}"></div>
    <div class="field"><label>Auto-lock minutes</label><input id="autoLock" type="number" min="1" max="120" value="${Number(s.autoLockMinutes)||15}"></div>
  </div><div class="actions"><button class="btn" id="testText">Test Text</button><button class="btn primary" id="saveSettings">Save Settings</button><button class="btn" id="lockNow">Lock Now</button></div><div class="notice">Test Text opens Messages with a harmless draft to the configured number. The app never silently sends it.</div></section>`;
  document.getElementById('testText').onclick=()=>{const n=digits(document.getElementById('reportNumber').value);if(n.length<10){alert('Enter a valid report-text cell number first.');return}openSms(n,'SCC-CTD House Checks TEST: report texting is configured correctly.')};
  document.getElementById('saveSettings').onclick=async()=>{
    s.driverName=document.getElementById('driverName').value.trim()||'Driver';s.organization=document.getElementById('organization').value.trim()||'Organization';
    s.reportTextLabel=document.getElementById('reportLabel').value.trim()||'Report Recipient';s.reportTextNumber=digits(document.getElementById('reportNumber').value);
    s.autoLockMinutes=Math.max(1,Math.min(120,+document.getElementById('autoLock').value||15));await saveState();bumpLock();alert('Settings saved.');
  };
  document.getElementById('lockNow').onclick=()=>{cryptoKey=null;state=null;showLock()};
}

start();
})();
