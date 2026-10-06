// AUTH
async function hashPassword(pwd){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pwd));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function togglePw(id,btn){
  const inp=document.getElementById(id);
  if(inp.type==='password'){inp.type='text';btn.textContent='🙈';}
  else{inp.type='password';btn.textContent='👁';}
}
async function doLogin(){
  const phone=document.getElementById('loginPhone').value.trim();
  const pw=document.getElementById('loginPw').value;
  const errEl=document.getElementById('loginError');
  errEl.classList.add('hidden');
  if(!phone||!pw){errEl.textContent='Enter phone and password';errEl.classList.remove('hidden');return;}
  const hash=await hashPassword(pw);
  const{data,error}=await sb.from('users').select('*').eq('phone',phone).single();
  if(error||!data){errEl.textContent='User not found';errEl.classList.remove('hidden');return;}
  if(data.active===false){errEl.textContent='This account has been deactivated. Contact your admin.';errEl.classList.remove('hidden');return;}
  if(!data.password_hash||data.password_hash!==hash){errEl.textContent='Incorrect password';errEl.classList.remove('hidden');return;}
  session={phone:data.phone,name:data.name,role:data.role,active:data.active!==false,attendance_phone:data.attendance_phone||null,assigned_sites:data.assigned_sites||[],loggedIn:true,userId:data.id,must_change_pw:data.must_change_pw};
  localStorage.setItem('dgr_session',JSON.stringify(session));
  if(session.must_change_pw){
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('pwChangeScreen').classList.remove('hidden');
  } else {enterApp();}
}
async function doChangePw(){
  const p1=document.getElementById('newPw1').value;
  const p2=document.getElementById('newPw2').value;
  const errEl=document.getElementById('pwChangeError');
  errEl.classList.add('hidden');
  if(p1.length<8){errEl.textContent='Min 8 characters';errEl.classList.remove('hidden');return;}
  if(p1!==p2){errEl.textContent='Passwords do not match';errEl.classList.remove('hidden');return;}
  const hash=await hashPassword(p1);
  await sb.from('users').update({password_hash:hash,must_change_pw:false}).eq('phone',session.phone);
  session.must_change_pw=false;
  localStorage.setItem('dgr_session',JSON.stringify(session));
  document.getElementById('pwChangeScreen').classList.add('hidden');
  enterApp();
}
let _realtimeChannel=null;
let _pollInterval=null;
const POLL_MS=30000;

function _refreshCurrentScreen(){
  if(currentTab==='dgr'&&currentScreen===0)showHomeScreen();
  else if(currentTab==='approvals')showApprovals();
  else if(currentTab==='history')loadHistory();
}

function logout(){
  if(_realtimeChannel){sb.removeChannel(_realtimeChannel);_realtimeChannel=null;}
  if(_pollInterval){clearInterval(_pollInterval);_pollInterval=null;}
  document.removeEventListener('visibilitychange',_onVisibility);
  window.removeEventListener('online',_onOnline);
  localStorage.removeItem('dgr_session');
  session=null;
  document.getElementById('appWrap').classList.add('hidden');
  document.getElementById('bottomTabs').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
}

// APP ENTRY
async function enterApp(){
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('pwChangeScreen').classList.add('hidden');
  document.getElementById('appWrap').classList.remove('hidden');
  await Promise.all([loadSites(),loadAppSettings()]);
  buildBottomTabs();
  buildDevBar();
  handleHashNav();
  _startRealtime();
  _startPolling();
  document.addEventListener('visibilitychange',_onVisibility);
  window.addEventListener('online',_onOnline);
}

function _startRealtime(){
  if(_realtimeChannel)sb.removeChannel(_realtimeChannel);
  _realtimeChannel=sb.channel('dgr-submissions-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'dgr_submissions'},()=>{
      _refreshCurrentScreen();
    })
    .subscribe();
}

function _startPolling(){
  if(_pollInterval)clearInterval(_pollInterval);
  _pollInterval=setInterval(()=>{
    if(navigator.onLine&&document.visibilityState==='visible')_refreshCurrentScreen();
  },POLL_MS);
}

