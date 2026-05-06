let historyFilters={site:'',date:''};
function showHistory(){
  const el=document.getElementById('screenHistory');
  el.classList.remove('hidden');
  // Build available site list for dropdown
  let siteOptions='<option value="">All sites</option>';
  const siteList=session.role==='engineer'
    ?(session.assigned_sites||[])
    :sites.map(s=>s.site_name);
  siteList.forEach(s=>{siteOptions+=`<option value="${s}"${historyFilters.site===s?' selected':''}>${s}</option>`;});
  el.innerHTML=`
    <div class="card-title">Submission History</div>
    <div class="card" style="padding:10px;margin-bottom:8px">
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <div style="flex:1">
          <label style="font-size:10px;color:var(--gray);display:block;margin-bottom:2px">Site</label>
          <select id="histSiteFilter" style="width:100%;padding:7px 6px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:#fff" onchange="historyFilters.site=this.value">
            ${siteOptions}
          </select>
        </div>
        <div style="flex:1">
          <label style="font-size:10px;color:var(--gray);display:block;margin-bottom:2px">Date</label>
          <input type="date" id="histDateFilter" value="${historyFilters.date}" style="width:100%;padding:6px;font-size:12px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box" onchange="historyFilters.date=this.value">
        </div>
      </div>
      <button class="btn btn-primary" style="width:100%;padding:8px;font-size:12px" onclick="loadHistory()">Search</button>
    </div>
    ${(session.role==='manager'||session.role==='admin')?buildDownloadPanel():''}
    <div id="historyResults"><div style="text-align:center;color:var(--gray);padding:20px">Press Search to load results</div></div>`;
  loadHistory();
}
async function loadHistory(){
  const el=document.getElementById('historyResults');
  if(!el)return;
  el.innerHTML='<div style="text-align:center;color:var(--gray);padding:20px">Loading...</div>';
  try{
    let query=sb.from('dgr_submissions').select('*').order('report_date',{ascending:false}).limit(100);
    if(session.role==='engineer')query=query.eq('submitted_by_phone',session.phone);
    if(historyFilters.site)query=query.eq('site_name',historyFilters.site);
    if(historyFilters.date)query=query.eq('report_date',historyFilters.date);
    const{data}=await query;
    if(!data||data.length===0){el.innerHTML='<div class="card" style="text-align:center;color:var(--gray)">No submissions found</div>';return;}
    el.innerHTML=data.map(d=>{
      const dateStr=new Date(d.report_date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
      const isReturned=d.status==='pending'&&!!(d.review_note&&String(d.review_note).trim());
      const statusLabel=isReturned?'returned':d.status;
      const statusCls=d.status==='approved'?'badge-green':d.status==='rejected'?'badge-red':'badge-yellow';
      return `<div class="history-card">
        <div class="flex-between">
          <div><div class="history-site">${d.site_name}</div><div class="history-date">${dateStr} · ${d.submitted_by_name||''}</div></div>
          <span class="badge ${statusCls}">${statusLabel}</span>
        </div>
        <div class="history-stats">
          <span class="badge badge-gray">${d.total_gen_kwh||0} kWh</span>
          <span class="badge badge-gray">PR ${d.pr_pct||0}%</span>
          ${d.grid_outage?'<span class="badge badge-yellow">Grid outage</span>':''}
        </div>
        ${isReturned?`<div style="background:var(--red-light);border:1px solid var(--red-border);border-left:3px solid var(--red);border-radius:0 8px 8px 0;padding:8px 11px;margin-top:8px;font-size:11px;color:var(--red);font-weight:600">Rejected by ${escHtml(d.reviewed_by||'admin')}: ${escHtml(String(d.review_note||''))}</div>`:''}
        <div style="margin-top:6px">
          <button class="btn btn-secondary" style="width:100%;padding:6px;font-size:10px" onclick="viewSubmission('${d.id}')">View full summary</button>
          ${isReturned?`<button class="btn btn-primary" style="width:100%;padding:7px;font-size:11px;margin-top:6px" onclick="editSubmission('${d.id}')">Edit & Resubmit</button>`:''}
        </div>
      </div>`;
    }).join('');
  }catch(e){el.innerHTML='<div class="error-box">Failed to load history</div>';}
}

// APPROVALS
let approvalFilter='pending';
async function showApprovals(){
  const el=document.getElementById('screenApprovals');
  el.classList.remove('hidden');
  await renderApprovals(el,false);
}
async function renderApprovals(el,inAdmin){
  el.innerHTML='<div style="text-align:center;color:var(--gray);padding:20px">Loading...</div>';
  try{
    let query=sb.from('dgr_submissions').select('*').order('created_at',{ascending:false}).limit(100);
    if(approvalFilter!=='all')query=query.eq('status',approvalFilter);
    const{data}=await query;
    const filters=['all','pending','approved','rejected'];
    const refresh=inAdmin?'showApprovalInAdmin':'showApprovals';
    el.innerHTML=`${!inAdmin?'<div class="card-title">Approvals</div>':''}
      <div class="filter-pills">
        ${filters.map(f=>`<div class="filter-pill${f===approvalFilter?' active':''}" onclick="approvalFilter='${f}';${refresh}()">${f.charAt(0).toUpperCase()+f.slice(1)}</div>`).join('')}
      </div>
      ${(!data||data.length===0)?'<div class="card" style="text-align:center;color:var(--gray)">No submissions</div>':
        data.map(d=>{
          const dateStr=new Date(d.report_date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
          const flags=[];
          if((d.wti_c||0)>85||(d.oti_c||0)>85)flags.push('<span class="badge badge-red">High temp</span>');
          if((d.pr_pct||0)<70&&(d.pr_pct||0)>0)flags.push('<span class="badge badge-yellow">Low PR</span>');
          const isReturned=d.status==='pending'&&!!(d.review_note&&String(d.review_note).trim());
          const statusLabel=isReturned?'returned':d.status;
          const approveF=inAdmin?'approveAndRefreshAdmin':'approveSubmission';
          const rejectF=inAdmin?'rejectAndRefreshAdmin':'rejectSubmission';
          return `<div class="approval-card">
            <div class="approval-header">
              <div><div class="approval-site">${d.site_name}</div><div class="approval-meta">${dateStr} · ${d.submitted_by_name||''}</div></div>
              <span class="badge ${d.status==='approved'?'badge-green':d.status==='rejected'?'badge-red':'badge-yellow'}">${statusLabel}</span>
            </div>
            <div class="approval-stats">
              <span class="approval-stat">${d.total_gen_kwh||0} kWh</span>
              <span class="approval-stat">PR ${d.pr_pct||0}%</span>
              ${flags.join('')}
            </div>
            ${isReturned?`<div style="background:var(--red-light);border:1px solid var(--red-border);border-left:3px solid var(--red);border-radius:0 8px 8px 0;padding:8px 11px;margin:6px 0;font-size:11px;color:var(--red);font-weight:600">Rejected by ${escHtml(d.reviewed_by||'admin')}: ${escHtml(String(d.review_note||''))}</div>`:''}
            <div class="approval-actions">
              <button class="btn btn-secondary" style="flex:1;padding:8px;font-size:11px" onclick="viewSubmission('${d.id}')">View</button>
              ${d.status==='pending'?`
              <button class="btn btn-primary" style="flex:1;padding:8px;font-size:11px" onclick="${approveF}('${d.id}')">Approve</button>
              <button class="btn" style="flex:1;padding:8px;font-size:11px;background:var(--red-light);color:var(--red);border:1px solid var(--red-border)" onclick="${rejectF}('${d.id}')">Reject</button>`:''}
            </div>
          </div>`;
        }).join('')}`;
  }catch(e){el.innerHTML='<div class="error-box">Failed to load</div>';}
}
async function approveSubmission(id){
  await sb.from('dgr_submissions').update({status:'approved',reviewed_by:session.name,reviewed_at:new Date().toISOString()}).eq('id',id);
  showApprovals();
}
async function rejectSubmission(id){
  showRejectModal(id, async(note)=>{
    await sb.from('dgr_submissions').update({status:'pending',reviewed_by:session.name,review_note:note,reviewed_at:new Date().toISOString()}).eq('id',id);
    showApprovals();
  });
}
async function approveAndRefreshAdmin(id){
  await sb.from('dgr_submissions').update({status:'approved',reviewed_by:session.name,reviewed_at:new Date().toISOString()}).eq('id',id);
  showApprovalInAdmin();
}
async function rejectAndRefreshAdmin(id){
  showRejectModal(id, async(note)=>{
    await sb.from('dgr_submissions').update({status:'pending',reviewed_by:session.name,review_note:note,reviewed_at:new Date().toISOString()}).eq('id',id);
    showApprovalInAdmin();
  });
}

function showRejectModal(id, onConfirm){
  window._rejectCallback = onConfirm;
  const existing=document.getElementById('rejectReasonModal');
  if(existing)existing.remove();
  const overlay=document.createElement('div');
  overlay.id='rejectReasonModal';
  overlay.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:300;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(2px)';
  overlay.innerHTML=`
    <div style="background:#fff;border-radius:16px 16px 0 0;padding:22px;width:100%;max-width:420px;box-shadow:0 -4px 32px rgba(0,0,0,.15)" onclick="event.stopPropagation()">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div style="width:34px;height:34px;border-radius:50%;background:var(--red-light);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <span style="font-size:16px;color:var(--red)">✕</span>
        </div>
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--red);font-family:'Space Grotesk',sans-serif">Reject Submission</div>
          <div style="font-size:11px;color:var(--gray);margin-top:1px">This will be sent back to the engineer</div>
        </div>
      </div>
      <div style="background:var(--red-light);border:1px solid var(--red-border);border-left:3px solid var(--red);border-radius:8px;padding:9px 12px;margin:14px 0 12px;font-size:11px;color:var(--red);font-weight:500">
        The engineer will see your reason in red and can edit &amp; resubmit.
      </div>
      <label style="font-size:11px;color:var(--gray);font-weight:600;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em">Rejection Reason *</label>
      <textarea id="rejectNoteInput" placeholder="Explain why this report is being rejected…"
        style="width:100%;padding:10px 12px;border:1.5px solid var(--red-border);border-radius:8px;font-size:13px;font-family:inherit;min-height:90px;resize:vertical;outline:none;background:#fff5f5;color:var(--text);line-height:1.5"
        oninput="const b=document.getElementById('rejectConfirmBtn');b.disabled=!this.value.trim();b.style.opacity=this.value.trim()?'1':'.5'"
        onfocus="this.style.borderColor='var(--red)';this.style.boxShadow='0 0 0 3px rgba(185,28,28,.12)'"
        onblur="this.style.borderColor='var(--red-border)';this.style.boxShadow='none'"></textarea>
      <div id="rejectNoteError" style="display:none;font-size:11px;color:var(--red);font-weight:600;margin-top:4px">Please enter a rejection reason.</div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-secondary" style="flex:1" onclick="document.getElementById('rejectReasonModal').remove()">Cancel</button>
        <button id="rejectConfirmBtn" disabled
          style="flex:1;padding:11px;border-radius:8px;font-size:12px;font-weight:700;border:none;cursor:pointer;font-family:inherit;background:var(--red);color:#fff;opacity:.5;transition:opacity .15s"
          onclick="handleRejectConfirm(this)">Reject</button>
      </div>
    </div>`;
  overlay.addEventListener('click',()=>overlay.remove());
  document.body.appendChild(overlay);
  setTimeout(()=>{
    const ta=document.getElementById('rejectNoteInput');
    if(ta)ta.focus();
  },50);
}

function handleRejectConfirm(btn){
  const note=document.getElementById('rejectNoteInput').value.trim();
  if(!note){document.getElementById('rejectNoteError').style.display='block';return;}
  btn.textContent='Rejecting…';btn.disabled=true;
  document.getElementById('rejectReasonModal').remove();
  if(window._rejectCallback){window._rejectCallback(note);window._rejectCallback=null;}
}
async function showApprovalInAdmin(){
  const el=document.getElementById('adminContent');
  await renderApprovals(el,true);
}

