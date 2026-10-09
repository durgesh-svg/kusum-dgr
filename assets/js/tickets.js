// ─────────────────────────────────────────────────────────────────────────────
// TICKETS — repair / spare / expense requests raised by site engineers, plus
// alerts raised by the database (source='auto').
//
// Loaded after overview.js and before app-init.js. Depends on globals from
// app-shell.js (sb, session, sites, appSettings, navTo, role helpers) and on
// escHtml()/closeModal() from earlier modules -- see the load order in dgr.html.
//
// Two lifecycles share one table:
//   request  open -> (l1_approved) -> approved -> closure_requested -> closed
//            Approval is amount-based: a manager is final at or below
//            appSettings.ticket_l2_threshold; above it an Admin or Director
//            signs too. Closure needs two people -- engineer requests with
//            proof and actual cost, manager confirms.
//   alert    open -> acknowledged -> resolved, with an optional snooze.
//            No approval: there is nothing to pay for, only something to fix.
// Either kind can be assigned to an engineer, a manager or a vendor.
// ─────────────────────────────────────────────────────────────────────────────

// escHtml() lives in dgr-flow.js and only escapes & < > -- fine for text nodes.
// Ticket text never goes into an attribute; only UUIDs do.
function esc(v){return escHtml(String(v==null?'':v));}
function isTicketApprover(){return isManagerUp();}

const DEFAULT_TICKET_CATEGORIES=['Repair','Spare part','Expense','Other'];
const DEFAULT_L2_THRESHOLD=5000;
const DEFAULT_TICKET_VENDORS=['Smart Watt'];
const TICKET_APP_URL='https://dgr-app.vercel.app/';
const TICKET_UNASSIGNED_DAYS=7;   // open and nobody's after this many days = overdue

let ticketFilter='all';
let ticketSiteFilter='';
let ticketPhotoFiles={};      // key -> File, for the raise/edit, quick and closure modals
let _editingTicketId=null;
let _closureTicketId=null;
let _quickSite='';

const TICKET_PRIORITIES=['low','medium','high','critical'];
const TICKET_STATUS_META={
  open:{label:'Open',cls:'badge-yellow'},
  acknowledged:{label:'Acknowledged',cls:'badge-blue'},
  resolved:{label:'Resolved',cls:'badge-green'},
  l1_approved:{label:'Awaiting admin',cls:'badge-blue'},
  approved:{label:'Approved',cls:'badge-green'},
  rejected:{label:'Rejected',cls:'badge-red'},
  closure_requested:{label:'Closure requested',cls:'badge-blue'},
  closed:{label:'Closed',cls:'badge-gray'},
  cancelled:{label:'Cancelled',cls:'badge-gray'}
};
const TICKET_LIVE=['open','acknowledged','l1_approved','approved','closure_requested'];
const TICKET_DONE=['closed','resolved','rejected','cancelled'];

