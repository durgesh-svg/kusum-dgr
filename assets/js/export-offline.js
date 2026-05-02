function calcOutageMins(o){
  return calcMins(o?.from,o?.to);
}

function formatDgrRowForSheet(d){
  const gridMins=(d.grid_outage_details||[]).reduce((a,o)=>a+calcOutageMins(o),0);
  const plantMins=(d.plant_outage_details||[]).reduce((a,o)=>a+calcOutageMins(o),0);
  const gridReasons=(d.grid_outage_details||[]).map(o=>o.reason||'').filter(Boolean).join('; ');
  const plantFaults=(d.plant_outage_details||[]).map(o=>o.fault_code||'').filter(Boolean).join('; ');
  const inv=d.inv_gen||[];
  const invCols=Array.from({length:20},(_,i)=>inv[i]!==undefined?inv[i]:'');
  return[
    d.report_date,d.site_name,d.submitted_by_name,d.submitted_by_phone,
    d.created_at?new Date(d.created_at).toLocaleString('en-IN'):'',
    d.status,d.reviewed_by||'',
    d.reviewed_at?new Date(d.reviewed_at).toLocaleString('en-IN'):'',
    d.review_note||'',
    d.dc_capacity_kw||'',d.ac_capacity_kw||'',d.total_gen_kwh||'',
    d.dc_cuf_pct||'',d.ac_cuf_pct||'',d.pr_pct||'',
    d.peak_radiation_wm2||'',d.poa_kwh_m2||'',d.peak_power_kwh||'',
    ...invCols,
    d.grid_outage?'Yes':'No',gridMins,gridReasons,
    d.plant_outage?'Yes':'No',plantMins,plantFaults,
    d.wti_c||'',d.oti_c||'',d.mog_level||'',d.silica_gel||'',
    d.modules_cleaned_today||'',d.modules_total||'',
    d.weather||'',d.rain?'Yes':'No',d.weather_avg_ambient_c||'',
    d.daily_activity||'',d.remarks||''
  ];
}

const DGR_SHEET_HEADERS=[
  'Date','Site Name','Submitted By','Submitted Phone','Submitted At',
  'Status','Reviewed By','Reviewed At','Review Note',
  'DC Capacity (kW)','AC Capacity (kW)','Total Generation (kWh)',
  'DC CUF (%)','AC CUF (%)','PR (%)',
  'Peak Radiation (W/m²)','POA (kWh/m²)','Peak Power (kWh)',
  'Inv 1 (kWh)','Inv 2 (kWh)','Inv 3 (kWh)','Inv 4 (kWh)','Inv 5 (kWh)',
  'Inv 6 (kWh)','Inv 7 (kWh)','Inv 8 (kWh)','Inv 9 (kWh)','Inv 10 (kWh)',
  'Inv 11 (kWh)','Inv 12 (kWh)','Inv 13 (kWh)','Inv 14 (kWh)','Inv 15 (kWh)',
  'Inv 16 (kWh)','Inv 17 (kWh)','Inv 18 (kWh)','Inv 19 (kWh)','Inv 20 (kWh)',
  'Grid Outage','Grid Outage (mins)','Grid Outage Reasons',
  'Plant Outage','Plant Outage (mins)','Plant Fault Codes',
  'WTI (°C)','OTI (°C)','MOG Level','Silica Gel',
  'Modules Cleaned Today','Total Modules',
  'Weather','Rain','Avg Ambient Temp (°C)',
  'Daily Activity','Remarks'
];

async function downloadDgrExcel(){
  const site=document.getElementById('dlSite')?.value||'';
  const from=document.getElementById('dlFrom')?.value||'';
  const to=document.getElementById('dlTo')?.value||'';
  const status=document.getElementById('dlStatus')?.value||'all';
  const btn=document.getElementById('dlBtn');
  if(btn){btn.disabled=true;btn.textContent='Preparing...';}
  try{
    let query=sb.from('dgr_submissions').select('*').order('report_date',{ascending:true});
    if(site)query=query.eq('site_name',site);
    if(from)query=query.gte('report_date',from);
    if(to)query=query.lte('report_date',to);
    if(status!=='all')query=query.eq('status',status);
    const{data,error}=await query;
    if(error)throw error;
    if(!data||data.length===0){alert('No records found for selected filters.');return;}
    const rows=data.map(d=>formatDgrRowForSheet(d));
    const ws=XLSX.utils.aoa_to_sheet([DGR_SHEET_HEADERS,...rows]);
    ws['!cols']=DGR_SHEET_HEADERS.map(h=>({wch:Math.max(h.length+2,12)}));
    // Freeze top row
    ws['!freeze']={xSplit:0,ySplit:1};
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'DGR Data');
    const sitePart=site?site.replace(/[^a-zA-Z0-9]/g,'_'):'AllSites';
    const fromPart=from||'start';
    const toPart=to||'end';
    XLSX.writeFile(wb,`DGR_${sitePart}_${fromPart}_to_${toPart}.xlsx`);
  }catch(e){
    alert('Download failed: '+e.message);
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Download Excel (.xlsx)';}
  }
}

