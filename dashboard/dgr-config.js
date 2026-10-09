/* Stockwell DGR Dashboard — connection to the DGR app.
 *
 * Loaded before the dashboard's own scripts. Two jobs:
 *
 * 1. Gate. Only managers and up may open the dashboard. The DGR app keeps its
 *    login in localStorage on this same origin, so the session is readable here.
 *    Like the rest of the app this is a client-side check, not real security:
 *    the data itself is readable with the public anon key.
 *
 * 2. Data, all from Supabase (no static files):
 *      dgr_submissions     every non-rejected report (the daily rows)
 *      dgr_history         CUF-workbook generation for site-days with no DGR,
 *                          Oct 2025 onward (marked _src:'cuf' for the dashboard)
 *      site_config         capacity, lat/lng, district, tariff, PVsyst,
 *                          tilt, nearby plants, co-located plants
 *      site_meter_monthly  meter (JMR) readings and budget, per site per month
 *      dgr_settings        insights_seasonal, insights_rename
 *    A DGR row wins over a history row for the same site and day. Every
 *    manager sees every site.
 *
 * Site names come from the database in DGR-app form. The dashboard applies
 * dgr_settings.insights_rename itself (rows via app.js's fixNames); the site
 * master built here is renamed to match.
 */
(function () {
  'use strict';

  const SB_URL = 'https://yvlagovdcxwmfkefdrnv.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2bGFnb3ZkY3h3bWZrZWZkcm52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0ODc3ODQsImV4cCI6MjA4OTA2Mzc4NH0.uYH7pcSo-pi_ksVMTCWsTiLz5hlt5YZMaVuBRLQvlQ0';
  const VER = '2';            // bump with the ?v= on the script tag when these files change
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

  // Data is loaded from the database only, so the dashboard's file-upload
  // screen would just confuse people
  const st = document.createElement('style');
  st.textContent = '.side button[data-view="data"]{display:none!important}';
  document.head.appendChild(st);

  // ---------- Supabase reads ----------
  const HEADERS = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
  async function sbCount(table, filter) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?select=*&limit=1${filter || ''}`, { headers: Object.assign({ Prefer: 'count=exact' }, HEADERS) });
    if (!r.ok) throw new Error(table + ': HTTP ' + r.status);
    return +((r.headers.get('content-range') || '').split('/')[1] || 0);
  }
  async function sbPage(table, select, filter, order, offset) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?select=${select}${filter || ''}&order=${order}&offset=${offset}&limit=${PAGE}`, { headers: HEADERS });
    if (!r.ok) throw new Error(table + ': HTTP ' + r.status);
    return r.json();
  }
  // Every row of a table, pages fetched in parallel
  async function sbAll(table, select, filter, order) {
    const total = await sbCount(table, filter);
    const pages = [];
    for (let o = 0; o < total; o += PAGE) pages.push(sbPage(table, select, filter, order, o));
    return (await Promise.all(pages)).flat();
  }

  // ---------- DGR reports -> dashboard rows ----------
  const SUB_COLS = ['site_name', 'report_date', 'created_at', 'submitted_by_name', 'status', 'reviewed_by', 'reviewed_at',
    'dc_capacity_kw', 'ac_capacity_kw', 'total_gen_kwh', 'dc_cuf_pct', 'ac_cuf_pct', 'pr_pct', 'poa_kwh_m2', 'peak_radiation_wm2',
    'weather_avg_ambient_c', 'weather_avg_module_c', 'grid_outage_details', 'plant_outage_details', 'wti_c', 'oti_c',
    'silica_gel', 'mog_level', 'modules_cleaned_today', 'modules_total', 'weather', 'rain', 'daily_activity', 'remarks',
    'inv_gen', 'inv_strings', 'inv_strings_count'].join(',');

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

  function fromSubmission(d) {
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

  // ---------- site master ----------
  function km(a, b) {
    const R = 6371, rad = x => x * Math.PI / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }
  // The shape app.js expects from data/master.json, in the dashboard's display names
  function buildMaster(cfg, meter, settings, rename) {
    const rn = s => rename[s] || s;
    const by = {};
    cfg.forEach(c => { by[c.site_name] = { lat: num(c.latitude), lon: num(c.longitude) }; });
    const sites = {};
    cfg.forEach(c => {
      const peers = (c.peer_sites || []).filter(p => by[p]);
      sites[rn(c.site_name)] = {
        lat: num(c.latitude), lon: num(c.longitude), district: c.district || null,
        ac: num(c.ac_capacity_kw), dc: num(c.dc_capacity_kw),
        peers: peers.map(rn), peerKm: peers.map(p => km(by[c.site_name], by[p])),
        tariff: num(c.tariff), pvsyst: num(c.pvsyst_dc_cuf), colocated: (c.colocated_sites || []).map(rn),
        ...(c.pvsyst_note ? { pvsystExcluded: c.pvsyst_note } : {}),
        ...(c.tilt_deg != null ? { tilt: num(c.tilt_deg) } : {})
      };
    });
    return {
      sites,
      meter: meter.map(m => ({ site: rn(m.site_name), month: m.month, actual: num(m.actual_kwh), import: num(m.import_kwh),
        export: num(m.export_kwh), budget: num(m.budget_kwh), plant_av: num(m.plant_avail), grid_av: num(m.grid_avail), tariff: num(m.tariff) })),
      seasonal: (settings.insights_seasonal || {}).factors || null,
      seasonalNote: (settings.insights_seasonal || {}).note || null,
      rename, renameNote: (settings.insights_rename || {}).note || null,
      meta: { updated: new Date().toISOString(), sources: ['DGR database'] }
    };
  }

  function showLoadError(msg) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#f4f1f0;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;padding:24px;text-align:center;color:#334';
    d.innerHTML = '<div><h3 style="margin:0 0 6px">Couldn\'t load Insights</h3><p style="color:#667;margin:0">The DGR database did not answer (' +
      String(msg).replace(/</g, '&lt;') + '). Check the connection and open Insights again.</p></div>';
    document.body.appendChild(d);
  }

  async function loadRows() {
    try {
      const [subs, hist, cfg, meter, settingRows] = await Promise.all([
        sbAll('dgr_submissions', SUB_COLS, '&status=neq.rejected', 'report_date.asc,site_name.asc'),
        sbAll('dgr_history', 'site_name,report_date,ac_kw,dc_kwp,gen_kwh,grid_out_min,plant_out_min', '', 'report_date.asc,site_name.asc'),
        sbAll('site_config', '*', '&active=eq.true', 'site_name.asc'),
        sbAll('site_meter_monthly', '*', '', 'month.asc,site_name.asc'),
        sbAll('dgr_settings', 'key,value', '&key=in.(insights_seasonal,insights_rename)', 'key.asc')
      ]);
      const settings = Object.fromEntries(settingRows.map(r => [r.key, r.value]));
      const rename = (settings.insights_rename || {}).map || {};

      let liveRows = DGR.rowsFromObjects(subs.map(fromSubmission)).rows;
      const histRows = DGR.rowsFromObjects(hist.map(h => ({
        site: h.site_name, date: h.report_date, ac_kw: h.ac_kw, dc_kwp: h.dc_kwp, gen_kwh: h.gen_kwh,
        grid_out_min: h.grid_out_min, plant_out_min: h.plant_out_min
      }))).rows;
      // Workbook rows carry generation only. Match how the dashboard package
      // stored them: no CUF of their own (it computes period CUF from gen ÷ capacity)
      histRows.forEach(r => { r._src = 'cuf'; r.dc_cuf = null; r.ac_cuf = null; delete r._d_ac; delete r._d_dc; });

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

      // pack() keeps _src; app.js takes a master sent alongside the rows, then renames the rows
      const packed = DGR.pack(DGR.mergeRows(histRows, liveRows));
      packed.master = buildMaster(cfg, meter, settings, rename);
      return packed;
    } catch (e) {
      showLoadError(e.message || e);
      throw e;
    }
  }

  window.DGR_CONFIG = {
    loadRows,
    // No static files: an empty master and dataset, so nothing is fetched from disk
    masterUrl: 'data:application/json,{}',
    dataUrl: 'data:application/json,{}',
    // Shared appearance and maintenance-schedule files: none; each viewer's own
    // settings stay in their browser, as the dashboard does by default
    appearanceUrl: 'data:application/json,null',
    maintenanceUrl: 'data:application/json,null',
    embedWaitMs: 0,
    parentOrigin: location.origin
  };

  // Load the dashboard in order now that the gate has passed.
  ['engine.js', 'ops.js', 'app.js', 'theme.js'].forEach(src => {
    const s = document.createElement('script');
    s.src = src + '?v=' + VER; s.async = false;
    document.head.appendChild(s);
  });
})();
