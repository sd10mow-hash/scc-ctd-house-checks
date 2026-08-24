
(()=>{'use strict';

const VERSION='1.5.5';
const APP=document.getElementById('app');
const DB_NAME='scc_housechecks_db';
const WORK_EMAIL_DOMAIN='shawneecounseling.org';
const STORE='kv', META='meta', DATA='data';
const ENC=new TextEncoder(), DEC=new TextDecoder();
let cryptoKey=null,state=null,screen='home',activePropertyId=null,editPropertyId=null,editLocationId=null;
let revealCode=false,reportApproved=false,historyOpenId=null,autoLockTimer=null;
let showFullNames=false,nameRevealTimer=null,clientSearchQuery='';
let historyCalendarDate=new Date(),historySelectedDate=null;
let inspectionView='calendar',inspectionDayKey=null,reportOrigin='menu';
let routePickerOpen=false,routePickerDraft=null;
let codesUnlocked=false;

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

const PROPERTY_SITUATIONS={
  normal:{label:'No Special Status',color:''},
  open:{label:'Open',color:'yellow'},
  notMoved:{label:'Not moved yet',color:'gray'},
  outOfService:{label:'Out of Services',color:'darkgray'},
  cannotBill:{label:'Can not Bill for',color:'rose'}
};
function legacyPropertySituation(p){
  if(PROPERTY_SITUATIONS[p?.propertyStatus])return p.propertyStatus;
  if(p?.houseColor==='yellow')return 'open';
  if(p?.houseColor==='gray')return 'notMoved';
  if(p?.houseColor==='red'||p?.houseColor==='rose')return 'cannotBill';
  if(p?.houseColor==='darkgray')return 'outOfService';
  return 'normal';
}
function propertySituation(p){return PROPERTY_SITUATIONS[p?.propertyStatus]||PROPERTY_SITUATIONS.normal}
function propertySituationLabel(p){return propertySituation(p).label}
function propertySituationColor(p){return propertySituation(p).color}

const clients=p=>p.rooms.filter(r=>r.type==='client');
const clientNeedsCheck=(p,r)=>p.checkRequired!==false && r.type==='client' && r.checkRequired!==false;
const propertyNeedsChecks=p=>p.checkRequired!==false && clients(p).some(r=>r.checkRequired!==false);
function addressParts(address){
  const s=String(address||'').trim(),m=s.match(/^\s*(\d+)\s+(.+?)(?:,|$)/);
  return {number:m?Number(m[1]):999999,street:(m?m[2]:s).replace(/\b(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|highway|hwy\.?)\b/gi,'').replace(/[^a-z0-9 ]/gi,'').trim().toLowerCase()};
}
function compareProperties(a,b){
  const ar=propertyNeedsChecks(a)?0:1,br=propertyNeedsChecks(b)?0:1;if(ar!==br)return ar-br;
  const A=addressParts(a.address),B=addressParts(b.address);if(A.street!==B.street)return A.street.localeCompare(B.street);return A.number-B.number||String(a.address).localeCompare(String(b.address));
}
function orderedProperties(list=state.properties){return [...list].sort(compareProperties)}
function ensureBaseLocations(list){
  const defs=[
    {id:'base-home-office',name:'Home Office',address:'519 Court St, Portsmouth, OH 45662',type:'Office',phone:'',notes:'Base location',isBase:true},
    {id:'base-transportation',name:'Transportation Division',address:'3977 Rhodes Avenue, Portsmouth, OH 45662',type:'Office',phone:'',notes:'Base location; user-provided operating address',isBase:true}
  ];
  for(const d of defs){
    let x=list.find(l=>l.id===d.id)||list.find(l=>String(l.name||'').toLowerCase()===d.name.toLowerCase());
    if(!x)list.push({...d});else{x.isBase=true;if(!x.address)x.address=d.address}
  }
  return list;
}
function baseLocations(){return state.locations.filter(l=>l.isBase)}

const checkKey=(pid,room)=>`${pid}::${room}`;

function defaultState(){
  return {
    schemaVersion:18,
    properties:[],
    inactiveClients:[],
    locations:ensureBaseLocations([]),
    route:{stops:[],baseId:'base-home-office'},
    settings:{
      reporterName:'',
      authorizedUserCell:'',
      userWorkEmail:'',
      profileComplete:false,
      organization:'Shawnee Counseling Center',
      reportTextLabel:'Report Recipient',
      reportTextNumber:'',
      autoLockMinutes:15
    },
    dailyNotes:{},
    currentRun:{id:uuid(),active:false,runDate:'',startedAt:'',checks:{}},
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
    note:r?.note??r?.permanentNote??'',
    checkRequired:(typeof r?.checkRequired==='boolean'?r.checkRequired:!['green','gray'].includes(r?.color)),
    clientId:r?.clientId??(r?.type==='client'?uuid():''),
    workSchedule:r?.workSchedule??'',
    schoolSchedule:r?.schoolSchedule??'',
    importantInfo:r?.importantInfo??''
  };
}
function normalizeProperty(p,i){
  const rooms=Array.isArray(p?.rooms)?p.rooms.map(normalizeRoom):[];
  return {
    id:String(p?.id??('p'+i+'_'+Date.now())),
    address:p?.address??'Unnamed Property',
    doorCode:p?.doorCode??'',
    doorCodeUpdatedAt:p?.doorCodeUpdatedAt??'',
    beds:Number(p?.beds)||rooms.length||1,
    checkRequired:p?.checkRequired!==false,
    propertyStatus:legacyPropertySituation(p),
    houseColor:propertySituation({propertyStatus:legacyPropertySituation(p)}).color,
    rooms:rooms.length?rooms:[{room:'1',type:'open',name:'OPEN',phone:'',color:'',note:'',checkRequired:true}]
  };
}

function normalizeInactiveClient(c,i){
  return {
    clientId:String(c?.clientId||('inactive_'+i+'_'+Date.now())),
    name:c?.name||'Unnamed Client',
    phone:c?.phone||'',
    color:['green','gray'].includes(c?.color)?c.color:'',
    note:c?.note||'',
    checkRequired:(typeof c?.checkRequired==='boolean'?c.checkRequired:!['green','gray'].includes(c?.color)),
    workSchedule:c?.workSchedule||'',
    schoolSchedule:c?.schoolSchedule||'',
    importantInfo:c?.importantInfo||'',
    previousAddress:c?.previousAddress||'',
    previousRoom:String(c?.previousRoom||''),
    inactiveAt:c?.inactiveAt||new Date().toISOString()
  };
}
function clientRecordFromRoom(r,address='',room=''){
  return normalizeInactiveClient({
    clientId:r.clientId||uuid(),
    name:r.name,phone:r.phone,color:r.color,note:r.note,
    checkRequired:r.checkRequired,workSchedule:r.workSchedule,
    schoolSchedule:r.schoolSchedule,importantInfo:r.importantInfo,
    previousAddress:address,previousRoom:room||r.room,
    inactiveAt:new Date().toISOString()
  },0);
}
function archiveClient(r,address='',room=''){
  if(!r||r.type!=='client')return;
  const rec=clientRecordFromRoom(r,address,room);
  const ix=state.inactiveClients.findIndex(c=>c.clientId===rec.clientId);
  if(ix>=0)state.inactiveClients[ix]=rec;else state.inactiveClients.push(rec);
}
function activeClientRecords(){
  const out=[];
  for(const p of state.properties)for(const r of p.rooms)if(r.type==='client')out.push({property:p,room:r});
  return out;
}
function availableOpenBeds(){
  const out=[];
  for(const p of orderedProperties())for(const r of p.rooms)if(r.type==='open')out.push({property:p,room:r});
  return out;
}

function normalizeState(raw){
  const d=defaultState(), s=raw&&typeof raw==='object'?raw:{};
  d.properties=Array.isArray(s.properties)?s.properties.map(normalizeProperty):[];
  d.inactiveClients=Array.isArray(s.inactiveClients)?s.inactiveClients.map(normalizeInactiveClient):[];
  d.locations=Array.isArray(s.locations)?s.locations.map((l,i)=>({
    id:String(l?.id??('l'+i+'_'+Date.now())),name:l?.name??'Unnamed Location',address:l?.address??'',
    type:l?.type??'Other',phone:l?.phone??'',notes:l?.notes??'',isBase:!!l?.isBase
  })):[];
  ensureBaseLocations(d.locations);
  d.route=s.route&&Array.isArray(s.route.stops)?{...s.route,stops:s.route.stops}:{stops:[]};
  if(!d.route.baseId)d.route.baseId='base-home-office';
  const oldNum=s.settings?.reportTextNumber||s.settings?.transportNumber||'';
  d.settings={...d.settings,...(s.settings||{}),reportTextNumber:oldNum,reportTextLabel:s.settings?.reportTextLabel||s.settings?.transportLabel||'Report Recipient'};
  if(!d.settings.reporterName&&s.settings?.driverName)d.settings.reporterName=s.settings.driverName;
  d.settings.authorizedUserCell=d.settings.authorizedUserCell||'';
  if(Number(s.schemaVersion||0)<12)d.settings.profileComplete=false;
  d.dailyNotes=(s.dailyNotes&&typeof s.dailyNotes==='object'&&!Array.isArray(s.dailyNotes))?deepClone(s.dailyNotes):{};
  if(s.currentRun&&s.currentRun.checks){
    const hadChecks=Object.keys(s.currentRun.checks||{}).length>0;
    const started=s.currentRun.startedAt||'';
    let inferredDate=s.currentRun.runDate||'';
    if(!inferredDate&&started){
      const x=new Date(started);
      if(!Number.isNaN(x.getTime()))inferredDate=localDateKeyFromDate(x);
    }
    d.currentRun={
      ...s.currentRun,
      id:s.currentRun.id||uuid(),
      active:typeof s.currentRun.active==='boolean'?s.currentRun.active:hadChecks,
      runDate:inferredDate,
      startedAt:started,
      checks:s.currentRun.checks||{}
    };
  }else{
    d.currentRun={id:uuid(),active:false,runDate:'',startedAt:'',checks:{}};
  }
  d.history=Array.isArray(s.history)?s.history:[];
  if(Number(s.schemaVersion||0)<5){
    for(const p of d.properties){
      for(const r of p.rooms){
        if(r.type!=='client')continue;
        r.checkRequired=!['green','gray'].includes(r.color);
        if(!r.checkRequired)delete d.currentRun.checks[checkKey(p.id,r.room)];
      }
    }
    for(const c of d.inactiveClients)c.checkRequired=!['green','gray'].includes(c.color);
  }
  if(Number(s.schemaVersion||0)<6){
    for(const p of d.properties){
      p.propertyStatus=legacyPropertySituation(p);
      p.houseColor=propertySituation(p).color;
      if(!p.doorCodeUpdatedAt&&p.doorCode)p.doorCodeUpdatedAt='';
    }
  }
  d.schemaVersion=18;
  return d;
}
function getCheck(pid,room){
  const k=checkKey(pid,room);
  return state.currentRun.checks[k]||(state.currentRun.checks[k]={status:'',note:''});
}
function requiresNote(status){
  return status==='Not Home';
}
function checkResolved(c){
  if(!c?.status)return false;
  return !requiresNote(c.status) || !!String(c.note||'').trim();
}
function requiredNoteIssues(properties=state.properties,checks=state.currentRun.checks){
  const issues=[];
  for(const p of properties){
    for(const r of p.rooms){
      if(!clientNeedsCheck(p,r))continue;
      const c=checks[checkKey(p.id,r.room)];
      if(c?.status && requiresNote(c.status) && !String(c.note||'').trim()){
        issues.push({propertyId:p.id,address:p.address,room:r.room,name:r.name,status:c.status});
      }
    }
  }
  return issues;
}
function progress(p){
  const list=clients(p).filter(r=>clientNeedsCheck(p,r)),done=list.filter(r=>checkResolved(getCheck(p.id,r.room))).length;
  return {done,total:list.length,pct:list.length?Math.round(done/list.length*100):100,missing:list.length-done};
}
function totalsFor(properties=state.properties,checks=state.currentRun.checks){
  let required=0,checked=0,missing=0,notRequired=0;
  for(const p of properties){
    for(const r of p.rooms){
      if(r.type!=='client')continue;
      if(!clientNeedsCheck(p,r)){notRequired++;continue}
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
async function setupDatabase(pin,reportNumber,reporterName,authorizedUserCell,userWorkEmail){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  cryptoKey=await deriveKey(pin,salt);
  state=defaultState();
  state.settings.reportTextNumber=digits(reportNumber);
  state.settings.reporterName=String(reporterName||'').trim();
  state.settings.authorizedUserCell=digits(authorizedUserCell);
  state.settings.userWorkEmail=String(userWorkEmail||'').trim().toLowerCase();
  state.settings.profileComplete=true;
  await kvPut(META,{salt:bytesToB64(salt),createdAt:new Date().toISOString(),schemaVersion:18});
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

async function verifyPin(pin){
  try{
    const meta=await kvGet(META),payload=await kvGet(DATA);if(!meta||!payload)return false;
    const k=await deriveKey(pin,b64ToBytes(meta.salt));await decryptState(payload,k);return true;
  }catch{return false}
}
function requestPin(reason='modify this record'){
  return new Promise(resolve=>{
    const wrap=document.createElement('div');wrap.className='pin-overlay';
    wrap.innerHTML=`<div class="pin-dialog"><div class="title">PIN Required</div><div class="muted">Enter the app PIN to ${esc(reason)}.</div><input id="adminPinInput" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN"><div class="error" id="adminPinError"></div><div class="actions"><button class="btn" id="adminPinCancel">Cancel</button><button class="btn primary" id="adminPinOk">Continue</button></div></div>`;
    document.body.appendChild(wrap);const input=wrap.querySelector('#adminPinInput'),err=wrap.querySelector('#adminPinError');input.focus();
    const done=v=>{wrap.remove();resolve(v)};
    wrap.querySelector('#adminPinCancel').onclick=()=>done(false);
    const submit=async()=>{const ok=await verifyPin(input.value);if(ok)return done(true);err.textContent='Incorrect PIN.';input.value='';input.focus()};
    wrap.querySelector('#adminPinOk').onclick=submit;input.onkeydown=e=>{if(e.key==='Enter')submit();if(e.key==='Escape')done(false)};
  });
}

async function quickLock(){
  try{if(state&&cryptoKey)await saveState()}catch{}
  clearTimeout(autoLockTimer);
  codesUnlocked=false;
  hideFullNames();
  cryptoKey=null;
  state=null;
  screen='home';
  activePropertyId=null;
  editPropertyId=null;
  editLocationId=null;
  reportApproved=false;
  historyOpenId=null;
  await showLock();
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
    if('serviceWorker'in navigator)navigator.serviceWorker.register(`./sw.js?v=${VERSION}`,{updateViaCache:'none'}).catch(()=>{});
  }catch(e){fatalStartup('Phone startup check failed',e.message)}
}


async function refreshAppFiles(){
  if(!confirm(`Refresh the SCC-CTD app files to v${VERSION}? Your encrypted client database will NOT be deleted.`))return;
  try{
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if('caches' in window){
      const keys=await caches.keys();
      await Promise.all(keys.filter(k=>k.startsWith('scc-housechecks-')).map(k=>caches.delete(k)));
    }
  }catch{}
  const u=new URL(location.href);
  u.searchParams.set('build',VERSION);
  u.searchParams.set('refresh',Date.now());
  location.replace(u.toString());
}


async function ensureUserProfile(){
  if(
    state?.settings?.profileComplete &&
    state.settings.reporterName &&
    digits(state.settings.authorizedUserCell).length>=10 &&
    validWorkEmail(state.settings.userWorkEmail)
  )return true;

  return new Promise(resolve=>{
    const s=state.settings||{};
    const wrap=document.createElement('div');wrap.className='pin-overlay';
    wrap.innerHTML=`<div class="pin-dialog user-profile-setup">
      <div class="title">Authorized User Setup</div>
      <div class="muted">This identifies the person using this phone. The authorized user name prints as “Reported by” on the final report.</div>
      <div class="formgrid">
        <div class="field"><label>Authorized User Name</label><input id="profileReporterName" autocomplete="name" value="${esc(s.reporterName||s.driverName||'')}" placeholder="Full name"></div>
        <div class="field"><label>Authorized User Cell Number</label><input id="profileAuthorizedCell" type="tel" inputmode="tel" autocomplete="tel" value="${esc(fmtPhone(s.authorizedUserCell||''))}" placeholder="(555) 555-1212"></div>
        <div class="field"><label>Work Email</label><div class="work-email-rule">Must end exactly in <b>@${WORK_EMAIL_DOMAIN}</b></div><input id="profileWorkEmail" type="text" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="${esc(s.userWorkEmail||'')}" placeholder="name@${WORK_EMAIL_DOMAIN}"></div>
        <div class="field"><label>Confirm Work Email</label><input id="profileWorkEmailConfirm" type="text" inputmode="email" autocomplete="off" autocapitalize="none" spellcheck="false" value="" placeholder="Retype work email"></div>
      </div>
      <div class="email-domain-hint">Approved domain: <b>@${WORK_EMAIL_DOMAIN}</b></div>
      <div class="error" id="profileSetupError"></div>
      <div class="actions"><button class="btn primary" id="saveUserProfile">Save Authorized User</button></div>
    </div>`;
    document.body.appendChild(wrap);

    const dialog=wrap.querySelector('.user-profile-setup');
    wrap.querySelectorAll('input,select,textarea').forEach(el=>{
      el.addEventListener('focus',()=>setTimeout(()=>el.scrollIntoView({block:'center',behavior:'smooth'}),180));
    });
    if(window.visualViewport){
      const fit=()=>{
        const h=Math.max(280,window.visualViewport.height-20);
        dialog.style.maxHeight=`${h}px`;
      };
      fit();
      window.visualViewport.addEventListener('resize',fit);
      wrap._cleanupViewport=()=>window.visualViewport.removeEventListener('resize',fit);
    }

    const done=async()=>{
      const name=wrap.querySelector('#profileReporterName').value.trim();
      const cell=digits(wrap.querySelector('#profileAuthorizedCell').value);
      const email=normalizeWorkEmail(wrap.querySelector('#profileWorkEmail').value);
      const emailConfirm=normalizeWorkEmail(wrap.querySelector('#profileWorkEmailConfirm').value);
      const err=wrap.querySelector('#profileSetupError');
      err.textContent='';

      if(!name){err.textContent='Enter the Authorized User Name.';return}
      if(cell.length<10){err.textContent='Enter the Authorized User Cell Number.';return}
      if(!email){err.textContent='Enter the Work Email.';return}
      if(!validWorkEmail(email)){err.textContent=`Work Email must end exactly in @${WORK_EMAIL_DOMAIN}.`;return}
      if(email!==emailConfirm){err.textContent='Work Email entries do not match.';return}

      state.settings.reporterName=name;
      state.settings.authorizedUserCell=cell;
      state.settings.userWorkEmail=email;
      state.settings.profileComplete=true;
      await saveState();

      if(wrap._cleanupViewport)wrap._cleanupViewport();
      wrap.remove();
      resolve(true);
    };
    wrap.querySelector('#saveUserProfile').onclick=done;
  });
}
/* ---------- Lock / Setup ---------- */
async function showLock(){
  clearTimeout(autoLockTimer);
  codesUnlocked=false;
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
        <div class="field"><label>Authorized User Name</label><input id="setupReporterName" autocomplete="name" placeholder="Full name" required></div>
        <div class="field"><label>Authorized User Cell Number</label><input id="setupAuthorizedCell" type="tel" inputmode="tel" autocomplete="tel" placeholder="(555) 555-1212" required></div>
        <div class="field"><label>Work Email</label><div class="work-email-rule">Must end exactly in <b>@${WORK_EMAIL_DOMAIN}</b></div><input id="setupWorkEmail" type="text" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="name@${WORK_EMAIL_DOMAIN}" required></div>
        <div class="field"><label>Confirm Work Email</label><input id="setupWorkEmailConfirm" type="text" inputmode="email" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Retype work email" required></div>
        <div class="field"><label>Report Text Cell Number</label><input id="setupTextNumber" type="tel" inputmode="tel" placeholder="(555) 555-1212" required></div>
        <div class="setup-test"><button class="btn" id="setupTestText" type="button">Test Text Number</button><span class="muted">Opens a harmless test draft. It does not send automatically.</span></div>
      `}
      <div class="error" id="lockError"></div>
      <button class="btn primary" type="submit">${exists?'Unlock':'Create Secure Database'}</button>
    </form>
    <div class="update-box"><button class="btn" id="refreshAppFiles" type="button">Refresh App Files</button><span class="muted">Safe update helper. Clears only the app cache, not the encrypted database.</span></div>
  </section>`;
  document.getElementById('refreshAppFiles').onclick=refreshAppFiles;
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
        await ensureUserProfile();
      }else{
        if(pin!==document.getElementById('pin2').value){err.textContent='PINs do not match.';return}
        const name=document.getElementById('setupReporterName').value.trim();
        const authorizedCell=digits(document.getElementById('setupAuthorizedCell').value);
        const email=normalizeWorkEmail(document.getElementById('setupWorkEmail').value);
        const emailConfirm=normalizeWorkEmail(document.getElementById('setupWorkEmailConfirm').value);
        const n=digits(document.getElementById('setupTextNumber').value);
        if(!name){err.textContent='Enter the Authorized User Name.';return}
        if(authorizedCell.length<10){err.textContent='Enter the Authorized User Cell Number.';return}
        if(!email){err.textContent='Enter the Work Email.';return}
        if(!validWorkEmail(email)){err.textContent=`Work Email must end exactly in @${WORK_EMAIL_DOMAIN}.`;return}
        if(email!==emailConfirm){err.textContent='Work Email entries do not match.';return}
        if(n.length<10){err.textContent='Enter the report-text cell number.';return}
        await setupDatabase(pin,n,name,authorizedCell,email);
      }
      renderShell();
    }catch(ex){err.textContent='Could not open the secure database. '+(ex?.message||'Check the PIN.')}
  };
}

/* ---------- Shell / navigation ---------- */
const MAIN_MENU_ROWS=[
  [['inspections','📋','INSPECTIONS']],
  [['report','📄','REPORTS']],
  [['route','📍','ROUTE PLANNER']],
  [['search','🔒','CLIENT • SECURE']],
  [['properties','🏠','PROPERTIES']],
  [['settings','⚙️','SETTINGS']]
]

function resetModuleState(){
  hideFullNames();
  codesUnlocked=false;
  activePropertyId=null;
  editPropertyId=null;
  editLocationId=null;
  reportApproved=false;
  historyOpenId=null;
  revealCode=false;
}

function renderShell(){
  bumpLock();
  screen='home';
  resetModuleState();
  APP.innerHTML=`<div class="shell">
    <div class="top">
      <div class="topline">
        <div class="brandrow"><img class="appmark shawnee-mark" src="shawnee-mark.png" alt="Shawnee Counseling Center logo"><div><div class="brand">Shawnee Counseling Center <span class="version">v${VERSION}</span></div><div class="sub transportation-label">TRANSPORTATION • SCC-CTD HOUSE CHECKS</div></div></div>
        <button class="quick-lock" id="quickLock" type="button" aria-label="Lock House Checks now">🔒 Lock</button>
      </div>
      <div class="nav" id="nav"></div>
    </div>
    <main id="view"></main>
  </div>`;
  document.getElementById('quickLock').onclick=quickLock;
  render();
}

function goHome(){
  resetModuleState();
  screen='home';
  render();
}

function drawNav(){
  const nav=document.getElementById('nav');
  if(screen==='home'){
    nav.className='nav home-menu';
    nav.innerHTML=MAIN_MENU_ROWS.map((row,rowIndex)=>`
      <div class="home-menu-row home-menu-row-${rowIndex+1}">
        ${row.map(([k,icon,label])=>`<button data-nav="${k}" class="home-module-button"><span class="home-module-icon" aria-hidden="true">${icon}</span><span class="home-module-label">${label}</span></button>`).join('')}
      </div>
    `).join('');
    nav.querySelectorAll('[data-nav]').forEach(b=>b.onclick=async()=>{
      const next=b.dataset.nav;
      resetModuleState();
      if(next==='codes'){
        if(!await requestPin('view the full lock-code list'))return;
        codesUnlocked=true;
      }
      if(next==='report')reportOrigin='menu';
      if(next==='inspections'){
        inspectionView='calendar';
        inspectionDayKey=null;
        historySelectedDate=null;
        historyOpenId=null;
      }
      screen=next;
      render();
    });
    return;
  }

  nav.className='nav module-nav';
  nav.innerHTML=`<button class="module-home-button" id="modulePrevious">← Previous</button>`;
  document.getElementById('modulePrevious').onclick=goHome;
}
function setModulePrevious(handler,label='Previous'){
  const b=document.getElementById('modulePrevious');
  if(!b)return;
  b.textContent=`← ${label}`;
  b.onclick=handler;
}

function render(){
  drawNav();
  const view=document.getElementById('view');

  if(screen==='home'){
    view.innerHTML='';
    return;
  }

  if(activePropertyId)return renderHouse();
  if(screen==='search')return renderClientSearch();
  if(screen==='route')return renderRoute();
  if(screen==='report')return renderReport();
  if(screen==='history')return renderHistory();
  if(screen==='codes')return renderLockCodes();
  if(screen==='properties')return renderProperties();
  if(screen==='locations')return renderLocations();
  if(screen==='database')return renderDatabase();
  if(screen==='settings')return renderSettings();
  if(screen==='inspections')return renderInspections();

  goHome();
}


/* ---------- Inspections calendar / notes / completed reports ---------- */
function localDateKeyFromDate(d){
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function dateFromKey(key){return new Date(`${key}T12:00:00`)}
function inspectionTodayKey(){return localDateKeyFromDate(new Date())}
function isSameCalendarMonth(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()}
function reportDateKey(h){return h?.inspectionDate||h?.runDate||(h?.completedAt?historyLocalDateKey(h.completedAt):'')}
function reportsForDateKey(key){return state.history.filter(h=>reportDateKey(h)===key).slice().reverse()}
function dayNoteText(key){
  const n=state.dailyNotes?.[key];
  return typeof n==='string'?n:String(n?.text||'');
}
function dayHasNote(key){return !!dayNoteText(key).trim()}
async function saveInspectionDayNote(key,text){
  state.dailyNotes=state.dailyNotes||{};
  const clean=String(text||'').trim();
  if(clean)state.dailyNotes[key]={text:clean,updatedAt:new Date().toISOString()};
  else delete state.dailyNotes[key];
  await saveState();
}
function shiftInspectionMonth(delta){
  historyCalendarDate=new Date(historyCalendarDate.getFullYear(),historyCalendarDate.getMonth()+delta,1);
  inspectionView='calendar';
  inspectionDayKey=null;
  historySelectedDate=null;
  historyOpenId=null;
  renderInspections();
}
function inspectionDateLabel(key,short=false){
  const d=dateFromKey(key);
  return d.toLocaleDateString(undefined,short?{month:'short',day:'numeric',year:'numeric'}:{weekday:'long',month:'long',day:'numeric',year:'numeric'});
}
function inspectionRunIsActive(){return !!state.currentRun?.active}
function activeInspectionDate(){return state.currentRun?.runDate||''}
async function beginInspectionForToday(){
  const key=inspectionTodayKey();
  if(inspectionRunIsActive()){
    alert(`An inspection is already in progress for ${inspectionDateLabel(activeInspectionDate()||key,true)}.`);
    inspectionDayKey=activeInspectionDate()||key;
    inspectionView='day';
    renderInspections();
    return;
  }
  state.currentRun={id:uuid(),active:true,runDate:key,startedAt:new Date().toISOString(),checks:{}};
  await saveState();
  inspectionDayKey=key;
  inspectionView='run';
  renderInspections();
}
async function openInspectionHistoryReport(id){
  const h=state.history.find(x=>x.id===id);
  if(!h)return;
  if(!await requestPin('open this completed report'))return;
  historyOpenId=id;
  inspectionDayKey=reportDateKey(h)||inspectionDayKey;
  inspectionView='historyReport';
  renderInspections();
}
async function secureHistoricalAction(reason,fn){
  if(!await requestPin(reason))return;
  await fn();
}
function inspectionHouseListHtml(){
  const T=totalsFor();
  return `<section class="panel inspection-current">
    <div class="titlebar"><div><div class="title">Inspection In Progress</div><div class="muted">${inspectionDateLabel(activeInspectionDate()||inspectionTodayKey())} • Started ${state.currentRun.startedAt?new Date(state.currentRun.startedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):''}</div></div>${nameRevealButton()}</div>
    <div class="kpirow">
      <div class="kpi"><strong>${T.checked}</strong>Checked</div>
      <div class="kpi"><strong>${T.missing}</strong>Unresolved</div>
      <div class="kpi"><strong>${T.notRequired}</strong>Not Required</div>
      <div class="kpi"><strong>${state.properties.length}</strong>Total Houses</div>
    </div>
    <div class="actions inspection-progress-actions"><button class="btn" id="viewCurrentReportTop">View Current Report</button></div>
  </section>
  <section class="grid">${orderedProperties().map(p=>{
    const g=progress(p),open=p.rooms.filter(r=>r.type==='open').length,noBed=p.rooms.filter(r=>r.type==='nobed').length;
    return `<article class="card ${houseClass(p)}">
      <h3>${propertySituationColor(p)?`<span class="house-color ${propertySituationColor(p)}"></span> `:''}${esc(p.address)}</h3>${propertySituationCardHtml(p)}
      <div class="houseflag">${
        !propertyNeedsChecks(p)
          ? `<span class="notrequired">● NO REQUIRED CLIENTS</span>`
          : g.missing>0
            ? `<span class="required">● CHECKS REQUIRED</span>`
            : `<span class="complete">● COMPLETE</span>`
      }</div>
      <div class="meta">${p.beds} beds • ${!propertyNeedsChecks(p)?'no required clients':`${g.done}/${g.total} required checked`} • ${open} open • ${noBed} no bed</div>
      <div class="progress"><span style="width:${g.pct}%"></span></div>
      <div class="actions"><button class="btn ${propertyNeedsChecks(p)?'primary':''}" data-open="${esc(p.id)}">${propertyNeedsChecks(p)?'Open House':'View House'}</button>${propertyNeedsChecks(p)?`<span class="progress-ring ${g.pct>=100?'complete':''}" style="--pct:${g.pct}"><span>${g.pct}%</span></span>`:'<span class="badge">N/R</span>'}</div>
    </article>`;
  }).join('')||'<div class="panel"><div class="muted">No properties are loaded yet.</div></div>'}</section>
  <div class="actions"><button class="btn primary" id="finishRun">Finish Inspection → Final Report</button></div>`;
}
function renderInspectionDayDetail(key){
  const view=document.getElementById('view');
  const reports=reportsForDateKey(key);
  const isToday=key===inspectionTodayKey();
  const isActiveDate=inspectionRunIsActive()&&activeInspectionDate()===key;
  const activeElsewhere=inspectionRunIsActive()&&!isActiveDate;
  const note=dayNoteText(key);

  setModulePrevious(()=>{inspectionView='calendar';inspectionDayKey=null;historyOpenId=null;renderInspections()});

  view.innerHTML=`<section class="panel day-detail">
    <div class="title">${esc(inspectionDateLabel(key))}</div>
    <div class="day-detail-status">
      ${isToday?'<span class="day-chip today-chip">TODAY</span>':''}
      ${reports.length?`<span class="day-chip report-chip">${reports.length} COMPLETED REPORT${reports.length===1?'':'S'}</span>`:''}
      ${isActiveDate?'<span class="day-chip active-chip">INSPECTION IN PROGRESS</span>':''}
    </div>
  </section>

  <section class="panel day-note-panel">
    <div class="titlebar"><div><div class="title small-title">Day Note</div><div class="muted">A viewable note for this calendar date. Stored inside the encrypted app database.</div></div></div>
    <textarea id="inspectionDayNote" class="day-note-input" placeholder="Add a note for this date…">${esc(note)}</textarea>
    <div class="actions"><button class="btn primary" id="saveDayNote">Save Note</button>${note?'<button class="btn" id="clearDayNote">Clear Note</button>':''}</div>
    <div class="muted" id="dayNoteStatus"></div>
  </section>

  ${reports.length?`<section class="panel">
    <div class="title">Completed Report${reports.length===1?'':'s'}</div>
    <div class="history-list">${reports.map(h=>`<article class="card history-card"><div><b>${esc(new Date(h.completedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}))}</b><div class="meta">${h.checked??0}/${h.required??h.total??0} checked • ${h.missing??0} unresolved</div></div><button class="btn primary" data-inspection-history="${esc(h.id)}">Open Report 🔒</button></article>`).join('')}</div>
  </section>`:''}

  ${isToday&&!inspectionRunIsActive()?`<section class="panel start-inspection-panel">
    <div class="title">Nightly Inspection</div>
    <div class="muted">This calendar date is the only place a new nightly inspection can be started.</div>
    <button class="btn primary begin-inspection-button" id="beginInspection">Start Inspections • ${esc(inspectionDateLabel(key,true))}</button>
  </section>`:''}

  ${isActiveDate?`<section class="panel inspection-active-panel">
    <div class="inspection-in-progress-banner">● INSPECTION IN PROGRESS</div>
    <div class="actions">
      <button class="btn primary" id="continueInspection">Continue Inspection</button>
      <button class="btn" id="viewCurrentReport">View Current Report</button>
    </div>
  </section>`:''}

  ${activeElsewhere?`<section class="panel">
    <div class="notice">An inspection is already in progress for ${esc(inspectionDateLabel(activeInspectionDate(),true))}.</div>
    <button class="btn primary" id="goActiveInspection">Go to Active Inspection</button>
  </section>`:''}`;

  document.getElementById('saveDayNote').onclick=async()=>{
    const text=document.getElementById('inspectionDayNote').value;
    await saveInspectionDayNote(key,text);
    const status=document.getElementById('dayNoteStatus');
    if(status)status.textContent=String(text||'').trim()?'Note saved.':'Note cleared.';
    renderInspections();
  };
  const clear=document.getElementById('clearDayNote');
  if(clear)clear.onclick=async()=>{await saveInspectionDayNote(key,'');renderInspections()};

  view.querySelectorAll('[data-inspection-history]').forEach(b=>b.onclick=()=>openInspectionHistoryReport(b.dataset.inspectionHistory));

  const begin=document.getElementById('beginInspection');
  if(begin)begin.onclick=beginInspectionForToday;

  const cont=document.getElementById('continueInspection');
  if(cont)cont.onclick=()=>{inspectionView='run';renderInspections()};

  const current=document.getElementById('viewCurrentReport');
  if(current)current.onclick=()=>{inspectionView='currentReport';renderInspections()};

  const goActive=document.getElementById('goActiveInspection');
  if(goActive)goActive.onclick=()=>{inspectionDayKey=activeInspectionDate();inspectionView='day';renderInspections()};
}
function renderInspections(){
  const view=document.getElementById('view');
  const todayKey=inspectionTodayKey();

  if(inspectionView==='historyReport'&&historyOpenId){
    const h=state.history.find(x=>x.id===historyOpenId);
    if(!h){historyOpenId=null;inspectionView='day';return renderInspections()}
    setModulePrevious(()=>{hideFullNames();historyOpenId=null;inspectionView='day';inspectionDayKey=reportDateKey(h)||inspectionDayKey;renderInspections()});
    view.innerHTML=`<section class="panel">
      <div class="titlebar">
        <div>
          <div class="title">Completed Report • ${esc(inspectionDateLabel(reportDateKey(h)||historyLocalDateKey(h.completedAt)))}</div>
          <div class="muted">Pinch with two fingers to zoom. Drag to inspect any part of the saved report.</div>
        </div>
        ${nameRevealButton()}
      </div>
    </section>
    <section class="reportwrap inspection-report-zoom">${reportPaper(h)}</section>
    <section class="panel">
      <div class="secure-action-note">🔒 App PIN required for Print, Text, or Email.</div>
      <div class="delivery">
        <button class="btn" id="inspectionHistPrint">Print</button>
        <button class="btn green" id="inspectionHistText">Text</button>
        <button class="btn" id="inspectionHistEmail">Email</button>
      </div>
    </section>`;
    const nameToggle=document.getElementById('toggleNames');
    if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderInspections()};
    document.getElementById('inspectionHistPrint').onclick=()=>secureHistoricalAction('print this completed report',async()=>window.print());
    document.getElementById('inspectionHistText').onclick=()=>secureHistoricalAction('text this completed report',async()=>textSnapshot(h));
    document.getElementById('inspectionHistEmail').onclick=()=>secureHistoricalAction('email this completed report',async()=>emailSnapshot(h));
    return;
  }

  if(inspectionView==='currentReport'){
    if(!inspectionRunIsActive()){inspectionView='calendar';return renderInspections()}
    const snap=currentSnapshot();
    setModulePrevious(()=>{inspectionView='day';inspectionDayKey=activeInspectionDate();renderInspections()});
    view.innerHTML=`<section class="panel">
      <div class="title">Current Report • ${esc(inspectionDateLabel(activeInspectionDate()))}</div>
      <div class="muted">Live preview of the inspection currently in progress. This is not a completed report.</div>
    </section>
    <section class="reportwrap inspection-report-zoom">${reportPaper(snap)}</section>`;
    return;
  }

  if(inspectionView==='run'){
    if(!inspectionRunIsActive()){inspectionView='calendar';return renderInspections()}
    inspectionDayKey=activeInspectionDate();
    setModulePrevious(()=>{inspectionView='day';renderInspections()});
    view.innerHTML=inspectionHouseListHtml();
    const nameToggle=document.getElementById('toggleNames');
    if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderInspections()};
    view.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{activePropertyId=b.dataset.open;revealCode=false;render()});
    document.getElementById('viewCurrentReportTop').onclick=()=>{inspectionView='currentReport';renderInspections()};
    document.getElementById('finishRun').onclick=()=>{hideFullNames();reportOrigin='inspection';screen='report';reportApproved=false;render()};
    return;
  }

  if(inspectionView==='day'&&inspectionDayKey){
    renderInspectionDayDetail(inspectionDayKey);
    return;
  }

  // Calendar is the top level of Inspections.
  inspectionView='calendar';
  setModulePrevious(goHome);

  const {y,m,firstDay,days}=calendarMonthData(historyCalendarDate);
  const monthName=historyCalendarDate.toLocaleString(undefined,{month:'long',year:'numeric'});
  const counts={};
  for(const h of state.history){
    const key=reportDateKey(h);
    if(key)counts[key]=(counts[key]||0)+1;
  }

  const cells=[];
  for(let i=0;i<firstDay;i++)cells.push('<div class="calcell empty"></div>');
  for(let day=1;day<=days;day++){
    const key=`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const count=counts[key]||0,isToday=key===todayKey,hasNote=dayHasNote(key);
    const isActive=inspectionRunIsActive()&&activeInspectionDate()===key;
    cells.push(`<button class="calcell inspection-day ${isToday?'inspection-today':''} ${count?'inspection-has-report':''} ${isActive?'inspection-active-day':''}" data-date="${key}">
      <span class="daynum">${day}</span>
      ${isActive?'<span class="calendar-marker active-marker">ACTIVE</span>':isToday?'<span class="calendar-marker today-marker">TODAY</span>':count?'<span class="calendar-marker report-marker">REPORT</span>':''}
      ${isToday&&count?'<span class="completed-corner" title="Completed report saved"></span>':''}
      ${hasNote?'<span class="note-corner" title="Calendar note saved"></span>':''}
    </button>`);
  }

  view.innerHTML=`<section class="panel inspection-calendar-intro">
    <div class="title">Inspections</div>
    <div class="muted">Select any date. Green marks today, pink marks completed reports, and the small amber dot marks a saved day note.</div>
  </section>
  <section class="panel calendar-panel inspection-calendar">
    <div class="calendar-head"><button class="btn" id="prevInspectionMonth">←</button><strong>${esc(monthName)}</strong><button class="btn" id="nextInspectionMonth">→</button></div>
    <div class="calweek">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<span>${d}</span>`).join('')}</div>
    <div class="calendar-grid">${cells.join('')}</div>
    <div class="calendar-legend">
      <span><i class="legend-box legend-today"></i>Today</span>
      <span><i class="legend-box legend-report"></i>Completed Report</span>
      <span><i class="legend-dot legend-note"></i>Day Note</span>
      <span><i class="legend-box legend-active"></i>Inspection In Progress</span>
    </div>
    <div class="actions"><button class="btn" id="inspectionCurrentMonth">Current Month</button></div>
  </section>`;

  document.getElementById('prevInspectionMonth').onclick=()=>shiftInspectionMonth(-1);
  document.getElementById('nextInspectionMonth').onclick=()=>shiftInspectionMonth(1);
  document.getElementById('inspectionCurrentMonth').onclick=()=>{historyCalendarDate=new Date();inspectionView='calendar';inspectionDayKey=null;renderInspections()};
  view.querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>{
    inspectionDayKey=b.dataset.date;
    historySelectedDate=inspectionDayKey;
    historyOpenId=null;
    inspectionView='day';
    renderInspections();
  });
}

