let adminTab='users';
function showAdmin(){
  navTo('admin/'+adminTab);
  const el=document.getElementById('screenAdmin');
  el.classList.remove('hidden');
  el.innerHTML=`
    <div class="admin-tabs">
      <div class="admin-tab${adminTab==='users'?' active':''}" onclick="adminTab='users';showAdmin()">Users</div>
      <div class="admin-tab${adminTab==='sites'?' active':''}" onclick="adminTab='sites';showAdmin()">Sites</div>
      <div class="admin-tab${adminTab==='approvals'?' active':''}" onclick="adminTab='approvals';showAdmin()">Approvals</div>
      <div class="admin-tab${adminTab==='settings'?' active':''}" onclick="adminTab='settings';showAdmin()">Settings</div>
      <div class="admin-tab${adminTab==='weather'?' active':''}" onclick="adminTab='weather';showAdmin()">Weather</div>
      <div class="admin-tab${adminTab==='import'?' active':''}" onclick="adminTab='import';showAdmin()">Import</div>
    </div>
    <div id="adminContent"></div>
  `;
  if(adminTab==='users')showAdminUsers();
  else if(adminTab==='sites')showAdminSites();
  else if(adminTab==='approvals'){approvalFilter='pending';showApprovalInAdmin();}
  else if(adminTab==='settings')showAdminSettings();
  else if(adminTab==='weather')showWeatherAudit();
  else if(adminTab==='import')showAdminImport();
}

