window.addEventListener('online',()=>{document.getElementById('offlineBanner').classList.remove('show');syncQueue();});
window.addEventListener('offline',()=>{document.getElementById('offlineBanner').classList.add('show');});

// SERVICE WORKER
if('serviceWorker' in navigator){
  const swCode=`
    const CACHE='dgr-v4';
    const ASSETS=['/dgr.html','/dgr_manifest.json'];
    self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
    self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
    self.addEventListener('fetch',e=>{
      if(e.request.method!=='GET')return;
      e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
        if(resp.status===200){const c=resp.clone();caches.open(CACHE).then(cache=>cache.put(e.request,c));}
        return resp;
      }).catch(()=>caches.match('/dgr.html'))));
    });
  `;
  const blob=new Blob([swCode],{type:'application/javascript'});
  navigator.serviceWorker.register(URL.createObjectURL(blob)).catch(()=>navigator.serviceWorker.register('/dgr_sw.js').catch(()=>{}));
}

// INIT
(function init(){
  const saved=localStorage.getItem('dgr_session');
  if(saved){
    session=JSON.parse(saved);
    if(session&&session.loggedIn){
      if(session.must_change_pw){
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('pwChangeScreen').classList.remove('hidden');
      } else enterApp();
      return;
    }
  }
  document.getElementById('loginScreen').classList.remove('hidden');
  if(!navigator.onLine)document.getElementById('offlineBanner').classList.add('show');
})();
