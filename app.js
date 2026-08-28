
(()=>{'use strict';

const VERSION='1.6.16';
const APP=document.getElementById('app');
const DB_NAME='scc_housechecks_db';
const WORK_EMAIL_DOMAIN='shawneecounseling.org';
const STORE='kv', META='meta', DATA='data';
const ENC=new TextEncoder(), DEC=new TextDecoder();
let cryptoKey=null,state=null,screen='home',activePropertyId=null,editPropertyId=null,editLocationId=null;
let revealCode=false,reportApproved=false,historyOpenId=null,autoLockTimer=null;
let showFullNames=false,nameRevealTimer=null,clientSearchFirst='',clientSearchLast='';
let historyCalendarDate=new Date(),historySelectedDate=null;
let inspectionView='calendar',inspectionDayKey=null,reportOrigin='menu';
let settingsView='menu';
let routePlannerView='menu',routePickerKind='',routePickerDraft=null,routeInlineMode='',routeStartPickerOpen=false;
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
function orderedProperties(list=state.properties){
  const manual=state?.settings?.houseOrder;
  if(!Array.isArray(manual)||!manual.length)return [...list].sort(compareProperties);
  const pos=new Map(manual.map((id,i)=>[id,i]));
  const inOrder=list.filter(p=>pos.has(p.id)).sort((a,b)=>pos.get(a.id)-pos.get(b.id));
  const rest=list.filter(p=>!pos.has(p.id)).sort(compareProperties);
  return [...inOrder,...rest];
}
function moveHouseOrder(i,d){
  const current=orderedProperties().map(p=>p.id);
  const j=i+d;if(j<0||j>=current.length)return;
  [current[i],current[j]]=[current[j],current[i]];
  state.settings.houseOrder=current;
}
function smartHouseOrder(list=state.properties){
  // Local street/house-number grouping only — properties carry no coordinates,
  // and this app never sends the house list to an external optimizer.
  const groups=[],byStreet=new Map();
  for(const p of list){
    const a=addressParts(p.address),key=a.street||String(p.address||'').toLowerCase();
    if(!byStreet.has(key)){const g={key,items:[]};byStreet.set(key,g);groups.push(g)}
    byStreet.get(key).items.push(p);
  }
  for(const g of groups)g.items.sort((a,b)=>addressParts(a.address).number-addressParts(b.address).number);
  return groups.flatMap(g=>g.items);
}
function ensureBaseLocations(list){
  // Route locations stay in the encrypted local database. Public app files do not seed private addresses.
  return Array.isArray(list)?list:[];
}
function baseLocations(){return state.locations.filter(l=>l.isBase)}

const checkKey=(pid,room)=>`${pid}::${room}`;

function defaultState(){
  return {
    schemaVersion:26,
    properties:[],
    clients:[],
    inactiveClients:[],
    locations:[],
    route:{stops:[],startMode:'current',startLocationId:'',runIndex:0,runStartAddress:'',runStartLabel:''},
    savedRoutes:[],
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

function normalizeRegistryClient(c,i,statusDefault='active'){
  return {
    clientId:String(c?.clientId||('client_'+i+'_'+Date.now())),
    name:c?.name||'Unnamed Client',
    phone:c?.phone||'',
    color:['green','gray'].includes(c?.color)?c.color:'',
    note:c?.note||'',
    checkRequired:(typeof c?.checkRequired==='boolean'?c.checkRequired:!['green','gray'].includes(c?.color)),
    workSchedule:c?.workSchedule||'',
    schoolSchedule:c?.schoolSchedule||'',
    importantInfo:c?.importantInfo||'',
    status:c?.status==='inactive'?'inactive':statusDefault,
    previousAddress:c?.previousAddress||'',
    previousRoom:String(c?.previousRoom||''),
    inactiveAt:c?.inactiveAt||'',
    createdAt:c?.createdAt||new Date().toISOString(),
    updatedAt:c?.updatedAt||new Date().toISOString()
  };
}
function clientById(id){return (state?.clients||[]).find(c=>c.clientId===id)||null}
function clientAssignment(id){
  if(!id||!state)return null;
  for(const p of state.properties)for(const r of p.rooms)if(r.type==='client'&&r.clientId===id)return {property:p,room:r};
  return null;
}
function syncRoomFromClient(r,c){
  if(!r||!c)return r;
  Object.assign(r,{
    type:'client',clientId:c.clientId,name:c.name,phone:c.phone,color:c.color,note:c.note,
    checkRequired:c.checkRequired,workSchedule:c.workSchedule||'',schoolSchedule:c.schoolSchedule||'',
    importantInfo:c.importantInfo||''
  });
  return r;
}
function registryClientFromRoom(r,address='',room=''){
  return normalizeRegistryClient({
    clientId:r.clientId||uuid(),name:r.name,phone:r.phone,color:r.color,note:r.note,
    checkRequired:r.checkRequired,workSchedule:r.workSchedule,schoolSchedule:r.schoolSchedule,
    importantInfo:r.importantInfo,previousAddress:address,previousRoom:room||r.room,status:'active'
  },0,'active');
}
function ensureRegistryClientForRoom(r,address='',room=''){
  if(!r||r.type!=='client')return null;
  if(!r.clientId)r.clientId=uuid();
  let c=(state?.clients||[]).find(x=>x.clientId===r.clientId);
  if(!c){
    c=registryClientFromRoom(r,address,room);
    state.clients.push(c);
  }
  c.status='active';c.updatedAt=new Date().toISOString();
  syncRoomFromClient(r,c);
  return c;
}
function unassignRoomClient(p,r){
  if(!r||r.type!=='client')return null;
  const c=clientById(r.clientId)||ensureRegistryClientForRoom(r,p?.address||'',r.room);
  if(c){
    c.status='active';
    c.previousAddress=p?.address||c.previousAddress||'';
    c.previousRoom=String(r.room||c.previousRoom||'');
    c.inactiveAt='';
    c.updatedAt=new Date().toISOString();
  }
  Object.assign(r,{type:'open',name:'OPEN',phone:'',color:'',note:'',checkRequired:false,clientId:'',workSchedule:'',schoolSchedule:'',importantInfo:''});
  if(p)delete state.currentRun.checks[checkKey(p.id,r.room)];
  return c;
}
function activeRegistryClients(){return (state?.clients||[]).filter(c=>c.status!=='inactive')}
function inactiveRegistryClients(){return (state?.clients||[]).filter(c=>c.status==='inactive')}
function unassignedActiveClients(){
  const assigned=new Set(activeClientRecords().map(x=>x.room.clientId).filter(Boolean));
  return activeRegistryClients().filter(c=>!assigned.has(c.clientId));
}
function clientHousingLabel(c){
  const a=clientAssignment(c?.clientId);
  return a?`${a.property.address} • Room ${a.room.room}`:'UNASSIGNED';
}
function upsertRegistryClient(c){
  state.clients=Array.isArray(state.clients)?state.clients:[];
  const ix=state.clients.findIndex(x=>x.clientId===c.clientId);
  if(ix>=0)state.clients[ix]=c;else state.clients.push(c);
  return c;
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
  // Housing no longer deactivates people. Leaving a room makes the client ACTIVE • UNASSIGNED.
  if(!r||r.type!=='client')return;
  let c=clientById(r.clientId);
  if(!c){
    c=registryClientFromRoom(r,address,room);
    upsertRegistryClient(c);
  }
  c.status='active';
  c.previousAddress=address||c.previousAddress||'';
  c.previousRoom=String(room||r.room||c.previousRoom||'');
  c.inactiveAt='';
  c.updatedAt=new Date().toISOString();
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
  const legacyInactive=Array.isArray(s.inactiveClients)?s.inactiveClients.map(normalizeInactiveClient):[];
  d.clients=Array.isArray(s.clients)?s.clients.map((c,i)=>normalizeRegistryClient(c,i,c?.status==='inactive'?'inactive':'active')):[];
  // Schema 26 migration: every person becomes one central client record. Rooms only reference that record.
  for(const old of legacyInactive){
    if(!d.clients.some(c=>c.clientId===old.clientId))d.clients.push(normalizeRegistryClient({...old,status:'inactive'},d.clients.length,'inactive'));
  }
  for(const prop of d.properties){
    for(const room of prop.rooms){
      if(room.type!=='client')continue;
      if(!room.clientId)room.clientId=uuid();
      let c=d.clients.find(x=>x.clientId===room.clientId);
      if(!c){
        c=normalizeRegistryClient({
          clientId:room.clientId,name:room.name,phone:room.phone,color:room.color,note:room.note,
          checkRequired:room.checkRequired,workSchedule:room.workSchedule,schoolSchedule:room.schoolSchedule,
          importantInfo:room.importantInfo,status:'active',previousAddress:prop.address,previousRoom:room.room
        },d.clients.length,'active');
        d.clients.push(c);
      }
      c.status='active';c.inactiveAt='';
      syncRoomFromClient(room,c);
    }
  }
  d.inactiveClients=d.clients.filter(c=>c.status==='inactive').map((c,i)=>normalizeInactiveClient(c,i)); // legacy export compatibility only
  d.locations=Array.isArray(s.locations)?s.locations.map((l,i)=>({
    id:String(l?.id??('l'+i+'_'+Date.now())),name:l?.name??'Unnamed Location',address:l?.address??'',
    type:l?.type??'Other',phone:l?.phone??'',notes:l?.notes??'',isBase:!!l?.isBase,
    category:l?.category==='business'?'business':'saved'
  })):[];
  // Remove only the obsolete demo/base addresses that older public builds injected.
  d.locations=d.locations.filter(l=>!['base-home-office','base-transportation'].includes(l.id));
  ensureBaseLocations(d.locations);
  const oldRoute=s.route&&Array.isArray(s.route.stops)?s.route:{};
  const legacyBaseId=String(oldRoute.baseId||'');
  d.route={
    stops:Array.isArray(oldRoute.stops)?oldRoute.stops.map(x=>deepClone(x)):[],
    startMode:oldRoute.startMode==='location'?'location':'current',
    startLocationId:String(oldRoute.startLocationId||legacyBaseId||''),
    runIndex:Math.max(0,Number(oldRoute.runIndex)||0),
    runStartAddress:String(oldRoute.runStartAddress||''),
    runStartLabel:String(oldRoute.runStartLabel||'')
  };
  if(d.route.startMode==='location'&&!d.locations.some(l=>l.id===d.route.startLocationId)){
    d.route.startMode='current';d.route.startLocationId='';
  }
  d.savedRoutes=Array.isArray(s.savedRoutes)?s.savedRoutes.map(r=>({
    id:String(r?.id||uuid()),name:String(r?.name||'Saved Route'),createdAt:r?.createdAt||new Date().toISOString(),
    updatedAt:r?.updatedAt||r?.createdAt||new Date().toISOString(),
    startMode:r?.startMode==='location'?'location':'current',startLocationId:String(r?.startLocationId||''),
    stops:Array.isArray(r?.stops)?r.stops.map(x=>deepClone(x)):[]
  })):[];
  const oldNum=s.settings?.reportTextNumber||s.settings?.transportNumber||'';
  d.settings={...d.settings,...(s.settings||{}),reportTextNumber:oldNum,reportTextLabel:s.settings?.reportTextLabel||s.settings?.transportLabel||'Report Recipient'};
  {
    const validIds=new Set(d.properties.map(p=>p.id));
    d.settings.houseOrder=(Array.isArray(s.settings?.houseOrder)?s.settings.houseOrder:[]).filter(id=>validIds.has(id));
  }
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
      checks:s.currentRun.checks||{},
      previewSignature:String(s.currentRun.previewSignature||'')
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
    for(const c of d.clients)c.checkRequired=!['green','gray'].includes(c.color);
    d.inactiveClients=d.clients.filter(c=>c.status==='inactive').map((c,i)=>normalizeInactiveClient(c,i));
  }
  if(Number(s.schemaVersion||0)<6){
    for(const p of d.properties){
      p.propertyStatus=legacyPropertySituation(p);
      p.houseColor=propertySituation(p).color;
      if(!p.doorCodeUpdatedAt&&p.doorCode)p.doorCodeUpdatedAt='';
    }
  }
  d.schemaVersion=26;
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
  await kvPut(META,{salt:bytesToB64(salt),createdAt:new Date().toISOString(),schemaVersion:26});
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
  if(document.querySelector('.pin-overlay.admin-pin-active'))return Promise.resolve(false);
  return new Promise(resolve=>{
    const wrap=document.createElement('div');wrap.className='pin-overlay admin-pin-active';
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
  [['route','📍','ROUTE PLANNER']],
  [['search','🔒','CLIENT • SECURE']],
  [['properties','🏠','PROPERTIES']],
  [['vehicleLogs','🚐','VEHICLE LOGS • UNDER CONST']],
  [['settings','⚙️','SETTINGS']]
]

function resetModuleState(){
  hideFullNames();
  codesUnlocked=false;
  settingsView='menu';
  routePlannerView='menu';
  routePickerKind='';
  routePickerDraft=null;
  routeInlineMode='';
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
      if(next==='search'){
        if(!await requestPin('enter CLIENT • SECURE'))return;
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
  if(screen==='houseOrder')return renderHouseOrder();
  if(screen==='vehicleLogs')return renderVehicleLogs();
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
function inspectionRunSignature(){
  return JSON.stringify(state.currentRun?.checks||{});
}
function inspectionFinalGate(){
  const totals=totalsFor();
  const noteIssues=requiredNoteIssues();
  return {
    totals,
    noteIssues,
    ready:totals.missing===0&&noteIssues.length===0
  };
}
function finalPreviewIsCurrent(){
  return !!state.currentRun?.previewSignature&&state.currentRun.previewSignature===inspectionRunSignature();
}
async function beginInspectionForToday(){
  const key=inspectionTodayKey();
  const existingReports=reportsForDateKey(key);
  if(existingReports.length){
    alert(`The nightly inspection for ${inspectionDateLabel(key,true)} has already been finalized. Revisit the locked report instead of starting another inspection.`);
    inspectionDayKey=key;
    inspectionView='day';
    renderInspections();
    return;
  }
  if(inspectionRunIsActive()){
    alert(`An inspection is already in progress for ${inspectionDateLabel(activeInspectionDate()||key,true)}.`);
    inspectionDayKey=activeInspectionDate()||key;
    inspectionView='day';
    renderInspections();
    return;
  }
  state.currentRun={id:uuid(),active:true,runDate:key,startedAt:new Date().toISOString(),checks:{},previewSignature:''};
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
  const T=totalsFor(),gate=inspectionFinalGate(),previewCurrent=finalPreviewIsCurrent();
  const finalControls=!gate.ready
    ? `<section class="panel final-gate blocked">
        <div class="final-gate-title">NOT YET READY TO LOCK</div>
        <div class="muted">${T.missing} required field${T.missing===1?'':'s'} remain unresolved. Every required client must be accounted for before a final report can be processed.</div>
      </section>`
    : !previewCurrent
      ? `<section class="panel final-gate ready">
          <div class="final-gate-title">ALL REQUIRED CHECKS COMPLETE</div>
          <div class="muted">Zero required fields are missing. Preview the final report before it can be locked.</div>
          <button class="btn primary final-action-button" id="previewFinalReport">Preview Final Report</button>
        </section>`
      : `<section class="panel final-gate previewed">
          <div class="final-gate-title">PREVIEW COMPLETE</div>
          <div class="muted">The report still matches the inspection data you previewed. Any inspection change will require another preview before locking.</div>
          <div class="actions">
            <button class="btn" id="previewFinalAgain">Preview Again</button>
            <button class="btn primary" id="lockFinalReport">🔒 Lock Final Report</button>
          </div>
        </section>`;

  return `<section class="panel inspection-current">
    <div class="titlebar"><div><div class="title">Inspection In Progress</div><div class="muted">${inspectionDateLabel(activeInspectionDate()||inspectionTodayKey())} • Started ${state.currentRun.startedAt?new Date(state.currentRun.startedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):''}</div></div></div>
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
        g.missing>0
          ? `<span class="required">● CHECKS REQUIRED</span>`
          : `<span class="complete">● COMPLETE</span>`
      }</div>
      <div class="meta">${p.beds} beds • ${g.total?`${g.done}/${g.total} required checked`:'0 required checks • complete'} • ${open} open • ${noBed} no bed</div>
      <div class="progress"><span style="width:${g.pct}%"></span></div>
      <div class="actions"><button class="btn ${g.missing>0?'primary':''}" data-open="${esc(p.id)}">${g.total?'Open House':'View House'}</button><span class="progress-ring ${g.pct>=100?'complete':''}" style="--pct:${g.pct}"><span>${g.pct}%</span></span></div>
    </article>`;
  }).join('')||'<div class="panel"><div class="muted">No properties are loaded yet.</div></div>'}</section>
  ${finalControls}`;
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
    <div class="history-list">${reports.map(h=>`<article class="card history-card"><div><b>${esc(new Date(h.completedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}))}</b><div class="meta">${h.checked??0}/${h.required??h.total??0} checked • ${h.missing??0} unresolved</div></div><button class="btn primary" data-inspection-history="${esc(h.id)}">Revisit Report 🔒</button></article>`).join('')}</div>
  </section>`:''}

  ${isToday&&!inspectionRunIsActive()&&!reports.length?`<section class="panel start-inspection-panel">
    <div class="title">Nightly Inspection</div>
    <div class="muted">This calendar date is the only place a new nightly inspection can be started.</div>
    <button class="btn primary begin-inspection-button" id="beginInspection">Start Inspections • ${esc(inspectionDateLabel(key,true))}</button>
  </section>`:''}

  ${isToday&&!inspectionRunIsActive()&&reports.length?`<section class="panel finalized-day-panel">
    <div class="finalized-day-banner">🔒 NIGHTLY INSPECTION FINALIZED</div>
    <div class="muted">A locked final report already exists for ${esc(inspectionDateLabel(key,true))}. Starting another inspection for this date is disabled.</div>
    <button class="btn primary revisit-report-button" id="revisitFinalReport">Revisit Final Report</button>
  </section>`:''}

  ${isActiveDate?`<section class="panel inspection-active-panel">
    <div class="inspection-in-progress-banner">● INSPECTION IN PROGRESS</div>
    <div class="actions">
      <button class="btn primary" id="continueInspection">Continue Inspection</button>
      <button class="btn" id="viewCurrentReport">View Current Report</button>
      <button class="btn red" id="cancelInspection">Cancel Inspection</button>
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

  const revisit=document.getElementById('revisitFinalReport');
  if(revisit)revisit.onclick=()=>{
    const latest=reports[0];
    if(latest)openInspectionHistoryReport(latest.id);
  };

  const cont=document.getElementById('continueInspection');
  if(cont)cont.onclick=()=>{inspectionView='run';renderInspections()};

  const current=document.getElementById('viewCurrentReport');
  if(current)current.onclick=()=>{inspectionView='currentReport';renderInspections()};

  const cancelBtn=document.getElementById('cancelInspection');
  if(cancelBtn)cancelBtn.onclick=async()=>{
    if(cancelBtn.disabled)return;cancelBtn.disabled=true;
    try{
      if(!inspectionRunIsActive()){alert('No active inspection to cancel.');return}
      if(!await requestPin("cancel tonight's inspection")){return}
      const T=totalsFor();
      if(!confirm(`Cancel this inspection? Every status, note, and check already entered tonight (${T.checked} checked) will be discarded. This cannot be undone. No report will be saved for ${inspectionDateLabel(key,true)}.`)){return}
      state.currentRun={id:uuid(),active:false,runDate:'',startedAt:'',checks:{},previewSignature:''};
      inspectionView='day';
      await saveState();renderInspections();
    }finally{
      cancelBtn.disabled=false;
    }
  };

  const goActive=document.getElementById('goActiveInspection');
  if(goActive)goActive.onclick=()=>{inspectionDayKey=activeInspectionDate();inspectionView='day';renderInspections()};
}
async function exitFinalPreview(){
  state.currentRun.previewSignature=inspectionRunSignature();
  await saveState();
  inspectionView='run';
  renderInspections();
}
let lockingFinalReport=false;
async function lockFinalInspectionReport(){
  if(lockingFinalReport)return;
  lockingFinalReport=true;
  try{
    const gate=inspectionFinalGate();
    if(!gate.ready){
      const issue=gate.noteIssues[0];
      alert(issue
        ? `Final report cannot be locked. ${displayClientName(issue.name)} at ${issue.address} still requires a note.`
        : `Final report cannot be locked. ${gate.totals.missing} required client field${gate.totals.missing===1?' is':'s are'} still unresolved.`);
      return;
    }
    if(!finalPreviewIsCurrent()){
      alert('The final report must be previewed after the most recent inspection change before it can be locked.');
      return;
    }
    if(!await requestPin('lock the final inspection report'))return;

    const finishedDate=state.currentRun.runDate||inspectionTodayKey();
    const snap=currentSnapshot(new Date().toISOString()),T=totalsFor(snap.properties,snap.checks);
    const locked={...snap,inspectionDate:finishedDate,lockedAt:new Date().toISOString(),locked:true,checked:T.checked,required:T.required,missing:T.missing,notRequired:T.notRequired};
    state.history.push(locked);
    state.currentRun={id:uuid(),active:false,runDate:'',startedAt:'',checks:{},previewSignature:''};
    reportApproved=false;
    hideFullNames();
    await saveState();

    screen='inspections';
    historyCalendarDate=dateFromKey(finishedDate);
    inspectionDayKey=finishedDate;
    historySelectedDate=finishedDate;
    historyOpenId=locked.id;
    inspectionView='historyReport';
    render();
  }finally{
    lockingFinalReport=false;
  }
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
          <div class="title">Locked Final Report • ${esc(inspectionDateLabel(reportDateKey(h)||historyLocalDateKey(h.completedAt)))}</div>
          <div class="muted">Pinch with two fingers to zoom. Drag to inspect any part of the saved report.</div>
        </div>
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

  if(inspectionView==='finalPreview'){
    if(!inspectionRunIsActive()){inspectionView='calendar';return renderInspections()}
    const gate=inspectionFinalGate();
    if(!gate.ready){inspectionView='run';return renderInspections()}
    hideFullNames();
    const snap=currentSnapshot();
    setModulePrevious(exitFinalPreview,'Exit Preview');
    view.innerHTML=`<section class="panel final-preview-header">
      <div class="title">Final Report Preview</div>
      <div class="muted">VIEW ONLY • Pinch with two fingers to zoom. Exit Preview to return to the inspection before locking.</div>
    </section>
    <section class="reportwrap inspection-report-zoom final-preview-view">${reportPaper(snap)}</section>
    <section class="panel final-preview-footer">
      <button class="btn primary" id="exitFinalPreview">Exit Preview</button>
    </section>`;
    document.getElementById('exitFinalPreview').onclick=exitFinalPreview;
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
    const previewFinal=document.getElementById('previewFinalReport');
    if(previewFinal)previewFinal.onclick=()=>{hideFullNames();inspectionView='finalPreview';renderInspections()};
    const previewAgain=document.getElementById('previewFinalAgain');
    if(previewAgain)previewAgain.onclick=()=>{hideFullNames();inspectionView='finalPreview';renderInspections()};
    const lockFinal=document.getElementById('lockFinalReport');
    if(lockFinal)lockFinal.onclick=lockFinalInspectionReport;
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
    <div class="muted">Select any date. Green marks today, finalized reports carry a pink report mark with a blue halo, and the small amber dot marks a saved day note.</div>
  </section>
  <section class="panel calendar-panel inspection-calendar">
    <div class="calendar-head"><button class="btn" id="prevInspectionMonth">←</button><strong>${esc(monthName)}</strong><button class="btn" id="nextInspectionMonth">→</button></div>
    <div class="calweek">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<span>${d}</span>`).join('')}</div>
    <div class="calendar-grid">${cells.join('')}</div>
    <div class="calendar-legend">
      <span><i class="legend-box legend-today"></i>Today</span>
      <span><i class="legend-box legend-report"></i>Locked Final Report</span>
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
function propertySituationCardHtml(p){
  const s=propertySituation(p);
  if(!s.color)return '';
  return `<div class="situation-flag situation-${s.color}">${esc(s.label.toUpperCase())}</div>`;
}

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
    <div class="actions" style="margin-top:10px"><button class="btn" id="openHouseOrderFromTonight">↕ Order Houses for Tonight</button></div>
  </section>
  <section class="houserows">${orderedProperties().map(p=>{
    const g=progress(p),open=p.rooms.filter(r=>r.type==='open').length,noBed=p.rooms.filter(r=>r.type==='nobed').length;
    const flag=!propertyNeedsChecks(p)
      ? `<span class="notrequired">● NO REQUIRED CLIENTS</span>`
      : g.missing>0
        ? `<span class="required">● CHECKS REQUIRED</span>`
        : `<span class="complete">● COMPLETE</span>`;
    return `<div class="houserow tonightrow ${houseClass(p)}" data-open="${esc(p.id)}" role="button" tabindex="0">
      <span class="houserow-color ${propertySituationColor(p)||'none'}"></span>
      <span class="houserow-main">
        <b>${esc(p.address)}</b> <button class="row-navlink" data-nav="${esc(p.id)}" aria-label="Get directions to this house" title="Get directions">📍</button>${propertySituationCardHtml(p)}
        <small>${flag} · ${p.beds} beds • ${!propertyNeedsChecks(p)?'no required clients':`${g.done}/${g.total} checked`} • ${open} open • ${noBed} no bed</small>
        ${propertyNeedsChecks(p)?`<div class="progress thin"><span style="width:${g.pct}%"></span></div>`:''}
      </span>
      <span class="houserow-controls tonight-controls">${propertyNeedsChecks(p)?`<span class="progress-ring ${g.pct>=100?'complete':''}" style="--pct:${g.pct}"><span>${g.pct}%</span></span>`:'<span class="badge">N/R</span>'}</span>
    </div>`;
  }).join('')||'<div class="panel"><div class="muted">No properties are loaded yet. Import the private starter data from Database, or add properties manually.</div></div>'}</section>
  <div class="actions"><button class="btn primary" id="finishRun">Finish Run → Preview Complete Report</button></div>`;
  const nameToggle=document.getElementById('toggleNames');
  if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderInspections()};
  view.querySelectorAll('[data-nav]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    const p=state.properties.find(x=>x.id===b.dataset.nav);if(p)openClientAddressGoogleMaps(p.address);
  });
  view.querySelectorAll('[data-open]').forEach(b=>{
    b.onclick=()=>{activePropertyId=b.dataset.open;revealCode=false;render()};
    b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();b.onclick()}};
  });
  document.getElementById('finishRun').onclick=()=>{hideFullNames();screen='report';reportApproved=false;render()};
  document.getElementById('openHouseOrderFromTonight').onclick=()=>{
    houseOrderReturnTo=()=>{screen='inspections';inspectionView='run';render()};
    screen='houseOrder';render();
  };
}
function roomCheckHtml(p,r,i){
  if(r.type==='open')return `<div class="room"><div class="roomno">${esc(r.room)}</div><div><span class="tag open">OPEN / EMPTY</span></div></div>`;
  if(r.type==='nobed')return `<div class="room"><div class="roomno">${esc(r.room)}</div><div><span class="tag nobed">NO BED</span></div></div>`;
  const c=getCheck(p.id,r.room),required=clientNeedsCheck(p,r),noteNeeded=required&&requiresNote(c.status),noteMissing=noteNeeded&&!String(c.note||'').trim();
  return `<div class="room"><div class="roomno">${esc(r.room)}</div><div>
    <div class="name ${r.color||'none'}">${esc(String(r.name||''))}</div>
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
    <div class="title">Client Record • ${esc(String(r.name||''))}</div>
    <div class="profile-grid">
      <div><b>Address</b><a class="client-address-link" id="clientProfileMap" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.address)}&travelmode=driving&dir_action=navigate">📍 ${esc(p.address)}</a></div>
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
  wrap.querySelector('#clientProfileMap').onclick=e=>{e.preventDefault();openClientAddressGoogleMaps(p.address)};
  wrap.querySelector('#closeClientProfile').onclick=()=>wrap.remove();
  wrap.onclick=e=>{if(e.target===wrap)wrap.remove()};
}

