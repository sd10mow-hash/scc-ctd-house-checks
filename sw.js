const CACHE='scc-housechecks-v1.6.16';
const FALLBACK='./index.html?v=1.6.16';
const ASSETS=[
  FALLBACK,
  './styles.css?v=1.6.16',
  './app.js?v=1.6.16',
  './manifest.webmanifest?v=1.6.16',
  './icon-180.png?v=1.6.16',
  './icon-192.png?v=1.6.16',
  './icon-512.png?v=1.6.16'
];
self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('scc-housechecks-')).map(k=>caches.delete(k))))
])));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  if(e.request.mode==='navigate'){
    e.respondWith(
      fetch(e.request,{cache:'no-store'}).then(r=>{
        const copy=r.clone();caches.open(CACHE).then(c=>c.put(FALLBACK,copy));return r;
      }).catch(()=>caches.match(FALLBACK))
    );
    return;
  }
  e.respondWith(
    fetch(e.request,{cache:'no-store'}).then(r=>{
      const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r;
    }).catch(()=>caches.match(e.request))
  );
});
