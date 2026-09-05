// ─────────────────────────────────────────────────────────────────────────────
// TICKETS — repair / spare / expense requests raised by site engineers.
//
// Loaded after overview.js and before app-init.js. Depends on globals from
// app-shell.js (sb, session, sites, appSettings, navTo, role helpers) and on
// escHtml()/closeModal() from earlier modules -- see the load order in dgr.html.
//
// Approval is amount-based: a manager is final at or below
// appSettings.ticket_l2_threshold; above it an Admin or Director signs too.
// Closure needs two people -- engineer requests with proof, manager confirms.
// ─────────────────────────────────────────────────────────────────────────────

// escHtml() lives in dgr-flow.js and only escapes & < > -- fine for text nodes.
// Ticket text never goes into an attribute; only UUIDs do.
function esc(v){return escHtml(String(v==null?'':v));}
function isTicketApprover(){return isManagerUp();}

const DEFAULT_TICKET_CATEGORIES=['Repair','Spare part','Expense','Other'];
const DEFAULT_L2_THRESHOLD=5000;

let ticketFilter='all';
let ticketSiteFilter='';
let ticketPhotoFiles={};      // key -> File, for the raise/edit and closure modals
let _editingTicketId=null;
let _closureTicketId=null;

const TICKET_PRIORITIES=['low','medium','high','critical'];
const TICKET_STATUS_META={
  open:{label:'Open',cls:'badge-yellow'},
  l1_approved:{label:'Awaiting admin',cls:'badge-blue'},
  approved:{label:'Approved',cls:'badge-green'},
  rejected:{label:'Rejected',cls:'badge-red'},
  closure_requested:{label:'Closure requested',cls:'badge-blue'},
  closed:{label:'Closed',cls:'badge-gray'},
  cancelled:{label:'Cancelled',cls:'badge-gray'}
};

