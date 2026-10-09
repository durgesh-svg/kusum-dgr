// CONFIG
const SUPABASE_URL='https://yvlagovdcxwmfkefdrnv.supabase.co';
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2bGFnb3ZkY3h3bWZrZWZkcm52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0ODc3ODQsImV4cCI6MjA4OTA2Mzc4NH0.uYH7pcSo-pi_ksVMTCWsTiLz5hlt5YZMaVuBRLQvlQ0';
const sb=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);

const DEFAULT_SITES=['Jamola','Dausar','Haspur','Pahel','Khakholi','Jetpura','Sindhu-1','Sindhu-2',
  'Kherla nagar-1','Kherla nagar-2','Ratnania Cohra','Birmana Tal','Nadiya Tal','Keshloi tal',
  'Udwala','Bidasar','Kunpalsar','Bhudhro Ki dhani','Ghantel','Dhirasar','Ramdevra-2','Purnadatal',
  'Badsar','Rajaldesar','Chitawa-1','Chitawa-2','Chitawa-3','Lalasar','Pilania pau','Choti serwa',
  'Rohisa','Khunkhuna','Satra-1','Satra-2','Godwanti Tal'];

const DEFAULT_GRID_REASONS=['Grid failure','GSS maintenance','Supply outage from 132 kV','Supply outage from 33 kV','Grid overvoltage','Grid undervoltage','Others'];
const DEFAULT_FAULT_CODES=['DO fuse burn','VCB fault (Plant end)','VCB fault (GSS end)','Termination kit failure','Transformer failure','LT panel fault','Inverter fault','Other faults'];
const MOG_OPTIONS=['Below 1/4','At 1/4','Between 1/4 & 1/2','At 1/2','Between 1/2 & 3/4','At 3/4','Above 3/4','Full'];

let session=null;
let sites=[];
let currentScreen=0;
let currentTab='dgr';

// ── ROLES ─────────────────────────────────────────────────────────────────────
// director > admin > manager > engineer.
// super_admin maps to admin and employee to engineer so accounts created by the
// other app sharing this users table degrade sensibly instead of falling through
// to the lowest tier (which is what happens today).
const ROLE_RANK={engineer:1,employee:1,manager:2,admin:3,super_admin:3,director:4};
const ROLE_LABEL={engineer:'Site Engineer',employee:'Site Engineer',manager:'Manager',
                  admin:'Admin',super_admin:'Admin',director:'Director'};
function roleRank(r){return ROLE_RANK[r]||1;}
function isEngineer(){return roleRank(session&&session.role)<=1;}
function isManagerUp(){return roleRank(session&&session.role)>=2;}
function isAdminUp(){return roleRank(session&&session.role)>=3;}
function isDirector(){return roleRank(session&&session.role)>=4;}

// ── Hash-based routing ────────────────────────────────────────────────────────
function navTo(hash){const t='#'+hash;if(window.location.hash!==t)history.pushState(null,'',t);}
function handleHashNav(){
  const raw=(window.location.hash||'').replace('#','').trim();
  const [page,sub]=(raw||'dgr').split('/');
  if(page==='history')switchTab('history');
  else if(page==='tickets'){switchTab('tickets');if(sub)setTimeout(()=>viewTicket(sub),0);}
  else if(page==='cleaning')showCleaning();
  else if(page==='review'&&session&&isManagerUp())switchTab('review');
  else if(page==='approvals'&&session&&isManagerUp())switchTab('approvals');
  else if(page==='admin'&&session&&isAdminUp()){if(sub)adminTab=sub;switchTab('admin');}
  else if(page==='insights'&&session&&isManagerUp())switchTab('insights');
  else if(page==='overview'&&session&&isManagerUp())switchTab('overview');
  else switchTab('dgr');
}
window.addEventListener('popstate',()=>{if(session&&session.loggedIn)handleHashNav();});
let formData={};
let photoFiles={};  // keyed by slot name
let acknowledgements={inv_zero:false,pr_low:false,temp_high:false};
let todaySubmissions={};
let appSettings={grid_outage_reasons:[...DEFAULT_GRID_REASONS],plant_fault_codes:[...DEFAULT_FAULT_CODES],
  ticket_l2_threshold:5000};
let progressDate=new Date().toISOString().split('T')[0]; // selected date for home progress widget
let show5Day=false; // 5-day panel toggle
let insightsDays=30;
let insightsSort='pr';
let _insightsCache=null;

async function loadAppSettings(){
  try{
    const{data,error}=await sb.from('dgr_settings').select('key,value');
    if(error)throw error;   // fall through to the localStorage fallback below
    if(data){
      data.forEach(r=>{
        // value is JSONB — parse it (strings come back as JS strings, arrays as arrays)
        const v=r.value;
        if(r.key==='grid_outage_reasons'&&v)appSettings.grid_outage_reasons=v;
        if(r.key==='plant_fault_codes'&&v)appSettings.plant_fault_codes=v;
        if(r.key==='ticket_l2_threshold'&&v!=null)appSettings.ticket_l2_threshold=Number(v)||0;
        if(r.key==='ticket_categories'&&v)appSettings.ticket_categories=v;
        if(r.key==='sheets_script_url')sheetsSettings.script_url=typeof v==='string'?v:(v||'');
        if(r.key==='sheets_sheet_id')sheetsSettings.sheet_id=typeof v==='string'?v:'1agcGb0nTi1u-hEOlHU1eXt30wsWyEeK_';
        if(r.key==='sheets_tab_name')sheetsSettings.tab_name=typeof v==='string'?v:'Raw Data';
        if(r.key==='sheets_last_sync')sheetsSettings.last_sync=typeof v==='string'?v:'';
      });
    }
    // persist to localStorage as fallback
    localStorage.setItem("dgr_app_settings",JSON.stringify(appSettings));
  }catch(e){
    // fallback to localStorage if DB unavailable
    const cached=localStorage.getItem("dgr_app_settings");
    if(cached){try{const s=JSON.parse(cached);if(s.grid_outage_reasons)appSettings.grid_outage_reasons=s.grid_outage_reasons;if(s.plant_fault_codes)appSettings.plant_fault_codes=s.plant_fault_codes;}catch(e2){}}
  }
}
let sheetsSettings={script_url:'',sheet_id:'1agcGb0nTi1u-hEOlHU1eXt30wsWyEeK_',tab_name:'Raw Data',last_sync:''};