function renderHouse(){
  const p=state.properties.find(x=>x.id===activePropertyId);if(!p){activePropertyId=null;return render()}
  if(screen==='inspections')setModulePrevious(()=>{hideFullNames();activePropertyId=null;inspectionView='run';render()});
  const g=progress(p),view=document.getElementById('view');
  view.innerHTML=`<section class="panel"><div class="househead">
    <div><div class="actions"><button class="btn" id="backHouses">← Previous</button></div><h2 class="title" style="margin-top:10px">${esc(p.address)}</h2><div class="houseflag">${
      g.missing>0
        ? '<span class="required">CHECKS REQUIRED</span>'
        : '<span class="complete">COMPLETE</span>'
    }</div><div class="muted">${p.beds} beds ${p.checkRequired!==false?`• ${g.done}/${g.total} checked`:''}</div></div>
    <div class="codebox"><b>Door code:</b> ${revealCode?esc(p.doorCode||'Not entered'):'••••••'} <button class="btn" id="toggleCode">${revealCode?'Hide':'Reveal'}</button></div>
  </div></section>
  <section class="panel">${p.rooms.map((r,i)=>roomCheckHtml(p,r,i)).join('')}</section>
  <div class="actions"><button class="btn primary" id="doneHouse">Done With House</button><button class="btn" id="editHouse">Edit Property</button></div>`;
  document.getElementById('backHouses').onclick=()=>{hideFullNames();activePropertyId=null;if(screen==='inspections')inspectionView='run';render()};
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
  const ordered=orderedProperties();
  view.innerHTML=`<section class="panel"><div class="titlebar"><div class="title">Properties & Rosters</div>${nameRevealButton('Show Full Names')}</div><div class="muted">${state.settings.houseOrder?.length?'Order is set manually below. Use ↕ Order Houses to change travel order.':'Required houses are listed first; houses on the same street flow by house number.'} Editing, adding, or removing a property requires the app PIN.</div></section>
  <div id="propertyEditor"></div>
  <div class="actions"><button class="btn primary" id="addProperty">+ Add Property</button><button class="btn" id="openHouseOrder">↕ Order Houses</button></div>
  <section class="houserows">${ordered.map(p=>`<div class="houserow ${houseClass(p)}">
      <span class="houserow-color ${propertySituationColor(p)||'none'}"></span>
      <span class="houserow-main"><b>${esc(p.address)}</b><small>${p.beds} beds • ${clients(p).length} clients • ${propertyNeedsChecks(p)?'required checks':'no required checks'}</small></span>
      <span class="houserow-controls"><button class="route-arrow" data-edit="${esc(p.id)}" aria-label="Edit property">✎</button><button class="route-arrow houserow-del" data-delete="${esc(p.id)}" aria-label="Remove property">🗑</button></span>
    </div>`).join('')||'<div class="route-empty">No properties yet. Add one above.</div>'}</section>`;
  const nameToggle=document.getElementById('toggleNames');
  if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderProperties()};
  document.getElementById('openHouseOrder').onclick=()=>{houseOrderReturnTo=()=>{screen='properties';render()};screen='houseOrder';render()};
  view.querySelectorAll('[data-edit]').forEach(b=>b.onclick=async()=>{
    if(!await requestPin('edit this property and roster'))return;
    editPropertyId=b.dataset.edit;renderProperties();setTimeout(()=>document.getElementById('propertyEditor')?.scrollIntoView({behavior:'smooth',block:'start'}),50);
  });
  view.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{
    if(b.disabled)return;b.disabled=true;
    const p=state.properties.find(x=>x.id===b.dataset.delete);if(!p){b.disabled=false;return}
    if(!await requestPin(`remove ${p.address}`)){b.disabled=false;return}
    if(!confirm(`Remove ${p.address}? Assigned clients will become ACTIVE • UNASSIGNED. Their client profiles will be retained.`)){b.disabled=false;return}
    p.rooms.filter(r=>r.type==='client').forEach(r=>archiveClient(r,p.address,r.room));
    state.properties=state.properties.filter(x=>x.id!==p.id);state.route.stops=state.route.stops.filter(s=>!(s.kind==='property'&&s.id===p.id));await saveState();renderProperties();
  });
  document.getElementById('addProperty').onclick=async()=>{
    const btn=document.getElementById('addProperty');
    if(btn.disabled)return;btn.disabled=true;
    if(!await requestPin('add a property')){btn.disabled=false;return}
    const p=normalizeProperty({id:uuid(),address:'New Property',doorCode:'',beds:1,checkRequired:true,houseColor:'',rooms:[{room:'1',type:'open',name:'OPEN',checkRequired:true}]});
    state.properties.push(p);editPropertyId=p.id;renderProperties();setTimeout(()=>document.getElementById('propertyEditor')?.scrollIntoView({behavior:'smooth',block:'start'}),50);
  };
  if(editPropertyId)renderPropertyEditor(state.properties.find(p=>p.id===editPropertyId));
}
let houseOrderReturnTo=()=>{screen='properties';render()};
function renderHouseOrder(){
  const view=document.getElementById('view');
  setModulePrevious(()=>houseOrderReturnTo());
  const ordered=orderedProperties();
  view.innerHTML=`<section class="panel">
    <div class="title">Order Houses</div>
    <div class="muted">${ordered.length?`${ordered.length} house${ordered.length===1?'':'s'}. Use the arrows to set the order you actually travel, or 📍 to open directions to any single house — this order is used everywhere houses are listed: tonight's checks, reports, and lock codes.`:'Add properties first.'}</div>
  </section>
  <section class="panel route-order-panel"><div id="houseOrderList" class="route-order-list"></div></section>
  <div class="actions"><button class="btn primary" id="smartHouseRoute">🧭 Smart Route (Street Order)</button><button class="btn" id="resetHouseOrder">Reset to Automatic Order</button></div>
  <div class="muted" style="margin-top:6px">Smart Route groups houses by street and orders each group by house number. It runs entirely on this phone — it never sends your house list anywhere else. You can still nudge any house up or down afterward.</div>`;
  drawHouseOrder();
  document.getElementById('smartHouseRoute').onclick=async()=>{
    state.settings.houseOrder=smartHouseOrder(state.properties).map(p=>p.id);
    await saveState();drawHouseOrder();
  };
  document.getElementById('resetHouseOrder').onclick=async()=>{
    if(!confirm('Clear the manual order and go back to automatic (required-first, by street/number)?'))return;
    state.settings.houseOrder=[];await saveState();renderHouseOrder();
  };
}
function drawHouseOrder(){
  const box=document.getElementById('houseOrderList');
  const ordered=orderedProperties();
  box.innerHTML=ordered.length?ordered.map((p,i)=>`<div class="route houserow-order">
      <b>${i+1}</b>
      <span><span class="houserow-color ${propertySituationColor(p)||'none'}"></span> ${esc(p.address)}<small class="route-row-sub">${propertyNeedsChecks(p)?'required checks':'no required checks'}</small></span>
      <span class="route-row-controls route-row-controls-3">
        <button class="route-arrow" data-nav="${esc(p.id)}" aria-label="Get directions">📍</button>
        <button class="route-arrow" data-up="${i}" ${i===0?'disabled':''} aria-label="Move house up">↑</button>
        <button class="route-arrow" data-down="${i}" ${i===ordered.length-1?'disabled':''} aria-label="Move house down">↓</button>
      </span>
    </div>`).join(''):'<div class="route-empty">No houses to order yet.</div>';
  box.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{
    const p=state.properties.find(x=>x.id===b.dataset.nav);if(p)openClientAddressGoogleMaps(p.address);
  });
  box.querySelectorAll('[data-up]').forEach(b=>b.onclick=async()=>{moveHouseOrder(+b.dataset.up,-1);await saveState();drawHouseOrder()});
  box.querySelectorAll('[data-down]').forEach(b=>b.onclick=async()=>{moveHouseOrder(+b.dataset.down,1);await saveState();drawHouseOrder()});
}
function roomEditorHtml(p,r,i){
  const c=r.type==='client'?(clientById(r.clientId)||registryClientFromRoom(r,p.address,r.room)):null;
  const assignmentHtml=r.type==='client'
    ? `<div class="housing-assignment-card">
        <div><b>${esc(c?.name||r.name||'Unnamed Client')}</b><div class="meta">ACTIVE • ASSIGNED • ${c?.checkRequired!==false?'Inspection Required':'Inspection Not Required'}</div></div>
        <div class="actions"><button class="btn" data-viewassigned="${i}">View Client</button><button class="btn red" data-unassign="${i}">Unassign</button></div>
      </div>`
    : r.type==='open'
      ? `<div class="housing-assignment-card open-assignment"><div><b>OPEN BED</b><div class="meta">Assign an existing ACTIVE • UNASSIGNED client.</div></div><button class="btn primary" data-assign="${i}">Assign Client</button></div>`
      : `<div class="housing-assignment-card no-bed-assignment"><div><b>NO BED</b><div class="meta">This room is not currently available for assignment.</div></div></div>`;
  return `<div class="roomedit housing-room-row" data-row="${i}">
    <div class="field"><label>Room</label><input data-f="room" value="${esc(r.room)}" aria-label="Room"></div>
    <div class="field"><label>Bed Status</label><select data-f="bedstatus">
      ${r.type==='client'?`<option value="client" selected>Client Assigned</option>`:''}
      <option value="open" ${r.type==='open'?'selected':''}>Open</option>
      <option value="nobed" ${r.type==='nobed'?'selected':''}>No Bed</option>
    </select></div>
    <div class="housing-assignment-wide">${assignmentHtml}</div>
    <button class="btn red" data-remove="${i}">Remove Bed</button>
  </div>`;
}
function assignClientPicker(p,r){
  const wrap=document.createElement('div');wrap.className='pin-overlay';
  let q='';
  const searchKey=s=>String(s||'').replace(/[^a-z0-9]/gi,'').toLowerCase();
  const draw=()=>{
    const needle=searchKey(q);
    const candidates=needle.length<3?[]:activeRegistryClients().filter(c=>{
      const full=searchKey(c.name);
      return full.includes(needle)||clientSearchKey(c.name).includes(needle);
    });
    wrap.innerHTML=`<div class="pin-dialog client-assignment-dialog">
      <div class="title">Assign Client • ${esc(p.address)} • Room ${esc(r.room)}</div>
      <div class="muted">Type any 3 letters. Unassigned clients can be placed here. Housed clients can be moved here without creating a duplicate record.</div>
      <div class="searchbar"><input id="housingClientSearch" autocomplete="off" placeholder="Type any 3 letters" value="${esc(q)}"><button class="btn" id="housingAssignCancel">Cancel</button></div>
      <div class="registry-list housing-client-results">${
        needle.length<3
          ? '<div class="muted">Enter at least 3 letters.</div>'
          : candidates.length
            ? candidates.map((c,i)=>{
                const a=clientAssignment(c.clientId);
                const housing=a?`CURRENTLY • ${a.property.address} • Room ${a.room.room}`:'ACTIVE • UNASSIGNED';
                const action=a?'MOVE HERE':'ASSIGN HERE';
                return `<button class="housing-client-choice" data-pickclient="${i}"><b>${esc(c.name)}</b><span>${esc(housing)}</span><small>${c.checkRequired!==false?'Inspection REQUIRED':'Inspection NOT REQUIRED'} • ${action}</small></button>`;
              }).join('')
            : '<div class="muted">No active client matches those letters.</div>'
      }</div>
    </div>`;
    const input=wrap.querySelector('#housingClientSearch');
    input.oninput=()=>{q=input.value;draw();const again=wrap.querySelector('#housingClientSearch');again?.focus();again?.setSelectionRange(again.value.length,again.value.length)};
    input.focus();
    wrap.querySelector('#housingAssignCancel').onclick=()=>wrap.remove();
    wrap.querySelectorAll('[data-pickclient]').forEach(b=>b.onclick=async()=>{
      const c=candidates[+b.dataset.pickclient];if(!c)return;
      const current=clientAssignment(c.clientId);
      if(current){
        const same=current.property.id===p.id&&String(current.room.room)===String(r.room);
        if(same){alert('That client is already assigned to this room.');return}
        if(!confirm(`Move ${c.name} from ${current.property.address} • Room ${current.room.room} to ${p.address} • Room ${r.room}?`))return;
        unassignRoomClient(current.property,current.room);
      }
      syncRoomFromClient(r,c);
      c.status='active';c.inactiveAt='';c.updatedAt=new Date().toISOString();
      state.inactiveClients=inactiveRegistryClients().map((x,i)=>normalizeInactiveClient(x,i));
      await saveState();wrap.remove();renderPropertyEditor(p);
    });
  };
  document.body.appendChild(wrap);draw();
}
function renderPropertyEditor(p){
  if(!p)return;
  const e=document.getElementById('propertyEditor');
  e.innerHTML=`<section class="panel"><div class="title">Editing ${esc(p.address)}</div>
    <div class="formgrid">
      <div class="field"><label>Address</label><input id="propAddress" value="${esc(p.address)}"></div>
      <div class="field"><label>Door code</label><input id="propCode" value="${esc(p.doorCode)}"><div class="field-help">${p.doorCodeUpdatedAt?`Last changed ${esc(new Date(p.doorCodeUpdatedAt).toLocaleString())}`:'No change date recorded yet.'}</div></div>
      <div class="field"><label>Number of beds</label><input id="propBeds" type="number" min="1" max="60" value="${p.beds}"></div>
      <div class="field"><label>Property situation</label><select id="propSituation">${Object.entries(PROPERTY_SITUATIONS).map(([k,v])=>`<option value="${k}" ${p.propertyStatus===k?'selected':''}>${esc(v.label)}</option>`).join('')}</select><div class="field-help">Color is assigned automatically from the situation.</div></div>
      <label class="checkboxline"><input id="propRequired" type="checkbox" ${p.checkRequired!==false?'checked':''}> House participates in checks</label>
    </div>
    <div class="notice"><b>Housing rule:</b> clients are created and maintained in CLIENT • SECURE. This screen only assigns an existing client to a room, unassigns them, or changes the bed status.</div>
    <h3>Beds / Rooms</h3>${p.rooms.map((r,i)=>roomEditorHtml(p,r,i)).join('')}
    <div class="actions"><button class="btn" id="addBed">+ Bed</button><button class="btn primary" id="saveProperty">Save Property</button><button class="btn" id="cancelProperty">Cancel</button></div>
  </section>`;
  document.getElementById('propBeds').onchange=async()=>{
    const input=document.getElementById('propBeds'),n=Math.max(1,Math.min(60,+input.value||1));
    if(n<p.rooms.length){
      const occupied=p.rooms.slice(n).filter(r=>r.type==='client');
      if(occupied.length&&!confirm(`Reducing capacity will UNASSIGN: ${occupied.map(r=>displayClientName(r.name)).join(', ')}. Their client profiles will remain ACTIVE. Continue?`)){input.value=p.rooms.length;return}
      occupied.forEach(r=>unassignRoomClient(p,r));
      p.rooms=p.rooms.slice(0,n);
    }else while(p.rooms.length<n)p.rooms.push(normalizeRoom({room:p.rooms.length+1,type:'open',name:'OPEN',checkRequired:false},p.rooms.length));
    p.beds=p.rooms.length;await saveState();renderPropertyEditor(p);
  };
  document.getElementById('addBed').onclick=async()=>{
    p.rooms.push(normalizeRoom({room:p.rooms.length+1,type:'open',name:'OPEN',checkRequired:false},p.rooms.length));
    p.beds=p.rooms.length;await saveState();renderPropertyEditor(p);
  };
  e.querySelectorAll('[data-assign]').forEach(b=>b.onclick=()=>{const r=p.rooms[+b.dataset.assign];if(r?.type==='open')assignClientPicker(p,r)});
  e.querySelectorAll('[data-viewassigned]').forEach(b=>b.onclick=()=>{const r=p.rooms[+b.dataset.viewassigned],c=r?clientById(r.clientId):null;if(c)showSecureClientProfile(c)});
  e.querySelectorAll('[data-unassign]').forEach(b=>b.onclick=async()=>{
    const r=p.rooms[+b.dataset.unassign];if(!r||r.type!=='client')return;
    if(!confirm(`Unassign ${displayClientName(r.name)} from ${p.address} Room ${r.room}? Their client profile remains ACTIVE.`))return;
    unassignRoomClient(p,r);state.inactiveClients=inactiveRegistryClients().map((x,i)=>normalizeInactiveClient(x,i));
    await saveState();renderPropertyEditor(p);
  });
  e.querySelectorAll('[data-f="bedstatus"]').forEach(sel=>sel.onchange=async()=>{
    const row=sel.closest('[data-row]'),r=p.rooms[+row.dataset.row],next=sel.value;
    if(r.type==='client'&&next!=='client'){
      if(!confirm(`Unassign ${displayClientName(r.name)} and mark this room ${next==='open'?'OPEN':'NO BED'}?`)){renderPropertyEditor(p);return}
      unassignRoomClient(p,r);
      if(next==='nobed')Object.assign(r,{type:'nobed',name:'NO BED',checkRequired:false});
    }else if(r.type!=='client'){
      Object.assign(r,{type:next,name:next==='open'?'OPEN':'NO BED',phone:'',color:'',note:'',checkRequired:false,clientId:'',workSchedule:'',schoolSchedule:'',importantInfo:''});
    }
    await saveState();renderPropertyEditor(p);
  });
  e.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{
    const r=p.rooms[+b.dataset.remove];
    if(r.type==='client'&&!confirm(`Remove this bed/room row and UNASSIGN ${displayClientName(r.name)}? The client profile will remain ACTIVE.`))return;
    if(r.type==='client')unassignRoomClient(p,r);
    p.rooms.splice(+b.dataset.remove,1);p.beds=p.rooms.length;await saveState();renderPropertyEditor(p);
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
      const r=p.rooms[+row.dataset.row];
      r.room=row.querySelector('[data-f="room"]').value.trim()||String(+row.dataset.row+1);
      if(r.type==='client'){
        const c=clientById(r.clientId);if(c)syncRoomFromClient(r,c);
      }
    });
    p.beds=p.rooms.length;await saveState();editPropertyId=null;renderProperties();
  };
}

/* ---------- Dedicated Client Profiles / Secure Client Registry ---------- */
function allClientProfileRecords(){
  return (state.clients||[]).map(c=>{
    const a=clientAssignment(c.clientId);
    return {kind:c.status==='inactive'?'inactive':(a?'active':'unassigned'),property:a?.property||null,room:a?.room||null,record:c};
  });
}
function profileSearchMatches(item,q){
  const s=String(q||'').replace(/[^a-z0-9]/gi,'').toLowerCase();
  if(!s)return true;
  const key=clientSearchKey(item.record.name);
  return key.includes(s)||s.includes(key)||String(item.record.phone||'').replace(/\D/g,'').includes(s);
}
function syncAssignedRoomForClient(c){
  const a=clientAssignment(c.clientId);
  if(a)syncRoomFromClient(a.room,c);
}
function clientProfileFormHtml(c={},mode='edit'){
  return `<div class="formgrid profile-edit-grid">
    <div class="field"><label>Full Client Name</label><input id="cpName" value="${esc(c.name||'')}" placeholder="Full legal / roster name"></div>
    <div class="field"><label>Cell Phone</label><input id="cpPhone" type="tel" value="${esc(c.phone||'')}"></div>
    <div class="field"><label>House Inspection</label><select id="cpRequired"><option value="required" ${c.checkRequired!==false?'selected':''}>Inspection REQUIRED</option><option value="notrequired" ${c.checkRequired===false?'selected':''}>Inspection NOT REQUIRED</option></select></div>
    <div class="field profile-wide"><label>Work Schedule</label><textarea id="cpWork" placeholder="Work days / hours">${esc(c.workSchedule||'')}</textarea></div>
    <div class="field profile-wide"><label>School Schedule</label><textarea id="cpSchool" placeholder="School days / hours / campus details">${esc(c.schoolSchedule||'')}</textarea></div>
    <div class="field profile-wide"><label>Important Information</label><textarea id="cpInfo" placeholder="Important information for transportation / house checks">${esc(c.importantInfo||'')}</textarea></div>
    <div class="field profile-wide"><label>Profile Note</label><textarea id="cpNote" placeholder="Permanent profile note">${esc(c.note||'')}</textarea></div>
  </div>`;
}
function readClientProfileForm(wrap,c){
  c.name=wrap.querySelector('#cpName').value.trim()||'Unnamed Client';
  c.phone=wrap.querySelector('#cpPhone').value.trim();
  c.checkRequired=wrap.querySelector('#cpRequired').value==='required';
  c.workSchedule=wrap.querySelector('#cpWork').value.trim();
  c.schoolSchedule=wrap.querySelector('#cpSchool').value.trim();
  c.importantInfo=wrap.querySelector('#cpInfo').value.trim();
  c.note=wrap.querySelector('#cpNote').value.trim();
  c.updatedAt=new Date().toISOString();
  return c;
}
async function createNewClient(){
  if(!await requestPin('create a new client profile'))return;
  const wrap=document.createElement('div');wrap.className='pin-overlay';
  const c=normalizeRegistryClient({clientId:uuid(),status:'active',checkRequired:true,createdAt:new Date().toISOString()},state.clients.length,'active');
  wrap.innerHTML=`<div class="pin-dialog client-edit-dialog">
    <div class="title">New Client</div>
    <div class="muted">Create the person here first. Housing assignment comes later from PROPERTIES.</div>
    ${clientProfileFormHtml(c,'new')}
    <div class="actions"><button class="btn" id="cancelClientCreate">Cancel</button><button class="btn primary" id="saveClientCreate">Create Client • Unassigned</button></div>
  </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('#cancelClientCreate').onclick=()=>wrap.remove();
  wrap.querySelector('#saveClientCreate').onclick=async()=>{
    readClientProfileForm(wrap,c);
    if(!c.name||c.name==='Unnamed Client'){alert('Enter the client name.');return}
    c.status='active';c.inactiveAt='';upsertRegistryClient(c);
    state.inactiveClients=inactiveRegistryClients().map((x,i)=>normalizeInactiveClient(x,i));
    await saveState();wrap.remove();const kp=clientKeyParts(c.name);clientSearchFirst=kp.first;clientSearchLast=kp.last;renderClientSearch();
  };
}
function showSecureClientProfile(c){
  const a=clientAssignment(c.clientId),inactive=c.status==='inactive';
  const wrap=document.createElement('div');wrap.className='pin-overlay';
  const residence=inactive
    ? `Last: ${c.previousAddress||'Unknown'}${c.previousRoom?` • Room ${c.previousRoom}`:''}`
    : a?`${a.property.address} • Room ${a.room.room}`:'ACTIVE • UNASSIGNED';
  wrap.innerHTML=`<div class="pin-dialog client-profile-dialog">
    <div class="title">Client Record • ${esc(String(c.name||''))}</div>
    <div class="profile-grid">
      <div><b>Status</b><span class="${inactive?'profile-notrequired':'profile-required'}">${inactive?'INACTIVE':(a?'ACTIVE • HOUSED':'ACTIVE • UNASSIGNED')}</span></div>
      <div><b>Housing</b>${a?`<a class="client-address-link" id="secureClientMap" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a.property.address)}&travelmode=driving&dir_action=navigate">📍 ${esc(a.property.address)} • Room ${esc(a.room.room)}</a>`:`<span>${esc(residence)}</span>`}</div>
      <div><b>Phone</b><span>${c.phone?esc(fmtPhone(c.phone)):'Not entered'}</span></div>
      <div><b>House Inspection</b><span class="${c.checkRequired!==false?'profile-required':'profile-notrequired'}">${c.checkRequired!==false?'REQUIRED':'NOT REQUIRED • DO NOT DISTURB'}</span></div>
      <div class="profile-wide"><b>Work Schedule</b><span>${esc(c.workSchedule||'No work schedule entered.')}</span></div>
      <div class="profile-wide"><b>School Schedule</b><span>${esc(c.schoolSchedule||'No school schedule entered.')}</span></div>
      <div class="profile-wide"><b>Important Information</b><span>${esc(c.importantInfo||'No additional important information entered.')}</span></div>
      <div class="profile-wide"><b>Profile Note</b><span>${esc(c.note||'No profile note entered.')}</span></div>
    </div>
    <div class="actions">
      <button class="btn" id="closeSecureClient">Close</button>
      <button class="btn primary" id="editSecureClient">Edit Client</button>
      ${inactive?`<button class="btn primary" id="reactivateSecureClient">Reactivate • Unassigned</button>`:`<button class="btn red" id="deactivateSecureClient">Deactivate Client</button>`}
    </div>
  </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('#secureClientMap')?.addEventListener('click',e=>{e.preventDefault();openClientAddressGoogleMaps(a.property.address)});
  wrap.querySelector('#closeSecureClient').onclick=()=>wrap.remove();
  wrap.querySelector('#editSecureClient').onclick=()=>{wrap.remove();editClientProfile({record:c})};
  if(inactive){
    wrap.querySelector('#reactivateSecureClient').onclick=async()=>{
      const btn=wrap.querySelector('#reactivateSecureClient');
      if(btn.disabled)return;btn.disabled=true;
      if(!await requestPin('reactivate this client')){btn.disabled=false;return}
      c.status='active';c.inactiveAt='';c.updatedAt=new Date().toISOString();
      state.inactiveClients=inactiveRegistryClients().map((x,i)=>normalizeInactiveClient(x,i));
      await saveState();wrap.remove();renderClientSearch();
    };
  }else{
    wrap.querySelector('#deactivateSecureClient').onclick=async()=>{
      const btn=wrap.querySelector('#deactivateSecureClient');
      if(btn.disabled)return;btn.disabled=true;
      if(!await requestPin('deactivate this client')){btn.disabled=false;return}
      if(!confirm(`Deactivate ${displayClientName(c.name)}?${a?' Their current room will become OPEN.':''}`)){btn.disabled=false;return}
      const current=clientAssignment(c.clientId);
      if(current)unassignRoomClient(current.property,current.room);
      c.status='inactive';c.inactiveAt=new Date().toISOString();c.updatedAt=new Date().toISOString();
      state.inactiveClients=inactiveRegistryClients().map((x,i)=>normalizeInactiveClient(x,i));
      await saveState();wrap.remove();renderClientSearch();
    };
  }
  wrap.onclick=e=>{if(e.target===wrap)wrap.remove()};
}
async function editClientProfile(item){
  if(!await requestPin('edit this client profile'))return;
  const c=item.record;
  const a=clientAssignment(c.clientId);
  const where=c.status==='inactive'
    ? `INACTIVE • Last: ${c.previousAddress||'Unknown'}${c.previousRoom?' • Room '+c.previousRoom:''}`
    : a?`${a.property.address} • Room ${a.room.room}`:'ACTIVE • UNASSIGNED';
  const wrap=document.createElement('div');wrap.className='pin-overlay';
  wrap.innerHTML=`<div class="pin-dialog client-edit-dialog">
    <div class="title">Edit Client Profile</div><div class="muted">${esc(where)}</div>
    ${clientProfileFormHtml(c)}
    <div class="actions"><button class="btn" id="cancelClientEdit">Cancel</button><button class="btn primary" id="saveClientEdit">Save Client Profile</button></div>
  </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('#cancelClientEdit').onclick=()=>wrap.remove();
  wrap.querySelector('#saveClientEdit').onclick=async()=>{
    readClientProfileForm(wrap,c);
    syncAssignedRoomForClient(c);
    if(a&&!c.checkRequired)delete state.currentRun.checks[checkKey(a.property.id,a.room.room)];
    state.inactiveClients=inactiveRegistryClients().map((x,i)=>normalizeInactiveClient(x,i));
    await saveState();wrap.remove();renderClientSearch();
  };
}
/* ---------- 3x3 Client Search / Unified Client Hub ---------- */
function clientHubRecords(){return allClientProfileRecords()}
function clientKeyParts(name){
  const parts=partsOfName(name);
  const first=(parts[0]||'').slice(0,3).replace(/[^a-z0-9]/gi,'').toLowerCase();
  const last=(parts.length>1?parts[parts.length-1]:'').slice(0,3).replace(/[^a-z0-9]/gi,'').toLowerCase();
  return {first,last};
}
function clientHubMatches3(item,qFirst,qLast){
  const f=String(qFirst||'').replace(/[^a-z0-9]/gi,'').toLowerCase();
  const l=String(qLast||'').replace(/[^a-z0-9]/gi,'').toLowerCase();
  if(f.length<3&&l.length<3)return false;
  const key=clientKeyParts(item.record.name);
  if(f.length===3&&l.length===3)return key.first===f&&key.last===l;
  if(f.length===3)return key.first===f;
  return key.last===l;
}
function renderClientSearch(){
  const view=document.getElementById('view');
  setModulePrevious(goHome);
  const fLen=String(clientSearchFirst||'').replace(/[^a-z0-9]/gi,'').length;
  const lLen=String(clientSearchLast||'').replace(/[^a-z0-9]/gi,'').length;
  const ready=fLen===3||lLen===3;
  const results=ready?clientHubRecords().filter(x=>clientHubMatches3(x,clientSearchFirst,clientSearchLast)):[];

  view.innerHTML=`<section class="panel">
    <div class="titlebar">
      <div>
        <div class="title">CLIENT • SECURE</div>
        <div class="muted">Create each client once. Search 3+3, then assign housing separately from PROPERTIES.</div>
      </div>
      ${nameRevealButton()}
    </div>
    <div class="actions client-registry-actions"><button class="btn primary" id="newClient">+ New Client</button></div>
    <div class="searchbar-33">
      <div class="search33-box">
        <label>First 3</label>
        <input id="clientSearchF" autocomplete="off" maxlength="3" inputmode="text" placeholder="ABC" value="${esc(clientSearchFirst)}">
      </div>
      <div class="search33-box">
        <label>Last 3</label>
        <input id="clientSearchL" autocomplete="off" maxlength="3" inputmode="text" placeholder="XYZ" value="${esc(clientSearchLast)}">
      </div>
      <button class="btn" id="clearSearch">Clear</button>
    </div>
    <div class="privacy-hint">ACTIVE • UNASSIGNED clients are ready to be placed into an OPEN room from the Housing / Properties module.</div>
  </section>

  <section class="search-results">${
    !ready
      ? '<div class="panel"><div class="muted">Enter 3 letters in First 3 or Last 3 to search.</div></div>'
      : results.length
        ? results.map((x,i)=>{
            const a=clientAssignment(x.record.clientId);
            const location=x.kind==='inactive'
              ? `INACTIVE • Last: ${esc(x.record.previousAddress||'Unknown')}${x.record.previousRoom?` • Room ${esc(x.record.previousRoom)}`:''}`
              : a
                ? `<a class="client-address-link" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a.property.address)}&travelmode=driving&dir_action=navigate" data-clientnav="${i}">📍 ${esc(a.property.address)}</a><span> • Room ${esc(a.room.room)}</span>`
                : `<span class="badge">ACTIVE • UNASSIGNED</span>`;
            return `<article class="card search-result client-search-card">
              <div class="client-search-main">
                <div class="name ${x.record.color||'none'}">${esc(displayClientName(x.record.name))}</div>
                <div class="meta client-location-line">${location}</div>
                <div class="client-requirement ${x.record.checkRequired!==false?'required-client':'notrequired-client'}">${x.record.checkRequired!==false?'INSPECTION REQUIRED':'NOT REQUIRED • DO NOT DISTURB'}</div>
              </div>
              <div class="actions client-search-actions">
                <button class="btn" data-viewclient="${i}">View Client</button>
                <button class="btn primary" data-editclient="${i}">Edit Client</button>
              </div>
            </article>`;
          }).join('')
        : '<div class="panel"><div class="muted">No matching client found.</div></div>'
  }</section>`;

  document.getElementById('newClient').onclick=createNewClient;
  const fBox=document.getElementById('clientSearchF');
  const lBox=document.getElementById('clientSearchL');
  fBox.oninput=()=>{
    const clean=fBox.value.replace(/[^a-z0-9]/gi,'').slice(0,3).toUpperCase();
    clientSearchFirst=clean;
    const advance=clean.length===3;
    renderClientSearch();
    const again=document.getElementById(advance?'clientSearchL':'clientSearchF');
    again?.focus();
    if(!advance)again?.setSelectionRange(again.value.length,again.value.length);
  };
  lBox.oninput=()=>{
    const clean=lBox.value.replace(/[^a-z0-9]/gi,'').slice(0,3).toUpperCase();
    clientSearchLast=clean;
    renderClientSearch();
    const again=document.getElementById('clientSearchL');
    again?.focus();
    again?.setSelectionRange(again.value.length,again.value.length);
  };
  document.getElementById('clearSearch').onclick=()=>{clientSearchFirst='';clientSearchLast='';renderClientSearch();document.getElementById('clientSearchF')?.focus()};
  const nameToggle=document.getElementById('toggleNames');
  if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderClientSearch()};
  view.querySelectorAll('[data-viewclient]').forEach(b=>b.onclick=()=>{
    const x=results[+b.dataset.viewclient];if(x)showSecureClientProfile(x.record);
  });
  view.querySelectorAll('[data-editclient]').forEach(b=>b.onclick=()=>{
    const x=results[+b.dataset.editclient];if(x)editClientProfile(x);
  });
  view.querySelectorAll('[data-clientnav]').forEach(a=>a.onclick=e=>{
    e.preventDefault();
    const x=results[+a.dataset.clientnav],assignment=x?clientAssignment(x.record.clientId):null;
    if(assignment?.property?.address)openClientAddressGoogleMaps(assignment.property.address);
  });
}
/* ---------- Locations + Route ---------- */
function routeLocationCategory(l){return l?.category==='business'?'business':'saved'}
function isClientHomeLocation(l){return String(l?.type||'').trim().toLowerCase()==='client housing'}
function locationById(id){return state.locations.find(l=>l.id===id)||null}
function transportationLocation(){
  const items=state.locations.filter(l=>l.address);
  return items.find(l=>l.isBase&&/transport/i.test(l.name||''))||items.find(l=>/transport/i.test(l.name||''))||items.find(l=>l.isBase)||null;
}
function orderedRouteLocations(){
  const base=transportationLocation();
  return [...state.locations].filter(l=>l.address).sort((a,b)=>{
    if(base&&a.id===base.id)return-1;if(base&&b.id===base.id)return 1;
    const ac=routeLocationCategory(a)==='business'?0:1,bc=routeLocationCategory(b)==='business'?0:1;
    return ac-bc||String(a.name).localeCompare(String(b.name));
  });
}
function currentStartLocation(){return state.route.startMode==='location'?locationById(state.route.startLocationId):null}
function routeStartLabel(){const l=currentStartLocation();return l?`${l.name} • ${l.address}`:'Current Position'}
function makeRouteStop(kind,obj){
  if(kind==='property')return {kind:'property',id:obj.id};
  if(kind==='location')return {kind:'location',id:obj.id};
  return {kind:'custom',id:obj.id||uuid(),name:obj.name||'Inserted Address',address:obj.address||''};
}
function stopObj(s){
  if(s.kind==='property')return state.properties.find(p=>p.id===s.id);
  if(s.kind==='location')return state.locations.find(l=>l.id===s.id);
  if(s.kind==='custom')return s;
  return null;
}
function stopLabel(s){
  const o=stopObj(s);if(!o)return'Missing stop';
  if(s.kind==='property')return o.address;
  if(s.kind==='custom')return o.name&&o.name!=='Inserted Address'?`${o.name} • ${o.address}`:o.address;
  return `${o.name} • ${o.address}`;
}
function stopAddress(s){return stopObj(s)?.address||''}
function validRouteStops(list=state.route.stops){return (list||[]).filter(s=>stopAddress(s))}
function routeStopExists(kind,id){return state.route.stops.some(s=>s.kind===kind&&s.id===id)}
function resetRouteProgress(){state.route.runIndex=0;state.route.runStartAddress='';state.route.runStartLabel=''}
function routeCoords(s){
  const o=stopObj(s),lat=Number(o?.lat),lon=Number(o?.lon??o?.lng??o?.long);
  return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null;
}
function dist2(a,b){const dx=a.lat-b.lat,dy=(a.lon-b.lon)*Math.cos((a.lat+b.lat)*Math.PI/360);return dx*dx+dy*dy}
function smartRouteStops(){
  const source=validRouteStops();if(source.length<2)return source;
  const withCoords=source.every(s=>routeCoords(s));
  let start=currentStartLocation();
  const startCoords=start?routeCoords({kind:'location',id:start.id}):null;
  if(withCoords&&startCoords){
    const remaining=[...source],out=[];let cur=startCoords;
    while(remaining.length){let best=0,bestD=Infinity;for(let i=0;i<remaining.length;i++){const d=dist2(cur,routeCoords(remaining[i]));if(d<bestD){best=i;bestD=d}}const next=remaining.splice(best,1)[0];out.push(next);cur=routeCoords(next)}
    return out;
  }
  // Offline fallback: preserve the driver's street-group order, but clean up house numbers within each street.
  const groups=[],byStreet=new Map();
  for(const stop of source){const a=addressParts(stopAddress(stop)),key=a.street||stopAddress(stop).toLowerCase();if(!byStreet.has(key)){const g={key,items:[]};byStreet.set(key,g);groups.push(g)}byStreet.get(key).items.push(stop)}
  for(const g of groups)g.items.sort((a,b)=>addressParts(stopAddress(a)).number-addressParts(stopAddress(b)).number);
  return groups.flatMap(g=>g.items);
}
function setRouteView(view){routePlannerView=view;routePickerKind='';routePickerDraft=null;routeInlineMode='';routeStartPickerOpen=false;renderRoute()}
function routeHasWork(){return validRouteStops().length>0}
function routeStartLocations(){
  return orderedRouteLocations().filter(l=>{
    const name=String(l?.name||'').trim().toLowerCase();
    return !!l?.isBase || name==='the complex' || name.includes('main business office');
  });
}

function renderRouteMenu(){
  const view=document.getElementById('view'),count=validRouteStops().length;
  setModulePrevious(goHome,'Previous');
  view.innerHTML=`<section class="panel route-welcome"><div class="title">Route Planner</div><div class="muted">Build the route here. When you start it, the app keeps the stops in order and closes the loop back to your starting location.</div></section>
  <section class="route-hub route-hub-simple">
    <button class="route-hub-button primary" id="routePlan"><span>🧭</span><span><b>PLAN ROUTE</b><small>${count?`${count} stop${count===1?'':'s'} currently in the planner`:'Build or continue a route'}</small></span></button>
    <button class="route-hub-button" id="routeLocations"><span>📍</span><span><b>LOCATIONS</b><small>Business, pickup and drop-off destinations</small></span></button>
    <button class="route-hub-button" id="routeSavedRoutes"><span>🗂️</span><span><b>SAVED ROUTES</b><small>Load or manage route configurations</small></span></button>
  </section>`;
  document.getElementById('routePlan').onclick=()=>setRouteView('create');
  document.getElementById('routeLocations').onclick=()=>setRouteView('locations');
  document.getElementById('routeSavedRoutes').onclick=()=>setRouteView('savedroutes');
}

function renderRouteLocations(){
  const view=document.getElementById('view'),business=state.locations.filter(l=>routeLocationCategory(l)==='business'),saved=state.locations.filter(l=>routeLocationCategory(l)==='saved');
  setModulePrevious(()=>setRouteView('menu'),'Route Planner');
  const cards=(items)=>items.map(l=>`<article class="card route-location-card"><div class="route-location-copy"><h3>${esc(l.name)}</h3><div class="meta">${esc(l.address||'Address not entered')}</div>${l.notes?`<div class="muted">${esc(l.notes)}</div>`:''}</div><div class="actions"><button class="btn primary" data-addloc="${esc(l.id)}">Add to Route</button><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.address)}">Map</a><button class="btn" data-editloc="${esc(l.id)}">Edit</button><button class="btn red" data-delloc="${esc(l.id)}">Remove</button></div></article>`).join('')||'<div class="muted">None saved yet.</div>';
  view.innerHTML=`<section class="panel"><div class="route-order-head"><div><div class="title">Locations</div><div class="muted">Route-only destinations stay separate from house-check properties.</div></div><button class="btn primary" id="addRouteLocation">+ Add Location</button></div></section>
  <section class="panel"><div class="title route-section-title">Business & Shawnee Locations</div><div class="history-list">${cards(business)}</div></section>
  <section class="panel"><div class="title route-section-title">Other Saved Locations</div><div class="history-list">${cards(saved)}</div></section>
  <div id="locationEditor"></div>`;
  view.querySelectorAll('[data-addloc]').forEach(b=>b.onclick=async()=>{const l=locationById(b.dataset.addloc);if(!l)return;if(!routeStopExists('location',l.id)){state.route.stops.push(makeRouteStop('location',l));resetRouteProgress();await saveState()}alert('Added to the current route.');});
  view.querySelectorAll('[data-editloc]').forEach(b=>b.onclick=()=>{editLocationId=b.dataset.editloc;renderRouteLocations()});
  view.querySelectorAll('[data-delloc]').forEach(b=>b.onclick=async()=>{const id=b.dataset.delloc;if(!confirm('Remove this route location?'))return;state.locations=state.locations.filter(l=>l.id!==id);state.route.stops=state.route.stops.filter(s=>!(s.kind==='location'&&s.id===id));if(state.route.startLocationId===id){state.route.startMode='current';state.route.startLocationId=''}resetRouteProgress();await saveState();renderRouteLocations()});
  document.getElementById('addRouteLocation').onclick=()=>{const l={id:uuid(),name:'New Location',address:'',type:'Other',phone:'',notes:'',isBase:false,category:'saved'};state.locations.push(l);editLocationId=l.id;renderRouteLocations()};
  if(editLocationId)renderRouteLocationEditor(locationById(editLocationId));
}
function renderRouteLocationEditor(l){
  if(!l)return;const e=document.getElementById('locationEditor');
  const typeValue=['Client Housing','Office','Pickup / Drop-off','Other'].includes(l.type)?l.type:'Other';
  e.innerHTML=`<section class="panel route-editor"><div class="title">Edit Location</div><div class="formgrid"><div class="field"><label>Name</label><input id="locName" value="${esc(l.name)}"></div><div class="field"><label>Category</label><select id="locCategory"><option value="business" ${routeLocationCategory(l)==='business'?'selected':''}>Business / Shawnee</option><option value="saved" ${routeLocationCategory(l)==='saved'?'selected':''}>Other Saved Location</option></select></div><div class="field"><label>Location Type</label><select id="locType"><option value="Client Housing" ${typeValue==='Client Housing'?'selected':''}>Client Housing</option><option value="Office" ${typeValue==='Office'?'selected':''}>Office</option><option value="Pickup / Drop-off" ${typeValue==='Pickup / Drop-off'?'selected':''}>Pickup / Drop-off</option><option value="Other" ${typeValue==='Other'?'selected':''}>Other</option></select></div><div class="field route-address-field"><label>Address</label><input id="locAddress" value="${esc(l.address)}"></div></div><div class="muted" style="margin-top:8px">Locations marked <b>Client Housing</b> also appear in Route Planner → Client Homes, without becoming inspection properties.</div><div class="field" style="margin-top:8px"><label>Notes</label><textarea id="locNotes">${esc(l.notes||'')}</textarea></div><div class="actions"><button class="btn" id="cancelLocationEdit">Cancel</button><button class="btn primary" id="saveLocation">Save Location</button></div></section>`;
  document.getElementById('cancelLocationEdit').onclick=()=>{if(!l.address&&l.name==='New Location')state.locations=state.locations.filter(x=>x.id!==l.id);editLocationId=null;renderRouteLocations()};
  document.getElementById('saveLocation').onclick=async()=>{l.name=document.getElementById('locName').value.trim()||'Unnamed Location';l.address=document.getElementById('locAddress').value.trim();if(!l.address){alert('Enter the location address.');return}l.notes=document.getElementById('locNotes').value.trim();l.category=document.getElementById('locCategory').value==='business'?'business':'saved';l.type=document.getElementById('locType').value||'Other';await saveState();editLocationId=null;renderRouteLocations()};
}