function buildDownloadPanel(){
  const siteOpts='<option value="">All Sites</option>'+
    (session.role==='engineer'
      ?(session.assigned_sites||[])
      :sites.map(s=>s.site_name)
    ).map?.(s=>`<option value="${s}">${s}</option>`).join('') ||
    sites.map(s=>`<option value="${s.site_name}">${s.site_name}</option>`).join('');
  // Default date range: last 30 days
  const today=new Date();
  const d30=new Date(today);d30.setDate(d30.getDate()-30);
  const fmt=d=>d.toISOString().split('T')[0];
  return`
    <div class="card" style="margin-top:12px">
      <div class="card-title" style="margin-bottom:10px">Download DGR Data</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div>
          <label style="font-size:10px;color:var(--gray);display:block;margin-bottom:3px">Site</label>
          <select id="dlSite" style="width:100%;padding:8px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:#fff">
            ${siteOpts}
          </select>
        </div>
        <div style="display:flex;gap:8px">
          <div style="flex:1">
            <label style="font-size:10px;color:var(--gray);display:block;margin-bottom:3px">From Date</label>
            <input type="date" id="dlFrom" value="${fmt(d30)}" style="width:100%;padding:7px;font-size:12px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box">
          </div>
          <div style="flex:1">
            <label style="font-size:10px;color:var(--gray);display:block;margin-bottom:3px">To Date</label>
            <input type="date" id="dlTo" value="${fmt(today)}" style="width:100%;padding:7px;font-size:12px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box">
          </div>
        </div>
        <div>
          <label style="font-size:10px;color:var(--gray);display:block;margin-bottom:3px">Status</label>
          <select id="dlStatus" style="width:100%;padding:8px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:#fff">
            <option value="all">All</option>
            <option value="approved" selected>Approved</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <button id="dlBtn" class="btn btn-primary" onclick="downloadDgrExcel()" style="width:100%;padding:10px;font-size:13px;margin-top:4px">
          Download Excel (.xlsx)
        </button>
      </div>
    </div>`;
}

// ─────────────────────────────────────────
// GOOGLE SHEETS SYNC
// ─────────────────────────────────────────
function buildSheetsSettingsPanel(){
  // Parse last sync info: stored as "ISO_TIMESTAMP|COUNT"
  let lastSyncLabel='Never';
  if(sheetsSettings.last_sync){
    try{
      const[ts,cnt]=sheetsSettings.last_sync.split('|');
      const d=new Date(ts);
      lastSyncLabel=d.toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+' · '+cnt+' row(s)';
    }catch(e){}
  }
  const hasUrl=sheetsSettings.script_url&&sheetsSettings.script_url.length>10;
  return`
    <div class="card" style="margin-top:12px">
      <div class="card-title" style="margin-bottom:10px">Google Sheets Sync</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div>
          <label style="font-size:10px;color:var(--gray);display:block;margin-bottom:3px">Sheet ID</label>
          <input id="gsSheetId" value="${sheetsSettings.sheet_id}" style="width:100%;padding:8px;font-size:11px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box;font-family:monospace" placeholder="Paste Sheet ID from URL">
        </div>
        <div>
          <label style="font-size:10px;color:var(--gray);display:block;margin-bottom:3px">Tab Name</label>
          <input id="gsTabName" value="${sheetsSettings.tab_name}" style="width:100%;padding:8px;font-size:12px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box" placeholder="e.g. Raw Data">
        </div>
        <div>
          <label style="font-size:10px;color:var(--gray);display:block;margin-bottom:3px">Apps Script URL</label>
          <input id="gsScriptUrl" value="${sheetsSettings.script_url}" style="width:100%;padding:8px;font-size:11px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box;font-family:monospace" placeholder="https://script.google.com/macros/s/.../exec">
        </div>
        <button class="btn btn-secondary" onclick="saveSheetsSettings()" style="width:100%;padding:8px;font-size:12px">Save Settings</button>
        <div style="display:flex;gap:8px">
          <button id="gsSyncBtn" class="btn btn-primary" onclick="triggerManualSync()" style="flex:2;padding:9px;font-size:12px" ${!hasUrl?'disabled title="Save Apps Script URL first"':''}>
            🔄 Sync Now
          </button>
          ${sheetsSettings.sheet_id?`<button class="btn btn-secondary" onclick="window.open('https://docs.google.com/spreadsheets/d/${sheetsSettings.sheet_id}','_blank')" style="flex:1;padding:9px;font-size:12px">View Sheet</button>`:''}
        </div>
        <div style="font-size:10px;color:var(--gray);text-align:center">
          Last sync: <strong>${lastSyncLabel}</strong> · Auto-sync every 30 min
        </div>
        <div id="gsSyncStatus" style="font-size:11px;text-align:center;display:none"></div>
      </div>
    </div>`;
}

