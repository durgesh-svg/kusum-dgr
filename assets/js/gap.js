// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE GAP — splits each site's shortfall into grid-attributable and
// unexplained, which is the difference between sending a technician and
// sending an invoice.
//
// Why not PR: 17 sites have no pyranometer and 22 log physically impossible
// irradiance, so PR ranks 2 honest measurements against 46 broken ones.
// Specific yield (kWh/kWp) needs only generation and DC capacity, both
// reliable for all 48 sites. Ranking each site against the FLEET MEDIAN for
// the same day cancels weather without any sensor at all.
//
// Grid attribution uses the outage windows already recorded in
// grid_outage_details (populated on ~98% of outage-flagged reports and, until
// now, never read). Expected production lost to an outage is pro-rated by the
// share of the generating day it consumed.
//
// Renders into #screenInsights from showInsights(). Read-only: this module
// never writes.
// ─────────────────────────────────────────────────────────────────────────────

// Generating hours in a day, used to pro-rate outage minutes against expected
// output. Approximate: outage minutes are not all at peak sun, so a site's
// grid-attributable share is an estimate, not a meter reading.
const GAP_SOLAR_HOURS = 10;
const GAP_TARIFF = 3.0;          // Rs/kWh, for indicative annualised value only
let gapDays = 60;
let _gapRows = null;

function gapFmt(n){return Math.round(n).toLocaleString('en-IN');}
function gapLakh(kwhPerWindow,days){
  return ((kwhPerWindow/days)*365*GAP_TARIFF/100000);
}

// Minutes lost from one report's outage windows. Mirrors calcOutageMins() in
// export-offline.js; kept local so this module has no load-order dependency.
function gapOutageMins(details){
  if(!Array.isArray(details))return 0;
  let m=0;
  details.forEach(o=>{
    if(!o||!o.from||!o.to)return;
    const f=String(o.from).split(':'), t=String(o.to).split(':');
    if(f.length<2||t.length<2)return;
    const a=(+f[0])*60+(+f[1]), b=(+t[0])*60+(+t[1]);
    if(isFinite(a)&&isFinite(b)&&b>a)m+=(b-a);
  });
  return m;
}

// PostgREST caps a plain select at 1000 rows and says nothing about it. 48
// sites x 90 days is ~4300, so this MUST paginate -- otherwise the whole
// analysis is silently computed on a truncated, arbitrarily-cut slice.
async function loadGapData(days){
  const from=new Date(); from.setDate(from.getDate()-days);
  const fromDate=from.toISOString().split('T')[0];
  const PAGE=1000;
  let all=[], page=0;
  for(;;){
    const{data,error}=await sb.from('dgr_submissions')
      .select('site_name,report_date,total_gen_kwh,grid_outage,grid_outage_details,plant_outage')
      .gte('report_date',fromDate)
      .order('report_date',{ascending:true})
      .range(page*PAGE,(page+1)*PAGE-1);
    if(error)throw error;
    all=all.concat(data||[]);
    if(!data||data.length<PAGE)break;
    if(++page>20)break;                        // hard stop; ~21k rows
  }
  return all;
}

// Returns one row per site, ranked by unexplained kWh.
function computeGap(rows){
  const dcOf={};
  sites.forEach(s=>{if(s.dc_capacity_kw>0)dcOf[s.site_name]=Number(s.dc_capacity_kw);});

  // Specific yield per site-day, then the fleet median for each day.
  const byDay={};
  rows.forEach(r=>{
    const dc=dcOf[r.site_name], gen=Number(r.total_gen_kwh)||0;
    if(!dc||gen<=0)return;                      // zero-output days carry no signal
    (byDay[r.report_date]=byDay[r.report_date]||[]).push({site:r.site_name,sy:gen/dc,gen,dc,row:r});
  });

  const out={};
  Object.keys(byDay).forEach(date=>{
    const day=byDay[date];
    if(day.length<5)return;                     // too few reports to trust a median
    const sorted=day.map(d=>d.sy).sort((a,b)=>a-b);
    const med=sorted[Math.floor(sorted.length/2)];
    day.forEach(d=>{
      const s=out[d.site]||(out[d.site]={site:d.site,dc:d.dc,days:0,actual:0,expected:0,
                                        outageMins:0,outageDays:0,explained:0,plantOutDays:0});
      const expectedToday=med*d.dc;
      s.days++; s.actual+=d.gen; s.expected+=expectedToday;
      if(d.row.grid_outage){
        const mins=gapOutageMins(d.row.grid_outage_details);
        s.outageDays++; s.outageMins+=mins;
        // Share of the generating day lost, capped at the whole day
        s.explained+=expectedToday*Math.min(1,(mins/60)/GAP_SOLAR_HOURS);
      }
      if(d.row.plant_outage)s.plantOutDays++;
    });
  });

  return Object.values(out).map(s=>{
    const gap=s.expected-s.actual;
    const explained=Math.min(Math.max(s.explained,0),Math.max(gap,0));
    return {...s, gap, explained, unexplained:Math.max(gap-explained,0),
            index: s.expected>0?Math.round(100*s.actual/s.expected):null,
            outageHrs: s.outageMins/60};
  }).sort((a,b)=>b.unexplained-a.unexplained);
}

