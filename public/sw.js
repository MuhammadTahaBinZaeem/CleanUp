const CACHE = 'cleanup-v0.14.8';
const CORE = ['/', '/styles.css?v=0.14.8', '/app.js?v=0.14.8', '/manifest.webmanifest?v=0.14.8', '/icon.svg?v=0.14.8'];
self.addEventListener('install', (event) => { self.skipWaiting(); event.waitUntil(caches.open(CACHE).then((cache)=>cache.addAll(CORE))); });
self.addEventListener('activate', (event) => { event.waitUntil(caches.keys().then((keys)=>Promise.all(keys.filter((key)=>key.startsWith('cleanup-v')&&key!==CACHE).map((key)=>caches.delete(key)))).then(()=>self.clients.claim())); });
function cacheable(response) { return response?.ok && !/\bno-store\b/i.test(response.headers.get('cache-control')||''); }
function networkAndRefresh(request, event) {
  const network=fetch(request);
  const refresh=network.then(async (response)=>{
    if(cacheable(response)) await caches.open(CACHE).then((cache)=>cache.put(request,response.clone()));
  }).catch(()=>{});
  event.waitUntil(refresh);
  return network;
}
self.addEventListener('fetch', (event) => {
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')) return;
  if(event.request.mode==='navigate') {
    event.respondWith((async()=>{
      const network=networkAndRefresh(event.request,event);
      const quick=new Promise((resolve)=>setTimeout(()=>resolve(null),1200));
      const fresh=await Promise.race([network.catch(()=>null),quick]);
      if(fresh) return fresh;
      const cached=await caches.match(event.request) || await caches.match('/');
      if(cached) { event.waitUntil(network.catch(()=>{})); return cached; }
      return network;
    })()); return;
  }
  event.respondWith((async()=>{ try{return await networkAndRefresh(event.request,event);}catch{return (await caches.match(event.request))||Response.error();} })());
});