function ticketNo(t){return '#TKT-'+String(t.ticket_no||0).padStart(4,'0');}
function ticketThreshold(){const v=Number(appSettings.ticket_l2_threshold);return isNaN(v)?DEFAULT_L2_THRESHOLD:v;}
function ticketNeedsL2(t){return Number(t.estimated_cost||0)>ticketThreshold();}
function ticketCategories(){return appSettings.ticket_categories||DEFAULT_TICKET_CATEGORIES;}
function money(v){return (v==null||v==='')?'—':'₹'+Number(v).toLocaleString('en-IN');}
function ticketMySites(){return isEngineer()?(session.assigned_sites||[]):sites.map(s=>s.site_name);}
function ticketStatusBadge(s){const m=TICKET_STATUS_META[s]||{label:s,cls:'badge-gray'};return `<span class="badge ${m.cls}">${esc(m.label)}</span>`;}
function ticketPriorityBadge(p){
  const v=p||'medium';
  const cls=v==='critical'?'badge-red':v==='high'?'badge-yellow':v==='medium'?'badge-blue':'badge-gray';
  return `<span class="badge ${cls}">${esc(v.charAt(0).toUpperCase()+v.slice(1))}</span>`;
}
function ticketAge(t){
  if(!t.created_at)return '';
  const days=Math.floor((Date.now()-new Date(t.created_at).getTime())/86400000);
  return days<=0?'today':days===1?'1 day ago':days+' days ago';
}
function ticketDate(d){return d?new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—';}
function ticketStamp(d){return d?new Date(d).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';}

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
    ?[['all','All'],['awaiting','Awaiting me'],['open','Open'],['approved','Approved'],['closed','Closed']]
    :[['all','All'],['open','Open'],['approved','Approved'],['closed','Closed']];
  el.innerHTML=`
    <div class="card-title">Tickets</div>
    <div class="card" style="padding:10px;margin-bottom:8px">
      <button class="btn btn-primary" style="width:100%;padding:9px;font-size:12px;margin-bottom:8px" onclick="openTicketModal()">+ Raise ticket</button>
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
      q=q.in('site_name',mine);
    }
    if(ticketSiteFilter)q=q.eq('site_name',ticketSiteFilter);
    if(ticketFilter==='open')q=q.in('status',['open','l1_approved']);
    else if(ticketFilter==='approved')q=q.in('status',['approved','closure_requested']);
    else if(ticketFilter==='closed')q=q.in('status',['closed','rejected','cancelled']);
    else if(ticketFilter==='awaiting')q=q.in('status',ticketAwaitingStatuses());
    const{data,error}=await q;
    if(error)throw error;
    if(!data||data.length===0){el.innerHTML='<div class="card" style="text-align:center;color:var(--gray)">No tickets found</div>';return;}
    el.innerHTML=data.map(t=>`
      <div class="history-card" style="cursor:pointer" onclick="viewTicket('${t.id}')">
        <div class="flex-between">
          <div style="min-width:0">
            <div class="history-site">${esc(ticketNo(t))} · ${esc(t.title)}</div>
            <div class="history-date">${esc(t.site_name)} · ${esc(t.category)} · ${esc(t.raised_by_name||'')} · ${ticketAge(t)}</div>
          </div>
          ${ticketStatusBadge(t.status)}
        </div>
        <div class="history-stats" style="flex-wrap:wrap">
          ${ticketPriorityBadge(t.priority)}
          ${t.estimated_cost!=null?`<span class="badge badge-gray">Est ${money(t.estimated_cost)}</span>`:''}
          ${t.approved_amount!=null?`<span class="badge badge-green">Appr ${money(t.approved_amount)}</span>`:''}
          ${t.target_date?`<span class="badge badge-gray">Due ${esc(ticketDate(t.target_date))}</span>`:''}
        </div>
      </div>`).join('');
  }catch(e){el.innerHTML='<div class="error-box">Failed to load tickets</div>';}
}

// ── Raise / edit ─────────────────────────────────────────────────────────────
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
      <button class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancel</button>
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
    ticketPhotoFiles={};_editingTicketId=null;
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
  navTo('tickets/'+id);   // keep the ticket shareable / refresh-safe
}

function buildTicketDetail(t,comments){
  const row=(l,v)=>`<div class="summary-row"><span class="summary-label">${l}</span><span class="summary-value">${v}</span></div>`;
  const head=s=>`<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin:10px 0 4px">${s}</div>`;
  const photos=t.image_urls?Object.values(t.image_urls):[];
  return `
    <div class="modal-header">
      <div class="modal-title">${esc(ticketNo(t))} ${ticketStatusBadge(t.status)}</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div style="font-size:13px;font-weight:600;margin-bottom:2px">${esc(t.title)}</div>
    <div style="font-size:10px;color:var(--gray);margin-bottom:8px">${esc(t.site_name)} · raised by ${esc(t.raised_by_name||'—')} · ${ticketAge(t)}</div>
    ${head('Details')}
    ${row('Category',esc(t.category))}
    ${row('Priority',ticketPriorityBadge(t.priority))}
    ${row('Target date',esc(t.target_date?ticketDate(t.target_date):'—'))}
    ${row('Estimated cost',esc(money(t.estimated_cost)))}
    ${t.approved_amount!=null?row('Approved amount',esc(money(t.approved_amount))):''}
    ${row('Description',esc(t.description||'—'))}
    ${photos.length>0?`${head('Photos')}<div style="display:flex;gap:6px;flex-wrap:wrap">${photos.map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" style="width:72px;height:72px;object-fit:cover;border-radius:7px;border:1px solid var(--border)"></a>`).join('')}</div>`:''}
    ${head('Approval trail')}
    ${row('Manager (L1)',t.l1_status==='pending'||!t.l1_status?'<span style="color:var(--gray)">Pending</span>':`${esc(t.l1_status)} · ${esc(t.l1_by_name||'')} <span style="color:var(--gray)">${esc(ticketStamp(t.l1_at))}</span>`)}
    ${t.l1_remark?row('L1 remark',esc(t.l1_remark)):''}
    ${row('Admin (L2)',ticketNeedsL2(t)?(t.l2_status==='pending'||!t.l2_status?'<span style="color:var(--gray)">Pending</span>':`${esc(t.l2_status)} · ${esc(t.l2_by_name||'')} <span style="color:var(--gray)">${esc(ticketStamp(t.l2_at))}</span>`):`<span style="color:var(--gray)">Not required (under ${esc(money(ticketThreshold()))})</span>`)}
    ${t.l2_remark?row('L2 remark',esc(t.l2_remark)):''}
    ${t.closure_requested_at?row('Closure requested',`${esc(t.closure_requested_by_name||'')} <span style="color:var(--gray)">${esc(ticketStamp(t.closure_requested_at))}</span>`):''}
    ${t.closure_note?row('Closure note',esc(t.closure_note)):''}
    ${t.closed_at?row('Closed',`${esc(t.closed_by_name||'')} <span style="color:var(--gray)">${esc(ticketStamp(t.closed_at))}</span>`):''}
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
    ${buildTicketActions(t)}`;
}

function buildTicketActions(t){
  const r=session.role, isRaiser=t.raised_by_phone===session.phone, approver=isTicketApprover();
  const btns=[];
  const red='background:var(--red-light);color:var(--red);border:1px solid var(--red-border)';
  if(t.status==='open'&&(isRaiser||isAdminUp()))
    btns.push(`<button class="btn btn-secondary" style="flex:1;padding:9px;font-size:11px" onclick="openTicketModal('${t.id}')">Edit</button>`);
  if(t.status==='open'&&isRaiser)
    btns.push(`<button class="btn" style="flex:1;padding:9px;font-size:11px;${red}" onclick="cancelTicket('${t.id}')">Cancel</button>`);
  if((t.status==='open'||t.status==='l1_approved')&&approver){
    const label=t.status==='l1_approved'?'Approve (final)':(ticketNeedsL2(t)&&!isAdminUp()?'Approve (L1)':'Approve');
    if(!(t.status==='l1_approved'&&!isAdminUp()))
      btns.push(`<button class="btn btn-primary" style="flex:1;padding:9px;font-size:11px" onclick="approveTicket('${t.id}')">${label}</button>`);
    btns.push(`<button class="btn" style="flex:1;padding:9px;font-size:11px;${red}" onclick="rejectTicket('${t.id}')">Reject</button>`);
  }
  if(t.status==='approved'&&(isRaiser||approver))
    btns.push(`<button class="btn btn-primary" style="flex:1;padding:9px;font-size:11px" onclick="openClosureModal('${t.id}')">Request closure</button>`);
  if(t.status==='closure_requested'&&approver){
    btns.push(`<button class="btn btn-primary" style="flex:1;padding:9px;font-size:11px" onclick="confirmTicketClosure('${t.id}')">Confirm closure</button>`);
    btns.push(`<button class="btn btn-secondary" style="flex:1;padding:9px;font-size:11px" onclick="reopenTicket('${t.id}')">Reopen</button>`);
  }
  if(t.status==='l1_approved'&&!isAdminUp())
    btns.push(`<div style="flex:1;font-size:10px;color:var(--gray);text-align:center;padding:9px">Waiting on admin — above ${esc(money(ticketThreshold()))}</div>`);
  if(btns.length===0)return '';
  return `<div style="display:flex;gap:6px;margin-top:14px;flex-wrap:wrap">${btns.join('')}</div>`;
}

// ── Mutations ────────────────────────────────────────────────────────────────
async function afterTicketChange(id){
  if(currentTab==='tickets')loadTickets();
  await viewTicket(id);
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

// Closure request carries a note plus optional proof photos
function openClosureModal(id){
  ticketPhotoFiles={};
  _closureTicketId=id;
  const content=document.getElementById('modalContent');
  content.innerHTML=`
    <div class="modal-header"><div class="modal-title">Request closure</div><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-field"><label>What was done? *</label><textarea id="mClosureNote" placeholder="Work completed, parts used, bill reference"></textarea></div>
    <div class="modal-field"><label>Proof photos / bill</label>
      <div class="photo-grid" id="ticketPhotoGrid">${buildTicketPhotoGrid()}</div>
      <div class="text-hint" style="margin-top:3px">Max 5MB each</div>
    </div>
    <div id="ticketFormError" class="error-box hidden"></div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-secondary" style="flex:1" onclick="viewTicket('${id}')">Back</button>
      <button class="btn btn-primary" style="flex:1" id="closureSaveBtn" onclick="submitTicketClosure()">Submit</button>
    </div>`;
  document.getElementById('modalOverlay').classList.remove('hidden');
}

async function submitTicketClosure(){
  const id=_closureTicketId;
  const btn=document.getElementById('closureSaveBtn');
  const errEl=document.getElementById('ticketFormError');
  const note=document.getElementById('mClosureNote').value.trim();
  if(!note){errEl.textContent='Describe what was done';errEl.classList.remove('hidden');return;}
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
      closure_requested_at:new Date().toISOString(),
      closure_requested_by_name:session.name,
      image_urls:Object.keys(images).length>0?images:null
    }).eq('id',id);
    if(error)throw error;
    ticketPhotoFiles={};_closureTicketId=null;
    await afterTicketChange(id);
  }catch(e){
    btn.disabled=false;btn.textContent='Submit';
    errEl.textContent='Failed: '+e.message;errEl.classList.remove('hidden');
  }
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
  await sb.from('dgr_ticket_comments').insert({
    ticket_id:id,author_phone:session.phone,author_name:session.name,author_role:session.role,
    comment:'Reopened: '+note.trim()
  });
  await afterTicketChange(id);
}

async function addTicketComment(id){
  const inp=document.getElementById('ticketCommentInput');
  const text=inp?inp.value.trim():'';
  if(!text)return;
  const{error}=await sb.from('dgr_ticket_comments').insert({
    ticket_id:id,author_phone:session.phone,author_name:session.name,author_role:session.role,comment:text
  });
  if(error){alert('Comment failed: '+error.message);return;}
  await viewTicket(id);
}
