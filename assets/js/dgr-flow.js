let homeSiteFilter='all';

function getHomeSiteCategory(sub){
  if(sub&&sub.status==='approved')return 'approved';
  if(sub)return 'pending';
  return 'not_done';
}

function setHomeSiteFilter(filter){
  homeSiteFilter=filter;
  showHomeScreen();
}

async function showHomeScreen(){
  currentScreen=0;
  document.getElementById('headerBar').classList.add('hidden');
  document.getElementById('navBar').classList.add('hidden');
  const el=document.getElementById('screen0');
  el.classList.remove('hidden');
  const mySites=session.role==='engineer'?sites.filter(s=>session.assigned_sites.includes(s.site_name)):sites;
  const todayStr=new Date().toISOString().split('T')[0];
  const isToday=progressDate===todayStr;
  const dateLabel=isToday?'Today':new Date(progressDate+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
  try{
    const{data}=await sb.from('dgr_submissions').select('id,site_name,status,submitted_by_name,created_at,review_note,reviewed_by,reviewed_at').eq('report_date',progressDate);
    todaySubmissions={};
    if(data)data.forEach(d=>{todaySubmissions[d.site_name]=d;});
  }catch(e){}
  let approved=0,pending=0,notDone=0;
  mySites.forEach(s=>{
    const sub=todaySubmissions[s.site_name];
    const category=getHomeSiteCategory(sub);
    if(category==='approved')approved++;
    else if(category==='pending')pending++;
    else notDone++;
  });
  const dateStr=new Date().toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
  const total=mySites.length||1;
  const reportedPct=Math.round(((approved+pending)/total)*100);
  const filteredSites=mySites.filter(s=>{
    if(homeSiteFilter==='all')return true;
    const sub=todaySubmissions[s.site_name];
    return getHomeSiteCategory(sub)===homeSiteFilter;
  });

  el.innerHTML=`
    <div class="home-header">
      <div class="home-header-row">
        <div>
          <div class="home-header-brand">PM KUSUM · Stockwell Solar</div>
          <div class="home-header-title">Field Reports</div>
          <div style="font-size:10px;opacity:.65;margin-top:2px">${dateStr} · ${session.name||session.phone}</div>
        </div>
        <button class="home-logout" onclick="logout()">Logout</button>
      </div>
    </div>
    <div class="home-progress">
      <div class="home-progress-top">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <button onclick="changeProgressDate(-1)" style="background:none;border:none;cursor:pointer;padding:0 4px;color:var(--primary);font-size:26px;line-height:1">‹</button>
            <input type="date" value="${progressDate}" max="${todayStr}" onchange="progressDate=this.value;show5Day=false;showHomeScreen()" style="border:none;background:none;font-size:13px;font-weight:700;color:var(--text);cursor:pointer;padding:0;width:120px;outline:none">
            <button onclick="changeProgressDate(1)" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:26px;line-height:1;${isToday?'opacity:.2;pointer-events:none;color:var(--gray);':'color:var(--primary);'}">›</button>
          </div>
          <div class="home-progress-num">${approved+pending} <span>/ ${mySites.length} sites</span></div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px">
          <div class="home-progress-pct">${reportedPct}% reported</div>
          <button onclick="toggle5Day()" style="font-size:9px;color:var(--primary);background:none;border:none;cursor:pointer;padding:0;font-weight:600;letter-spacing:.02em">${show5Day?'Hide ↑':'5 Days ↗'}</button>
        </div>
      </div>
      <div class="home-progress-bar"><div class="home-progress-fill" style="width:${reportedPct}%"></div></div>
      <div class="home-progress-chips">
        <span class="hpchip hpchip-green${homeSiteFilter==='approved'?' active':''}" onclick="setHomeSiteFilter('${homeSiteFilter==='approved'?'all':'approved'}')">✓ ${approved} Approved</span>
        <span class="hpchip hpchip-amber${homeSiteFilter==='pending'?' active':''}" onclick="setHomeSiteFilter('${homeSiteFilter==='pending'?'all':'pending'}')">◷ ${pending} Pending</span>
        <span class="hpchip hpchip-gray${homeSiteFilter==='not_done'?' active':''}" onclick="setHomeSiteFilter('${homeSiteFilter==='not_done'?'all':'not_done'}')">○ ${notDone} Not done</span>
      </div>
      ${show5Day?await build5DayPanel(mySites):''}
    </div>
    <div style="font-size:10px;font-weight:600;color:var(--gray);text-transform:uppercase;letter-spacing:.06em;padding:12px 14px 4px">Your Sites</div>
    <div style="padding:0 14px 80px">
    ${filteredSites.map(s=>{
      const sub=todaySubmissions[s.site_name];
      const isReturned=sub&&sub.status==='pending'&&!!(sub.review_note&&String(sub.review_note).trim());
      let iconCls='site-icon-todo',iconHtml='<span class="material-symbols-outlined" style="font-size:20px;color:var(--gray)">solar_power</span>';
      let badgeHtml=`<span class="badge badge-gray">Fill now →</span>`;
      if(sub&&sub.status==='approved'){
        iconCls='site-icon-ok';
        iconHtml='<span class="material-symbols-outlined" style="font-size:20px;color:#16a34a;font-variation-settings:\'FILL\' 1">check_circle</span>';
        badgeHtml='<span class="badge badge-green">Approved</span>';
      } else if(sub){
        iconCls='site-icon-pending';
        iconHtml='<span class="material-symbols-outlined" style="font-size:20px;color:#a16207">schedule</span>';
        badgeHtml=isReturned?'<span class="badge badge-yellow">Returned</span>':'<span class="badge badge-yellow">Pending</span>';
      }
      const cap=s.dc_capacity_kw?`${s.dc_capacity_kw} kW · ${s.inverter_count||'?'} inv`:'Not configured';
      return `<div class="site-card-new" onclick="${isReturned?`editSubmission('${sub.id}')`:`startDGR('${s.site_name}')`}">
        <div class="site-icon ${iconCls}">${iconHtml}</div>
        <div class="site-card-info">
          <div class="site-card-name">${s.site_name}</div>
          <div class="site-card-cap">${cap}</div>
        </div>
        <div style="display:flex;align-items:center;gap:4px">${badgeHtml}<span class="material-symbols-outlined" style="font-size:18px;color:var(--gray)">chevron_right</span></div>
      </div>`;
    }).join('')}
    ${mySites.length===0?'<div class="card" style="text-align:center;color:var(--gray);padding:20px">No sites assigned. Contact your admin.</div>':''}
    ${mySites.length>0&&filteredSites.length===0?'<div class="card" style="text-align:center;color:var(--gray);padding:20px">No sites match this filter</div>':''}
    </div>
  `;
}

// PROGRESS DATE NAV
function changeProgressDate(delta){
  const d=new Date(progressDate+'T00:00:00');
  d.setDate(d.getDate()+delta);
  const next=d.toISOString().split('T')[0];
  const todayStr=new Date().toISOString().split('T')[0];
  if(next>todayStr)return;
  progressDate=next;
  show5Day=false;
  showHomeScreen();
}
function toggle5Day(){show5Day=!show5Day;showHomeScreen();}
async function build5DayPanel(mySites){
  const dates=[];
  const base=new Date(progressDate+'T00:00:00');
  for(let i=0;i<5;i++){const d=new Date(base);d.setDate(base.getDate()-i);dates.push(d.toISOString().split('T')[0]);}
  let q=sb.from('dgr_submissions').select('site_name,status,report_date').in('report_date',dates);
  if(session.role==='engineer')q=q.eq('submitted_by_phone',session.phone);
  let data=[];
  try{const r=await q;data=r.data||[];}catch(e){}
  const byDate={};
  dates.forEach(d=>{byDate[d]={approved:0,pending:0};});
  data.forEach(r=>{
    if(!byDate[r.report_date])return;
    if(r.status==='approved')byDate[r.report_date].approved++;
    else byDate[r.report_date].pending++;
  });
  const total=mySites.length||1;
  const todayStr=new Date().toISOString().split('T')[0];
  const rows=dates.map(d=>{
    const{approved,pending}=byDate[d];
    const left=total-approved-pending;
    const pct=Math.round(((approved+pending)/total)*100);
    const isSelected=d===progressDate;
    const label=d===todayStr?'Today':new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
    return `<tr style="cursor:pointer;${isSelected?'background:#eef2ff;':''}border-bottom:1px solid var(--border)" onclick="progressDate='${d}';show5Day=true;showHomeScreen()">
      <td style="padding:6px 6px;font-size:10px;font-weight:${isSelected?'700':'400'}">${label}</td>
      <td style="padding:6px 6px;font-size:10px;color:var(--green-dark);text-align:center">${approved}</td>
      <td style="padding:6px 6px;font-size:10px;color:var(--amber);text-align:center">${pending}</td>
      <td style="padding:6px 6px;font-size:10px;color:var(--gray);text-align:center">${left}</td>
      <td style="padding:6px 6px;font-size:10px;font-weight:600;text-align:right">${pct}%</td>
    </tr>`;
  }).join('');
  return `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:6px">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="border-bottom:1px solid var(--border)">
        <th style="padding:3px 6px;font-size:9px;color:var(--gray);font-weight:600;text-align:left">Date</th>
        <th style="padding:3px 6px;font-size:9px;color:var(--green-dark);font-weight:600;text-align:center">✓ App</th>
        <th style="padding:3px 6px;font-size:9px;color:var(--amber);font-weight:600;text-align:center">◷ Pend</th>
        <th style="padding:3px 6px;font-size:9px;color:var(--gray);font-weight:600;text-align:center">○ Left</th>
        <th style="padding:3px 6px;font-size:9px;color:var(--gray);font-weight:600;text-align:right">%</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// START DGR
function startDGR(siteName){
  const site=sites.find(s=>s.site_name===siteName);
  const n=site?site.inverter_count||6:6;
  formData={
    site_name:siteName,
    report_date:new Date().toISOString().split('T')[0],
    dc_capacity_kw:site?site.dc_capacity_kw:null,
    ac_capacity_kw:site?site.ac_capacity_kw:null,
    inverter_count:n,
    strings_per_inv:site?site.strings_per_inv:[],
    submitted_by_name:session.name||session.phone,
    submitted_by_phone:session.phone,
    // Inverter
    inv_gen:new Array(n).fill(0),
    inv_modules_cleaned:new Array(n).fill(null).map(()=>({cleaned:'',total:''})),
    total_gen_kwh:0,
    // Performance
    peak_radiation_wm2:null,poa_kwh_m2:null,peak_power_kwh:null,
    dc_cuf_pct:0,ac_cuf_pct:0,pr_pct:0,
    // Grid outage
    grid_outage:false,
    grid_outage_details:[],
    // Plant outage
    plant_outage:false,
    plant_outage_details:[],
    // Transformer
    wti_c:null,wti_peak_time:'',
    oti_c:null,oti_peak_time:'',
    mog_level:'',
    silica_gel:'',
    // Cleaning
    cleaning_c1_status:'not-started',cleaning_c1_tds:null,
    cleaning_c2_status:'not-started',cleaning_c2_tds:null,
    cleaning_c3_status:'not-started',cleaning_c3_tds:null,
    modules_cleaned_today:null,modules_total:null,
    // Weather
    weather:'',
    rain:false,rain_intensity:'',rain_modules_cleaned:false,
    weather_avg_ambient_c:null,weather_max_ambient_c:null,
    weather_avg_module_c:null,weather_max_module_c:null,
    daily_activity:'',
    remarks:'',
    image_urls:[]
  };
  photoFiles={};
  acknowledgements={inv_zero:false,pr_low:false,temp_high:false};
  fetchWeatherAuto(site);
  goToScreen(1);
}

async function editSubmission(id){
  try{
    const{data,error}=await sb.from('dgr_submissions').select('*').eq('id',id).single();
    if(error||!data){alert('Could not load report to edit.');return;}
    if(session.role==='engineer' && data.submitted_by_phone!==session.phone){
      alert('You can only edit your own reports.');
      return;
    }

    const site=sites.find(s=>s.site_name===data.site_name);
    const n=site?site.inverter_count||6:(Array.isArray(data.inv_gen)?data.inv_gen.length:6);

    formData={
      ...data,
      inverter_count:n,
      strings_per_inv:(data.inv_strings||site?.strings_per_inv||[]),
      inv_gen:Array.isArray(data.inv_gen)?data.inv_gen:new Array(n).fill(0),
      inv_modules_cleaned:Array.isArray(data.inv_modules_cleaned)?data.inv_modules_cleaned:new Array(n).fill(null).map(()=>({cleaned:'',total:''})),
      grid_outage_details:Array.isArray(data.grid_outage_details)?data.grid_outage_details:[],
      plant_outage_details:Array.isArray(data.plant_outage_details)?data.plant_outage_details:[],
    };

    if(formData.inv_gen.length!==n)formData.inv_gen=new Array(n).fill(0).map((_,i)=>+formData.inv_gen[i]||0);
    if(formData.inv_modules_cleaned.length!==n){
      const base=formData.inv_modules_cleaned||[];
      formData.inv_modules_cleaned=new Array(n).fill(null).map((_,i)=>base[i]||{cleaned:'',total:''});
    }

    photoFiles={};
    acknowledgements={inv_zero:false,pr_low:false,temp_high:false};

    if(formData.status==='pending' && formData.review_note){
      alert(`Returned for correction:\n${String(formData.review_note)}`);
    }

    switchTab('dgr');
    goToScreen(1);
  }catch(e){
    alert('Could not load report: '+(e?.message||e));
  }
}

// WEATHER AUTO
async function fetchWeatherAuto(site){
  if(!site||!site.latitude||!site.longitude)return;
  try{
    const d=formData.report_date;
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${site.latitude}&longitude=${site.longitude}&hourly=temperature_2m,cloud_cover,shortwave_radiation,precipitation,wind_speed_10m&timezone=Asia/Kolkata&start_date=${d}&end_date=${d}`;
    const resp=await fetch(url);
    const json=await resp.json();
    if(!json.hourly)return;
    const h=json.hourly;
    const temps=[],clouds=[],ghis=[],precips=[];
    for(let i=8;i<=17;i++){
      if(h.temperature_2m[i]!=null)temps.push(h.temperature_2m[i]);
      if(h.cloud_cover[i]!=null)clouds.push(h.cloud_cover[i]);
      if(h.shortwave_radiation[i]!=null)ghis.push(h.shortwave_radiation[i]);
      if(h.precipitation[i]!=null)precips.push(h.precipitation[i]);
    }
    formData.weather_auto={
      gen_hours_temp_max:temps.length?Math.max(...temps):null,
      gen_hours_temp_avg:temps.length?+(temps.reduce((a,b)=>a+b,0)/temps.length).toFixed(1):null,
      gen_hours_cloud_pct:clouds.length?+(clouds.reduce((a,b)=>a+b,0)/clouds.length).toFixed(1):null,
      gen_hours_ghi_peak:ghis.length?Math.max(...ghis):null,
      gen_hours_ghi_sum:ghis.length?+ghis.reduce((a,b)=>a+b,0).toFixed(1):null,
      effective_sun_hours:ghis.filter(g=>g>200).length,
      precipitation_mm:precips.reduce((a,b)=>a+b,0),
      thermal_loss_pct:temps.length?+(Math.max(0,(Math.max(...temps)-25)*0.4)).toFixed(1):null
    };
  }catch(e){}
}