function isAlert(t){return t&&t.source==='auto';}
function ticketNo(t){return '#TKT-'+String(t.ticket_no||0).padStart(4,'0');}
function ticketThreshold(){const v=Number(appSettings.ticket_l2_threshold);return isNaN(v)?DEFAULT_L2_THRESHOLD:v;}
function ticketNeedsL2(t){return Number(t.estimated_cost||0)>ticketThreshold();}
function ticketCategories(){return appSettings.ticket_categories||DEFAULT_TICKET_CATEGORIES;}
function ticketVendors(){return appSettings.ticket_vendors||DEFAULT_TICKET_VENDORS;}
function money(v){return (v==null||v==='')?'—':'₹'+Number(v).toLocaleString('en-IN');}
function ticketMySites(){return isEngineer()?(session.assigned_sites||[]):sites.map(s=>s.site_name);}
function ticketStatusBadge(s){const m=TICKET_STATUS_META[s]||{label:s,cls:'badge-gray'};return `<span class="badge ${m.cls}">${esc(m.label)}</span>`;}
function ticketPriorityBadge(p){
  const v=p||'medium';
  const cls=v==='critical'?'badge-red':v==='high'?'badge-yellow':v==='medium'?'badge-blue':'badge-gray';
  return `<span class="badge ${cls}">${esc(v.charAt(0).toUpperCase()+v.slice(1))}</span>`;
}
function ticketAgeDays(t){return t.created_at?Math.floor((Date.now()-new Date(t.created_at).getTime())/86400000):0;}
function ticketAge(t){
  if(!t.created_at)return '';
  const days=ticketAgeDays(t);
  return days<=0?'today':days===1?'1 day ago':days+' days ago';
}
function ticketDate(d){return d?new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—';}
function ticketStamp(d){return d?new Date(d).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';}
function todayISO(){return new Date().toISOString().split('T')[0];}
function isSnoozed(t){return !!(t.snoozed_until&&t.snoozed_until>=todayISO());}
function isAssignedToMe(t){return !!(t.assigned_to_phone&&session&&t.assigned_to_phone===session.phone);}
function isOverdue(t){
  if(!TICKET_LIVE.includes(t.status)||isSnoozed(t))return false;
  if(t.target_date&&t.target_date<todayISO())return true;
  return !t.assigned_to_name&&ticketAgeDays(t)>=TICKET_UNASSIGNED_DAYS;
}
// Chips shown on list cards and on the engineer's home: owner, due, snooze
function ticketChips(t){
  const c=[];
  if(t.assigned_to_name)c.push(`<span class="ticket-chip">👤 ${esc(t.assigned_to_name)}${isAssignedToMe(t)?' (you)':''}</span>`);
  if(isOverdue(t))c.push(`<span class="ticket-chip overdue">Overdue</span>`);
  else if(t.target_date&&TICKET_LIVE.includes(t.status))c.push(`<span class="ticket-chip">Due ${esc(ticketDate(t.target_date))}</span>`);
  if(isSnoozed(t))c.push(`<span class="ticket-chip snoozed">Snoozed till ${esc(ticketDate(t.snoozed_until))}</span>`);
  return c.join('');
}

// Statuses that still need action from the logged-in approver
function ticketAwaitingStatuses(){
  return isAdminUp()?['open','l1_approved','closure_requested']:['open','closure_requested'];
}

function showTickets(){
  const el=document.getElementById('screenTickets');
  el.classList.remove('hidden');
  let siteOptions='<option value="">All sites</option>';
  ticketMySites().forEach(s=>{siteOptions+=`<option value="${esc(s)}"${ticketSiteFilter===s?' selected':''}>${esc(s)}</option>`;});
  const filters=isTicketApprover()
    ?[['all','All'],['mine','Assigned to me'],['awaiting','Awaiting me'],['alerts','Alerts'],['open','Open'],['approved','Approved'],['closed','Closed']]
    :[['all','All'],['mine','Assigned to me'],['alerts','Alerts'],['open','Open'],['approved','Approved'],['closed','Closed']];
  el.innerHTML=`
    <div class="card-title">Tickets</div>
    <div class="card" style="padding:10px;margin-bottom:8px">
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button class="btn btn-primary" style="flex:1;padding:9px;font-size:12px" onclick="openQuickTicket()">📷 Report a problem</button>
        <button class="btn btn-secondary" style="flex:1;padding:9px;font-size:12px" onclick="openTicketModal()">Full form</button>
      </div>
      <label style="font-size:10px;color:var(--gray);display:block;margin-bottom:2px">Site</label>
      <select style="width:100%;padding:7px 6px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:#fff" onchange="ticketSiteFilter=this.value;loadTickets()">${siteOptions}</select>
    </div>
    <div class="filter-pills" style="flex-wrap:wrap">
      ${filters.map(([v,l])=>`<div class="filter-pill${ticketFilter===v?' active':''}" onclick="ticketFilter='${v}';showTickets()">${l}</div>`).join('')}
    </div>
    <div id="ticketResults"><div style="text-align:center;color:var(--gray);padding:20px">Loading...</div></div>`;
  loadTickets();
}

async function loadTickets(){
  const el=document.getElementById('ticketResults');
  if(!el)return;
  el.innerHTML='<div style="text-align:center;color:var(--gray);padding:20px">Loading...</div>';
  try{
    let q=sb.from('dgr_tickets').select('*').order('created_at',{ascending:false}).limit(200);
    if(isEngineer()){
      const mine=session.assigned_sites||[];
      if(mine.length===0){el.innerHTML='<div class="card" style="text-align:center;color:var(--gray)">No sites assigned. Contact your admin.</div>';return;}
      // Own sites, plus anything handed to me at another site
      q=q.or(`site_name.in.(${mine.map(s=>'"'+s.replace(/"/g,'')+'"').join(',')}),assigned_to_phone.eq.${session.phone}`);
    }
    if(ticketSiteFilter)q=q.eq('site_name',ticketSiteFilter);
    const today=todayISO();
    if(ticketFilter==='open')q=q.in('status',['open','acknowledged','l1_approved']);
    else if(ticketFilter==='approved')q=q.in('status',['approved','closure_requested']);
    else if(ticketFilter==='closed')q=q.in('status',TICKET_DONE);
    else if(ticketFilter==='mine')q=q.eq('assigned_to_phone',session.phone).in('status',TICKET_LIVE);
    else if(ticketFilter==='alerts')q=q.eq('source','auto').in('status',['open','acknowledged']);
    else if(ticketFilter==='awaiting'){
      // Requests waiting on my approval, alerts nobody has acknowledged, and my own assigned jobs
      q=q.in('status',TICKET_LIVE).or(`and(source.neq.auto,status.in.(${ticketAwaitingStatuses().join(',')})),and(source.eq.auto,status.eq.open),assigned_to_phone.eq.${session.phone}`);
    }
    const{data,error}=await q;
    if(error)throw error;
    let rows=data||[];
    if(ticketFilter==='awaiting'||ticketFilter==='alerts')rows=rows.filter(t=>!isSnoozed(t));
    if(rows.length===0){el.innerHTML='<div class="card" style="text-align:center;color:var(--gray)">No tickets found</div>';return;}
    el.innerHTML=rows.map(t=>`
      <div class="history-card" style="cursor:pointer${isOverdue(t)?';border-left:3px solid var(--red)':''}" onclick="viewTicket('${t.id}')">
        <div class="flex-between">
          <div style="min-width:0">
            <div class="history-site">${esc(ticketNo(t))} · ${esc(t.title)}</div>
            <div class="history-date">${esc(t.site_name)} · ${esc(t.category)} · ${isAlert(t)?'<span class="badge badge-red" style="font-size:9px;padding:1px 6px">AUTO</span>':esc(t.raised_by_name||'')} · ${ticketAge(t)}</div>
          </div>
          ${ticketStatusBadge(t.status)}
        </div>
        <div class="history-stats" style="flex-wrap:wrap">
          ${ticketPriorityBadge(t.priority)}
          ${t.estimated_cost!=null?`<span class="badge badge-gray">Est ${money(t.estimated_cost)}</span>`:''}
          ${t.approved_amount!=null?`<span class="badge badge-green">Appr ${money(t.approved_amount)}</span>`:''}
          ${ticketChips(t)}
        </div>
      </div>`).join('');
  }catch(e){el.innerHTML='<div class="error-box">Failed to load tickets</div>';}
}

// ── Quick raise: one photo, one line ─────────────────────────────────────────
// The WhatsApp habit is a photo and a sentence. Everything else (category,
// cost, target date) a manager can add later with Edit.
function openQuickTicket(presetSite){
  ticketPhotoFiles={};
  const mySites=ticketMySites();
  _quickSite=presetSite||(mySites.length===1?mySites[0]:(ticketSiteFilter||''));
  const content=document.getElementById('modalContent');
  const sitePick=mySites.length<=6
    ?`<div style="display:flex;gap:6px;flex-wrap:wrap" id="quickSites">${mySites.map(s=>`<span class="quick-site${_quickSite===s?' active':''}" onclick="_quickSite='${esc(s)}';refreshQuickSites()">${esc(s)}</span>`).join('')}</div>`
    :`<select id="quickSiteSel" onchange="_quickSite=this.value"><option value="">Select site</option>${mySites.map(s=>`<option value="${esc(s)}"${_quickSite===s?' selected':''}>${esc(s)}</option>`).join('')}</select>`;
  content.innerHTML=`
    <div class="modal-header"><div class="modal-title">Report a problem</div><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-field"><label>Site *</label>${sitePick}</div>
    <div class="modal-field"><label>What's wrong? *</label>
      <textarea id="quickText" placeholder="e.g. Inverter 3 tripping since morning, DO fuse looks burnt" style="min-height:70px"></textarea>
    </div>
    <div class="modal-field"><label>Photo</label>
      <div class="photo-grid" id="ticketPhotoGrid">${buildTicketPhotoGrid()}</div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-size:12px;margin:4px 0 10px;cursor:pointer">
      <input type="checkbox" id="quickUrgent" style="width:16px;height:16px"> Needs attention today
    </label>
    <div id="ticketFormError" class="error-box hidden"></div>
    <div style="display:flex;gap:8px;margin-top:6px">
      <button class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" id="ticketSaveBtn" onclick="saveQuickTicket()">Send</button>
    </div>`;
  document.getElementById('modalOverlay').classList.remove('hidden');
}
function refreshQuickSites(){
  document.querySelectorAll('#quickSites .quick-site').forEach(el=>el.classList.toggle('active',el.textContent===_quickSite));
}
async function saveQuickTicket(){
  const btn=document.getElementById('ticketSaveBtn');
  const errEl=document.getElementById('ticketFormError');
  const fail=m=>{errEl.textContent=m;errEl.classList.remove('hidden');btn.disabled=false;btn.textContent='Send';};
  errEl.classList.add('hidden');
  const sel=document.getElementById('quickSiteSel');if(sel)_quickSite=sel.value;
  const text=document.getElementById('quickText').value.trim();
  if(!_quickSite)return fail('Pick a site');
  if(!text)return fail('Say what is wrong');
  const urgent=document.getElementById('quickUrgent').checked;
  const payload={
    site_name:_quickSite, category:'Repair',
    title:text.length>80?text.slice(0,77).trimEnd()+'…':text,
    description:text, priority:urgent?'high':'medium',
    raised_by_phone:session.phone, raised_by_name:session.name, status:'open'
  };
  btn.disabled=true;btn.textContent='Sending...';
  try{localStorage.setItem('dgr_ticket_draft',JSON.stringify({payload,savedAt:new Date().toISOString()}));}catch(e){}
  try{
    const{data,error}=await sb.from('dgr_tickets').insert(payload).select('*').single();
    if(error)throw error;
    if(Object.keys(ticketPhotoFiles).length>0){
      const urls=await uploadTicketPhotos(data.id,payload.site_name);
      if(Object.keys(urls).length>0){await sb.from('dgr_tickets').update({image_urls:urls}).eq('id',data.id);data.image_urls=urls;}
    }
    try{localStorage.removeItem('dgr_ticket_draft');}catch(e){}
    ticketPhotoFiles={};
    showQuickDone(data);
  }catch(e){
    const isNet=e.message&&(e.message.includes('fetch')||e.message.includes('network')||e.message.includes('NetworkError'));
    fail(isNet?'Network error — check your signal and tap again. Your entry is saved.':'Send failed: '+e.message);
  }
}
function showQuickDone(t){
  const content=document.getElementById('modalContent');
  content.innerHTML=`
    <div class="modal-header"><div class="modal-title">Sent ✓</div><button class="modal-close" onclick="closeModal();if(currentTab==='tickets')loadTickets();else if(currentTab==='dgr'&&currentScreen===0)showHomeScreen()">✕</button></div>
    <div style="font-size:13px;font-weight:600">${esc(ticketNo(t))} raised for ${esc(t.site_name)}</div>
    <div style="font-size:11px;color:var(--gray);margin:4px 0 14px">Your manager will see it under Awaiting me. Share it on the site group so everyone knows.</div>
    <button class="btn-whatsapp" onclick="shareTicketWhatsApp('${t.id}')">Share on WhatsApp</button>
    <button class="btn btn-secondary btn-block" style="margin-top:8px" onclick="viewTicket('${t.id}')">Open ticket</button>`;
}

// ── Raise / edit (full form) ─────────────────────────────────────────────────
function openTicketModal(id){
  ticketPhotoFiles={};
  _editingTicketId=id||null;
  const modal=document.getElementById('modalOverlay');
  const content=document.getElementById('modalContent');
  if(id){
    content.innerHTML=`<div class="modal-header"><div class="modal-title">Loading...</div><button class="modal-close" onclick="closeModal()">✕</button></div>`;
    modal.classList.remove('hidden');
    sb.from('dgr_tickets').select('*').eq('id',id).single().then(({data})=>{content.innerHTML=buildTicketForm(data);});
  } else {
    content.innerHTML=buildTicketForm(null);
    modal.classList.remove('hidden');
  }
}

function buildTicketForm(t){
  const mySites=ticketMySites();
  const selSite=t?t.site_name:(mySites.length===1?mySites[0]:'');
  return `
    <div class="modal-header"><div class="modal-title">${t?'Edit ticket '+esc(ticketNo(t)):'Raise ticket'}</div><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-field"><label>Site *</label>
      <select id="mTicketSite">
        <option value="">Select site</option>
        ${mySites.map(s=>`<option value="${esc(s)}"${selSite===s?' selected':''}>${esc(s)}</option>`).join('')}
      </select>
    </div>
    <div class="modal-field"><label>Category *</label>
      <select id="mTicketCategory">
        ${ticketCategories().map(c=>`<option value="${esc(c)}"${t&&t.category===c?' selected':''}>${esc(c)}</option>`).join('')}
      </select>
    </div>
    <div class="modal-field"><label>Title *</label><input id="mTicketTitle" maxlength="140" placeholder="e.g. DO fuse burnt on inverter 3" value="${t?esc(t.title):''}"></div>
    <div class="modal-field"><label>Description</label><textarea id="mTicketDesc" placeholder="What happened, what is needed">${t?esc(t.description||''):''}</textarea></div>
    <div style="display:flex;gap:8px">
      <div class="modal-field" style="flex:1"><label>Priority</label>
        <select id="mTicketPriority">
          ${TICKET_PRIORITIES.map(p=>`<option value="${p}"${(t?t.priority:'medium')===p?' selected':''}>${p.charAt(0).toUpperCase()+p.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div class="modal-field" style="flex:1"><label>Target date</label><input type="date" id="mTicketTarget" value="${t&&t.target_date?esc(t.target_date):''}"></div>
    </div>
    <div class="modal-field"><label>Estimated cost (₹)</label>
      <input type="number" inputmode="decimal" min="0" id="mTicketCost" placeholder="Leave blank if no cost" value="${t&&t.estimated_cost!=null?esc(t.estimated_cost):''}">
      <div class="text-hint" style="margin-top:3px">Above ${money(ticketThreshold())} this needs admin approval as well.</div>
    </div>
    <div class="modal-field"><label>Photos</label>
      <div class="photo-grid" id="ticketPhotoGrid">${buildTicketPhotoGrid()}</div>
      <div class="text-hint" style="margin-top:3px">Max 5MB each${t&&t.image_urls?' · existing photos are kept':''}</div>
    </div>
    <div id="ticketFormError" class="error-box hidden"></div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-secondary" style="flex:1" onclick="${t?`viewTicket('${t.id}')`:'closeModal()'}">${t?'Back':'Cancel'}</button>
      <button class="btn btn-primary" style="flex:1" id="ticketSaveBtn" onclick="saveTicket()">${t?'Save changes':'Raise ticket'}</button>
    </div>`;
}

function buildTicketPhotoGrid(){
  const keys=Object.keys(ticketPhotoFiles);
  let html=keys.map(k=>`<div class="photo-slot filled" onclick="removeTicketPhoto('${k}')">
      <span style="font-size:14px">📷</span>
      <span style="font-size:9px;text-align:center">Photo</span>
      <span style="font-size:8px">✓ tap to remove</span>
    </div>`).join('');
  if(keys.length<4)html+=`<div class="photo-slot empty" onclick="triggerTicketPhoto()">
      <span style="font-size:18px">+</span>
      <span style="font-size:9px;text-align:center">Add photo</span>
    </div>`;
  return html;
}
function triggerTicketPhoto(){document.getElementById('ticketPhotoInput').click();}
function handleTicketPhoto(e){
  const file=e.target.files[0];
  e.target.value='';
  if(!file)return;
  if(file.size>5*1024*1024){alert('Photo must be under 5MB');return;}
  ticketPhotoFiles['p'+Date.now()]=file;
  refreshTicketPhotoGrid();
}
function removeTicketPhoto(key){delete ticketPhotoFiles[key];refreshTicketPhotoGrid();}
function refreshTicketPhotoGrid(){
  // Re-render only the grid so typed form values survive
  const grid=document.getElementById('ticketPhotoGrid');
  if(grid)grid.innerHTML=buildTicketPhotoGrid();
}

async function uploadTicketPhotos(ticketId,siteName){
  const out={};
  for(const[key,file]of Object.entries(ticketPhotoFiles)){
    if(!file)continue;
    const path=`tickets/${siteName}/${ticketId}/${key}_${Date.now()}.jpg`;
    try{
      const{error:upErr}=await sb.storage.from('dgr-photos').upload(path,file);
      if(!upErr){
        const{data:urlData}=sb.storage.from('dgr-photos').getPublicUrl(path);
        if(urlData)out[key]=urlData.publicUrl;
      }
    }catch(e){}
  }
  return out;
}

async function saveTicket(){
  const btn=document.getElementById('ticketSaveBtn');
  const errEl=document.getElementById('ticketFormError');
  const fail=m=>{errEl.textContent=m;errEl.classList.remove('hidden');btn.disabled=false;btn.textContent=_editingTicketId?'Save changes':'Raise ticket';};
  errEl.classList.add('hidden');
  const costRaw=document.getElementById('mTicketCost').value.trim();
  const payload={
    site_name:document.getElementById('mTicketSite').value,
    category:document.getElementById('mTicketCategory').value,
    title:document.getElementById('mTicketTitle').value.trim(),
    description:document.getElementById('mTicketDesc').value.trim()||null,
    priority:document.getElementById('mTicketPriority').value,
    target_date:document.getElementById('mTicketTarget').value||null,
    estimated_cost:costRaw===''?null:Number(costRaw)
  };
  if(!payload.site_name)return fail('Select a site');
  if(!payload.title)return fail('Enter a title');
  if(payload.estimated_cost!=null&&(isNaN(payload.estimated_cost)||payload.estimated_cost<0))return fail('Enter a valid cost');
  btn.disabled=true;btn.textContent='Saving...';
  // Save a draft first — protects against connection drops, same as submitReport()
  try{localStorage.setItem('dgr_ticket_draft',JSON.stringify({payload,savedAt:new Date().toISOString()}));}catch(e){}
  try{
    let ticketId=_editingTicketId;
    if(ticketId){
      const{error}=await sb.from('dgr_tickets').update(payload).eq('id',ticketId);
      if(error)throw error;
    } else {
      payload.raised_by_phone=session.phone;
      payload.raised_by_name=session.name;
      payload.status='open';
      const{data,error}=await sb.from('dgr_tickets').insert(payload).select('id').single();
      if(error)throw error;
      ticketId=data.id;
    }
    if(Object.keys(ticketPhotoFiles).length>0){
      const urls=await uploadTicketPhotos(ticketId,payload.site_name);
      if(Object.keys(urls).length>0){
        const{data:cur}=await sb.from('dgr_tickets').select('image_urls').eq('id',ticketId).single();
        await sb.from('dgr_tickets').update({image_urls:Object.assign({},(cur&&cur.image_urls)||{},urls)}).eq('id',ticketId);
      }
    }
    try{localStorage.removeItem('dgr_ticket_draft');}catch(e){}
    ticketPhotoFiles={};
    const wasEdit=!!_editingTicketId;_editingTicketId=null;
    if(wasEdit){await afterTicketChange(ticketId);return;}
    closeModal();
    if(currentTab==='tickets')loadTickets();else switchTab('tickets');
  }catch(e){
    const isNet=e.message&&(e.message.includes('fetch')||e.message.includes('network')||e.message.includes('NetworkError'));
    fail(isNet?'Network error — check your signal and tap again. Your entry is saved.':'Save failed: '+e.message);
  }
}

// ── Detail ───────────────────────────────────────────────────────────────────
async function viewTicket(id){
  const modal=document.getElementById('modalOverlay');
  const content=document.getElementById('modalContent');
  content.innerHTML=`<div class="modal-header"><div class="modal-title">Loading...</div><button class="modal-close" onclick="closeModal()">✕</button></div>`;
  modal.classList.remove('hidden');
  const{data:t,error}=await sb.from('dgr_tickets').select('*').eq('id',id).single();
  if(error||!t){content.innerHTML=`<div class="modal-header"><div class="modal-title">Error</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="error-box">Could not load ticket</div>`;return;}
  const{data:comments}=await sb.from('dgr_ticket_comments').select('*').eq('ticket_id',id).order('created_at');
  content.innerHTML=buildTicketDetail(t,comments||[]);
  content.scrollTop=0;
  navTo('tickets/'+id);   // keep the ticket shareable / refresh-safe
}

function buildTicketDetail(t,comments){
  const row=(l,v)=>`<div class="summary-row"><span class="summary-label">${l}</span><span class="summary-value">${v}</span></div>`;
  const head=s=>`<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin:10px 0 4px">${s}</div>`;
  const who=(name,at)=>`${esc(name||'')} <span style="color:var(--gray)">${esc(ticketStamp(at))}</span>`;
  const photos=t.image_urls?Object.values(t.image_urls):[];
  const alert=isAlert(t);
  const spend=t.actual_cost!=null?(()=>{
    const diff=t.approved_amount!=null?Number(t.actual_cost)-Number(t.approved_amount):null;
    const tag=diff==null?'':diff>0?` <span class="badge badge-red">${money(diff)} over</span>`:diff<0?` <span class="badge badge-green">${money(-diff)} under</span>`:' <span class="badge badge-green">on budget</span>';
    return row('Actual cost',esc(money(t.actual_cost))+tag);
  })():'';
  return `
    <div class="modal-header">
      <div class="modal-title">${esc(ticketNo(t))} ${ticketStatusBadge(t.status)}</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div style="font-size:13px;font-weight:600;margin-bottom:2px">${esc(t.title)}</div>
    <div style="font-size:10px;color:var(--gray);margin-bottom:6px">${esc(t.site_name)} · raised by ${esc(t.raised_by_name||'—')} · ${ticketAge(t)}</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">${ticketChips(t)}</div>
    ${head('Details')}
    ${alert?row('Raised by',`<span class="badge badge-red">System</span> ${esc(t.rule_key||'')} · ${esc(t.alert_date||'')}`):''}
    ${row('Assigned to',t.assigned_to_name?`${esc(t.assigned_to_name)} <span style="color:var(--gray)">(${esc(t.assigned_kind||'')})</span>`:'<span style="color:var(--gray)">Nobody yet</span>')}
    ${row('Category',esc(t.category))}
    ${row('Priority',ticketPriorityBadge(t.priority))}
    ${row('Target date',esc(t.target_date?ticketDate(t.target_date):'—'))}
    ${alert?'':row('Estimated cost',esc(money(t.estimated_cost)))}
    ${t.approved_amount!=null?row('Approved amount',esc(money(t.approved_amount))):''}
    ${spend}
    ${row('Description',esc(t.description||'—'))}
    ${photos.length>0?`${head('Photos')}<div style="display:flex;gap:6px;flex-wrap:wrap">${photos.map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" style="width:72px;height:72px;object-fit:cover;border-radius:7px;border:1px solid var(--border)"></a>`).join('')}</div>`:''}
    ${alert?`
      ${head('Progress')}
      ${row('Acknowledged',t.acknowledged_at?who(t.acknowledged_by_name,t.acknowledged_at):'<span style="color:var(--gray)">Not yet</span>')}
      ${row('Resolved',t.resolved_at?who(t.resolved_by_name,t.resolved_at):'<span style="color:var(--gray)">Not yet</span>')}
      ${t.resolution_note?row('What was done',esc(t.resolution_note)):''}
    `:`
      ${head('Approval trail')}
      ${row('Manager (L1)',t.l1_status==='pending'||!t.l1_status?'<span style="color:var(--gray)">Pending</span>':`${esc(t.l1_status)} · ${who(t.l1_by_name,t.l1_at)}`)}
      ${t.l1_remark?row('L1 remark',esc(t.l1_remark)):''}
      ${row('Admin (L2)',ticketNeedsL2(t)?(t.l2_status==='pending'||!t.l2_status?'<span style="color:var(--gray)">Pending</span>':`${esc(t.l2_status)} · ${who(t.l2_by_name,t.l2_at)}`):`<span style="color:var(--gray)">Not required (under ${esc(money(ticketThreshold()))})</span>`)}
      ${t.l2_remark?row('L2 remark',esc(t.l2_remark)):''}
      ${t.closure_requested_at?row('Closure requested',who(t.closure_requested_by_name,t.closure_requested_at)):''}
      ${t.closure_note?row('Closure note',esc(t.closure_note)):''}
      ${t.closed_at?row('Closed',who(t.closed_by_name,t.closed_at)):''}
    `}
    ${head('Comments')}
    <div style="max-height:180px;overflow-y:auto;margin-bottom:8px">
      ${comments.length===0?'<div style="font-size:11px;color:var(--gray)">No comments yet</div>':
        comments.map(c=>`<div style="border-left:2px solid var(--outline-var);padding:4px 0 4px 8px;margin-bottom:6px">
          <div style="font-size:10px;color:var(--gray)">${esc(c.author_name||'')} · ${esc(c.author_role||'')} · ${esc(ticketStamp(c.created_at))}</div>
          <div style="font-size:11px">${esc(c.comment)}</div>
        </div>`).join('')}
    </div>
    <div style="display:flex;gap:6px;align-items:flex-start">
      <textarea id="ticketCommentInput" placeholder="Add a comment" style="min-height:38px;flex:1"></textarea>
      <button class="btn btn-secondary" style="padding:9px 12px" onclick="addTicketComment('${t.id}')">Post</button>
    </div>
    ${buildTicketActions(t)}
    <button class="btn-whatsapp" style="margin-top:10px" onclick="shareTicketWhatsApp('${t.id}')">Share on WhatsApp</button>`;
}

function buildTicketActions(t){
  const isRaiser=t.raised_by_phone===session.phone, approver=isTicketApprover(), mine=isAssignedToMe(t);
  const atMySite=isEngineer()&&(session.assigned_sites||[]).includes(t.site_name);
  const btns=[];
  const red='background:var(--red-light);color:var(--red);border:1px solid var(--red-border)';
  const b=(label,fn,style='')=>btns.push(`<button class="btn ${style?'':'btn-secondary'}" style="flex:1;padding:9px;font-size:11px;${style}" onclick="${fn}">${label}</button>`);
  const primary='background:var(--primary);color:#fff;border:1px solid var(--primary)';

  if(approver&&TICKET_LIVE.includes(t.status))b(t.assigned_to_name?'Reassign':'Assign',`openAssignModal('${t.id}')`);

  if(isAlert(t)){
    // Alerts: whoever is on the hook (manager, assignee, the site's engineer) can act
    const canAct=approver||mine||atMySite;
    if(canAct&&t.status==='open')b('Acknowledge',`acknowledgeTicket('${t.id}')`,primary);
    if(canAct&&(t.status==='open'||t.status==='acknowledged'))b('Resolve',`resolveTicket('${t.id}')`,t.status==='acknowledged'?primary:'');
    if(approver&&(t.status==='open'||t.status==='acknowledged'))b(isSnoozed(t)?'Snooze again':'Snooze',`snoozeTicket('${t.id}')`);
    if(approver&&t.status==='resolved')b('Reopen',`reopenAlert('${t.id}')`);
  } else {
    if(t.status==='open'&&(isRaiser||isAdminUp()))b('Edit',`openTicketModal('${t.id}')`);
    if(t.status==='open'&&isRaiser)b('Cancel',`cancelTicket('${t.id}')`,red);
    if((t.status==='open'||t.status==='l1_approved')&&approver){
      const label=t.status==='l1_approved'?'Approve (final)':(ticketNeedsL2(t)&&!isAdminUp()?'Approve (L1)':'Approve');
      if(!(t.status==='l1_approved'&&!isAdminUp()))b(label,`approveTicket('${t.id}')`,primary);
      b('Reject',`rejectTicket('${t.id}')`,red);
    }
    if(t.status==='approved'&&(isRaiser||approver||mine))b('Request closure',`openClosureModal('${t.id}')`,primary);
    if(t.status==='closure_requested'&&approver){
      b('Confirm closure',`confirmTicketClosure('${t.id}')`,primary);
      b('Reopen',`reopenTicket('${t.id}')`);
    }
    if(t.status==='l1_approved'&&!isAdminUp())
      btns.push(`<div style="flex:1;font-size:10px;color:var(--gray);text-align:center;padding:9px">Waiting on admin — above ${esc(money(ticketThreshold()))}</div>`);
  }
  if(btns.length===0)return '';
  return `<div style="display:flex;gap:6px;margin-top:14px;flex-wrap:wrap">${btns.join('')}</div>`;
}

// ── Assignment ───────────────────────────────────────────────────────────────
let _assignPeople=null;   // users fetched once per session
async function loadAssignPeople(){
  if(_assignPeople)return _assignPeople;
  const{data}=await sb.from('users').select('phone,name,role,assigned_sites').neq('name','').order('name');
  _assignPeople=(data||[]).filter(u=>u.phone&&u.name);
  return _assignPeople;
}
async function openAssignModal(id){
  const content=document.getElementById('modalContent');
  content.innerHTML=`<div class="modal-header"><div class="modal-title">Assign</div><button class="modal-close" onclick="viewTicket('${id}')">✕</button></div><div style="color:var(--gray);font-size:12px">Loading people…</div>`;
  const[{data:t},people]=await Promise.all([sb.from('dgr_tickets').select('id,site_name,assigned_to_phone').eq('id',id).single(),loadAssignPeople()]);
  const rank=u=>roleRank(u.role);
  const atSite=people.filter(u=>rank(u)<=1&&(u.assigned_sites||[]).includes(t.site_name));
  const otherEng=people.filter(u=>rank(u)<=1&&!(u.assigned_sites||[]).includes(t.site_name));
  const managers=people.filter(u=>rank(u)>=2);
  // name goes inside a single-quoted JS string inside a double-quoted attribute
  const js=s=>String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
  const opt=(name,kind,phone,sub)=>`<div class="assign-opt" onclick="assignTicket('${id}','${esc(phone||'')}','${js(name)}','${kind}')">
      <span>${esc(name)}${phone===session.phone?' <span style="color:var(--gray)">(me)</span>':''}</span><span class="assign-kind">${esc(sub||kind)}</span></div>`;
  const group=(title,html)=>html?`<div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin:10px 0 4px">${title}</div>${html}`:'';
  content.innerHTML=`
    <div class="modal-header"><div class="modal-title">Assign ticket</div><button class="modal-close" onclick="viewTicket('${id}')">✕</button></div>
    <div style="font-size:11px;color:var(--gray)">${esc(t.site_name)}</div>
    ${group('Engineers at this site',atSite.map(u=>opt(u.name,'engineer',u.phone)).join(''))}
    ${group('Managers',managers.map(u=>opt(u.name,'manager',u.phone,ROLE_LABEL[u.role]||u.role)).join(''))}
    ${group('Vendors',ticketVendors().map(v=>opt(v,'vendor',null,'vendor · no login')).join(''))}
    <details style="margin-top:10px"><summary style="font-size:11px;color:var(--primary);cursor:pointer">Other engineers</summary>
      ${otherEng.map(u=>opt(u.name,'engineer',u.phone,(u.assigned_sites||[]).slice(0,2).join(', '))).join('')}
    </details>
    ${t.assigned_to_phone||t.assigned_to_name?`<button class="btn btn-secondary btn-block" style="margin-top:12px" onclick="assignTicket('${id}','',null,'')">Clear assignment</button>`:''}`;
}
async function assignTicket(id,phone,name,kind){
  const upd=name?{assigned_to_phone:phone||null,assigned_to_name:name,assigned_kind:kind,assigned_at:new Date().toISOString(),assigned_by_name:session.name}
                 :{assigned_to_phone:null,assigned_to_name:null,assigned_kind:null,assigned_at:null,assigned_by_name:null};
  const{error}=await sb.from('dgr_tickets').update(upd).eq('id',id);
  if(error){alert('Assign failed: '+error.message);return;}
  await systemComment(id,name?`Assigned to ${name} (${kind}) by ${session.name}`:`Assignment cleared by ${session.name}`);
  await afterTicketChange(id);
}

// ── Alert actions ────────────────────────────────────────────────────────────
async function acknowledgeTicket(id){
  const{error}=await sb.from('dgr_tickets').update({status:'acknowledged',acknowledged_at:new Date().toISOString(),acknowledged_by_name:session.name}).eq('id',id);
  if(error){alert('Failed: '+error.message);return;}
  await afterTicketChange(id);
}
async function resolveTicket(id){
  const note=prompt('What was done?');
  if(note===null)return;
  if(!note.trim()){alert('Say what was done');return;}
  const now=new Date().toISOString();
  const{data:t}=await sb.from('dgr_tickets').select('acknowledged_at').eq('id',id).single();
  const upd={status:'resolved',resolved_at:now,resolved_by_name:session.name,resolution_note:note.trim(),snoozed_until:null};
  if(t&&!t.acknowledged_at){upd.acknowledged_at=now;upd.acknowledged_by_name=session.name;}
  const{error}=await sb.from('dgr_tickets').update(upd).eq('id',id);
  if(error){alert('Failed: '+error.message);return;}
  await afterTicketChange(id);
}
async function snoozeTicket(id){
  const raw=prompt('Snooze for how many days? It stays open but leaves "Awaiting me" and stops repeating.','3');
  if(raw===null)return;
  const days=parseInt(raw,10);
  if(isNaN(days)||days<1||days>60){alert('Enter 1 to 60 days');return;}
  const until=new Date();until.setDate(until.getDate()+days);
  const{error}=await sb.from('dgr_tickets').update({snoozed_until:until.toISOString().split('T')[0]}).eq('id',id);
  if(error){alert('Failed: '+error.message);return;}
  await systemComment(id,`Snoozed ${days} day${days===1?'':'s'} by ${session.name}`);
  await afterTicketChange(id);
}
async function reopenAlert(id){
  const note=prompt('Why is this being reopened?');
  if(note===null)return;
  if(!note.trim()){alert('A reason is required');return;}
  const{error}=await sb.from('dgr_tickets').update({status:'acknowledged',resolved_at:null,resolved_by_name:null,resolution_note:null}).eq('id',id);
  if(error){alert('Reopen failed: '+error.message);return;}
  await userComment(id,'Reopened: '+note.trim());
  await afterTicketChange(id);
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────
function ticketWhatsAppText(t){
  const lines=[
    `🎫 ${ticketNo(t)} · ${t.site_name}`,
    t.title,
    `Status: ${(TICKET_STATUS_META[t.status]||{label:t.status}).label} · Priority: ${t.priority||'medium'}`,
  ];
  if(t.assigned_to_name)lines.push(`Assigned to: ${t.assigned_to_name}`);
  if(t.target_date)lines.push(`Target: ${ticketDate(t.target_date)}`);
  if(t.estimated_cost!=null&&!isAlert(t))lines.push(`Est. cost: ${money(t.estimated_cost)}`);
  if(t.description&&t.description!==t.title)lines.push('',t.description);
  const photos=t.image_urls?Object.values(t.image_urls):[];
  if(photos.length)lines.push('',`Photo: ${photos[0]}`);
  lines.push('',`Raised by ${t.raised_by_name||'—'} · ${ticketDate(t.created_at)}`,`${TICKET_APP_URL}#tickets/${t.id}`);
  return lines.join('\n');
}
async function shareTicketWhatsApp(id){
  const{data:t}=await sb.from('dgr_tickets').select('*').eq('id',id).single();
  if(!t)return;
  const encoded=encodeURIComponent(ticketWhatsAppText(t));
  if(/Android|iPhone|iPad/i.test(navigator.userAgent))window.location.href='whatsapp://send?text='+encoded;
  else window.open('https://wa.me/?text='+encoded,'_blank');
}

// ── Mutations ────────────────────────────────────────────────────────────────
async function afterTicketChange(id){
  if(currentTab==='tickets')loadTickets();
  await viewTicket(id);
}
async function systemComment(id,text){
  await sb.from('dgr_ticket_comments').insert({ticket_id:id,author_phone:'system',author_name:'System',author_role:'system',comment:text});
}
async function userComment(id,text){
  return sb.from('dgr_ticket_comments').insert({ticket_id:id,author_phone:session.phone,author_name:session.name,author_role:session.role,comment:text});
}

function promptApprovedAmount(t){
  const def=t.estimated_cost!=null?String(t.estimated_cost):'';
  const raw=prompt('Approved amount (₹) — leave blank if there is no cost:',def);
  if(raw===null)return{cancelled:true};
  const s=raw.trim();
  if(s==='')return{cancelled:false,amount:null};
  const n=Number(s);
  if(isNaN(n)||n<0){alert('Enter a valid amount');return{cancelled:true};}
  return{cancelled:false,amount:n};
}

async function approveTicket(id){
  const{data:t}=await sb.from('dgr_tickets').select('*').eq('id',id).single();
  if(!t)return;
  if(!isTicketApprover()){alert('Only a manager or admin can approve');return;}
  const now=new Date().toISOString();
  const needsL2=ticketNeedsL2(t);
  const upd={};
  if(t.status==='open'){
    const remark=prompt('Approval remark (optional):');
    if(remark===null)return;
    upd.l1_status='approved';upd.l1_by_name=session.name;upd.l1_at=now;upd.l1_remark=remark.trim()||null;
    if(needsL2&&!isAdminUp()){
      upd.status='l1_approved';   // manager can only clear L1 above the threshold
    } else {
      const amt=promptApprovedAmount(t);
      if(amt.cancelled)return;
      upd.status='approved';upd.approved_amount=amt.amount;
      if(needsL2){upd.l2_status='approved';upd.l2_by_name=session.name;upd.l2_at=now;upd.l2_remark=remark.trim()||null;}
    }
  } else if(t.status==='l1_approved'){
    if(!isAdminUp()){alert('Only an Admin or Director can give final approval above '+money(ticketThreshold()));return;}
    const remark=prompt('Final approval remark (optional):');
    if(remark===null)return;
    const amt=promptApprovedAmount(t);
    if(amt.cancelled)return;
    upd.l2_status='approved';upd.l2_by_name=session.name;upd.l2_at=now;upd.l2_remark=remark.trim()||null;
    upd.status='approved';upd.approved_amount=amt.amount;
  } else return;
  const{error}=await sb.from('dgr_tickets').update(upd).eq('id',id);
  if(error){alert('Approve failed: '+error.message);return;}
  await afterTicketChange(id);
}

async function rejectTicket(id){
  if(!isTicketApprover()){alert('Only a manager or admin can reject');return;}
  const{data:t}=await sb.from('dgr_tickets').select('status').eq('id',id).single();
  if(!t)return;
  const note=prompt('Rejection reason:');
  if(note===null)return;
  if(!note.trim()){alert('A reason is required');return;}
  const now=new Date().toISOString();
  const upd={status:'rejected'};
  if(t.status==='l1_approved'){upd.l2_status='rejected';upd.l2_by_name=session.name;upd.l2_at=now;upd.l2_remark=note.trim();}
  else{upd.l1_status='rejected';upd.l1_by_name=session.name;upd.l1_at=now;upd.l1_remark=note.trim();}
  const{error}=await sb.from('dgr_tickets').update(upd).eq('id',id);
  if(error){alert('Reject failed: '+error.message);return;}
  await afterTicketChange(id);
}

async function cancelTicket(id){
  if(!confirm('Cancel this ticket?'))return;
  const{error}=await sb.from('dgr_tickets').update({status:'cancelled'}).eq('id',id);
  if(error){alert('Cancel failed: '+error.message);return;}
  await afterTicketChange(id);
}

// Closure request carries a note, the actual spend, plus optional proof photos
function openClosureModal(id){
  ticketPhotoFiles={};
  _closureTicketId=id;
  const content=document.getElementById('modalContent');
  content.innerHTML=`<div class="modal-header"><div class="modal-title">Request closure</div><button class="modal-close" onclick="viewTicket('${id}')">✕</button></div><div style="color:var(--gray);font-size:12px">Loading…</div>`;
  document.getElementById('modalOverlay').classList.remove('hidden');
  sb.from('dgr_tickets').select('approved_amount,estimated_cost,actual_cost').eq('id',id).single().then(({data:t})=>{
    const hasMoney=t&&(t.approved_amount!=null||t.estimated_cost!=null);
    content.innerHTML=`
      <div class="modal-header"><div class="modal-title">Request closure</div><button class="modal-close" onclick="viewTicket('${id}')">✕</button></div>
      <div class="modal-field"><label>What was done? *</label><textarea id="mClosureNote" placeholder="Work completed, parts used, bill reference"></textarea></div>
      <div class="modal-field"><label>Actual cost (₹)${hasMoney?' *':''}</label>
        <input type="number" inputmode="decimal" min="0" id="mClosureCost" placeholder="${hasMoney?'What was actually spent':'Leave blank if nothing was spent'}" value="${t&&t.actual_cost!=null?esc(t.actual_cost):''}">
        ${t&&t.approved_amount!=null?`<div class="text-hint" style="margin-top:3px">Approved: ${money(t.approved_amount)}</div>`:''}
      </div>
      <div class="modal-field"><label>Proof photos / bill</label>
        <div class="photo-grid" id="ticketPhotoGrid">${buildTicketPhotoGrid()}</div>
        <div class="text-hint" style="margin-top:3px">Max 5MB each</div>
      </div>
      <div id="ticketFormError" class="error-box hidden"></div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-secondary" style="flex:1" onclick="viewTicket('${id}')">Back</button>
        <button class="btn btn-primary" style="flex:1" id="closureSaveBtn" onclick="submitTicketClosure(${hasMoney?'true':'false'})">Submit</button>
      </div>`;
  });
}

async function submitTicketClosure(costRequired){
  const id=_closureTicketId;
  const btn=document.getElementById('closureSaveBtn');
  const errEl=document.getElementById('ticketFormError');
  const fail=m=>{errEl.textContent=m;errEl.classList.remove('hidden');btn.disabled=false;btn.textContent='Submit';};
  const note=document.getElementById('mClosureNote').value.trim();
  const costRaw=document.getElementById('mClosureCost').value.trim();
  if(!note)return fail('Describe what was done');
  if(costRequired&&costRaw==='')return fail('Enter the actual cost (0 if nothing was spent)');
  const cost=costRaw===''?null:Number(costRaw);
  if(cost!=null&&(isNaN(cost)||cost<0))return fail('Enter a valid cost');
  btn.disabled=true;btn.textContent='Submitting...';
  try{
    const{data:t}=await sb.from('dgr_tickets').select('site_name,image_urls').eq('id',id).single();
    let images=(t&&t.image_urls)||{};
    if(Object.keys(ticketPhotoFiles).length>0){
      const urls=await uploadTicketPhotos(id,t.site_name);
      images=Object.assign({},images,urls);
    }
    const{error}=await sb.from('dgr_tickets').update({
      status:'closure_requested',
      closure_note:note,
      actual_cost:cost,
      closure_requested_at:new Date().toISOString(),
      closure_requested_by_name:session.name,
      image_urls:Object.keys(images).length>0?images:null
    }).eq('id',id);
    if(error)throw error;
    ticketPhotoFiles={};_closureTicketId=null;
    await afterTicketChange(id);
  }catch(e){fail('Failed: '+e.message);}
}

async function confirmTicketClosure(id){
  if(!isTicketApprover()){alert('Only a manager or admin can close a ticket');return;}
  if(!confirm('Confirm this ticket is resolved and close it?'))return;
  const{error}=await sb.from('dgr_tickets').update({
    status:'closed',closed_at:new Date().toISOString(),closed_by_name:session.name
  }).eq('id',id);
  if(error){alert('Close failed: '+error.message);return;}
  await afterTicketChange(id);
}

async function reopenTicket(id){
  if(!isTicketApprover()){alert('Only a manager or admin can reopen a ticket');return;}
  const note=prompt('Why is this being reopened?');
  if(note===null)return;
  if(!note.trim()){alert('A reason is required');return;}
  const{error}=await sb.from('dgr_tickets').update({
    status:'approved',closure_requested_at:null,closure_requested_by_name:null,closure_note:null
  }).eq('id',id);
  if(error){alert('Reopen failed: '+error.message);return;}
  await userComment(id,'Reopened: '+note.trim());
  await afterTicketChange(id);
}

async function addTicketComment(id){
  const inp=document.getElementById('ticketCommentInput');
  const text=inp?inp.value.trim():'';
  if(!text)return;
  const{error}=await userComment(id,text);
  if(error){alert('Comment failed: '+error.message);return;}
  await viewTicket(id);
}

// ── Home-screen pieces ───────────────────────────────────────────────────────
// Engineer: the jobs on their plate (assigned to them, or raised by them and
// still live, or unacknowledged alerts at their sites). Rendered by showHomeScreen().
async function buildEngineerJobsCard(){
  if(!isEngineer())return '';
  const mine=session.assigned_sites||[];
  let q=sb.from('dgr_tickets').select('*').in('status',TICKET_LIVE).order('created_at',{ascending:false}).limit(8);
  const parts=[`assigned_to_phone.eq.${session.phone}`,`raised_by_phone.eq.${session.phone}`];
  if(mine.length)parts.push(`and(source.eq.auto,status.eq.open,site_name.in.(${mine.map(s=>'"'+s.replace(/"/g,'')+'"').join(',')}))`);
  q=q.or(parts.join(','));
  let rows=[];
  try{const{data}=await q;rows=(data||[]).filter(t=>!isSnoozed(t));}catch(e){return '';}
  const jobs=rows.map(t=>`
    <div class="home-job${isAlert(t)?' alert':''}" onclick="viewTicket('${t.id}')">
      <div style="flex:1;min-width:0">
        <div class="home-job-t">${esc(t.title)}</div>
        <div class="home-job-m">${esc(ticketNo(t))} · ${esc(t.site_name)} · ${isAssignedToMe(t)?'assigned to you':isAlert(t)?'needs acknowledging':'raised by you'} · ${ticketAge(t)}</div>
      </div>
      ${ticketStatusBadge(t.status)}
    </div>`).join('');
  return `
    <div style="padding:0 14px;margin-top:8px">
      <button class="btn btn-primary btn-block" style="padding:11px;font-size:13px" onclick="openQuickTicket()">📷 Report a problem</button>
    </div>
    ${rows.length?`
      <div style="font-size:10px;font-weight:600;color:var(--gray);text-transform:uppercase;letter-spacing:.06em;padding:12px 14px 6px">Your tickets</div>
      <div style="padding:0 14px">${jobs}</div>`:''}`;
}

// Manager and up: counts that need them, each a tap away.
async function buildManagerSummary(){
  if(!isManagerUp())return '';
  const today=todayISO();
  const r=await Promise.all([
    sb.from('dgr_submissions').select('id',{count:'exact',head:true}).eq('report_date',today),
    sb.from('dgr_submissions').select('id',{count:'exact',head:true}).eq('status','pending'),
    sb.from('dgr_tickets').select('*').in('status',TICKET_LIVE)
  ]).catch(()=>null);
  if(!r)return '';
  const filed=r[0].count||0, pending=r[1].count||0, live=(r[2].data||[]);
  const alerts=live.filter(t=>isAlert(t)&&t.status==='open'&&!isSnoozed(t)).length;
  const overdue=live.filter(isOverdue).length;
  const awaiting=live.filter(t=>!isAlert(t)&&ticketAwaitingStatuses().includes(t.status)).length;
  const mine=live.filter(isAssignedToMe).length;
  const card=(k,v,sub,fn,cls='')=>`<div class="home-sum ${cls}" onclick="${fn}"><div class="home-sum-k">${k}</div><div class="home-sum-v">${v}${sub?` <small>${sub}</small>`:''}</div></div>`;
  return `
    <div class="home-summary">
      ${card('Filed today',filed,`/ ${sites.length}`,"setHomeSiteFilter('not_done')",filed<sites.length*0.5&&new Date().getHours()>=21?'warn':'')}
      ${card('Pending approval',pending,'',"switchTab('approvals')",pending>0?'amber':'')}
      ${card('New alerts',alerts,'',"ticketFilter='alerts';switchTab('tickets')",alerts>0?'warn':'')}
      ${card('Tickets awaiting me',awaiting+mine,'',"ticketFilter='awaiting';switchTab('tickets')",awaiting+mine>0?'amber':'')}
      ${card('Overdue tickets',overdue,'',"ticketFilter='open';switchTab('tickets')",overdue>0?'warn':'')}
      ${card('Cleaning','View','summary',"showCleaning()")}
    </div>`;
}
