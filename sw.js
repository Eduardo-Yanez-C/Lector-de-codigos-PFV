// Service Worker — cachea la app para uso offline en terreno
const CACHE='cso-lector-v1';
const ASSETS=[
  './','./index.html','./app.js','./paneles_db.js','./manifest.json',
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e=>{
  const u=e.request.url;
  // nunca cachear las llamadas de sync a Apps Script
  if(u.includes('script.google.com')) return;
  e.respondWith(
    caches.match(e.request).then(r=>r || fetch(e.request).then(resp=>{
      if(e.request.method==='GET' && resp.ok){
        const cp=resp.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp));
      }
      return resp;
    }).catch(()=>caches.match('./index.html')))
  );
});