function renderRoutePicker(kind){
  const view=document.getElementById('view'),isClients=kind==='clients';
  let rows=[];
  if(isClients){
    rows=[
      ...orderedProperties().map(o=>({kind:'property',id:o.id,obj:o,title:o.address,subtitle:propertyNeedsChecks(o)?'House-check property':'House-check property • no required checks'})),
      ...orderedRouteLocations().filter(isClientHomeLocation).map(o=>({kind:'location',id:o.id,obj:o,title:o.name||o.address,subtitle:`${o.address} • Client housing • no house check`}))
    ];
  }else{
    rows=orderedRouteLocations().map(o=>({kind:'location',id:o.id,obj:o,title:o.name,subtitle:o.address}));
  }
  const currentKeys=new Set(state.route.stops.map(s=>`${s.kind}::${s.id}`));
  setModulePrevious(()=>{routePickerKind='';routePickerDraft=null;renderRouteCreate()},'Plan Route');
  view.innerHTML=`<section class="panel"><div class="title">${isClients?'Client Homes':'Locations'}</div><div class="muted">${isClients?'Choose house-check homes and permanent client housing. Non-inspection housing appears here for routing only and never becomes an inspection property.':'Choose business, pickup, drop-off, or other saved destinations.'}</div></section>
  <section class="panel"><div class="actions route-select-actions"><button class="btn primary" id="selectAllRoute">Select All</button><button class="btn" id="clearRouteSelection">Clear Selection</button></div><div class="route-picker-list">${rows.map(r=>`<label class="route-choice"><input type="checkbox" data-pick-kind="${esc(r.kind)}" data-pick-id="${esc(r.id)}" ${currentKeys.has(`${r.kind}::${r.id}`)?'checked':''}><span><b>${esc(r.title)}</b><small>${esc(r.subtitle)}</small></span></label>`).join('')||'<div class="muted">No addresses available.</div>'}</div><div class="route-picker-sticky"><button class="btn" id="routePickerCancel">Cancel</button><button class="btn primary" id="routePickerApply">Apply to Route</button></div></section>`;
  const boxes=[...view.querySelectorAll('[data-pick-id]')];
  document.getElementById('selectAllRoute').onclick=()=>boxes.forEach(c=>c.checked=true);
  document.getElementById('clearRouteSelection').onclick=()=>boxes.forEach(c=>c.checked=false);
  document.getElementById('routePickerCancel').onclick=()=>{routePickerKind='';renderRouteCreate()};
  document.getElementById('routePickerApply').onclick=async()=>{
    const selected=new Set(boxes.filter(c=>c.checked).map(c=>`${c.dataset.pickKind}::${c.dataset.pickId}`));
    let kept;
    if(isClients){
      kept=state.route.stops.filter(s=>{
        if(s.kind==='property')return selected.has(`property::${s.id}`);
        if(s.kind==='location'&&isClientHomeLocation(locationById(s.id)))return selected.has(`location::${s.id}`);
        return true;
      });
    }else{
      kept=state.route.stops.filter(s=>s.kind!=='location'||selected.has(`location::${s.id}`));
    }
    const already=new Set(kept.map(s=>`${s.kind}::${s.id}`));
    for(const r of rows){
      const key=`${r.kind}::${r.id}`;
      if(selected.has(key)&&!already.has(key))kept.push(makeRouteStop(r.kind,r.obj));
    }
    state.route.stops=kept.filter(s=>stopAddress(s));resetRouteProgress();routePickerKind='';await saveState();renderRouteCreate();
  };
}

