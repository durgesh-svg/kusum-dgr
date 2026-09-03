// ─────────────────────────────────────────────────────────────────────────────
// MODULE CLEANING — the site engineer's independent daily observation.
//
// Smart Watt does not use this app; their claim arrives separately as a
// document. This record is captured daily and BEFORE anyone sees that claim,
// so month-end compares two records written blind to each other. If the
// engineer were shown the claim first they would be countersigning, not
// verifying, and the whole reconciliation is worth nothing.
//
// Unit of work is the INVERTER, not the module: site_config.inverter_count is
// populated for all 48 sites while total_modules is missing for 20 of them.
// Module counts are derived only where they exist, and shown as "—" otherwise.
//
// Loaded after tickets.js, before app-init.js. Uses globals from app-shell.js
// (sb, session, sites, navTo, role helpers) and escHtml()/closeModal().
// ─────────────────────────────────────────────────────────────────────────────

const CLEAN_QUALITY=[
  {id:'clean',   label:'Clean',    cls:'badge-green'},
  {id:'streaked',label:'Streaked', cls:'badge-yellow'},
  {id:'partial', label:'Partial',  cls:'badge-yellow'},
  {id:'poor',    label:'Poor',     cls:'badge-red'}
];
const CLEAN_DONE=[
  {id:'yes',    label:'Yes'},
  {id:'no',     label:'No'},
  {id:'unknown',label:"Don't know"}   // a real answer, not a cop-out
];

let cleaningSite='';
let cleaningDate=new Date().toISOString().split('T')[0];
let _cleanForm={};
let cleaningMonth=new Date().toISOString().slice(0,7);

function cleanSiteCfg(name){return sites.find(s=>s.site_name===name)||{};}
function cleanInvCount(name){return Number(cleanSiteCfg(name).inverter_count)||0;}

// Modules per inverter, only where site_config actually has a total.
function cleanModulesPerInv(name){
  const cfg=cleanSiteCfg(name);
  const tot=Number(cfg.total_modules)||0, inv=Number(cfg.inverter_count)||0;
  return (tot>0&&inv>0)?Math.round(tot/inv):null;
}
// Modules represented by a set of inverters — null when the site has no count.
function cleanModulesFor(name,invs){
  const per=cleanModulesPerInv(name);
  return per===null?null:per*((invs||[]).length);
}
function cleanMySites(){
  return isEngineer()
    ? sites.filter(s=>(session.assigned_sites||[]).includes(s.site_name)).map(s=>s.site_name)
    : sites.map(s=>s.site_name);
}

// ── Home-screen prompt ───────────────────────────────────────────────────────
// Rendered by showHomeScreen(). Returns '' when there is nothing to ask.
async function buildCleaningCard(mySiteNames){
  if(!mySiteNames||mySiteNames.length===0)return '';
  const today=new Date().toISOString().split('T')[0];
  let logged=0;
  try{
    const{data}=await sb.from('cleaning_logs').select('site_name')
      .eq('observed_on',today).in('site_name',mySiteNames);
    logged=(data||[]).length;
  }catch(e){ return ''; }          // never block the home screen on this
  const pending=mySiteNames.length-logged;
  const done=pending<=0;
  return `
    <div style="padding:0 14px;margin-top:8px">
      <div style="background:${done?'#f0fdf4':'#fff'};border:1.5px solid ${done?'var(--green-border)':'var(--border)'};border-radius:10px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div style="min-width:0">
          <div style="font-size:10px;color:${done?'var(--green-dark)':'var(--gray)'};font-weight:700;text-transform:uppercase;letter-spacing:.05em">
            ${done?'🧽 Cleaning logged':'🧽 Module cleaning'}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
            ${done?`All ${mySiteNames.length} site${mySiteNames.length===1?'':'s'} recorded today`
                  :`${pending} site${pending===1?'':'s'} not recorded for today`}</div>
        </div>
        <button onclick="showCleaning()" class="btn ${done?'btn-secondary':'btn-primary'}" style="padding:8px 14px;font-size:12px;white-space:nowrap">
          ${done?'View':'Log now'}</button>
      </div>
    </div>`;
}