/* ---------- Tonight ---------- */
function houseClass(p){return `house-${propertySituationColor(p)||'none'} ${propertyNeedsChecks(p)?'':'not-required'}`}
function propertySituationCardHtml(p){const c=propertySituationColor(p);return c?`${propertySituationCardHtml(p)}`:''}

function renderTonight(){
  const view=document.getElementById('view'),T=totalsFor();
  view.innerHTML=`<section class="panel">
    <div class="titlebar"><div class="title">Tonight’s House Checks</div>${nameRevealButton()}</div>
    <div class="kpirow">
      <div class="kpi"><strong>${T.checked}</strong>Checked</div>
      <div class="kpi"><strong>${T.missing}</strong>Unresolved</div>
      <div class="kpi"><strong>${T.notRequired}</strong>Not Required</div>
      <div class="kpi"><strong>${state.properties.length}</strong>Total Houses</div>
    </div>
    <div class="muted" style="margin-top:8px">Every configured house will appear on the final report, including houses marked Not Required Tonight.</div>
  </section>
  <section class="grid">${orderedProperties().map(p=>{
    const g=progress(p),open=p.rooms.filter(r=>r.type==='open').length,noBed=p.rooms.filter(r=>r.type==='nobed').length;
    return `<article class="card ${houseClass(p)}">
      <h3>${propertySituationColor(p)?`<span class="house-color ${propertySituationColor(p)}"></span> `:''}${esc(p.address)}</h3>${propertySituationCardHtml(p)}
      <div class="houseflag">${
        !propertyNeedsChecks(p)
          ? `<span class="notrequired">● NO REQUIRED CLIENTS</span>`
          : g.missing>0
            ? `<span class="required">● CHECKS REQUIRED</span>`
            : `<span class="complete">● COMPLETE</span>`
      }</div>
      <div class="meta">${p.beds} beds • ${!propertyNeedsChecks(p)?'no required clients':`${g.done}/${g.total} required checked`} • ${open} open • ${noBed} no bed</div>
      <div class="progress"><span style="width:${g.pct}%"></span></div>
      <div class="actions"><button class="btn ${propertyNeedsChecks(p)?'primary':''}" data-open="${esc(p.id)}">${propertyNeedsChecks(p)?'Open House':'View House'}</button>${propertyNeedsChecks(p)?`<span class="progress-ring ${g.pct>=100?'complete':''}" style="--pct:${g.pct}"><span>${g.pct}%</span></span>`:'<span class="badge">N/R</span>'}</div>
    </article>`;
  }).join('')||'<div class="panel"><div class="muted">No properties are loaded yet. Import the private starter data from Database, or add properties manually.</div></div>'}</section>
  <div class="actions"><button class="btn primary" id="finishRun">Finish Run → Preview Complete Report</button></div>`;
  const nameToggle=document.getElementById('toggleNames');
  if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderInspections()};
  view.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{activePropertyId=b.dataset.open;revealCode=false;render()});
  document.getElementById('finishRun').onclick=()=>{hideFullNames();screen='report';reportApproved=false;render()};
}
function roomCheckHtml(p,r,i){
  if(r.type==='open')return `<div class="room"><div class="roomno">${esc(r.room)}</div><div><span class="tag open">OPEN / EMPTY</span></div></div>`;
  if(r.type==='nobed')return `<div class="room"><div class="roomno">${esc(r.room)}</div><div><span class="tag nobed">NO BED</span></div></div>`;
  const c=getCheck(p.id,r.room),required=clientNeedsCheck(p,r),noteNeeded=required&&requiresNote(c.status),noteMissing=noteNeeded&&!String(c.note||'').trim();
  return `<div class="room"><div class="roomno">${esc(r.room)}</div><div>
    <div class="name ${r.color||'none'}">${esc(displayClientName(r.name))}</div>
    <div class="client-requirement ${required?'required-client':'notrequired-client'}">${required?'REQUIRED':'NOT REQUIRED'}</div>
    ${r.phone?`<div class="muted"><a href="tel:${esc(r.phone)}">${esc(fmtPhone(r.phone))}</a></div>`:''}
    ${r.note?`<div class="muted">${esc(r.note)}</div>`:''}
    <div class="actions client-actions"><button class="btn" data-profile="${i}">Client Record</button>${c.status==='Not Home'?`<button class="btn" data-working="${i}">Note: Working</button>`:''}</div>
    ${!required
      ?`<div class="status-note no-disturb"><b>DO NOT DISTURB • HOUSE CHECK NOT REQUIRED</b><span>This client is listed for awareness only. No inspection result or nightly note can be entered.</span></div>`
      :`<div class="statuses">${['Home','Not Home','Sleep','Pass'].map(s=>`<button class="status ${c.status===s?'sel':''}" data-i="${i}" data-status="${s}">${s}</button>`).join('')}</div>
        ${noteMissing?`<div class="required-note-alert">NOTE REQUIRED because this client is NOT HOME.</div>`:''}
        <textarea class="note ${noteMissing?'note-required':''}" data-note="${i}" ${noteNeeded?'required':''} placeholder="${noteNeeded?'Required note — why is the client not home?':'Optional note…'}">${esc(c.note)}</textarea>`}
  </div></div>`;
}

