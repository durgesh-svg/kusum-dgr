// ─────────────────────────────────────────────────────────────
// OVERVIEW DASHBOARD — Full Implementation
// Compliance + Performance + Charts + Inverter Health
// Admin only
// ─────────────────────────────────────────────────────────────

const CUTOFF_HOUR = 21; // 9 PM cutoff
const OV_PAGE_SIZE = 25;
let ovActiveTab = 'compliance';
let ovAutoRefreshTimer = null;
let _ovSite = ''; // tracks selected site for searchable dropdown
let ovComplianceRows = [];
let ovEngineerRows = [];
let ovPerfRows = [];
let ovCompPage = 1;
let ovEngPage = 1;
let ovPerfPage = 1;
let ovAllRows = [];
let ovSitePerf = {};
let ovCharts = {};

// ── Date helpers ─────────────────────────────────────────────
function fmtLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function getDefaultDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: fmtLocalDate(from), to: fmtLocalDate(to) };
}
function todayLocal() { return fmtLocalDate(new Date()); }

// ── Entry point ───────────────────────────────────────────────
async function showOverview() {
  const el = document.getElementById('screenOverview');
  if (!el) return;
  document.querySelectorAll('#screensWrap > div').forEach(d => d.classList.add('hidden'));
  el.classList.remove('hidden');
  el.innerHTML = `<div style="text-align:center;padding:60px;color:var(--gray)">Loading Overview...</div>`;
  const def = getDefaultDates();
  await renderOverview('', def.from, def.to);
  // Auto-refresh every 5 minutes
  if (ovAutoRefreshTimer) clearInterval(ovAutoRefreshTimer);
  ovAutoRefreshTimer = setInterval(() => {
    if (currentTab === 'overview') applyOvFilters();
  }, 5 * 60 * 1000);
}

