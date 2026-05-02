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
  if(data.password_hash!==hash){errEl.textContent='Incorrect password';errEl.classList.remove('hidden');return;}
  session={phone:data.phone,name:data.name,role:data.role,assigned_sites:data.assigned_sites||[],loggedIn:true,userId:data.id,must_change_pw:data.must_change_pw};
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
async function loadSites(){
  try{
    const{data}=await sb.from('site_config').select('*').eq('active',true).order('site_name');
    if(data&&data.length>0){sites=data;localStorage.setItem('dgr_sites',JSON.stringify(data));}
    else{
      const rows=DEFAULT_SITES.map(n=>({site_name:n,dc_capacity_kw:null,ac_capacity_kw:null,inverter_count:null,strings_per_inv:null,active:true}));
      await sb.from('site_config').upsert(rows,{onConflict:'site_name'});
      const{data:d2}=await sb.from('site_config').select('*').eq('active',true).order('site_name');
      sites=d2||[];
      localStorage.setItem('dgr_sites',JSON.stringify(sites));
    }
  }catch(e){
    const cached=localStorage.getItem('dgr_sites');
    if(cached)sites=JSON.parse(cached);
  }
}
