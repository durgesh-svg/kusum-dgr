// ─────────────────────────────────────────────────────────────────────────────
// GRID OUTAGE CLAIM — exports every recorded grid-outage window with an
// estimate of the generation it cost, as a document for DISCOM claims.
//
// Lost generation is valued at the fleet-median specific yield (kWh/kWp) for
// that day rather than PR: 17 sites have no pyranometer and 22 log impossible
// irradiance, while generation and DC capacity are reliable everywhere.
//
// This file used to also render a performance-gap card into Insights; the
// embedded dashboard's Generation Loss view replaced it. Read-only.
// ─────────────────────────────────────────────────────────────────────────────

// Generating hours in a day, used to pro-rate outage minutes against expected
// output. Approximate: outage minutes are not all at peak sun, so a site's
// grid-attributable share is an estimate, not a meter reading.
const GAP_SOLAR_HOURS = 10;
const GAP_TARIFF = 3.0;          // Rs/kWh, for indicative annualised value only
let gapDays = 60;
let _gapRows = null;

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

// Called from the Insights toolbar. Loads the window first if nothing has.
async function exportOutageReport(){
  try{ if(!_gapRows)_gapRows=await loadGapData(gapDays); }
  catch(e){ alert('Could not load outage data: '+(e.message||e)); return; }
  downloadOutageReport();
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
