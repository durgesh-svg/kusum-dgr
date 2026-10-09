// ─────────────────────────────────────────────────────────────────────────────
// ATTENDANCE — reads site check-ins from the expense portal.
//
// The expense portal (a separate Supabase project) already runs GPS check-ins
// with geofencing for the same engineers. Rather than rebuild that, the DGR app
// calls a read-only RPC there, dgr_checkin_status(phone, date), which returns
// only time, site, inside-fence flag and distance for the trailing 7 days.
//
// Matching: engineers by phone (users.attendance_phone overrides when the
// portal has a different number); sites by site_config.attendance_site_code,
// because names differ between the two systems and some portal locations
// cover several DGR sites.
//
// Loaded after cleaning.js, before app-init.js. Read-only against the portal;
// writes only the checkin_* columns on dgr_submissions at submit time.
// ─────────────────────────────────────────────────────────────────────────────

const ATT_URL='https://zsxnaslqursbdpvuzssn.supabase.co';
const ATT_ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzeG5hc2xxdXJzYmRwdnV6c3NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1Nzg3MjAsImV4cCI6MjA5NDE1NDcyMH0.oapTWilL2kLmpP2EJRK1TSwLiLnKBQt6nTSMLqcHH0Y';
const ATT_TIMEOUT_MS=4000;   // never let a slow portal hold up a DGR submission
const ATT_WINDOW_DAYS=7;     // the RPC refuses anything older

let _attClient=null;
function attClient(){
  // persistSession:false -- this client must not touch localStorage or auth
  if(!_attClient)_attClient=supabase.createClient(ATT_URL,ATT_ANON,{auth:{persistSession:false,autoRefreshToken:false}});
  return _attClient;
}
function attendancePhone(){return (session&&(session.attendance_phone||session.phone))||'';}
// The session is cached at login, so an attendance_phone set by an admin
// afterwards would never reach it. Read it fresh before every lookup.
let _attPhoneFresh=false;
async function freshAttendancePhone(){
  if(!_attPhoneFresh&&session&&session.userId){
    try{
      const{data}=await sb.from('users').select('attendance_phone').eq('id',session.userId).single();
      if(data){
        session.attendance_phone=data.attendance_phone||null;
        localStorage.setItem('dgr_session',JSON.stringify(session));
        _attPhoneFresh=true;
      }
    }catch(e){}
  }
  return attendancePhone();
}
function attSiteCode(siteName){const s=sites.find(x=>x.site_name===siteName);return s?(s.attendance_site_code||null):null;}
function attWithinWindow(dateStr){
  const d=new Date(dateStr+'T00:00:00'), lim=new Date();lim.setDate(lim.getDate()-ATT_WINDOW_DAYS);
  return d>=lim;
}
function attTime(ts){return ts?new Date(ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'';}

async function fetchCheckins(phone,dateStr){
  if(!phone||!navigator.onLine)return [];
  const call=attClient().rpc('dgr_checkin_status',{p_phone:phone,p_date:dateStr});
  const timeout=new Promise((_,rej)=>setTimeout(()=>rej(new Error('attendance timeout')),ATT_TIMEOUT_MS));
  const{data,error}=await Promise.race([call,timeout]);
  if(error)throw error;
  return data||[];
}

// {status, checkin}  status: verified | other_site | none | unmatched
function matchCheckin(checkins,siteName){
  const code=attSiteCode(siteName);
  if(!checkins.length)return{status:'none',checkin:null};
  if(!code)return{status:'unmatched',checkin:checkins[0]};
  const hit=checkins.find(c=>c.site_code===code&&!c.blocked);
  if(hit)return{status:'verified',checkin:hit};
  return{status:'other_site',checkin:checkins[0]};
}

// Fields to merge into a dgr_submissions payload. Never throws.
async function stampCheckin(siteName,dateStr){
  if(!attWithinWindow(dateStr))return{};              // portal won't answer; leave unstamped
  try{
    const m=matchCheckin(await fetchCheckins(await freshAttendancePhone(),dateStr),siteName);
    return{
      checkin_status:m.status,
      checkin_at:m.checkin?m.checkin.checked_at:null,
      checkin_site:m.checkin?m.checkin.site_name:null
    };
  }catch(e){return{checkin_status:'error',checkin_at:null,checkin_site:null};}
}

// Badge for approval cards and the submission view
function checkinBadge(d){
  if(!d||!d.checkin_status)return '';
  const t=d.checkin_at?' '+attTime(d.checkin_at):'';
  switch(d.checkin_status){
    case 'verified':   return `<span class="badge badge-green" title="Checked in at ${escHtml(d.checkin_site||'')}">✓ On site${t}</span>`;
    case 'other_site': return `<span class="badge badge-red" title="Checked in at ${escHtml(d.checkin_site||'')}">⚠ Checked in elsewhere</span>`;
    case 'none':       return `<span class="badge badge-yellow">⚠ No check-in</span>`;
    case 'unmatched':  return `<span class="badge badge-gray" title="Site has no attendance location mapped">Check-in: site unmapped</span>`;
    default:           return `<span class="badge badge-gray">Check-in: unavailable</span>`;
  }
}

// Home-screen card. Replaces the earlier Field Visit placeholder, whose
// buttons called functions that never existed. Engineers only.
async function buildAttendanceCard(){
  if(!isEngineer())return '';
  const today=new Date().toISOString().split('T')[0];
  let checkins=null;
  try{checkins=await fetchCheckins(await freshAttendancePhone(),today);}catch(e){}
  let bg='#fff',border='var(--border)',title='📍 Site check-in',color='var(--gray)',body;
  if(checkins===null){
    body='Attendance portal not reachable';
  }else if(!checkins.length){
    body='No check-in recorded today';
    bg='var(--amber-light)';border='var(--amber-border)';color='var(--amber)';
  }else{
    const c=checkins[0];
    const fence=c.inside_fence?'inside fence':`${c.distance_m||'?'} m from site`;
    title='🟢 Checked in';bg='#f0fdf4';border='var(--green-border)';color='var(--green-dark)';
    body=`<strong>${escHtml(c.site_name)}</strong> · ${attTime(c.checked_at)} · ${fence}`;
  }
  return `
    <div style="padding:0 14px;margin-bottom:0">
      <div style="background:${bg};border:1.5px solid ${border};border-radius:10px;padding:10px 12px">
        <div style="font-size:10px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:.05em">${title}</div>
        <div style="font-size:12px;color:var(--text);margin-top:2px">${body}</div>
        <div style="font-size:9.5px;color:var(--text-muted);margin-top:3px">Recorded in the expense portal; it is stamped on the report you submit today.</div>
      </div>
    </div>`;
}