async function renderOverview(filterSite = '', filterFrom = '', filterTo = '') {
  const el = document.getElementById('screenOverview');
  if (!el) return;
  const def = getDefaultDates();
  filterFrom = filterFrom || def.from;
  filterTo = filterTo || def.to;

  // Destroy existing charts
  Object.values(ovCharts).forEach(c => { try { c.destroy(); } catch(e){} });
  ovCharts = {};

  // Fetch submissions in range (for charts/tables)
  // Only fetch columns needed for overview — avoids pulling large inv_gen/image_urls JSON
  let query = sb.from('dgr_submissions')
    .select('id,site_name,report_date,created_at,submitted_by_name,status,total_gen_kwh,dc_cuf_pct,ac_cuf_pct,pr_pct,dc_capacity_kw,grid_outage,plant_outage,plant_outage_details,wti_c,oti_c')
    .gte('report_date', filterFrom).lte('report_date', filterTo).order('report_date', { ascending: false });
  if (filterSite) query = query.eq('site_name', filterSite);
  const { data: rows, error } = await query;
  if (error) { el.innerHTML = `<div class="card" style="color:var(--red)">Error: ${error.message}</div>`; return; }

  ovAllRows = rows || [];
  const siteList = [...new Set(sites.map(s => s.site_name))].sort();

  // Process data
  processComplianceData(ovAllRows);
  processEngineerData(ovAllRows);
  processPerfData(ovAllRows);

  // KPI summary
  const total = ovAllRows.length;
  const onTime = ovComplianceRows.filter(r => r.compStatus === 'on-time').length;
  const late = ovComplianceRows.filter(r => r.compStatus !== 'on-time').length;
  const compliancePct = total > 0 ? Math.round((onTime / total) * 100) : 0;
  const totalGen = ovAllRows.reduce((a, r) => a + (+r.total_gen_kwh || 0), 0);
  const avg = arr => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : '—';
  const avgDcCuf = avg(ovAllRows.filter(r => r.dc_cuf_pct > 0).map(r => +r.dc_cuf_pct));
  const avgPr = avg(ovAllRows.filter(r => r.pr_pct > 0).map(r => +r.pr_pct));

  // Missing DGR today — separate query (no date range / site filter)
  const today = todayLocal();
  const { data: todayRows } = await sb.from('dgr_submissions')
    .select('site_name')
    .eq('report_date', today);
  const submittedToday = new Set((todayRows || []).map(r => r.site_name));
  const missingSites = siteList.filter(s => !submittedToday.has(s));

  // Fetch engineers and their assigned sites to show who hasn't submitted
  const { data: engineers } = await sb.from('users')
    .select('name, phone, assigned_sites')
    .eq('role', 'engineer');
  // Map: site → engineer name
  const siteEngineerMap = {};
  (engineers || []).forEach(eng => {
    (eng.assigned_sites || []).forEach(site => {
      siteEngineerMap[site] = eng.name || eng.phone;
    });
  });
  // Group missing sites by engineer
  const missingByEng = {};
  missingSites.forEach(site => {
    const eng = siteEngineerMap[site] || 'Unassigned';
    if (!missingByEng[eng]) missingByEng[eng] = [];
    missingByEng[eng].push(site);
  });

  // Sync selected site global
  _ovSite = filterSite;

  // Build searchable dropdown items
  const siteItems = siteList.map(s =>
    `<div onclick="selectOvSite('${s.replace(/'/g,"\\'")}');" style="padding:7px 10px;font-size:11px;cursor:pointer;border-bottom:1px solid var(--border)${s===filterSite?';background:var(--primary-light,#fef9ec);font-weight:700':''}" onmouseover="this.style.background='var(--bg,#f8fafc)'" onmouseout="this.style.background='${s===filterSite?'var(--primary-light,#fef9ec)':''}'">${escHtml(s)}</div>`
  ).join('');

  el.innerHTML = `
    <div style="padding-bottom:80px">

      <!-- Header + Filter inline -->
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <div style="flex:1;min-width:140px">
          <div style="font-size:14px;font-weight:800;color:var(--text)">📊 Overview</div>
          <div style="font-size:9px;color:var(--text-muted)">${filterFrom} → ${filterTo}</div>
        </div>
        <div style="flex:2;min-width:110px;position:relative">
          <input id="ovSiteInput" type="text" value="${escHtml(filterSite)}" placeholder="All Sites" autocomplete="off"
            onclick="showSiteDd()" oninput="filterSiteDd(this.value)" onblur="setTimeout(hideSiteDd,200)"
            style="width:100%;padding:5px 22px 5px 8px;font-size:11px;border:1.5px solid var(--border);border-radius:7px;box-sizing:border-box;font-family:inherit">
          <span style="position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:9px;color:var(--gray);pointer-events:none">▼</span>
          <div id="ovSiteDd" style="display:none;position:absolute;top:calc(100% + 2px);left:0;right:0;min-width:180px;background:#fff;border:1.5px solid var(--border);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.13);z-index:300;max-height:240px;overflow-y:auto">
            <div onclick="selectOvSite('');" style="padding:8px 10px;font-size:11px;font-weight:700;cursor:pointer;border-bottom:1.5px solid var(--border);color:var(--primary)">All Sites</div>
            ${siteItems}
          </div>
        </div>
        <input type="date" id="ovFrom" value="${filterFrom}" onchange="applyOvFilters()" style="flex:1;min-width:90px;padding:5px 6px;font-size:11px;border:1.5px solid var(--border);border-radius:7px">
        <input type="date" id="ovTo" value="${filterTo}" onchange="applyOvFilters()" style="flex:1;min-width:90px;padding:5px 6px;font-size:11px;border:1.5px solid var(--border);border-radius:7px">
        <button onclick="applyOvFilters()" style="padding:5px 10px;font-size:12px;border:1.5px solid var(--border);border-radius:7px;background:#fff;cursor:pointer">🔄</button>
      </div>

      <!-- Missing DGR Alert -->
      ${missingSites.length > 0 ? `
      <div style="margin-bottom:8px;border-radius:10px;overflow:hidden;border:1.5px solid var(--red-border)">
        <div style="background:var(--red);padding:6px 12px;display:flex;align-items:center;justify-content:space-between">
          <div style="color:#fff;font-size:12px;font-weight:700">🚨 ${missingSites.length} Sites Pending · ${Object.keys(missingByEng).length} Engineers</div>
          <div style="color:rgba(255,255,255,.8);font-size:10px">${today}</div>
        </div>
        <div style="background:var(--red-light);max-height:120px;overflow-y:auto;-webkit-overflow-scrolling:touch">
          ${Object.entries(missingByEng).map(([eng, engSites]) => `
            <div style="display:flex;align-items:center;gap:8px;padding:4px 10px;border-bottom:1px solid var(--red-border)">
              <div style="width:18px;height:18px;border-radius:50%;background:var(--red);color:#fff;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;flex-shrink:0">${eng.charAt(0).toUpperCase()}</div>
              <div style="font-size:11px;font-weight:700;color:var(--text);min-width:100px;flex-shrink:0">${eng}</div>
              <div style="display:flex;flex-wrap:wrap;gap:3px;flex:1">
                ${engSites.map(s => `<span style="background:#fff;color:var(--red);font-size:9px;font-weight:600;padding:1px 6px;border-radius:20px;border:1px solid var(--red-border)">${s}</span>`).join('')}
              </div>
            </div>`).join('')}
        </div>
      </div>` : `
      <div style="margin-bottom:8px;border-radius:10px;overflow:hidden;border:1.5px solid var(--green-border)">
        <div style="background:var(--green);padding:6px 12px;display:flex;align-items:center;gap:6px">
          <span>✅</span><div style="color:#fff;font-size:12px;font-weight:700">All Sites Submitted DGR Today</div>
        </div>
      </div>`}

      <!-- KPI Grid — 3 cols with sub-text -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px">
        ${kpiCard2('⚡','Generation',(totalGen/1000).toFixed(1)+' MWh','var(--primary)',totalGen.toLocaleString('en-IN')+' kWh')}
        ${kpiCard2('⏱','On-Time',compliancePct+'%',compliancePct>=80?'var(--green-dark)':compliancePct>=60?'var(--orange)':'var(--red)',onTime+' / '+total+' reports')}
        ${kpiCard2('📊','Avg PR%',avgPr+'%',avgPr!=='—'&&avgPr<75?'var(--red)':'var(--green-dark)',avgPr>=75?'Good':'Below target')}
        ${kpiCard2('☀️','DC CUF%',avgDcCuf+'%','var(--primary)','Capacity utilization')}
        ${kpiCard2('✅','On Time',onTime,'var(--green-dark)',compliancePct+'% compliance')}
        ${kpiCard2('🕐','Late',late,late>0?'var(--red)':'var(--green-dark)',late>0?'Need attention':'All good')}
      </div>

      <!-- Sub Tabs -->
      <div class="ov-sub-tabs">
        <div class="ov-sub-tab ${ovActiveTab === 'compliance' ? 'active' : ''}" data-tab="compliance" onclick="switchOvTab('compliance')">📋 Compliance</div>
        <div class="ov-sub-tab ${ovActiveTab === 'performance' ? 'active' : ''}" data-tab="performance" onclick="switchOvTab('performance')">📊 Performance</div>
      </div>

      <!-- Compliance Panel -->
      <div class="ov-tab-panel ${ovActiveTab !== 'compliance' ? 'hidden' : ''}" data-panel="compliance">

        <!-- Daily Submission Chart -->
        <div class="card" style="margin-bottom:10px">
          <div class="card-title" style="margin-bottom:8px">Daily Submission — On Time vs Late</div>
          <div style="position:relative;height:180px"><canvas id="chartDailyComp"></canvas></div>
        </div>

        <!-- Engineer Summary -->
        <div class="card" style="margin-bottom:10px">
          <div class="card-title" style="margin-bottom:8px">Engineer-wise Summary</div>
          <div style="overflow-x:auto">
            <div style="min-width:500px">
              <div class="ov-eng-row ov-table-header">
                <div>Engineer</div><div>Total</div><div>On Time</div><div>Late</div><div>On-Time %</div><div>Avg Delay</div>
              </div>
              <div id="ovEngBody"></div>
            </div>
          </div>
          <div id="ovEngPagination"></div>
        </div>

        <!-- Compliance Table -->
        <div class="card" style="margin-bottom:10px">
          <div class="card-title" style="margin-bottom:8px">Compliance Records — ${total} reports</div>
          <div style="overflow-x:auto">
            <div style="min-width:640px">
              <div class="ov-table-row ov-table-header">
                <div>Date</div><div>Site</div><div>Engineer</div><div>Submitted At</div><div>Status</div><div>Delay</div><div>Approval</div>
              </div>
              <div id="ovCompBody"></div>
            </div>
          </div>
          <div id="ovCompPagination"></div>
        </div>
      </div>

      <!-- Performance Panel -->
      <div class="ov-tab-panel ${ovActiveTab !== 'performance' ? 'hidden' : ''}" data-panel="performance">

        <!-- Daily Generation Chart — only for single site -->
        ${filterSite ? `
        <div class="card" style="margin-bottom:10px">
          <div class="card-title" style="margin-bottom:8px">Daily Generation Trend (kWh)</div>
          <div style="position:relative;height:200px"><canvas id="chartDailyGen"></canvas></div>
        </div>` : ''}

        <!-- Site Comparison Chart — collapsible -->
        <div class="card" style="margin-bottom:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="toggleSiteChart()">
            <div class="card-title" style="margin-bottom:0">Site Comparison — DC CUF%</div>
            <span id="siteChartToggleIcon" style="font-size:14px;color:var(--gray)">▼</span>
          </div>
          <div id="siteChartWrap" style="margin-top:8px">
            <div style="position:relative;height:${Math.min(28 * Object.keys(ovSitePerf).length + 30, 360)}px"><canvas id="chartSiteComp"></canvas></div>
          </div>
        </div>

        ${filterSite ? `
        <!-- Single site selected: inverter detail shown directly -->
        <div id="ovInvDetail"></div>
        ` : `
        <!-- All sites: collapsible site blocks with search (lazy load on expand) -->
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px">
            <div class="card-title" style="margin-bottom:0">Site-wise Performance — ${Object.keys(ovSitePerf).length} sites</div>
          </div>
          <div style="position:relative;margin-bottom:10px">
            <input id="ovSiteSearch" type="text" placeholder="🔍  Search site..."
              oninput="filterSiteBlocks(this.value)"
              style="width:100%;padding:8px 12px 8px 14px;font-size:12px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;box-sizing:border-box;outline:none"
              onfocus="this.style.borderColor='var(--primary)'" onblur="this.style.borderColor='var(--border)'">
          </div>
          <div id="ovSiteBlocks">${_buildAllSiteBlocks(ovSitePerf)}</div>
          <div id="ovSiteNoResult" style="display:none;text-align:center;color:var(--gray);font-size:12px;padding:16px">No sites found</div>
        </div>
        `}
      </div>
    </div>`;

  // Render paginated tables
  renderCompliancePage(1);
  renderEngineerPage(1);
  // renderPerfPage not needed — replaced by lazy site blocks

  // Build charts after DOM ready
  setTimeout(() => {
    buildDailyCompChart(ovAllRows);
    buildDailyGenChart(ovAllRows, filterSite);
    buildSiteCompChart(ovSitePerf);
    // Single site: auto-show inverter detail directly
    if (filterSite) showInvHealth(filterSite);
  }, 100);
}