// NAVIGATION
function goToScreen(n){
  document.querySelectorAll('#screensWrap > div').forEach(d=>d.classList.add('hidden'));
  currentScreen=n;
  const el=document.getElementById('screen'+n);
  el.classList.remove('hidden');
  const hdr=document.getElementById('headerBar');
  const titles=['','Site & Date','Inverter Generation','Performance','Grid & Plant Outage','Transformer','Cleaning','Weather & Activity','Photos','Review & Submit'];
  if(n>=1&&n<=9){
    hdr.classList.remove('hidden');
    const sitePart=formData.site_name?` · ${formData.site_name}`:'';
    document.getElementById('headerTitle').textContent=(titles[n]||'')+sitePart;
    const kwhPart=n>=2&&formData.total_gen_kwh?` · ${(+formData.total_gen_kwh).toLocaleString('en-IN')} kWh`:'';
    document.getElementById('headerSub').textContent=`Step ${n} of 9${kwhPart}`;
    const badge=document.getElementById('headerBadge');
    if(n===2&&formData.inverter_count){
      const totalStr=(formData.strings_per_inv||[]).reduce((a,b)=>a+b,0);
      badge.innerHTML=`<span class="badge badge-blue">${formData.inverter_count} inv · ${totalStr} str</span>`;
    } else badge.innerHTML='';
    const dots=document.getElementById('progressDots');
    let dotsHtml='';
    for(let i=1;i<=9;i++){
      let cls='progress-dot';
      if(i<n)cls+=' done';else if(i===n)cls+=' active';
      dotsHtml+=`<div class="${cls}"></div>`;
    }
    dots.innerHTML=dotsHtml;
  } else hdr.classList.add('hidden');
  const nav=document.getElementById('navBar');
  if(n>=1&&n<=9){
    nav.classList.remove('hidden');
    const nextBtn=document.getElementById('btnNext');
    nextBtn.textContent=n===9?'Submit Report':'Next →';
    nextBtn.disabled=false;
  } else nav.classList.add('hidden');
  if(n===1)buildScreen1();
  else if(n===2)buildScreen2();
  else if(n===3)buildScreen3();
  else if(n===4)buildScreen4();
  else if(n===5)buildScreen5();
  else if(n===6)buildScreen6();
  else if(n===7)buildScreen7();
  else if(n===8)buildScreen8();
  else if(n===9)buildScreen9();
  else if(n===10)buildScreen10();
  document.getElementById('bottomTabs').classList.toggle('hidden',n>=1&&n<=10);
  window.scrollTo(0,0);
}
function goBack(){if(currentScreen>1)goToScreen(currentScreen-1);else switchTab('dgr');}
function goNext(){if(currentScreen===9){submitReport();return;}if(currentScreen<10)goToScreen(currentScreen+1);}
// SCREEN 1: SITE & DATE
function buildScreen1(){
  const el=document.getElementById('screen1');
  const mySites=session.role==='engineer'?sites.filter(s=>session.assigned_sites.includes(s.site_name)):sites;
  const site=sites.find(s=>s.site_name===formData.site_name);
  el.innerHTML=`
    <div class="card">
      <div class="card-title">Site details</div>
      <div style="margin-bottom:8px">
        <label>Site name</label>
        <select id="s1Site" class="${formData.site_name?'input-ok':''}" onchange="onSiteChange(this.value)">
          <option value="">Select site</option>
          ${mySites.map(s=>`<option value="${s.site_name}"${s.site_name===formData.site_name?' selected':''}>${s.site_name}</option>`).join('')}
        </select>
      </div>
      <div style="margin-bottom:8px">
        <label>Report date</label>
        <input type="date" id="s1Date" value="${formData.report_date}" class="input-ok" onchange="onDateChange(this.value)">
      </div>
      <div id="s1Duplicate"></div>
      <div class="grid-2" style="margin-top:6px">
        <div><label>DC capacity (kW)</label><input type="text" value="${formData.dc_capacity_kw||'—'}" readonly class="readonly"><div class="text-hint" style="margin-top:2px">Pre-configured</div></div>
        <div><label>AC capacity (kW)</label><input type="text" value="${formData.ac_capacity_kw||'—'}" readonly class="readonly"><div class="text-hint" style="margin-top:2px">Pre-configured</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Submitted by</div>
      <input type="text" value="${formData.submitted_by_name}" readonly class="readonly">
    </div>
  `;
  checkDuplicate();
}
function onSiteChange(v){
  formData.site_name=v;
  const site=sites.find(s=>s.site_name===v);
  if(site){
    formData.dc_capacity_kw=site.dc_capacity_kw;
    formData.ac_capacity_kw=site.ac_capacity_kw;
    const n=site.inverter_count||6;
    formData.inverter_count=n;
    formData.strings_per_inv=site.strings_per_inv||[];
    formData.inv_gen=new Array(n).fill(0);
    formData.inv_modules_cleaned=new Array(n).fill(null).map(()=>({cleaned:'',total:''}));
    fetchWeatherAuto(site);
  }
  buildScreen1();
}
function onDateChange(v){formData.report_date=v;checkDuplicate();}
async function checkDuplicate(){
  const el=document.getElementById('s1Duplicate');
  if(!el||!formData.site_name||!formData.report_date){if(el)el.innerHTML='';return;}
  try{
    const{data}=await sb.from('dgr_submissions').select('id,submitted_by_name,created_at').eq('site_name',formData.site_name).eq('report_date',formData.report_date).single();
    if(data && (!formData.id || data.id!==formData.id)){
      const time=new Date(data.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
      el.innerHTML=`<div class="warning-box">Report already submitted at ${time} by ${data.submitted_by_name} — editing will overwrite</div>`;
    } else el.innerHTML='';
  }catch(e){el.innerHTML='';}
}

// SCREEN 2: INVERTER GENERATION
function buildScreen2(){
  const el=document.getElementById('screen2');
  const n=formData.inverter_count||6;
  const strs=formData.strings_per_inv||[];
  if(!formData.inv_gen||formData.inv_gen.length!==n)formData.inv_gen=new Array(n).fill(0);
  if(!formData.inv_modules_cleaned||formData.inv_modules_cleaned.length!==n)
    formData.inv_modules_cleaned=new Array(n).fill(null).map(()=>({cleaned:'',total:''}));
  const dc=formData.dc_capacity_kw||0;
  const invKwp=dc>0&&n>0?dc/n:0;

  let rows='';
  for(let i=0;i<n;i++){
    const s=strs[i]||0;
    const gen=formData.inv_gen[i]||0;
    const sy=invKwp>0?(gen/invKwp).toFixed(2):'—';
    const perStr=s>0?(gen/s).toFixed(1):'—';
    const isZero=gen===0;
    rows+=`
      <div class="inv-num${isZero?' err':''}">${i+1}</div>
      <input type="number" inputmode="decimal" value="${gen||''}" placeholder="0"
        class="${isZero?'input-err':''}" style="font-size:12px;padding:6px 8px"
        onchange="onInvGen(${i},this.value)">
      <div class="inv-sy" id="s2sy${i}">${sy}</div>
      <div class="inv-per-str" id="s2ps${i}">${perStr}</div>`;
  }
  const total=formData.inv_gen.reduce((a,b)=>a+(+b||0),0);
  formData.total_gen_kwh=+total.toFixed(2);
  const zeroInvs=formData.inv_gen.map((v,i)=>v===0?i+1:null).filter(v=>v!==null);

  // Modules cleaned rows
  let modRows='';
  for(let i=0;i<n;i++){
    const mc=formData.inv_modules_cleaned[i]||{cleaned:'',total:''};
    modRows+=`
      <div style="font-size:11px;font-weight:600;color:var(--blue)">${i+1}</div>
      <input type="number" inputmode="numeric" value="${mc.cleaned||''}" placeholder="0"
        style="font-size:11px;padding:5px 7px" onchange="onModCleaned(${i},'cleaned',this.value)">
      <input type="number" inputmode="numeric" value="${mc.total||''}" placeholder="0"
        style="font-size:11px;padding:5px 7px" onchange="onModCleaned(${i},'total',this.value)">`;
  }

  el.innerHTML=`
    <div class="card">
      <div class="flex-between" style="margin-bottom:6px">
        <div class="card-title" style="margin-bottom:0">Inverter readings</div>
        <span class="text-hint">${invKwp>0?`${invKwp.toFixed(1)} kWp/inv`:''}</span>
      </div>
      <div class="inv-grid">
        <div class="inv-header">#</div>
        <div class="inv-header">kWh</div>
        <div class="inv-header" style="text-align:right">kWh/kWp</div>
        <div class="inv-header" style="text-align:right">kWh/str</div>
        ${rows}
      </div>
    </div>
    <div class="auto-calc">
      <div class="auto-calc-label">Total generation</div>
      <div class="auto-calc-value" id="s2Total">${total.toFixed(1)} kWh</div>
    </div>
    ${zeroInvs.length>0?`<div class="error-box">INV-${zeroInvs.join(', INV-')} shows zero kWh — verify before proceeding</div>`:''}
    <div class="card">
      <div class="card-title">Modules cleaned today (optional)</div>
      <div class="mod-grid">
        <div class="mod-header">#</div>
        <div class="mod-header">Cleaned</div>
        <div class="mod-header">Total</div>
        ${modRows}
      </div>
    </div>
  `;
}
function onInvGen(idx,val){
  formData.inv_gen[idx]=parseFloat(val)||0;
  const total=formData.inv_gen.reduce((a,b)=>a+(+b||0),0);
  formData.total_gen_kwh=+total.toFixed(2);
  const totalEl=document.getElementById('s2Total');
  if(totalEl)totalEl.textContent=(+total.toFixed(2))+' kWh';
  const strs=formData.strings_per_inv||[];
  const s=strs[idx]||0;
  const dc=formData.dc_capacity_kw||0;
  const n=formData.inverter_count||1;
  const invKwp=dc>0&&n>0?dc/n:0;
  const gen=formData.inv_gen[idx];
  const syEl=document.getElementById('s2sy'+idx);
  if(syEl)syEl.textContent=invKwp>0?(gen/invKwp).toFixed(2):'—';
  const psEl=document.getElementById('s2ps'+idx);
  if(psEl)psEl.textContent=s>0?(gen/s).toFixed(1):'—';
}
function onModCleaned(idx,field,val){
  if(!formData.inv_modules_cleaned[idx])formData.inv_modules_cleaned[idx]={cleaned:'',total:''};
  formData.inv_modules_cleaned[idx][field]=val;
}

// SCREEN 3: PERFORMANCE
function buildScreen3(){
  const el=document.getElementById('screen3');
  recalcPerformance();
  const dcCuf=formData.dc_cuf_pct,acCuf=formData.ac_cuf_pct,pr=formData.pr_pct;
  const prWarning=pr>0&&pr<70;
  el.innerHTML=`
    <div class="card">
      <div class="card-title">Irradiation data</div>
      <div class="grid-2">
        <div><label>Peak radiation (W/m²)</label>
          <input type="number" inputmode="decimal" value="${formData.peak_radiation_wm2||''}" placeholder="0"
            id="s3rad" onchange="formData.peak_radiation_wm2=parseFloat(this.value)||0">
        </div>
        <div><label>POA irradiation (kWh/m²)</label>
          <input type="number" inputmode="decimal" value="${formData.poa_kwh_m2||''}" placeholder="0"
            id="s3poa" onchange="formData.poa_kwh_m2=parseFloat(this.value)||0;recalcPerformance();updatePerfDisplay()">
        </div>
      </div>
      <div style="margin-top:6px"><label>Peak power (kWh)</label>
        <input type="number" inputmode="decimal" value="${formData.peak_power_kwh||''}" placeholder="0"
          onchange="formData.peak_power_kwh=parseFloat(this.value)||0">
      </div>
    </div>
    <div class="grid-3">
      <div class="auto-calc"><div class="auto-calc-label">DC CUF</div><div class="auto-calc-value" id="s3dcCuf">${dcCuf.toFixed(2)}%</div></div>
      <div class="auto-calc"><div class="auto-calc-label">AC CUF</div><div class="auto-calc-value" id="s3acCuf">${acCuf.toFixed(2)}%</div></div>
      <div class="auto-calc"><div class="auto-calc-label">PR</div><div class="auto-calc-value" id="s3pr">${pr.toFixed(2)}%</div></div>
    </div>
    ${prWarning?`<div class="warning-box">PR ${pr.toFixed(1)}% seems low</div>`:''}
  `;
}
function recalcPerformance(){
  const total=formData.total_gen_kwh||0;
  const dc=formData.dc_capacity_kw||0;
  const ac=formData.ac_capacity_kw||0;
  const poa=formData.poa_kwh_m2||0;
  formData.dc_cuf_pct=dc>0?+((total/(dc*24))*100).toFixed(2):0;
  formData.ac_cuf_pct=ac>0?+((total/(ac*24))*100).toFixed(2):0;
  formData.pr_pct=poa>0&&dc>0?+((total/(poa*dc))*100).toFixed(2):0;
}
function updatePerfDisplay(){
  const dcEl=document.getElementById('s3dcCuf');
  const acEl=document.getElementById('s3acCuf');
  const prEl=document.getElementById('s3pr');
  if(dcEl)dcEl.textContent=formData.dc_cuf_pct.toFixed(2)+'%';
  if(acEl)acEl.textContent=formData.ac_cuf_pct.toFixed(2)+'%';
  if(prEl)prEl.textContent=formData.pr_pct.toFixed(2)+'%';
}

// SCREEN 4: GRID & PLANT OUTAGE
function calcMins(from,to){
  if(!from||!to)return 0;
  const [fh,fm]=from.split(':').map(Number);
  const [th,tm]=to.split(':').map(Number);
  const mins=(th*60+tm)-(fh*60+fm);
  return mins>0?mins:0;
}
function buildScreen4(){
  const el=document.getElementById('screen4');
  const gridDetails=formData.grid_outage_details||[];
  const plantDetails=formData.plant_outage_details||[];
  const gridReasons=appSettings.grid_outage_reasons||DEFAULT_GRID_REASONS;
  const faultCodes=appSettings.plant_fault_codes||DEFAULT_FAULT_CODES;

  // Total outage mins
  const totalGridMins=gridDetails.reduce((a,o)=>a+calcMins(o.from,o.to),0);
  const totalPlantMins=plantDetails.reduce((a,o)=>a+calcMins(o.from,o.to),0);

  function gridOutageBlock(o,i){
    const mins=calcMins(o.from,o.to);
    const reasonOpts=gridReasons.map(r=>`<option value="${r}"${o.reason===r?' selected':''}>${r}</option>`).join('');
    return `<div class="outage-block">
      <div class="flex-between" style="margin-bottom:6px">
        <span style="font-size:11px;font-weight:600">Outage ${i+1}</span>
        <div style="display:flex;align-items:center;gap:8px">
          ${mins>0?`<span class="outage-mins">${mins} min</span>`:''}
          <span style="font-size:10px;color:var(--red);cursor:pointer" onclick="removeGridOutage(${i})">Remove</span>
        </div>
      </div>
      <div class="grid-2" style="margin-bottom:6px">
        <div><label>From</label><input type="time" value="${o.from||''}" onchange="formData.grid_outage_details[${i}].from=this.value;buildScreen4()"></div>
        <div><label>To</label><input type="time" value="${o.to||''}" onchange="formData.grid_outage_details[${i}].to=this.value;buildScreen4()"></div>
      </div>
      <div style="margin-bottom:4px">
        <label>Reason</label>
        <select onchange="formData.grid_outage_details[${i}].reason=this.value;buildScreen4()">
          <option value="">Select reason</option>${reasonOpts}
        </select>
      </div>
      ${o.reason==='Others'?`<div><label>Specify</label><input type="text" value="${o.reason_other||''}" placeholder="Describe reason" onchange="formData.grid_outage_details[${i}].reason_other=this.value"></div>`:''}
    </div>`;
  }

  function plantOutageBlock(o,i){
    const mins=calcMins(o.from,o.to);
    const faultOpts=faultCodes.map(f=>`<option value="${f}"${o.fault_code===f?' selected':''}>${f}</option>`).join('');
    return `<div class="outage-block">
      <div class="flex-between" style="margin-bottom:6px">
        <span style="font-size:11px;font-weight:600">Outage ${i+1}</span>
        <div style="display:flex;align-items:center;gap:8px">
          ${mins>0?`<span class="outage-mins">${mins} min</span>`:''}
          <span style="font-size:10px;color:var(--red);cursor:pointer" onclick="removePlantOutage(${i})">Remove</span>
        </div>
      </div>
      <div class="grid-2" style="margin-bottom:6px">
        <div><label>From</label><input type="time" value="${o.from||''}" onchange="formData.plant_outage_details[${i}].from=this.value;buildScreen4()"></div>
        <div><label>To</label><input type="time" value="${o.to||''}" onchange="formData.plant_outage_details[${i}].to=this.value;buildScreen4()"></div>
      </div>
      <div style="margin-bottom:4px">
        <label>Fault code</label>
        <select onchange="formData.plant_outage_details[${i}].fault_code=this.value;buildScreen4()">
          <option value="">Select fault</option>${faultOpts}
        </select>
      </div>
      <div><label>Sub-fault / detail (optional)</label>
        <input type="text" value="${o.sub_fault||''}" placeholder="e.g. Inverter 3, Phase A" onchange="formData.plant_outage_details[${i}].sub_fault=this.value">
      </div>
    </div>`;
  }

  el.innerHTML=`
    <div class="card">
      <div style="font-size:12px;font-weight:700;color:var(--text)">Grid Outage</div>
      <div class="text-hint" style="margin-bottom:2px">Supply disruption from DISCOM today?</div>
      <div class="yn-group">
        <button class="yn-btn yn-btn-yes${formData.grid_outage?' yn-active':''}" onclick="if(!formData.grid_outage)toggleGridOutage()">YES</button>
        <button class="yn-btn yn-btn-no${!formData.grid_outage?' yn-active':''}" onclick="if(formData.grid_outage)toggleGridOutage()">NO</button>
      </div>
      ${formData.grid_outage?`
        <div style="margin-top:10px">
          ${gridDetails.map((o,i)=>gridOutageBlock(o,i)).join('')}
          ${totalGridMins>0?`<div style="text-align:right;margin-bottom:4px"><span class="badge badge-blue">Total: ${totalGridMins} min</span></div>`:''}
          <button class="btn-dashed" onclick="addGridOutage()">+ Add outage window</button>
        </div>`:''}
    </div>
    <div class="card">
      <div style="font-size:12px;font-weight:700;color:var(--text)">Plant Fault / Outage</div>
      <div class="text-hint" style="margin-bottom:2px">Any equipment failure or fault today?</div>
      <div class="yn-group">
        <button class="yn-btn yn-btn-yes${formData.plant_outage?' yn-active':''}" onclick="if(!formData.plant_outage)togglePlantOutage()">YES</button>
        <button class="yn-btn yn-btn-no${!formData.plant_outage?' yn-active':''}" onclick="if(formData.plant_outage)togglePlantOutage()">NO</button>
      </div>
      ${formData.plant_outage?`
        <div style="margin-top:10px">
          ${plantDetails.map((o,i)=>plantOutageBlock(o,i)).join('')}
          ${totalPlantMins>0?`<div style="text-align:right;margin-bottom:4px"><span class="badge badge-red">Total: ${totalPlantMins} min</span></div>`:''}
          <button class="btn-dashed" onclick="addPlantOutage()">+ Add fault window</button>
        </div>`:''}
    </div>
  `;
}
function toggleGridOutage(){
  formData.grid_outage=!formData.grid_outage;
  if(formData.grid_outage&&formData.grid_outage_details.length===0)
    formData.grid_outage_details=[{from:'',to:'',reason:'',reason_other:''}];
  buildScreen4();
}
function togglePlantOutage(){
  formData.plant_outage=!formData.plant_outage;
  if(formData.plant_outage&&formData.plant_outage_details.length===0)
    formData.plant_outage_details=[{from:'',to:'',fault_code:'',sub_fault:''}];
  buildScreen4();
}
function addGridOutage(){formData.grid_outage_details.push({from:'',to:'',reason:'',reason_other:''});buildScreen4();}
function removeGridOutage(i){formData.grid_outage_details.splice(i,1);buildScreen4();}
function addPlantOutage(){formData.plant_outage_details.push({from:'',to:'',fault_code:'',sub_fault:''});buildScreen4();}
function removePlantOutage(i){formData.plant_outage_details.splice(i,1);buildScreen4();}
// SCREEN 5: TRANSFORMER
function buildScreen5(){
  const el=document.getElementById('screen5');
  function tempColor(v){return v>85?'red':v>=75?'amber':'green';}
  const wti=formData.wti_c||0;
  const oti=formData.oti_c||0;
  const mogOpts=MOG_OPTIONS.map(o=>`<option value="${o}"${formData.mog_level===o?' selected':''}>${o}</option>`).join('');
  const mogDangerOpts=['Critical','Low'];
  el.innerHTML=`
    <div class="card">
      <div style="font-size:12px;font-weight:700;color:var(--text)">Transformer Temperature</div>
      <div class="text-hint" style="margin-bottom:4px">Peak readings during 12:00 – 14:00</div>
      <div class="equip-card-grid">
        <div class="equip-card">
          <div class="equip-card-label">WTI (Winding)</div>
          <input type="number" inputmode="decimal" value="${formData.wti_c||''}" placeholder="—"
            onchange="formData.wti_c=parseFloat(this.value)||0;updateWTIDisplay()">
          <div class="equip-card-unit" id="wtiStatus">${wti>0?(wti>85?'⚠ HIGH':wti>=75?'WARM':'OK'):''}</div>
        </div>
        <div class="equip-card">
          <div class="equip-card-label">OTI (Oil)</div>
          <input type="number" inputmode="decimal" value="${formData.oti_c||''}" placeholder="—"
            onchange="formData.oti_c=parseFloat(this.value)||0;updateOTIDisplay()">
          <div class="equip-card-unit" id="otiStatus">${oti>0?(oti>85?'⚠ HIGH':oti>=75?'WARM':'OK'):''}</div>
        </div>
        <div class="equip-card">
          <div class="equip-card-label">WTI Peak Time</div>
          <input type="time" value="${formData.wti_peak_time||''}" min="12:00" max="14:00"
            style="font-size:13px;font-weight:600;text-align:center"
            onchange="formData.wti_peak_time=this.value">
          <div class="equip-card-unit">12–14 window</div>
        </div>
        <div class="equip-card">
          <div class="equip-card-label">OTI Peak Time</div>
          <input type="time" value="${formData.oti_peak_time||''}" min="12:00" max="14:00"
            style="font-size:13px;font-weight:600;text-align:center"
            onchange="formData.oti_peak_time=this.value">
          <div class="equip-card-unit">12–14 window</div>
        </div>
      </div>
      ${wti>85?`<div class="warning-box" style="margin-top:8px">WTI ${wti}°C exceeds 85°C — flagged for review</div>`:''}
    </div>
    <div class="card">
      <div style="font-size:12px;font-weight:700;color:var(--text)">MOG Oil Level</div>
      <div class="mog-grid">
        ${MOG_OPTIONS.map(o=>`<div class="mog-opt${formData.mog_level===o?' mog-selected':''}${mogDangerOpts.includes(o)?' mog-danger':''}" onclick="formData.mog_level='${o}';buildScreen5()">${o}</div>`).join('')}
      </div>
    </div>
    <div class="card">
      <div style="font-size:12px;font-weight:700;color:var(--text)">Silica Gel Colour</div>
      <div class="text-hint" style="margin-bottom:2px">Current colour of transformer silica gel beads</div>
      <div class="silica-group">
        <button class="silica-pill${formData.silica_gel==='Blue'?' silica-blue-active':''}" onclick="formData.silica_gel='Blue';buildScreen5()">🔵 Blue (Active)</button>
        <button class="silica-pill${formData.silica_gel==='Orange'?' silica-orange-active':''}" onclick="formData.silica_gel='Orange';buildScreen5()">🟠 Orange (Replace)</button>
      </div>
    </div>
  `;
}
function updateWTIDisplay(){
  const v=formData.wti_c||0;
  function tempColor(x){return x>85?'red':x>=75?'amber':'green';}
  const bar=document.getElementById('wtiBar');
  const status=document.getElementById('wtiStatus');
  if(bar){bar.className=`level-fill ${tempColor(v)}`;bar.style.width=`${Math.min(v,120)/1.2}%`;}
  if(status)status.textContent=v>0?tempColor(v).toUpperCase():'';
}
function updateOTIDisplay(){
  const v=formData.oti_c||0;
  function tempColor(x){return x>85?'red':x>=75?'amber':'green';}
  const bar=document.getElementById('otiBar');
  const status=document.getElementById('otiStatus');
  if(bar){bar.className=`level-fill ${tempColor(v)}`;bar.style.width=`${Math.min(v,120)/1.2}%`;}
  if(status)status.textContent=v>0?tempColor(v).toUpperCase():'';
}

// SCREEN 6: CLEANING
function buildScreen6(){
  const el=document.getElementById('screen6');
  const day=new Date(formData.report_date).getDate();
  const month=new Date(formData.report_date).getMonth();
  const year=new Date(formData.report_date).getFullYear();
  function cycleState(s,e){if(day>=s&&day<=e)return 'active';if(day>e)return 'past';return 'future';}
  function dateRange(s,e){
    const sd=new Date(year,month,s),ed=new Date(year,month,e);
    return `${sd.toLocaleDateString('en-IN',{day:'numeric',month:'short'})} – ${ed.toLocaleDateString('en-IN',{day:'numeric',month:'short'})}`;
  }
  const cycles=[
    {n:1,start:1,end:10,statusKey:'cleaning_c1_status',tdsKey:'cleaning_c1_tds'},
    {n:2,start:11,end:20,statusKey:'cleaning_c2_status',tdsKey:'cleaning_c2_tds'},
    {n:3,start:21,end:31,statusKey:'cleaning_c3_status',tdsKey:'cleaning_c3_tds'}
  ];
  const statuses=['not-started','in-progress','partial','complete'];
  const statusLabels={'not-started':'Not Started','in-progress':'In Progress','partial':'Partial','complete':'Complete'};
  let html='<div class="card"><div class="card-title">Module cleaning cycles</div>';
  cycles.forEach(c=>{
    const state=cycleState(c.start,c.end);
    const curStatus=formData[c.statusKey]||'not-started';
    const isLocked=state==='future'||(curStatus==='complete'&&session.role==='engineer');
    let badgeCls='badge-gray';
    if(state==='active')badgeCls='badge-blue';
    if(curStatus==='complete')badgeCls='badge-green';
    if(curStatus==='partial')badgeCls='badge-yellow';
    html+=`<div class="cycle-block${isLocked?' locked':''}">
      <div class="flex-between" style="margin-bottom:6px">
        <div><div style="font-size:12px;font-weight:700">Cycle ${c.n}</div>
          <div class="text-hint">Days ${c.start}–${c.end} · ${dateRange(c.start,c.end)}</div></div>
        <span class="badge ${badgeCls}">${state==='future'?'Locked':statusLabels[curStatus]}</span>
      </div>`;
    if(state==='active'&&!isLocked){
      html+=`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">`;
      statuses.forEach(s=>{html+=`<div class="status-pill ${s}${curStatus===s?' selected':''}" onclick="setCycleStatus('${c.statusKey}',this,'${s}')">${statusLabels[s]}</div>`;});
      html+=`</div><label>TDS (ppm)</label><input type="number" inputmode="decimal" value="${formData[c.tdsKey]||''}" placeholder="TDS value" onchange="formData['${c.tdsKey}']=parseFloat(this.value)||0">`;
    } else if(state==='future'){
      html+=`<div class="text-hint">Available from ${new Date(year,month,c.start).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</div>`;
    }
    html+=`</div>`;
  });
  html+='</div>';
  html+=`<div class="card">
    <div class="card-title">Total module cleaning (site-wide)</div>
    <div class="grid-2">
      <div><label>Modules cleaned today</label>
        <input type="number" inputmode="numeric" value="${formData.modules_cleaned_today||''}" placeholder="0"
          onchange="formData.modules_cleaned_today=parseInt(this.value)||null">
      </div>
      <div><label>Total modules on site</label>
        <input type="number" inputmode="numeric" value="${formData.modules_total||''}" placeholder="0"
          onchange="formData.modules_total=parseInt(this.value)||null">
      </div>
    </div>
  </div>`;
  el.innerHTML=html;
}
function setCycleStatus(key,elem,status){formData[key]=status;buildScreen6();}

// SCREEN 7: WEATHER & ACTIVITY
function buildScreen7(){
  const el=document.getElementById('screen7');
  const weathers=['Sunny','Partly cloudy','Cloudy','Hazy','Dust storm'];
  el.innerHTML=`
    <div class="card">
      <div class="card-title">Weather condition</div>
      <div class="weather-pills">
        ${weathers.map(w=>`<div class="weather-pill${formData.weather===w?' selected':''}" onclick="formData.weather='${w}';buildScreen7()">${w}</div>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-title">Temperature readings (manual entry)</div>
      <div class="grid-2" style="margin-bottom:6px">
        <div><label>Avg ambient (°C)</label>
          <input type="number" inputmode="decimal" value="${formData.weather_avg_ambient_c||''}" placeholder="0"
            onchange="formData.weather_avg_ambient_c=parseFloat(this.value)||null">
        </div>
        <div><label>Max ambient (°C)</label>
          <input type="number" inputmode="decimal" value="${formData.weather_max_ambient_c||''}" placeholder="0"
            onchange="formData.weather_max_ambient_c=parseFloat(this.value)||null">
        </div>
      </div>
      <div class="grid-2">
        <div><label>Avg module temp (°C)</label>
          <input type="number" inputmode="decimal" value="${formData.weather_avg_module_c||''}" placeholder="0"
            onchange="formData.weather_avg_module_c=parseFloat(this.value)||null">
        </div>
        <div><label>Max module temp (°C)</label>
          <input type="number" inputmode="decimal" value="${formData.weather_max_module_c||''}" placeholder="0"
            onchange="formData.weather_max_module_c=parseFloat(this.value)||null">
        </div>
      </div>
    </div>
    <div class="card">
      <div class="flex-between" style="margin-bottom:${formData.rain?'8px':'0'}">
        <div><div style="font-size:12px;font-weight:600">Rain today</div><div class="text-hint">Any precipitation?</div></div>
        <div class="toggle${formData.rain?' on':''}" onclick="formData.rain=!formData.rain;buildScreen7()"></div>
      </div>
      ${formData.rain?`
        <div>
          <label>Intensity</label>
          <div style="display:flex;gap:8px;margin-bottom:8px">
            ${['Light','Moderate','Heavy'].map(r=>`<div class="opt-pill${formData.rain_intensity===r?' selected':''}" onclick="formData.rain_intensity='${r}';buildScreen7()">${r}</div>`).join('')}
          </div>
          <label>Modules cleaned after rain</label>
          <div style="display:flex;gap:8px">
            <div class="opt-pill${formData.rain_modules_cleaned===true?' selected':''}" onclick="formData.rain_modules_cleaned=true;buildScreen7()">Yes</div>
            <div class="opt-pill${formData.rain_modules_cleaned===false&&formData.rain?' selected':''}" onclick="formData.rain_modules_cleaned=false;buildScreen7()">No</div>
          </div>
        </div>`:'' }
    </div>
    <div class="card">
      <div class="card-title">Today's activity</div>
      <textarea rows="3" placeholder="Describe today's maintenance / activity performed..."
        onchange="formData.daily_activity=this.value">${formData.daily_activity||''}</textarea>
    </div>
    <div class="card">
      <div class="card-title">Remarks / observations</div>
      <textarea rows="3" placeholder="Any site observations..."
        onchange="formData.remarks=this.value">${formData.remarks||''}</textarea>
    </div>
  `;
}

// SCREEN 8: PHOTOS
const PHOTO_SLOTS=[
  {key:'wti',label:'WTI gauge'},
  {key:'oti',label:'OTI gauge'},
  {key:'mog',label:'MOG level'},
  {key:'silica',label:'Silica gel'},
  {key:'gen1',label:'General 1'},
  {key:'gen2',label:'General 2'},
  {key:'gen3',label:'General 3'},
];
function buildScreen8(){
  const el=document.getElementById('screen8');
  let slotsHtml='';
  PHOTO_SLOTS.forEach(slot=>{
    const f=photoFiles[slot.key];
    if(f){
      slotsHtml+=`<div class="photo-slot filled" onclick="removePhoto('${slot.key}')">
        <span style="font-size:14px">📷</span>
        <span style="font-size:9px;text-align:center">${slot.label}</span>
        <span style="font-size:8px;color:var(--green-dark)">✓ Added</span>
      </div>`;
    } else {
      slotsHtml+=`<div class="photo-slot empty" onclick="triggerPhoto('${slot.key}')">
        <span style="font-size:18px">+</span>
        <span style="font-size:9px;text-align:center">${slot.label}</span>
      </div>`;
    }
  });
  const count=Object.values(photoFiles).filter(Boolean).length;
  el.innerHTML=`
    <div class="card">
      <div class="flex-between" style="margin-bottom:6px">
        <div class="card-title" style="margin-bottom:0">Site photos</div>
        <span class="badge badge-${count>0?'green':'gray'}">${count} / ${PHOTO_SLOTS.length}</span>
      </div>
      <div class="text-hint" style="margin-bottom:8px">Tap slot to capture or upload · max 5MB each</div>
      <div class="photo-grid">${slotsHtml}</div>
    </div>
  `;
}
let photoSlotTarget='';
function triggerPhoto(key){photoSlotTarget=key;document.getElementById('photoInput').click();}
function handlePhoto(e){
  const file=e.target.files[0];
  if(!file)return;
  if(file.size>5*1024*1024){alert('Photo must be under 5MB');return;}
  photoFiles[photoSlotTarget]=file;
  e.target.value='';
  buildScreen8();
}
function removePhoto(key){delete photoFiles[key];buildScreen8();}
// SCREEN 9: REVIEW & SUBMIT
function buildScreen9(){
  const el=document.getElementById('screen9');
  const zeroInvs=formData.inv_gen.filter(v=>v===0).length;
  const prLow=formData.pr_pct>0&&formData.pr_pct<70;
  const tempHigh=(formData.wti_c||0)>85||(formData.oti_c||0)>85;
  let valRows='';
  valRows+=`<div class="val-row"><div class="v-icon v-icon-ok">✓</div><div class="val-text">Site & date confirmed</div></div>`;
  if(zeroInvs>0){
    valRows+=`<div class="val-row">
      <div class="v-icon v-icon-warn">!</div>
      <div class="val-text">${zeroInvs} inverter(s) with zero kWh</div>
      <div class="ack-badge ${acknowledgements.inv_zero?'done':'pending'}" onclick="acknowledgements.inv_zero=true;buildScreen9()">
        ${acknowledgements.inv_zero?'Acknowledged':'Acknowledge'}</div>
    </div>`;
  }
  if(prLow){
    valRows+=`<div class="val-row">
      <div class="v-icon v-icon-warn">!</div>
      <div class="val-text">PR ${formData.pr_pct}% is below 70%</div>
      <div class="ack-badge ${acknowledgements.pr_low?'done':'pending'}" onclick="acknowledgements.pr_low=true;buildScreen9()">
        ${acknowledgements.pr_low?'Acknowledged':'Acknowledge'}</div>
    </div>`;
  }
  if(tempHigh){
    valRows+=`<div class="val-row">
      <div class="v-icon v-icon-err">!</div>
      <div class="val-text">Transformer temp exceeds 85°C</div>
      <div class="ack-badge ${acknowledgements.temp_high?'done':'pending'}" onclick="acknowledgements.temp_high=true;buildScreen9()">
        ${acknowledgements.temp_high?'Flagged':'Flag'}</div>
    </div>`;
  }
  if(!zeroInvs&&!prLow&&!tempHigh){
    valRows+=`<div class="val-row"><div class="v-icon v-icon-ok">✓</div><div class="val-text">All checks passed</div></div>`;
  }
  let canSubmit=true;
  if(zeroInvs>0&&!acknowledgements.inv_zero)canSubmit=false;
  if(prLow&&!acknowledgements.pr_low)canSubmit=false;
  if(tempHigh&&!acknowledgements.temp_high)canSubmit=false;
  const photoCount=Object.values(photoFiles).filter(Boolean).length;
  const dateStr=formData.report_date?new Date(formData.report_date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'';
  const gridMins=(formData.grid_outage_details||[]).reduce((a,o)=>a+calcMins(o.from,o.to),0);
  const plantMins=(formData.plant_outage_details||[]).reduce((a,o)=>a+calcMins(o.from,o.to),0);
  el.innerHTML=`
    <div class="card"><div class="card-title">Validation checks</div>${valRows}</div>
    <div class="card">
      <div class="card-title">Summary</div>
      <div class="summary-row"><span class="summary-label">Site</span><span class="summary-value text-blue">${formData.site_name}</span></div>
      <div class="summary-row"><span class="summary-label">Date</span><span class="summary-value">${dateStr}</span></div>
      <div class="summary-row"><span class="summary-label">Total generation</span><span class="summary-value text-green">${formData.total_gen_kwh.toFixed(1)} kWh</span></div>
      <div class="summary-row"><span class="summary-label">DC CUF / AC CUF</span><span class="summary-value">${formData.dc_cuf_pct}% / ${formData.ac_cuf_pct}%</span></div>
      <div class="summary-row"><span class="summary-label">PR</span><span class="summary-value">${formData.pr_pct}%</span></div>
      <div class="summary-row"><span class="summary-label">Grid outage</span><span class="summary-value">${formData.grid_outage?`<span class="badge badge-yellow">${gridMins} min</span>`:'<span class="badge badge-green">No</span>'}</span></div>
      <div class="summary-row"><span class="summary-label">Plant outage</span><span class="summary-value">${formData.plant_outage?`<span class="badge badge-red">${plantMins} min</span>`:'<span class="badge badge-green">No</span>'}</span></div>
      <div class="summary-row"><span class="summary-label">WTI / OTI</span><span class="summary-value">${formData.wti_c||0}°C / ${formData.oti_c||0}°C</span></div>
      <div class="summary-row"><span class="summary-label">MOG level</span><span class="summary-value">${formData.mog_level||'—'}</span></div>
      <div class="summary-row"><span class="summary-label">Rain</span><span class="summary-value">${formData.rain?(formData.rain_intensity||'Yes'):'No'}</span></div>
      <div class="summary-row"><span class="summary-label">Photos</span><span class="summary-value">${photoCount}</span></div>
    </div>
  `;
  document.getElementById('btnNext').disabled=!canSubmit;
}

// SUBMIT
async function submitReport(){
  const btn=document.getElementById('btnNext');
  btn.disabled=true;btn.textContent='Submitting...';
  try{
    const uploadedUrls={};
    for(const [key,file] of Object.entries(photoFiles)){
      if(!file)continue;
      const path=`${formData.site_name}/${formData.report_date}/${key}_${Date.now()}.jpg`;
      try{
        const{data:upData,error:upErr}=await sb.storage.from('dgr-photos').upload(path,file);
        if(!upErr){
          const{data:urlData}=sb.storage.from('dgr-photos').getPublicUrl(path);
          if(urlData)uploadedUrls[key]=urlData.publicUrl;
        }
      }catch(e){}
    }
    const payload={
      site_name:formData.site_name,
      report_date:formData.report_date,
      submitted_by_phone:formData.submitted_by_phone,
      submitted_by_name:formData.submitted_by_name,
      dc_capacity_kw:formData.dc_capacity_kw,
      ac_capacity_kw:formData.ac_capacity_kw,
      inv_gen:formData.inv_gen||[],
      inv_strings:formData.strings_per_inv||[],
      inv_modules_cleaned:formData.inv_modules_cleaned,
      total_gen_kwh:formData.total_gen_kwh,
      peak_radiation_wm2:formData.peak_radiation_wm2,
      poa_kwh_m2:formData.poa_kwh_m2,
      peak_power_kwh:formData.peak_power_kwh,
      ac_cuf_pct:formData.ac_cuf_pct,
      dc_cuf_pct:formData.dc_cuf_pct,
      pr_pct:formData.pr_pct,
      grid_outage:formData.grid_outage,
      grid_outage_details:formData.grid_outage_details.length>0?formData.grid_outage_details:null,
      plant_outage:formData.plant_outage,
      plant_outage_details:formData.plant_outage_details.length>0?formData.plant_outage_details:null,
      wti_c:formData.wti_c, wti_peak_time:formData.wti_peak_time||null,
      oti_c:formData.oti_c, oti_peak_time:formData.oti_peak_time||null,
      mog_level:formData.mog_level||null,
      silica_gel:formData.silica_gel||null,
      cleaning_c1_status:formData.cleaning_c1_status,cleaning_c1_tds:formData.cleaning_c1_tds,
      cleaning_c2_status:formData.cleaning_c2_status,cleaning_c2_tds:formData.cleaning_c2_tds,
      cleaning_c3_status:formData.cleaning_c3_status,cleaning_c3_tds:formData.cleaning_c3_tds,
      modules_cleaned_today:formData.modules_cleaned_today,
      modules_total:formData.modules_total,
      weather:formData.weather,
      rain:formData.rain, rain_intensity:formData.rain_intensity||null,
      rain_modules_cleaned:formData.rain_modules_cleaned,
      weather_avg_ambient_c:formData.weather_avg_ambient_c,
      weather_max_ambient_c:formData.weather_max_ambient_c,
      weather_avg_module_c:formData.weather_avg_module_c,
      weather_max_module_c:formData.weather_max_module_c,
      daily_activity:formData.daily_activity||null,
      remarks:formData.remarks,
      image_urls:Object.keys(uploadedUrls).length>0?uploadedUrls:null,
      weather_auto:formData.weather_auto||null,
      status:'pending',
      reviewed_by:null,
      reviewed_at:null,
      review_note:null
    };
    // Remove undefined values
    Object.keys(payload).forEach(k=>{if(payload[k]===undefined)payload[k]=null;});
    // Save draft to localStorage before network call — protects against connection drops
    try{localStorage.setItem('dgr_draft',JSON.stringify({payload,savedAt:new Date().toISOString()}));}catch(e){}
    if(navigator.onLine){
      const{error}=await sb.from('dgr_submissions').upsert(payload,{onConflict:'site_name,report_date'});
      if(error){
        btn.disabled=false;btn.textContent='Submit Report';
        const detail=[error.message,error.details,error.hint].filter(Boolean).join(' | ');
        alert('Submit failed: '+detail+'\n\nContact admin if issue persists.');
        return;
      }
    } else await saveOffline(payload);
    // Clear draft on successful submit
    try{localStorage.removeItem('dgr_draft');}catch(e){}
    goToScreen(10);
  }catch(e){
    btn.disabled=false;btn.textContent='Submit Report';
    const isNetworkErr=e.message&&(e.message.includes('fetch')||e.message.includes('network')||e.message.includes('NetworkError'));
    if(isNetworkErr){
      alert('Network error — check your signal and tap Submit again.\n\nYour data is saved and ready to retry.');
    } else {
      alert('Submit failed: '+e.message+'\n\nContact admin if issue persists.');
    }
  }
}

// SCREEN 10: SUBMITTED
function buildScreen10(){
  const el=document.getElementById('screen10');
  const dateStr=formData.report_date?new Date(formData.report_date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'';
  const waMsg=buildWhatsAppMsg();
  el.innerHTML=`
    <div style="text-align:center;padding:20px 0">
      <div class="success-icon">✓</div>
      <div style="font-size:16px;font-weight:700;color:var(--green);margin-bottom:4px">Report submitted!</div>
      <div style="font-size:11px;color:var(--gray)">${formData.site_name} · ${dateStr} · Awaiting approval</div>
    </div>
    <div class="card" style="background:var(--green-light);border-color:var(--green-border)">
      <div style="font-size:11px;display:flex;flex-direction:column;gap:6px">
        <div class="flex-between"><span>Saved to database</span><span style="color:var(--green-dark);font-weight:600">✓ Done</span></div>
        <div class="flex-between"><span>Manager approval</span><span style="color:var(--amber);font-weight:600">⏳ Pending</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">WhatsApp summary</div>
      <div class="wa-preview">${escHtml(waMsg)}</div>
      <button class="btn-whatsapp" onclick="shareWhatsApp()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492l4.625-1.476A11.929 11.929 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818c-2.168 0-4.19-.578-5.938-1.586l-.425-.253-2.744.877.875-2.685-.278-.44A9.777 9.777 0 012.182 12c0-5.422 4.396-9.818 9.818-9.818 5.422 0 9.818 4.396 9.818 9.818 0 5.422-4.396 9.818-9.818 9.818z"/></svg>
        Share on WhatsApp
      </button>
    </div>
    <button class="btn btn-secondary btn-block" onclick="switchTab('dgr')" style="margin-top:8px">← Back to home</button>
  `;
}

function buildWhatsAppMsg(){
  const dc_mw=formData.dc_capacity_kw?(formData.dc_capacity_kw/1000).toFixed(2):'—';
  const ac_mw=formData.ac_capacity_kw?(formData.ac_capacity_kw/1000).toFixed(2):'—';
  const d=formData.report_date?formData.report_date.split('-').reverse().join('-'):'';
  let invLines='';
  const inv=formData.inv_gen||[];
  for(let i=0;i<inv.length;i++){
    if(i>0&&i%3===0)invLines+='\n';else if(i>0)invLines+=' | ';
    invLines+=`Inv ${i+1}: ${inv[i]} kWh`;
  }
  const gridMins=(formData.grid_outage_details||[]).reduce((a,o)=>a+calcMins(o.from,o.to),0);
  const plantMins=(formData.plant_outage_details||[]).reduce((a,o)=>a+calcMins(o.from,o.to),0);
  let gridDetails='';
  if(formData.grid_outage&&formData.grid_outage_details){
    formData.grid_outage_details.forEach(o=>{gridDetails+=`\n  ${o.from||'?'}–${o.to||'?'} · ${o.reason||''} ${o.reason==='Others'?o.reason_other||'':''}`;});
  }
  let plantDetails='';
  if(formData.plant_outage&&formData.plant_outage_details){
    formData.plant_outage_details.forEach(o=>{plantDetails+=`\n  ${o.from||'?'}–${o.to||'?'} · ${o.fault_code||''} ${o.sub_fault?'('+o.sub_fault+')':''}`;});
  }
  return `TODAY DGR 🌞
Site :- ${formData.site_name}
DC :- ${dc_mw} MW | AC :- ${ac_mw} MW
Date :- ${d}

${invLines}
Total :- ${formData.total_gen_kwh} kWh

Peak radiation :- ${formData.peak_radiation_wm2||0} W/m²
POA :- ${formData.poa_kwh_m2||0} kWh/m²
Peak Power :- ${formData.peak_power_kwh||0} kWh
DC CUF :- ${formData.dc_cuf_pct}% | AC CUF :- ${formData.ac_cuf_pct}%
PR :- ${formData.pr_pct}%

Grid outage :- ${formData.grid_outage?`Yes (${gridMins} min)${gridDetails}`:'No'}
Plant outage :- ${formData.plant_outage?`Yes (${plantMins} min)${plantDetails}`:'No'}

WTI :- ${formData.wti_c||0}°C (${formData.wti_peak_time||'—'})
OTI :- ${formData.oti_c||0}°C (${formData.oti_peak_time||'—'})
MOG :- ${formData.mog_level||'—'} | Silica gel :- ${formData.silica_gel||'—'}

Ambient temp :- Avg ${formData.weather_avg_ambient_c||'—'}°C / Max ${formData.weather_max_ambient_c||'—'}°C
Module temp :- Avg ${formData.weather_avg_module_c||'—'}°C / Max ${formData.weather_max_module_c||'—'}°C
Weather :- ${formData.weather||'—'} | Rain :- ${formData.rain?(formData.rain_intensity||'Yes'):'No'}

Module cleaning :- C1: ${formData.cleaning_c1_status} | C2: ${formData.cleaning_c2_status} | C3: ${formData.cleaning_c3_status}
Modules cleaned :- ${formData.modules_cleaned_today||0} / ${formData.modules_total||'—'}

Activity :- ${formData.daily_activity||'—'}
Remarks :- ${formData.remarks||'—'}

Submitted by :- ${formData.submitted_by_name}`;
}
function shareWhatsApp(){window.open('https://wa.me/?text='+encodeURIComponent(buildWhatsAppMsg()),'_blank');}
function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