function renderRouteInlineForm(){
  if(!routeInlineMode)return'';
  if(routeInlineMode==='insert')return `<section class="panel route-inline-panel"><div class="title">Enter an Address</div><div class="formgrid"><div class="field"><label>Label (optional)</label><input id="routeInsertName" placeholder="Pickup, appointment, etc."></div><div class="field route-address-field"><label>Address</label><input id="routeInsertAddress" placeholder="Street, city, state ZIP"></div></div><div class="actions"><button class="btn" id="routeInlineCancel">Cancel</button><button class="btn primary" id="routeInsertApply">Add to Route</button></div></section>`;
  if(routeInlineMode==='save')return `<section class="panel route-inline-panel"><div class="title">Save This Route</div><div class="field"><label>Route Name</label><input id="routeSaveName" placeholder="Nightly House Checks"></div><div class="actions"><button class="btn" id="routeInlineCancel">Cancel</button><button class="btn primary" id="routeSaveApply">Save Route</button></div></section>`;
  return'';
}
function wireRouteInlineForm(){
  const cancel=document.getElementById('routeInlineCancel');if(cancel)cancel.onclick=()=>{routeInlineMode='';renderRouteCreate()};
  const insert=document.getElementById('routeInsertApply');if(insert)insert.onclick=async()=>{const address=document.getElementById('routeInsertAddress').value.trim();if(!address){alert('Enter an address.');return}const name=document.getElementById('routeInsertName').value.trim()||'Inserted Address';state.route.stops.push(makeRouteStop('custom',{id:uuid(),name,address}));resetRouteProgress();routeInlineMode='';await saveState();renderRouteCreate()};
  const save=document.getElementById('routeSaveApply');if(save)save.onclick=async()=>{
    const name=document.getElementById('routeSaveName').value.trim();if(!name){alert('Enter a route name.');return}
    const now=new Date().toISOString(),existing=state.savedRoutes.find(r=>r.name.trim().toLowerCase()===name.toLowerCase());
    if(existing){if(!confirm(`Replace the saved route “${existing.name}”?`))return;existing.name=name;existing.updatedAt=now;existing.startMode=state.route.startMode;existing.startLocationId=state.route.startLocationId;existing.stops=deepClone(state.route.stops)}
    else state.savedRoutes.push({id:uuid(),name,createdAt:now,updatedAt:now,startMode:state.route.startMode,startLocationId:state.route.startLocationId,stops:deepClone(state.route.stops)});
    routeInlineMode='';await saveState();renderRouteCreate();
  };
}