// ── KPI Card Helper ───────────────────────────────────────────
function kpiCard(label, value, color) {
  return `<div class="card" style="text-align:center;padding:10px 6px">
    <div style="font-size:9px;color:var(--text-muted);font-weight:600;margin-bottom:4px">${label}</div>
    <div style="font-size:16px;font-weight:800;color:${color};line-height:1">${value}</div>
  </div>`;
}
function kpiCard2(icon, label, value, color, sub) {
  return `<div class="card" style="padding:9px 8px;border-left:3px solid ${color}">
    <div style="font-size:9px;color:var(--text-muted);font-weight:600;margin-bottom:3px">${icon} ${label}</div>
    <div style="font-size:17px;font-weight:800;color:${color};line-height:1.1">${value}</div>
    <div style="font-size:8px;color:var(--text-muted);margin-top:3px">${sub}</div>
  </div>`;
}

// ── Process Compliance Data ───────────────────────────────────
function processComplianceData(rows) {
  ovComplianceRows = rows.map(r => {
    const submittedAt = r.created_at ? new Date(r.created_at) : null;
    const cutoff = new Date(`${r.report_date}T${String(CUTOFF_HOUR).padStart(2,'0')}:00:00`);
    let delayHrs = null, compStatus = 'on-time';
    if (submittedAt) {
      const diff = submittedAt - cutoff;
      if (diff > 0) {
        delayHrs = +(diff / 3600000).toFixed(1);
        compStatus = delayHrs > 12 ? 'very-late' : 'late';
      }
    }
    const timeStr = submittedAt ? submittedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
    return { ...r, submittedAt, delayHrs, compStatus, timeStr, status_approval: r.status };
  });
}

// ── Process Engineer Summary Data ─────────────────────────────
function processEngineerData(rows) {
  const map = {};
  ovComplianceRows.forEach(r => {
    const name = r.submitted_by_name || 'Unknown';
    if (!map[name]) map[name] = { name, total: 0, onTime: 0, late: 0, delays: [] };
    map[name].total++;
    if (r.compStatus === 'on-time') map[name].onTime++;
    else { map[name].late++; if (r.delayHrs) map[name].delays.push(r.delayHrs); }
  });
  ovEngineerRows = Object.values(map).sort((a, b) => b.total - a.total).map(e => ({
    ...e,
    pct: Math.round((e.onTime / e.total) * 100),
    avgDelay: e.delays.length ? +(e.delays.reduce((a, b) => a + b, 0) / e.delays.length).toFixed(1) : null
  }));
}