// ── Render ───────────────────────────────────────────────────────────────────
async function fillGapSection(){
  const screen=document.getElementById('screenInsights');
  if(!screen)return;
  let host=document.getElementById('gapSection');
  if(!host){
    host=document.createElement('div');
    host.id='gapSection';
    screen.insertBefore(host,screen.firstChild);
  }
  host.innerHTML='<div class="card" style="text-align:center;color:var(--gray);padding:18px">Computing performance gap…</div>';
  let g;
  try{ _gapRows=await loadGapData(gapDays); g=computeGap(_gapRows); }
  catch(e){ host.innerHTML='<div class="error-box">Could not compute performance gap</div>'; return; }
  if(!g.length){ host.innerHTML=''; return; }

  const totUnex=g.reduce((a,s)=>a+s.unexplained,0);
  const totExpl=g.reduce((a,s)=>a+s.explained,0);
  const plant=g.filter(s=>s.unexplained>0).slice(0,6);
  const grid=[...g].sort((a,b)=>b.explained-a.explained).slice(0,5);

  host.innerHTML=`
    <div class="card-title">Performance gap — last ${gapDays} days</div>
    <div class="filter-pills" style="margin-bottom:8px">
      ${[30,60,90].map(d=>`<div class="filter-pill${gapDays===d?' active':''}" onclick="gapDays=${d};fillGapSection()">${d} days</div>`).join('')}
    </div>

    <div class="card">
      <div style="display:flex;gap:10px">
        <div style="flex:1">
          <div style="font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);font-weight:700">Needs a technician</div>
          <div style="font-size:19px;font-weight:750;line-height:1.1;margin-top:2px">${gapFmt(totUnex)} <span style="font-size:11px;font-weight:500;color:var(--gray)">kWh</span></div>
          <div style="font-size:10px;color:var(--gray)">~₹${gapLakh(totUnex,gapDays).toFixed(0)} lakh/yr</div>
        </div>
        <div style="width:1px;background:var(--border)"></div>
        <div style="flex:1">
          <div style="font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);font-weight:700">Grid — claimable</div>
          <div style="font-size:19px;font-weight:750;line-height:1.1;margin-top:2px">${gapFmt(totExpl)} <span style="font-size:11px;font-weight:500;color:var(--gray)">kWh</span></div>
          <div style="font-size:10px;color:var(--gray)">~₹${gapLakh(totExpl,gapDays).toFixed(0)} lakh/yr</div>
        </div>
      </div>
      <div class="text-hint" style="margin-top:7px">
        Shortfall measured against the fleet median specific yield each day, so weather cancels.
        Grid share is pro-rated from recorded outage windows at ~${GAP_SOLAR_HOURS} generating hours/day.
        Indicative value at ₹${GAP_TARIFF}/kWh.
      </div>
    </div>

    <div class="card">
      <div class="card-title">Unexplained shortfall — inspect these</div>
      <div style="overflow-x:auto">
        <table class="admin-table">
          <thead><tr><th>Site</th><th>Index</th><th>Unexplained</th><th>Grid</th><th>Outage hrs</th></tr></thead>
          <tbody>
          ${plant.map(s=>`<tr>
            <td style="white-space:nowrap">${escHtml(s.site)}</td>
            <td><span class="badge ${s.index<85?'badge-red':s.index<100?'badge-yellow':'badge-green'}">${s.index}</span></td>
            <td style="font-weight:700;white-space:nowrap">${gapFmt(s.unexplained)} kWh</td>
            <td style="color:var(--gray);white-space:nowrap">${gapFmt(s.explained)}</td>
            <td style="color:var(--gray)">${s.outageHrs.toFixed(0)}</td>
          </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="text-hint" style="margin-top:5px">Index 100 = fleet median. These gaps are not explained by recorded outages.</div>
    </div>

    <div class="card">
      <div class="flex-between" style="margin-bottom:6px">
        <div class="card-title" style="margin-bottom:0">Grid losses — claim these</div>
        <button class="btn btn-secondary" style="width:auto;padding:5px 10px;font-size:10px" onclick="downloadOutageReport()">Export</button>
      </div>
      <div style="overflow-x:auto">
        <table class="admin-table">
          <thead><tr><th>Site</th><th>Outage days</th><th>Hours</th><th>Est. lost</th></tr></thead>
          <tbody>
          ${grid.map(s=>`<tr>
            <td style="white-space:nowrap">${escHtml(s.site)}</td>
            <td>${s.outageDays}</td>
            <td style="font-weight:700">${s.outageHrs.toFixed(0)}</td>
            <td style="white-space:nowrap">${gapFmt(s.explained)} kWh</td>
          </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="text-hint" style="margin-top:5px">Export gives every outage window with date, start, end and estimated kWh — a claim document.</div>
    </div>`;
}

// ── DISCOM claim export ──────────────────────────────────────────────────────
// One row per outage window, not per day, so the document stands on its own.
function downloadOutageReport(){
  if(!_gapRows){alert('Open the performance gap section first');return;}
  const dcOf={}; sites.forEach(s=>{if(s.dc_capacity_kw>0)dcOf[s.site_name]=Number(s.dc_capacity_kw);});

  // Fleet median specific yield per day, to value the lost hours
  const byDay={};
  _gapRows.forEach(r=>{
    const dc=dcOf[r.site_name],gen=Number(r.total_gen_kwh)||0;
    if(!dc||gen<=0)return;
    (byDay[r.report_date]=byDay[r.report_date]||[]).push(gen/dc);
  });
  const medOf={};
  Object.keys(byDay).forEach(d=>{const a=byDay[d].sort((x,y)=>x-y);medOf[d]=a[Math.floor(a.length/2)];});

  const out=[];
  _gapRows.forEach(r=>{
    if(!r.grid_outage||!Array.isArray(r.grid_outage_details))return;
    const dc=dcOf[r.site_name], med=medOf[r.report_date];
    r.grid_outage_details.forEach(o=>{
      if(!o||!o.from||!o.to)return;
      const mins=gapOutageMins([o]);
      if(mins<=0)return;
      const lost=(dc&&med)?med*dc*Math.min(1,(mins/60)/GAP_SOLAR_HOURS):null;
      out.push({
        Site:r.site_name, Date:r.report_date, From:o.from, To:o.to,
        'Duration (hrs)':+(mins/60).toFixed(2),
        Reason:o.reason||o.reason_other||'',
        'Est. kWh lost':lost===null?'':Math.round(lost),
        'Est. value (Rs)':lost===null?'':Math.round(lost*GAP_TARIFF)
      });
    });
  });
  if(!out.length){alert('No outage windows with recorded times in this period');return;}
  out.sort((a,b)=>a.Site.localeCompare(b.Site)||a.Date.localeCompare(b.Date));

  if(typeof XLSX!=='undefined'){
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(out),'Grid Outages');
    XLSX.writeFile(wb,`grid-outage-claim-${gapDays}d-${new Date().toISOString().split('T')[0]}.xlsx`);
  } else {
    const hdr=Object.keys(out[0]);
    const csv=[hdr.join(',')].concat(out.map(r=>hdr.map(h=>`"${String(r[h]).replace(/"/g,'""')}"`).join(','))).join('\n');
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download=`grid-outage-claim-${gapDays}d.csv`; a.click();
  }
}