// BOTTOM TABS
function buildBottomTabs(){
  const el=document.getElementById('bottomTabs');
  let tabs=[
    {id:'dgr',label:'DGR',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>'}
  ];
  // Managers and up get one Review tab holding Approvals, Overview and History;
  // engineers keep History on its own.
  if(isManagerUp())
    tabs.push({id:'review',label:'Review',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'});
  else
    tabs.push({id:'history',label:'History',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'});
  tabs.push({id:'tickets',label:'Tickets',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9V7a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4z"/><path d="M13 5v14"/></svg>'});
  if(isManagerUp())
    tabs.push({id:'insights',label:'Insights',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 4-8"/></svg>'});
  if(isAdminUp())
    tabs.push({id:'admin',label:'Admin',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197"/></svg>'});
  el.innerHTML=tabs.map(t=>`<div class="bottom-tab${t.id==='dgr'?' active':''}" data-tab="${t.id}" onclick="switchTab('${t.id}')">${t.icon}<span>${t.label}</span></div>`).join('');
  el.classList.remove('hidden');
}
// ── REVIEW TAB ────────────────────────────────────────────────────────────────
// Approvals, Overview and History under one bottom tab for managers and up.
// currentTab stays the sub-view's own id ('approvals' etc.) so the existing
// refresh paths keyed on it keep working; only the bottom-tab highlight and
// the segment bar know about 'review'.
const REVIEW_SUBS=[{id:'approvals',label:'Approvals'},{id:'overview',label:'Overview'},{id:'history',label:'History'}];
let reviewSub='approvals';
try{const s=localStorage.getItem('dgr_review_sub');if(REVIEW_SUBS.some(x=>x.id===s))reviewSub=s;}catch(e){}
function isReviewSub(tab){return isManagerUp()&&REVIEW_SUBS.some(x=>x.id===tab);}
function showReviewSeg(){
  const el=document.getElementById('reviewSeg');
  el.innerHTML=REVIEW_SUBS.map(s=>`<div class="review-seg-btn${s.id===reviewSub?' active':''}" onclick="switchTab('${s.id}')">${s.label}${s.id==='approvals'?'<span id="reviewPendingCount" class="review-seg-count"></span>':''}</div>`).join('');
  el.classList.remove('hidden');
  refreshReviewCount();
}
function refreshReviewCount(){
  if(!document.getElementById('reviewPendingCount'))return;
  sb.from('dgr_submissions').select('id',{count:'exact',head:true}).eq('status','pending').then(({count})=>{
    const c=document.getElementById('reviewPendingCount');
    if(c)c.textContent=count||'';
  });
}

function switchTab(tab){
  if(tab==='review')tab=reviewSub;
  const inReview=isReviewSub(tab);
  if(inReview){reviewSub=tab;try{localStorage.setItem('dgr_review_sub',tab);}catch(e){}}
  currentTab=tab;
  if(tab!=='admin')navTo(tab); // admin hash set by showAdmin() with sub-tab
  const activeTab=inReview?'review':tab;
  document.querySelectorAll('.bottom-tab').forEach(t=>{t.classList.toggle('active',t.dataset.tab===activeTab);});
  document.querySelectorAll('#screensWrap > div').forEach(d=>d.classList.add('hidden'));
  document.getElementById('headerBar').classList.add('hidden');
  document.getElementById('navBar').classList.add('hidden');
  document.getElementById('bottomTabs').classList.remove('hidden');
  if(tab==='dgr')showHomeScreen();
  else if(tab==='history')showHistory();
  else if(tab==='approvals')showApprovals();
  else if(tab==='admin')showAdmin();
  else if(tab==='insights')showInsights();
  else if(tab==='overview')showOverview();
  else if(tab==='tickets')showTickets();
  // after the dispatch: showOverview() hides every screen before its first await
  if(inReview)showReviewSeg();
}

// ── TOAST NOTIFICATION ───────────────────────────────────────────────────────
function showToast(msg,type='info'){
  let el=document.getElementById('dgrToast');
  if(!el){
    el=document.createElement('div');
    el.id='dgrToast';
    el.style.cssText='position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(20px);padding:10px 18px;border-radius:99px;font-size:12px;font-weight:600;z-index:9999;opacity:0;transition:all .3s;pointer-events:none;white-space:nowrap;max-width:90vw;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.18)';
    document.body.appendChild(el);
  }
  el.style.background=type==='success'?'#16a34a':type==='error'?'#b91c1c':'#1e293b';
  el.style.color='#fff';
  el.textContent=msg;
  el.style.opacity='1';
  el.style.transform='translateX(-50%) translateY(0)';
  clearTimeout(el._t);
  el._t=setTimeout(()=>{el.style.opacity='0';el.style.transform='translateX(-50%) translateY(20px)';},2800);
}