function showClientProfile(p,r){
  const wrap=document.createElement('div');wrap.className='pin-overlay';
  wrap.innerHTML=`<div class="pin-dialog client-profile-dialog">
    <div class="title">Client Record • ${esc(displayClientName(r.name))}</div>
    <div class="profile-grid">
      <div><b>Address</b><span>${esc(p.address)}</span></div>
      <div><b>Room</b><span>${esc(r.room)}</span></div>
      <div><b>Phone</b><span>${r.phone?esc(fmtPhone(r.phone)):'Not entered'}</span></div>
      <div><b>House Inspection</b><span class="${r.checkRequired!==false?'profile-required':'profile-notrequired'}">${r.checkRequired!==false?'REQUIRED':'NOT REQUIRED • DO NOT DISTURB'}</span></div>
      <div class="profile-wide"><b>Work Schedule</b><span>${esc(r.workSchedule||'No work schedule entered.')}</span></div>
      <div class="profile-wide"><b>School Schedule</b><span>${esc(r.schoolSchedule||'No school schedule entered.')}</span></div>
      <div class="profile-wide"><b>Important Information</b><span>${esc(r.importantInfo||'No additional important information entered.')}</span></div>
      <div class="profile-wide"><b>Profile Note</b><span>${esc(r.note||'No profile note entered.')}</span></div>
    </div>
    <div class="actions"><button class="btn primary" id="closeClientProfile">Close</button></div>
  </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('#closeClientProfile').onclick=()=>wrap.remove();
  wrap.onclick=e=>{if(e.target===wrap)wrap.remove()};
}

function renderHouse(){
  const p=state.properties.find(x=>x.id===activePropertyId);if(!p){activePropertyId=null;return render()}
  if(screen==='inspections')setModulePrevious(()=>{hideFullNames();activePropertyId=null;inspectionView='run';render()});
  const g=progress(p),view=document.getElementById('view');
  view.innerHTML=`<section class="panel"><div class="househead">
    <div><div class="actions"><button class="btn" id="backHouses">← Previous</button>${nameRevealButton()}</div><h2 class="title" style="margin-top:10px">${esc(p.address)}</h2><div class="houseflag">${
      !propertyNeedsChecks(p)
        ? '<span class="notrequired">NO REQUIRED CLIENTS</span>'
        : g.missing>0
          ? '<span class="required">CHECKS REQUIRED</span>'
          : '<span class="complete">COMPLETE</span>'
    }</div><div class="muted">${p.beds} beds ${p.checkRequired!==false?`• ${g.done}/${g.total} checked`:''}</div></div>
    <div class="codebox"><b>Door code:</b> ${revealCode?esc(p.doorCode||'Not entered'):'••••••'} <button class="btn" id="toggleCode">${revealCode?'Hide':'Reveal'}</button></div>
  </div></section>
  <section class="panel">${p.rooms.map((r,i)=>roomCheckHtml(p,r,i)).join('')}</section>
  <div class="actions"><button class="btn primary" id="doneHouse">Done With House</button><button class="btn" id="editHouse">Edit Property</button></div>`;
  document.getElementById('backHouses').onclick=()=>{hideFullNames();activePropertyId=null;if(screen==='inspections')inspectionView='run';render()};
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
  document.getElementById('editHouse').onclick=async()=>{
    if(!await requestPin(`edit ${p.address}`))return;
    editPropertyId=p.id;activePropertyId=null;screen='properties';
    render();
    setTimeout(()=>document.getElementById('propertyEditor')?.scrollIntoView({behavior:'smooth',block:'start'}),80);
  };
  view.querySelectorAll('[data-profile]').forEach(b=>b.onclick=()=>{const r=p.rooms[+b.dataset.profile];if(r)showClientProfile(p,r)});
  view.querySelectorAll('[data-working]').forEach(b=>b.onclick=async()=>{const r=p.rooms[+b.dataset.working];if(!r)return;const c=getCheck(p.id,r.room);c.note='Working';await saveState();renderHouse()});
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
  view.innerHTML=`<section class="panel"><div class="titlebar"><div class="title">Properties & Rosters</div>${nameRevealButton('Show Full Names')}</div><div class="muted">Required houses are listed first; houses on the same street flow by house number. Editing, adding, or removing a property requires the app PIN.</div></section>
  <div id="propertyEditor"></div>
  <div class="actions"><button class="btn primary" id="addProperty">+ Add Property</button></div>
  <section class="grid">${orderedProperties().map(p=>`<article class="card ${houseClass(p)}"><h3>${esc(p.address)}</h3><div class="meta">${p.beds} beds • ${clients(p).length} clients • ${propertyNeedsChecks(p)?'required checks':'no required checks'}</div><div class="actions"><button class="btn" data-edit="${esc(p.id)}">Edit</button><button class="btn red" data-delete="${esc(p.id)}">Remove</button></div></article>`).join('')}</section>`;
  const nameToggle=document.getElementById('toggleNames');
  if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderProperties()};
  view.querySelectorAll('[data-edit]').forEach(b=>b.onclick=async()=>{
    if(!await requestPin('edit this property and roster'))return;
    editPropertyId=b.dataset.edit;renderProperties();setTimeout(()=>document.getElementById('propertyEditor')?.scrollIntoView({behavior:'smooth',block:'start'}),50);
  });
  view.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{
    const p=state.properties.find(x=>x.id===b.dataset.delete);if(!p)return;
    if(!await requestPin(`remove ${p.address}`))return;
    if(!confirm(`Remove ${p.address}? Clients will be retained in the Inactive Client Registry.`))return;
    p.rooms.filter(r=>r.type==='client').forEach(r=>archiveClient(r,p.address,r.room));
    state.properties=state.properties.filter(x=>x.id!==p.id);state.route.stops=state.route.stops.filter(s=>!(s.kind==='property'&&s.id===p.id));await saveState();renderProperties();
  });
  document.getElementById('addProperty').onclick=async()=>{
    if(!await requestPin('add a property'))return;
    const p=normalizeProperty({id:uuid(),address:'New Property',doorCode:'',beds:1,checkRequired:true,houseColor:'',rooms:[{room:'1',type:'open',name:'OPEN',checkRequired:true}]});
    state.properties.push(p);editPropertyId=p.id;renderProperties();setTimeout(()=>document.getElementById('propertyEditor')?.scrollIntoView({behavior:'smooth',block:'start'}),50);
  };
  if(editPropertyId)renderPropertyEditor(state.properties.find(p=>p.id===editPropertyId));
}
function roomEditorHtml(r,i){
  return `<div class="roomedit" data-row="${i}">
    <input data-f="room" value="${esc(r.room)}" aria-label="Room">
    <select data-f="type"><option value="client" ${r.type==='client'?'selected':''}>Client</option><option value="open" ${r.type==='open'?'selected':''}>Open</option><option value="nobed" ${r.type==='nobed'?'selected':''}>No Bed</option></select>
    <input data-f="name" value="${esc(r.type==='client'?(showFullNames?r.name:maskClientName(r.name)):'')}" data-fullname="${esc(r.name||'')}" placeholder="Client name">
    <input class="wide" data-f="phone" value="${esc(r.phone||'')}" placeholder="Cell phone">
    <select data-f="required" aria-label="House inspection requirement"><option value="required" ${r.checkRequired!==false?'selected':''}>Inspection REQUIRED</option><option value="notrequired" ${r.checkRequired===false?'selected':''}>Inspection NOT REQUIRED</option></select>
    <select data-f="color"><option value="" ${!r.color?'selected':''}>No color</option><option value="green" ${r.color==='green'?'selected':''}>Green</option><option value="gray" ${r.color==='gray'?'selected':''}>Gray</option></select>
    <button class="btn red" data-remove="${i}">Remove</button>
    ${r.type==='client'?`<textarea class="room-work" data-f="workSchedule" placeholder="Work schedule, e.g. Mon–Fri 4 PM–12 AM">${esc(r.workSchedule||'')}</textarea>`:''}
  </div>`;
}
function renderPropertyEditor(p){
  if(!p)return;
  const e=document.getElementById('propertyEditor');
  e.innerHTML=`<section class="panel"><div class="title">Editing ${esc(p.address)}</div>
    <div class="formgrid">
      <div class="field"><label>Address</label><input id="propAddress" value="${esc(p.address)}"></div>
      <div class="field"><label>Door code</label><input id="propCode" value="${esc(p.doorCode)}"><div class="field-help">${p.doorCodeUpdatedAt?`Last changed ${esc(new Date(p.doorCodeUpdatedAt).toLocaleString())}`:'No change date recorded yet.'}</div></div>
      <div class="field"><label>Number of beds</label><input id="propBeds" type="number" min="1" max="60" value="${p.beds}"></div>
      <div class="field"><label>Property situation</label><select id="propSituation">${Object.entries(PROPERTY_SITUATIONS).map(([k,v])=>`<option value="${k}" ${p.propertyStatus===k?'selected':''}>${esc(v.label)}</option>`).join('')}</select><div class="field-help">Color is assigned automatically from the situation. It is not a free-choice decoration.</div></div>
      <label class="checkboxline"><input id="propRequired" type="checkbox" ${p.checkRequired!==false?'checked':''}> House participates in checks</label>
    </div>
    <div class="notice"><b>Client House-Inspection Requirement:</b> use the REQUIRED / NOT REQUIRED selector on each client record. NOT REQUIRED clients remain visible during the house visit but are read-only and marked DO NOT DISTURB. Original highlighted clients migrate to NOT REQUIRED automatically.</div>
    <h3>Beds / Rooms</h3>${p.rooms.map(roomEditorHtml).join('')}
    <div class="actions"><button class="btn" id="addBed">+ Bed</button><button class="btn primary" id="saveProperty">Save Property</button><button class="btn" id="cancelProperty">Cancel</button></div>
  </section>`;
  document.getElementById('propBeds').onchange=()=>{
    const input=document.getElementById('propBeds'),n=Math.max(1,Math.min(60,+input.value||1));
    if(n<p.rooms.length){
      const occupied=p.rooms.slice(n).filter(r=>r.type==='client');
      if(occupied.length&&!confirm(`Reducing capacity moves these clients to Inactive: ${occupied.map(r=>displayClientName(r.name)).join(', ')}. Continue?`)){input.value=p.rooms.length;return}
      occupied.forEach(r=>archiveClient(r,p.address,r.room));
      p.rooms=p.rooms.slice(0,n);
    }else while(p.rooms.length<n)p.rooms.push(normalizeRoom({room:p.rooms.length+1,type:'open',name:'OPEN',checkRequired:true},p.rooms.length));
    p.beds=p.rooms.length;renderPropertyEditor(p);
  };
  document.getElementById('addBed').onclick=()=>{p.rooms.push(normalizeRoom({room:p.rooms.length+1,type:'open',name:'OPEN',checkRequired:true},p.rooms.length));p.beds=p.rooms.length;renderPropertyEditor(p)};
  e.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{
    const r=p.rooms[+b.dataset.remove];
    if(r.type==='client'&&!confirm(`Move ${displayClientName(r.name)} to Inactive and remove this bed/room row?`))return;
    if(r.type==='client')archiveClient(r,p.address,r.room);
    p.rooms.splice(+b.dataset.remove,1);p.beds=p.rooms.length;renderPropertyEditor(p);
  });
  document.getElementById('cancelProperty').onclick=()=>{editPropertyId=null;renderProperties()};
  document.getElementById('saveProperty').onclick=async()=>{
    p.address=document.getElementById('propAddress').value.trim()||'Unnamed Property';
    const newCode=document.getElementById('propCode').value.trim();
    if(newCode!==p.doorCode)p.doorCodeUpdatedAt=new Date().toISOString();
    p.doorCode=newCode;
    p.propertyStatus=document.getElementById('propSituation').value;
    p.houseColor=propertySituation(p).color;
    p.checkRequired=document.getElementById('propRequired').checked;
    e.querySelectorAll('[data-row]').forEach(row=>{
      const r=p.rooms[+row.dataset.row],previous=deepClone(r),nextType=row.querySelector('[data-f="type"]').value;
      if(previous.type==='client'&&nextType!=='client')archiveClient(previous,p.address,previous.room);
      r.room=row.querySelector('[data-f="room"]').value.trim()||String(+row.dataset.row+1);r.type=nextType;
      if(r.type==='client'){
        const nameInput=row.querySelector('[data-f="name"]'),typed=nameInput.value.trim(),original=nameInput.dataset.fullname||'';
        r.name=(!showFullNames && typed===maskClientName(original)) ? original : (typed||'Unnamed Client');
        r.checkRequired=row.querySelector('[data-f="required"]').value!=='notrequired';
        if(!r.checkRequired)delete state.currentRun.checks[checkKey(p.id,r.room)];
        if(!r.clientId)r.clientId=uuid();
        r.workSchedule=row.querySelector('[data-f="workSchedule"]')?.value.trim()||r.workSchedule||'';
        r.schoolSchedule=r.schoolSchedule||'';
        r.importantInfo=r.importantInfo||'';
      }else{r.name=r.type==='open'?'OPEN':'NO BED';r.checkRequired=false;r.clientId='';r.workSchedule=''}
      r.phone=r.type==='client'?row.querySelector('[data-f="phone"]').value.trim():'';r.color=r.type==='client'?row.querySelector('[data-f="color"]').value:'';
    });
    p.beds=p.rooms.length;await saveState();editPropertyId=null;renderProperties();
  };
}


/* ---------- Dedicated Client Profiles ---------- */
function allClientProfileRecords(){
  const out=[];
  for(const p of state.properties)for(const r of p.rooms)if(r.type==='client')out.push({kind:'active',property:p,record:r});
  for(const c of state.inactiveClients||[])out.push({kind:'inactive',property:null,record:c});
  return out;
}
function profileSearchMatches(item,q){
  const s=String(q||'').replace(/[^a-z0-9]/gi,'').toLowerCase();
  if(!s)return true;
  const key=clientSearchKey(item.record.name);
  return key.includes(s)||s.includes(key)||String(item.record.phone||'').replace(/\D/g,'').includes(s);
}
function inactiveProfileModal(c){
  const wrap=document.createElement('div');wrap.className='pin-overlay';
  wrap.innerHTML=`<div class="pin-dialog client-profile-dialog">
    <div class="title">Client Record • ${esc(displayClientName(c.name))}</div>
    <div class="profile-grid">
      <div><b>Status</b><span>INACTIVE</span></div>
      <div><b>Last Residence</b><span>${esc(c.previousAddress||'Unknown')}${c.previousRoom?` • Room ${esc(c.previousRoom)}`:''}</span></div>
      <div><b>Phone</b><span>${c.phone?esc(fmtPhone(c.phone)):'Not entered'}</span></div>
      <div><b>House Inspection</b><span class="${c.checkRequired!==false?'profile-required':'profile-notrequired'}">${c.checkRequired!==false?'REQUIRED':'NOT REQUIRED • DO NOT DISTURB'}</span></div>
      <div class="profile-wide"><b>Work Schedule</b><span>${esc(c.workSchedule||'No work schedule entered.')}</span></div>
      <div class="profile-wide"><b>School Schedule</b><span>${esc(c.schoolSchedule||'No school schedule entered.')}</span></div>
      <div class="profile-wide"><b>Important Information</b><span>${esc(c.importantInfo||'No additional important information entered.')}</span></div>
      <div class="profile-wide"><b>Profile Note</b><span>${esc(c.note||'No profile note entered.')}</span></div>
    </div>
    <div class="actions"><button class="btn primary" id="closeInactiveProfile">Close</button></div>
  </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('#closeInactiveProfile').onclick=()=>wrap.remove();
  wrap.onclick=e=>{if(e.target===wrap)wrap.remove()};
}
async function editClientProfile(item){
  if(!await requestPin('edit this client profile'))return;
  const r=item.record,where=item.kind==='active'?`${item.property.address} • Room ${r.room}`:`Inactive • Last: ${r.previousAddress||'Unknown'}${r.previousRoom?' • Room '+r.previousRoom:''}`;
  const wrap=document.createElement('div');wrap.className='pin-overlay';
  wrap.innerHTML=`<div class="pin-dialog client-edit-dialog">
    <div class="title">Edit Client Profile</div><div class="muted">${esc(where)}</div>
    <div class="formgrid profile-edit-grid">
      <div class="field"><label>Full Client Name</label><input id="cpName" value="${esc(r.name||'')}"></div>
      <div class="field"><label>Cell Phone</label><input id="cpPhone" type="tel" value="${esc(r.phone||'')}"></div>
      <div class="field"><label>House Inspection</label><select id="cpRequired"><option value="required" ${r.checkRequired!==false?'selected':''}>Inspection REQUIRED</option><option value="notrequired" ${r.checkRequired===false?'selected':''}>Inspection NOT REQUIRED</option></select></div>
      <div class="field profile-wide"><label>Work Schedule</label><textarea id="cpWork" placeholder="Work days / hours">${esc(r.workSchedule||'')}</textarea></div>
      <div class="field profile-wide"><label>School Schedule</label><textarea id="cpSchool" placeholder="School days / hours / campus details">${esc(r.schoolSchedule||'')}</textarea></div>
      <div class="field profile-wide"><label>Important Information</label><textarea id="cpInfo" placeholder="Important information for house checks">${esc(r.importantInfo||'')}</textarea></div>
      <div class="field profile-wide"><label>Profile Note</label><textarea id="cpNote" placeholder="Permanent profile note">${esc(r.note||'')}</textarea></div>
    </div>
    <div class="actions"><button class="btn" id="cancelClientEdit">Cancel</button><button class="btn primary" id="saveClientEdit">Save Client Profile</button></div>
  </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('#cancelClientEdit').onclick=()=>wrap.remove();
  wrap.querySelector('#saveClientEdit').onclick=async()=>{
    r.name=wrap.querySelector('#cpName').value.trim()||'Unnamed Client';
    r.phone=wrap.querySelector('#cpPhone').value.trim();
    r.checkRequired=wrap.querySelector('#cpRequired').value==='required';
    r.workSchedule=wrap.querySelector('#cpWork').value.trim();
    r.schoolSchedule=wrap.querySelector('#cpSchool').value.trim();
    r.importantInfo=wrap.querySelector('#cpInfo').value.trim();
    r.note=wrap.querySelector('#cpNote').value.trim();
    if(item.kind==='active'&&!r.checkRequired)delete state.currentRun.checks[checkKey(item.property.id,r.room)];
    await saveState();wrap.remove();renderClientProfiles();
  };
}
/* ---------- 3x3 Client Search / Unified Client Hub ---------- */
function clientHubRecords(){
  const out=[];
  for(const p of state.properties){
    for(const r of p.rooms){
      if(r.type==='client')out.push({kind:'active',property:p,record:r});
    }
  }
  for(const c of state.inactiveClients||[])out.push({kind:'inactive',property:null,record:c});
  return out;
}
function clientHubMatches(item,query){
  const q=String(query||'').replace(/[^a-z0-9]/gi,'').toLowerCase();
  if(q.length<3)return false;
  const key=clientSearchKey(item.record.name);
  return key.includes(q)||q.includes(key);
}
function renderClientSearch(){
  const view=document.getElementById('view');
  const compact=String(clientSearchQuery||'').replace(/[^a-z0-9]/gi,'');
  const results=compact.length<3?[]:clientHubRecords().filter(x=>clientHubMatches(x,clientSearchQuery));

  view.innerHTML=`<section class="panel">
    <div class="titlebar">
      <div>
        <div class="title">3×3 Client Search</div>
        <div class="muted">One client search for everything. Search the first 3 letters of the first name + first 3 letters of the last name.</div>
      </div>
      ${nameRevealButton()}
    </div>
    <div class="searchbar"><input id="clientSearch" autocomplete="off" placeholder="e.g. Bra Wal" value="${esc(clientSearchQuery)}"><button class="btn" id="clearSearch">Clear</button></div>
    <div class="privacy-hint">Full names stay hidden by default. Open a client record to view schedules, inspection requirements, and other profile information.</div>
  </section>

  <section class="search-results">${
    compact.length<3
      ? '<div class="panel"><div class="muted">Enter at least 3 letters to search.</div></div>'
      : results.length
        ? results.map((x,i)=>`<article class="card search-result client-search-card">
            <div class="client-search-main">
              <div class="name ${x.record.color||'none'}">${esc(displayClientName(x.record.name))}</div>
              <div class="meta">${x.kind==='active'
                ? `${esc(x.property.address)} • Room ${esc(x.record.room)}`
                : `INACTIVE • Last: ${esc(x.record.previousAddress||'Unknown')}${x.record.previousRoom?` • Room ${esc(x.record.previousRoom)}`:''}`}</div>
              <div class="client-requirement ${x.record.checkRequired!==false?'required-client':'notrequired-client'}">${x.record.checkRequired!==false?'INSPECTION REQUIRED':'NOT REQUIRED • DO NOT DISTURB'}</div>
            </div>
            <div class="actions client-search-actions">
              <button class="btn" data-viewclient="${i}">View Client</button>
              <button class="btn primary" data-editclient="${i}">Edit Client</button>
              ${x.kind==='active'?`<button class="btn" data-findhouse="${esc(x.property.id)}">Open House</button>`:''}
            </div>
          </article>`).join('')
        : '<div class="panel"><div class="muted">No matching client found.</div></div>'
  }</section>`;

  const input=document.getElementById('clientSearch');
  input.oninput=()=>{
    clientSearchQuery=input.value;
    renderClientSearch();
    const again=document.getElementById('clientSearch');
    again?.focus();
    again?.setSelectionRange(again.value.length,again.value.length);
  };
  document.getElementById('clearSearch').onclick=()=>{clientSearchQuery='';renderClientSearch()};

  const nameToggle=document.getElementById('toggleNames');
  if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderClientSearch()};

  view.querySelectorAll('[data-viewclient]').forEach(b=>b.onclick=()=>{
    const x=results[+b.dataset.viewclient];
    if(!x)return;
    x.kind==='active'?showClientProfile(x.property,x.record):inactiveProfileModal(x.record);
  });

  view.querySelectorAll('[data-editclient]').forEach(b=>b.onclick=()=>{
    const x=results[+b.dataset.editclient];
    if(x)editClientProfile(x);
  });

  view.querySelectorAll('[data-findhouse]').forEach(b=>b.onclick=()=>{
    hideFullNames();
    activePropertyId=b.dataset.findhouse;
    revealCode=false;
    screen='inspections';
    render();
  });
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
function baseLocation(){return state.locations.find(l=>l.id===state.route.baseId)||baseLocations()[0]||null}
function smartRouteCompare(a,b){
  const A=addressParts(stopAddress(a)),B=addressParts(stopAddress(b));if(A.street!==B.street)return A.street.localeCompare(B.street);return A.number-B.number;
}
function renderRoutePicker(){
  const view=document.getElementById('view');if(!routePickerDraft)routePickerDraft=deepClone(state.route.stops);
  const checked=(kind,id)=>routePickerDraft.some(s=>s.kind===kind&&s.id===id);
  const nonBaseLocs=state.locations.filter(l=>!l.isBase);
  view.innerHTML=`<section class="panel"><div class="title">Choose Route Stops</div><div class="muted">All known residential and saved addresses are here. Check what you need, then tap OK to return to the route.</div></section>
  <section class="panel"><h3>Residential Properties</h3><div class="route-picker-list">${orderedProperties().map(p=>`<label class="route-choice"><input type="checkbox" data-pick-kind="property" data-pick-id="${esc(p.id)}" ${checked('property',p.id)?'checked':''}><span><b>${esc(p.address)}</b><small>${propertyNeedsChecks(p)?'Required house':'No required checks'}</small></span></label>`).join('')}</div>
  <h3>Other Locations</h3><div class="route-picker-list">${nonBaseLocs.map(l=>`<label class="route-choice"><input type="checkbox" data-pick-kind="location" data-pick-id="${esc(l.id)}" ${checked('location',l.id)?'checked':''}><span><b>${esc(l.name)}</b><small>${esc(l.address)}</small></span></label>`).join('')||'<div class="muted">No other saved locations.</div>'}</div>
  <div class="actions"><button class="btn" id="routePickerCancel">Cancel</button><button class="btn primary" id="routePickerOk">OK</button></div></section>`;
  view.querySelectorAll('[data-pick-kind]').forEach(c=>c.onchange=()=>{const s={kind:c.dataset.pickKind,id:c.dataset.pickId};if(c.checked&&!routePickerDraft.some(x=>x.kind===s.kind&&x.id===s.id))routePickerDraft.push(s);if(!c.checked)routePickerDraft=routePickerDraft.filter(x=>!(x.kind===s.kind&&x.id===s.id))});
  document.getElementById('routePickerCancel').onclick=()=>{routePickerOpen=false;routePickerDraft=null;renderRoute()};
  document.getElementById('routePickerOk').onclick=async()=>{state.route.stops=routePickerDraft.filter(s=>stopAddress(s));routePickerOpen=false;routePickerDraft=null;await saveState();renderRoute()};
}
function renderRoute(){
  if(routePickerOpen)return renderRoutePicker();
  const view=document.getElementById('view'),bases=baseLocations(),base=baseLocation(),stops=state.route.stops.filter(s=>stopAddress(s));
  view.innerHTML=`<section class="panel"><div class="title">Circular Route Planner</div><div class="muted">Choose a home base, pick stops from the address menu, then manually move stops or use Auto Order for street/house-number progression. Google Maps handles the driving path and returns to the same base.</div></section>
  <section class="panel"><div class="formgrid"><div class="field"><label>Home Base (start and finish)</label><select id="routeBase">${bases.map(l=>`<option value="${esc(l.id)}" ${base?.id===l.id?'selected':''}>${esc(l.name)} • ${esc(l.address)}</option>`).join('')}</select></div></div>
  <div class="actions"><button class="btn primary" id="chooseStops">Choose Stops</button><button class="btn" id="autoOrder" ${stops.length<2?'disabled':''}>Auto Order</button></div></section>
  <section class="panel"><div class="title">Route Order</div><div id="routeOrder"></div><div class="actions"><a id="mapsLink" class="btn primary" target="_blank" rel="noopener">Open Loop in Google Maps</a></div><div class="notice">Auto Order keeps the same street together and puts house numbers in progression. True shortest-distance optimization would require sending residential addresses to an external routing service, so this build does not do that silently.</div></section>`;
  document.getElementById('routeBase').onchange=async e=>{state.route.baseId=e.target.value;state.route.stops=state.route.stops.filter(s=>s.id!==state.route.baseId);await saveState();renderRoute()};
  document.getElementById('chooseStops').onclick=()=>{routePickerDraft=deepClone(state.route.stops);routePickerOpen=true;renderRoute()};
  document.getElementById('autoOrder').onclick=async()=>{state.route.stops=[...state.route.stops].sort(smartRouteCompare);await saveState();renderRoute()};
  const box=document.getElementById('routeOrder');
  box.innerHTML=(base?`<div class="route base-stop"><b>BASE</b><span>${esc(base.name)} • ${esc(base.address)}</span><span></span></div>`:'')+stops.map((s,i)=>`<div class="route"><b>${i+1}</b><span>${esc(stopLabel(s))}</span><span><button class="btn" data-up="${i}" ${i===0?'disabled':''}>↑</button><button class="btn" data-down="${i}" ${i===stops.length-1?'disabled':''}>↓</button></span></div>`).join('')+(base?`<div class="route base-stop"><b>END</b><span>${esc(base.name)} • ${esc(base.address)}</span><span></span></div>`:'');
  box.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>moveRoute(+b.dataset.up,-1));box.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>moveRoute(+b.dataset.down,1));
  const a=document.getElementById('mapsLink');
  if(!base||stops.length<1){a.style.opacity='.45';a.removeAttribute('href')}else{const ads=stops.map(stopAddress);a.href=`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(base.address)}&destination=${encodeURIComponent(base.address)}&waypoints=${encodeURIComponent(ads.join('|'))}&travelmode=driving`}
}
async function moveRoute(i,d){const j=i+d;if(j<0||j>=state.route.stops.length)return;[state.route.stops[i],state.route.stops[j]]=[state.route.stops[j],state.route.stops[i]];await saveState();renderRoute()}


/* ---------- PIN-protected Lock Codes ---------- */
function lockCodeText(){
  const lines=['SCC-CTD HOUSE LOCK CODES',''];
  for(const p of orderedProperties())lines.push(`${p.address}: ${p.doorCode||'NOT ENTERED'}${p.doorCodeUpdatedAt?` (updated ${new Date(p.doorCodeUpdatedAt).toLocaleDateString()})`:''}`);
  lines.push('',`Generated ${new Date().toLocaleString()}`);
  return lines.join('\n');
}
async function shareLockCodes(){
  const text=lockCodeText();
  if(navigator.share){
    try{await navigator.share({title:'SCC-CTD House Lock Codes',text});return}catch(e){if(e?.name==='AbortError')return}
  }
  const n=digits(document.getElementById('codeTextNumber')?.value||'');
  if(n.length>=10){openSms(n,text);return}
  alert('This device did not open the share sheet. Enter a cell number and use Text Number.');
}
async function chooseCodeContact(){
  if(!navigator.contacts?.select){alert('Direct address-book picking is not supported by this browser. Use Share / Message, then choose Messages and the recipient from the iPhone share sheet.');return}
  try{
    const rows=await navigator.contacts.select(['name','tel'],{multiple:false});
    const tel=rows?.[0]?.tel?.[0];if(tel)document.getElementById('codeTextNumber').value=fmtPhone(tel);
  }catch{}
}
function renderLockCodes(){
  if(!codesUnlocked){screen='inspections';return render()}
  const view=document.getElementById('view');
  view.innerHTML=`<section class="panel"><div class="title">House Lock Codes</div><div class="muted">PIN-protected list. Print the full sheet or use the system share sheet to send it through Messages.</div></section>
  <section class="panel code-list" id="lockCodePrint"><div class="code-print-title">SCC-CTD HOUSE LOCK CODES</div>${orderedProperties().map(p=>`<div class="code-list-row"><div><b>${esc(p.address)}</b><small>${p.doorCodeUpdatedAt?`Updated ${esc(new Date(p.doorCodeUpdatedAt).toLocaleString())}`:'Update date not recorded'}</small></div><span>${esc(p.doorCode||'NOT ENTERED')}</span><button class="btn code-edit-control" data-code-edit="${esc(p.id)}">Update</button></div>`).join('')}<div class="code-print-foot">${esc(new Date().toLocaleString())}</div></section>
  <section class="panel"><div class="actions"><button class="btn primary" id="printCodes">Print Full List</button><button class="btn green" id="shareCodes">Share / Message</button>${navigator.contacts?.select?'<button class="btn" id="pickCodeContact">Choose Contact</button>':''}<button class="btn" id="hideCodes">Hide Codes</button></div>
  <div class="formgrid" style="margin-top:10px"><div class="field"><label>Optional cell number fallback</label><input id="codeTextNumber" type="tel" inputmode="tel" placeholder="Cell number"></div></div><div class="actions"><button class="btn" id="textCodes">Text Number</button></div>
  <div class="notice">On iPhone, Share / Message opens the native share sheet. Choose Messages there, then select the recipient from Contacts. The web app does not need to read your address book directly.</div></section>`;
  view.querySelectorAll('[data-code-edit]').forEach(b=>b.onclick=async()=>{
    const p=state.properties.find(x=>x.id===b.dataset.codeEdit);if(!p)return;
    if(!await requestPin(`update the lock code for ${p.address}`))return;
    const val=prompt(`New lock code for ${p.address}`,p.doorCode||'');if(val===null)return;
    p.doorCode=val.trim();p.doorCodeUpdatedAt=new Date().toISOString();await saveState();renderLockCodes();
  });
  document.getElementById('printCodes').onclick=()=>window.print();
  document.getElementById('shareCodes').onclick=shareLockCodes;
  document.getElementById('textCodes').onclick=()=>{const n=digits(document.getElementById('codeTextNumber').value);if(n.length<10){alert('Enter a valid cell number.');return}openSms(n,lockCodeText())};
  if(document.getElementById('pickCodeContact'))document.getElementById('pickCodeContact').onclick=chooseCodeContact;
  document.getElementById('hideCodes').onclick=()=>{codesUnlocked=false;screen='inspections';render()};
}

/* ---------- Report ---------- */
function currentSnapshot(completedAt=null){
  return {
    id:state.currentRun.id,
    inspectionDate:state.currentRun.runDate||inspectionTodayKey(),
    startedAt:state.currentRun.startedAt,
    completedAt,
    reporterName:state.settings.reporterName||state.settings.driverName||'Reporter',
    reporterRole:state.settings.reporterRole||'',
    properties:deepClone(state.properties),
    checks:deepClone(state.currentRun.checks)
  };
}
function statusFor(snapshot,p,r){
  if(r.type==='open')return 'OPEN';
  if(r.type==='nobed')return 'NO BED';
  const c=snapshot.checks[checkKey(p.id,r.room)];
  if(p.checkRequired===false)return c?.status?`HOUSE N/R • ${c.status}`:'HOUSE N/R';
  if(r.checkRequired===false)return c?.status?`N/R • ${c.status}`:'NOT REQUIRED';
  if(!c?.status)return 'REQUIRED • NO RESULT';
  if(requiresNote(c.status)&&!String(c.note||'').trim())return `${c.status} • NOTE REQ`;
  return c.status;
}
function reportMarks(status){
  return {home:status==='Home',not:status==='Not Home',sleep:status==='Sleep',pass:status==='Pass'};
}
function reportNotes(snapshot,p,r){
  if(r.type==='open'||r.type==='nobed')return [];
  const c=snapshot.checks[checkKey(p.id,r.room)],lines=[];
  if(r.note)lines.push(r.note);
  if(!clientNeedsCheck(p,r))lines.push('NOT REQUIRED • DO NOT DISTURB');
  else if(!c?.status)lines.push('REQUIRED • NO RESULT');
  if(String(c?.note||'').trim())lines.push(`Remarks: ${String(c.note).trim()}`);
  return lines;
}
function masterHouseHtml(snapshot,p){
  const situation=propertySituationLabel(p),color=propertySituationColor(p)||'normal';
  return `<div class="master-house master-house-${color}"><div class="master-house-title"><b>${esc(p.address)}</b>${situation!=='No Special Status'?`<span>${esc(situation)}</span>`:''}</div>${p.rooms.map(r=>{
    const status=statusFor(snapshot,p,r),m=reportMarks(status),notes=reportNotes(snapshot,p,r);
    const nameClass=r.type==='client'&&r.color?` name-${r.color}`:'';
    return `<div class="master-row ${r.type==='open'?'row-open':r.type==='nobed'?'row-nobed':''}">
      <span class="cell roomcell">${esc(r.room)}</span>
      <span class="cell clientcell${nameClass}">${r.type==='client'?esc(displayClientName(r.name)):esc(r.type==='open'?'OPEN / EMPTY':'NO BED')}</span>
      <span class="cell phonecell">${r.type==='client'&&r.phone?esc(fmtPhone(r.phone)):''}</span>
      <span class="cell checkboxcell">${m.home?'☒':'☐'}</span>
      <span class="cell checkboxcell">${m.not?'☒':'☐'}</span>
      <span class="cell checkboxcell">${m.sleep?'☒':'☐'}</span>
      <span class="cell checkboxcell">${m.pass?'☒':'☐'}</span>
      <span class="cell notescell">${notes.map((n,i)=>`<small class="${n.startsWith('Remarks:')?'remarks-line':''}">${esc(n)}</small>`).join('')}</span>
    </div>`;
  }).join('')}</div>`;
}
function reportPaper(snapshot,id='reportPaper'){
  const stamp=snapshot.completedAt?new Date(snapshot.completedAt):new Date(),props=[...snapshot.properties].sort(compareProperties),split=Math.ceil(props.length/2),left=props.slice(0,split),right=props.slice(split);
  const colHead=`<div class="master-col-head"><span>Rm</span><span>Client Name</span><span>Cell Phone</span><span>Home</span><span>Not</span><span>Sleep</span><span>Pass</span><span>Notes</span></div>`;
  return `<div class="paper master-sheet" id="${id}">
    <div class="master-sheet-title">HOUSE CHECK RUN SHEET</div>
    <div class="master-meta"><span><b>DATE / TIME:</b> ${esc(stamp.toLocaleString())}</span><span><b>REPORTED BY:</b> ${esc(snapshot.reporterName||snapshot.driverName||'Reporter')}</span></div>
    <div class="master-instruction">SEE THEM • VERIFY THE NAME • CHECK THE STATUS • LEAVE A USEFUL NOTE</div>
    <div class="master-columns">
      <div class="master-column">${colHead}${left.map(p=>masterHouseHtml(snapshot,p)).join('')}</div>
      <div class="master-column">${colHead}${right.map(p=>masterHouseHtml(snapshot,p)).join('')}</div>
    </div>
    <div class="master-footer">
      <div class="master-legend"><b>ORIGINAL SHEET COLOR STATUS</b><span class="legend red">No Bed</span><span class="legend gray">Not moved yet</span><span class="legend yellow">Open</span><span class="legend darkgray">Out of Services</span><span class="legend rose">Can not Bill for</span></div>
      <div class="master-rules">
        <b>ORIGINAL SHEET NOTES</b>
        <span>Please don't call clients before 10 pm.</span>
        <span>You must actually see the clients and ask their name to be sure you have the correct client.</span>
        <span>Curfew for 2.1 is 10 on weekday and 11 for weekends. 1.0 dose not have a curfew.</span>
        <span>Call Clients after 10 pm on weekdays and ask where they are at and after 11 pm on weekends.</span>
        <span>PLEASE REPORT ANYONE YOU CANT REACH AND CAN'T SEE TO ON CALL PERSON.</span>
      </div>
    </div>
  </div>`;
}
function renderReport(){
  const view=document.getElementById('view');
  if(!inspectionRunIsActive()){
    setModulePrevious(goHome);
    view.innerHTML=`<section class="panel"><div class="title">Reports</div><div class="muted">No nightly inspection is currently in progress. Start one from Inspections by selecting today on the calendar.</div></section>`;
    return;
  }
  setModulePrevious(reportOrigin==='inspection'?()=>{hideFullNames();screen='inspections';inspectionView='run';render()}:goHome);
  const snap=currentSnapshot(),T=totalsFor();
  view.innerHTML=`<section class="panel"><div class="titlebar"><div class="title">${reportApproved?'Final Report':'Preview Complete Final Report'}</div>${nameRevealButton()}</div><div class="muted">${reportApproved?'Approved and ready to print, save, email, text, or archive.':'Every configured property is included. Verify unresolved required clients and Not Required clients before approval.'} Client names are masked by default.</div></section>
  <section class="reportwrap">${reportPaper(snap)}</section>
  <section class="panel">${reportApproved?`<div class="delivery">
    <button class="btn" id="previewAgain">Preview Again</button><button class="btn" id="printReport">Print</button><button class="btn" id="saveReport">Save Snapshot</button><button class="btn" id="emailReport">Email Report</button><button class="btn green" id="textReport">Text Report</button><button class="btn primary" id="completeRun">Complete & Save to History</button>
  </div>`:`<div class="actions"><button class="btn" id="backChecks">← Back to Checks</button><button class="btn primary" id="approveReport">Approve Complete Report</button></div>`}
  <div class="notice">${reportApproved?`Report text recipient: ${esc(fmtPhone(state.settings.reportTextNumber))}. No message is sent until you finish it in Messages.`:`${T.checked} required checks recorded • ${T.missing} unresolved • ${T.notRequired} clients not required • ${state.properties.length} total houses in report.`}</div></section>`;
  const nameToggle=document.getElementById('toggleNames');
  if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderReport()};
  if(!reportApproved){
    document.getElementById('backChecks').onclick=()=>{hideFullNames();screen='inspections';inspectionView='run';render()};
    document.getElementById('approveReport').onclick=()=>{
      const issues=requiredNoteIssues();
      if(issues.length){
        alert(`${issues.length} NOT HOME result${issues.length===1?'':'s'} still require${issues.length===1?'s':''} a note. First: ${displayClientName(issues[0].name)} at ${issues[0].address}.`);
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
  const W=2200,margin=32,gap=24,half=(W-margin*2-gap)/2;
  const widths=[48,224,150,58,58,58,58,half-(48+224+150+58*4)];
  const xPos=widths.reduce((a,w)=>{a.push(a[a.length-1]+w);return a},[0]);
  const measure=document.createElement('canvas').getContext('2d');
  const wrap=(text,maxWidth,font='13px Arial')=>{measure.font=font;const words=String(text||'').split(/\s+/).filter(Boolean),lines=[];let line='';for(const w of words){const t=line?line+' '+w:w;if(measure.measureText(t).width>maxWidth&&line){lines.push(line);line=w}else line=t}if(line)lines.push(line);return lines};
  const props=[...snapshot.properties].sort(compareProperties),split=Math.ceil(props.length/2),cols=[props.slice(0,split),props.slice(split)];
  const model=cols.map(col=>col.map(p=>{
    const rows=p.rooms.map(r=>{
      const status=statusFor(snapshot,p,r),marks=reportMarks(status),notes=reportNotes(snapshot,p,r);
      const noteLines=notes.flatMap(n=>wrap(n,widths[7]-12,'13px Arial'));
      const rowH=Math.max(34,18+Math.max(1,noteLines.length)*17);
      return {r,status,marks,noteLines,rowH};
    });
    return {p,rows,h:30+rows.reduce((n,r)=>n+r.rowH,0)};
  }));
  const headerH=116,colHeadH=34,footerH=250;
  const colHeights=model.map(col=>headerH+colHeadH+col.reduce((n,h)=>n+h.h+6,0)+footerH);
  const H=Math.max(1250,Math.ceil(Math.max(...colHeights)));
  const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
  g.fillStyle='#fff';g.fillRect(0,0,W,H);g.textBaseline='middle';
  g.fillStyle='#111';g.textAlign='center';g.font='bold 28px Arial';g.fillText('HOUSE CHECK RUN SHEET',W/2,28);
  const stamp=snapshot.completedAt?new Date(snapshot.completedAt):new Date();
  g.textAlign='left';g.font='bold 15px Arial';g.fillText('DATE / TIME:',margin,62);g.font='15px Arial';g.fillText(stamp.toLocaleString(),margin+115,62);
  g.textAlign='right';g.font='bold 15px Arial';g.fillText(`REPORTED BY: ${snapshot.reporterName||snapshot.driverName||'Reporter'}`,W-margin,62);
  g.textAlign='center';g.font='bold 14px Arial';g.fillText('SEE THEM • VERIFY THE NAME • CHECK THE STATUS • LEAVE A USEFUL NOTE',W/2,92);

  const labels=['Rm','Client Name','Cell Phone','Home','Not','Sleep','Pass','Notes'];
  const propertyFill=p=>({yellow:'#f3d96f',gray:'#c6cbd0',darkgray:'#7e878d',rose:'#e8aaaa'}[propertySituationColor(p)]||'#d7e7f4');
  const drawCell=(x,y,w,h,fill='#fff')=>{g.fillStyle=fill;g.fillRect(x,y,w,h);g.strokeStyle='#666';g.lineWidth=1;g.strokeRect(x,y,w,h)};
  const drawCheck=(cx,cy,on)=>{g.strokeStyle='#222';g.lineWidth=1.5;g.strokeRect(cx-8,cy-8,16,16);if(on){g.beginPath();g.moveTo(cx-5,cy);g.lineTo(cx-1,cy+5);g.lineTo(cx+6,cy-6);g.stroke()}};

  model.forEach((col,ci)=>{
    const baseX=margin+ci*(half+gap);let y=headerH;
    for(let i=0;i<8;i++){drawCell(baseX+xPos[i],y,widths[i],colHeadH,'#f0f0f0');g.fillStyle='#111';g.font='bold 11px Arial';g.textAlign='center';g.fillText(labels[i],baseX+xPos[i]+widths[i]/2,y+colHeadH/2)}
    y+=colHeadH;
    for(const h of col){
      drawCell(baseX,y,half,30,propertyFill(h.p));g.fillStyle='#111';g.textAlign='left';g.font='bold 13px Arial';g.fillText(h.p.address,baseX+7,y+15);
      const sit=propertySituationLabel(h.p);if(sit!=='No Special Status'){g.textAlign='right';g.font='bold 11px Arial';g.fillText(sit,baseX+half-7,y+15)}
      y+=30;
      for(const row of h.rows){
        const r=row.r;
        let baseFill='#fff';if(r.type==='open')baseFill='#fff4a6';else if(r.type==='nobed')baseFill='#e46a61';
        for(let i=0;i<8;i++)drawCell(baseX+xPos[i],y,widths[i],row.rowH,baseFill);
        if(r.type==='client'&&r.color==='green'){g.fillStyle='#cdebe3';g.fillRect(baseX+xPos[1],y,widths[1],row.rowH);g.strokeStyle='#666';g.strokeRect(baseX+xPos[1],y,widths[1],row.rowH)}
        if(r.type==='client'&&r.color==='gray'){g.fillStyle='#ddd';g.fillRect(baseX+xPos[1],y,widths[1],row.rowH);g.strokeStyle='#666';g.strokeRect(baseX+xPos[1],y,widths[1],row.rowH)}
        g.fillStyle='#111';g.font='13px Arial';g.textAlign='center';g.fillText(r.room,baseX+xPos[0]+widths[0]/2,y+17);
        g.textAlign='left';g.fillText(r.type==='client'?maskClientName(r.name):(r.type==='open'?'OPEN / EMPTY':'NO BED'),baseX+xPos[1]+6,y+17);
        if(r.type==='client'&&r.phone){g.font='11px Arial';g.fillText(fmtPhone(r.phone),baseX+xPos[2]+5,y+17)}
        if(r.type==='client'){const arr=[row.marks.home,row.marks.not,row.marks.sleep,row.marks.pass];for(let k=0;k<4;k++)drawCheck(baseX+xPos[3+k]+widths[3+k]/2,y+17,arr[k])}
        g.font='12px Arial';g.textAlign='left';row.noteLines.forEach((line,li)=>g.fillText(line,baseX+xPos[7]+5,y+13+li*17));
        y+=row.rowH;
      }
      y+=6;
    }
  });

  let fy=H-footerH+18;
  g.fillStyle='#111';g.textAlign='left';g.font='bold 14px Arial';g.fillText('ORIGINAL SHEET COLOR STATUS',margin,fy);fy+=22;
  const legend=[['No Bed','#e46a61'],['Not moved yet','#c6cbd0'],['Open','#f3d96f'],['Out of Services','#7e878d'],['Can not Bill for','#e8aaaa']];
  legend.forEach(([label,color],i)=>{const yy=fy+i*24;g.fillStyle=color;g.fillRect(margin,yy-8,22,16);g.strokeStyle='#666';g.strokeRect(margin,yy-8,22,16);g.fillStyle='#111';g.font='13px Arial';g.fillText(label,margin+32,yy)});
  const rules=[
    "Please don't call clients before 10 pm.",
    "You must actually see the clients and ask their name to be sure you have the correct client.",
    "Curfew for 2.1 is 10 on weekday and 11 for weekends. 1.0 dose not have a curfew.",
    "Call Clients after 10 pm on weekdays and ask where they are at and after 11 pm on weekends.",
    "PLEASE REPORT ANYONE YOU CANT REACH AND CAN'T SEE TO ON CALL PERSON."
  ];
  const rx=margin+520;g.font='bold 14px Arial';g.fillText('ORIGINAL SHEET NOTES',rx,H-footerH+18);g.font='13px Arial';let ry=H-footerH+44;
  for(const rule of rules){const lines=wrap(rule,W-rx-margin,'13px Arial');for(const line of lines){g.fillText(line,rx,ry);ry+=18}ry+=5}
  return new Promise(res=>c.toBlob(res,'image/png',.95));
}
function reportFilename(snapshot){const d=(snapshot.completedAt?new Date(snapshot.completedAt):new Date()).toISOString().slice(0,10);return `house-check-report-${d}.png`}
async function downloadSnapshot(snapshot){const b=await makeReportPng(snapshot),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=reportFilename(snapshot);a.click();setTimeout(()=>URL.revokeObjectURL(u),1200)}
function openSms(number,body){const n=digits(number);if(!n)return;location.href=`sms:${n}?body=${encodeURIComponent(body)}`}
function reportMessage(snapshot){const T=totalsFor(snapshot.properties,snapshot.checks),when=snapshot.completedAt?new Date(snapshot.completedAt).toLocaleString():new Date().toLocaleString();return `SCC-CTD House Check Report ${when}. ${T.checked}/${T.required} required client checks recorded; ${T.missing} unresolved; ${T.notRequired} clients marked not required. Report image prepared.`}
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
    alert(`Cannot complete this run yet. ${issues.length} NOT HOME result${issues.length===1?'':'s'} still need${issues.length===1?'s':''} a note.`);
    reportApproved=false;
    renderReport();
    return;
  }
  const finishedDate=state.currentRun.runDate||inspectionTodayKey();
  const snap=currentSnapshot(new Date().toISOString()),T=totalsFor(snap.properties,snap.checks);
  state.history.push({...snap,inspectionDate:finishedDate,checked:T.checked,required:T.required,missing:T.missing,notRequired:T.notRequired});
  state.currentRun={id:uuid(),active:false,runDate:'',startedAt:'',checks:{}};
  reportApproved=false;hideFullNames();await saveState();
  alert('Completed report saved. The inspection date is now marked on the calendar.');
  screen='inspections';
  historyCalendarDate=dateFromKey(finishedDate);
  inspectionDayKey=finishedDate;
  historySelectedDate=finishedDate;
  historyOpenId=null;
  inspectionView='day';
  render();
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
    <div class="history-list">${selected.length?selected.map(h=>`<article class="card history-card"><div><b>${esc(new Date(h.completedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}))}</b><div class="meta">${h.checked??0}/${h.required??h.total??0} checked • ${h.missing??0} unresolved • ${h.notRequired??0} clients N/R</div></div><button class="btn primary" data-history="${esc(h.id)}">Open Report</button></article>`).join(''):'<div class="muted">No completed report on this date.</div>'}</div>
  </section>`:''}`;
  document.getElementById('prevMonth').onclick=()=>shiftHistoryMonth(-1);
  document.getElementById('nextMonth').onclick=()=>shiftHistoryMonth(1);
  document.getElementById('calendarToday').onclick=()=>{historyCalendarDate=new Date();historySelectedDate=null;renderHistory()};
  view.querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>{historySelectedDate=b.dataset.date;renderHistory()});
  view.querySelectorAll('[data-history]').forEach(b=>b.onclick=()=>{historyOpenId=b.dataset.history;renderHistory()});
}


/* ---------- Portable encrypted database transfer ---------- */
function exportDatabasePayload(){
  return {
    product:'SCC-CTD House Checks',
    backupVersion:1,
    schemaVersion:18,
    exportedAt:new Date().toISOString(),
    properties:state.properties,
    inactiveClients:state.inactiveClients,
    locations:state.locations,
    route:state.route,
    settings:{
      organization:state.settings.organization,
      reportTextLabel:state.settings.reportTextLabel
    }
  };
}
function normalizeWorkEmail(email){
  return String(email||'').replace(/\s+/g,'').trim().toLowerCase();
}
function validWorkEmail(email){
  const v=normalizeWorkEmail(email);
  const at=v.lastIndexOf('@');
  if(at<=0)return false;
  if(v.indexOf('@')!==at)return false;
  const local=v.slice(0,at),domain=v.slice(at+1);
  return !!local && domain===WORK_EMAIL_DOMAIN;
}
async function deriveTransferKey(password,salt,iterations=240000){
  const material=await crypto.subtle.importKey('raw',ENC.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2',salt,iterations,hash:'SHA-256'},
    material,
    {name:'AES-GCM',length:256},
    false,
    ['encrypt','decrypt']
  );
}
async function makePortableBackup(password){
  if(String(password||'').length<8)throw new Error('Transfer password must be at least 8 characters.');
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const iterations=240000;
  const key=await deriveTransferKey(password,salt,iterations);
  const plain=ENC.encode(JSON.stringify(exportDatabasePayload()));
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain));
  return {
    format:'SCC-CTD-PORTABLE-BACKUP',
    version:1,
    encryption:'AES-256-GCM',
    kdf:'PBKDF2-SHA256',
    iterations,
    salt:bytesToB64(salt),
    iv:bytesToB64(iv),
    data:bytesToB64(cipher)
  };
}
async function openPortableBackup(file,password){
  const pack=JSON.parse(await file.text());
  if(pack?.format!=='SCC-CTD-PORTABLE-BACKUP')throw new Error('This is not an SCC-CTD encrypted backup.');
  const salt=b64ToBytes(pack.salt),iv=b64ToBytes(pack.iv),data=b64ToBytes(pack.data);
  const key=await deriveTransferKey(password,salt,Number(pack.iterations)||240000);
  let plain;
  try{
    plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,data);
  }catch{
    throw new Error('Transfer password is incorrect or the backup is damaged.');
  }
  const payload=JSON.parse(DEC.decode(plain));
  if(!payload||(!Array.isArray(payload.properties)&&!payload.operationalResetOnly))throw new Error('Backup contents are invalid.');
  return payload;
}
async function importDatabasePayload(incoming){
  if(incoming?.operationalResetOnly){
    state.currentRun={id:uuid(),active:false,runDate:'',startedAt:'',checks:{}};
    state.history=[];
    state.dailyNotes={};
    reportApproved=false;
    historyOpenId=null;
    inspectionView='calendar';
    inspectionDayKey=null;
    await saveState();
    return;
  }
  const keepText=state.settings.reportTextNumber,keepInactive=deepClone(state.inactiveClients||[]);
  const localIdentity={
    reporterName:state.settings.reporterName||state.settings.driverName||'',
    authorizedUserCell:state.settings.authorizedUserCell||'',
    userWorkEmail:state.settings.userWorkEmail||'',
    profileComplete:!!state.settings.profileComplete
  };
  state.properties=incoming.properties.map(normalizeProperty);
  state.inactiveClients=Array.isArray(incoming.inactiveClients)?incoming.inactiveClients.map(normalizeInactiveClient):keepInactive;
  state.locations=Array.isArray(incoming.locations)?incoming.locations:[];
  state.route=incoming.route&&Array.isArray(incoming.route.stops)?incoming.route:{stops:[]};
  const incomingSettings=incoming.settings||{};
  state.settings={...state.settings,...incomingSettings,...localIdentity,reportTextLabel:incomingSettings.reportTextLabel||incomingSettings.transportLabel||state.settings.reportTextLabel,reportTextNumber:keepText||incomingSettings.reportTextNumber||incomingSettings.transportNumber||''};
  state.currentRun={id:uuid(),active:false,runDate:'',startedAt:'',checks:{}};
  await saveState();
}
async function promptTransferPassword(title='Transfer Password'){
  return new Promise(resolve=>{
    const wrap=document.createElement('div');wrap.className='pin-overlay';
    wrap.innerHTML=`<div class="pin-dialog"><div class="title">${esc(title)}</div><div class="muted">Use at least 8 characters. Share this password separately from the backup email.</div><input id="transferPass1" type="password" autocomplete="new-password" placeholder="Transfer password"><input id="transferPass2" type="password" autocomplete="new-password" placeholder="Confirm transfer password"><div class="error" id="transferPassError"></div><div class="actions"><button class="btn" id="transferPassCancel">Cancel</button><button class="btn primary" id="transferPassOk">Continue</button></div></div>`;
    document.body.appendChild(wrap);
    const p1=wrap.querySelector('#transferPass1'),p2=wrap.querySelector('#transferPass2'),err=wrap.querySelector('#transferPassError');p1.focus();
    const done=v=>{wrap.remove();resolve(v)};
    wrap.querySelector('#transferPassCancel').onclick=()=>done(null);
    wrap.querySelector('#transferPassOk').onclick=()=>{
      if(p1.value.length<8){err.textContent='Use at least 8 characters.';return}
      if(p1.value!==p2.value){err.textContent='Passwords do not match.';return}
      done(p1.value);
    };
  });
}
async function promptImportPassword(){
  return new Promise(resolve=>{
    const wrap=document.createElement('div');wrap.className='pin-overlay';
    wrap.innerHTML=`<div class="pin-dialog"><div class="title">Backup Transfer Password</div><div class="muted">Enter the transfer password used when this backup was created.</div><input id="importTransferPass" type="password" autocomplete="off" placeholder="Transfer password"><div class="actions"><button class="btn" id="importPassCancel">Cancel</button><button class="btn primary" id="importPassOk">Import</button></div></div>`;
    document.body.appendChild(wrap);const input=wrap.querySelector('#importTransferPass');input.focus();
    const done=v=>{wrap.remove();resolve(v)};
    wrap.querySelector('#importPassCancel').onclick=()=>done(null);
    wrap.querySelector('#importPassOk').onclick=()=>done(input.value);
  });
}
async function emailEncryptedDatabase(){
  const recipient=normalizeWorkEmail(document.getElementById('databaseWorkEmail')?.value||'');
  if(!validWorkEmail(recipient)){
    alert(`Database transfers require an address ending exactly in @${WORK_EMAIL_DOMAIN}.`);
    return;
  }
  if(!await requestPin('export the encrypted client database'))return;
  const password=await promptTransferPassword('Create Transfer Password');
  if(!password)return;
  const pack=await makePortableBackup(password);
  const stamp=new Date().toISOString().slice(0,10);
  const filename=`SCC-CTD_Database_${stamp}.sccbackup`;
  const file=new File([JSON.stringify(pack)],filename,{type:'application/octet-stream'});
  const text=`SCC-CTD encrypted database backup.\nApproved work recipient: ${recipient}\n\nOpen SCC-CTD → Database → Import Encrypted Database, select this attachment, and enter the transfer password provided separately.`;
  if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
    try{
      await navigator.share({title:'SCC-CTD Encrypted Database Backup',text,files:[file]});
      return;
    }catch(e){
      if(e?.name==='AbortError')return;
    }
  }
  const blobUrl=URL.createObjectURL(file),a=document.createElement('a');
  a.href=blobUrl;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(blobUrl),1500);
  alert(`Encrypted backup saved. Attach it to a work email addressed only to ${recipient}.`);
}

/* ---------- Private import / Database ---------- */
async function importPrivateData(file){
  const lower=String(file?.name||'').toLowerCase();
  if(lower.endsWith('.sccbackup')){
    const password=await promptImportPassword();if(password===null)throw new Error('Import cancelled.');
    const incoming=await openPortableBackup(file,password);
    await importDatabasePayload(incoming);
    return;
  }
  const incoming=JSON.parse(await file.text());
  if(!incoming||!Array.isArray(incoming.properties))throw new Error('Not a House Checks starter-data file.');
  await importDatabasePayload(incoming);
}
async function exportPrivateData(){
  alert('Plain JSON export has been disabled. Use Email Encrypted Database for portable transfers.');
}
function renderDatabase(){
  const view=document.getElementById('view'),beds=state.properties.reduce((n,p)=>n+p.beds,0),active=activeClientRecords(),inactive=state.inactiveClients||[],openBeds=availableOpenBeds();
  const bedOptions=openBeds.map(x=>`<option value="${esc(x.property.id)}::${esc(x.room.room)}">${esc(x.property.address)} • Room ${esc(x.room.room)}</option>`).join('');
  view.innerHTML=`<section class="panel"><div class="titlebar"><div><div class="title">Encrypted Database Transfer</div><div class="muted">Portable database backups are encrypted and restricted in-app to Shawnee Counseling Center work email addresses.</div></div>${nameRevealButton()}</div>
  <div class="formgrid database-transfer-grid">
    <div class="field"><label>Work Email Recipient</label><input id="databaseWorkEmail" type="text" inputmode="email" autocomplete="email" placeholder="name@${WORK_EMAIL_DOMAIN}"><div class="field-help">Only @${WORK_EMAIL_DOMAIN} addresses are accepted by the app.</div></div>
  </div>
  <div class="actions"><button class="btn primary" id="emailDatabase">Email Encrypted Database</button><label class="btn" for="importData">Import Encrypted Database</label><input id="importData" type="file" accept=".sccbackup,.json,application/json,application/octet-stream" style="display:none"></div>
  <div class="notice">Export asks for your app PIN, then a separate transfer password. The transfer password should be given to the recipient separately. On iPhone, choose Mail in the system share sheet and send only to the approved work recipient.</div>
  <div id="importMessage" class="muted" style="margin-top:6px"></div></section>
  <section class="panel"><div class="title">Internal Database</div><div class="dbstats"><div class="stat"><strong>${state.properties.length}</strong>Properties</div><div class="stat"><strong>${beds}</strong>Beds</div><div class="stat"><strong>${active.length}</strong>Active Clients</div><div class="stat"><strong>${inactive.length}</strong>Inactive Clients</div><div class="stat"><strong>${state.history.length}</strong>Reports</div></div></section>
  <section class="panel"><div class="title">Active Client Registry</div><div class="registry-list">${active.map(x=>`<div class="registry-row"><b>${esc(displayClientName(x.room.name))}</b><span>${esc(x.property.address)} • Room ${esc(x.room.room)}</span><small>${x.room.workSchedule?`Work: ${esc(x.room.workSchedule)}`:'No work schedule entered'}${x.room.schoolSchedule?` • School: ${esc(x.room.schoolSchedule)}`:''}</small></div>`).join('')||'<div class="muted">No active clients.</div>'}</div></section>
  <section class="panel"><div class="title">Inactive Client Registry</div><div class="muted">Records stay here so returning clients can be restored instead of re-created.</div><div class="registry-list">${inactive.map((c,i)=>`<div class="registry-row inactive-row"><b>${esc(displayClientName(c.name))}</b><span>Last: ${esc(c.previousAddress||'Unknown')} ${c.previousRoom?`• Room ${esc(c.previousRoom)}`:''}</span><small>${c.workSchedule?`Work: ${esc(c.workSchedule)}`:'No work schedule entered'}${c.schoolSchedule?` • School: ${esc(c.schoolSchedule)}`:''}</small>${openBeds.length?`<div class="registry-restore"><select data-restore-bed="${i}">${bedOptions}</select><button class="btn" data-restore="${i}">Reactivate</button></div>`:'<small>No OPEN bed is currently available for reactivation.</small>'}</div>`).join('')||'<div class="muted">No inactive clients.</div>'}</div></section>`;
  const nameToggle=document.getElementById('toggleNames');
  if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderDatabase()};
  document.getElementById('emailDatabase').onclick=emailEncryptedDatabase;
  document.getElementById('importData').onchange=async()=>{
    const f=document.getElementById('importData').files?.[0];if(!f)return;const msg=document.getElementById('importMessage');
    try{await importPrivateData(f);msg.textContent='Encrypted database imported into this phone’s protected local database.';setTimeout(renderDatabase,450)}catch(e){msg.textContent='Import failed: '+e.message}
  };
  view.querySelectorAll('[data-restore]').forEach(b=>b.onclick=async()=>{
    if(!await requestPin('reactivate this client'))return;
    const i=+b.dataset.restore,c=state.inactiveClients[i],sel=view.querySelector(`[data-restore-bed="${i}"]`);if(!c||!sel)return;
    const [pid,roomNo]=sel.value.split('::'),p=state.properties.find(x=>x.id===pid),r=p?.rooms.find(x=>String(x.room)===roomNo);
    if(!p||!r||r.type!=='open'){alert('That bed is no longer open. Refresh and choose another.');return}
    Object.assign(r,{type:'client',name:c.name,phone:c.phone,color:c.color,note:c.note,checkRequired:c.checkRequired,clientId:c.clientId||uuid(),workSchedule:c.workSchedule||'',schoolSchedule:c.schoolSchedule||'',importantInfo:c.importantInfo||''});
    state.inactiveClients.splice(i,1);await saveState();renderDatabase();
  });
}

/* ---------- Settings ---------- */
function renderSettings(){
  const s=state.settings,view=document.getElementById('view');
  view.innerHTML=`<section class="panel"><div class="title">Setup & Settings</div><div class="muted">The report-text cell number is intentionally editable so you can test with your own phone before switching to the real recipient.</div></section>
  <section class="panel"><div class="formgrid">
    <div class="field"><label>Authorized User Name</label><input id="reporterName" autocomplete="name" value="${esc(s.reporterName||s.driverName||'')}"></div>
    <div class="field"><label>Authorized User Cell Number</label><input id="authorizedUserCell" type="tel" inputmode="tel" autocomplete="tel" value="${esc(fmtPhone(s.authorizedUserCell||''))}"></div>
    <div class="field"><label>Work Email</label><div class="work-email-rule">Must end exactly in <b>@${WORK_EMAIL_DOMAIN}</b></div><input id="userWorkEmail" type="text" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="${esc(s.userWorkEmail||'')}" placeholder="name@${WORK_EMAIL_DOMAIN}"></div>
    <div class="field"><label>Confirm Work Email</label><input id="userWorkEmailConfirm" type="text" inputmode="email" autocomplete="off" autocapitalize="none" spellcheck="false" value="" placeholder="Retype work email"></div>
    <div class="field"><label>Organization</label><input id="organization" value="${esc(s.organization)}"></div>
    <div class="field"><label>Report recipient label</label><input id="reportLabel" value="${esc(s.reportTextLabel)}"></div>
    <div class="field"><label>Report Text Cell Number</label><input id="reportNumber" type="tel" inputmode="tel" value="${esc(fmtPhone(s.reportTextNumber))}"></div>
    <div class="field"><label>Auto-lock minutes</label><input id="autoLock" type="number" min="1" max="120" value="${Number(s.autoLockMinutes)||15}"></div>
  </div><div class="actions"><button class="btn" id="testText">Test Text</button><button class="btn primary" id="saveSettings">Save Settings</button><button class="btn" id="lockNow">Lock Now</button></div><div class="notice">Test Text opens Messages with a harmless draft to the configured number. The app never silently sends it.</div></section>`;
  document.getElementById('testText').onclick=()=>{const n=digits(document.getElementById('reportNumber').value);if(n.length<10){alert('Enter a valid report-text cell number first.');return}openSms(n,'SCC-CTD House Checks TEST: report texting is configured correctly.')};
  document.getElementById('saveSettings').onclick=async()=>{
    const reporterName=document.getElementById('reporterName').value.trim();
    const authorizedUserCell=digits(document.getElementById('authorizedUserCell').value);
    const userWorkEmail=normalizeWorkEmail(document.getElementById('userWorkEmail').value);
    const userWorkEmailConfirm=normalizeWorkEmail(document.getElementById('userWorkEmailConfirm').value);
    if(!reporterName){alert('Enter the Authorized User Name.');return}
    if(authorizedUserCell.length<10){alert('Enter the Authorized User Cell Number.');return}
    if(!validWorkEmail(userWorkEmail)){alert(`Work Email must end exactly in @${WORK_EMAIL_DOMAIN}.`);return}
    if(userWorkEmail!==userWorkEmailConfirm){alert('Work Email entries do not match.');return}
    s.reporterName=reporterName;s.authorizedUserCell=authorizedUserCell;s.userWorkEmail=userWorkEmail;s.profileComplete=true;s.organization=document.getElementById('organization').value.trim()||'Organization';
    s.reportTextLabel=document.getElementById('reportLabel').value.trim()||'Report Recipient';s.reportTextNumber=digits(document.getElementById('reportNumber').value);
    s.autoLockMinutes=Math.max(1,Math.min(120,+document.getElementById('autoLock').value||15));await saveState();bumpLock();alert('Settings saved.');
  };
  document.getElementById('lockNow').onclick=()=>{cryptoKey=null;state=null;showLock()};
}

start();
})();