// ── Process Performance Data ──────────────────────────────────
function processPerfData(rows) {
  ovSitePerf = {};
  const avg = arr => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : '—';
  const max = arr => arr.length ? Math.max(...arr) : '—';
  const min = arr => arr.length ? Math.min(...arr) : '—';
  rows.forEach(r => {
    if (!ovSitePerf[r.site_name]) ovSitePerf[r.site_name] = { gens: [], dcCufs: [], acCufs: [], prs: [], count: 0 };
    const p = ovSitePerf[r.site_name];
    if (r.total_gen_kwh > 0) p.gens.push(+r.total_gen_kwh);
    if (r.dc_cuf_pct > 0) p.dcCufs.push(+r.dc_cuf_pct);
    if (r.ac_cuf_pct > 0) p.acCufs.push(+r.ac_cuf_pct);
    if (r.pr_pct > 0) p.prs.push(+r.pr_pct);
    p.count++;
  });
  ovPerfRows = Object.entries(ovSitePerf).map(([site, p]) => {
    const avgPr = avg(p.prs);
    const prColor = avgPr !== '—' && avgPr < 75 ? 'var(--red)' : 'var(--green-dark)';
    return { site, html: `
      <div class="ov-perf-row" onclick="showInvHealth('${site.replace(/'/g,"\\'")}');" style="cursor:pointer">
        <div style="font-weight:600;color:var(--blue)">${site}</div>
        <div>${p.count}</div>
        <div>${avg(p.gens) !== '—' ? Number(avg(p.gens)).toLocaleString('en-IN') : '—'} kWh</div>
        <div>${avg(p.dcCufs)}%</div>
        <div>${avg(p.acCufs)}%</div>
        <div style="color:${prColor};font-weight:700">${avgPr}%</div>
        <div>${max(p.gens) !== '—' ? Number(max(p.gens)).toLocaleString('en-IN') : '—'}</div>
        <div>${min(p.gens) !== '—' ? Number(min(p.gens)).toLocaleString('en-IN') : '—'}</div>
      </div>` };
  });
}

// ── Pagination Renderers ──────────────────────────────────────
function renderCompliancePage(page) {
  ovCompPage = page;
  const totalPages = Math.ceil(ovComplianceRows.length / OV_PAGE_SIZE);
  const pageRows = ovComplianceRows.slice((page-1)*OV_PAGE_SIZE, page*OV_PAGE_SIZE);
  const body = document.getElementById('ovCompBody');
  const pag = document.getElementById('ovCompPagination');
  if (!body) return;
  body.innerHTML = pageRows.map(r => {
    const badge = r.compStatus === 'on-time'
      ? `<span style="color:var(--green-dark);font-weight:700">✅ On Time</span>`
      : r.compStatus === 'very-late'
      ? `<span style="color:var(--red);font-weight:700">🔴 Very Late</span>`
      : `<span style="color:var(--orange);font-weight:700">⚠️ Late</span>`;
    const delayColor = r.delayHrs > 12 ? 'var(--red)' : r.delayHrs > 0 ? 'var(--orange)' : 'var(--green-dark)';
    const approvalColor = r.status_approval === 'approved' ? 'var(--green-dark)' : r.status_approval === 'rejected' ? 'var(--red)' : 'var(--orange)';
    return `<div class="ov-table-row">
      <div>${r.report_date}</div>
      <div style="font-weight:600">${r.site_name}</div>
      <div>${r.submitted_by_name||'—'}</div>
      <div>${r.timeStr}</div>
      <div>${badge}</div>
      <div style="color:${delayColor};font-weight:600">${r.delayHrs !== null ? '+'+r.delayHrs+' hrs' : '—'}</div>
      <div style="color:${approvalColor};font-weight:600">${r.status_approval==='approved'?'Approved':r.status_approval==='rejected'?'Rejected':'Pending'}</div>
    </div>`;
  }).join('') || `<div style="padding:16px;text-align:center;color:var(--gray);font-size:12px">No data</div>`;
  if (pag) pag.innerHTML = buildPagination(page, totalPages, 'renderCompliancePage');
}

function renderEngineerPage(page) {
  ovEngPage = page;
  const totalPages = Math.ceil(ovEngineerRows.length / OV_PAGE_SIZE);
  const pageRows = ovEngineerRows.slice((page-1)*OV_PAGE_SIZE, page*OV_PAGE_SIZE);
  const body = document.getElementById('ovEngBody');
  const pag = document.getElementById('ovEngPagination');
  if (!body) return;
  body.innerHTML = pageRows.map(e => {
    const pctColor = e.pct >= 80 ? 'var(--green-dark)' : e.pct >= 60 ? 'var(--orange)' : 'var(--red)';
    return `<div class="ov-eng-row">
      <div style="font-weight:600">${e.name}</div>
      <div>${e.total}</div>
      <div style="color:var(--green-dark);font-weight:600">${e.onTime}</div>
      <div style="color:var(--red);font-weight:600">${e.late}</div>
      <div style="color:${pctColor};font-weight:700">${e.pct}%</div>
      <div style="color:var(--orange)">${e.avgDelay ? '+'+e.avgDelay+' hrs' : '—'}</div>
    </div>`;
  }).join('') || `<div style="padding:16px;text-align:center;color:var(--gray);font-size:12px">No data</div>`;
  if (pag) pag.innerHTML = buildPagination(page, totalPages, 'renderEngineerPage');
}

