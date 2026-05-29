// ─────────────────────────────────────────────────────────────
// OVERVIEW DASHBOARD — Full Implementation
// Compliance + Performance + Charts + Inverter Health
// Admin only
// ─────────────────────────────────────────────────────────────

const CUTOFF_HOUR = 21; // 9 PM cutoff
const OV_PAGE_SIZE = 25;
let ovActiveTab = 'compliance';
let ovAutoRefreshTimer = null;
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
  let query = sb.from('dgr_submissions').select('*').gte('report_date', filterFrom).lte('report_date', filterTo).order('report_date', { ascending: false });
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

  // Build site filter opts
  const siteOpts = `<option value="">All Sites</option>` + siteList.map(s => `<option value="${s}" ${s === filterSite ? 'selected' : ''}>${s}</option>`).join('');

  el.innerHTML = `
    <div style="padding-bottom:80px">

      <!-- Header + Filter inline -->
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <div style="flex:1;min-width:140px">
          <div style="font-size:14px;font-weight:800;color:var(--text)">📊 Overview</div>
          <div style="font-size:9px;color:var(--text-muted)">${filterFrom} → ${filterTo}</div>
        </div>
        <select id="ovSite" onchange="applyOvFilters()" style="flex:2;min-width:100px;padding:5px 8px;font-size:11px;border:1.5px solid var(--border);border-radius:7px">${siteOpts}</select>
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

        <!-- Daily Generation Chart -->
        <div class="card" style="margin-bottom:10px">
          <div class="card-title" style="margin-bottom:8px">Daily Generation Trend (kWh)</div>
          <div style="position:relative;height:200px"><canvas id="chartDailyGen"></canvas></div>
        </div>

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

        <!-- Site Performance Table -->
        <div class="card">
          <div class="card-title" style="margin-bottom:8px">Site-wise Performance — ${Object.keys(ovSitePerf).length} sites <span style="font-size:9px;color:var(--gray)">(click site to see inverter health)</span></div>
          <div style="overflow-x:auto">
            <div style="min-width:680px">
              <div class="ov-perf-row ov-table-header">
                <div>Site</div><div>Days</div><div>Avg Gen</div><div>DC CUF%</div><div>AC CUF%</div><div>Avg PR%</div><div>Best Day</div><div>Worst Day</div>
              </div>
              <div id="ovPerfBody"></div>
            </div>
          </div>
          <div id="ovPerfPagination"></div>
        </div>

        <!-- Inverter Health Detail -->
        <div id="ovInvDetail" class="hidden"></div>
      </div>
    </div>`;

  // Render paginated tables
  renderCompliancePage(1);
  renderEngineerPage(1);
  renderPerfPage(1);

  // Build charts after DOM ready
  setTimeout(() => {
    buildDailyCompChart(ovAllRows);
    buildDailyGenChart(ovAllRows);
    buildSiteCompChart(ovSitePerf);
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
      <div class="ov-perf-row" onclick="showInvHealth('${site.replace(/'/g,"\\'")}'" style="cursor:pointer">
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

function buildDailyGenChart(rows) {
  const canvas = document.getElementById('chartDailyGen');
  if (!canvas || typeof Chart === 'undefined') return;
  const dateMap = {};
  rows.forEach(r => {
    if (!dateMap[r.report_date]) dateMap[r.report_date] = 0;
    dateMap[r.report_date] += (+r.total_gen_kwh || 0);
  });
  const labels = Object.keys(dateMap).sort();
  ovCharts.dailyGen = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels.map(d => d.slice(5)),
      datasets: [{ label: 'Total kWh', data: labels.map(d => +(dateMap[d]/1000).toFixed(1)), backgroundColor: 'rgba(126,87,0,.65)', borderRadius: 4, borderColor: 'rgba(126,87,0,1)', borderWidth: 1 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 10 } }, title: { display: true, text: 'MWh', font: { size: 9 } } } } }
  });
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