async function saveSheetsSettings(){
  const scriptUrl=(document.getElementById('gsScriptUrl')?.value||'').trim();
  const sheetId=(document.getElementById('gsSheetId')?.value||'').trim();
  const tabName=(document.getElementById('gsTabName')?.value||'').trim();
  if(!sheetId||!tabName){alert('Sheet ID and Tab Name are required.');return;}
  sheetsSettings.script_url=scriptUrl;
  sheetsSettings.sheet_id=sheetId;
  sheetsSettings.tab_name=tabName;
  try{
    await sb.from('dgr_settings').upsert([
      {key:'sheets_script_url',value:scriptUrl,updated_at:new Date().toISOString()},
      {key:'sheets_sheet_id',value:sheetId,updated_at:new Date().toISOString()},
      {key:'sheets_tab_name',value:tabName,updated_at:new Date().toISOString()}
    ],{onConflict:'key'});
    const el=document.getElementById('settingsSaveStatus');
    if(el){el.textContent='Sheets settings saved ✓';setTimeout(()=>{if(el)el.textContent='';},2500);}
    showAdminSettings();// re-render to update Sync Now button state
  }catch(e){alert('Save failed: '+e.message);}
}

async function triggerManualSync(){
  const btn=document.getElementById('gsSyncBtn');
  const statusEl=document.getElementById('gsSyncStatus');
  if(btn){btn.disabled=true;btn.textContent='Syncing...';}
  if(statusEl){statusEl.style.display='block';statusEl.style.color='var(--gray)';statusEl.textContent='Connecting to Google Sheets…';}
  try{
    const{data,error}=await sb.functions.invoke('sync-to-sheets',{body:{}});
    if(error)throw error;
    const count=data?.synced??0;
    if(statusEl){
      statusEl.style.color='var(--green-dark)';
      statusEl.textContent=count>0?`✓ Synced ${count} row(s) to Google Sheets`:'✓ All rows already synced — nothing new';
    }
    // Refresh panel to update last sync time
    await loadAppSettings();
    showAdminSettings();
  }catch(e){
    if(statusEl){statusEl.style.color='var(--red)';statusEl.textContent='✗ Sync failed: '+e.message;}
    if(btn){btn.disabled=false;btn.textContent='🔄 Sync Now';}
  }
}

// OFFLINE
function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('dgr_offline_queue',1);
    req.onupgradeneeded=e=>{e.target.result.createObjectStore('submissions',{keyPath:'id',autoIncrement:true});};
    req.onsuccess=e=>resolve(e.target.result);
    req.onerror=e=>reject(e);
  });
}
async function saveOffline(payload){
  const db=await openDB();
  const tx=db.transaction('submissions','readwrite');
  tx.objectStore('submissions').add({...payload,_ts:Date.now()});
  return new Promise(r=>{tx.oncomplete=r;});
}
async function syncQueue(){
  try{
    const db=await openDB();
    const tx=db.transaction('submissions','readonly');
    const all=await new Promise(r=>{const req=tx.objectStore('submissions').getAll();req.onsuccess=()=>r(req.result);});
    if(!all||all.length===0)return;
    for(const item of all){
      const id=item.id;delete item.id;delete item._ts;
      const{error}=await sb.from('dgr_submissions').upsert(item,{onConflict:'site_name,report_date'});
      if(!error){const dtx=db.transaction('submissions','readwrite');dtx.objectStore('submissions').delete(id);}
    }
  }catch(e){}
}