function _onVisibility(){
  if(document.visibilityState==='visible'){
    _startRealtime();
    _refreshCurrentScreen();
  }
}

function _onOnline(){
  _startRealtime();
  _refreshCurrentScreen();
}
// NOTE: loadSites must never WRITE to site_config.
// It runs on every login for all 73 users. It used to seed DEFAULT_SITES with
// null capacities whenever the read came back empty — and because supabase-js
// returns {data:null,error} instead of throwing, a single failed request on any
// one user's phone took that branch and wiped inverter_count / dc_capacity_kw /
// ac_capacity_kw / strings_per_inv for all 35 seeded sites. Seeding is an admin
// action (Admin > Sites), not something a login may do.
async function loadSites(){
  const useCache=()=>{
    const cached=localStorage.getItem('dgr_sites');
    if(!cached){sites=[];return;}
    try{sites=JSON.parse(cached)||[];}catch(e){sites=[];}
  };
  try{
    const{data,error}=await sb.from('site_config').select('*').eq('active',true).order('site_name');
    if(error||!data||data.length===0){
      // An empty or failed read is NOT proof the table is empty. Fall back to the
      // last known good list; never overwrite server config from here.
      console.warn('[DGR] site_config unavailable, using cached sites:',error?error.message:'empty result');
      useCache();
      return;
    }
    sites=data;
    localStorage.setItem('dgr_sites',JSON.stringify(data));
  }catch(e){
    useCache();
  }
}

// ── DEV ROLE PREVIEW ──────────────────────────────────────────────────────────
// Rendered only when the URL carries ?dev=1. Switches session.role in memory for
// this tab; nothing is written to the database or localStorage, and one reload
// restores the real role. It previews the UI a role sees -- it cannot preview
// server-side enforcement, because authorization here is entirely client-side.
const DEV_MODE=new URLSearchParams(location.search).get('dev')==='1';
let _realRole=null;
function buildDevBar(){
  if(!DEV_MODE||!session)return;
  if(_realRole===null)_realRole=session.role;
  let el=document.getElementById('devBar');
  if(!el){
    el=document.createElement('div');
    el.id='devBar';
    el.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:300;background:#1e293b;'+
      'color:#fff;display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:10px;'+
      'padding:6px 10px calc(6px + env(safe-area-inset-bottom,0px))';
    document.body.appendChild(el);
  }
  const btn='font:inherit;font-size:10px;font-weight:600;cursor:pointer;padding:4px 9px;border-radius:6px;';
  el.innerHTML='<b style="color:#fbbf24;letter-spacing:.05em;font-size:9px">PREVIEW AS</b>'+
    ['engineer','manager','admin','director'].map(r=>
      `<button style="${btn}${session.role===r
        ?'background:#fbbf24;color:#1e293b;border:1px solid #fbbf24'
        :'background:#334155;color:#cbd5e1;border:1px solid #475569'}" `+
      `onclick="devSetRole('${r}')">${ROLE_LABEL[r]}</button>`).join('')+
    `<span style="margin-left:auto;opacity:.6;white-space:nowrap">actual: ${ROLE_LABEL[_realRole]||_realRole}</span>`;
  _syncDevBarOffset();
}
// Lift the tab bar clear of the dev bar. Recomputed on resize because the bar
// wraps to a second line on narrow screens, and measured synchronously because
// rAF does not fire while the tab is backgrounded.
function _syncDevBarOffset(){
  const bar=document.getElementById('devBar');
  const tabs=document.getElementById('bottomTabs');
  if(bar&&tabs)tabs.style.marginBottom=bar.offsetHeight+'px';
}
if(DEV_MODE){
  window.addEventListener('resize',_syncDevBarOffset);
  window.addEventListener('orientationchange',_syncDevBarOffset);
}
function devSetRole(r){
  session.role=r;
  buildBottomTabs();
  buildDevBar();
  switchTab('dgr');
}
