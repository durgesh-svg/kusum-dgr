/* Stockwell DGR Dashboard — data engine.
 * Pure functions: parse DGR sheets into canonical rows, compute every dashboard metric.
 * No DOM access, so it runs the same in the browser and in Node (for testing). */
(function (root) {
  'use strict';

  // ---------- Canonical DGR fields ----------
  // key: canonical name used in JSON/API. aliases: normalized header spellings (lowercase, a–z0–9 only).
  const FIELDS = [
    { key: 'site', label: 'Site', type: 'text', aliases: ['site', 'sitename', 'plant', 'plantname', 'location', 'sitelocation', 'nameofsite', 'nameofplant'] },
    { key: 'date', label: 'Date', type: 'date', aliases: ['date', 'reportdate', 'dgrdate', 'day', 'generationdate', 'dateofreport'] },
    { key: 'ac_kw', label: 'AC Capacity kW', type: 'num', aliases: ['ackw', 'accapacity', 'accapacitykw', 'capacityac', 'capacityackw', 'ackwcapacity'] },
    { key: 'dc_kwp', label: 'DC Capacity kWp', type: 'num', aliases: ['dckwp', 'dckw', 'dccapacity', 'dccapacitykwp', 'dccapacitykw', 'capacitydc', 'capacitydckwp'] },
    { key: 'gen_kwh', label: 'Total Gen kWh', type: 'num', aliases: ['totalgenkwh', 'totalgenerationkwh', 'totalgen', 'totalgeneration', 'totalgenerationkwh', 'generationkwh', 'generation', 'genkwh', 'netgenkwh', 'netgeneration', 'exportkwh', 'netexportkwh', 'dailygenerationkwh', 'dailygeneration'] },
    { key: 'dc_cuf', label: 'DC CUF %', type: 'num', aliases: ['dccuf', 'dccufpct', 'dccufpercent', 'cufdc'] },
    { key: 'ac_cuf', label: 'AC CUF %', type: 'num', aliases: ['accuf', 'accufpct', 'accufpercent', 'cufac', 'cuf'] },
    { key: 'pr', label: 'PR %', type: 'num', aliases: ['pr', 'prpct', 'prpercent', 'performanceratio', 'performanceratiopct'] },
    { key: 'poa', label: 'POA kWh/m²', type: 'num', aliases: ['poakwhm2', 'poa', 'poairradiation', 'poainsolation', 'irradiationkwhm2', 'insolationkwhm2', 'poakwhm'] },
    { key: 'peak_rad', label: 'Peak Radiation W/m²', type: 'num', aliases: ['peakradiationwm2', 'peakradiation', 'peakirradiance', 'peakirradiancewm2', 'peakradiationwm'] },
    { key: 'amb_temp', label: 'Avg Ambient °C', type: 'num', aliases: ['avgambientc', 'avgambient', 'ambienttemp', 'ambienttempc', 'avgambienttemp', 'avgambienttempc', 'ambientc', 'ambient'] },
    { key: 'module_temp', label: 'Module Temp °C', type: 'num', aliases: ['moduletempc', 'moduletemp', 'moduletemperature', 'moduletemperaturec', 'modtemp', 'modtempc', 'pvmoduletemp', 'pvmoduletempc', 'backsurfacetemp', 'backsurfacetempc', 'avgmoduletemp', 'avgmoduletempc'] },
    { key: 'grid_out_min', label: 'Grid Outage min', type: 'num', aliases: ['gridoutagemin', 'gridoutagemins', 'gridoutageminutes', 'griddowntimemin', 'griddowntime', 'griddownmin'] },
    { key: 'grid_out_reason', label: 'Grid Outage Reason', type: 'text', aliases: ['gridoutagereason', 'gridoutagereasons', 'outagereason', 'outagereasons', 'reasonforgridoutage', 'gridreason', 'reason', 'gridfailurereason'] },
    { key: 'plant_out_min', label: 'Plant Outage min', type: 'num', aliases: ['plantoutagemin', 'plantoutagemins', 'plantoutageminutes', 'plantdowntimemin', 'plantdowntime'] },
    { key: 'wti', label: 'WTI °C', type: 'num', aliases: ['wtic', 'wti', 'wtitemp', 'wtitempc', 'windingtemp', 'windingtemperature'] },
    { key: 'oti', label: 'OTI °C', type: 'num', aliases: ['otic', 'oti', 'otitemp', 'otitempc', 'oiltemp', 'oiltemperature'] },
    { key: 'silica_gel', label: 'Silica Gel', type: 'text', aliases: ['silicagel', 'silicagelcolour', 'silicagelcolor', 'silicagelstatus', 'silica'] },
    { key: 'mog_level', label: 'MOG Level', type: 'text', aliases: ['moglevel', 'mog', 'oillevel', 'moglevelstatus'] },
    { key: 'modules_cleaned', label: 'Modules Cleaned', type: 'num', aliases: ['modulescleaned', 'modulescleanedtoday', 'modulecleaned', 'noofmodulescleaned', 'modulescleanednos', 'cleanedmodules', 'modulecleaning'] },
    { key: 'total_modules', label: 'Total Modules', type: 'num', aliases: ['totalmodules', 'totalnoofmodules', 'modulestotal', 'noofmodules'] },
    { key: 'fault_codes', label: 'Plant Fault Codes', type: 'text', aliases: ['plantfaultcodes', 'faultcodes', 'faultcode', 'plantfaults'] },
    { key: 'weather', label: 'Weather', type: 'text', aliases: ['weather', 'weathercondition'] },
    { key: 'rain', label: 'Rain', type: 'text', aliases: ['rain', 'rainfall'] },
    { key: 'submitted_by', label: 'Submitted By', type: 'text', aliases: ['submittedby', 'preparedby', 'engineer'] },
    { key: 'submitted_at', label: 'Submitted At', type: 'text', aliases: ['submittedat', 'submissiontime'] },
    { key: 'status', label: 'Status', type: 'text', aliases: ['status', 'approvalstatus'] },
    { key: 'reviewed_by', label: 'Reviewed By', type: 'text', aliases: ['reviewedby', 'approvedby'] },
    { key: 'reviewed_at', label: 'Reviewed At', type: 'text', aliases: ['reviewedat', 'approvedat'] },
    { key: 'activity', label: 'Daily Activity', type: 'text', aliases: ['dailyactivity', 'activity', 'activities', 'dailyactivities', 'activityperformed', 'activitiesperformed', 'workdone'] },
    { key: 'remarks', label: 'Remarks', type: 'text', aliases: ['remarks', 'remark', 'comments', 'comment', 'notes'] },
  ];
  const INV_RE = /^(?:inv|inverter)0*(\d{1,2})(?:kwh|gen|generation)?$/;
  const INV_DC_RE = /^(?:inv|inverter)0*(\d{1,2})dc(?:kw|kwp|capacity)?$/;
  const FIELD_BY_ALIAS = {};
  const ALIAS_RANK = {};
  FIELDS.forEach(f => f.aliases.forEach((a, i) => { if (!FIELD_BY_ALIAS[a]) { FIELD_BY_ALIAS[a] = f.key; ALIAS_RANK[a] = i; } }));

  // Fields checked for DGR completeness (radiation and PR left out: not measured at the sites).
  const COMPLETENESS_FIELDS = ['gen_kwh', 'dc_cuf', 'ac_cuf', 'amb_temp', 'grid_out_min',
    'plant_out_min', 'wti', 'oti', 'silica_gel', 'mog_level', 'modules_cleaned', 'total_modules', 'activity', 'remarks', 'inv'];
  const FIELD_LABEL = Object.fromEntries(FIELDS.map(f => [f.key, f.label]));
  FIELD_LABEL.inv = 'Inverter kWh (Inv 1–n)';

  const THRESH = { lowRatio: 0.7, persistentShare: 0.8, minObserved: 5, dipRatio: 0.3 };

  const KEYWORDS = [
    ['Grass cutting', /grass\s*cut/i],
    ['Module cleaning', /modul\w*\s*clean|clean\w*\s*(of\s*)?modul|\bmc\b/i],
    ['String monitoring', /string\s*(current\s*)?monitor/i],
    ['Inverter monitoring', /inverter\s*monitor/i],
    ['SCADA monitoring', /scada/i],
    ['Plant monitoring', /plant\s*monitor/i],
    ['Visual inspection', /visual\s*inspect/i],
    ['Camera / CCTV', /camera|cctv/i],
    ['VCB', /\bvcb\b/i],
    ['LA damage(d)', /\bla\b[^.;]{0,20}damag|lightning\s*arrest\w*[^.;]{0,20}damag/i],
    ['Transformer', /transformer|\btrafo\b|\bidt\b/i],
    ['Trip / fault', /\btrip|fault/i],
    ['DGR / report work', /\bdgr\b|report/i],
  ];

  // ---------- Parsing helpers ----------
  const norm = h => String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, '');
  const isBlank = v => v === null || v === undefined || (typeof v === 'string' && /^\s*(|-|–|—|na|n\/a|nil|null)\s*$/i.test(v));

  function toNum(v) {
    if (isBlank(v)) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v).replace(/[,%\s]/g, '').replace(/[^\d.\-eE]/g, '');
    if (s === '' || s === '-' || s === '.') return null;
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }
  function toText(v) {
    if (isBlank(v)) return null;
    return String(v).trim() || null;
  }
  const pad = n => String(n).padStart(2, '0');
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  function ymd(y, m, d) {
    if (!(y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }
  function toDate(v) {
    if (isBlank(v)) return null;
    if (v instanceof Date && !isNaN(v)) {
      // SheetJS gives local-midnight dates; nudge by 12h so a timezone offset never shifts the day.
      const t = new Date(v.getTime() + 12 * 3600e3);
      return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    }
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) { // Excel serial
        const t = new Date(Math.round((v - 25569) * 864e5));
        return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
      }
      return null;
    }
    const s = String(v).trim();
    let m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return ymd(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/))) { // Indian format: day first
      let y = +m[3]; if (y < 100) y += 2000;
      return ymd(y, +m[2], +m[1]);
    }
    if ((m = s.match(/^(\d{1,2})[-\s\/.]*([a-z]{3,9})[-\s\/.,]*(\d{2,4})/i))) {
      let y = +m[3]; if (y < 100) y += 2000;
      return ymd(y, MONTHS[m[2].toLowerCase().slice(0, 4)] || MONTHS[m[2].toLowerCase().slice(0, 3)], +m[1]);
    }
    if ((m = s.match(/^([a-z]{3,9})[-\s\/.]*(\d{1,2})[-\s\/.,]*(\d{4})/i))) {
      return ymd(+m[3], MONTHS[m[1].toLowerCase().slice(0, 3)], +m[2]);
    }
    return null;
  }

  // Map one header row to field keys. Returns {map: colIndex->key|'inv:N', score}
  function mapHeaders(headerRow) {
    const map = {}; let score = 0; const seen = {};
    (headerRow || []).forEach((h, i) => {
      const n = norm(h);
      if (!n) return;
      const inv = n.match(INV_RE);
      if (inv) { map[i] = 'inv:' + (+inv[1]); score++; return; }
      const invdc = n.match(INV_DC_RE);
      if (invdc) { map[i] = 'invdc:' + (+invdc[1]); return; }
      const key = FIELD_BY_ALIAS[n];
      if (!key) return;
      const rank = ALIAS_RANK[n];
      if (seen[key] === undefined) { map[i] = key; seen[key] = { i, rank }; score++; }
      else if (rank < seen[key].rank) { delete map[seen[key].i]; map[i] = key; seen[key] = { i, rank }; }
    });
    return { map, score };
  }

  /* Parse a workbook given as {sheetName: arrayOfArrays}. Returns
     {rows, report:{sheets:[{name, headerRow, rows, skipped}], found:{key:header}, missing:[...], invCount, warnings:[]}} */
  function parseSheets(sheets) {
    const rows = []; const report = { sheets: [], found: {}, missing: [], invCount: 0, warnings: [], derived: { ac_cuf: 0, dc_cuf: 0 } };
    Object.entries(sheets).forEach(([name, aoa]) => {
      if (!aoa || !aoa.length) return;
      let best = { idx: -1, score: 0, map: {} };
      for (let r = 0; r < Math.min(aoa.length, 25); r++) {
        const m = mapHeaders(aoa[r]);
        if (m.score > best.score) best = { idx: r, score: m.score, map: m.map };
      }
      if (best.score < 3) { report.sheets.push({ name, headerRow: null, rows: 0, skipped: 0, note: 'No DGR header row found' }); return; }
      const keys = Object.values(best.map);
      const siteFromSheet = !keys.includes('site');
      if (!keys.includes('date')) { report.sheets.push({ name, headerRow: best.idx + 1, rows: 0, skipped: 0, note: 'No Date column' }); return; }
      Object.entries(best.map).forEach(([ci, key]) => {
        if (key.startsWith('inv:')) report.invCount = Math.max(report.invCount, +key.slice(4));
        else if (key.startsWith('invdc:')) report.invDc = true;
        else if (!report.found[key]) report.found[key] = String(aoa[best.idx][ci]).trim();
      });
      if (siteFromSheet) report.found.site = report.found.site || '(sheet name)';
      let n = 0, skipped = 0;
      for (let r = best.idx + 1; r < aoa.length; r++) {
        const line = aoa[r]; if (!line || line.every(isBlank)) continue;
        const row = { inv: [], inv_dc: [] };
        Object.entries(best.map).forEach(([ci, key]) => {
          const v = line[ci];
          if (key.startsWith('inv:')) { row.inv[+key.slice(4) - 1] = toNum(v); return; }
          if (key.startsWith('invdc:')) { row.inv_dc[+key.slice(6) - 1] = toNum(v); return; }
          const f = FIELDS.find(x => x.key === key);
          row[key] = f.type === 'num' ? toNum(v) : f.type === 'date' ? toDate(v) : toText(v);
        });
        if (siteFromSheet) row.site = String(name).trim();
        if (!row.site || !row.date || /^(total|grand\s*total|sum|average|avg)$/i.test(row.site)) { skipped++; continue; }
        for (let i = 0; i < row.inv.length; i++) if (row.inv[i] === undefined) row.inv[i] = null;
        row.inv_dc = Array.from({ length: row.inv.length }, (_, i) => row.inv_dc[i] == null ? null : row.inv_dc[i]);
        if (!row.inv_dc.some(v => v != null)) delete row.inv_dc;
        rows.push(finishRow(row, report)); n++;
      }
      report.sheets.push({ name, headerRow: best.idx + 1, rows: n, skipped });
    });
    report.missing = FIELDS.filter(f => !report.found[f.key]).map(f => f.key);
    if (!rows.length) report.warnings.push('No DGR rows were found. The file needs a header row with at least Site (or one sheet per site), Date and Total Gen kWh.');
    return { rows: dedupe(rows), report };
  }

  // Normalize an API/JSON row (canonical keys, or inv1..invN keys) into a canonical row.
  function fromJsonRow(o, report) {
    const row = { inv: [] };
    FIELDS.forEach(f => {
      const v = o[f.key];
      row[f.key] = f.type === 'num' ? toNum(v) : f.type === 'date' ? toDate(v) : toText(v);
    });
    if (Array.isArray(o.inv)) row.inv = o.inv.map(toNum);
    else Object.keys(o).forEach(k => { const m = norm(k).match(INV_RE); if (m) row.inv[+m[1] - 1] = toNum(o[k]); });
    if (Array.isArray(o.inv_dc)) row.inv_dc = o.inv_dc.map(toNum);
    for (let i = 0; i < row.inv.length; i++) if (row.inv[i] === undefined) row.inv[i] = null;
    return finishRow(row, report || { derived: { ac_cuf: 0, dc_cuf: 0 } });
  }
  function parseJsonRows(list) {
    const report = { sheets: [{ name: 'JSON', headerRow: null, rows: 0, skipped: 0 }], found: {}, missing: [], invCount: 0, warnings: [], derived: { ac_cuf: 0, dc_cuf: 0 } };
    const rows = [];
    (list || []).forEach(o => {
      const r = fromJsonRow(o, report);
      if (!r.site || !r.date) { report.sheets[0].skipped++; return; }
      rows.push(r);
      FIELDS.forEach(f => { if (r[f.key] !== null && r[f.key] !== undefined) report.found[f.key] = f.key; });
      report.invCount = Math.max(report.invCount, r.inv.length);
    });
    report.sheets[0].rows = rows.length;
    report.missing = FIELDS.filter(f => !report.found[f.key]).map(f => f.key);
    return { rows: dedupe(rows), report };
  }

  function finishRow(row, report) {
    // CUF fallback: standard formula from generation and capacity, only when the DGR left it blank.
    if (row.ac_cuf == null && row.gen_kwh != null && row.ac_kw > 0) { row.ac_cuf = round(row.gen_kwh / (row.ac_kw * 24) * 100, 2); row._d_ac = 1; report.derived.ac_cuf++; }
    if (row.dc_cuf == null && row.gen_kwh != null && row.dc_kwp > 0) { row.dc_cuf = round(row.gen_kwh / (row.dc_kwp * 24) * 100, 2); row._d_dc = 1; report.derived.dc_cuf++; }
    return row;
  }
  // One row per site per day: a later row for the same site+date replaces the earlier one.
  function dedupe(rows) {
    const m = new Map(); rows.forEach(r => m.set(r.site + '|' + r.date, r));
    return [...m.values()];
  }
  function mergeRows(oldRows, newRows) {
    const m = new Map(); oldRows.forEach(r => m.set(r.site + '|' + r.date, r)); newRows.forEach(r => m.set(r.site + '|' + r.date, r));
    return [...m.values()].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.site.localeCompare(b.site));
  }

  // ---------- Compact storage (columnar) ----------
  const STORE_KEYS = FIELDS.map(f => f.key);
  function pack(rows, meta) {
    return { format: 'stockwell-dgr/1', meta: meta || {}, fields: STORE_KEYS.concat(['inv', 'inv_dc', '_d_ac', '_d_dc', '_src']),
      rows: rows.map(r => STORE_KEYS.map(k => r[k] === undefined ? null : r[k]).concat([r.inv || [], r.inv_dc || null, r._d_ac || 0, r._d_dc || 0, r._src || null])) };
  }
  function unpack(obj) {
    if (!obj) return [];
    if (Array.isArray(obj)) return rowsFromObjects(obj).rows;
    if (Array.isArray(obj.rows) && Array.isArray(obj.fields)) {
      return obj.rows.map(a => { const r = {}; obj.fields.forEach((k, i) => { r[k] = a[i]; }); r.inv = r.inv || []; if (!r.inv_dc) delete r.inv_dc; if (!r._src) delete r._src; if (!r._d_ac) delete r._d_ac; if (!r._d_dc) delete r._d_dc; return r; });
    }
    if (Array.isArray(obj.rows)) return rowsFromObjects(obj.rows).rows;
    return [];
  }

  // ---------- Stats helpers ----------
  const nn = a => a.filter(v => v !== null && v !== undefined && !isNaN(v));
  const sum = a => nn(a).reduce((s, v) => s + v, 0);
  const mean = a => { const b = nn(a); return b.length ? b.reduce((s, v) => s + v, 0) / b.length : null; };
  const median = a => { const b = nn(a).slice().sort((x, y) => x - y); if (!b.length) return null; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const round = (v, d) => v == null ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  const lastNonNull = (rows, k) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i][k] != null) return rows[i][k]; return null; };
  const blankField = (r, k) => k === 'inv' ? !(r.inv && r.inv.some(v => v != null)) : (r[k] === null || r[k] === undefined || (k === 'ac_cuf' && r._d_ac) || (k === 'dc_cuf' && r._d_dc));

  // ---------- The dashboard model ----------
  function compute(allRows, from, to) {
    const rows = allRows.filter(r => (!from || r.date >= from) && (!to || r.date <= to));
    const dates = [...new Set(rows.map(r => r.date))].sort();
    const latest = dates[dates.length - 1] || null;
    const bySite = new Map();
    rows.forEach(r => { if (!bySite.has(r.site)) bySite.set(r.site, []); bySite.get(r.site).push(r); });
    const sites = {}; const dips = []; const lowInv = [];

    [...bySite.keys()].sort((a, b) => a.localeCompare(b)).forEach(name => {
      const rs = bySite.get(name).sort((a, b) => a.date < b.date ? -1 : 1);
      const ac_kw = lastNonNull(rs, 'ac_kw'), dc_kwp = lastNonNull(rs, 'dc_kwp');
      const gen_total = sum(rs.map(r => r.gen_kwh));
      const prVals = nn(rs.map(r => r.pr)); const wtiVals = nn(rs.map(r => r.wti));
      const last = rs[rs.length - 1];
      const missing = COMPLETENESS_FIELDS.filter(k => blankField(last, k));

      // Inverters: compare each inverter with the site's own median inverter output that day.
      const invN = Math.max(0, ...rs.map(r => (r.inv || []).length));
      const obs = Array(invN).fill(0), flagged = Array(invN).fill(0);
      const heat = []; let inv_loss = 0;
      rs.forEach((r, di) => {
        const vals = (r.inv || []); const med = median(vals);
        const cells = [];
        for (let i = 0; i < invN; i++) {
          const v = vals[i];
          if (v == null || !(med > 0)) { cells.push(null); continue; }
          obs[i]++; const ratio = v / med; cells.push(ratio);
          if (ratio < THRESH.lowRatio) { flagged[i]++; inv_loss += med - v; }
          // single-day dip that recovers on the next DGR
          const nx = rs[di + 1];
          if (ratio < THRESH.dipRatio && nx && nx.inv && nx.inv[i] != null) {
            const nmed = median(nx.inv);
            if (nmed > 0 && nx.inv[i] / nmed >= THRESH.lowRatio) {
              const others = nn(vals.filter((_, j) => j !== i)); const nothers = nn(nx.inv.filter((_, j) => j !== i));
              dips.push({ site: name, inv: i + 1, date: r.date, v, lo: Math.min(...others), hi: Math.max(...others), nextDate: nx.date, nv: nx.inv[i], nlo: Math.min(...nothers), nhi: Math.max(...nothers) });
            }
          }
        }
        heat.push({ date: r.date, cells });
      });
      const persistent = [];
      for (let i = 0; i < invN; i++) if (obs[i] >= THRESH.minObserved && flagged[i] / obs[i] >= THRESH.persistentShare) {
        persistent.push({ inv: i + 1, flagged: flagged[i], observed: obs[i] });
        lowInv.push({ site: name, inv: i + 1, flagged: flagged[i], observed: obs[i] });
      }

      sites[name] = {
        name, ac_kw, dc_kwp, days: rs.length, gen_total,
        ac_cuf_avg: mean(rs.map(r => r.ac_cuf)), dc_cuf_avg: mean(rs.map(r => r.dc_cuf)),
        cuf_derived: rs.some(r => r._d_ac),
        pr_avg: mean(prVals), pr_count: prVals.length,
        sy: ac_kw > 0 ? gen_total / ac_kw : null,
        grid_days: rs.filter(r => r.grid_out_min > 0).length, grid_mins: sum(rs.map(r => r.grid_out_min)),
        plant_days: rs.filter(r => r.plant_out_min > 0).length, plant_mins: sum(rs.map(r => r.plant_out_min)),
        wti_avg: mean(wtiVals), oti_avg: mean(rs.map(r => r.oti)), wti_count: wtiVals.length,
        silica_latest: lastNonNull(rs, 'silica_gel'), mog_latest: lastNonNull(rs, 'mog_level'),
        mc_days: rs.filter(r => r.modules_cleaned > 0).length,
        latest_date: last.date, missing_latest: missing,
        inv_count: invN, inv_loss, persistent, heat,
        daily: rs.map(r => ({ date: r.date, gen: r.gen_kwh, pr: r.pr, ac_cuf: r.ac_cuf })),
      };
    });

    const S = Object.values(sites);
    const latestRows = rows.filter(r => r.date === latest);
    const trend = dates.map(d => {
      const dr = rows.filter(r => r.date === d);
      const pr = mean(dr.map(r => r.pr));
      return { date: d, gen: sum(dr.map(r => r.gen_kwh)), loss: pr == null ? null : 100 - pr, wti: mean(dr.map(r => r.wti)), oti: mean(dr.map(r => r.oti)), grid: sum(dr.map(r => r.grid_out_min)), sites: dr.length };
    });
    const reasons = {};
    rows.forEach(r => { if (!r.grid_out_reason) return; String(r.grid_out_reason).split(/[,;\/+&]|\band\b/i).map(s => s.trim()).filter(Boolean).forEach(s => {
      const k = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); reasons[k] = (reasons[k] || 0) + 1; }); });
    const kw = KEYWORDS.map(([label, re]) => ({ label,
      range: rows.filter(r => re.test((r.activity || '') + ' ' + (r.remarks || ''))).length,
      latest: latestRows.filter(r => re.test((r.activity || '') + ' ' + (r.remarks || ''))).length }));
    const blankLatest = COMPLETENESS_FIELDS.map(k => ({ key: k, label: FIELD_LABEL[k], blank: latestRows.filter(r => blankField(r, k)).length }))
      .sort((a, b) => b.blank - a.blank);
    const allPr = nn(rows.map(r => r.pr));
    const totalAc = sum(S.map(s => s.ac_kw));
    const allSites = [...new Set(allRows.map(r => r.site))];

    return {
      from: dates[0] || from, to: latest, dates, latest, sites, siteNames: Object.keys(sites),
      allSiteNames: allSites.sort((a, b) => a.localeCompare(b)),
      kpi: {
        gen: sum(S.map(s => s.gen_total)),
        dc_cuf: mean(S.map(s => s.dc_cuf_avg)), ac_cuf: mean(S.map(s => s.ac_cuf_avg)),
        sy: totalAc > 0 ? sum(S.map(s => s.ac_kw > 0 ? s.gen_total : null)) / totalAc : null,
        loss: allPr.length ? 100 - mean(allPr) : null, prRows: allPr.length, rows: rows.length,
        gridEvents: rows.filter(r => r.grid_out_min > 0).length, gridMins: sum(rows.map(r => r.grid_out_min)),
        latestSubmitted: latestRows.length,
        latestComplete: latestRows.filter(r => COMPLETENESS_FIELDS.every(k => !blankField(r, k))).length,
      },
      trend,
      wtiLatest: latestRows.filter(r => r.wti != null).sort((a, b) => b.wti - a.wti).map(r => ({ site: r.site, wti: r.wti, oti: r.oti })),
      reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
      keywords: kw,
      blankLatest,
      notSubmittedLatest: allSites.filter(s => !latestRows.some(r => r.site === s)).sort(),
      lowInv: lowInv.sort((a, b) => b.flagged / b.observed - a.flagged / a.observed),
      dips: dips.sort((a, b) => a.date < b.date ? 1 : -1),
      pm: {
        noMc: S.filter(s => s.mc_days === 0).length, noPr: S.filter(s => s.pr_count === 0).length,
        noWti: S.filter(s => s.wti_count === 0).length,
        silicaChanged: S.filter(s => s.silica_latest && /orange|pink|white|saturat|change/i.test(s.silica_latest)).length,
      },
    };
  }

  // ---------- Demo data (clearly synthetic) ----------
  function sampleRows() {
    let seed = 20260901; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const sites = [['Demo Site A', 4000, 5600, 16], ['Demo Site B', 2520, 3500, 10], ['Demo Site C', 2000, 2400, 8], ['Demo Site D', 1520, 2100, 6],
      ['Demo Site E', 2800, 3900, 12], ['Demo Site F', 1000, 1400, 4], ['Demo Site G', 2090, 2900, 8], ['Demo Site H', 4000, 5050, 16]];
    const acts = ['String monitoring', 'Plant monitoring', 'Grass cutting', 'SCADA monitoring', 'Inverter monitoring', 'Visual inspection', 'Module cleaning', 'DGR report preparation', 'Camera checking', 'VCB inspection'];
    const reasons = ['Grid failure', 'Grid failure', 'Grid failure', 'Load shedding', 'DISCOM restriction', 'Planned shutdown', 'Others'];
    const rows = [];
    for (let d = 1; d <= 30; d++) {
      const date = '2026-09-' + pad(d);
      const sky = 0.55 + 0.45 * Math.abs(Math.sin(d * 1.7)) * (0.8 + 0.2 * rnd());
      sites.forEach(([site, ac, dc, nInv], si) => {
        const grid = rnd() < 0.35 ? Math.round(10 + rnd() * 140) : 0;
        const gen = Math.round(dc * 4.3 * sky * (0.9 + 0.08 * rnd()) * (1 - grid / 720));
        const inv = []; const per = gen / nInv;
        for (let i = 0; i < nInv; i++) {
          let v = per * (0.94 + 0.1 * rnd());
          if (si === 0 && i === 9) v *= 0.55;            // persistently low inverter
          if (si === 4 && i === 2 && d === 14) v = 0;     // one-day trip that recovers
          inv.push(Math.round(v));
        }
        const prLogged = si % 3 !== 2;
        rows.push(finishRow({
          site, date, ac_kw: ac, dc_kwp: dc, gen_kwh: gen, dc_cuf: round(gen / (dc * 24) * 100, 2), ac_cuf: round(gen / (ac * 24) * 100, 2),
          pr: prLogged ? round(76 + 8 * rnd(), 2) : null, poa: prLogged ? round(5.4 * sky, 2) : null,
          peak_rad: rnd() < 0.6 ? Math.round(850 + 250 * sky) : null, amb_temp: rnd() < 0.4 ? round(29 + 6 * rnd(), 1) : null,
          grid_out_min: grid, grid_out_reason: grid ? reasons[Math.floor(rnd() * reasons.length)] : null,
          plant_out_min: rnd() < 0.08 ? Math.round(20 + rnd() * 120) : 0,
          wti: si === 5 ? null : round(55 + 12 * sky + 6 * rnd() + (si === 1 ? 12 : 0), 1), oti: si === 5 ? null : round(50 + 10 * sky + 5 * rnd() + (si === 1 ? 9 : 0), 1),
          silica_gel: d > 20 && si % 4 === 1 ? 'Orange' : 'Blue', mog_level: 'Between 1/4 & 1/2',
          modules_cleaned: si % 2 === 0 && d % 7 === si % 7 ? Math.round(dc / 0.55 / 4) : null, total_modules: rnd() < 0.2 ? Math.round(dc / 0.55) : null,
          activity: [acts[Math.floor(rnd() * acts.length)], acts[Math.floor(rnd() * acts.length)]].join(', '),
          remarks: rnd() < 0.5 ? (rnd() < 0.15 ? 'LA damaged at array 3, replacement requested' : 'Plant running normal') : null,
          inv,
        }, { derived: { ac_cuf: 0, dc_cuf: 0 } }));
      });
    }
    return rows;
  }

  // ---------- Template ----------
  function templateHeaders(invCount) {
    const h = FIELDS.map(f => f.label);
    for (let i = 1; i <= (invCount || 20); i++) h.push('Inv ' + i + ' kWh');
    return h;
  }

  // Rows as plain objects: canonical keys (site, date, gen_kwh …) or the DGR app's own column names
  // ("Site Name", "Total Generation (kWh)", "Inv 1 (kWh)" …). Either works.
  function rowsFromObjects(list) {
    list = (list || []).filter(o => o && typeof o === 'object');
    if (!list.length) return { rows: [], report: { sheets: [], found: {}, missing: [], warnings: ['No rows received'], derived: { ac_cuf: 0, dc_cuf: 0 } } };
    if ('site' in list[0] && 'date' in list[0]) return parseJsonRows(list);
    const keys = [...new Set(list.flatMap(o => Object.keys(o)))];
    return parseSheets({ 'DGR app': [keys].concat(list.map(o => keys.map(k => o[k] === '' ? null : o[k]))) });
  }

  const api = { median, mean, sum, nn, round, isBlank, rowsFromObjects, FIELDS, FIELD_LABEL, COMPLETENESS_FIELDS, THRESH, KEYWORDS, parseSheets, parseJsonRows, mergeRows, pack, unpack, compute, sampleRows, templateHeaders, toDate, toNum, mapHeaders, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DGR = api;
})(typeof window !== 'undefined' ? window : globalThis);