function renderPerfPage(page) {
  ovPerfPage = page;
  const totalPages = Math.ceil(ovPerfRows.length / OV_PAGE_SIZE);
  const pageRows = ovPerfRows.slice((page-1)*OV_PAGE_SIZE, page*OV_PAGE_SIZE);
  const body = document.getElementById('ovPerfBody');
  const pag = document.getElementById('ovPerfPagination');
  if (!body) return;
  body.innerHTML = pageRows.map(r => r.html).join('') || `<div style="padding:16px;text-align:center;color:var(--gray);font-size:12px">No data</div>`;
  if (pag) pag.innerHTML = buildPagination(page, totalPages, 'renderPerfPage');
}

function buildPagination(current, total, fn) {
  if (total <= 1) return '';
  const prev = current > 1 ? `<button class="ov-page-btn" onclick="${fn}(${current-1})">← Prev</button>` : `<button class="ov-page-btn" disabled>← Prev</button>`;
  const next = current < total ? `<button class="ov-page-btn" onclick="${fn}(${current+1})">Next →</button>` : `<button class="ov-page-btn" disabled>Next →</button>`;
  return `<div class="ov-pagination">${prev}<span class="ov-page-info">Page ${current} of ${total}</span>${next}</div>`;
}

// ── Charts ────────────────────────────────────────────────────
function buildDailyCompChart(rows) {
  const canvas = document.getElementById('chartDailyComp');
  if (!canvas || typeof Chart === 'undefined') return;
  const dateMap = {};
  rows.forEach(r => {
    if (!dateMap[r.report_date]) dateMap[r.report_date] = { onTime: 0, late: 0 };
    const comp = ovComplianceRows.find(c => c.id === r.id);
    if (comp?.compStatus === 'on-time') dateMap[r.report_date].onTime++;
    else dateMap[r.report_date].late++;
  });
  const labels = Object.keys(dateMap).sort();
  ovCharts.dailyComp = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels.map(d => d.slice(5)),
      datasets: [
        { label: 'On Time', data: labels.map(d => dateMap[d].onTime), backgroundColor: 'rgba(22,163,74,.7)', borderRadius: 4 },
        { label: 'Late', data: labels.map(d => dateMap[d].late), backgroundColor: 'rgba(185,28,28,.7)', borderRadius: 4 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { font: { size: 10 } } } }, scales: { x: { stacked: true, ticks: { font: { size: 9 } } }, y: { stacked: true, ticks: { font: { size: 10 }, stepSize: 1 } } } }
  });
}

function buildDailyGenChart(rows, filterSite) {
  const canvas = document.getElementById('chartDailyGen');
  if (!canvas || typeof Chart === 'undefined') return;

  if (filterSite) {
    // ── Single site: dual-axis — kWh bars (left) + DC CUF% line (right) ──
    const dateMap = {};
    rows.forEach(r => {
      if (!dateMap[r.report_date]) dateMap[r.report_date] = { kwh: 0, cuf: 0, cufN: 0 };
      dateMap[r.report_date].kwh += (+r.total_gen_kwh || 0);
      if ((+r.dc_cuf_pct || 0) > 0) { dateMap[r.report_date].cuf += +r.dc_cuf_pct; dateMap[r.report_date].cufN++; }
    });
    const labels = Object.keys(dateMap).sort();
    ovCharts.dailyGen = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels.map(d => d.slice(5)),
        datasets: [
          {
            label: 'kWh', yAxisID: 'yKwh', order: 2,
            data: labels.map(d => +dateMap[d].kwh.toFixed(0)),
            backgroundColor: 'rgba(126,87,0,.65)', borderColor: 'rgba(126,87,0,1)', borderWidth: 1, borderRadius: 4
          },
          {
            label: 'DC CUF%', yAxisID: 'yCuf', order: 1, type: 'line',
            data: labels.map(d => dateMap[d].cufN > 0 ? +(dateMap[d].cuf / dateMap[d].cufN).toFixed(2) : null),
            borderColor: 'rgba(37,99,235,1)', backgroundColor: 'rgba(37,99,235,.08)',
            borderWidth: 2, pointRadius: 3, pointBackgroundColor: 'rgba(37,99,235,1)', tension: 0.3
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', labels: { font: { size: 10 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => ctx.dataset.label === 'DC CUF%' ? ` DC CUF: ${ctx.parsed.y}%` : ` kWh: ${(+ctx.parsed.y).toLocaleString('en-IN')}` } }
        },
        scales: {
          x: { ticks: { font: { size: 9 } } },
          yKwh: { type: 'linear', position: 'left',  ticks: { font: { size: 9 } }, title: { display: true, text: 'kWh', font: { size: 9 } } },
          yCuf: { type: 'linear', position: 'right', ticks: { font: { size: 9 }, callback: v => v + '%' }, title: { display: true, text: 'DC CUF%', font: { size: 9 } }, grid: { drawOnChartArea: false } }
        }
      }
    });
  } else {
    // ── All sites: fleet MWh bars + fleet avg DC CUF% line ────────────────
    const dateMapKwh = {}, dateMapCuf = {};
    rows.forEach(r => {
      if (!dateMapKwh[r.report_date]) dateMapKwh[r.report_date] = 0;
      dateMapKwh[r.report_date] += (+r.total_gen_kwh || 0);
      if ((+r.dc_cuf_pct || 0) > 0) {
        if (!dateMapCuf[r.report_date]) dateMapCuf[r.report_date] = { sum: 0, n: 0 };
        dateMapCuf[r.report_date].sum += +r.dc_cuf_pct;
        dateMapCuf[r.report_date].n++;
      }
    });
    const labels = Object.keys(dateMapKwh).sort();
    ovCharts.dailyGen = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels.map(d => d.slice(5)),
        datasets: [
          {
            label: 'MWh', yAxisID: 'yKwh', order: 2,
            data: labels.map(d => +(dateMapKwh[d] / 1000).toFixed(1)),
            backgroundColor: 'rgba(126,87,0,.65)', borderColor: 'rgba(126,87,0,1)', borderWidth: 1, borderRadius: 4
          },
          {
            label: 'Avg DC CUF%', yAxisID: 'yCuf', order: 1, type: 'line',
            data: labels.map(d => dateMapCuf[d]?.n > 0 ? +(dateMapCuf[d].sum / dateMapCuf[d].n).toFixed(2) : null),
            borderColor: 'rgba(37,99,235,1)', backgroundColor: 'rgba(37,99,235,.08)',
            borderWidth: 2, pointRadius: 3, pointBackgroundColor: 'rgba(37,99,235,1)', tension: 0.3
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', labels: { font: { size: 10 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => ctx.dataset.label === 'Avg DC CUF%' ? ` Avg DC CUF: ${ctx.parsed.y}%` : ` MWh: ${ctx.parsed.y}` } }
        },
        scales: {
          x: { ticks: { font: { size: 9 } } },
          yKwh: { type: 'linear', position: 'left',  ticks: { font: { size: 9 } }, title: { display: true, text: 'MWh', font: { size: 9 } } },
          yCuf: { type: 'linear', position: 'right', ticks: { font: { size: 9 }, callback: v => v + '%' }, title: { display: true, text: 'DC CUF%', font: { size: 9 } }, grid: { drawOnChartArea: false } }
        }
      }
    });
  }
}