// ── Screen ───────────────────────────────────────────────────────────────────
function showCleaning(){
  navTo('cleaning');
  currentTab='cleaning';
  document.querySelectorAll('#screensWrap > div').forEach(d=>d.classList.add('hidden'));
  document.getElementById('headerBar').classList.add('hidden');
  document.getElementById('navBar').classList.add('hidden');
  document.getElementById('bottomTabs').classList.remove('hidden');
  const el=document.getElementById('screenCleaning');
  el.classList.remove('hidden');
  el.innerHTML=`
    <div class="flex-between" style="margin-bottom:2px">
      <div class="card-title" style="margin-bottom:0">Module cleaning</div>
      <span style="font-size:11px;color:var(--primary);cursor:pointer;font-weight:600" onclick="switchTab('dgr')">← Back</span>
    </div>
    <div class="card" style="padding:10px">
      <label style="font-size:10px;color:var(--gray);display:block;margin-bottom:2px">Date</label>
      <input type="date" id="cleanDate" value="${cleaningDate}" max="${new Date().toISOString().split('T')[0]}"
        style="width:100%;padding:7px;font-size:12px;border:1px solid var(--border);border-radius:6px"
        onchange="cleaningDate=this.value;showCleaning()">
    </div>
    <div id="cleaningList"><div style="text-align:center;color:var(--gray);padding:20px">Loading...</div></div>
    ${isManagerUp()?`<div style="margin-top:4px"><button class="btn btn-secondary" style="width:100%;padding:9px;font-size:12px" onclick="showCleaningSummary()">Monthly summary</button></div>`:''}`;
  loadCleaningList();
}

async function loadCleaningList(){
  const el=document.getElementById('cleaningList');
  if(!el)return;
  const names=cleanMySites();
  if(names.length===0){el.innerHTML='<div class="card" style="text-align:center;color:var(--gray)">No sites assigned.</div>';return;}
  let logs={};
  try{
    const{data}=await sb.from('cleaning_logs').select('*')
      .eq('observed_on',cleaningDate).in('site_name',names);
    (data||[]).forEach(r=>{logs[r.site_name]=r;});
  }catch(e){el.innerHTML='<div class="error-box">Could not load cleaning records</div>';return;}

  el.innerHTML=names.map(name=>{
    const r=logs[name];
    const inv=cleanInvCount(name);
    const q=r&&r.quality?CLEAN_QUALITY.find(x=>x.id===r.quality):null;
    let status;
    if(!r) status='<span class="badge badge-gray">Not recorded</span>';
    else if(r.cleaning_done==='yes') status=`<span class="badge badge-green">Cleaned</span>`;
    else if(r.cleaning_done==='no') status='<span class="badge badge-gray">Not cleaned</span>';
    else status='<span class="badge badge-yellow">Don\'t know</span>';
    const mods=r&&r.cleaning_done==='yes'?cleanModulesFor(name,r.inverters_cleaned):null;
    return `
      <div class="history-card" style="cursor:pointer" onclick="openCleaningModal('${escHtml(name)}')">
        <div class="flex-between">
          <div style="min-width:0">
            <div class="history-site">${escHtml(name)}</div>
            <div class="history-date">${inv} inverters${r&&r.observed_by_name?' · '+escHtml(r.observed_by_name):''}</div>
          </div>
          ${status}
        </div>
        ${r&&r.cleaning_done==='yes'?`
        <div class="history-stats" style="flex-wrap:wrap">
          ${q?`<span class="badge ${q.cls}">${q.label}</span>`:''}
          <span class="badge badge-gray">${(r.inverters_cleaned||[]).length} of ${inv} inv</span>
          ${mods!==null?`<span class="badge badge-gray">~${mods} modules</span>`
                       :`<span class="badge badge-gray" title="site_config.total_modules not set">modules —</span>`}
        </div>`:''}
      </div>`;
  }).join('');
}

// ── Log / edit one site-night ────────────────────────────────────────────────
async function openCleaningModal(name){
  cleaningSite=name;
  const modal=document.getElementById('modalOverlay');
  const content=document.getElementById('modalContent');
  content.innerHTML=`<div class="modal-header"><div class="modal-title">Loading...</div><button class="modal-close" onclick="closeModal()">✕</button></div>`;
  modal.classList.remove('hidden');
  let r=null;
  try{
    const{data}=await sb.from('cleaning_logs').select('*')
      .eq('site_name',name).eq('observed_on',cleaningDate).maybeSingle();
    r=data;
  }catch(e){}
  _cleanForm={
    cleaning_done:r?r.cleaning_done:'unknown',
    inverters:r&&r.inverters_cleaned?[...r.inverters_cleaned]:[],
    quality:r?r.quality:null,
    crew:r&&r.crew_seen!=null?r.crew_seen:'',
    notes:r?(r.notes||''):''
  };
  content.innerHTML=buildCleaningForm(name,!!r);
}