function renderSavedRoutes(fromPlan=false){
  const view=document.getElementById('view'),list=(state.savedRoutes||[]).slice().sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  setModulePrevious(()=>fromPlan?setRouteView('create'):setRouteView('menu'),fromPlan?'Plan Route':'Route Planner');
  view.innerHTML=`<section class="panel"><div class="title">Saved Routes</div><div class="muted">Loading a route replaces only the current route workspace. Your locations and house-check database are untouched.</div></section><section class="history-list">${list.map(r=>`<article class="card history-card route-saved-card"><div><b>${esc(r.name)}</b><div class="meta">${r.stops.length} stop${r.stops.length===1?'':'s'} • updated ${new Date(r.updatedAt||r.createdAt).toLocaleDateString()}</div></div><div class="actions"><button class="btn primary" data-loadroute="${esc(r.id)}">Load</button><button class="btn red" data-delroute="${esc(r.id)}">Delete</button></div></article>`).join('')||'<section class="panel"><div class="muted">No saved routes yet. Build one in Plan Route, then tap Save Route.</div></section>'}</section>`;
  view.querySelectorAll('[data-loadroute]').forEach(b=>b.onclick=async()=>{const r=state.savedRoutes.find(x=>x.id===b.dataset.loadroute);if(!r)return;state.route={stops:deepClone(r.stops),startMode:r.startMode==='location'?'location':'current',startLocationId:r.startLocationId||'',runIndex:0,runStartAddress:'',runStartLabel:''};if(state.route.startMode==='location'&&!locationById(state.route.startLocationId)){state.route.startMode='current';state.route.startLocationId=''}await saveState();setRouteView('create')});
  view.querySelectorAll('[data-delroute]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this saved route?'))return;state.savedRoutes=state.savedRoutes.filter(x=>x.id!==b.dataset.delroute);await saveState();renderSavedRoutes(fromPlan)});
}