function buildSiteCompChart(sitePerf) {
  const canvas = document.getElementById('chartSiteComp');
  if (!canvas || typeof Chart === 'undefined') return;
  const avg = arr => arr.filter(v => v > 0).length ? +(arr.filter(v => v > 0).reduce((a, b) => a + b, 0) / arr.filter(v => v > 0).length).toFixed(2) : 0;
  const entries = Object.entries(sitePerf).map(([site, p]) => ({ site, val: avg(p.dcCufs || []) })).sort((a, b) => b.val - a.val);
  if (ovCharts.siteComp) { ovCharts.siteComp.destroy(); }
  ovCharts.siteComp = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: entries.map(e => e.site),
      datasets: [{ label: 'DC CUF%', data: entries.map(e => e.val), backgroundColor: entries.map(e => e.val >= 20 ? 'rgba(22,163,74,.7)' : e.val >= 12 ? 'rgba(234,88,12,.7)' : 'rgba(185,28,28,.7)'), borderRadius: 4 }]
    },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` DC CUF%: ${ctx.parsed.x}%` } } }, scales: { x: { min: 0, ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 9 } } } } }
  });
}

function toggleSiteChart() {
  const wrap = document.getElementById('siteChartWrap');
  const icon = document.getElementById('siteChartToggleIcon');
  if (!wrap) return;
  const hidden = wrap.style.display === 'none';
  wrap.style.display = hidden ? 'block' : 'none';
  if (icon) icon.textContent = hidden ? '▼' : '▶';
  if (hidden && !ovCharts.siteComp) buildSiteCompChart(ovSitePerf);
}

// ── Inverter Health Drill-down (per-date collapsible) ─────────
let _invDetailData = null; // stored for Excel export