// ── Inverter Health Drill-down ────────────────────────────────
async function showInvHealth(siteName) {
  const el = document.getElementById('ovInvDetail');
  if (!el) return;
  el.classList.remove('hidden');
  el.innerHTML = `<div class="card" style="margin-top:10px;border-left:4px solid var(--blue)"><div style="padding:16px;text-align:center;color:var(--gray);font-size:12px">Loading inverter health for ${siteName}...</div></div>`;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Fetch last 7 days for this site
  const to = fmtLocalDate(new Date());
  const from7 = new Date(); from7.setDate(from7.getDate() - 6);
  const from = fmtLocalDate(from7);
  const { data: rows } = await sb.from('dgr_submissions').select('report_date,inv_gen,inv_strings_count').eq('site_name', siteName).gte('report_date', from).lte('report_date', to).eq('status', 'approved').order('report_date', { ascending: true });

  if (!rows || rows.length === 0) {
    el.innerHTML = `<div class="card" style="margin-top:10px"><div style="padding:16px;text-align:center;color:var(--gray);font-size:12px">No approved data found for ${siteName} in last 7 days</div></div>`;
    return;
  }

  // Aggregate loss per inverter across all days
  const invCount = Math.max(...rows.map(r => (r.inv_gen||[]).length));
  const invStats = Array.from({ length: invCount }, (_, i) => {
    const losses = [];
    rows.forEach(r => {
      const sc = parseFloat((r.inv_strings_count||[])[i]) || 0;
      const kwh = parseFloat((r.inv_gen||[])[i]) || 0;
      const dc = sc > 0 ? +(sc * 15.4).toFixed(2) : 0;
      if (dc > 0 && kwh > 0) {
        const cuf = +(kwh / (dc * 24) * 100).toFixed(2);
        losses.push({ cuf, kwh, dc });
      }
    });
    const maxCuf = losses.length ? Math.max(...losses.map(l => l.cuf)) : 0;
    const avgLoss = losses.length
      ? +(losses.reduce((a, l) => a + (maxCuf > 0 ? ((maxCuf - l.cuf) * 24 * l.dc) / l.kwh : 0), 0) / losses.length).toFixed(2)
      : null;
    return { inv: i + 1, avgLoss, days: losses.length };
  });

  const maxLoss = Math.max(...invStats.filter(s => s.avgLoss !== null).map(s => s.avgLoss), 0);
  const invRows = invStats.map(s => {
    const lossVal = s.avgLoss;
    const lossColor = lossVal === null ? 'var(--gray)' : lossVal <= 4 ? 'var(--green-dark)' : lossVal <= 15 ? 'var(--orange)' : 'var(--red)';
    const bar = lossVal !== null && maxLoss > 0 ? `<div style="background:${lossColor};height:6px;border-radius:3px;width:${Math.min(100, (lossVal/maxLoss)*100)}%;margin-top:3px"></div>` : '';
    return `<div class="ov-inv-row">
      <div style="font-weight:700;color:var(--blue)">Inv ${s.inv}</div>
      <div>${s.days} days</div>
      <div style="color:${lossColor};font-weight:700">${lossVal !== null ? lossVal + '%' : '—'}${bar}</div>
      <div style="color:${lossColor};font-size:10px">${lossVal === null ? '—' : lossVal <= 4 ? '✅ Good' : lossVal <= 8 ? '⚠️ Attention' : lossVal <= 15 ? '🔴 Check' : '🔴 Critical'}</div>
    </div>`;
  }).join('');

  const canvasId = 'chartInvHealth_' + Date.now();
  el.innerHTML = `
    <div class="card" style="margin-top:10px;border-left:4px solid var(--blue)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="card-title" style="margin-bottom:0">🏭 ${siteName} — Inverter Health (Last 7 Days)</div>
        <button onclick="document.getElementById('ovInvDetail').classList.add('hidden')" style="background:none;border:none;font-size:16px;cursor:pointer;color:var(--gray)">✕</button>
      </div>
      <div style="position:relative;height:200px;margin-bottom:12px"><canvas id="${canvasId}"></canvas></div>
      <div style="overflow-x:auto">
        <div style="min-width:380px">
          <div class="ov-inv-row ov-table-header"><div>Inverter</div><div>Data Days</div><div>Avg Loss%</div><div>Health</div></div>
          ${invRows}
        </div>
      </div>
    </div>`;

  setTimeout(() => {
    const c = document.getElementById(canvasId);
    if (!c || typeof Chart === 'undefined') return;
    ovCharts.invHealth = new Chart(c, {
      type: 'bar',
      data: {
        labels: invStats.map(s => 'Inv ' + s.inv),
        datasets: [{ label: 'Avg Loss%', data: invStats.map(s => s.avgLoss ?? 0), backgroundColor: invStats.map(s => !s.avgLoss ? 'rgba(107,114,128,.4)' : s.avgLoss <= 4 ? 'rgba(22,163,74,.7)' : s.avgLoss <= 15 ? 'rgba(249,115,22,.7)' : 'rgba(185,28,28,.7)'), borderRadius: 4 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 10 } }, title: { display: true, text: 'Loss%', font: { size: 9 } } } } }
    });
  }, 100);
}

// ── Tab Switch ────────────────────────────────────────────────
function switchOvTab(tab) {
  ovActiveTab = tab;
  document.querySelectorAll('.ov-sub-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.ov-tab-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab));
  // Rebuild charts on tab switch if needed
  setTimeout(() => {
    if (tab === 'compliance' && !ovCharts.dailyComp) buildDailyCompChart(ovAllRows);
    if (tab === 'performance' && !ovCharts.dailyGen) {
      buildDailyGenChart(ovAllRows);
      buildSiteCompChart(ovSitePerf);
    }
  }, 50);
}

// ── Filter Apply ──────────────────────────────────────────────
function applyOvFilters() {
  const site = document.getElementById('ovSite')?.value || '';
  const from = document.getElementById('ovFrom')?.value || '';
  const to = document.getElementById('ovTo')?.value || '';
  const el = document.getElementById('screenOverview');
  if (el) el.innerHTML = `<div style="text-align:center;padding:60px;color:var(--gray)">Loading...</div>`;
  Object.values(ovCharts).forEach(c => { try { c.destroy(); } catch(e){} });
  ovCharts = {};
  renderOverview(site, from, to);
}