function routeGeoPosition(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(new Error('Location services are not available on this device.'));return}
    navigator.geolocation.getCurrentPosition(
      p=>resolve({lat:p.coords.latitude,lon:p.coords.longitude}),
      e=>reject(e),
      {enableHighAccuracy:true,timeout:12000,maximumAge:30000}
    );
  });
}
async function prepareRouteLoopStart(){
  state.route.runIndex=0;
  if(state.route.startMode==='location'){
    const start=currentStartLocation();
    if(!start?.address){alert('Choose a valid starting location first.');return false}
    state.route.runStartAddress=start.address;
    state.route.runStartLabel=start.name||'Starting Location';
    return true;
  }
  try{
    const p=await routeGeoPosition();
    state.route.runStartAddress=`${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
    state.route.runStartLabel='Current Position at Route Start';
    return true;
  }catch(e){
    alert('Current Position needs location access so the route can return to the exact place you started. Allow location access, or choose Other and select a saved starting location.');
    return false;
  }
}
function routeNavigationPlan(){
  const total=validRouteStops().length,parts=[];
  if(!total)return parts;
  let cursor=0;
  while(total-cursor>9){
    const end=Math.min(cursor+10,total);
    parts.push({startIndex:cursor,endIndex:end,isFinal:false});
    cursor=end;
  }
  parts.push({startIndex:cursor,endIndex:total,isFinal:true});
  return parts;
}
function routeGoogleSections(startAddress){
  const stops=validRouteStops().map((s,i)=>({label:stopLabel(s),address:stopAddress(s),stopNumber:i+1}));
  const plan=routeNavigationPlan(),sections=[];
  let origin=startAddress;
  for(const part of plan){
    const chunk=stops.slice(part.startIndex,part.endIndex);
    if(part.isFinal){
      sections.push({
        origin,
        destination:startAddress,
        waypoints:chunk.map(x=>x.address),
        startIndex:part.startIndex,
        endIndex:part.endIndex,
        isFinal:true
      });
    }else{
      const destination=chunk[chunk.length-1]?.address||origin;
      sections.push({
        origin,
        destination,
        waypoints:chunk.slice(0,-1).map(x=>x.address),
        startIndex:part.startIndex,
        endIndex:part.endIndex,
        isFinal:false
      });
      origin=destination;
    }
  }
  return sections;
}
function openClientAddressGoogleMaps(destination){
  if(!destination)return;
  const params=new URLSearchParams({api:'1',destination,travelmode:'driving',dir_action:'navigate'});
  const webUrl=`https://www.google.com/maps/dir/?${params.toString()}`;
  const appUrl=routeGoogleAppUrl(webUrl);
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
  if(ios){
    const started=Date.now();
    window.location.href=appUrl;
    setTimeout(()=>{
      if(document.visibilityState==='visible'&&Date.now()-started<2500)window.location.href=webUrl;
    },1100);
    return;
  }
  window.location.href=webUrl;
}
function routeGoogleWebUrl(origin,destination,waypoints=[]){
  const params=new URLSearchParams({api:'1',origin,destination,travelmode:'driving',dir_action:'navigate'});
  if(waypoints.length)params.set('waypoints',waypoints.join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
function routeGoogleAppUrl(webUrl){
  return String(webUrl||'').replace(/^https?:\/\//,'comgooglemapsurl://');
}
function openRouteGoogleMaps(origin,destination,waypoints=[]){
  const webUrl=routeGoogleWebUrl(origin,destination,waypoints),appUrl=routeGoogleAppUrl(webUrl);
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
  if(ios){
    const started=Date.now();
    window.location.href=appUrl;
    setTimeout(()=>{
      if(document.visibilityState==='visible'&&Date.now()-started<2500)window.location.href=webUrl;
    },1100);
    return;
  }
  window.location.href=webUrl;
}
async function ensureRouteNavigationStart(partIndex){
  if(state.route.startMode==='location'){
    const start=currentStartLocation();
    if(!start?.address){alert('Choose a valid starting location first.');return false}
    state.route.runStartAddress=start.address;
    state.route.runStartLabel=start.name||'Starting Location';
    await saveState();
    return true;
  }
  if(state.route.runStartAddress)return true;
  if(partIndex!==0){
    alert('Open Route Part 1 first. That captures the exact current position so the final route can return to where you started.');
    return false;
  }
  try{
    const p=await routeGeoPosition();
    state.route.runStartAddress=`${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
    state.route.runStartLabel='Current Position at Route Start';
    await saveState();
    return true;
  }catch(e){
    alert('Current Position needs location access so Google Maps can return to the exact place you started. Allow location access, or choose Other and select a saved starting location.');
    return false;
  }
}
async function launchRouteNavigationPart(partIndex){
  const plan=routeNavigationPlan();
  if(!plan.length){alert('Add at least one destination first.');return}
  if(partIndex<0||partIndex>=plan.length)return;
  if(!await ensureRouteNavigationStart(partIndex))return;
  const sections=routeGoogleSections(state.route.runStartAddress),section=sections[partIndex];
  if(!section)return;
  openRouteGoogleMaps(section.origin,section.destination,section.waypoints);
}
function renderRouteNavigationButtons(){
  const stops=validRouteStops(),plan=routeNavigationPlan();
  if(!stops.length)return '';
  if(plan.length===1){
    return `<button class="btn primary route-start-route" data-route-navpart="0">🧭 OPEN FULL LOOP IN GOOGLE MAPS</button>`;
  }
  return plan.map((p,i)=>{
    const first=p.startIndex+1,last=p.endIndex;
    let detail;
    if(p.isFinal&&first>last)detail='Return to starting location';
    else if(p.isFinal)detail=`Stops ${first}–${last} • then return to start`;
    else detail=`Stops ${first}–${last}`;
    return `<button class="btn ${i===0?'primary':''} route-start-route" data-route-navpart="${i}"><span>🧭 GOOGLE MAPS • PART ${i+1} OF ${plan.length}</span><small>${esc(detail)}</small></button>`;
  }).join('');
}

function renderRouteCreate(){
  if(routePickerKind)return renderRoutePicker(routePickerKind);
  const view=document.getElementById('view'),stops=validRouteStops(),allStarts=routeStartLocations();
  setModulePrevious(()=>setRouteView('menu'),'Route Planner');
  const startValue=state.route.startMode==='location'&&locationById(state.route.startLocationId)?state.route.startLocationId:'__current__',transport=transportationLocation(),startLoc=currentStartLocation();
  const startName=startValue==='__current__'?'Current Position':(startLoc?.name||'Selected Location');
  const startAddress=startValue==='__current__'?'Phone GPS will be used when navigation opens.':(startLoc?.address||'No address saved.');
  view.innerHTML=`<section class="panel route-plan-head"><div><div class="title">Plan Route</div><div class="muted">Add the stops, put them in the order you want, then start the route.</div></div><button class="btn red" id="routeClear" ${stops.length?'':'disabled'}>Clear</button></section>
  <section class="route-add-strip"><button class="route-tool-button" id="routeClientHomes">🏠 <span><b>CLIENT HOMES</b><small>Select one, several, or all</small></span></button><button class="route-tool-button" id="routeLocationPicker">📍 <span><b>LOCATIONS</b><small>Business and saved places</small></span></button><button class="route-tool-button" id="routeInsertAddress">＋ <span><b>ENTER ADDRESS</b><small>One-time stop</small></span></button></section>
  ${renderRouteInlineForm()}
  <section class="panel route-order-panel"><div class="route-order-head"><div><div class="title">Route Order</div><div class="muted">${stops.length?`${stops.length} destination${stops.length===1?'':'s'}. Use the arrows whenever you want to change the order.`:'Add destinations above to begin.'}</div></div></div>
  <div class="route-start-shell"><div class="route-start-display"><div class="route-start-caption">STARTING<br>LOCATION</div><div class="route-start-copy"><strong>${esc(startName)}</strong><span>${esc(startAddress)}</span></div></div><div class="route-start-quick"><button class="btn route-start-mini" id="routeCurrentStart" ${startValue==='__current__'?'disabled':''}>📍<span>CURRENT</span></button><button class="btn route-start-mini" id="routeOtherStart">•••<span>OTHER</span></button></div></div>
  ${routeStartPickerOpen?`<div class="route-other-picker"><div class="field"><label>Choose Starting Location</label><select id="routeOtherStartSelect">${allStarts.map(l=>`<option value="${esc(l.id)}" ${startValue===l.id?'selected':''}>${esc(l.name)} • ${esc(l.address)}</option>`).join('')}</select></div><div class="actions"><button class="btn" id="routeOtherCancel">Cancel</button><button class="btn primary" id="routeOtherApply" ${allStarts.length?'':'disabled'}>Use Location</button></div>${allStarts.length?'':'<div class="muted">No saved locations yet. Add one from Locations.</div>'}</div>`:''}
  <div id="routeOrder" class="route-order-list"></div></section>
  <section class="route-plan-actions"><button class="btn" id="routeLoad">📂 Load Saved</button><button class="btn" id="routeSave" ${stops.length?'':'disabled'}>💾 Save Route</button>${renderRouteNavigationButtons()}</section>`;
  wireRouteInlineForm();
  document.getElementById('routeClientHomes').onclick=()=>{routePickerKind='clients';renderRoute()};
  document.getElementById('routeLocationPicker').onclick=()=>{routePickerKind='locations';renderRoute()};
  document.getElementById('routeInsertAddress').onclick=()=>{routeInlineMode='insert';renderRouteCreate()};
  document.getElementById('routeSave').onclick=()=>{routeInlineMode='save';renderRouteCreate()};
  document.getElementById('routeLoad').onclick=()=>{routePlannerView='load';renderSavedRoutes(true)};
  document.getElementById('routeCurrentStart').onclick=async()=>{state.route.startMode='current';state.route.startLocationId='';routeStartPickerOpen=false;resetRouteProgress();await saveState();renderRouteCreate()};
  document.getElementById('routeOtherStart').onclick=()=>{routeStartPickerOpen=!routeStartPickerOpen;renderRouteCreate()};
  if(document.getElementById('routeOtherCancel'))document.getElementById('routeOtherCancel').onclick=()=>{routeStartPickerOpen=false;renderRouteCreate()};
  if(document.getElementById('routeOtherApply'))document.getElementById('routeOtherApply').onclick=async()=>{const id=document.getElementById('routeOtherStartSelect')?.value;if(!id||!locationById(id))return;state.route.startMode='location';state.route.startLocationId=id;routeStartPickerOpen=false;resetRouteProgress();await saveState();renderRouteCreate()};
  document.getElementById('routeClear').onclick=async()=>{if(!confirm('Clear the current route?'))return;state.route.stops=[];resetRouteProgress();await saveState();renderRouteCreate()};
  view.querySelectorAll('[data-route-navpart]').forEach(b=>b.onclick=()=>launchRouteNavigationPart(Number(b.dataset.routeNavpart)));
  const box=document.getElementById('routeOrder');
  box.innerHTML=stops.length?stops.map((s,i)=>`<div class="route route-stop-row"><b>${i+1}</b><span>${esc(stopLabel(s))}</span><span class="route-row-controls"><button class="route-arrow" data-up="${i}" ${i===0?'disabled':''} aria-label="Move stop up">↑</button><button class="route-arrow" data-down="${i}" ${i===stops.length-1?'disabled':''} aria-label="Move stop down">↓</button></span></div>`).join(''):'<div class="route-empty">No destinations in this route yet.</div>';
  box.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>moveRoute(+b.dataset.up,-1));
  box.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>moveRoute(+b.dataset.down,1));
}
async function moveRoute(i,d){const j=i+d;if(j<0||j>=state.route.stops.length)return;[state.route.stops[i],state.route.stops[j]]=[state.route.stops[j],state.route.stops[i]];resetRouteProgress();await saveState();renderRouteCreate()}

function renderRoute(){
  if(routePlannerView==='create')return renderRouteCreate();
  if(routePlannerView==='locations')return renderRouteLocations();
  if(routePlannerView==='savedroutes')return renderSavedRoutes(false);
  if(routePlannerView==='load')return renderSavedRoutes(true);
  renderRouteMenu();
}
function renderLocations(){routePlannerView='locations';screen='route';renderRoute()}

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
  if(!clientNeedsCheck(p,r))lines.push('NOT REQUIRED • DO NOT DISTURB');
  else if(!c?.status)lines.push('REQUIRED • NO RESULT');
  if(String(c?.note||'').trim())lines.push(`Remarks: ${String(c.note).trim()}`);
  return lines;
}
function reportSpecialNotes(snapshot){
  const rows=[];
  for(const p of snapshot.properties||[]){
    for(const r of p.rooms||[]){
      if(r.type!=='client')continue;
      const note=String(r.note||'').trim();
      if(!note)continue;
      rows.push({
        name:String(r.name||'').trim(),
        house:String(p.address||'').trim(),
        note
      });
    }
  }
  return rows;
}
function specialNotesHtml(snapshot){
  const rows=reportSpecialNotes(snapshot);
  return `<div class="master-special-notes"><b>SPECIAL NOTES</b>${
    rows.length
      ? `<div class="special-notes-head"><span>Client</span><span>House</span><span>Special Note</span></div>${rows.map(x=>`<div class="special-note-row"><span>${esc(x.name)}</span><span>${esc(x.house)}</span><span>${esc(x.note)}</span></div>`).join('')}`
      : '<span class="special-none">No special notes for this report.</span>'
  }</div>`;
}
function masterHouseHtml(snapshot,p){
  const situation=propertySituationLabel(p),color=propertySituationColor(p)||'normal';
  return `<div class="master-house master-house-${color}"><div class="master-house-title"><b>${esc(p.address)}</b>${situation!=='No Special Status'?`<span>${esc(situation)}</span>`:''}</div>${p.rooms.map(r=>{
    const status=statusFor(snapshot,p,r),m=reportMarks(status),notes=reportNotes(snapshot,p,r);
    const nameClass=r.type==='client'&&r.color?` name-${r.color}`:'';
    return `<div class="master-row ${r.type==='open'?'row-open':r.type==='nobed'?'row-nobed':''}">
      <span class="cell roomcell">${esc(r.room)}</span>
      <span class="cell clientcell${nameClass}">${r.type==='client'?esc(String(r.name||'')):esc(r.type==='open'?'OPEN / EMPTY':'NO BED')}</span>
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
  const colHead=`<div class="master-col-head"><span>Rm</span><span>Client Name</span><span>Home</span><span>Not</span><span>Sleep</span><span>Pass</span><span>Notes</span></div>`;
  return `<div class="paper master-sheet" id="${id}">
    <div class="master-sheet-title">HOUSE CHECK RUN SHEET</div>
    <div class="master-meta"><span><b>DATE / TIME:</b> ${esc(stamp.toLocaleString())}</span><span><b>REPORTED BY:</b> ${esc(snapshot.reporterName||snapshot.driverName||'Reporter')}</span></div>
    <div class="master-instruction">SEE THEM • VERIFY THE NAME • CHECK THE STATUS • LEAVE A USEFUL NOTE</div>
    <div class="master-columns">
      <div class="master-column">${colHead}${left.map(p=>masterHouseHtml(snapshot,p)).join('')}</div>
      <div class="master-column">${colHead}${right.map(p=>masterHouseHtml(snapshot,p)).join('')}</div>
    </div>
    <div class="master-footer">
      <div class="master-footer-left">
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
      ${specialNotesHtml(snapshot)}
    </div>
  </div>`;
}
function renderReport(){
  const view=document.getElementById('view');
  setModulePrevious(goHome);
  if(!inspectionRunIsActive()){
    view.innerHTML=`<section class="panel"><div class="title">Reports</div><div class="muted">No nightly inspection is currently in progress. Completed final reports are opened from the Inspections calendar.</div></section>`;
    return;
  }
  const T=totalsFor();
  view.innerHTML=`<section class="panel">
    <div class="title">Current Inspection Report</div>
    <div class="muted">${T.checked} required checks recorded • ${T.missing} unresolved. Final reports can only be previewed and locked from the active Inspection screen.</div>
    <div class="actions"><button class="btn primary" id="goInspectionReport">Go to Inspection</button></div>
  </section>`;
  document.getElementById('goInspectionReport').onclick=()=>{
    screen='inspections';
    inspectionView='run';
    inspectionDayKey=activeInspectionDate();
    render();
  };
}
async function makeReportPng(snapshot){
  const W=2200,margin=32,gap=24,half=(W-margin*2-gap)/2;
  const widths=[48,300,62,62,62,62,half-(48+300+62*4)];
  const xPos=widths.reduce((a,w)=>{a.push(a[a.length-1]+w);return a},[0]);
  const measure=document.createElement('canvas').getContext('2d');
  const wrap=(text,maxWidth,font='13px Arial')=>{measure.font=font;const words=String(text||'').split(/\s+/).filter(Boolean),lines=[];let line='';for(const w of words){const t=line?line+' '+w:w;if(measure.measureText(t).width>maxWidth&&line){lines.push(line);line=w}else line=t}if(line)lines.push(line);return lines};
  const props=[...snapshot.properties].sort(compareProperties),split=Math.ceil(props.length/2),cols=[props.slice(0,split),props.slice(split)];
  const specials=reportSpecialNotes(snapshot);
  const model=cols.map(col=>col.map(p=>{
    const rows=p.rooms.map(r=>{
      const status=statusFor(snapshot,p,r),marks=reportMarks(status),notes=reportNotes(snapshot,p,r);
      const noteLines=notes.flatMap(n=>wrap(n,widths[6]-12,'13px Arial'));
      const rowH=Math.max(34,18+Math.max(1,noteLines.length)*17);
      return {r,status,marks,noteLines,rowH};
    });
    return {p,rows,h:30+rows.reduce((n,r)=>n+r.rowH,0)};
  }));
  const headerH=116,colHeadH=34;
  const specialFootH=Math.max(170,55+specials.length*58);
  const footerH=Math.max(290,specialFootH+35);
  const colHeights=model.map(col=>headerH+colHeadH+col.reduce((n,h)=>n+h.h+6,0)+footerH);
  const H=Math.max(1250,Math.ceil(Math.max(...colHeights)));
  const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
  g.fillStyle='#fff';g.fillRect(0,0,W,H);g.textBaseline='middle';
  g.fillStyle='#111';g.textAlign='center';g.font='bold 28px Arial';g.fillText('HOUSE CHECK RUN SHEET',W/2,28);
  const stamp=snapshot.completedAt?new Date(snapshot.completedAt):new Date();
  g.textAlign='left';g.font='bold 15px Arial';g.fillText('DATE / TIME:',margin,62);g.font='15px Arial';g.fillText(stamp.toLocaleString(),margin+115,62);
  g.textAlign='right';g.font='bold 15px Arial';g.fillText(`REPORTED BY: ${snapshot.reporterName||snapshot.driverName||'Reporter'}`,W-margin,62);
  g.textAlign='center';g.font='bold 14px Arial';g.fillText('SEE THEM • VERIFY THE NAME • CHECK THE STATUS • LEAVE A USEFUL NOTE',W/2,92);

  const labels=['Rm','Client Name','Home','Not','Sleep','Pass','Notes'];
  const propertyFill=p=>({yellow:'#f3d96f',gray:'#c6cbd0',darkgray:'#7e878d',rose:'#e8aaaa'}[propertySituationColor(p)]||'#d7e7f4');
  const drawCell=(x,y,w,h,fill='#fff')=>{g.fillStyle=fill;g.fillRect(x,y,w,h);g.strokeStyle='#666';g.lineWidth=1;g.strokeRect(x,y,w,h)};
  const drawCheck=(cx,cy,on)=>{g.strokeStyle='#222';g.lineWidth=1.5;g.strokeRect(cx-8,cy-8,16,16);if(on){g.beginPath();g.moveTo(cx-5,cy);g.lineTo(cx-1,cy+5);g.lineTo(cx+6,cy-6);g.stroke()}};

  model.forEach((col,ci)=>{
    const baseX=margin+ci*(half+gap);let y=headerH;
    for(let i=0;i<7;i++){drawCell(baseX+xPos[i],y,widths[i],colHeadH,'#f0f0f0');g.fillStyle='#111';g.font='bold 11px Arial';g.textAlign='center';g.fillText(labels[i],baseX+xPos[i]+widths[i]/2,y+colHeadH/2)}
    y+=colHeadH;
    for(const h of col){
      drawCell(baseX,y,half,30,propertyFill(h.p));g.fillStyle='#111';g.textAlign='left';g.font='bold 13px Arial';g.fillText(h.p.address,baseX+7,y+15);
      const sit=propertySituationLabel(h.p);if(sit!=='No Special Status'){g.textAlign='right';g.font='bold 11px Arial';g.fillText(sit,baseX+half-7,y+15)}
      y+=30;
      for(const row of h.rows){
        const r=row.r;
        let baseFill='#fff';if(r.type==='open')baseFill='#fff4a6';else if(r.type==='nobed')baseFill='#e46a61';
        for(let i=0;i<7;i++)drawCell(baseX+xPos[i],y,widths[i],row.rowH,baseFill);
        if(r.type==='client'&&r.color==='green'){g.fillStyle='#cdebe3';g.fillRect(baseX+xPos[1],y,widths[1],row.rowH);g.strokeStyle='#666';g.strokeRect(baseX+xPos[1],y,widths[1],row.rowH)}
        if(r.type==='client'&&r.color==='gray'){g.fillStyle='#ddd';g.fillRect(baseX+xPos[1],y,widths[1],row.rowH);g.strokeStyle='#666';g.strokeRect(baseX+xPos[1],y,widths[1],row.rowH)}
        g.fillStyle='#111';g.font='13px Arial';g.textAlign='center';g.fillText(r.room,baseX+xPos[0]+widths[0]/2,y+17);
        g.textAlign='left';g.fillText(r.type==='client'?String(r.name||''):(r.type==='open'?'OPEN / EMPTY':'NO BED'),baseX+xPos[1]+6,y+17);
        if(r.type==='client'){const arr=[row.marks.home,row.marks.not,row.marks.sleep,row.marks.pass];for(let k=0;k<4;k++)drawCheck(baseX+xPos[2+k]+widths[2+k]/2,y+17,arr[k])}
        g.font='12px Arial';g.textAlign='left';row.noteLines.forEach((line,li)=>g.fillText(line,baseX+xPos[6]+5,y+13+li*17));
        y+=row.rowH;
      }
      y+=6;
    }
  });

  let fy=H-footerH+18;
  const leftW=520,rightX=margin+leftW+28,rightW=W-rightX-margin;

  g.fillStyle='#111';g.textAlign='left';g.font='bold 14px Arial';g.fillText('ORIGINAL SHEET COLOR STATUS',margin,fy);fy+=22;
  const legend=[['No Bed','#e46a61'],['Not moved yet','#c6cbd0'],['Open','#f3d96f'],['Out of Services','#7e878d'],['Can not Bill for','#e8aaaa']];
  legend.forEach(([label,color],i)=>{const yy=fy+i*24;g.fillStyle=color;g.fillRect(margin,yy-8,22,16);g.strokeStyle='#666';g.strokeRect(margin,yy-8,22,16);g.fillStyle='#111';g.font='13px Arial';g.fillText(label,margin+32,yy)});
  fy+=legend.length*24+10;

  const rules=[
    "Please don't call clients before 10 pm.",
    "You must actually see the clients and ask their name to be sure you have the correct client.",
    "Curfew for 2.1 is 10 on weekday and 11 for weekends. 1.0 dose not have a curfew.",
    "Call Clients after 10 pm on weekdays and ask where they are at and after 11 pm on weekends.",
    "PLEASE REPORT ANYONE YOU CANT REACH AND CAN'T SEE TO ON CALL PERSON."
  ];
  g.font='bold 14px Arial';g.fillText('ORIGINAL SHEET NOTES',margin,fy);fy+=22;
  g.font='12px Arial';
  for(const rule of rules){
    const lines=wrap(rule,leftW-10,'12px Arial');
    for(const line of lines){g.fillText(line,margin,fy);fy+=17}
    fy+=4;
  }

  // Special Notes, bottom-right. Full legal/operational names are always used.
  let sy=H-footerH+18;
  g.font='bold 15px Arial';g.fillText('SPECIAL NOTES',rightX,sy);sy+=25;
  const nameW=210,houseW=260,noteW=rightW-nameW-houseW;
  const sx=[rightX,rightX+nameW,rightX+nameW+houseW,rightX+rightW];
  const drawSpecialCell=(x,y,w,h,fill='#fff')=>{g.fillStyle=fill;g.fillRect(x,y,w,h);g.strokeStyle='#888';g.lineWidth=1;g.strokeRect(x,y,w,h)};
  const sh=28;
  ['Client','House','Special Note'].forEach((label,i)=>{
    const widths2=[nameW,houseW,noteW];
    drawSpecialCell(sx[i],sy,widths2[i],sh,'#f0f0f0');
    g.fillStyle='#111';g.font='bold 11px Arial';g.textAlign='left';g.fillText(label,sx[i]+6,sy+sh/2);
  });
  sy+=sh;
  if(!specials.length){
    drawSpecialCell(rightX,sy,rightW,34,'#fff');
    g.fillStyle='#555';g.font='12px Arial';g.textAlign='left';g.fillText('No special notes for this report.',rightX+6,sy+17);
  }else{
    for(const item of specials){
      const nameLines=wrap(item.name,nameW-12,'12px Arial');
      const houseLines=wrap(item.house,houseW-12,'12px Arial');
      const noteLines=wrap(item.note,noteW-12,'12px Arial');
      const lines=Math.max(1,nameLines.length,houseLines.length,noteLines.length);
      const rh=Math.max(38,14+lines*17);
      drawSpecialCell(rightX,sy,nameW,rh,'#fff');
      drawSpecialCell(rightX+nameW,sy,houseW,rh,'#fff');
      drawSpecialCell(rightX+nameW+houseW,sy,noteW,rh,'#fff');
      g.fillStyle='#111';g.font='12px Arial';g.textAlign='left';
      nameLines.forEach((line,li)=>g.fillText(line,rightX+6,sy+13+li*17));
      houseLines.forEach((line,li)=>g.fillText(line,rightX+nameW+6,sy+13+li*17));
      noteLines.forEach((line,li)=>g.fillText(line,rightX+nameW+houseW+6,sy+13+li*17));
      sy+=rh;
    }
  }
  return new Promise(res=>c.toBlob(res,'image/png',.95));
}
function reportFilename(snapshot){const d=(snapshot.completedAt?new Date(snapshot.completedAt):new Date()).toISOString().slice(0,10);return `house-check-report-${d}.png`}
async function downloadSnapshot(snapshot){const b=await makeReportPng(snapshot),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=reportFilename(snapshot);a.click();setTimeout(()=>URL.revokeObjectURL(u),1200)}
function openSms(number,body){const n=digits(number);if(!n)return;location.href=`sms:${n}?body=${encodeURIComponent(body)}`}
function reportMessage(snapshot){const T=totalsFor(snapshot.properties,snapshot.checks),when=snapshot.completedAt?new Date(snapshot.completedAt).toLocaleString():new Date().toLocaleString();return `SCC-CTD House Check Report ${when}. ${T.checked}/${T.required} required client checks recorded; ${T.missing} unresolved; ${T.notRequired} clients marked not required. Report image prepared.`}
async function textSnapshot(snapshot){
  const n=digits(state.settings.reportTextNumber);if(n.length<10){alert('Set the Report Text Cell Number in Settings first.');screen='settings';settingsView='profile';render();return}
  const b=await makeReportPng(snapshot),f=new File([b],reportFilename(snapshot),{type:'image/png'});
  try{
    if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[f]}))){
      await navigator.share({title:'House Check Report Image',text:`Send this report image to ${fmtPhone(n)}.`,files:[f]});
      return;
    }
  }catch(e){
    if(e?.name==='AbortError')return;
  }
  await downloadSnapshot(snapshot);
  alert(`This phone/browser could not attach the PNG automatically. The actual report image was saved. Attach ${reportFilename(snapshot)} to your message to ${fmtPhone(n)}.`);
}
async function emailSnapshot(snapshot){
  const b=await makeReportPng(snapshot),f=new File([b],reportFilename(snapshot),{type:'image/png'});
  try{
    if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[f]}))){
      await navigator.share({title:'House Check Report Image',text:'SCC-CTD House Check final report image.',files:[f]});
      return;
    }
  }catch(e){
    if(e?.name==='AbortError')return;
  }
  await downloadSnapshot(snapshot);
  alert(`This phone/browser could not attach the PNG automatically. The actual report image was saved as ${reportFilename(snapshot)} so it can be attached to email.`);
}
async function completeRun(){
  return lockFinalInspectionReport();
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
    view.innerHTML=`<section class="panel"><div class="titlebar"><div><button class="btn" id="backHistory">← Calendar</button><div class="title" style="margin-top:10px">Completed Report • ${esc(new Date(h.completedAt).toLocaleString())}</div><div class="muted">Saved final report. It does not change when the current roster changes.</div></div></div></section>
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
    schemaVersion:26,
    exportedAt:new Date().toISOString(),
    properties:state.properties,
    clients:state.clients,
    inactiveClients:inactiveRegistryClients(),
    locations:state.locations,
    route:state.route,
    savedRoutes:state.savedRoutes,
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
  if(!payload||(!Array.isArray(payload.properties)&&!payload.operationalResetOnly&&!payload.locationSeedOnly))throw new Error('Backup contents are invalid.');
  return payload;
}
async function importDatabasePayload(incoming){
  if(incoming?.locationSeedOnly){
    const incomingLocations=Array.isArray(incoming.locations)?incoming.locations:[];
    state.locations=Array.isArray(state.locations)?state.locations:[];
    for(const raw of incomingLocations){
      const l={id:String(raw.id||uuid()),name:String(raw.name||'Unnamed Location'),address:String(raw.address||''),type:String(raw.type||'Other'),phone:String(raw.phone||''),notes:String(raw.notes||''),isBase:!!raw.isBase,category:raw.category==='business'?'business':'saved'};
      const ix=state.locations.findIndex(x=>x.id===l.id||((x.name||'').toLowerCase()===l.name.toLowerCase()&&(x.address||'').toLowerCase()===l.address.toLowerCase()));
      if(ix>=0)state.locations[ix]={...state.locations[ix],...l};else state.locations.push(l);
    }
    if(incoming.defaultStartLocationId&&state.locations.some(l=>l.id===incoming.defaultStartLocationId)){
      state.route=state.route||{stops:[]};
      state.route.startMode='location';
      state.route.startLocationId=incoming.defaultStartLocationId;
    }
    await saveState();
    return;
  }
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
  const keepText=state.settings.reportTextNumber,keepClients=deepClone(state.clients||[]);
  const localIdentity={
    reporterName:state.settings.reporterName||state.settings.driverName||'',
    authorizedUserCell:state.settings.authorizedUserCell||'',
    userWorkEmail:state.settings.userWorkEmail||'',
    profileComplete:!!state.settings.profileComplete
  };
  state.properties=incoming.properties.map(normalizeProperty);
  if(Array.isArray(incoming.clients)){
    state.clients=incoming.clients.map((c,i)=>normalizeRegistryClient(c,i,c?.status==='inactive'?'inactive':'active'));
  }else{
    state.clients=Array.isArray(incoming.inactiveClients)?incoming.inactiveClients.map((c,i)=>normalizeRegistryClient({...c,status:'inactive'},i,'inactive')):keepClients;
    for(const p of state.properties)for(const r of p.rooms)if(r.type==='client'){
      if(!r.clientId)r.clientId=uuid();
      let c=state.clients.find(x=>x.clientId===r.clientId);
      if(!c){c=registryClientFromRoom(r,p.address,r.room);state.clients.push(c)}
      c.status='active';syncRoomFromClient(r,c);
    }
  }
  state.inactiveClients=inactiveRegistryClients().map((c,i)=>normalizeInactiveClient(c,i));
  state.locations=Array.isArray(incoming.locations)?incoming.locations.map((l,i)=>({id:String(l?.id??('l'+i+'_'+Date.now())),name:l?.name??'Unnamed Location',address:l?.address??'',type:l?.type??'Other',phone:l?.phone??'',notes:l?.notes??'',isBase:!!l?.isBase,category:l?.category==='business'?'business':'saved'})):[];
  const ir=incoming.route&&Array.isArray(incoming.route.stops)?incoming.route:{stops:[]};
  state.route={stops:deepClone(ir.stops||[]),startMode:ir.startMode==='location'?'location':'current',startLocationId:String(ir.startLocationId||''),runIndex:0,runStartAddress:'',runStartLabel:''};
  state.savedRoutes=Array.isArray(incoming.savedRoutes)?deepClone(incoming.savedRoutes):[];
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
  const view=document.getElementById('view'),beds=state.properties.reduce((n,p)=>n+p.beds,0);
  const active=activeRegistryClients(),inactive=inactiveRegistryClients(),unassigned=unassignedActiveClients();
  const assigned=active.filter(c=>!!clientAssignment(c.clientId));
  view.innerHTML=`<section class="panel"><div class="titlebar"><div><div class="title">Encrypted Database Transfer</div><div class="muted">Portable database backups are encrypted and restricted in-app to Shawnee Counseling Center work email addresses.</div></div>${nameRevealButton()}</div>
  <div class="formgrid database-transfer-grid">
    <div class="field"><label>Work Email Recipient</label><input id="databaseWorkEmail" type="text" inputmode="email" autocomplete="email" placeholder="name@${WORK_EMAIL_DOMAIN}"><div class="field-help">Only @${WORK_EMAIL_DOMAIN} addresses are accepted by the app.</div></div>
  </div>
  <div class="actions"><button class="btn primary" id="emailDatabase">Email Encrypted Database</button><label class="btn" for="importData">Import Encrypted Database</label><input id="importData" type="file" accept=".sccbackup,.json,application/json,application/octet-stream" style="display:none"></div>
  <div class="notice">Export asks for your app PIN, then a separate transfer password. The transfer password should be given to the recipient separately.</div>
  <div id="importMessage" class="muted" style="margin-top:6px"></div></section>
  <section class="panel"><div class="title">Internal Database</div><div class="dbstats"><div class="stat"><strong>${state.properties.length}</strong>Properties</div><div class="stat"><strong>${beds}</strong>Beds</div><div class="stat"><strong>${active.length}</strong>Active Clients</div><div class="stat"><strong>${unassigned.length}</strong>Unassigned</div><div class="stat"><strong>${inactive.length}</strong>Inactive</div><div class="stat"><strong>${state.history.length}</strong>Reports</div></div></section>
  <section class="panel"><div class="title">Active Client Registry</div><div class="registry-list">${active.map(c=>{
    const a=clientAssignment(c.clientId);
    return `<div class="registry-row"><b>${esc(displayClientName(c.name))}</b><span>${a?`${esc(a.property.address)} • Room ${esc(a.room.room)}`:'ACTIVE • UNASSIGNED'}</span><small>${c.workSchedule?`Work: ${esc(c.workSchedule)}`:'No work schedule entered'}${c.schoolSchedule?` • School: ${esc(c.schoolSchedule)}`:''}</small></div>`;
  }).join('')||'<div class="muted">No active clients.</div>'}</div></section>
  <section class="panel"><div class="title">Inactive Client Registry</div><div class="muted">Reactivate clients from CLIENT • SECURE. Housing assignment is handled separately from PROPERTIES.</div><div class="registry-list">${inactive.map(c=>`<div class="registry-row inactive-row"><b>${esc(displayClientName(c.name))}</b><span>Last: ${esc(c.previousAddress||'Unknown')} ${c.previousRoom?`• Room ${esc(c.previousRoom)}`:''}</span><small>${c.workSchedule?`Work: ${esc(c.workSchedule)}`:'No work schedule entered'}${c.schoolSchedule?` • School: ${esc(c.schoolSchedule)}`:''}</small></div>`).join('')||'<div class="muted">No inactive clients.</div>'}</div></section>`;
  const nameToggle=document.getElementById('toggleNames');
  if(nameToggle)nameToggle.onclick=()=>{showFullNames?hideFullNames():revealFullNamesTemporarily();renderDatabase()};
  document.getElementById('emailDatabase').onclick=emailEncryptedDatabase;
  document.getElementById('importData').onchange=async()=>{
    const f=document.getElementById('importData').files?.[0];if(!f)return;const msg=document.getElementById('importMessage');
    try{await importPrivateData(f);msg.textContent='Encrypted database imported into this phone’s protected local database.';setTimeout(renderDatabase,450)}catch(e){msg.textContent='Import failed: '+e.message}
  };
}


/* ---------- Vehicle Logs ---------- */
function renderVehicleLogs(){
  const view=document.getElementById('view');
  setModulePrevious(goHome);
  view.innerHTML=`<section class="panel vehicle-logs-placeholder">
    <div class="vehicle-logs-icon">🚐</div>
    <div class="title">Vehicle Logs</div>
    <div class="under-const-badge">UNDER CONSTRUCTION</div>
    <div class="muted">Reserved for the vehicle-log workflow currently being designed.</div>
  </section>`;
}

/* ---------- Settings ---------- */
function settingsBackToMenu(){
  settingsView='menu';
  renderSettings();
}
function renderSettingsMenu(){
  const view=document.getElementById('view');
  setModulePrevious(goHome);
  view.innerHTML=`<section class="settings-button-stack">
    <button class="settings-door" data-settings="profile"><span>👤</span><b>User Profile</b><i>›</i></button>
    <button class="settings-door" data-settings="release"><span>🔐</span><b>Release Database</b><i>›</i></button>
    <button class="settings-door" data-settings="load"><span>📥</span><b>Load Database</b><i>›</i></button>
    <button class="settings-door" id="settingsSave"><span>💾</span><b>Save</b><i>✓</i></button>
    <button class="settings-door" id="settingsRestart"><span>↻</span><b>Restart App</b><i>›</i></button>
  </section>
  <div id="settingsStatus" class="settings-status"></div>`;

  view.querySelectorAll('[data-settings]').forEach(b=>b.onclick=()=>{
    settingsView=b.dataset.settings;
    renderSettings();
  });

  document.getElementById('settingsSave').onclick=async()=>{
    const status=document.getElementById('settingsStatus');
    try{
      await saveState();
      status.textContent='Saved to this device.';
      setTimeout(()=>{if(status)status.textContent=''},1800);
    }catch(e){
      status.textContent='Save failed: '+(e?.message||e);
    }
  };

  document.getElementById('settingsRestart').onclick=async()=>{
    if(!confirm('Restart SCC-CTD House Checks? Your encrypted database will be saved first.'))return;
    try{await saveState()}catch{}
    location.reload();
  };
}
function renderSettingsProfile(){
  const s=state.settings,view=document.getElementById('view');
  setModulePrevious(settingsBackToMenu);
  view.innerHTML=`<section class="panel">
    <div class="title">User Profile</div>
    <div class="formgrid">
      <div class="field"><label>Authorized User Name</label><input id="reporterName" autocomplete="name" value="${esc(s.reporterName||s.driverName||'')}"></div>
      <div class="field"><label>Authorized User Cell Number</label><input id="authorizedUserCell" type="tel" inputmode="tel" autocomplete="tel" value="${esc(fmtPhone(s.authorizedUserCell||''))}"></div>
      <div class="field"><label>Work Email</label><div class="work-email-rule">Must end exactly in <b>@${WORK_EMAIL_DOMAIN}</b></div><input id="userWorkEmail" type="text" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="${esc(s.userWorkEmail||'')}" placeholder="name@${WORK_EMAIL_DOMAIN}"></div>
      <div class="field"><label>Confirm Work Email</label><input id="userWorkEmailConfirm" type="text" inputmode="email" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Retype work email"></div>
      <div class="field"><label>Report Text Cell Number</label><input id="reportNumber" type="tel" inputmode="tel" value="${esc(fmtPhone(s.reportTextNumber||''))}"></div>
      <div class="field"><label>Auto-lock Minutes</label><input id="autoLock" type="number" min="1" max="120" value="${Number(s.autoLockMinutes)||15}"></div>
    </div>
    <div class="actions">
      <button class="btn" id="testText">Test Text</button>
      <button class="btn primary" id="saveUserSettings">Save User Profile</button>
    </div>
    <div id="profileSettingsStatus" class="muted"></div>
  </section>`;

  document.getElementById('testText').onclick=()=>{
    const n=digits(document.getElementById('reportNumber').value);
    if(n.length<10){alert('Enter a valid report-text cell number first.');return}
    openSms(n,'SCC-CTD House Checks TEST: report texting is configured correctly.');
  };

  document.getElementById('saveUserSettings').onclick=async()=>{
    const reporterName=document.getElementById('reporterName').value.trim();
    const authorizedUserCell=digits(document.getElementById('authorizedUserCell').value);
    const userWorkEmail=normalizeWorkEmail(document.getElementById('userWorkEmail').value);
    const userWorkEmailConfirm=normalizeWorkEmail(document.getElementById('userWorkEmailConfirm').value);
    const reportNumber=digits(document.getElementById('reportNumber').value);
    const status=document.getElementById('profileSettingsStatus');

    if(!reporterName){status.textContent='Enter the Authorized User Name.';return}
    if(authorizedUserCell.length<10){status.textContent='Enter the Authorized User Cell Number.';return}
    if(!validWorkEmail(userWorkEmail)){status.textContent=`Work Email must end exactly in @${WORK_EMAIL_DOMAIN}.`;return}
    if(userWorkEmail!==userWorkEmailConfirm){status.textContent='Work Email entries do not match.';return}

    s.reporterName=reporterName;
    s.authorizedUserCell=authorizedUserCell;
    s.userWorkEmail=userWorkEmail;
    s.profileComplete=true;
    s.reportTextNumber=reportNumber;
    s.autoLockMinutes=Math.max(1,Math.min(120,+document.getElementById('autoLock').value||15));
    await saveState();
    bumpLock();
    status.textContent='User profile saved.';
  };
}
function renderSettingsReleaseDatabase(){
  const view=document.getElementById('view');
  setModulePrevious(settingsBackToMenu);
  const defaultRecipient=state.settings.userWorkEmail||'';
  view.innerHTML=`<section class="panel">
    <div class="title">Release Database</div>
    <div class="muted">Creates an encrypted portable SCC-CTD database for an approved Shawnee Counseling Center work email.</div>
    <div class="field" style="margin-top:14px">
      <label>Work Email Recipient</label>
      <input id="databaseWorkEmail" type="text" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="${esc(defaultRecipient)}" placeholder="name@${WORK_EMAIL_DOMAIN}">
      <div class="field-help">Recipient must end exactly in @${WORK_EMAIL_DOMAIN}.</div>
    </div>
    <div class="actions"><button class="btn primary" id="releaseDatabaseNow">Release Encrypted Database</button></div>
    <div class="notice">The app asks for your app PIN and then a separate transfer password. Share the transfer password separately from the database file.</div>
  </section>`;
  document.getElementById('releaseDatabaseNow').onclick=emailEncryptedDatabase;
}
function renderSettingsLoadDatabase(){
  const view=document.getElementById('view');
  setModulePrevious(settingsBackToMenu);
  view.innerHTML=`<section class="panel">
    <div class="title">Load Database</div>
    <div class="muted">Choose an SCC-CTD encrypted backup from Files, Mail, or another location on this phone.</div>
    <label class="load-db-target" for="settingsImportData">
      <span class="load-db-icon">📥</span>
      <strong>Choose Database File</strong>
      <small>.sccbackup files are supported</small>
    </label>
    <input id="settingsImportData" type="file" accept=".sccbackup,application/octet-stream,application/json,text/plain,*/*" style="position:absolute;left:-9999px;width:1px;height:1px">
    <div id="settingsImportMessage" class="settings-import-message"></div>
    <div class="notice">Loading a normal database preserves this phone's PIN and local authorized-user identity. A Clean Inspection State reset clears only inspection/test history and day notes.</div>
  </section>`;

  const input=document.getElementById('settingsImportData');
  input.onchange=async()=>{
    const f=input.files?.[0];
    const msg=document.getElementById('settingsImportMessage');
    if(!f)return;
    msg.className='settings-import-message working';
    msg.textContent=`Selected: ${f.name}. Waiting for transfer password…`;
    try{
      await importPrivateData(f);
      msg.className='settings-import-message success';
      msg.textContent='Database loaded successfully.';
      setTimeout(()=>{
        settingsView='menu';
        renderSettings();
      },900);
    }catch(e){
      msg.className='settings-import-message error';
      msg.textContent='Load failed: '+(e?.message||e);
      input.value='';
    }
  };
}
function renderSettings(){
  if(settingsView==='profile')return renderSettingsProfile();
  if(settingsView==='release')return renderSettingsReleaseDatabase();
  if(settingsView==='load')return renderSettingsLoadDatabase();
  renderSettingsMenu();
}

start();
})();