async function showInvHealth(siteName) {
  const el = document.getElementById('ovInvDetail');
  if (!el) return;

  // Detect if called inline (single site pre-selected) vs click-to-view
  const isSingleSite = !!(document.getElementById('ovSite')?.value);

  el.classList.remove('hidden');
  el.innerHTML = `<div class="card" style="padding:16px;text-align:center;color:var(--gray)">Loading inverter data…</div>`;
  if (!isSingleSite) el.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Use current filter date range from the UI
  const filterFrom = document.getElementById('ovFrom')?.value || '';
  const filterTo   = document.getElementById('ovTo')?.value   || '';

  const { data: rows } = await sb.from('dgr_submissions')
    .select('report_date,inv_gen,inv_strings_count,total_gen_kwh,dc_cuf_pct,dc_capacity_kw')
    .eq('site_name', siteName)
    .gte('report_date', filterFrom)
    .lte('report_date', filterTo)
    .order('report_date', { ascending: false });

  if (!rows || !rows.length) {
    el.innerHTML = `<div class="card" style="padding:16px;text-align:center;color:var(--gray)">No data for <strong>${escHtml(siteName)}</strong> in selected range</div>`;
    return;
  }

  // Store for Excel export
  _invDetailData = { siteName, filterFrom, filterTo, rows };

  const blocksHtml = _buildDateBlocks(rows, siteName);

  el.innerHTML = `
    <div class="card" style="border-left:4px solid var(--blue)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div>
          <div class="card-title" style="margin-bottom:2px">🏭 ${escHtml(siteName)}</div>
          <div style="font-size:10px;color:var(--gray)">${filterFrom} → ${filterTo} · ${rows.length} day${rows.length !== 1 ? 's' : ''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button onclick="downloadInvExcel()" style="padding:6px 12px;font-size:11px;font-weight:600;background:#f0fdf4;color:#16a34a;border:1.5px solid #bbf7d0;border-radius:7px;cursor:pointer;font-family:inherit">⬇ Excel</button>
          ${!isSingleSite ? `<button onclick="document.getElementById('ovInvDetail').classList.add('hidden')" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--gray);padding:4px">✕</button>` : ''}
        </div>
      </div>
      ${blocksHtml}
    </div>`;
}

function toggleInvBlock(id) {
  const el   = document.getElementById(id);
  const icon = document.getElementById(id + '_icon');
  if (!el) return;
  const isHidden = el.style.display === 'none';
  el.style.display = isHidden ? 'block' : 'none';
  if (icon) icon.textContent = isHidden ? '▼' : '▶';
}

// ── Shared: build per-date collapsible blocks HTML ────────────
function _buildDateBlocks(rows, siteName, idPrefix) {
  const siteCfg = sites.find(s => s.site_name === siteName);
  const safeId  = idPrefix || siteName.replace(/[^a-zA-Z0-9]/g, '_');
  return rows.map((r, idx) => {
    const inv   = r.inv_gen           || [];
    const strs  = r.inv_strings_count || [];
    const dcTot = +(r.dc_capacity_kw  || siteCfg?.dc_capacity_kw || 0);
    const n     = inv.length || 1;
    const metrics = inv.map((kwh, i) => {
      const sc  = parseFloat(strs[i]) || 0;
      const dc  = sc > 0 ? +(sc * 15.4).toFixed(1) : +(dcTot / n).toFixed(1);
      const cuf = dc > 0 ? +((+kwh / (dc * 24)) * 100).toFixed(2) : 0;
      return { kwh: +kwh || 0, sc, dc, cuf };
    });
    const bestCuf   = metrics.length ? Math.max(...metrics.map(m => m.cuf).filter(c => c > 0)) : 0;
    const totalKwh  = +(r.total_gen_kwh || inv.reduce((a, v) => a + (+v || 0), 0));
    const dcCuf     = r.dc_cuf_pct || 0;
    const dateLabel = new Date(r.report_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const blockId   = `invBlock_${safeId}_${idx}`;
    const expanded  = idx === 0;
    const invRows = metrics.map((m, i) => {
      const loss      = bestCuf > 0 && m.cuf > 0 ? +((bestCuf - m.cuf) / bestCuf * 100).toFixed(2) : 0;
      const icon      = m.kwh === 0 ? '🔴' : loss > 15 ? '🔴' : loss > 4 ? '⚠️' : '✅';
      const lossColor = loss > 15 ? 'var(--red)' : loss > 4 ? 'var(--orange)' : 'var(--green-dark)';
      return `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;font-size:11px;padding:5px 0;border-bottom:1px solid var(--border)">
        <span>${icon}</span>
        <span style="color:var(--blue);font-weight:700;min-width:38px">Inv ${i + 1}</span>
        <span style="font-weight:600">${m.kwh.toLocaleString('en-IN')} kWh</span>
        <span style="color:var(--border)">|</span><span>Str: <strong>${m.sc}</strong></span>
        <span style="color:var(--border)">|</span><span>DC: <strong>${m.dc} kW</strong></span>
        <span style="color:var(--border)">|</span><span>CUF: <strong>${m.cuf}%</strong></span>
        <span style="color:var(--border)">|</span><span style="color:${lossColor};font-weight:700">Loss: ${loss}%</span>
      </div>`;
    }).join('');
    return `
      <div style="border:1.5px solid var(--border);border-radius:10px;margin-bottom:6px;overflow:hidden">
        <div onclick="toggleInvBlock('${blockId}')" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#f8fafc;cursor:pointer;user-select:none">
          <div style="display:flex;align-items:center;gap:8px">
            <span id="${blockId}_icon" style="font-size:11px;color:var(--gray)">${expanded ? '▼' : '▶'}</span>
            <div style="font-size:12px;font-weight:700;color:var(--text)">📅 ${dateLabel}</div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;font-size:11px">
            <span style="font-weight:700;color:var(--primary)">${totalKwh.toLocaleString('en-IN')} kWh</span>
            <span style="color:var(--gray)">DC CUF: <strong style="color:var(--text)">${dcCuf}%</strong></span>
          </div>
        </div>
        <div id="${blockId}" style="padding:6px 12px 10px;display:${expanded ? 'block' : 'none'}">${invRows}</div>
      </div>`;
  }).join('');
}

// ── All-sites lazy blocks: one collapsed card per site ────────
function _buildAllSiteBlocks(sitePerf) {
  const avg = arr => arr.filter(v => v > 0).length ? +(arr.filter(v => v > 0).reduce((a, b) => a + b, 0) / arr.filter(v => v > 0).length).toFixed(2) : 0;
  const sum = arr => arr.reduce((a, b) => a + b, 0);
  return Object.entries(sitePerf)
    .sort((a, b) => sum(b[1].gens) - sum(a[1].gens))
    .map(([site, p]) => {
      const totalKwh = +sum(p.gens).toFixed(0);
      const avgCuf   = avg(p.dcCufs);
      const safeId   = 'site_' + site.replace(/[^a-zA-Z0-9]/g, '_');
      return `
        <div style="border:1.5px solid var(--border);border-radius:10px;margin-bottom:8px;overflow:hidden">
          <div onclick="expandSiteBlock('${site.replace(/'/g,"\\'")}','${safeId}')"
               style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:#f8fafc;cursor:pointer;user-select:none">
            <div style="display:flex;align-items:center;gap:8px">
              <span id="${safeId}_icon" style="font-size:11px;color:var(--gray)">▶</span>
              <div style="font-size:12px;font-weight:700;color:var(--blue)">${escHtml(site)}</div>
            </div>
            <div style="display:flex;gap:10px;align-items:center;font-size:11px">
              <span style="font-weight:700;color:var(--primary)">${totalKwh.toLocaleString('en-IN')} kWh</span>
              <span style="color:var(--gray)">DC CUF: <strong style="color:var(--text)">${avgCuf}%</strong></span>
            </div>
          </div>
          <div id="${safeId}" style="display:none;padding:6px 12px 10px"></div>
        </div>`;
    }).join('');
}

function filterSiteBlocks(query) {
  const q = (query || '').toLowerCase().trim();
  const blocks = document.querySelectorAll('#ovSiteBlocks > div');
  let visible = 0;
  blocks.forEach(b => {
    const name = b.querySelector('[style*="color:var(--blue)"]')?.innerText?.toLowerCase() || '';
    const show = !q || name.includes(q);
    b.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  const noResult = document.getElementById('ovSiteNoResult');
  if (noResult) noResult.style.display = visible === 0 ? 'block' : 'none';
}

async function expandSiteBlock(siteName, blockId) {
  const el   = document.getElementById(blockId);
  const icon = document.getElementById(blockId + '_icon');
  if (!el) return;
  const isOpen = el.style.display !== 'none';
  // Toggle collapse
  if (isOpen) { el.style.display = 'none'; if (icon) icon.textContent = '▶'; return; }
  el.style.display = 'block';
  if (icon) icon.textContent = '▼';
  // Already loaded — no re-fetch
  if (el.dataset.loaded) return;
  el.innerHTML = '<div style="text-align:center;color:var(--gray);font-size:11px;padding:10px">Loading…</div>';
  const filterFrom = document.getElementById('ovFrom')?.value || '';
  const filterTo   = document.getElementById('ovTo')?.value   || '';
  const { data: rows } = await sb.from('dgr_submissions')
    .select('report_date,inv_gen,inv_strings_count,total_gen_kwh,dc_cuf_pct,dc_capacity_kw')
    .eq('site_name', siteName)
    .gte('report_date', filterFrom)
    .lte('report_date', filterTo)
    .order('report_date', { ascending: false });
  if (!rows || !rows.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--gray);font-size:11px;padding:10px">No data in range</div>';
  } else {
    el.innerHTML = _buildDateBlocks(rows, siteName, blockId);
  }
  el.dataset.loaded = '1';
}

function downloadInvExcel() {
  if (!_invDetailData || typeof XLSX === 'undefined') { showToast('Excel library not ready','error'); return; }
  const { siteName, filterFrom, filterTo, rows } = _invDetailData;
  const siteCfg = sites.find(s => s.site_name === siteName);

  // Header row
  const wsData = [['Date', 'Inverter', 'kWh', 'Strings', 'DC kW', 'CUF%', 'Loss%', 'Status']];

  rows.forEach(r => {
    const inv   = r.inv_gen           || [];
    const strs  = r.inv_strings_count || [];
    const dcTot = +(r.dc_capacity_kw  || siteCfg?.dc_capacity_kw || 0);
    const n     = inv.length || 1;
    const dateLabel = new Date(r.report_date + 'T00:00:00')
      .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    const metrics = inv.map((kwh, i) => {
      const sc  = parseFloat(strs[i]) || 0;
      const dc  = sc > 0 ? +(sc * 15.4).toFixed(1) : +(dcTot / n).toFixed(1);
      const cuf = dc > 0 ? +((+kwh / (dc * 24)) * 100).toFixed(2) : 0;
      return { kwh: +kwh || 0, sc, dc, cuf };
    });
    const bestCuf = metrics.length ? Math.max(...metrics.map(m => m.cuf).filter(c => c > 0)) : 0;

    metrics.forEach((m, i) => {
      const loss   = bestCuf > 0 && m.cuf > 0 ? +((bestCuf - m.cuf) / bestCuf * 100).toFixed(2) : 0;
      const status = m.kwh === 0 ? 'Zero' : loss > 15 ? 'Critical' : loss > 4 ? 'Attention' : 'Normal';
      wsData.push([dateLabel, `Inv ${i + 1}`, m.kwh, m.sc, m.dc, m.cuf, loss, status]);
    });

    // Daily total row
    const totalKwh = +(r.total_gen_kwh || inv.reduce((a, v) => a + (+v || 0), 0));
    wsData.push([dateLabel, 'TOTAL', totalKwh, '', '', r.dc_cuf_pct || 0, '', '']);
    wsData.push([]); // blank separator
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  // Column widths
  ws['!cols'] = [{ wch: 16 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, siteName.slice(0, 31));
  XLSX.writeFile(wb, `${siteName}_inverter_${filterFrom}_to_${filterTo}.xlsx`);
  showToast('Excel downloaded ✓', 'success');
}

// ── Tab Switch ────────────────────────────────────────────────
function switchOvTab(tab) {
  ovActiveTab = tab;
  document.querySelectorAll('.ov-sub-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.ov-tab-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab));
  // Rebuild charts on tab switch if needed
  setTimeout(() => {
    if (tab === 'compliance' && !ovCharts.dailyComp) buildDailyCompChart(ovAllRows);
    if (tab === 'performance') {
      const _fs = document.getElementById('ovSite')?.value || '';
      if (_fs && !ovCharts.dailyGen) buildDailyGenChart(ovAllRows, _fs);
      if (!ovCharts.siteComp) buildSiteCompChart(ovSitePerf);
    }
  }, 50);
}

// ── Filter Apply ──────────────────────────────────────────────
function applyOvFilters() {
  const site = _ovSite || '';
  const from = document.getElementById('ovFrom')?.value || '';
  const to   = document.getElementById('ovTo')?.value   || '';
  const el = document.getElementById('screenOverview');
  if (el) el.innerHTML = `<div style="text-align:center;padding:60px;color:var(--gray)">Loading...</div>`;
  Object.values(ovCharts).forEach(c => { try { c.destroy(); } catch(e){} });
  ovCharts = {};
  renderOverview(site, from, to);
}

// ── Searchable site dropdown ──────────────────────────────────
function showSiteDd() {
  const dd = document.getElementById('ovSiteDd');
  if (!dd) return;
  dd.style.display = 'block';
  // Reset all items visible
  dd.querySelectorAll('div').forEach(d => d.style.display = '');
}
function hideSiteDd() {
  const dd = document.getElementById('ovSiteDd');
  if (dd) dd.style.display = 'none';
  // Restore input text to current selection
  const inp = document.getElementById('ovSiteInput');
  if (inp) inp.value = _ovSite || '';
}
function filterSiteDd(q) {
  const dd = document.getElementById('ovSiteDd');
  if (!dd) return;
  dd.style.display = 'block';
  const ql = (q || '').toLowerCase();
  dd.querySelectorAll('div').forEach(d => {
    const txt = (d.textContent || '').toLowerCase();
    d.style.display = (!ql || txt.includes(ql)) ? '' : 'none';
  });
}
function selectOvSite(siteName) {
  _ovSite = siteName;
  const inp = document.getElementById('ovSiteInput');
  if (inp) inp.value = siteName || '';
  hideSiteDd();
  applyOvFilters();
}
