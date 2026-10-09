/* Stockwell DGR Dashboard — operations analysis (loss, issues, status).
 * Builds on engine.js. Pure functions, no DOM. Every estimate states its rule in METHOD. */
(function (root) {
  'use strict';
  const D = root.DGR || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const { median, mean, sum, nn } = D;

  const DEFAULTS = {
    genHours: 10,        // generating hours per day used to turn outage minutes into kWh
    invLow: 0.70,        // inverter "low": below 70% of the site's reference kWh/kWp
    invUnder: 0.90,      // inverter "under-performing": below 90%
    invNoise: 0.95,      // shortfall only counted below 95% (ignores normal spread)
    siteGapHigh: 0.85,   // site 7-day yield below 85% of the portfolio median → high
    siteGapMed: 0.92,    // below 92% → medium
    wtiWatch: 80, otiWatch: 75,   // transformer temperature watch levels, °C
    gridWeekMin: 600,    // grid outage minutes in the last 7 days to raise an issue
    tariff: null,        // ₹/kWh, optional
  };

  const REMARK_CATS = [
    { key: 'protection', label: 'Protection / switchgear', sev: 'high', re: /\bvcb\b|relay|isolator|\bla\b|lightning|insulator|annunciator|power\s*pack|\bct\b|\bpt\b|breaker|\bacb\b|\bmccb\b|ht\s*pan|lt\s*pan/i },
    { key: 'transformer', label: 'Transformer / IDT', sev: 'high', re: /\bidt\b|transformer|bushing|neutral|netural|marshal|oil\s*leak/i },
    { key: 'silica', label: 'Silica gel replacement', sev: 'medium', re: /silica|silika/i },
    { key: 'earthing', label: 'Earthing', sev: 'high', re: /earth/i },
    { key: 'inverter', label: 'Inverter alarm / fault', sev: 'high', re: /inv\w*\.?\s*(no\.?\s*)?\d+[^.;\/]{0,40}(alarm|fault|trip|off|not)|under\s*voltage|undervoltage|over\s*voltage|igbt|inverter\s*(fault|trip|off|not)/i },
    { key: 'strings', label: 'Strings / modules pending', sev: 'medium', re: /strings?\s*(pending|not\s*conn|open|fault|issue|damag|burn|disconn|work)|pending\s*(string|table|module)|tables?\s*pending|modules?\s*(pending|broken|damag|crack|required)|tou?rque/i },
    { key: 'scada', label: 'SCADA / communication', sev: 'medium', re: /scada|internet|network|portal|\bups\b|\bwms\b|\brms\b|data\s*logger/i },
    { key: 'vegetation', label: 'Grass / vegetation / shadow', sev: 'medium', re: /grass|vegetation|tree|shadow|bush/i },
    { key: 'cleaning', label: 'Module cleaning / water', sev: 'medium', re: /cleaning|water\s*(tank|supply|not|requ|short)|module\s*wash/i },
    { key: 'grid', label: 'Grid / transmission line', sev: 'medium', re: /\btl\b|line\s*maint|feeder|\bgss\b|discom|11\s*kv|33\s*kv/i },
    { key: 'civil', label: 'Civil / security / lighting', sev: 'low', re: /camera|cctv|fenc|boundary|wall|gravel|street\s*light|gate|lock|road|theft/i },
  ];
  const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

  const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
  // "1/8/2026, 9:14:34 pm" (day/month/year) → epoch ms in IST-agnostic local time terms
  function parseStamp(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!m) return null;
    let h = +m[4]; const ap = (m[7] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    return Date.UTC(+m[3], +m[2] - 1, +m[1], h, +m[5], +(m[6] || 0));
  }
  const eventsOf = s => s ? String(s).split(/[;,]/).map(x => x.trim()).filter(Boolean) : [];
  const isWeatherOnly = t => /^(remarks\s*:?-?\s*)?((today\s*)?(morning\s*time\s*)?weather|fully|dark|partly|cloudy|sunny|rain|haz)[^]*$/i.test(t) && !REMARK_CATS.some(c => c.re.test(t));

  function analyze(allRows, from, to, opts, master) {
    const S = Object.assign({}, DEFAULTS, opts || {});
    const inRange = allRows.filter(r => (!from || r.date >= from) && (!to || r.date <= to));
    const dates = [...new Set(inRange.map(r => r.date))].sort();
    const latest = dates[dates.length - 1] || null;
    const allSites = [...new Set(allRows.map(r => r.site))].sort((a, b) => a.localeCompare(b));
    const rangeSites = [...new Set(inRange.map(r => r.site))].sort((a, b) => a.localeCompare(b));

    // ---- Benchmark: what this site should have made that day, as DC CUF ----
    // 1) median DC CUF of its nearby sites (master.sites[x].peers, same weather) when 3+ reported that day;
    // 2) for isolated sites, its own 75th-percentile DC CUF over the previous 30 days (outage days excluded);
    // 3) without site master data, the portfolio median (as before).
    const dcOf = r => r.dc_kwp > 0 ? r.dc_kwp : null;
    const MS = master && master.sites ? master.sites : null;
    const byDay = {}, bySiteRows = {};
    allRows.forEach(r => { const c = r.gen_kwh != null && dcOf(r) ? r.gen_kwh / dcOf(r) / 24 : null; if (c != null) (byDay[r.date] = byDay[r.date] || {})[r.site] = c; (bySiteRows[r.site] = bySiteRows[r.site] || []).push(r); });
    Object.values(bySiteRows).forEach(a => a.sort((x, y) => x.date < y.date ? -1 : 1));
    const pmCache = {};
    const portfolioMed = d => { if (d in pmCache) return pmCache[d]; const v = Object.values(byDay[d] || {}).filter(x => x > 0); return (pmCache[d] = v.length >= 5 ? median(v) : null); };
    const ownBase = (site, d) => {   // portfolio median today × this site's usual ratio to it (previous 180 days, outage days excluded)
      const pm = portfolioMed(d); if (!pm) return null;
      const lo = addDays(d, -180), v = [];
      (bySiteRows[site] || []).forEach(r => { if (r.date >= lo && r.date < d && r.gen_kwh > 0 && dcOf(r) && (r.grid_out_min || 0) + (r.plant_out_min || 0) <= 60) { const q = portfolioMed(r.date); if (q) v.push(r.gen_kwh / dcOf(r) / 24 / q); } });
      return v.length >= 15 ? pm * median(v) : null;
    };
    const expectedCuf = (site, d) => {
      const m = MS && MS[site];
      if (m && m.peers && m.peers.length) { const v = m.peers.map(p => (byDay[d] || {})[p]).filter(x => x != null && x > 0); if (v.length >= 3) return { cuf: median(v), basis: 'peers' }; }
      if (m && m.colocated && m.colocated.length) { const v = m.colocated.map(p => (byDay[d] || {})[p]).filter(x => x != null && x > 0); if (v.length) return { cuf: median(v), basis: 'colocated' }; }
      if (m) { const b = ownBase(site, d); if (b) return { cuf: b, basis: 'own' }; }
      const pm = portfolioMed(d); return pm ? { cuf: pm, basis: 'portfolio' } : null;
    };
    const seasonal = master && master.seasonal || null;
    const targetCuf = (site, d) => { const m = MS && MS[site]; if (!m || !m.pvsyst || m.pvsystExcluded) return null; const f = seasonal ? seasonal[d.slice(5, 7)] : 1; return f ? m.pvsyst * f : null; };
    const peer = {}; dates.forEach(d => { const pm = portfolioMed(d); peer[d] = pm != null ? pm * 24 : null; });

    const sites = {}; const issues = []; const inverters = []; const dips = [];
    rangeSites.forEach(name => {
      const rs = inRange.filter(r => r.site === name).sort((a, b) => a.date < b.date ? -1 : 1);
      const last = rs[rs.length - 1];
      const lastDgr = rs.slice().reverse().find(r => r._src !== 'cuf') || last;
      const dc = D.median(rs.map(r => r.dc_kwp)) || null, ac = D.median(rs.map(r => r.ac_kw)) || null;
      const invN = Math.max(0, ...rs.map(r => (r.inv || []).length));
      const inv = Array.from({ length: invN }, (_, i) => ({ site: name, inv: i + 1, dc: null, obs: 0, low: 0, under: 0, zero: 0, short: 0, piSum: 0, days: [] }));
      const daily = rs.map(r => {
        const sy = r.gen_kwh != null && dcOf(r) ? r.gen_kwh / dcOf(r) : null;
        const E = expectedCuf(name, r.date); const p = E ? E.cuf * 24 : null;
        const tc = targetCuf(name, r.date);
        const pi = sy != null && p ? sy / p : null;
        // inverter reference: median kWh/kWp across this site's inverters that day (DC-normalised when DC kW is known)
        const vals = r.inv || [], dcs = r.inv_dc || [];
        const useDc = dcs.filter((v, i) => v > 0 && vals[i] != null).length >= Math.max(2, nn(vals).length - 1);
        const ys = vals.map((v, i) => v == null ? null : useDc ? (dcs[i] > 0 ? v / dcs[i] : null) : v);
        const ref = median(ys.filter(v => v != null && v > 0));
        let invLoss = 0; const cells = [];
        for (let i = 0; i < invN; i++) {
          const y = ys[i];
          if (y == null || !(ref > 0)) { cells.push(null); inv[i].days.push(null); continue; }
          const k = y / ref; cells.push(k); const I = inv[i];
          if (useDc && dcs[i] > 0) I.dc = dcs[i];
          if (!(y == null || !(ref > 0))) { /* reference kept per day for drill-down */ }
          const dci = useDc && dcs[i] > 0 ? dcs[i] : null; const dl = k < S.invNoise ? (ref - y) * (useDc ? dcs[i] : 1) : 0;
          I.obs++; I.piSum += k; I.gen = (I.gen || 0) + (vals[i] || 0); I.days.push({ date: r.date, k, v: vals[i], loss: dl, cuf: dci ? vals[i] / dci / 24 : null });
          if (k === 0) I.zero++;
          if (k < S.invLow) I.low++;
          if (k < S.invUnder) I.under++;
          if (k < S.invNoise) { const s = (ref - y) * (useDc ? dcs[i] : 1); I.short += s; invLoss += s; }
        }
        // Loss = shortfall against the portfolio median yield, attributed in order:
        // inverters (measured) → plant outage → grid outage (estimated from minutes) → unexplained.
        const genMin = S.genHours * 60;
        const gridMin = Math.min(r.grid_out_min || 0, genMin), plantMin = Math.min(r.plant_out_min || 0, genMin - gridMin);
        const expected = p && dcOf(r) ? p * dcOf(r) : null;
        const actual = r.gen_kwh != null ? r.gen_kwh : (gridMin + plantMin > 0 ? 0 : null);
        const short = expected != null && actual != null ? Math.max(0, expected - actual) : 0;
        const invL = Math.min(invLoss, short); let rem = short - invL;
        const outEst = expected != null ? expected / genMin * (gridMin + plantMin) : 0;
        const outL = Math.min(outEst, rem); rem -= outL;
        const plantLoss = gridMin + plantMin ? outL * plantMin / (gridMin + plantMin) : 0, gridLoss = outL - plantLoss;
        const resid = rem;
        invLoss = invL;
        return { date: r.date, gen: r.gen_kwh, sy, cuf: sy != null ? sy / 24 : null, peer: p, basis: E && E.basis, exp: expected, tcuf: tc, tkwh: tc != null && dcOf(r) ? tc * 24 * dcOf(r) : null, pi, pr: r.pr, ac_cuf: r.ac_cuf, grid: r.grid_out_min || 0, gridEv: eventsOf(r.grid_out_reason).length || (r.grid_out_min > 0 ? 1 : 0),
          plant: r.plant_out_min || 0, faults: r.fault_codes, amb: r.amb_temp, mod: r.module_temp, weather: r.weather, rain: r.rain, wti: r.wti, oti: r.oti, remarks: r.remarks, activity: r.activity,
          invLoss, gridLoss, plantLoss, resid, cells, row: r };
      });
      const loss = { inv: sum(daily.map(d => d.invLoss)), measuredInv: sum(inv.map(I => I.short)), grid: sum(daily.map(d => d.gridLoss)), plant: sum(daily.map(d => d.plantLoss)), resid: sum(daily.map(d => d.resid)) };
      loss.total = loss.inv + loss.grid + loss.plant + loss.resid;
      const gen = sum(rs.map(r => r.gen_kwh));
      const last7 = daily.filter(d => d.date > addDays(latest, -7));
      const pi7 = mean(last7.map(d => d.pi));
      inv.forEach(I => { I.avg = I.obs ? I.piSum / I.obs : null; });

      // ---- issues for this site ----
      const add = (sev, cat, title, detail, since, kwh) => issues.push({ site: name, sev, cat, title, detail, since, days: since ? daysBetween(since, latest) + 1 : null, kwh: kwh || 0, last: last.date });
      const submittedLatest = last.date === latest;
      if (!submittedLatest) add('high', 'DGR', 'DGR not submitted', `Last DGR ${last.date}`, addDays(last.date, 1), 0);
      inv.forEach(I => {
        const ds = I.days.filter(Boolean); if (!ds.length) return;
        const lastD = ds[ds.length - 1]; if (lastD.date !== last.date) return;
        let streak = 0; for (let j = ds.length - 1; j >= 0 && ds[j].k < S.invLow; j--) { streak++; }
        const startDate = streak ? ds[ds.length - streak].date : null;
        if (lastD.k === 0 || (lastD.v === 0)) {
          let z = 0; for (let j = ds.length - 1; j >= 0 && ds[j].k === 0; j--) z++;
          add('critical', 'Inverter', `Inv ${I.inv} not generating`, `0 kWh on ${lastD.date}${z > 1 ? `, ${z} days running` : ''}`, ds[ds.length - z].date, 0);
        } else if (streak >= 3) {
          add(streak >= 7 ? 'critical' : 'high', 'Inverter', `Inv ${I.inv} low output`, `${Math.round(lastD.k * 100)}% of site reference on ${lastD.date}; below ${Math.round(S.invLow * 100)}% for ${streak} days`, startDate, I.short * streak / Math.max(1, I.obs));
        } else {
          const w = ds.slice(-7); if (w.length >= 5 && w.every(x => x.k < S.invUnder)) add('medium', 'Inverter', `Inv ${I.inv} under-performing`, `Avg ${Math.round(mean(w.map(x => x.k)) * 100)}% of site reference over last ${w.length} DGRs`, w[0].date, I.short * w.length / Math.max(1, I.obs));
        }
        inverters.push(I);
        for (let j = 0; j < ds.length - 1; j++) {
          const a = ds[j], b = ds[j + 1];
          if (a.k < 0.3 && b.k >= S.invLow && daysBetween(a.date, b.date) <= 2) dips.push({ site: name, inv: I.inv, date: a.date, k: a.k, v: a.v, nextDate: b.date, nk: b.k, nv: b.v });
        }
      });
      const td = daily[daily.length - 1];
      if (submittedLatest && td.pi != null && td.pi < 0.6) {
        const why = [td.grid ? td.grid + ' min grid outage' : '', td.plant ? td.plant + ' min plant outage' : '', td.weather ? td.weather.toLowerCase() : ''].filter(Boolean).join(', ');
        add('high', 'Yield', 'Very low generation', `${Math.round(td.pi * 100)}% of its benchmark (${td.basis === 'peers' ? 'nearby sites' : td.basis === 'colocated' ? 'the plant at the same location' : td.basis === 'own' ? 'its usual level vs the portfolio' : 'portfolio median'}) on ${td.date}${why ? ' (' + why + ')' : ''}`, td.date, td.invLoss + td.gridLoss + td.plantLoss + td.resid);
      }
      if (pi7 != null && pi7 < S.siteGapMed) {
        add(pi7 < S.siteGapHigh ? 'high' : 'medium', 'Yield', 'Below nearby sites', `Last 7 days at ${Math.round(pi7 * 100)}% of the benchmark DC CUF${MS && MS[name] && MS[name].peers && MS[name].peers.length ? ' (median of ' + MS[name].peers.length + ' nearby sites)' : ''}`, last7[0] && last7[0].date, sum(last7.map(d => d.pi < 1 ? (d.peer - d.sy) * dcOf(d.row) : 0)));
      }
      const recentFault = daily.filter(d => d.date > addDays(latest, -3) && (d.faults || d.plant > 0));
      if (recentFault.length) {
        const f = recentFault[recentFault.length - 1];
        add(f.plant > 60 ? 'high' : 'medium', 'Plant', 'Plant outage / fault', `${f.date}: ${f.plant ? f.plant + ' min plant outage' : ''}${f.faults ? (f.plant ? ', ' : '') + 'fault codes: ' + [...new Set(eventsOf(f.faults))].join(', ') : ''}`, recentFault[0].date, sum(recentFault.map(d => d.plantLoss)));
      }
      const gw = sum(last7.map(d => d.grid));
      if (gw >= S.gridWeekMin) add(gw >= 2 * S.gridWeekMin ? 'high' : 'medium', 'Grid', 'Frequent grid outages', `${Math.round(gw)} min and ${sum(last7.map(d => d.gridEv))} trips in the last 7 days`, last7[0].date, sum(last7.map(d => d.gridLoss)));
      if (lastDgr.wti != null && lastDgr.wti >= S.wtiWatch || lastDgr.oti != null && lastDgr.oti >= S.otiWatch) {
        let k = 0; for (let j = rs.length - 1; j >= 0 && (rs[j].wti >= S.wtiWatch || rs[j].oti >= S.otiWatch); j--) k++;
        add('high', 'Transformer', 'Transformer temperature high', `WTI ${lastDgr.wti ?? '—'} °C, OTI ${lastDgr.oti ?? '—'} °C on ${lastDgr.date} (watch ${S.wtiWatch}/${S.otiWatch} °C)`, rs[rs.length - Math.max(1, k)].date, 0);
      }
      const silica = lastDgr.silica_gel;
      if (silica && !/blue/i.test(silica)) { let k = 0; for (let j = rs.length - 1; j >= 0 && rs[j].silica_gel && !/blue/i.test(rs[j].silica_gel); j--) k++;
        add('medium', 'Transformer', 'Silica gel saturated', `${silica} on ${lastDgr.date}; replace breather silica gel`, rs[rs.length - Math.max(1, k)].date, 0); }
      if (lastDgr.mog_level && /at\s*1\/4|below/i.test(lastDgr.mog_level)) add('medium', 'Transformer', 'Transformer oil level low', `MOG ${lastDgr.mog_level} on ${lastDgr.date}`, lastDgr.date, 0);
      // remarks → recurring field issues
      const remarkRows = rs.filter(r => r.remarks && !isWeatherOnly(r.remarks)); const seenLines = new Set();
      REMARK_CATS.forEach(c => {
        const hits = remarkRows.filter(r => c.re.test(r.remarks)); if (!hits.length) return;
        const lastHit = hits[hits.length - 1]; if (lastHit.date <= addDays(lastDgr.date, -3)) return;
        const line = String(lastHit.remarks).split(/\n|\/|\.\s|;|(?:^|\s)\d+[.)]\s/).map(s => s.trim()).find(s => c.re.test(s)) || lastHit.remarks;
        const keyLine = line.toLowerCase().replace(/\W+/g, ''); if (seenLines.has(keyLine)) return; seenLines.add(keyLine);
        add(c.sev, 'Field: ' + c.label, c.label, `"${line.slice(0, 140)}" (reported on ${hits.length} DGR${hits.length > 1 ? 's' : ''})`, hits[0].date, 0);
      });

      // submission discipline
      const subs = rs.map(r => { const t = parseStamp(r.submitted_at); if (t == null) return null; return (t - Date.parse(r.date + 'T00:00:00Z')) / 36e5; }).filter(v => v != null);
      const revs = rs.map(r => { const a = parseStamp(r.submitted_at), b = parseStamp(r.reviewed_at); return a != null && b != null ? (b - a) / 36e5 : null; }).filter(v => v != null);
      const submitters = {}; rs.forEach(r => { if (r.submitted_by) submitters[r.submitted_by] = (submitters[r.submitted_by] || 0) + 1; });

      const siteIssues = issues.filter(i => i.site === name);
      const worst = siteIssues.reduce((m, i) => Math.min(m, SEV_RANK[i.sev]), 9);
      const invActive = inv.filter(I => I.obs > 0).length;
      sites[name] = { name, dc, ac, invN: invActive, invCols: invN, days: rs.length, gen, loss, lossPct: gen + loss.total > 0 ? loss.total / (gen + loss.total) * 100 : null,
        sy: dc ? gen / dc : null, syAc: ac ? gen / ac : null, pi: mean(daily.map(d => d.pi)), pi7, pr: mean(rs.map(r => r.pr)), prDays: nn(rs.map(r => r.pr)).length,
        ac_cuf: mean(rs.map(r => r.ac_cuf)), dc_cuf: mean(rs.map(r => r.dc_cuf)), grid: sum(daily.map(d => d.grid)), gridEv: sum(daily.map(d => d.gridEv)), plant: sum(daily.map(d => d.plant)),
        latest: last.date, today: daily[daily.length - 1], submittedLatest, wti: lastDgr.wti, oti: lastDgr.oti, wtiMax7: Math.max(-Infinity, ...nn(rs.slice(-7).map(r => r.wti))), silica, mog: lastDgr.mog_level, latestDgr: lastDgr.date,
        ambAvg: mean(rs.map(r => r.amb_temp)), ambMax: Math.max(-Infinity, ...nn(rs.map(r => r.amb_temp))), ambDays: nn(rs.map(r => r.amb_temp)).length, modAvg: mean(rs.map(r => r.module_temp)), modMax: Math.max(-Infinity, ...nn(rs.map(r => r.module_temp))), modDays: nn(rs.map(r => r.module_temp)).length,
        wtiAvg: mean(rs.map(r => r.wti)), otiAvg: mean(rs.map(r => r.oti)), wtiDays: nn(rs.map(r => r.wti)).length, mcDays: rs.filter(r => r.modules_cleaned > 0).length, plantDays: rs.filter(r => r.plant_out_min > 0).length, gridDays: rs.filter(r => r.grid_out_min > 0).length,
        status: worst <= 0 ? 'red' : worst === 1 ? 'red' : worst === 2 ? 'amber' : 'green', worst, issues: siteIssues.length,
        subHours: median(subs), sameDay: subs.length ? subs.filter(h => h < 24).length / subs.length : null, reviewHours: median(revs),
        submitters: Object.entries(submitters).sort((a, b) => b[1] - a[1]).map(x => x[0]),
        missing: D.COMPLETENESS_FIELDS.filter(k => k === 'inv' ? !(lastDgr.inv || []).some(v => v != null) : lastDgr[k] == null),
        peers: MS && MS[name] ? MS[name].peers || [] : [], colocated: MS && MS[name] ? MS[name].colocated || [] : [], peerKm: MS && MS[name] ? MS[name].peerKm || [] : [], tariff: MS && MS[name] ? MS[name].tariff : null, pvsyst: MS && MS[name] ? MS[name].pvsyst : null, pvsystExcluded: MS && MS[name] ? MS[name].pvsystExcluded : null,
        cuf: dc ? gen / (dc * 24 * Math.max(1, rs.filter(r => r.gen_kwh != null).length)) : null,
        target: (() => { const t = daily.filter(d => d.tkwh != null); if (!t.length) return null; const tk = sum(t.map(d => d.tkwh)), ak = sum(t.map(d => d.gen)); return { kwh: tk, actual: ak, dev: ak - tk, devPct: (ak - tk) / tk * 100, cuf: mean(t.map(d => d.tcuf)), days: t.length }; })(),
        daily, inv };
    });
    allSites.filter(s => !sites[s]).forEach(s => issues.push({ site: s, sev: 'high', cat: 'DGR', title: 'No DGR in selected range', detail: 'No rows for this site in the selected dates', since: null, days: null, kwh: 0 }));

    issues.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev] || b.kwh - a.kwh || (b.days || 0) - (a.days || 0));
    const Sx = Object.values(sites);
    const L = { inv: sum(Sx.map(s => s.loss.inv)), grid: sum(Sx.map(s => s.loss.grid)), plant: sum(Sx.map(s => s.loss.plant)), resid: sum(Sx.map(s => s.loss.resid)) };
    L.total = L.inv + L.grid + L.plant + L.resid;
    const gen = sum(Sx.map(s => s.gen));
    const dayIx = {}; Sx.forEach(s => s.daily.forEach(x => { (dayIx[x.date] = dayIx[x.date] || []).push(x); }));
    const trend = dates.map(d => {
      const ds = dayIx[d] || [];
      return { date: d, gen: sum(ds.map(x => x.gen)), peer: peer[d], exp: sum(ds.map(x => x.exp)), tkwh: sum(ds.map(x => x.tkwh)), tgen: sum(ds.filter(x => x.tkwh != null).map(x => x.gen)),
        cuf: (() => { const dc = sum(ds.map(x => x.gen != null ? dcOf(x.row) : 0)); return dc ? sum(ds.map(x => x.gen)) / dc / 24 : null; })(), inv: sum(ds.map(x => x.invLoss)), grid: sum(ds.map(x => x.gridLoss)), plant: sum(ds.map(x => x.plantLoss)), resid: sum(ds.map(x => x.resid)),
        sites: ds.length, wti: mean(ds.map(x => x.wti)), oti: mean(ds.map(x => x.oti)), amb: mean(ds.map(x => x.amb)), mod: mean(ds.map(x => x.mod)), gridMin: sum(ds.map(x => x.grid)), sunny: ds.filter(x => /sunny/i.test(x.weather || '')).length };
    });
    const lastT = trend[trend.length - 1] || {};
    const prev7 = trend.filter(t => t.date < latest && t.date >= addDays(latest, -7));
    const sevCount = { critical: 0, high: 0, medium: 0, low: 0 }; issues.forEach(i => sevCount[i.sev]++);
    const cats = {}; issues.forEach(i => { cats[i.cat] = (cats[i.cat] || 0) + 1; });
    const reviewers = {}; inRange.forEach(r => { if (r.reviewed_by) reviewers[r.reviewed_by] = (reviewers[r.reviewed_by] || 0) + 1; });

    dips.sort((a, b) => a.date < b.date ? 1 : -1);
    return { S, from: dates[0], to: latest, dates, latest, allSites, siteNames: rangeSites, sites, issues, inverters, dips, trend, sevCount, cats,
      reviewers: Object.entries(reviewers).sort((a, b) => b[1] - a[1]),
      kpi: { gen, loss: L, lossPct: gen + L.total > 0 ? L.total / (gen + L.total) * 100 : 0, sy: sum(Sx.map(s => s.dc ? s.gen : 0)) / sum(Sx.map(s => s.dc || 0)),
        pr: mean(inRange.map(r => r.pr)), prRows: nn(inRange.map(r => r.pr)).length, rows: inRange.length,
        today: lastT.gen, avg7: mean(prev7.map(t => t.gen)), todaySites: lastT.sites, red: Sx.filter(s => s.status === 'red').length + allSites.filter(s => !sites[s]).length,
        amber: Sx.filter(s => s.status === 'amber').length, green: Sx.filter(s => s.status === 'green').length,
        gridMin: sum(Sx.map(s => s.grid)), gridEv: sum(Sx.map(s => s.gridEv)),
        cuf: (() => { const dcd = sum(Sx.map(s => (s.dc || 0) * s.daily.filter(d => d.gen != null).length)); return dcd ? gen / dcd / 24 : null; })(),
        target: (() => { const T = Sx.filter(s => s.target); if (!T.length) return null; const tk = sum(T.map(s => s.target.kwh)), ak = sum(T.map(s => s.target.actual)); return { sites: T.length, kwh: tk, actual: ak, dev: ak - tk, devPct: (ak - tk) / tk * 100 }; })() },
      REMARK_CATS };
  }

  const METHOD = [
    ['DC CUF', 'Generation ÷ (DC kWp × 24 h). Removes the effect of plant size; used everywhere because irradiance is not measured at the sites.'],
    ['Benchmark', 'What the site should have made that day. Median DC CUF of its nearby sites (same weather, within 75 km, or the nearest 3 within 150 km) when at least 3 of them reported; otherwise the plant(s) at the same location (within 5 km). Sites with no neighbours use the portfolio median that day × their usual ratio to it over the previous 180 days (outage days excluded), so they flag new problems rather than location differences.'],
    ['Performance', 'Site DC CUF ÷ benchmark DC CUF. 100% = performing like its neighbours; 90% = 10% less than them.'],
    ['Target', 'PVsyst annual DC CUF × the month\'s seasonal factor (each month\'s portfolio median DC CUF ÷ the 12-month average, Oct 2025–Sep 2026). Sites without a PVsyst value have no target.'],
    ['Inverter reference', 'Median kWh per kWp of DC across the site\'s inverters that day, using each inverter\'s DC kW from the DGR, so inverters of different sizes are compared fairly.'],
    ['Loss', 'Shortfall = benchmark − actual (never below zero), attributed in order: inverters below 95% of reference (measured), then plant and grid outage minutes × benchmark kWh per generating minute ({genHours}-hour day), then unexplained (soiling, shading, open strings, degradation).'],
  ];

  // ---------- Equipment maintenance schedule ----------
  // freq = days between preventive checks. "done" = words in Daily Activity/Remarks that show work was carried out (not just monitoring or a request).
  const EQUIPMENT = [
    { key: 'idt', name: 'IDT (transformer)', freq: 30, what: 'Oil level, silica gel, WTI/OTI, leaks, bushing, earthing', re: /\bidt\b|transformer|\btf\b|\bt\s*\/?\s*f\b|oil\s*top|silica|breather|\bmog\b|oti|wti/i },
    { key: 'hpole', name: 'H-pole', freq: 90, what: 'GO switch, LA, DO fuse, insulators, earthing, jumpers', re: /h[\s-]*pole|\bgo\b\s*(switch)?|\bgos\b|\bab\s*switch|d\.?o\.?\s*fuse|isolator|switch\s*yard|switchyard/i },
    { key: 'vcbp', name: 'Plant side VCB', freq: 90, what: 'Relay, trip test, power pack, annunciator, panel cleaning', re: /(plant\s*side|gss\s*side)?\s*vcb(?!.*inverter\s*side)|\bht\s*panel|relay\s*test/i },
    { key: 'vcbi', name: 'Inverter side VCB', freq: 90, what: 'Relay, trip test, power pack, tightness', re: /(inverter|inv|icr)\s*side\s*vcb|vcb\s*(at|of)\s*(inverter|icr)/i },
    { key: 'inv', name: 'Inverters', freq: 30, what: 'Filters, fans, terminals, DC/AC tightness, alarms, earthing', re: /(inverter|inv\.?|icr)\s*(visual\s*)?(inspection|cleaning|filter|fan|maintenance|pm\b|checking|tightness)|all\s*inverter\s*inspection|icr\s*(area\s*)?visual/i },
    { key: 'mms', name: 'MMS tightness', freq: 180, what: 'Nut-bolt torque, structure alignment, purlins, foundations', re: /\bmms\b|torque|tou?rque|tightness|nut[\s-]*bolt|structure\s*(check|tight|inspection)/i },
    { key: 'ltp', name: 'LT panel', freq: 30, what: 'MCCB/ACB, CT, busbar, terminals, thermography', re: /\blt\s*panel|\bacdb\b|\bltp\b|ht\s*lt\s*panel|\bacb\b|\bmccb\b/i },
    { key: 'mod', name: 'Module inspection', freq: 30, what: 'Broken/hotspot modules, MC4, string checks, cleaning quality', re: /module\s*(inspection|checking|check)|hot\s*spot|hotspot|pv\s*fi?e?ld\s*(area\s*)?checking|field\s*visual\s*inspection|mc4|string\s*(checking|testing|voc|ir\b)/i },
    { key: 'scada', name: 'SCADA', freq: 30, what: 'Communication, data logger, UPS, WMS sensors, internet', re: /(scada|scoda|data\s*logger|\bups\b|wms|rms)\s*(check|checking|maint|repair|inspection|restart|reboot|config|install|work(?!.*monitor))/i },
    { key: 'cctv', name: 'CCTV', freq: 30, what: 'Cameras, NVR, recording, power, cleaning of lens', re: /(cctv|camera|nvr)\s*(check|checking|clean|repair|maint|inspection|install|service\s*done|work)/i },
  ];
  const NOT_DONE = /require|required|requirement|pending|panding|need|not\s*working|faulty|damag|issue|problem/i;
  function maintenance(allRows, opts) {
    const o = Object.assign({ freq: {}, log: [], today: null }, opts || {});
    const sites = [...new Set(allRows.map(r => r.site))].sort((a, b) => a.localeCompare(b));
    const today = o.today || allRows.reduce((m, r) => r.date > m ? r.date : m, '');
    const out = {};
    sites.forEach(s => {
      const rows = allRows.filter(r => r.site === s && r._src !== 'cuf' && (r.activity || r.remarks));
      out[s] = {};
      EQUIPMENT.forEach(eq => {
        const freq = o.freq[eq.key] || eq.freq;
        const auto = rows.filter(r => { const parts = String(r.activity || '').split(/[,\n;\/]|\d+\s*[.)]/).concat(String(r.remarks || '').split(/[,\n;\/]|\d+\s*[.)]/));
          return parts.some(p => eq.re.test(p) && !NOT_DONE.test(p) && !/monitor/i.test(p) || (eq.key === 'idt' && /check/i.test(p) && eq.re.test(p))); }).map(r => ({ date: r.date, by: r.submitted_by, src: 'DGR', text: (r.activity || '').replace(/\s+/g, ' ').slice(0, 120) }));
        const manual = o.log.filter(l => l.site === s && l.eq === eq.key).map(l => ({ date: l.date, by: l.by, src: 'Logged', text: l.note || '' }));
        const all = auto.concat(manual).sort((a, b) => a.date < b.date ? -1 : 1);
        const last = all[all.length - 1] || null;
        const next = last ? addDays(last.date, freq) : null;
        const left = next ? daysBetween(today, next) : null;
        out[s][eq.key] = { freq, last, next, left, count: all.length, history: all, status: !last ? 'none' : left < 0 ? 'overdue' : left <= 7 ? 'due' : 'ok' };
      });
    });
    return { today, sites, eq: EQUIPMENT, by: out };
  }

  const api = { maintenance, EQUIPMENT, analyze, DEFAULTS, METHOD, REMARK_CATS, parseStamp, addDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OPS = api;
})(typeof window !== 'undefined' ? window : globalThis);