function buildCleaningForm(name,existing){
  const inv=cleanInvCount(name);
  const per=cleanModulesPerInv(name);
  const f=_cleanForm;
  const dateStr=new Date(cleaningDate+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
  return `
    <div class="modal-header">
      <div class="modal-title">${escHtml(name)}</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div style="font-size:10px;color:var(--gray);margin-bottom:10px">Night of ${dateStr}${existing?' · editing':''}</div>

    <div class="modal-field">
      <label>Was cleaning done since your last report? *</label>
      <div style="display:flex;gap:5px">
        ${CLEAN_DONE.map(o=>`<button class="btn ${f.cleaning_done===o.id?'btn-primary':'btn-secondary'}"
          style="flex:1;padding:8px;font-size:11px" onclick="_cleanForm.cleaning_done='${o.id}';refreshCleaningForm('${escHtml(name)}',${existing})">${o.label}</button>`).join('')}
      </div>
    </div>

    ${f.cleaning_done==='yes'?`
    <div class="modal-field">
      <label>Which inverter areas? (${f.inverters.length} of ${inv})</label>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">
        ${Array.from({length:inv},(_,i)=>i+1).map(n=>`
          <span onclick="toggleCleanInv(${n},'${escHtml(name)}',${existing})"
            style="cursor:pointer;padding:4px 9px;border-radius:6px;font-size:11px;font-weight:600;
            ${f.inverters.includes(n)?'background:var(--primary);color:#fff'
                                     :'background:var(--gray-light);color:var(--gray)'}">${n}</span>`).join('')}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary" style="flex:1;padding:6px;font-size:10px" onclick="setAllCleanInv(true,'${escHtml(name)}',${existing})">Select all</button>
        <button class="btn btn-secondary" style="flex:1;padding:6px;font-size:10px" onclick="setAllCleanInv(false,'${escHtml(name)}',${existing})">Clear</button>
      </div>
      <div class="text-hint" style="margin-top:4px">
        ${per!==null?`About ${per*f.inverters.length} modules (${per} per inverter)`
                    :'Module count not set for this site — quantity will show as —'}
      </div>
    </div>

    <div class="modal-field">
      <label>How did they look?</label>
      <div style="display:flex;gap:5px;flex-wrap:wrap">
        ${CLEAN_QUALITY.map(o=>`<button class="btn ${f.quality===o.id?'btn-primary':'btn-secondary'}"
          style="flex:1;min-width:70px;padding:7px;font-size:11px" onclick="_cleanForm.quality='${o.id}';refreshCleaningForm('${escHtml(name)}',${existing})">${o.label}</button>`).join('')}
      </div>
    </div>

    <div class="modal-field"><label>Crew seen on site (optional)</label>
      <input type="number" min="0" id="mCleanCrew" value="${f.crew}" placeholder="e.g. 3"></div>
    `:''}

    <div class="modal-field"><label>Notes</label>
      <textarea id="mCleanNotes" placeholder="Anything worth recording">${escHtml(f.notes)}</textarea></div>

    <div id="cleanFormError" class="error-box hidden"></div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" id="cleanSaveBtn" onclick="saveCleaningLog()">Save</button>
    </div>`;
}

// Re-render the form, preserving what is currently typed in the free-text fields
function refreshCleaningForm(name,existing){
  const crew=document.getElementById('mCleanCrew');
  const notes=document.getElementById('mCleanNotes');
  if(crew)_cleanForm.crew=crew.value;
  if(notes)_cleanForm.notes=notes.value;
  document.getElementById('modalContent').innerHTML=buildCleaningForm(name,existing);
}
function toggleCleanInv(n,name,existing){
  const i=_cleanForm.inverters.indexOf(n);
  if(i===-1)_cleanForm.inverters.push(n); else _cleanForm.inverters.splice(i,1);
  _cleanForm.inverters.sort((a,b)=>a-b);
  refreshCleaningForm(name,existing);
}
function setAllCleanInv(all,name,existing){
  _cleanForm.inverters=all?Array.from({length:cleanInvCount(name)},(_,i)=>i+1):[];
  refreshCleaningForm(name,existing);
}

async function saveCleaningLog(){
  const btn=document.getElementById('cleanSaveBtn');
  const err=document.getElementById('cleanFormError');
  const crew=document.getElementById('mCleanCrew');
  const notes=document.getElementById('mCleanNotes');
  if(crew)_cleanForm.crew=crew.value;
  if(notes)_cleanForm.notes=notes.value;
  const f=_cleanForm;
  if(f.cleaning_done==='yes'&&f.inverters.length===0){
    err.textContent='Select which inverter areas were cleaned';err.classList.remove('hidden');return;
  }
  btn.disabled=true;btn.textContent='Saving...';
  const payload={
    site_name:cleaningSite,
    observed_on:cleaningDate,
    cleaning_done:f.cleaning_done,
    inverters_cleaned:f.cleaning_done==='yes'?f.inverters:null,
    quality:f.cleaning_done==='yes'?f.quality:null,
    crew_seen:f.crew===''||f.crew==null?null:Number(f.crew),
    notes:f.notes.trim()||null,
    observed_by_phone:session.phone,
    observed_by_name:session.name
  };
  try{
    // Same idiom as dgr_submissions: keyed by (site, date), always upsert
    const{error}=await sb.from('cleaning_logs').upsert(payload,{onConflict:'site_name,observed_on'});
    if(error)throw error;
    closeModal();
    if(typeof showToast==='function')showToast('Cleaning record saved','success');
    loadCleaningList();
  }catch(e){
    btn.disabled=false;btn.textContent='Save';
    err.textContent='Save failed: '+e.message;err.classList.remove('hidden');
  }
}

// ── Monthly summary (manager and above) ──────────────────────────────────────
async function showCleaningSummary(){
  if(!isManagerUp())return;
  const el=document.getElementById('screenCleaning');
  el.innerHTML='<div style="text-align:center;color:var(--gray);padding:20px">Loading...</div>';
  const from=cleaningMonth+'-01';
  const to=new Date(new Date(from).getFullYear(),new Date(from).getMonth()+1,0).toISOString().split('T')[0];
  let rows=[];
  try{
    const{data}=await sb.from('cleaning_logs').select('*')
      .gte('observed_on',from).lte('observed_on',to);
    rows=data||[];
  }catch(e){el.innerHTML='<div class="error-box">Could not load summary</div>';return;}

  const bysite={};
  rows.forEach(r=>{
    const s=bysite[r.site_name]||(bysite[r.site_name]={nights:0,yes:0,no:0,unknown:0,invSum:0,poor:0});
    s.nights++;
    s[r.cleaning_done]++;
    if(r.cleaning_done==='yes'){
      s.invSum+=(r.inverters_cleaned||[]).length;
      if(r.quality==='poor'||r.quality==='partial')s.poor++;
    }
  });
  const names=cleanMySites();
  const monthLabel=new Date(from+'T00:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'});

  el.innerHTML=`
    <div class="flex-between" style="margin-bottom:2px">
      <div class="card-title" style="margin-bottom:0">Cleaning summary</div>
      <span style="font-size:11px;color:var(--primary);cursor:pointer;font-weight:600" onclick="showCleaning()">← Daily log</span>
    </div>
    <div class="card" style="padding:10px">
      <label style="font-size:10px;color:var(--gray);display:block;margin-bottom:2px">Month</label>
      <input type="month" id="cleanMonth" value="${cleaningMonth}" max="${new Date().toISOString().slice(0,7)}"
        style="width:100%;padding:7px;font-size:12px;border:1px solid var(--border);border-radius:6px"
        onchange="cleaningMonth=this.value;showCleaningSummary()">
      <div class="text-hint" style="margin-top:4px">${monthLabel} · engineer records only. Vendor claims are reconciled against these.</div>
    </div>
    <div style="overflow-x:auto">
      <table class="admin-table">
        <thead><tr><th>Site</th><th>Nights<br>cleaned</th><th>Inv-nights</th><th>Modules</th><th>Flagged</th><th>No record</th></tr></thead>
        <tbody>
        ${names.map(n=>{
          const s=bysite[n]||{nights:0,yes:0,no:0,unknown:0,invSum:0,poor:0};
          const per=cleanModulesPerInv(n);
          const mods=per===null?null:per*s.invSum;
          const daysSoFar=Math.min(new Date().getDate(),
            new Date(to+'T00:00:00').getDate());
          const missing=daysSoFar-s.nights;
          return `<tr>
            <td style="white-space:nowrap">${escHtml(n)}</td>
            <td><strong>${s.yes}</strong></td>
            <td>${s.invSum}</td>
            <td>${mods===null?'<span style="color:var(--text-muted)" title="total_modules not set">—</span>':mods.toLocaleString('en-IN')}</td>
            <td>${s.poor?`<span class="badge badge-red">${s.poor}</span>`:'0'}</td>
            <td>${missing>0?`<span class="badge badge-yellow">${missing}</span>`:'0'}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>
    <div class="text-hint" style="margin-top:6px">
      Modules shows &mdash; where site_config.total_modules is not set (20 of 48 sites).
      Inverter-nights is always available and is the reliable quantity until those are filled.
    </div>`;
}