async function showAdminUsers(){
  const el=document.getElementById('adminContent');
  el.innerHTML='<div style="text-align:center;color:var(--gray);padding:10px">Loading...</div>';
  try{
    const{data}=await sb.from('users').select('*').order('name');
    el.innerHTML=`
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <button class="btn btn-primary" style="flex:1;padding:8px;font-size:11px" onclick="openUserModal()">+ Add User</button>
        <button class="btn btn-secondary" style="flex:1;padding:8px;font-size:11px" onclick="document.getElementById('csvInput').click()">Bulk CSV</button>
        <button class="btn btn-secondary" style="flex:1;padding:8px;font-size:11px" onclick="downloadUserTemplate()">Template</button>
      </div>
      <div style="overflow-x:auto">
        <table class="admin-table">
          <thead><tr><th>Phone</th><th>Name</th><th>Role</th><th>Sites</th><th style="min-width:100px"></th></tr></thead>
          <tbody>
            ${(data||[]).map(u=>`<tr>
              <td>${u.phone}</td><td>${u.name||'—'}</td>
              <td><span class="badge badge-${u.role==='admin'?'red':u.role==='manager'?'blue':'green'}">${u.role}</span></td>
              <td style="font-size:9px;max-width:80px;overflow:hidden;text-overflow:ellipsis">${(u.assigned_sites||[]).join(', ')}</td>
              <td style="white-space:nowrap">
                <span style="color:var(--blue);cursor:pointer;font-size:10px" onclick="openUserModal('${u.id}')">Edit</span>
                <span style="color:var(--orange);cursor:pointer;font-size:10px;margin-left:8px" onclick="openResetPwModal('${u.id}','${String(u.name||u.phone||'').replace(/'/g,"\\'")}')">Reset PW</span>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }catch(e){el.innerHTML=`<div class="error-box">Failed to load users: ${e?.message||e}</div>`;console.error('showAdminUsers error:',e);}
}
// ── INSIGHTS ─────────────────────────────────────────────────────────────────
async function showInsights(){
  const el=document.getElementById('screenInsights');
  el.classList.remove('hidden');
  el.innerHTML='<div style="text-align:center;color:var(--gray);padding:40px 0">Loading insights…</div>';
  const now=Date.now();
  if(!_insightsCache||_insightsCache.days!==insightsDays||(now-_insightsCache.ts)>300000){
    const{data,error}=await loadInsightsData(insightsDays);
    if(error&&(!data||!data.length)){
      el.innerHTML='<div class="error-box" style="margin:16px">Failed to load data. Check connection.</div>';
      return;
    }
    _insightsCache={data:data||[],days:insightsDays,ts:now};
  }
  renderInsights(_insightsCache.data,insightsDays);
}
async function loadInsightsData(days){
  const from=new Date();from.setDate(from.getDate()-days);
  const fromDate=from.toISOString().split('T')[0];
  let q=sb.from('dgr_submissions')
    .select('site_name,report_date,total_gen_kwh,pr_pct,dc_cuf_pct,grid_outage,plant_outage,plant_outage_details,wti_c,oti_c,status,dc_capacity_kw')
    .gte('report_date',fromDate).order('report_date',{ascending:false});
  if(session.role==='manager')q=q.in('site_name',session.assigned_sites||[]);
  return await q;
}
function renderInsights(rows,days){
  const el=document.getElementById('screenInsights');
  if(!el)return;
  const today=new Date().toISOString().split('T')[0];
  const twoDaysAgo=new Date();twoDaysAgo.setDate(twoDaysAgo.getDate()-2);
  const twoDaysAgoStr=twoDaysAgo.toISOString().split('T')[0];

  // ── per-site accumulator ──
  const bysite={};
  rows.forEach(r=>{
    if(!bysite[r.site_name])bysite[r.site_name]={
      reports:[],total_gen:0,pr_sum:0,pr_count:0,
      cuf_sum:0,cuf_count:0,
      grid_outage_days:0,plant_outage_days:0,
      fault_codes:[],wti_max:0,oti_max:0,last_report_date:''
    };
    const s=bysite[r.site_name];
    s.reports.push(r);
    s.total_gen+=(r.total_gen_kwh||0);
    if((r.pr_pct||0)>0){s.pr_sum+=r.pr_pct;s.pr_count++;}
    if((r.dc_cuf_pct||0)>0){s.cuf_sum+=r.dc_cuf_pct;s.cuf_count++;}
    if(r.grid_outage)s.grid_outage_days++;
    if(r.plant_outage)s.plant_outage_days++;
    (r.plant_outage_details||[]).forEach(d=>{if(d&&d.fault_code)s.fault_codes.push(d.fault_code);});
    if((r.wti_c||0)>s.wti_max)s.wti_max=r.wti_c||0;
    if((r.oti_c||0)>s.oti_max)s.oti_max=r.oti_c||0;
    if(r.report_date>s.last_report_date)s.last_report_date=r.report_date;
  });

  // ── per-site enriched ──
  const siteList=(session.role==='manager'?sites.filter(s=>(session.assigned_sites||[]).includes(s.site_name)):sites);
  const enriched=siteList.map(cfg=>{
    const s=bysite[cfg.site_name]||{reports:[],total_gen:0,pr_sum:0,pr_count:0,cuf_sum:0,cuf_count:0,grid_outage_days:0,plant_outage_days:0,fault_codes:[],wti_max:0,oti_max:0,last_report_date:''};
    const pr_avg=s.pr_count>0?Math.round(s.pr_sum/s.pr_count*10)/10:null;
    const cuf_avg=s.cuf_count>0?Math.round(s.cuf_sum/s.cuf_count*10)/10:null;
    const days_since=s.last_report_date?Math.floor((new Date(today)-new Date(s.last_report_date))/86400000):999;
    return{...cfg,...s,pr_avg,cuf_avg,days_since,report_count:s.reports.length};
  });

  // ── fleet-level ──
  const totalSites=enriched.length;
  const reportingSites=enriched.filter(s=>s.days_since<2).length;
  const fleetGen=enriched.reduce((a,s)=>a+s.total_gen,0);
  const prSites=enriched.filter(s=>s.pr_avg!==null);
  const fleetPr=prSites.length?Math.round(prSites.reduce((a,s)=>a+s.pr_avg,0)/prSites.length*10)/10:null;
  const outageSites=enriched.filter(s=>s.grid_outage_days+s.plant_outage_days>0).length;

  // ── DC CUF trend by date (fleet avg) ──
  const cufByDate={};const cufCountByDate={};
  rows.forEach(r=>{
    if((r.dc_cuf_pct||0)>0){
      cufByDate[r.report_date]=(cufByDate[r.report_date]||0)+r.dc_cuf_pct;
      cufCountByDate[r.report_date]=(cufCountByDate[r.report_date]||0)+1;
    }
  });
  const trendDates=Object.keys(cufByDate).sort().slice(-14);
  const trendAvgs=trendDates.map(d=>Math.round(cufByDate[d]/cufCountByDate[d]*10)/10);
  const CUF_MAX=30;

  // ── fault map ──
  const faultMap={};
  enriched.forEach(s=>s.fault_codes.forEach(f=>{faultMap[f]=(faultMap[f]||0)+1;}));
  const topFaults=Object.entries(faultMap).sort((a,b)=>b[1]-a[1]).slice(0,5);

  // ── alerts ──
  const silentList=enriched.filter(s=>s.days_since>=2).sort((a,b)=>b.days_since-a.days_since);
  const activeFaultList=enriched.filter(s=>s.reports.some(r=>r.report_date>=twoDaysAgoStr&&r.plant_outage));
  const lowPrList=enriched.filter(s=>s.pr_avg!==null&&s.pr_avg<70).sort((a,b)=>a.pr_avg-b.pr_avg);
  const highGridList=enriched.filter(s=>s.grid_outage_days>=3);
  const highTempList=enriched.filter(s=>s.wti_max>85||s.oti_max>85);
  const alerts=[];
  if(silentList.length)alerts.push({level:'red',badge:'SILENT',label:`${silentList.length} site${silentList.length>1?'s':''} not reporting (≥2 days)`,anchor:'ins-silent'});
  if(activeFaultList.length)alerts.push({level:'red',badge:'FAULT',label:`${activeFaultList.length} site${activeFaultList.length>1?'s':''} with active plant fault`,anchor:'ins-faults'});
  const amberAlerts=[];
  if(lowPrList.length)amberAlerts.push({badge:'LOW PR',label:`${lowPrList.length} site${lowPrList.length>1?'s':''} PR below 70%`,anchor:'ins-pr'});
  if(highGridList.length)amberAlerts.push({badge:'GRID',label:`${highGridList.length} site${highGridList.length>1?'s':''} grid outage ≥3 days`,anchor:'ins-faults'});
  if(highTempList.length)amberAlerts.push({badge:'TEMP',label:`${highTempList.length} site${highTempList.length>1?'s':''} transformer temp >85°C`,anchor:null});

  // ── outage list ──
  const outageBySite=enriched.filter(s=>s.grid_outage_days+s.plant_outage_days>0)
    .sort((a,b)=>(b.grid_outage_days+b.plant_outage_days)-(a.grid_outage_days+a.plant_outage_days)).slice(0,8);

  // ── sorted table ──
  const sortedSites=[...enriched].sort((a,b)=>insightsSort==='gen'?(b.total_gen-a.total_gen):(a.pr_avg===null?1:b.pr_avg===null?-1:(a.pr_avg-b.pr_avg)));

  const prColor=v=>v===null?'':v>=80?'color:var(--green-dark)':v>=70?'color:var(--amber)':'color:var(--red)';
  const genLabel=v=>v>=1000?(v/1000).toFixed(1)+'k':v.toFixed(0);

  el.innerHTML=`
  <div style="background:var(--primary);padding:12px 14px;color:#fff;display:flex;justify-content:space-between;align-items:center;margin:-12px -14px 10px">
    <div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:17px;font-weight:700">Insights</div>
      <div style="font-size:10px;opacity:.7;margin-top:1px">Fleet performance · Last ${days} days</div>
    </div>
    <span onclick="_insightsCache=null;showInsights()" style="font-size:10px;color:rgba(255,255,255,.85);cursor:pointer;background:rgba(255,255,255,.15);padding:4px 10px;border-radius:99px;border:1px solid rgba(255,255,255,.2)">↺ Refresh</span>
  </div>

  <!-- Toggle -->
  <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px">
    <span class="filter-pill${insightsDays===7?' active':''}" onclick="insightsDays=7;_insightsCache=null;showInsights()">Last 7 days</span>
    <span class="filter-pill${insightsDays===30?' active':''}" onclick="insightsDays=30;_insightsCache=null;showInsights()">Last 30 days</span>
  </div>

  <!-- Alerts -->
  ${alerts.length||amberAlerts.length?`
    ${alerts.length?`<div class="ins-alert-banner">
      <div class="ins-alert-title">⚡ Action Required</div>
      ${alerts.map(a=>`<div class="ins-alert-row">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="badge badge-red">${a.badge}</span>
          <span style="font-size:11px;font-weight:600">${a.label}</span>
        </div>
        ${a.anchor?`<span onclick="document.getElementById('${a.anchor}').scrollIntoView({behavior:'smooth'})" style="font-size:10px;color:var(--blue);white-space:nowrap;cursor:pointer">View →</span>`:''}
      </div>`).join('')}
    </div>`:''}
    ${amberAlerts.length?`<div class="ins-alert-banner ins-alert-amber">
      <div class="ins-alert-title">⚠ Watch List</div>
      ${amberAlerts.map(a=>`<div class="ins-alert-row">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="badge badge-yellow">${a.badge}</span>
          <span style="font-size:11px;font-weight:600">${a.label}</span>
        </div>
        ${a.anchor?`<span onclick="document.getElementById('${a.anchor}').scrollIntoView({behavior:'smooth'})" style="font-size:10px;color:var(--blue);white-space:nowrap;cursor:pointer">View →</span>`:''}
      </div>`).join('')}
    </div>`:''}
  `:`<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#fff;border:1px solid var(--green-border);border-radius:10px;margin-bottom:8px;border-left:3px solid var(--green)">
    <span class="badge badge-green">✓ ALL CLEAR</span>
    <span style="font-size:11px;font-weight:600;color:var(--green-dark)">All systems nominal</span>
  </div>`}

  <!-- KPI Strip -->
  <div class="grid-2" style="margin-bottom:8px">
    <div class="stat-card">
      <div class="stat-num" style="color:var(--green-dark);font-size:16px">${genLabel(fleetGen)}</div>
      <div class="stat-label">kWh Generated</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="font-size:16px;${prColor(fleetPr)}">${fleetPr!==null?fleetPr+'%':'—'}</div>
      <div class="stat-label">Avg Fleet PR</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="font-size:16px">${reportingSites}/${totalSites}</div>
      <div class="stat-label">Sites Reporting</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="font-size:16px;${outageSites>0?'color:var(--red)':'color:var(--green-dark)'}">${outageSites}</div>
      <div class="stat-label">Outage Sites</div>
    </div>
  </div>

  <!-- DC CUF Trend -->
  <div class="card">
    <div class="card-title">Fleet Avg DC CUF% — Daily Trend</div>
    <div style="font-size:9px;color:var(--text-muted);margin-bottom:6px">Avg across reporting sites · line = 20% benchmark</div>
    ${trendDates.length===0?'<div style="color:var(--gray);font-size:11px;text-align:center;padding:10px">No CUF data available</div>':
      trendDates.map((d,i)=>{
        const v=trendAvgs[i];
        const barPct=Math.round(v/CUF_MAX*100);
        const benchPct=Math.round(20/CUF_MAX*100);
        const col=v>=22?'var(--green)':v>=18?'#eab308':'#ef4444';
        const lbl=new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
        return `<div class="ins-bar-row">
          <div class="ins-bar-label">${lbl}</div>
          <div class="ins-bar-track">
            <div class="ins-bar-fill" style="width:${barPct}%;background:${col}"></div>
            <div style="position:absolute;top:0;bottom:0;left:${benchPct}%;width:1.5px;background:rgba(0,0,0,.2)"></div>
          </div>
          <div class="ins-bar-val" style="color:${col}">${v.toFixed(1)}%</div>
        </div>`;
      }).join('')}
    <div style="display:flex;gap:10px;margin-top:8px;padding-top:6px;border-top:1px solid var(--gray-light)">
      <div style="display:flex;align-items:center;gap:3px;font-size:9px;color:var(--gray)"><div style="width:10px;height:3px;background:var(--green);border-radius:2px"></div>≥22% Good</div>
      <div style="display:flex;align-items:center;gap:3px;font-size:9px;color:var(--gray)"><div style="width:10px;height:3px;background:#eab308;border-radius:2px"></div>18–22% Watch</div>
      <div style="display:flex;align-items:center;gap:3px;font-size:9px;color:var(--gray)"><div style="width:10px;height:3px;background:#ef4444;border-radius:2px"></div>&lt;18% Low</div>
    </div>
  </div>

  <!-- Low PR -->
  <div class="card" id="ins-pr">
    <div class="card-title">⬇ Underperforming Sites — PR &lt; 70%</div>
    ${lowPrList.length===0?'<span class="badge badge-green">All sites PR ≥ 70%</span>':
      lowPrList.map(s=>{
        const col=s.pr_avg>=80?'var(--green)':s.pr_avg>=70?'#eab308':'#ef4444';
        return `<div class="ins-pr-row">
          <div class="ins-pr-name">${s.site_name}</div>
          <div style="flex:1.5;position:relative">
            <div class="ins-pr-bar">
              <div style="height:100%;width:${s.pr_avg}%;background:${col};border-radius:99px"></div>
              <div class="ins-pr-tick"></div>
            </div>
          </div>
          <div class="ins-pr-val" style="color:${col}">${s.pr_avg.toFixed(1)}%</div>
        </div>`;
      }).join('')+`<div style="margin-top:6px;font-size:9px;color:var(--text-muted)">${totalSites-lowPrList.length} sites PR ≥ 70%</div>`}
  </div>

  <!-- Fault Hotspots -->
  <div class="card" id="ins-faults">
    <div class="card-title">🔧 Recurring Faults (${days}d)</div>
    ${topFaults.length===0?'<div style="color:var(--gray);font-size:11px">No plant faults recorded in this period</div>':
      topFaults.map(([code,count])=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--gray-light)">
        <div style="font-size:11px">${code}</div>
        <span class="badge ${count>=8?'badge-red':count>=4?'badge-yellow':'badge-gray'}">${count}×</span>
      </div>`).join('')}
  </div>

  <!-- Outage days -->
  ${outageBySite.length?`<div class="card">
    <div class="card-title">📊 Outage Days by Site</div>
    ${outageBySite.map(s=>{
      const total=s.grid_outage_days+s.plant_outage_days;
      const pct=Math.min(Math.round(total/days*100),100);
      return `<div style="padding:4px 0">
        <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:3px">
          <span style="font-weight:600">${s.site_name}</span>
          <span>${s.grid_outage_days?`<span class="badge badge-yellow" style="margin-right:3px">${s.grid_outage_days}d grid</span>`:''}${s.plant_outage_days?`<span class="badge badge-red">${s.plant_outage_days}d plant</span>`:''}</span>
        </div>
        <div class="level-bar"><div class="level-fill ${pct>50?'red':pct>25?'amber':'green'}" style="width:${pct}%"></div></div>
      </div>`;
    }).join('')}
  </div>`:''}

  <!-- Silent sites -->
  <div class="card" id="ins-silent">
    <div class="card-title">📵 Not Reporting (≥2 days)</div>
    ${silentList.length===0?'<span class="badge badge-green">All sites reported recently</span>':
      silentList.map(s=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--gray-light)">
        <div>
          <div style="font-size:11px;font-weight:600">${s.site_name}</div>
          <div style="font-size:9px;color:var(--gray)">Last: ${s.last_report_date||'Never'}</div>
        </div>
        <span class="badge badge-red">${s.days_since===999?'No reports':s.days_since+'d ago'}</span>
      </div>`).join('')}
  </div>

  <!-- All sites table -->
  <div class="card" style="overflow-x:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <div class="card-title" style="margin-bottom:0">All Sites Summary</div>
      <div style="font-size:9px;color:var(--text-muted)">Tap column to sort</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:10px">
      <thead><tr style="border-bottom:1.5px solid var(--border)">
        <th style="text-align:left;padding:4px 0;color:var(--gray);font-weight:600">Site</th>
        <th onclick="insightsSort='pr';renderInsights(_insightsCache.data,insightsDays)" style="text-align:right;padding:4px 4px;cursor:pointer;font-weight:700;color:${insightsSort==='pr'?'var(--primary)':'var(--gray)'}">PR%${insightsSort==='pr'?' ↑':''}</th>
        <th onclick="insightsSort='gen';renderInsights(_insightsCache.data,insightsDays)" style="text-align:right;padding:4px 4px;cursor:pointer;font-weight:700;color:${insightsSort==='gen'?'var(--primary)':'var(--gray)'}">kWh${insightsSort==='gen'?' ↓':''}</th>
        <th style="text-align:right;padding:4px 4px;color:var(--gray);font-weight:600">Out.</th>
      </tr></thead>
      <tbody>
        ${sortedSites.map(s=>{
          const outTotal=s.grid_outage_days+s.plant_outage_days;
          return `<tr style="border-bottom:1px solid var(--gray-light)">
            <td style="padding:5px 0;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">${s.site_name}</td>
            <td style="text-align:right;padding:5px 4px;font-weight:700;${prColor(s.pr_avg)}">${s.pr_avg!==null?s.pr_avg.toFixed(1)+'%':'—'}</td>
            <td style="text-align:right;padding:5px 4px">${s.total_gen>0?genLabel(s.total_gen):'—'}</td>
            <td style="text-align:right;padding:5px 4px">${outTotal>0?`<span class="badge ${outTotal>=7?'badge-red':outTotal>=3?'badge-yellow':'badge-gray'}">${outTotal}</span>`:'—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}
// ── END INSIGHTS ──────────────────────────────────────────────────────────────

function openResetPwModal(userId, userName){
  document.getElementById('resetPwUserId').value=userId;
  document.getElementById('resetPwUserLabel').textContent=userName;
  document.getElementById('resetPwInput').value='';
  document.getElementById('resetPwError').classList.add('hidden');
  document.getElementById('resetPwModal').classList.remove('hidden');
}
async function doAdminResetPw(){
  const userId=document.getElementById('resetPwUserId').value;
  const pw=document.getElementById('resetPwInput').value.trim();
  const errEl=document.getElementById('resetPwError');
  errEl.classList.add('hidden');
  if(pw.length<8){errEl.textContent='Min 8 characters';errEl.classList.remove('hidden');return;}
  const hash=await hashPassword(pw);
  const{error}=await sb.from('users').update({password_hash:hash,must_change_pw:true}).eq('id',userId);
  if(error){errEl.textContent=error.message;errEl.classList.remove('hidden');return;}
  document.getElementById('resetPwModal').classList.add('hidden');
  alert('Password reset. Share the new password with the user — they will be prompted to set a new one on next login.');
}
function openUserModal(userId){
  const modal=document.getElementById('modalOverlay');
  const content=document.getElementById('modalContent');
  if(userId){
    sb.from('users').select('*').eq('id',userId).single().then(({data:u})=>{content.innerHTML=buildUserForm(u);modal.classList.remove('hidden');});
  } else {content.innerHTML=buildUserForm(null);modal.classList.remove('hidden');}
}
function buildUserForm(u){
  const siteOpts=sites.map(s=>`<option value="${s.site_name}"${u&&u.assigned_sites&&u.assigned_sites.includes(s.site_name)?' selected':''}>${s.site_name}</option>`).join('');
  return `
    <div class="modal-header"><div class="modal-title">${u?'Edit User':'Add User'}</div><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-field"><label>Phone</label><input id="mUserPhone" value="${u?u.phone:''}" ${u?'readonly class="readonly"':''}></div>
    <div class="modal-field"><label>Name</label><input id="mUserName" value="${u?u.name:''}"></div>
    <div class="modal-field"><label>Role</label>
      <select id="mUserRole">
        <option value="engineer"${u&&u.role==='engineer'?' selected':''}>Engineer</option>
        <option value="manager"${u&&u.role==='manager'?' selected':''}>Manager</option>
        <option value="admin"${u&&u.role==='admin'?' selected':''}>Admin</option>
      </select>
    </div>
    <div class="modal-field"><label>Assigned sites</label>
      <select id="mUserSites" multiple style="min-height:100px">${siteOpts}</select>
      <div class="text-hint">Hold Ctrl/Cmd to select multiple</div>
    </div>
    ${!u?'<div class="modal-field"><label>Initial password</label><input id="mUserPw" type="text" placeholder="Min 8 chars"></div>':''}
    <div id="mUserError" class="error-box hidden"></div>
    <button class="btn btn-primary" onclick="saveUser('${u?u.id:''}')" style="margin-top:8px">Save</button>
  `;
}
async function saveUser(id){
  const phone=document.getElementById('mUserPhone').value.trim();
  const name=document.getElementById('mUserName').value.trim();
  const role=document.getElementById('mUserRole').value;
  const siteSel=document.getElementById('mUserSites');
  const assignedSites=Array.from(siteSel.selectedOptions).map(o=>o.value);
  const errEl=document.getElementById('mUserError');
  errEl.classList.add('hidden');
  if(!phone||!name){errEl.textContent='Phone and name required';errEl.classList.remove('hidden');return;}
  if(id){
    const{error}=await sb.from('users').update({name,role,assigned_sites:assignedSites}).eq('id',id);
    if(error){errEl.textContent=error.message;errEl.classList.remove('hidden');return;}
  } else {
    const pwEl=document.getElementById('mUserPw');
    const pw=pwEl?pwEl.value:'';
    if(pw.length<8){errEl.textContent='Password min 8 chars';errEl.classList.remove('hidden');return;}
    const hash=await hashPassword(pw);
    const{error}=await sb.from('users').insert({phone,name,role,assigned_sites:assignedSites,password_hash:hash,must_change_pw:true});
    if(error){errEl.textContent=error.message;errEl.classList.remove('hidden');return;}
  }
  closeModal();showAdminUsers();
}
function downloadUserTemplate(){
  const siteList=sites.map(s=>s.site_name).join(' | ');
  const rows=[
    'phone,name,role,assigned_sites,password',
    '9876543210,Ramesh Kumar,engineer,Bidasar|Badsar,Welcome@123',
    '9876543211,Priya Sharma,manager,ALL,Welcome@123',
    '# Role options: engineer / manager / admin',
    '# assigned_sites: pipe-separated site names (e.g. Bidasar|Badsar) or ALL for all sites',
    '# password: min 8 chars — user will be asked to change on first login',
    '#',
    '# Available sites:',
    ...sites.map(s=>`# ${s.site_name}`)
  ];
  const blob=new Blob([rows.join('\n')],{type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='dgr_users_template.csv';
  a.click();
}
async function handleCSV(e){
  const file=e.target.files[0];if(!file)return;
  const text=await file.text();const lines=text.trim().split('\n');const rows=[];
  for(let i=1;i<lines.length;i++){
    const cols=lines[i].split(',').map(c=>c.trim());if(cols.length<5)continue;
    const hash=await hashPassword(cols[4]);
    rows.push({phone:cols[0],name:cols[1],role:cols[2],assigned_sites:cols[3].split('|').map(s=>s.trim()),password_hash:hash,must_change_pw:true});
  }
  if(rows.length>0){await sb.from('users').upsert(rows,{onConflict:'phone'});alert(`Uploaded ${rows.length} users`);showAdminUsers();}
  e.target.value='';
}

async function showAdminSites(){
  const el=document.getElementById('adminContent');
  el.innerHTML='<div style="text-align:center;color:var(--gray);padding:10px">Loading...</div>';
  try{
    const{data}=await sb.from('site_config').select('*').order('site_name');
    el.innerHTML=`
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <button class="btn btn-primary" style="flex:1;padding:8px;font-size:11px" onclick="openNewSiteModal()">+ Add Site</button>
        <button class="btn btn-secondary" style="flex:1;padding:8px;font-size:11px" onclick="document.getElementById('siteCsvInput').click()">Bulk CSV</button>
        <button class="btn btn-secondary" style="flex:1;padding:8px;font-size:11px" onclick="downloadSiteTemplate()">Template</button>
      </div>
      <div style="overflow-x:auto">
        <table class="admin-table">
          <thead><tr><th>Site</th><th>DC kW</th><th>AC kW</th><th>Inv</th><th>Lat/Lng</th><th></th></tr></thead>
          <tbody>
            ${(data||[]).map(s=>`<tr>
              <td style="font-weight:600">${s.site_name}</td>
              <td>${s.dc_capacity_kw||'—'}</td>
              <td>${s.ac_capacity_kw||'—'}</td>
              <td>${s.inverter_count||'—'}</td>
              <td>${s.latitude&&s.longitude?`${(+s.latitude).toFixed(2)}, ${(+s.longitude).toFixed(2)}`:'<span style="color:var(--red);font-size:9px">Missing</span>'}</td>
              <td><span style="color:var(--blue);cursor:pointer;font-size:10px" onclick="openSiteModal('${s.id}')">Edit</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }catch(e){el.innerHTML='<div class="error-box">Failed to load sites</div>';}
}
function downloadSiteTemplate(){
  const rows=[['site_name','dc_capacity_kw','ac_capacity_kw','inverter_count','strings_per_inv','total_modules','latitude','longitude']];
  (sites||[]).forEach(s=>{
    rows.push([
      s.site_name,
      s.dc_capacity_kw||'',
      s.ac_capacity_kw||'',
      s.inverter_count||'',
      s.strings_per_inv?(Array.isArray(s.strings_per_inv)?s.strings_per_inv.join(';'):s.strings_per_inv):'',
      s.total_modules||'',
      s.latitude||'',
      s.longitude||''
    ]);
  });
  // If no sites loaded yet, add example rows
  if(rows.length===1){
    rows.push(['Example Site','2000','1800','10','26;26;25;25;26;26;25;25;26;26','3500','28.6139','77.2090']);
  }
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='sites_template.csv';
  a.click();
}
async function handleSiteBulkCSV(e){
  const file=e.target.files[0];
  if(!file)return;
  const text=await file.text();
  const lines=text.trim().split('\n');
  const headers=lines[0].split(',').map(h=>h.trim().replace(/^"|"$/g,'').toLowerCase());
  const rows=lines.slice(1);
  let updated=0,errors=[];
  for(const row of rows){
    if(!row.trim())continue;
    const cols=row.match(/("(?:[^"]|"")*"|[^,]*)/g).map(v=>v.trim().replace(/^"|"$/g,'').replace(/""/g,'"'));
    const obj={};headers.forEach((h,i)=>{obj[h]=cols[i]||'';});
    if(!obj.site_name)continue;
    const update={};
    if(obj.dc_capacity_kw!=='')update.dc_capacity_kw=parseFloat(obj.dc_capacity_kw)||null;
    if(obj.ac_capacity_kw!=='')update.ac_capacity_kw=parseFloat(obj.ac_capacity_kw)||null;
    if(obj.inverter_count!=='')update.inverter_count=parseInt(obj.inverter_count)||null;
    if(obj.strings_per_inv!=='')update.strings_per_inv=obj.strings_per_inv.split(';').map(s=>parseInt(s.trim())).filter(n=>!isNaN(n));
    if(obj.total_modules!=='')update.total_modules=parseInt(obj.total_modules)||null;
    if(obj.latitude!=='')update.latitude=parseFloat(obj.latitude)||null;
    if(obj.longitude!=='')update.longitude=parseFloat(obj.longitude)||null;
    if(!Object.keys(update).length)continue;
    const{error}=await sb.from('site_config').update(update).eq('site_name',obj.site_name);
    if(error)errors.push(obj.site_name+': '+error.message);
    else updated++;
  }
  e.target.value='';
  alert(updated+' site(s) updated.'+(errors.length?'\n\nErrors:\n'+errors.join('\n'):''));
  await loadSites();showAdminSites();
}
function openNewSiteModal(){
  const modal=document.getElementById('modalOverlay');
  const content=document.getElementById('modalContent');
  content.innerHTML=`
    <div class="modal-header"><div class="modal-title">Add New Site</div><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-field"><label>Site name *</label><input id="mSiteName" placeholder="e.g. Bidasar"></div>
    <div class="modal-field"><label>DC capacity (kW)</label><input id="mSiteDC" type="number" placeholder="2000"></div>
    <div class="modal-field"><label>AC capacity (kW)</label><input id="mSiteAC" type="number" placeholder="1800"></div>
    <div class="modal-field"><label>Inverter count</label><input id="mSiteInv" type="number" placeholder="10"></div>
    <div class="modal-field"><label>Strings per inverter (comma-separated)</label>
      <input id="mSiteStr" placeholder="26,26,25,...">
    </div>
    <div class="modal-field"><label>Total modules on site</label><input id="mSiteMods" type="number" placeholder="3500"></div>
    <div class="modal-field"><label>Latitude</label><input id="mSiteLat" type="number" step="any" placeholder="28.6139"></div>
    <div class="modal-field"><label>Longitude</label><input id="mSiteLng" type="number" step="any" placeholder="77.2090"></div>
    <div id="mSiteError" class="error-box hidden"></div>
    <button class="btn btn-primary" onclick="saveSite(null)" style="margin-top:8px">Add Site</button>
  `;
  modal.classList.remove('hidden');
}
function openSiteModal(siteId){
  sb.from('site_config').select('*').eq('id',siteId).single().then(({data:s})=>{
    const modal=document.getElementById('modalOverlay');
    const content=document.getElementById('modalContent');
    content.innerHTML=`
      <div class="modal-header"><div class="modal-title">Edit Site</div><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="modal-field"><label>Site name</label><input id="mSiteName" value="${s.site_name}" readonly class="readonly"></div>
      <div class="modal-field"><label>DC capacity (kW)</label><input id="mSiteDC" type="number" value="${s.dc_capacity_kw||''}"></div>
      <div class="modal-field"><label>AC capacity (kW)</label><input id="mSiteAC" type="number" value="${s.ac_capacity_kw||''}"></div>
      <div class="modal-field"><label>Inverter count</label><input id="mSiteInv" type="number" value="${s.inverter_count||''}"></div>
      <div class="modal-field"><label>Strings per inverter (comma-separated)</label>
        <input id="mSiteStr" value="${s.strings_per_inv?s.strings_per_inv.join(','):''}" placeholder="26,26,25,...">
      </div>
      <div class="modal-field"><label>Total modules on site</label><input id="mSiteMods" type="number" value="${s.total_modules||''}"></div>
      <div class="modal-field"><label>Latitude</label><input id="mSiteLat" type="number" step="any" value="${s.latitude||''}" placeholder="28.6139"></div>
      <div class="modal-field"><label>Longitude</label><input id="mSiteLng" type="number" step="any" value="${s.longitude||''}" placeholder="77.2090"></div>
      <div id="mSiteError" class="error-box hidden"></div>
      <button class="btn btn-primary" onclick="saveSite('${s.id}')" style="margin-top:8px">Save</button>
    `;
    modal.classList.remove('hidden');
  });
}
async function saveSite(id){
  const name=document.getElementById('mSiteName').value.trim();
  const dc=parseFloat(document.getElementById('mSiteDC').value)||null;
  const ac=parseFloat(document.getElementById('mSiteAC').value)||null;
  const inv=parseInt(document.getElementById('mSiteInv').value)||null;
  const strRaw=document.getElementById('mSiteStr').value.trim();
  const strs=strRaw?strRaw.split(',').map(s=>parseInt(s.trim())).filter(n=>!isNaN(n)):null;
  const mods=parseInt(document.getElementById('mSiteMods').value)||null;
  const lat=parseFloat(document.getElementById('mSiteLat').value)||null;
  const lng=parseFloat(document.getElementById('mSiteLng').value)||null;
  const errEl=document.getElementById('mSiteError');
  errEl.classList.add('hidden');
  if(!id&&!name){errEl.textContent='Site name is required';errEl.classList.remove('hidden');return;}
  let error;
  if(id){
    ({error}=await sb.from('site_config').update({
      dc_capacity_kw:dc,ac_capacity_kw:ac,inverter_count:inv,strings_per_inv:strs,
      latitude:lat,longitude:lng,total_modules:mods
    }).eq('id',id));
  } else {
    ({error}=await sb.from('site_config').insert({
      site_name:name,dc_capacity_kw:dc,ac_capacity_kw:ac,inverter_count:inv,
      strings_per_inv:strs,latitude:lat,longitude:lng,total_modules:mods,active:true
    }));
  }
  if(error){errEl.textContent='Save failed: '+error.message;errEl.classList.remove('hidden');return;}
  closeModal();await loadSites();showAdminSites();
}
// ADMIN SETTINGS
async function showAdminSettings(){
  const el=document.getElementById('adminContent');
  el.innerHTML=`
    <div class="card">
      <div class="flex-between" style="margin-bottom:8px">
        <div class="card-title" style="margin-bottom:0">Grid outage reasons</div>
        <button class="btn btn-primary" style="padding:5px 10px;font-size:10px;width:auto" onclick="addSettingItem('grid_outage_reasons')">+ Add</button>
      </div>
      <div id="settingsList_grid_outage_reasons">
        ${(appSettings.grid_outage_reasons||[]).map((r,i)=>`
          <div class="settings-item">
            <span class="settings-item-text">${r}</span>
            <span style="color:var(--red);cursor:pointer;font-size:10px" onclick="removeSettingItem('grid_outage_reasons',${i})">Remove</span>
          </div>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="flex-between" style="margin-bottom:8px">
        <div class="card-title" style="margin-bottom:0">Plant fault codes</div>
        <button class="btn btn-primary" style="padding:5px 10px;font-size:10px;width:auto" onclick="addSettingItem('plant_fault_codes')">+ Add</button>
      </div>
      <div id="settingsList_plant_fault_codes">
        ${(appSettings.plant_fault_codes||[]).map((r,i)=>`
          <div class="settings-item">
            <span class="settings-item-text">${r}</span>
            <span style="color:var(--red);cursor:pointer;font-size:10px" onclick="removeSettingItem('plant_fault_codes',${i})">Remove</span>
          </div>`).join('')}
      </div>
    </div>
    <div id="settingsSaveStatus" style="font-size:11px;color:var(--green);text-align:center;margin-top:4px"></div>
    ${buildSheetsSettingsPanel()}
    ${buildDownloadPanel()}
  `;
}
async function addSettingItem(settingKey){
  const val=prompt(`Add new item to ${settingKey==='grid_outage_reasons'?'grid outage reasons':'plant fault codes'}:`);
  if(!val||!val.trim())return;
  if(!appSettings[settingKey])appSettings[settingKey]=[];
  appSettings[settingKey].push(val.trim());
  await saveAppSetting(settingKey);
  showAdminSettings();
}
async function removeSettingItem(settingKey,idx){
  appSettings[settingKey].splice(idx,1);
  await saveAppSetting(settingKey);
  showAdminSettings();
}
async function saveAppSetting(key){
  localStorage.setItem("dgr_app_settings",JSON.stringify(appSettings));
  try{
    await sb.from('dgr_settings').upsert({key,value:appSettings[key],updated_at:new Date().toISOString()},{onConflict:'key'});
    const el=document.getElementById('settingsSaveStatus');
    if(el){el.textContent='Saved ✓';setTimeout(()=>{if(el)el.textContent='';},2000);}
  }catch(e){alert('Save failed: '+e.message);}
}

// WEATHER AUDIT
async function showWeatherAudit(){
  const el=document.getElementById('adminContent');
  el.innerHTML=`
    <div class="card">
      <div class="card-title">Weather Audit — Manual vs Satellite</div>
      <div class="grid-2" style="margin-bottom:8px">
        <div><label>Site</label><select id="waAuditSite"><option value="">Select</option>${sites.map(s=>`<option value="${s.site_name}">${s.site_name}</option>`).join('')}</select></div>
        <div><label>Date</label><input type="date" id="waAuditDate" value="${new Date().toISOString().split('T')[0]}"></div>
      </div>
      <button class="btn btn-primary" style="padding:8px;font-size:11px" onclick="runWeatherAudit()">Compare</button>
    </div>
    <div id="waAuditResult"></div>
  `;
}
async function runWeatherAudit(){
  const siteName=document.getElementById('waAuditSite').value;
  const date=document.getElementById('waAuditDate').value;
  const resultEl=document.getElementById('waAuditResult');
  if(!siteName||!date){resultEl.innerHTML='<div class="warning-box">Select site and date</div>';return;}
  resultEl.innerHTML='<div style="text-align:center;color:var(--gray);padding:10px">Loading...</div>';
  try{
    const{data:sub}=await sb.from('dgr_submissions').select('*').eq('site_name',siteName).eq('report_date',date).single();
    if(!sub){resultEl.innerHTML='<div class="warning-box">No submission found</div>';return;}
    const wa=sub.weather_auto;
    if(!wa){resultEl.innerHTML='<div class="warning-box">No satellite data captured for this submission</div>';return;}
    function delta(manual,satellite){
      if(!manual||!satellite)return '—';
      return Math.abs(((manual-satellite)/satellite)*100).toFixed(1);
    }
    function deltaColor(d){const v=parseFloat(d);if(isNaN(v))return 'badge-gray';if(v<10)return 'badge-green';if(v<20)return 'badge-yellow';return 'badge-red';}
    const radDelta=delta(sub.peak_radiation_wm2,wa.gen_hours_ghi_peak);
    resultEl.innerHTML=`
      <div class="card">
        <div class="card-title">Manual vs Satellite</div>
        <div class="summary-row"><span class="summary-label">Peak radiation</span>
          <span class="summary-value">Manual: ${sub.peak_radiation_wm2||'—'} | Sat: ${wa.gen_hours_ghi_peak||'—'} W/m²
            <span class="badge ${deltaColor(radDelta)}" style="margin-left:4px">${radDelta}%</span></span></div>
        <div class="summary-row"><span class="summary-label">Weather / Cloud</span>
          <span class="summary-value">Manual: ${sub.weather||'—'} | Cloud: ${wa.gen_hours_cloud_pct||'—'}%</span></div>
        <div class="summary-row"><span class="summary-label">Satellite temp</span>
          <span class="summary-value">Max: ${wa.gen_hours_temp_max||'—'}°C / Avg: ${wa.gen_hours_temp_avg||'—'}°C</span></div>
        <div class="summary-row"><span class="summary-label">Manual ambient</span>
          <span class="summary-value">Max: ${sub.weather_max_ambient_c||'—'}°C / Avg: ${sub.weather_avg_ambient_c||'—'}°C</span></div>
        <div class="summary-row"><span class="summary-label">Manual module temp</span>
          <span class="summary-value">Max: ${sub.weather_max_module_c||'—'}°C / Avg: ${sub.weather_avg_module_c||'—'}°C</span></div>
        <div class="summary-row"><span class="summary-label">Effective sun hours</span>
          <span class="summary-value">${wa.effective_sun_hours||'—'} hrs</span></div>
        <div class="summary-row"><span class="summary-label">Precipitation</span>
          <span class="summary-value">${wa.precipitation_mm||0} mm</span></div>
      </div>`;
  }catch(e){resultEl.innerHTML='<div class="error-box">Error: '+e.message+'</div>';}
}

// ─── ADMIN: HISTORICAL IMPORT ────────────────────────────────────────────────
function showAdminImport(){
  const el=document.getElementById('adminContent');
  el.innerHTML=`
    <div class="card">
      <div class="card-title">DGR Historical Import</div>
      <div style="font-size:11px;color:var(--gray);margin-bottom:10px;line-height:1.6">
        Upload past DGR data in bulk via CSV. Each row = one site × one date.<br>
        All uploaded records are marked <span class="badge badge-green" style="font-size:9px">approved</span> automatically.<br>
        Re-uploading the same site + date safely overwrites (no duplicates).
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary" style="flex:1;padding:8px;font-size:11px" onclick="downloadDgrHistTemplate()">⬇ Download Template</button>
        <button class="btn btn-primary" style="flex:1;padding:8px;font-size:11px" onclick="document.getElementById('dgrHistCsvInput').click()">⬆ Upload CSV</button>
      </div>
    </div>
    <div id="dgrHistResult"></div>`;
}

function downloadDgrHistTemplate(){
  const siteNames=(sites||[]).map(s=>s.site_name);
  const ex1=siteNames[0]||'Bidasar';
  const ex2=siteNames[1]||'Badsar';
  const rows=[
    ['site_name','report_date','submitted_by_name','total_gen_kwh','inv_gen','dc_capacity_kw','ac_capacity_kw','peak_radiation_wm2','poa_kwh_m2','peak_power_kwh','dc_cuf_pct','ac_cuf_pct','pr_pct','grid_outage','plant_outage','wti_c','oti_c','weather','rain','modules_cleaned_today','modules_total','daily_activity','remarks'],
    [ex1,'2026-01-01','Ramesh Kumar','4250','210|208|212|205|209|211|207|210|208|210','2000','1800','850','5.2','1800','0.15','0.21','78.5','FALSE','FALSE','72','68','Sunny','FALSE','120','3500','Routine cleaning','All normal'],
    [ex2,'2026-01-01','Suresh Singh','2100','','1000','900','820','4.9','880','','','75.2','FALSE','TRUE','74','71','Hazy','FALSE','','','','Inverter 3 trip - resolved'],
    ['# INSTRUCTIONS:','','','','','','','','','','','','','','','','','','','','','',''],
    ['# site_name: must match exactly as shown below','','','','','','','','','','','','','','','','','','','','','',''],
    ['# report_date: YYYY-MM-DD format only','','','','','','','','','','','','','','','','','','','','','',''],
    ['# inv_gen: pipe-separated kWh per inverter e.g. 210|208|212','','','','','','','','','','','','','','','','','','','','','',''],
    ['# dc_capacity_kw / ac_capacity_kw: leave blank to auto-fill from site config','','','','','','','','','','','','','','','','','','','','','',''],
    ['# grid_outage / plant_outage / rain: TRUE or FALSE','','','','','','','','','','','','','','','','','','','','','',''],
    ['# weather: Sunny / Cloudy / Hazy / Rainy','','','','','','','','','','','','','','','','','','','','','',''],
    ['# AVAILABLE SITES:','','','','','','','','','','','','','','','','','','','','','',''],
    ...siteNames.map(s=>([`# ${s}`,'','','','','','','','','','','','','','','','','','','','','','']))
  ];
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='dgr_historical_template.csv';
  a.click();
}

async function handleDgrHistCSV(e){
  const file=e.target.files[0];if(!file)return;
  const resultEl=document.getElementById('dgrHistResult');
  if(!resultEl)return;
  resultEl.innerHTML='<div class="card" style="text-align:center;color:var(--gray);padding:12px">Parsing CSV...</div>';
  const text=await file.text();
  const allLines=text.trim().split('\n');
  // strip comment lines and blank lines, keep header + data
  const lines=allLines.filter(l=>!l.trim().startsWith('#')&&l.trim()!=='');
  if(lines.length<2){resultEl.innerHTML='<div class="error-box">No data rows found</div>';e.target.value='';return;}
  // parse header
  const parseFields=line=>{const r=[];let cur='',inQ=false;for(const c of line+','){if(c==='"'){inQ=!inQ;}else if(c===','&&!inQ){r.push(cur.trim().replace(/^"|"$/g,''));cur='';}else cur+=c;}return r;};
  const headers=parseFields(lines[0]).map(h=>h.toLowerCase().replace(/\s+/g,'_'));
  const col=k=>headers.indexOf(k);
  // build site lookup map
  const siteMap={};(sites||[]).forEach(s=>{siteMap[s.site_name]=s;});
  const toBool=v=>['true','yes','1'].includes((v||'').toLowerCase());
  const toNum=v=>v===''||v===undefined?null:parseFloat(v)||null;
  const rows=[];const errors=[];
  for(let i=1;i<lines.length;i++){
    const f=parseFields(lines[i]);
    const get=k=>col(k)>=0?(f[col(k)]||'').trim():'';
    const siteName=get('site_name');
    const reportDate=get('report_date');
    if(!siteName){errors.push(`Row ${i+1}: site_name is required`);continue;}
    if(!siteMap[siteName]){errors.push(`Row ${i+1}: site "${siteName}" not found in site config`);continue;}
    if(!reportDate||!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)){errors.push(`Row ${i+1}: report_date must be YYYY-MM-DD`);continue;}
    const site=siteMap[siteName];
    const invRaw=get('inv_gen');
    const invGen=invRaw?invRaw.split('|').map(v=>parseFloat(v.trim())).filter(n=>!isNaN(n)):null;
    rows.push({
      site_name:siteName,
      report_date:reportDate,
      submitted_by_name:get('submitted_by_name')||'Historical Upload',
      submitted_by_phone:session.phone,
      dc_capacity_kw:toNum(get('dc_capacity_kw'))||site.dc_capacity_kw||null,
      ac_capacity_kw:toNum(get('ac_capacity_kw'))||site.ac_capacity_kw||null,
      total_gen_kwh:toNum(get('total_gen_kwh')),
      inv_gen:invGen,
      peak_radiation_wm2:toNum(get('peak_radiation_wm2')),
      poa_kwh_m2:toNum(get('poa_kwh_m2')),
      peak_power_kwh:toNum(get('peak_power_kwh')),
      dc_cuf_pct:toNum(get('dc_cuf_pct')),
      ac_cuf_pct:toNum(get('ac_cuf_pct')),
      pr_pct:toNum(get('pr_pct')),
      grid_outage:toBool(get('grid_outage')),
      plant_outage:toBool(get('plant_outage')),
      wti_c:toNum(get('wti_c')),
      oti_c:toNum(get('oti_c')),
      weather:get('weather')||null,
      rain:toBool(get('rain')),
      modules_cleaned_today:toNum(get('modules_cleaned_today')),
      modules_total:toNum(get('modules_total'))||site.total_modules||null,
      daily_activity:get('daily_activity')||null,
      remarks:get('remarks')||'',
      status:'approved',
      image_urls:null,
      grid_outage_details:null,
      plant_outage_details:null,
      inv_modules_cleaned:null,
      weather_auto:null,
      inv_strings:site.strings_per_inv||null,
      synced_to_sheet:false,
    });
  }
  if(rows.length===0){
    resultEl.innerHTML=`<div class="error-box">No valid rows to import.<br>${errors.map(e=>`• ${e}`).join('<br>')}</div>`;
    e.target.value='';return;
  }
  resultEl.innerHTML=`<div class="card" style="text-align:center;color:var(--gray);padding:12px">Uploading ${rows.length} row(s)...</div>`;
  // upsert in batches of 50
  const BATCH=50;let imported=0;
  for(let i=0;i<rows.length;i+=BATCH){
    const batch=rows.slice(i,i+BATCH);
    const{error}=await sb.from('dgr_submissions').upsert(batch,{onConflict:'site_name,report_date'});
    if(error){errors.push(`Batch ${Math.floor(i/BATCH)+1}: ${error.message}`);}
    else{imported+=batch.length;}
  }
  const errHtml=errors.length?`<div style="margin-top:8px;font-size:10px;color:var(--red)">${errors.map(e=>`• ${e}`).join('<br>')}</div>`:'';
  resultEl.innerHTML=`
    <div class="card" style="background:var(--green-light);border-color:var(--green-border)">
      <div style="font-size:13px;font-weight:700;color:var(--green-dark)">✓ ${imported} row(s) imported</div>
      ${errors.length?`<div style="font-size:11px;color:var(--gray);margin-top:2px">${errors.length} error(s)</div>`:''}
      ${errHtml}
    </div>`;
  e.target.value='';
}
// ─────────────────────────────────────────────────────────────────────────────

// VIEW SUBMISSION SUMMARY
async function viewSubmission(id){
  const modal=document.getElementById('modalOverlay');
  const content=document.getElementById('modalContent');
  content.innerHTML=`<div class="modal-header"><div class="modal-title">Loading...</div><button class="modal-close" onclick="closeModal()">✕</button></div>`;
  modal.classList.remove('hidden');
  const{data:d,error}=await sb.from('dgr_submissions').select('*').eq('id',id).single();
  if(error||!d){content.innerHTML=`<div class="modal-header"><div class="modal-title">Error</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="error-box">Could not load submission</div>`;return;}
  const dateStr=new Date(d.report_date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
  const inv=d.inv_gen||[];
  const strs=d.inv_strings||[];
  let invRows='';
  for(let i=0;i<inv.length;i++){
    const s=strs[i]||0;
    const dc=d.dc_capacity_kw&&inv.length?d.dc_capacity_kw/inv.length:0;
    const sy=dc>0?(inv[i]/dc).toFixed(2):'—';
    const ps=s>0?(inv[i]/s).toFixed(1):'—';
    invRows+=`<tr><td style="color:var(--blue);font-weight:700">INV${i+1}</td><td>${inv[i]}</td><td>${sy}</td><td>${ps}</td></tr>`;
  }
  const gridDetails=(d.grid_outage_details||[]).map(o=>`${o.from||'?'}–${o.to||'?'} · ${o.reason||''}`).join('<br>');
  const plantDetails=(d.plant_outage_details||[]).map(o=>`${o.from||'?'}–${o.to||'?'} · ${o.fault_code||''} ${o.sub_fault?'('+o.sub_fault+')':''}`).join('<br>');
  const isReturned=d.status==='pending'&&!!(d.review_note&&String(d.review_note).trim());
  const statusLabel=isReturned?'returned':d.status;
  const statusCls=d.status==='approved'?'badge-green':d.status==='rejected'?'badge-red':'badge-yellow';

  function row(label,val){return `<div class="summary-row"><span class="summary-label">${label}</span><span class="summary-value">${val}</span></div>`;}

  content.innerHTML=`
    <div class="modal-header">
      <div>
        <div class="modal-title">${d.site_name}</div>
        <div style="font-size:10px;color:var(--gray)">${dateStr} · ${d.submitted_by_name||''} · <span class="badge ${statusCls}">${statusLabel}</span></div>
      </div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin:8px 0 4px">Generation</div>
    <table class="admin-table" style="margin-bottom:8px">
      <thead><tr><th>#</th><th>kWh</th><th>kWh/kWp</th><th>kWh/str</th></tr></thead>
      <tbody>${invRows}</tbody>
    </table>
    ${row('Total generation','<strong>'+( d.total_gen_kwh||0)+' kWh</strong>')}
    ${row('DC CUF / AC CUF',`${d.dc_cuf_pct||0}% / ${d.ac_cuf_pct||0}%`)}
    ${row('PR',`<strong>${d.pr_pct||0}%</strong>`)}
    ${row('Peak radiation',`${d.peak_radiation_wm2||'—'} W/m²`)}
    ${row('POA',`${d.poa_kwh_m2||'—'} kWh/m²`)}
    ${row('Peak power',`${d.peak_power_kwh||'—'} kWh`)}
    <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin:10px 0 4px">Outages</div>
    ${row('Grid outage',d.grid_outage?`<span class="badge badge-yellow">Yes</span><br><span style="font-size:10px">${gridDetails}</span>`:'<span class="badge badge-green">No</span>')}
    ${row('Plant outage',d.plant_outage?`<span class="badge badge-red">Yes</span><br><span style="font-size:10px">${plantDetails}</span>`:'<span class="badge badge-green">No</span>')}
    <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin:10px 0 4px">Transformer</div>
    ${row('WTI',`${d.wti_c||'—'}°C ${d.wti_peak_time?'at '+d.wti_peak_time:''}`)}
    ${row('OTI',`${d.oti_c||'—'}°C ${d.oti_peak_time?'at '+d.oti_peak_time:''}`)}
    ${row('MOG level',d.mog_level||'—')}
    ${row('Silica gel',d.silica_gel||'—')}
    <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin:10px 0 4px">Weather & Temps</div>
    ${row('Condition',d.weather||'—')}
    ${row('Rain',d.rain?(d.rain_intensity||'Yes')+(d.rain_modules_cleaned?' · Modules cleaned':''):'No')}
    ${row('Ambient temp',`Avg ${d.weather_avg_ambient_c||'—'}°C / Max ${d.weather_max_ambient_c||'—'}°C`)}
    ${row('Module temp',`Avg ${d.weather_avg_module_c||'—'}°C / Max ${d.weather_max_module_c||'—'}°C`)}
    <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin:10px 0 4px">Cleaning</div>
    ${row('Cycle status',`C1: ${d.cleaning_c1_status||'—'} · C2: ${d.cleaning_c2_status||'—'} · C3: ${d.cleaning_c3_status||'—'}`)}
    ${row('Modules cleaned',d.modules_cleaned_today!=null?`${d.modules_cleaned_today} / ${d.modules_total||'—'}`:'—')}
    <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin:10px 0 4px">Activity & Remarks</div>
    ${row('Today\'s activity',d.daily_activity||'—')}
    ${row('Remarks',d.remarks||'—')}
    ${((d.status==='rejected'||isReturned)&&d.review_note)?row(isReturned?'Return note':'Rejection reason',`<span style="color:var(--red)">${d.review_note}</span>`):''}
    ${d.reviewed_by?row('Reviewed by',d.reviewed_by):''}
  `;
}

// MODAL
function closeModal(e){
  if(e && e.target && e.target.id !== 'modalOverlay') return;
  const overlay=document.getElementById('modalOverlay');
  const content=document.getElementById('modalContent');
  if(content)content.innerHTML='';
  if(overlay)overlay.classList.add('hidden');
}
