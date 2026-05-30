window.addEventListener('online',()=>{document.getElementById('offlineBanner').classList.remove('show');syncQueue();});
window.addEventListener('offline',()=>{document.getElementById('offlineBanner').classList.add('show');});

// SPLASH SCREEN — logo animation 2 sec
(function(){
  const logo  = document.getElementById('splashLogo');
  const title = document.getElementById('splashTitle');
  const sub   = document.getElementById('splashSub');
  const splash= document.getElementById('splashScreen');
  if(!splash) return;
  // Trigger animation after a tiny delay so CSS transition fires
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      if(logo){logo.style.opacity='1';logo.style.transform='scale(1)';}
      if(title)title.style.opacity='1';
      if(sub)sub.style.opacity='1';
    });
  });
  // Hide after 2.2 seconds
  setTimeout(()=>{
    splash.style.opacity='0';
    setTimeout(()=>{ if(splash)splash.style.display='none'; },500);
  },2200);
})();

// SERVICE WORKER
if('serviceWorker' in navigator){
  const swCode=`
    const CACHE='dgr-v6';
    const ASSETS=['/dgr_manifest.json'];
    self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
    self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
    self.addEventListener('fetch',e=>{
      if(e.request.method!=='GET')return;
      // Never cache HTML — always fetch fresh so auto-update works
      if(e.request.url.endsWith('.html')||e.request.url.endsWith('/')){
        e.respondWith(fetch(e.request).catch(()=>caches.match('/dgr.html')));
        return;
      }
      e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
        if(resp.status===200){const c=resp.clone();caches.open(CACHE).then(cache=>cache.put(e.request,c));}
        return resp;
      }).catch(()=>caches.match('/dgr.html'))));
    });
  `;
  const blob=new Blob([swCode],{type:'application/javascript'});
  navigator.serviceWorker.register(URL.createObjectURL(blob)).catch(()=>navigator.serviceWorker.register('/dgr_sw.js').catch(()=>{}));
}

// AUTO-UPDATE: poll for new deployment every 5 min; reload when detected
(function startVersionWatch(){
  let _etag=null;
  async function checkUpdate(){
    if(!navigator.onLine)return;
    try{
      // HEAD request is NOT intercepted by SW (SW skips non-GET)
      const r=await fetch('/dgr.html',{method:'HEAD',cache:'no-store'});
      const tag=r.headers.get('etag')||r.headers.get('last-modified')||'';
      if(!tag)return;
      if(_etag===null){_etag=tag;return;}   // first run — store baseline
      if(tag!==_etag){
        console.log('[DGR] New version deployed — reloading');
        window.location.reload(true);
      }
    }catch(e){}
  }
  setTimeout(checkUpdate,8000);              // 8s after load — store baseline
  setInterval(checkUpdate,5*60*1000);        // then every 5 min
})();

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
