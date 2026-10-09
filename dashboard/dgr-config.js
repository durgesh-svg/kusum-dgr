/* Stockwell DGR Dashboard — connection to the DGR app.
 *
 * Loaded before the dashboard's own scripts. Two jobs:
 *
 * 1. Gate. Only managers and up may open the dashboard. The DGR app keeps its
 *    login in localStorage on this same origin, so the session is readable here.
 *    Like the rest of the app this is a client-side check, not real security:
 *    the data itself is readable with the public anon key.
 *
 * 2. Data. DGR_CONFIG.loadRows merges two sources:
 *      data/history.json  — Oct 2025 onward from the CUF workbooks, trimmed to
 *                           site-days the database does not have (gen-only rows,
 *                           marked _src:'cuf')
 *      dgr_submissions    — every non-rejected report, live from Supabase
 *    A live row wins over a history row for the same site and day.
 *    Both are in DGR-app site naming; the dashboard's own rename (master.json
 *    "rename", the Gajroopdesar -1/-2 swap) is applied afterwards by app.js.
 */
(function () {
  'use strict';

  const SB_URL = 'https://yvlagovdcxwmfkefdrnv.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2bGFnb3ZkY3h3bWZrZWZkcm52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0ODc3ODQsImV4cCI6MjA4OTA2Mzc4NH0.uYH7pcSo-pi_ksVMTCWsTiLz5hlt5YZMaVuBRLQvlQ0';
  const VER = '1';            // bump with the ?v= on the script tags when these files change
  const PAGE = 1000;          // PostgREST's row cap per request
  const DC_PER_STRING = 15.4; // kW, same constant as the DGR app

  // ---------- gate ----------
  const RANK = { engineer: 1, employee: 1, manager: 2, admin: 3, super_admin: 3, director: 4 };
  let session = null;
  try { session = JSON.parse(localStorage.getItem('dgr_session') || 'null'); } catch (e) { /* none */ }
  const allowed = !!(session && session.loggedIn && (RANK[session.role] || 1) >= 2);

  if (!allowed) {
    // This script sits at the end of <body>, so the body exists already
    document.body.innerHTML = '<div style="font-family:system-ui,sans-serif;max-width:420px;margin:80px auto;padding:24px;text-align:center;color:#334">' +
      '<h2 style="margin:0 0 8px">Insights are for managers</h2>' +
      '<p style="color:#667">Log in to the DGR app with a manager, admin or director account, then open Insights from there.</p>' +
      '<p><a href="/dgr.html">Open the DGR app</a></p></div>';
    return;   // dashboard scripts are never loaded
  }

  // ---------- live rows ----------
  const COLS = ['site_name', 'report_date', 'created_at', 'submitted_by_name', 'status', 'reviewed_by', 'reviewed_at',
    'dc_capacity_kw', 'ac_capacity_kw', 'total_gen_kwh', 'dc_cuf_pct', 'ac_cuf_pct', 'pr_pct', 'poa_kwh_m2', 'peak_radiation_wm2',
    'weather_avg_ambient_c', 'weather_avg_module_c', 'grid_outage_details', 'plant_outage_details', 'wti_c', 'oti_c',
    'silica_gel', 'mog_level', 'modules_cleaned_today', 'modules_total', 'weather', 'rain', 'daily_activity', 'remarks',
    'inv_gen', 'inv_strings', 'inv_strings_count'].join(',');

  async function sbGet(offset, limit, countOnly) {
    const url = `${SB_URL}/rest/v1/dgr_submissions?select=${countOnly ? 'site_name' : COLS}&status=neq.rejected` +
      `&order=report_date.asc,site_name.asc&offset=${offset}&limit=${limit}`;
    const headers = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
    if (countOnly) headers.Prefer = 'count=exact';
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error('DGR database returned HTTP ' + r.status);
    if (countOnly) return +((r.headers.get('content-range') || '').split('/')[1] || 0);
    return r.json();
  }
  async function fetchAllSubmissions() {
    const total = await sbGet(0, 1, true);
    const pages = [];
    for (let o = 0; o < total; o += PAGE) pages.push(sbGet(o, PAGE));
    return (await Promise.all(pages)).flat();
  }

  // Same rule as calcMins() in the DGR app: HH:MM to HH:MM, never negative.
  function mins(o) {
    if (!o || !o.from || !o.to) return 0;
    const [fh, fm] = String(o.from).split(':').map(Number), [th, tm] = String(o.to).split(':').map(Number);
    const m = (th * 60 + tm) - (fh * 60 + fm);
    return m > 0 ? m : 0;
  }
  // The dashboard parses "d/m/yyyy, h:mm:ss am" as IST wall-clock time,
  // which is what the DGR app's Excel export writes.
  const stamp = ts => ts ? new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : null;
  const num = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;

  function toCanonical(d) {
    const grid = Array.isArray(d.grid_outage_details) ? d.grid_outage_details : [];
    const plant = Array.isArray(d.plant_outage_details) ? d.plant_outage_details : [];
    const inv = Array.isArray(d.inv_gen) ? d.inv_gen.map(num) : [];
    // Strings actually connected (inv_strings_count) when filled, else the design count
    const sc = Array.isArray(d.inv_strings_count) ? d.inv_strings_count : [];
    const sd = Array.isArray(d.inv_strings) ? d.inv_strings : [];
    const invDc = inv.map((_, i) => { const s = num(sc[i]) || num(sd[i]); return s ? +(s * DC_PER_STRING).toFixed(2) : null; });
    return {
      site: d.site_name, date: d.report_date,
      ac_kw: num(d.ac_capacity_kw), dc_kwp: num(d.dc_capacity_kw), gen_kwh: num(d.total_gen_kwh),
      dc_cuf: num(d.dc_cuf_pct), ac_cuf: num(d.ac_cuf_pct), pr: num(d.pr_pct),
      poa: num(d.poa_kwh_m2), peak_rad: num(d.peak_radiation_wm2),
      amb_temp: num(d.weather_avg_ambient_c), module_temp: num(d.weather_avg_module_c),
      grid_out_min: grid.reduce((a, o) => a + mins(o), 0),
      grid_out_reason: grid.map(o => o.reason === 'Others' && o.reason_other ? o.reason_other : o.reason).filter(Boolean).join('; ') || null,
      plant_out_min: plant.reduce((a, o) => a + mins(o), 0),
      fault_codes: plant.map(o => o.fault_code).filter(Boolean).join('; ') || null,
      wti: num(d.wti_c), oti: num(d.oti_c), silica_gel: d.silica_gel || null, mog_level: d.mog_level || null,
      modules_cleaned: num(d.modules_cleaned_today), total_modules: num(d.modules_total),
      weather: d.weather || null, rain: d.rain === true ? 'Yes' : d.rain === false ? 'No' : null,
      submitted_by: d.submitted_by_name || null, submitted_at: stamp(d.created_at),
      status: d.status || null, reviewed_by: d.reviewed_by || null, reviewed_at: stamp(d.reviewed_at),
      activity: d.daily_activity || null, remarks: d.remarks || null,
      inv, inv_dc: invDc.some(v => v) ? invDc : undefined
    };
  }

  async function loadRows() {
    const [histRes, live] = await Promise.all([
      fetch('data/history.json?v=' + VER).then(r => r.ok ? r.json() : null).catch(() => null),
      fetchAllSubmissions()
    ]);
    let hist = histRes ? DGR.unpack(histRes) : [];
    let liveRows = DGR.rowsFromObjects(live.map(toCanonical)).rows;
    // Managers see only their assigned sites, as the old Insights screen did.
    // Admins and up, and managers assigned "ALL" or nothing, see every site.
    const own = session.role === 'manager' ? (session.assigned_sites || []) : [];
    let master = null;
    if (own.length && !own.includes('ALL')) {
      const ok = new Set(own);
      hist = hist.filter(r => ok.has(r.site)); liveRows = liveRows.filter(r => ok.has(r.site));
      // Trim the site master too, or unassigned sites would show as "not reporting"
      master = await fetch('data/master.json?v=' + VER).then(r => r.ok ? r.json() : null).catch(() => null);
      if (master && master.sites) {
        const R = master.rename || {}, keep = new Set(own.map(s => R[s] || s));   // master is in dashboard naming
        master.sites = Object.fromEntries(Object.entries(master.sites).filter(([s]) => keep.has(s)));
        if (Array.isArray(master.meter)) master.meter = master.meter.filter(m => keep.has(m.site));
      } else master = null;
    }
    // The dashboard treats its latest date as a full day. Reports for today
    // trickle in from 6 pm, so a half-filed day reads as a fleet-wide collapse.
    // Hold back trailing days until 80% of the usual number of sites have filed.
    const perDay = {};
    liveRows.forEach(r => { perDay[r.date] = (perDay[r.date] || 0) + 1; });
    const days = Object.keys(perDay).sort();
    const usual = DGR.median(days.slice(-10, -2).map(d => perDay[d])) || 0;
    const held = [];
    while (days.length > 1 && perDay[days[days.length - 1]] < 0.8 * usual) held.push(days.pop());
    if (held.length) liveRows = liveRows.filter(r => !held.includes(r.date));
    // pack() keeps _src so the dashboard can tell workbook rows from DGR rows
    const packed = DGR.pack(DGR.mergeRows(hist, liveRows));
    if (master) packed.master = master;   // app.js swaps in a master sent alongside the rows
    return packed;
  }

  window.DGR_CONFIG = {
    loadRows,
    masterUrl: 'data/master.json?v=' + VER,
    dataUrl: 'data/history.json?v=' + VER,
    parentOrigin: location.origin
  };

  // Load the dashboard in order now that the gate has passed.
  ['engine.js', 'ops.js', 'app.js', 'theme.js'].forEach(src => {
    const s = document.createElement('script');
    s.src = src + '?v=' + VER; s.async = false;
    document.head.appendChild(s);
  });
})();
