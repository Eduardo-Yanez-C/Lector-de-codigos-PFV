// Service Worker v3 — offline + OCR (Tesseract) cacheado
const CACHE='cso-lector-v13';
const ASSETS=[
  './','./index.html','./app.js','./auth.js','./paneles_db.js','./manifest.json',
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js','https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js','https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(u=>new Request(u,{mode:'no-cors'})))).then(()=>self.skipWaiting()).catch(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e=>{
  const u=e.request.url;
  if(u.includes('script.google.com')) return; // nunca cachear sync
  // Tesseract descarga su modelo de idioma en runtime: cachear cache-first
  e.respondWith(
    caches.match(e.request).then(r=>r || fetch(e.request).then(resp=>{
      if(e.request.method==='GET' && (resp.ok||resp.type==='opaque')){
        const cp=resp.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{});
      }
      return resp;
    }).catch(()=>caches.match('./index.html')))
  );
});
