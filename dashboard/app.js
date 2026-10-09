/* Stockwell DGR Dashboard — UI (control-room layout). Depends on engine.js (DGR), ops.js (OPS) and SheetJS (XLSX). */
(function () {
  'use strict';
  const CFG = Object.assign({ apiUrl: null, apiHeaders: {}, dataUrl: 'data/dgr.json', loadRows: null, embed: /[?&]embed\b/.test(location.search), parentOrigin: location.origin, embedWaitMs: 15000 }, window.DGR_CONFIG || {});
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { all: [], saved: [], source: 'sample', meta: {}, pending: null, from: null, to: null, view: 'cc', site: null, A: null,
    invSite: null, invSel: null, mlog: [], mfreq: {}, mrSite: null, mrMonth: null, eqSel: null, master: null, Y: null, Ykey: '', hc: 'bench', mtMonth: null, sev: new Set(['critical', 'high', 'medium']), cat: '', fsite: '', text: '', boardSort: 'status', invF: 'issue' };
  let artifactNs = null, downloadsNs = null, canSave = null;

  // ---------- settings (per viewer) ----------
  const SKEY = 'stockwell-dgr-settings';
  function loadSettings() { try { return Object.assign({}, OPS.DEFAULTS, JSON.parse(localStorage.getItem(SKEY) || '{}')); } catch (e) { return Object.assign({}, OPS.DEFAULTS); } }
  let SET = loadSettings();
  let MODE = 'simple'; try { MODE = localStorage.getItem('stockwell-dgr-mode') || 'simple'; } catch (e) { /* default simple */ }
  const simple = () => MODE === 'simple';
  function applyMode() {
    document.body.classList.toggle('simple', simple());
    document.querySelectorAll('.side button[data-view]').forEach(b => { const sp = b.querySelector('span'); if (!b.dataset.fl) b.dataset.fl = sp.textContent; sp.textContent = simple() && b.dataset.sl ? b.dataset.sl : b.dataset.fl; });
    const ORD = { cc: 1, site: 2, inverters: 3, equip: 4, mreport: 5, targets: 6, data: 7, settings: 8 };
    document.querySelectorAll('.side button[data-view]').forEach(b => { b.style.order = simple() ? (ORD[b.dataset.view] || 20) : ''; });
    const mb = document.getElementById('modeBtn'); if (mb) mb.style.order = simple() ? 30 : '';
    document.querySelectorAll('.side .brand, .side .brand-sub').forEach(x => { x.style.order = simple() ? 0 : ''; });
    const t = document.getElementById('modeTxt'); if (t) t.textContent = simple() ? 'Show all screens' : 'Back to simple view';
  }
  function saveSettings(s) { SET = s; try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) { /* storage blocked */ } }

  // ---------- formatting ----------
  const nf = (v, d = 0) => v == null || isNaN(v) || !isFinite(v) ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const energy = kwh => kwh == null ? '—' : Math.abs(kwh) >= 1e6 ? nf(kwh / 1e6, 2) + ' <small>GWh</small>' : Math.abs(kwh) >= 1e4 ? nf(kwh / 1e3, 1) + ' <small>MWh</small>' : nf(kwh) + ' <small>kWh</small>';
  const energyT = kwh => energy(kwh).replace(/<\/?small>/g, '');
  const inr = r => r == null ? '' : r >= 1e7 ? '₹' + nf(r / 1e7, 2) + ' crore' : r >= 1e5 ? '₹' + nf(r / 1e5, 2) + ' lakh' : '₹' + nf(r);
  const tf = s => (s && s.tariff) || (SET.tariff > 0 ? SET.tariff : null);
  const sumRs = (A, f) => { let r = 0, any = false; Object.values(A.sites).forEach(s => { const t = tf(s); if (t) { any = true; r += f(s) * t; } }); return any ? r : null; };
  const rsTxt = r => r == null ? '' : ' · ' + inr(r);
  const revOf = s => tf(s) ? s.gen * tf(s) : null;
  const tariffOfName = n => (state.master && state.master.sites[n] && state.master.sites[n].tariff) || (SET.tariff > 0 ? SET.tariff : null);
  const revTotals = A => { let r = 0, n = 0, t = 0; Object.values(A.sites).forEach(s => { if (tf(s)) { r += s.gen * tf(s); n++; } t++; }); return { r, n, t }; };
  const rupees = kwh => { if (!(SET.tariff > 0) || kwh == null) return ''; const r = kwh * SET.tariff; return r >= 1e7 ? '₹' + nf(r / 1e7, 2) + ' crore' : r >= 1e5 ? '₹' + nf(r / 1e5, 2) + ' lakh' : '₹' + nf(r); };
  const pct = (v, d = 0) => v == null || isNaN(v) ? '—' : nf(v * 100, d) + '%';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dl = d => d ? (+d.slice(8)) + ' ' + MON[+d.slice(5, 7) - 1] : '—';
  const dly = d => d ? dl(d) + ' ' + d.slice(0, 4) : '—';
  const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const hhmm = h => h == null ? '—' : (h >= 24 ? '+' + Math.floor(h / 24) + 'd ' : '') + String(Math.floor(h % 24)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0');
  const sevPill = s => `<span class="pill sev ${s}">${s}</span>`;
  const LCOL = { inv: '--l-inv', plant: '--l-plant', grid: '--l-grid', resid: '--l-resid' };
  const LLAB = { inv: 'Inverter', plant: 'Plant outage', grid: 'Grid outage', resid: 'Unexplained' };

  // ---------- charts ----------
  function niceTicks(lo, hi, n) {
    if (lo === hi) hi = lo + 1;
    const span = hi - lo, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || 10 * mag;
    const t0 = Math.floor(lo / step) * step, ticks = [];
    for (let t = t0; t <= hi + step * 0.001; t += step) ticks.push(+t.toFixed(10));
    if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }
  const shortNum = v => Math.abs(v) >= 1e6 ? nf(v / 1e6, 1) + 'M' : Math.abs(v) >= 1e3 ? nf(v / 1e3, Math.abs(v) >= 1e4 ? 0 : 1) + 'k' : nf(v, v % 1 ? 1 : 0);
  function frame(el, dates, opt) {
    const W = Math.max(300, Math.round(el.clientWidth || 640)), H = opt.h || (W < 500 ? 190 : 220);
    const m = { l: 46, r: opt.r ? 40 : 12, t: 10, b: 26 };
    return { W, H, m, iw: W - m.l - m.r, ih: H - m.t - m.b };
  }
  function axisY(F, lo, hi, zero) {
    if (zero) lo = Math.min(0, lo);
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 1;
    if (!zero) lo -= pad; hi += pad * 0.5;
    const ticks = niceTicks(lo, hi, 4), a = ticks[0], b = ticks[ticks.length - 1];
    return { ticks, y: v => F.m.t + F.ih - (v - a) / (b - a) * F.ih };
  }
  function attachHover(el, svg, F, n, xOf, html) {
    const tip = el.querySelector('.tip'), hov = el.querySelector('.hov');
    const move = ev => {
      const r = svg.getBoundingClientRect(); const px = (ev.clientX - r.left) / r.width * F.W;
      let i = 0, best = 1e9; for (let k = 0; k < n; k++) { const d = Math.abs(xOf(k) - px); if (d < best) { best = d; i = k; } }
      hov.setAttribute('x1', xOf(i)); hov.setAttribute('x2', xOf(i)); hov.style.display = '';
      tip.hidden = false; tip.style.left = Math.min(Math.max(xOf(i) / F.W * 100, 12), 88) + '%'; tip.style.top = (F.m.t / F.H * r.height) + 'px'; tip.innerHTML = html(i);
    };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => { tip.hidden = true; hov.style.display = 'none'; });
  }
  function lineChart(el, dates, series, opt = {}) {
    if (!el) return;
    if (dates.length < 2) { el.innerHTML = '<p class="desc">Needs at least two days in the selected range.</p>'; return; }
    const F = frame(el, dates, { r: series.some(s => s.axis === 'r') });
    const scale = axis => { const v = series.filter(s => (s.axis || 'l') === axis).flatMap(s => s.vals).filter(x => x != null && isFinite(x)); return v.length ? axisY(F, Math.min(...v), Math.max(...v), opt.zero && axis === 'l') : null; };
    const L = scale('l'), R = F.m.r > 12 ? scale('r') : null;
    if (!L) { el.innerHTML = '<p class="desc">Nothing logged for this in the selected range.</p>'; return; }
    const x = i => F.m.l + i / (dates.length - 1) * F.iw;
    let s = `<svg viewBox="0 0 ${F.W} ${F.H}" role="img" aria-label="${esc(opt.label || 'chart')}">`;
    L.ticks.forEach(t => { const y = L.y(t); s += `<line class="gl" x1="${F.m.l}" x2="${F.W - F.m.r}" y1="${y}" y2="${y}"/><text class="ax" x="${F.m.l - 6}" y="${y + 3.5}" text-anchor="end">${shortNum(t)}${opt.unitL || ''}</text>`; });
    if (R) R.ticks.forEach(t => { s += `<text class="ax" x="${F.W - F.m.r + 6}" y="${R.y(t) + 3.5}">${shortNum(t)}${opt.unitR || ''}</text>`; });
    [0, Math.round((dates.length - 1) / 2), dates.length - 1].forEach((i, k) => { s += `<text class="ax" x="${x(i)}" y="${F.H - 6}" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}">${dl(dates[i])}</text>`; });
    series.forEach((se, si) => {
      const sc = se.axis === 'r' ? R : L; if (!sc) return;
      const segs = []; let cur = [];
      se.vals.forEach((v, i) => { if (v == null || !isFinite(v)) { if (cur.length) segs.push(cur); cur = []; } else cur.push([x(i), sc.y(v)]); });
      if (cur.length) segs.push(cur);
      segs.forEach(seg => {
        if (si === 0 && opt.area && seg.length > 1) s += `<path d="M${seg[0][0]},${F.m.t + F.ih}L${seg.map(p => p.join(',')).join('L')}L${seg[seg.length - 1][0]},${F.m.t + F.ih}Z" style="fill:var(${se.color});fill-opacity:.09;stroke:none"/>`;
        if (seg.length === 1) s += `<circle cx="${seg[0][0]}" cy="${seg[0][1]}" r="2.5" style="fill:var(${se.color})"/>`;
        else s += `<polyline points="${seg.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}" style="fill:none;stroke:var(${se.color});stroke-width:2;stroke-linejoin:round;${se.dash ? 'stroke-dasharray:5 4;' : ''}"/>`;
      });
      const li = se.vals.map((v, i) => v == null ? -1 : i).filter(i => i >= 0).pop();
      if (li != null) s += `<circle cx="${x(li)}" cy="${sc.y(se.vals[li])}" r="3.5" style="fill:var(${se.color});stroke:var(--card);stroke-width:1.5"/>`;
    });
    s += `<line class="hov" x1="0" x2="0" y1="${F.m.t}" y2="${F.m.t + F.ih}" style="display:none"/><rect x="${F.m.l}" y="${F.m.t}" width="${F.iw}" height="${F.ih}" style="fill:transparent;stroke:none"/></svg>`;
    const legend = series.length > 1 ? '<div class="legend">' + series.map(se => `<span><i style="background:var(${se.color});height:3px;width:14px;${se.dash ? 'opacity:.7' : ''}"></i>${esc(se.label)}</span>`).join('') + '</div>' : '';
    el.innerHTML = s + '<div class="tip" hidden></div>' + legend;
    attachHover(el, el.querySelector('svg'), F, dates.length, x, i => `<b>${dly(dates[i])}</b><br>` + series.map(se => `${esc(se.label)}: ${se.vals[i] == null ? '—' : (se.fmt || (v => nf(v, 1)))(se.vals[i])}`).join('<br>'));
  }
  function stackChart(el, dates, stacks, opt = {}) {
    if (!el) return;
    if (!dates.length) { el.innerHTML = '<p class="desc">No days in the selected range.</p>'; return; }
    const F = frame(el, dates, {});
    const tot = dates.map((_, i) => stacks.reduce((a, s) => a + (s.vals[i] || 0), 0));
    const Y = axisY(F, 0, Math.max(1, ...tot), true);
    const bw = F.iw / dates.length, x = i => F.m.l + bw * (i + 0.5);
    let s = `<svg viewBox="0 0 ${F.W} ${F.H}" role="img" aria-label="${esc(opt.label || 'chart')}">`;
    Y.ticks.forEach(t => { const y = Y.y(t); s += `<line class="gl" x1="${F.m.l}" x2="${F.W - F.m.r}" y1="${y}" y2="${y}"/><text class="ax" x="${F.m.l - 6}" y="${y + 3.5}" text-anchor="end">${shortNum(t)}</text>`; });
    dates.forEach((d, i) => {
      let base = 0; const w = Math.max(1, bw * 0.72);
      stacks.forEach(st => { const v = st.vals[i] || 0; if (v <= 0) return; const y0 = Y.y(base), y1 = Y.y(base + v); s += `<rect x="${(x(i) - w / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0.5, y0 - y1).toFixed(1)}" style="fill:var(${st.color})"/>`; base += v; });
    });
    [0, Math.round((dates.length - 1) / 2), dates.length - 1].forEach((i, k) => { s += `<text class="ax" x="${x(i)}" y="${F.H - 6}" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}">${dl(dates[i])}</text>`; });
    s += `<line class="hov" x1="0" x2="0" y1="${F.m.t}" y2="${F.m.t + F.ih}" style="display:none"/><rect x="${F.m.l}" y="${F.m.t}" width="${F.iw}" height="${F.ih}" style="fill:transparent;stroke:none"/></svg>`;
    el.innerHTML = s + '<div class="tip" hidden></div>';
    attachHover(el, el.querySelector('svg'), F, dates.length, x, i => `<b>${dly(dates[i])}</b><br>` + stacks.map(st => `${esc(st.label)}: ${nf(st.vals[i] || 0)} kWh`).join('<br>') + `<br><b>Total: ${nf(tot[i])} kWh</b>`);
  }
  const lossBar = (L, max) => `<div class="sbar" style="width:${max ? Math.max(4, L.total / max * 100) : 0}%">${['inv', 'plant', 'grid', 'resid'].map(k => L.total > 0 && L[k] > 0 ? `<i style="width:${L[k] / L.total * 100}%;background:var(${LCOL[k]})" title="${LLAB[k]}: ${nf(L[k])} kWh"></i>` : '').join('')}</div>`;
  function barChart(el, labels, vals, opt = {}) {
    if (!el) return;
    if (!labels.length) { el.innerHTML = '<p class="desc">No inverter values in the selected dates.</p>'; return; }
    const W = Math.max(300, Math.round(el.clientWidth || 640)), H = opt.h || 210, m = { l: 46, r: 10, t: 12, b: 30 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const v = vals.map(x => x == null || !isFinite(x) ? 0 : x), hi = Math.max(opt.ref || 0, ...v, opt.min || 0);
    const ticks = niceTicks(0, hi * 1.05 || 1, 4), top = ticks[ticks.length - 1], y = x => m.t + ih - x / top * ih;
    const bw = iw / labels.length, w = Math.max(3, Math.min(42, bw * 0.68));
    let s = `<svg viewBox="0 0 ${W} ${H}" class="bars" role="img" aria-label="${esc(opt.label || 'bar chart')}">`;
    ticks.forEach(t => { s += `<line class="gl" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${m.l - 6}" y="${y(t) + 3.5}" text-anchor="end">${shortNum(t)}${opt.unit || ''}</text>`; });
    labels.forEach((lb, i) => {
      const x = m.l + bw * i + (bw - w) / 2, val = v[i], col = opt.colorOf ? opt.colorOf(i, vals[i]) : (opt.color || '--accent');
      s += `<rect class="b" ${opt.click ? `data-${opt.click}="${esc(opt.keys ? opt.keys[i] : i)}"` : ''} x="${x.toFixed(1)}" y="${y(val).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, m.t + ih - y(val)).toFixed(1)}" rx="2" style="fill:var(${col});${opt.sel != null && opt.sel !== i ? 'opacity:.45' : ''}"><title>${esc(lb)}: ${vals[i] == null ? '—' : (opt.fmt || (z => nf(z)))(vals[i])}</title></rect>`;
      if (bw >= 22 || i % Math.ceil(22 / bw) === 0) s += `<text class="lbl" x="${(x + w / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle">${esc(lb)}</text>`;
    });
    if (opt.ref != null) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(opt.ref)}" y2="${y(opt.ref)}" style="stroke:var(--series2);stroke-width:1.5;stroke-dasharray:5 4"/><text class="ax" x="${W - m.r}" y="${y(opt.ref) - 4}" text-anchor="end">${esc(opt.refLabel || '')}</text>`;
    el.innerHTML = s + '</svg>';
  }
  const kpi = (h, num, sub, cls = '') => `<div class="card kpi ${cls}"><h4>${h}</h4><div class="num">${num}</div><div class="sub">${sub}</div></div>`;

  // ---------- render orchestration ----------
  function analyse() {
    state.A = OPS.analyze(state.all, state.from, state.to, SET, state.master);
    state.M = DGR.compute(state.all, state.from, state.to);
    state.Md = DGR.compute(state.all.filter(r => r._src !== 'cuf'), state.from, state.to);
    const A = state.A; if (!A.siteNames.includes(state.site)) state.site = A.siteNames[0] || null;
    const open = A.sevCount.critical + A.sevCount.high; $('navIssues').textContent = open || '';
    try { const M = maint(); let od = 0; M.sites.forEach(s => M.eq.forEach(e => { if (M.by[s][e.key].status === 'overdue') od++; })); $('navEquip').textContent = od || ''; } catch (e) { /* no data */ }
  }
  function fullYear() {
    const key = state.all.length + '|' + (state.all.length ? state.all[state.all.length - 1].date : '') + '|' + JSON.stringify(SET) + '|' + (state.master ? 1 : 0);
    if (state.Ykey !== key) { state.Y = OPS.analyze(state.all, null, null, SET, state.master); state.Ykey = key; }
    return state.Y;
  }
  function renderAll() { analyse(); renderChip(); renderBanner(); renderView(state.view); }
  const VIEWS = { temp: renderTemp, equip: renderEquip, mreport: renderMReport, targets: renderTargets, history: renderHistory, meter: renderMeter, overview: renderOverview, pm: renderPm, cc: renderCC, issues: renderIssues, loss: renderLoss, site: renderSite, inverters: renderInverters, ranking: renderRanking, trafo: renderTrafo, discipline: renderDiscipline, data: renderData, settings: renderSettings };
  function renderView(v) { if (state.A && VIEWS[v]) VIEWS[v](state.A); }

  function renderChip() {
    const map = { sample: ['sample', 'Sample data'], saved: ['saved', 'Saved DGR data'], api: ['saved', 'Live from DGR app'], local: ['local', 'Unsaved upload'] };
    const [cls, txt] = map[state.source]; $('srcChip').className = 'chip ' + cls; $('srcChip').textContent = txt;
  }
  function renderBanner() {
    const b = $('banner'); let h = '';
    if (state.apiError) h += `<div class="banner"><b>DGR app not reachable.</b> ${esc(state.apiError)}. Showing ${state.source === 'saved' ? 'the last saved data' : 'sample data'}.</div>`;
    if (state.source === 'sample') h += `<div class="banner"><b>Sample data.</b> Made-up demo sites. <button data-go="data">Load your DGR export</button> to see your portfolio.</div>`;
    else if (state.source === 'local') h += `<div class="banner"><b>Not saved yet.</b> Showing "${esc(state.pending && state.pending.file)}" in this browser only. <button data-go="data">Save it for everyone</button> or reload to discard.</div>`;
    b.innerHTML = h;
  }

  // ---------- Command Centre ----------
  function renderCC(A) {
    if (simple()) return renderHome(A);
    const K = A.kpi, n = A.allSites.length, dd = K.avg7 ? (K.today - K.avg7) / K.avg7 : null;
    $('ccKpis').innerHTML = [
      kpi('Generation, ' + dl(A.latest), energy(K.today), (() => { const rd = Object.values(A.sites).reduce((x, s) => x + (s.today && s.today.date === A.latest && tf(s) && s.today.gen ? s.today.gen * tf(s) : 0), 0); return (rd ? inr(rd) + ' · ' : '') + (dd == null ? 'no earlier days' : `<span class="delta ${dd >= 0 ? 'up' : 'down'}">${dd >= 0 ? '▲' : '▼'} ${nf(Math.abs(dd) * 100, 1)}%</span> vs 7-day avg`); })()),
      kpi('Site status', `<span style="color:var(--bad)">${K.red}</span> · <span style="color:var(--warn)">${K.amber}</span> · <span style="color:var(--good)">${K.green}</span>`, `Red · amber · green · ${K.todaySites} of ${n} DGRs on ${dl(A.latest)}`, K.todaySites < n ? 'alert' : ''),
      kpi('Open issues', `${A.sevCount.critical + A.sevCount.high} <small>critical/high</small>`, `${A.sevCount.medium} medium, ${A.sevCount.low} low`, A.sevCount.critical ? 'alert' : ''),
      kpi('Generation, ' + dl(A.from) + '–' + dl(A.to), energy(K.gen), `DC CUF ${pct(K.cuf, 1)}${K.target ? ` · <span class="delta ${K.target.devPct >= 0 ? 'up' : 'down'}">${K.target.devPct >= 0 ? '+' : ''}${nf(K.target.devPct, 1)}%</span> vs target (${K.target.sites} sites)` : ''}`),
      (() => { const R = revTotals(A), tdv = sumRs(A, s => s.target ? s.target.dev : 0); return kpi('Revenue, ' + dl(A.from) + '–' + dl(A.to), R.n ? inr(R.r) : '—', `Generation × site tariff${R.n < R.t ? ` (${R.n} of ${R.t} sites)` : ''}${tdv != null ? ` · ${tdv < 0 ? '−' : '+'}${inr(Math.abs(tdv))} vs target` : ''}`); })(),
      kpi('Estimated loss', energy(K.loss.total), `${nf(K.lossPct, 1)}% of potential${rsTxt(sumRs(A, s => s.loss.total))}`),
    ].join('');
    const dcT = Object.values(A.sites).reduce((x, s) => x + (s.dc || 0), 0);
    $('heroSub').textContent = `${n} plants across Rajasthan · ${nf(dcT / 1000, 1)} MWp DC · latest DGR ${dly(A.latest)}`;
    // status board
    const tiles = A.allSites.map(name => ({ name, s: A.sites[name] }));
    const order = { red: 0, amber: 1, green: 2 };
    tiles.sort((a, b) => state.boardSort === 'name' ? a.name.localeCompare(b.name) : state.boardSort === 'loss' ? ((b.s ? b.s.loss.total : 0) - (a.s ? a.s.loss.total : 0)) :
      ((a.s && a.s.submittedLatest ? order[a.s.status] : -1) - (b.s && b.s.submittedLatest ? order[b.s.status] : -1)) || ((a.s && a.s.today.pi) || 0) - ((b.s && b.s.today.pi) || 0));
    $('boardTitle').textContent = 'Site status, latest DGR'; $('boardLegend').innerHTML = BOARD_LEGEND; $('boardDesc').textContent = `${dly(A.latest)}. Click a site to open Site 360.`;
    $('board').innerHTML = tiles.map(({ name, s }) => {
      if (!s || !s.submittedLatest) return `<button class="tile none" data-site="${esc(name)}"><span class="nm" title="${esc(name)}">${esc(name)}</span><span class="ix">No DGR</span><span class="ft"><span>${s ? 'last ' + dl(s.latest) : 'none in range'}</span></span></button>`;
      const t = s.today;
      return `<button class="tile ${s.status}" data-site="${esc(name)}" title="${esc(name)}: ${s.issues} open issue(s)"><span class="nm">${esc(name)}</span><span class="ix">${t.pi == null ? '—' : nf(t.pi * 100) + '<small>%</small>'}</span><span class="ft"><span>CUF ${t.cuf == null ? '—' : nf(t.cuf * 100, 1) + '%'}</span><span>${s.issues ? s.issues + ' issue' + (s.issues > 1 ? 's' : '') : 'OK'}</span></span></button>`;
    }).join('');
    document.querySelectorAll('[data-sort]').forEach(b => b.setAttribute('aria-pressed', b.dataset.sort === state.boardSort));
    // attention list
    const top = A.issues.filter(i => i.sev === 'critical' || i.sev === 'high').slice(0, 9);
    $('ccIssues').innerHTML = top.length ? top.map(issueRow).join('') + (A.sevCount.critical + A.sevCount.high > 9 ? `<p class="desc" style="margin:10px 0 0">+ ${A.sevCount.critical + A.sevCount.high - 9} more critical or high issues</p>` : '') : '<p class="desc">No critical or high issues.</p>';
    const T = A.trend, D = T.map(t => t.date);
    lineChart($('chGen'), D, [{ vals: T.map(t => t.gen), color: '--accent', label: 'Generation', fmt: v => nf(v) + ' kWh' }], { zero: true, area: true, label: 'Daily generation' });
    stackChart($('chLossDaily'), D, ['inv', 'plant', 'grid', 'resid'].map(k => ({ vals: T.map(t => t[k]), color: LCOL[k], label: LLAB[k] })), { label: 'Daily loss by cause' });
  }
  let BOARD_LEGEND = '';
  function renderHome(A) {
    const K = A.kpi, n = A.allSites.length, dd = K.avg7 ? (K.today - K.avg7) / K.avg7 : null;
    const rd = Object.values(A.sites).reduce((x, s) => x + (s.today && s.today.date === A.latest && tf(s) && s.today.gen ? s.today.gen * tf(s) : 0), 0);
    let od = 0; const M = maint(); const overdue = []; M.sites.forEach(s => M.eq.forEach(e => { const x = M.by[s][e.key]; if (x.status === 'overdue') { od++; overdue.push({ s, e, x }); } }));
    const attention = K.red + (n - K.todaySites > 0 ? 0 : 0);
    const dcT = Object.values(A.sites).reduce((x, s) => x + (s.dc || 0), 0);
    $('heroSub').textContent = `${n} plants across Rajasthan · ${nf(dcT / 1000, 1)} MWp DC · latest DGR ${dly(A.latest)}`;
    $('ccKpis').innerHTML = [
      kpi(`Generation on ${dl(A.latest)}`, energy(K.today), dd == null ? '' : `<span class="delta ${dd >= 0 ? 'up' : 'down'}">${dd >= 0 ? '▲' : '▼'} ${nf(Math.abs(dd) * 100, 1)}%</span> compared with the week before`),
      kpi(`Money earned on ${dl(A.latest)}`, rd ? inr(rd) : '—', `${inr(revTotals(A).r)} this period`),
      kpi('Plants generating low', `${attention} <small>of ${n}</small>`, `${K.amber} to watch · ${K.green} running well${n - K.todaySites ? ` · ${n - K.todaySites} without DGR` : ''}`, attention ? 'alert' : ''),
      kpi('Maintenance overdue', `${od}`, od ? 'Checks past their due date' : 'Nothing overdue', od ? 'alert' : ''),
      kpi('Generation this period', energy(K.gen), `${dl(A.from)} – ${dl(A.to)}`),
      kpi('Generation lost', energy(K.loss.total), `${rsTxt(sumRs(A, s => s.loss.total)).replace(' · ', '') || ''} compared with nearby plants`),
    ].join('');
    // plant tiles in plain words
    const tiles = A.allSites.map(name => ({ name, s: A.sites[name] }));
    const order = { red: 0, amber: 1, green: 2 };
    tiles.sort((a, b) => state.boardSort === 'name' ? a.name.localeCompare(b.name) : state.boardSort === 'loss' ? ((b.s ? b.s.loss.total : 0) - (a.s ? a.s.loss.total : 0)) : ((a.s && a.s.submittedLatest ? order[a.s.status] : -1) - (b.s && b.s.submittedLatest ? order[b.s.status] : -1)) || ((a.s && a.s.today.pi) || 0) - ((b.s && b.s.today.pi) || 0));
    $('boardTitle').textContent = 'How each plant did'; $('boardDesc').textContent = `How each plant did on ${dly(A.latest)} compared with plants near it. 100% = same as neighbours. Click a plant for details.`;
    const perf = s => s && s.submittedLatest && s.today.pi != null ? (s.today.pi < SET.siteGapHigh ? 'red' : s.today.pi < 0.95 ? 'amber' : 'green') : null;
    const WORD = { red: 'Low', amber: 'Watch', green: 'Good' };
    const rank = { red: 0, amber: 1, green: 2 };
    if (state.boardSort === 'status') tiles.sort((a, b) => ((perf(a.s) ? rank[perf(a.s)] : -1) - (perf(b.s) ? rank[perf(b.s)] : -1)) || (((a.s && a.s.today.pi) || 0) - ((b.s && b.s.today.pi) || 0)));
    $('board').innerHTML = tiles.map(({ name, s }) => {
      const p = perf(s);
      if (!p) return `<button class="tile none" data-site="${esc(name)}"><span class="nm">${esc(name)}</span><span class="ix">No DGR</span><span class="ft"><span>${s ? 'last ' + dl(s.latest) : 'none'}</span></span></button>`;
      const t = s.today;
      return `<button class="tile ${p}" data-site="${esc(name)}"><span class="nm">${esc(name)}</span><span class="ix">${nf(t.pi * 100)}<small>%</small></span><span class="ft"><span>${WORD[p]}</span><span>${t.gen != null ? energyT(t.gen) : ''}</span></span></button>`;
    }).join('');
    const cnt = { red: 0, amber: 0, green: 0, none: 0 }; tiles.forEach(({ s }) => cnt[perf(s) || 'none']++);
    $('ccKpis').querySelector('.kpi:nth-child(3) .num').innerHTML = `${cnt.red} <small>of ${n}</small>`;
    $('ccKpis').querySelector('.kpi:nth-child(3) .sub').textContent = `${cnt.amber} to watch · ${cnt.green} running well${cnt.none ? ` · ${cnt.none} without DGR` : ''}`;
    $('ccKpis').querySelector('.kpi:nth-child(3)').classList.toggle('alert', cnt.red > 0);
    $('boardLegend').innerHTML = '<span><i style="background:var(--bad)"></i>Low: below 85% of nearby plants</span><span><i style="background:var(--warn)"></i>Watch: 85–95%</span><span><i style="background:var(--good)"></i>Good: 95% or better</span><span><i style="background:var(--muted)"></i>No DGR</span>';
    document.querySelectorAll('[data-sort]').forEach(b => b.setAttribute('aria-pressed', b.dataset.sort === state.boardSort));
    // to-do list: biggest problems first, then overdue maintenance
    const isoFix = t => String(t).replace(/(\d{4})-(\d{2})-(\d{2})/g, (m0) => dl(m0));
    const plain = i => { const s = A.sites[i.site];
      if (i.title === 'Below nearby sites' && s) return { t: `${i.site}: generating less than nearby plants`, d: `Over the last 7 days it made ${pct(s.pi7)} of what nearby plants made. Check inverters, strings, module cleaning and outages.` };
      if (i.title === 'Very low generation' && s) { const why = (i.detail.match(/\(([^)]*outage[^)]*|[^)]*cloudy[^)]*|[^)]*sunny[^)]*)\)/) || [])[1]; return { t: `${i.site}: very low generation on ${dl(s.today.date)}`, d: `It made ${pct(s.today.pi)} of what nearby plants made${why ? ' (' + why + ')' : ''}.` }; }
      if (i.title === 'Plant outage / fault') return { t: `${i.site}: plant outage`, d: isoFix(i.detail) };
      if (i.title === 'DGR not submitted') return { t: `${i.site}: DGR not submitted`, d: isoFix(i.detail) + '. Ask the site engineer to submit it.' };
      return { t: `${i.site}: ${i.title}`, d: isoFix(i.detail) }; };
    const todo = A.issues.filter(i => i.sev === 'critical' || i.sev === 'high').slice(0, 6).map(i => ({ site: i.site, t: plain(i).t, d: plain(i).d, k: i.kwh > 0 ? `${nf(i.kwh)} kWh${(() => { const s = A.sites[i.site]; return s && tf(s) ? ' · ' + inr(i.kwh * tf(s)) : ''; })()}` : (i.days ? `${i.days} days` : ''), m: false }))
      .concat(overdue.sort((x, y) => x.x.left - y.x.left).slice(0, 4).map(o => ({ site: o.s, t: `${o.s}: ${o.e.name} check overdue`, d: `Last done ${dly(o.x.last.date)}. Due every ${o.x.freq} days. Check: ${o.e.what}.`, k: `${-o.x.left} days late`, m: true })));
    $('ccIssues').innerHTML = todo.length ? todo.map((x, i) => `<div class="todo" data-site="${esc(x.site)}"><span class="no ${x.m ? 'm' : ''}">${i + 1}</span><span class="tt">${esc(x.t)}</span><span class="kk">${esc(x.k)}</span><span class="dd">${esc(x.d)}</span></div>`).join('') : '<p class="desc">Nothing urgent. All plants are running close to their neighbours.</p>';
    const T = A.trend;
    lineChart($('chGen'), T.map(t => t.date), [{ vals: T.map(t => t.gen), color: '--accent', label: 'Generation', fmt: v => nf(v) + ' kWh' }], { zero: true, area: true, label: 'Daily generation' });
  }
  const issueRow = i => `<div class="issue click" data-site="${esc(i.site)}">${sevPill(i.sev)}<span class="t">${esc(i.site)} · ${esc(i.title)}</span><span class="k">${i.kwh > 0 ? nf(i.kwh) + ' kWh' : ''}${i.days ? (i.kwh > 0 ? ' · ' : '') + i.days + ' d' : ''}</span><span class="d">${esc(i.detail)}</span></div>`;



  // ---------- monthly aggregation (full history) ----------
  function monthly() {
    const Y = fullYear();
    if (state.Mo && state.MoKey === state.Ykey) return state.Mo;
    const months = [...new Set(Y.dates.map(d => d.slice(0, 7)))].sort();
    const site = {}, port = {};
    const blank = () => ({ gen: 0, dcd: 0, exp: 0, egen: 0, tkwh: 0, tgen: 0, tdcd: 0, days: 0 });
    Object.values(Y.sites).forEach(s => {
      const o = site[s.name] = {};
      s.daily.forEach(d => {
        if (d.gen == null || !d.row.dc_kwp) return;
        const m = d.date.slice(0, 7), c = o[m] = o[m] || blank(), p = port[m] = port[m] || Object.assign(blank(), { sites: new Set() });
        [c, p].forEach(x => { x.gen += d.gen; x.dcd += d.row.dc_kwp * 24; x.days++; if (d.exp != null) { x.exp += d.exp; x.egen += d.gen; } if (d.tkwh != null) { x.tkwh += d.tkwh; x.tgen += d.gen; x.tdcd += d.row.dc_kwp * 24; } });
        p.sites.add(s.name);
      });
    });
    state.Mo = { months, site, port }; state.MoKey = state.Ykey; return state.Mo;
  }
  const MONL = m => MON[+m.slice(5) - 1] + ' ' + m.slice(2, 4);

  // ---------- Targets & Revenue ----------
  function renderTargets(A) {
    const S = Object.values(A.sites), T = S.filter(s => s.target).sort((a, b) => a.target.devPct - b.target.devPct), K = A.kpi.target;
    const devRs = sumRs(A, s => s.target ? s.target.dev : 0);
    const sg = v => (v >= 0 ? '+' : '−') + nf(Math.abs(v), 1);
    $('tgKpis').innerHTML = [
      kpi('Sites with a target', `${T.length} <small>of ${A.allSites.length}</small>`, 'PVsyst DC CUF received'),
      kpi('Target generation', energy(K && K.kwh), `${dl(A.from)} – ${dl(A.to)}, days each site reported`),
      kpi('Revenue', revTotals(A).n ? inr(revTotals(A).r) : '—', `All ${revTotals(A).n} sites with a tariff, generation × tariff`),
      kpi('Against target', K ? `<span style="color:${K.devPct < 0 ? 'var(--bad)' : 'var(--good)'}">${sg(K.devPct)}%</span>` : '—', K ? `${K.dev < 0 ? '−' : '+'}${energyT(Math.abs(K.dev))}` : 'No targets', K && K.devPct < 0 ? 'alert' : ''),
      kpi('Revenue impact', devRs == null ? '—' : (devRs < 0 ? '−' : '+') + inr(Math.abs(devRs)), 'Deviation × each site\'s tariff'),
    ].join('');
    const RS = Object.values(A.sites).sort((x, y) => (revOf(y) || 0) - (revOf(x) || 0)), RT = revTotals(A), LR = sumRs(A, s => s.loss.total);
    $('revDesc').textContent = `Estimated revenue = DGR generation × the site's tariff from the budget sheet, ${dl(A.from)} – ${dl(A.to)}. Total ${inr(RT.r)} from ${RT.n} sites; a further ${LR != null ? inr(LR) : '—'} estimated lost to underperformance. Billed revenue (net export × tariff) is on Meter vs DGR.`;
    $('tRev2').innerHTML = '<tr><th>Site</th><th class="n">Tariff ₹/kWh</th><th class="n">Generation kWh</th><th class="n">Revenue ₹</th><th class="n">Share</th><th class="n">Est. loss ₹</th><th class="n">Vs target ₹</th><th class="n">₹ per kWp DC</th></tr>' +
      RS.map(s => { const r = revOf(s); return `<tr class="click" data-site="${esc(s.name)}"><td>${esc(s.name)}</td><td class="n">${tf(s) ? nf(tf(s), 3) : '<span class="pill a">missing</span>'}</td><td class="n">${nf(s.gen)}</td><td class="n"><b>${r != null ? nf(r) : '—'}</b></td><td class="n">${r != null && RT.r ? nf(r / RT.r * 100, 1) + '%' : '—'}</td><td class="n">${tf(s) ? nf(s.loss.total * tf(s)) : '—'}</td><td class="n">${s.target && tf(s) ? nf(s.target.dev * tf(s)) : '—'}</td><td class="n">${r != null && s.dc ? nf(r / s.dc, 1) : '—'}</td></tr>`; }).join('');
    $('tgDesc').textContent = 'Target DC CUF = PVsyst annual DC CUF × the month\'s seasonal factor. Sorted by deviation, worst first. Click a site to open it.';
    $('tTg').innerHTML = '<tr><th>Site</th><th class="n">PVsyst DC CUF</th><th class="n">Target DC CUF</th><th class="n">Actual DC CUF</th><th class="n">Deviation</th><th class="n">Deviation kWh</th><th class="n">₹</th><th class="n">Tariff</th><th class="n">Performance</th></tr>' +
      (T.length ? T.map(s => { const t = s.target, ac = t.actual / (t.kwh / t.cuf); return `<tr class="click" data-site="${esc(s.name)}"><td>${esc(s.name)}</td><td class="n">${pct(s.pvsyst, 2)}</td><td class="n">${pct(t.cuf, 2)}</td><td class="n">${pct(ac, 2)}</td><td class="n"><span class="pill ${t.devPct < -5 ? 'r' : t.devPct < 0 ? 'a' : 'g'}">${sg(t.devPct)}%</span></td><td class="n">${nf(t.dev)}</td><td class="n">${tf(s) ? nf(t.dev * tf(s)) : '—'}</td><td class="n">${tf(s) ? nf(tf(s), 2) : '—'}</td><td class="n">${pct(s.pi)}</td></tr>`; }).join('') : '<tr class="more"><td colspan="9">No site in this range has a PVsyst target</td></tr>');
    const Mo = monthly();
    $('tTgMon').innerHTML = '<tr><th>Month</th><th class="n">Target DC CUF</th><th class="n">Actual DC CUF</th><th class="n">Deviation</th></tr>' + Mo.months.map(m => { const p = Mo.port[m]; if (!p || !p.tkwh) return ''; const tc = p.tkwh / p.tdcd, ac = p.tgen / p.tdcd, dv = (p.tgen - p.tkwh) / p.tkwh * 100; return `<tr><td>${MONL(m)}</td><td class="n">${pct(tc, 2)}</td><td class="n">${pct(ac, 2)}</td><td class="n"><span class="pill ${dv < -5 ? 'r' : dv < 0 ? 'a' : 'g'}">${sg(dv)}%</span></td></tr>`; }).join('');
    const miss = A.allSites.filter(n => !A.sites[n] || !A.sites[n].target);
    $('tgMissing').innerHTML = `<div class="wlist">${miss.map(n => { const s = A.sites[n]; return `<div class="wrow"><span>${esc(n)}</span><b class="muted" style="font-weight:400;font-size:12px">${esc(s && s.pvsystExcluded ? s.pvsystExcluded : 'No PVsyst DC CUF')}</b></div>`; }).join('')}</div>`;
  }

  // ---------- Monthly History ----------
  function renderHistory() {
    const Mo = monthly(), months = Mo.months;
    document.querySelectorAll('#hiSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.hc === state.hc));
    const full = months.filter(m => { const p = Mo.port[m]; return p && p.days / Math.max(1, p.sites.size) >= 20; });
    const ref = full[full.length - 1] || months[months.length - 1];
    $('hiDesc').textContent = `DC CUF per site per month, ${MONL(months[0])} – ${MONL(months[months.length - 1])}. Coloured ${state.hc === 'bench' ? 'by generation against the nearby-site benchmark' : 'by generation against the PVsyst target'}. Sorted by ${MONL(ref)}, weakest first. Hover a cell for details.`;
    const cls = c => { if (!c || !c.dcd) return ''; if (state.hc === 'bench') { if (!c.exp) return 'c2'; const k = c.egen / c.exp; return k < 0.85 ? 'c0' : k < 0.95 ? 'c1' : k <= 1.05 ? 'c2' : 'c3'; } if (!c.tkwh) return ''; const k = c.tgen / c.tkwh; return k < 0.9 ? 'c0' : k < 0.97 ? 'c1' : k <= 1.03 ? 'c2' : 'c3'; };
    const key = n => { const c = Mo.site[n][ref]; if (!c || !c.dcd) return 9; return state.hc === 'bench' ? (c.exp ? c.egen / c.exp : 9) : (c.tkwh ? c.tgen / c.tkwh : 9); };
    const names = Object.keys(Mo.site).sort((a, b) => key(a) - key(b));
    $('tHist').className = 'hm';
    $('tHist').innerHTML = '<tr><th>Site</th>' + months.map(m => `<th>${MONL(m)}</th>`).join('') + '</tr>' + names.map(n => '<tr class="click" data-site="' + esc(n) + '"><td>' + esc(n) + '</td>' + months.map(m => { const c = Mo.site[n][m]; if (!c || !c.dcd) return '<td class="c muted">—</td>'; const v = c.gen / c.dcd;
      const tip = `${n}, ${MONL(m)}: DC CUF ${nf(v * 100, 2)}% over ${c.days} days` + (c.exp ? ` · ${nf(c.egen / c.exp * 100)}% of benchmark` : '') + (c.tkwh ? ` · ${nf((c.tgen - c.tkwh) / c.tkwh * 100, 1)}% vs target` : '');
      return `<td class="c ${cls(c)}" title="${esc(tip)}">${nf(v * 100, 1)}</td>`; }).join('') + '</tr>').join('');
    $('hiLegend').innerHTML = state.hc === 'bench' ? '<span><i style="background:var(--bad-bg)"></i>below 85% of benchmark</span><span><i style="background:var(--warn-bg)"></i>85–95%</span><span><i style="background:var(--card);border:1px solid var(--line)"></i>95–105%</span><span><i style="background:var(--good-bg)"></i>above 105%</span>'
      : '<span><i style="background:var(--bad-bg)"></i>more than 10% below target</span><span><i style="background:var(--warn-bg)"></i>3–10% below</span><span><i style="background:var(--card);border:1px solid var(--line)"></i>within ±3%</span><span><i style="background:var(--good-bg)"></i>above target</span><span>blank = no target</span>';
    $('tHistPort').innerHTML = '<tr><th>Month</th><th class="n">Sites</th><th class="n">Days</th><th class="n">Generation</th><th class="n">Revenue</th><th class="n">DC CUF</th><th class="n">Vs target (sites with one)</th></tr>' + months.map(m => { const p = Mo.port[m]; const dv = p.tkwh ? (p.tgen - p.tkwh) / p.tkwh * 100 : null;
      const nd = new Set(Object.values(Mo.site).flatMap(o => o[m] ? [o[m].days] : [])); const dd = Math.max(...nd); return `<tr><td>${MONL(m)}${dd < 25 ? ' <span class="pill n">partial</span>' : ''}</td><td class="n">${p.sites.size}</td><td class="n">${dd}</td><td class="n">${energyT(p.gen)}</td><td class="n">${(() => { const r = Object.entries(Mo.site).reduce((x, [n, o]) => x + (o[m] && tariffOfName(n) ? o[m].gen * tariffOfName(n) : 0), 0); return r ? inr(r) : '—'; })()}</td><td class="n">${pct(p.gen / p.dcd, 2)}</td><td class="n">${dv == null ? '—' : `<span class="pill ${dv < -5 ? 'r' : dv < 0 ? 'a' : 'g'}">${dv >= 0 ? '+' : '−'}${nf(Math.abs(dv), 1)}%</span>`}</td></tr>`; }).join('');
  }

  // ---------- Meter vs DGR ----------
  function renderMeter() {
    const meter = (state.master && state.master.meter) || [];
    if (!meter.length) { $('mtDesc').textContent = 'No monthly meter data loaded.'; $('tMeter').innerHTML = ''; $('tMeterMon').innerHTML = ''; return; }
    const Mo = monthly(); const months = [...new Set(meter.map(x => x.month))].sort();
    const withDgr = months.filter(m => Mo.port[m]);
    if (!state.mtMonth || !months.includes(state.mtMonth)) state.mtMonth = withDgr[withDgr.length - 1] || months[months.length - 1];
    $('mtMonth').innerHTML = months.slice().reverse().map(m => `<option value="${m}"${m === state.mtMonth ? ' selected' : ''}>${MONL(m)}</option>`).join('');
    const rows = meter.filter(x => x.month === state.mtMonth).map(x => { const c = Mo.site[x.site] && Mo.site[x.site][x.month]; return Object.assign({}, x, { dgr: c ? c.gen : null, days: c ? c.days : 0 }); });
    rows.forEach(r => { r.diff = r.dgr != null && r.actual ? (r.dgr - r.actual) / r.actual * 100 : null; });
    rows.sort((a, b) => Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0));
    const flagged = rows.filter(r => r.diff != null && Math.abs(r.diff) > 3).length;
    $('mtDesc').textContent = `${MONL(state.mtMonth)}: ${rows.length} sites in the meter sheet, ${flagged} differ from the DGR by more than 3%. Sorted by the size of the difference.`;
    $('tMeter').innerHTML = '<tr><th>Site</th><th class="n">Meter actual kWh</th><th class="n">DGR kWh</th><th class="n">DGR days</th><th class="n">Difference</th><th class="n">Import kWh</th><th class="n">Net export kWh</th><th class="n">Tariff</th><th class="n">Revenue ₹</th><th class="n">Plant avail.</th><th class="n">Grid avail.</th></tr>' +
      rows.map(r => `<tr class="click" data-site="${esc(r.site)}"><td>${esc(r.site)}</td><td class="n">${nf(r.actual)}</td><td class="n">${nf(r.dgr)}</td><td class="n">${r.days || '—'}</td><td class="n">${r.diff == null ? '—' : `<span class="pill ${Math.abs(r.diff) > 3 ? 'r' : Math.abs(r.diff) > 1 ? 'a' : 'g'}">${r.diff >= 0 ? '+' : '−'}${nf(Math.abs(r.diff), 1)}%</span>`}</td><td class="n">${nf(r.import)}</td><td class="n">${nf(r.export)}</td><td class="n">${r.tariff ? nf(r.tariff, 3) : '—'}</td><td class="n">${r.export && r.tariff ? nf(r.export * r.tariff) : '—'}</td><td class="n">${r.plant_av == null ? '—' : pct(r.plant_av, 1)}</td><td class="n">${r.grid_av == null ? '—' : pct(r.grid_av, 1)}</td></tr>`).join('');
    $('tMeterMon').innerHTML = '<tr><th>Month</th><th class="n">Sites</th><th class="n">Meter actual</th><th class="n">DGR (same sites)</th><th class="n">Difference</th><th class="n">Net export</th><th class="n">Revenue</th></tr>' + months.slice().reverse().map(m => {
      const xs = meter.filter(x => x.month === m && x.actual); let mt = 0, dg = 0, n = 0; xs.forEach(x => { const c = Mo.site[x.site] && Mo.site[x.site][m]; if (c) { mt += x.actual; dg += c.gen; n++; } });
      const ex = xs.reduce((a, x) => a + (x.export || 0), 0), rv = xs.reduce((a, x) => a + (x.export && x.tariff ? x.export * x.tariff : 0), 0), dv = n ? (dg - mt) / mt * 100 : null;
      return `<tr><td>${MONL(m)}</td><td class="n">${xs.length}</td><td class="n">${energyT(xs.reduce((a, x) => a + x.actual, 0))}</td><td class="n">${n ? energyT(dg) : '—'}</td><td class="n">${dv == null ? '—' : `<span class="pill ${Math.abs(dv) > 3 ? 'r' : Math.abs(dv) > 1 ? 'a' : 'g'}">${dv >= 0 ? '+' : '−'}${nf(Math.abs(dv), 1)}%</span>`}</td><td class="n">${energyT(ex)}</td><td class="n">${rv ? inr(rv) : '—'}</td></tr>`; }).join('');
  }

  // ---------- Portfolio Overview (classic) ----------
  function renderOverview(A) {
    const M = state.M, K = M.kpi, n = M.siteNames.length;
    $('ovKpis').innerHTML = [
      kpi('Generation', energy(K.gen), `${n} sites, ${M.dates.length} days${revTotals(state.A).n ? ' · ' + inr(revTotals(state.A).r) : ''}`),
      kpi('DC / AC CUF', `${nf(K.dc_cuf, 1)}% / ${nf(K.ac_cuf, 1)}%`, 'Average of site averages'),
      kpi('Specific yield', `${nf(K.sy, 1)} <small>kWh/kWp</small>`, 'Total generation ÷ total AC capacity'),
      kpi('Ambient temperature', state.A.trend.some(t => t.amb != null) ? nf(DGR.mean(state.A.trend.map(t => t.amb)), 1) + ' <small>°C avg</small>' : 'Not logged', `Logged on ${Object.values(state.A.sites).reduce((x, s) => x + s.ambDays, 0)} of ${nf(K.rows)} DGRs`),
      kpi('Grid outages', `${nf(K.gridEvents)} <small>site-days</small>`, `${nf(K.gridMins)} min, ${nf(A.kpi.gridEv)} trips`),
      kpi('Complete DGRs, ' + dl(state.Md.latest), `${state.Md.kpi.latestComplete} <small>of ${state.Md.kpi.latestSubmitted}</small>`, `Latest DGR day, all ${DGR.COMPLETENESS_FIELDS.length} key fields filled`),
    ].join('');
    const T = M.trend, D = T.map(t => t.date);
    lineChart($('ovGen'), D, [{ vals: T.map(t => t.gen), color: '--accent', label: 'Generation', fmt: v => nf(v) + ' kWh' }], { zero: true, area: true, label: 'Daily generation' });
    lineChart($('ovLoss'), state.A.trend.map(t => t.date), [{ vals: state.A.trend.map(t => t.amb), color: '--series2', label: 'Ambient', fmt: v => nf(v, 1) + ' °C' }, { vals: state.A.trend.map(t => t.mod), color: '--bad', label: 'Module', fmt: v => nf(v, 1) + ' °C' }], { unitL: '°', label: 'Ambient and module temperature' });
    lineChart($('ovTemp'), D, [{ vals: T.map(t => t.wti), color: '--bad', label: 'WTI', fmt: v => nf(v, 1) + ' °C' }, { vals: T.map(t => t.oti), color: '--series2', label: 'OTI', dash: true, fmt: v => nf(v, 1) + ' °C' }], { unitL: '°', label: 'WTI and OTI' });
    lineChart($('ovGrid'), D, [{ vals: T.map(t => t.grid), color: '--accent', label: 'Grid outage', fmt: v => nf(v) + ' min' }], { zero: true, area: true, label: 'Grid outage minutes' });
    const W = state.Md.wtiLatest;
    $('ovWtiDesc').textContent = `${dly(state.Md.latest)} (latest DGR), sorted by WTI. ${W.length} of ${state.Md.kpi.latestSubmitted} submitted DGRs had a reading.`;
    $('ovWti').innerHTML = '<tr><th>Site</th><th class="n">WTI °C</th><th class="n">OTI °C</th></tr>' + (W.length ? W.slice(0, 8).map(r => `<tr class="click" data-site="${esc(r.site)}"><td>${esc(r.site)}</td><td class="n">${r.wti >= SET.wtiWatch ? `<span class="pill r">${nf(r.wti, 1)}</span>` : nf(r.wti, 1)}</td><td class="n">${nf(r.oti, 1)}</td></tr>`).join('') + (W.length > 8 ? `<tr class="more"><td colspan="3">+ ${W.length - 8} more sites with a reading</td></tr>` : '') : '<tr class="more"><td colspan="3">No WTI readings on this day</td></tr>');
    const R = M.reasons, mx = R.length ? R[0][1] : 0;
    $('ovReasons').innerHTML = '<tr><th>Reason</th><th>Trips</th></tr>' + (R.length ? R.slice(0, 10).map(([k, v]) => `<tr><td>${esc(k)}</td><td><span class="bar"><i style="width:${mx ? Math.max(2, v / mx * 100) : 0}%"></i></span>${nf(v)}</td></tr>`).join('') : '<tr class="more"><td colspan="2">No reasons logged</td></tr>');
  }

  // ---------- Maintenance & Activity ----------
  function renderPm(A) {
    const S = Object.values(A.sites), n = S.length;
    const lowInvSites = new Set(A.inverters.filter(I => I.obs >= 5 && I.low / I.obs >= 0.8).map(I => I.site)).size;
    $('tPm').innerHTML = '<tr><th>Signal</th><th>DGR column</th><th class="n">Sites</th></tr>' + [
      ['No Modules Cleaned entry in the range', 'Modules Cleaned Today', S.filter(s => s.mcDays === 0).length],
      ['No ambient temperature in the range', 'Avg Ambient Temp (°C)', S.filter(s => s.ambDays === 0).length],
      ['No WTI / OTI entry in the range', 'WTI / OTI (°C)', S.filter(s => s.wtiDays === 0).length],
      ['Silica gel not blue on latest DGR', 'Silica Gel', S.filter(s => s.silica && !/blue/i.test(s.silica)).length],
      ['MOG at 1/4 or below on latest DGR', 'MOG Level', S.filter(s => s.mog && /at\s*1\/4|below/i.test(s.mog)).length],
      ['Inverter below 70% of site reference on 80%+ of days', 'Inv kWh ÷ Inv DC kW', lowInvSites],
      ['Plant outage logged in the range', 'Plant Outage (mins)', S.filter(s => s.plantDays > 0).length],
    ].map(([a, b, v]) => `<tr><td>${a}</td><td class="muted">${b}</td><td class="n"><span class="pill ${v ? 'a' : 'g'}">${v} of ${n}</span></td></tr>`).join('');
    const KW = state.Md.keywords, mx = Math.max(1, ...KW.map(k => k.range));
    $('tKw').innerHTML = `<tr><th>Mentions</th><th>${dl(A.from)} – ${dl(A.to)}</th><th class="n">${dl(A.latest)}</th></tr>` + KW.slice().sort((a, b) => b.range - a.range).map(k => `<tr><td>${esc(k.label)}</td><td><span class="bar"><i style="width:${k.range / mx * 100}%"></i></span>${nf(k.range)}</td><td class="n">${nf(k.latest)}</td></tr>`).join('');
    const rows = A.REMARK_CATS.map(c => { const sites = S.filter(s => s.daily.some(d => d.remarks && c.re.test(d.remarks))); return { c, sites }; }).filter(x => x.sites.length).sort((a, b) => b.sites.length - a.sites.length);
    $('tRemCats').innerHTML = '<tr><th>Problem</th><th class="n">Sites</th><th>Where</th></tr>' + (rows.map(({ c, sites }) => `<tr><td>${sevPill(c.sev)} ${esc(c.label)}</td><td class="n">${sites.length}</td><td class="muted" style="font-size:12px">${sites.map(s => esc(s.name)).join(', ')}</td></tr>`).join('') || '<tr class="more"><td colspan="3">No problems in remarks</td></tr>');
  }

  // ---------- Issues ----------
  function filteredIssues(A) {
    const q = state.text.toLowerCase();
    return A.issues.filter(i => state.sev.has(i.sev) && (!state.cat || i.cat === state.cat) && (!state.fsite || i.site === state.fsite) && (!q || (i.site + ' ' + i.title + ' ' + i.detail + ' ' + i.cat).toLowerCase().includes(q)));
  }
  function renderIssues(A) {
    $('sevSeg').innerHTML = ['critical', 'high', 'medium', 'low'].map(s => `<button data-sev="${s}" aria-pressed="${state.sev.has(s)}">${s[0].toUpperCase() + s.slice(1)} ${A.sevCount[s]}</button>`).join('');
    const cats = Object.keys(A.cats).sort();
    $('fCat').innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option${c === state.cat ? ' selected' : ''}>${esc(c)}</option>`).join('');
    $('fSite').innerHTML = '<option value="">All sites</option>' + A.allSites.map(s => `<option${s === state.fsite ? ' selected' : ''}>${esc(s)}</option>`).join('');
    const list = filteredIssues(A);
    $('issuesDesc').textContent = `${list.length} of ${A.issues.length} issues, latest DGR ${dly(A.latest)}. Sorted by severity, then estimated kWh.`;
    $('tIssues').innerHTML = '<tr><th>Severity</th><th>Site</th><th>Issue</th><th>Detail</th><th>Since</th><th class="n">Days</th><th class="n">Est. kWh</th></tr>' +
      (list.length ? list.map(i => `<tr class="click" data-site="${esc(i.site)}"><td>${sevPill(i.sev)}</td><td>${esc(i.site)}</td><td><b style="font-weight:600">${esc(i.title)}</b><br><span class="muted" style="font-size:11.5px">${esc(i.cat)}</span></td><td style="max-width:420px">${esc(i.detail)}</td><td>${i.since ? dl(i.since) : '—'}</td><td class="n">${i.days ?? '—'}</td><td class="n">${i.kwh > 0 ? nf(i.kwh) : '—'}</td></tr>`).join('')
        : '<tr class="more"><td colspan="7">No issues match these filters</td></tr>');
  }

  // ---------- Loss ----------
  function renderLoss(A) {
    const L = A.kpi.loss, P = A.kpi.gen + L.total, part = k => `${nf(L[k] / Math.max(1, L.total) * 100, 0)}% of loss${rsTxt(sumRs(A, s => s.loss[k]))}`;
    $('lossKpis').innerHTML = [
      kpi('Estimated loss', energy(L.total), `${nf(A.kpi.lossPct, 1)}% of potential ${energyT(P)}${rsTxt(sumRs(A, s => s.loss.total))}`, 'alert'),
      kpi('<i class="swatch-inv" style="display:inline-block;width:9px;height:9px;border-radius:2px"></i> Inverter', energy(L.inv), part('inv')),
      kpi('<i class="swatch-plant" style="display:inline-block;width:9px;height:9px;border-radius:2px"></i> Plant outage', energy(L.plant), part('plant')),
      kpi('<i class="swatch-grid" style="display:inline-block;width:9px;height:9px;border-radius:2px"></i> Grid outage', energy(L.grid), part('grid') + ` · ${nf(A.kpi.gridMin)} min, ${nf(A.kpi.gridEv)} trips`),
      kpi('<i class="swatch-resid" style="display:inline-block;width:9px;height:9px;border-radius:2px"></i> Unexplained', energy(L.resid), part('resid') + ' · soiling, shading, strings'),
    ].join('');
    const T = A.trend;
    stackChart($('chLoss2'), T.map(t => t.date), ['inv', 'plant', 'grid', 'resid'].map(k => ({ vals: T.map(t => t[k]), color: LCOL[k], label: LLAB[k] })), { label: 'Daily loss by cause' });
    const rows = Object.values(A.sites).sort((a, b) => b.loss.total - a.loss.total), max = rows.length ? rows[0].loss.total : 0;
    $('tLoss').innerHTML = `<tr><th>Site</th><th style="min-width:180px">Loss by cause</th><th class="n">Total kWh</th><th class="n">% of potential</th><th class="n">₹ (site tariff)</th><th class="n">Inverter</th><th class="n">Plant</th><th class="n">Grid</th><th class="n">Unexplained</th><th class="n">Performance</th></tr>` +
      rows.map(s => `<tr class="click" data-site="${esc(s.name)}"><td>${esc(s.name)}</td><td>${lossBar(s.loss, max)}</td><td class="n"><b>${nf(s.loss.total)}</b></td><td class="n">${nf(s.lossPct, 1)}%</td><td class="n">${tf(s) ? nf(s.loss.total * tf(s)) : '—'}</td><td class="n">${nf(s.loss.inv)}</td><td class="n">${nf(s.loss.plant)}</td><td class="n">${nf(s.loss.grid)}</td><td class="n">${nf(s.loss.resid)}</td><td class="n">${pct(s.pi)}</td></tr>`).join('');
    $('method').innerHTML = OPS.METHOD.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v.replace('{genHours}', SET.genHours))}</dd>`).join('');
  }

  // ---------- Site 360 ----------
  function renderSite(A) {
    const sel = $('siteSel'); sel.innerHTML = A.allSites.map(n => `<option${n === state.site ? ' selected' : ''}>${esc(n)}</option>`).join('');
    const s = A.sites[state.site];
    if (!s) { $('siteKpis').innerHTML = ''; $('siteMeta').textContent = 'No DGR for this site in the selected range.'; ['siteIssues', 'siteLoss', 'siteChecks', 'heat', 'tDaily', 'chSite'].forEach(id => $(id).innerHTML = ''); $('siteStatus').innerHTML = ''; return; }
    $('siteStatus').innerHTML = `<span class="pill ${s.submittedLatest ? s.status : 'n'}">${s.submittedLatest ? { red: 'Action needed', amber: 'Watch', green: 'Normal' }[s.status] : 'No DGR on ' + dl(A.latest)}</span>`;
    const tl = state.master && state.master.sites[s.name] && state.master.sites[s.name].tilt;
    $('siteMeta').textContent = `${nf(s.dc, 1)} kWp DC · ${nf(s.ac)} kW AC${tl != null ? ' · tilt ' + tl + '°' : ''} · ${s.invN} inverters · ${s.days} DGRs · latest ${dly(s.latest)}${s.submitters.length ? ' · by ' + s.submitters.slice(0, 2).join(', ') : ''}`;
    if (simple()) {
      const own = A.issues.filter(i => i.site === s.name);
      $('siteKpis').innerHTML = [
        kpi('Generation', energy(s.gen), `${s.days} days · DC CUF ${pct(s.cuf, 1)}`),
        kpi('Money earned', revOf(s) != null ? inr(revOf(s)) : '—', tf(s) ? `at ₹${nf(tf(s), 2)} per kWh` : 'No tariff'),
        kpi('Compared with nearby plants', pct(s.pi), s.pi == null ? '' : s.pi >= 0.97 ? 'Doing as well as its neighbours' : `Making ${nf((1 - s.pi) * 100)}% less than its neighbours`, s.pi != null && s.pi < SET.siteGapHigh ? 'alert' : ''),
        kpi('Generation lost', energy(s.loss.total), tf(s) ? inr(s.loss.total * tf(s)) + ' lost' : ''),
        kpi('Open problems', `${own.length}`, own.filter(i => i.sev === 'critical' || i.sev === 'high').length + ' urgent', own.some(i => i.sev === 'critical' || i.sev === 'high') ? 'alert' : ''),
        kpi('Grid outage', `${nf(s.grid)} <small>min</small>`, `${s.gridEv} trips this period`),
      ].join('');
    } else $('siteKpis').innerHTML = [
      kpi('Generation', energy(s.gen), `${s.days} days · ${revOf(s) != null ? inr(revOf(s)) + ' at ₹' + nf(tf(s), 3) + '/kWh' : 'no tariff'}`),
      kpi('DC CUF', pct(s.cuf, 2), `AC CUF ${nf(s.ac_cuf, 1)}% · DC from DGR ${nf(s.dc_cuf, 1)}%`),
      kpi('Performance vs nearby sites', pct(s.pi), `Last 7 days ${pct(s.pi7)} · 100% = same as nearby sites`, s.pi7 != null && s.pi7 < SET.siteGapHigh ? 'alert' : ''),
      kpi('Against PVsyst target', s.target ? `<span style="color:${s.target.devPct < 0 ? 'var(--bad)' : 'var(--good)'}">${s.target.devPct >= 0 ? '+' : ''}${nf(s.target.devPct, 1)}%</span>` : 'No target', s.target ? `Target DC CUF ${pct(s.target.cuf, 2)} · ${nf(s.target.dev)} kWh${tf(s) ? ' · ' + inr(s.target.dev * tf(s)) : ''}` : (s.pvsystExcluded || 'PVsyst DC CUF not received')),
      kpi('Estimated loss', energy(s.loss.total), `${nf(s.lossPct, 1)}% of potential${tf(s) ? ' · ' + inr(s.loss.total * tf(s)) : ''}`),
      kpi('Grid outage', `${nf(s.grid)} <small>min</small>`, `${s.gridEv} trips · plant outage ${nf(s.plant)} min`),
    ].join('');
    lineChart($('chSiteGen'), s.daily.map(d => d.date), [
      { vals: s.daily.map(d => d.gen), color: '--accent', label: 'Generation', fmt: v => nf(v) + ' kWh' },
      { vals: s.daily.map(d => d.cuf != null ? d.cuf * 100 : null), color: '--series2', label: 'DC CUF %', axis: 'r', fmt: v => nf(v, 2) + '%' }], { zero: true, area: true, unitR: '%', label: 'Site generation and DC CUF' });
    const bc = {}; s.daily.forEach(d => { if (d.basis) bc[d.basis] = (bc[d.basis] || 0) + 1; }); const b = Object.keys(bc).sort((x, y) => bc[y] - bc[x])[0] || null;
    $('benchDesc').textContent = b === 'colocated' ? `Benchmark = DC CUF of the plant at the same location: ${s.colocated.join(', ')}.` : b === 'peers' ? `Benchmark = median DC CUF of nearby sites: ${s.peers.map((p, i) => `${p} (${s.peerKm[i]} km)`).join(', ')}. On days fewer than 3 of them reported, the site's usual ratio to the portfolio is used.` : b === 'own' ? 'No nearby sites, so the benchmark is the portfolio median that day × this site\'s usual ratio to it (previous 180 days).' : 'Benchmark = portfolio median DC CUF that day.';
    const tser = s.daily.some(d => d.tcuf != null) ? [{ vals: s.daily.map(d => d.tcuf != null ? d.tcuf * 100 : null), color: '--good', label: 'PVsyst target', dash: true, fmt: v => nf(v, 2) + '%' }] : [];
    lineChart($('chSite'), s.daily.map(d => d.date), [
      { vals: s.daily.map(d => d.cuf != null ? d.cuf * 100 : null), color: '--accent', label: 'Site DC CUF', fmt: v => nf(v, 2) + '%' },
      { vals: s.daily.map(d => d.peer != null ? d.peer / 24 * 100 : null), color: '--series2', label: 'Benchmark', dash: true, fmt: v => nf(v, 2) + '%' }].concat(tser), { zero: true, area: true, unitL: '%', label: 'Site DC CUF vs benchmark' });
    const own = A.issues.filter(i => i.site === s.name);
    $('siteIssues').innerHTML = own.length ? own.map(i => `<div class="issue">${sevPill(i.sev)}<span class="t">${esc(i.title)}</span><span class="k">${i.kwh > 0 ? nf(i.kwh) + ' kWh' : ''}${i.days ? (i.kwh > 0 ? ' · ' : '') + 'since ' + dl(i.since) : ''}</span><span class="d">${esc(i.detail)}</span></div>`).join('') : '<p class="desc">No open issues.</p>';
    const L = s.loss;
    $('siteLoss').innerHTML = `<div style="margin:6px 0 12px">${lossBar(L, L.total)}</div><div class="wlist">` + ['inv', 'plant', 'grid', 'resid'].map(k => `<div class="wrow"><span><i class="swatch-${k}" style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px"></i>${LLAB[k]}</span><b>${nf(L[k])} kWh${tf(s) ? ' · ' + inr(L[k] * tf(s)) : ''}</b></div>`).join('') +
      `<div class="wrow" style="border-top:1px solid var(--line);padding-top:8px"><span>Total</span><b>${nf(L.total)} kWh</b></div></div>`;
    const silCls = !s.silica ? 'n' : /blue/i.test(s.silica) ? 'g' : 'a';
    $('siteChecks').innerHTML = [
      ['WTI / OTI, latest', s.wti == null ? 'Not logged' : `${nf(s.wti, 1)} / ${nf(s.oti, 1)} °C`],
      ['WTI, 7-day max', isFinite(s.wtiMax7) ? nf(s.wtiMax7, 1) + ' °C' : '—'],
      ['Silica gel', `<span class="pill ${silCls}">${esc(s.silica || 'Not logged')}</span>`],
      ['MOG level', esc(s.mog || 'Not logged')],
      ['Blank fields on latest DGR', `<span class="pill ${s.missing.length > 5 ? 'r' : s.missing.length ? 'a' : 'g'}">${s.missing.length} of ${DGR.COMPLETENESS_FIELDS.length}</span>`],
      ['WTI / OTI average', s.wtiAvg == null ? 'Not logged' : `${nf(s.wtiAvg, 1)} / ${nf(s.otiAvg, 1)} °C (${s.wtiDays} of ${s.days} days)`],
      ['Days with modules cleaned', `${s.mcDays} of ${s.days}`],
      ['Plant outage', `${s.plantDays} day${s.plantDays === 1 ? '' : 's'}, ${nf(s.plant)} min`],
      ['Grid outage', `${s.gridDays} day${s.gridDays === 1 ? '' : 's'}, ${nf(s.grid)} min, ${s.gridEv} trips`],
      ['Typical submission time', hhmm(s.subHours)],
    ].map(([k, v]) => `<div class="wrow"><span>${k}</span><b>${v}</b></div>`).join('');
    // inverter heat map
    $('heatDesc').textContent = s.invCols ? `${s.invN} inverters. 100% = median kWh/kWp of this site's inverters that day.` : '';
    if (!s.invCols) $('heat').innerHTML = '<p class="desc">No inverter values for this site.</p>';
    else {
      const days = s.daily; let h = `<div class="heat" style="grid-template-columns:auto repeat(${days.length},minmax(10px,1fr));min-width:${110 + days.length * 12}px">`;
      s.inv.forEach((I, i) => {
        if (!I.obs) return;
        h += `<div class="lab">Inv ${I.inv}${I.dc ? ' · ' + nf(I.dc) + ' kW' : ''}</div>`;
        days.forEach(d => { const k = d.cells[i]; const c = k == null ? '' : k < 0.7 ? 'h0' : k < 0.9 ? 'h1' : k <= 1.05 ? 'h2' : 'h3'; h += `<div class="c ${c}" title="Inv ${I.inv}, ${dl(d.date)}: ${k == null ? 'no value' : nf(k * 100) + '% of reference'}"></div>`; });
      });
      h += '<div></div>' + days.map((d, j) => `<div style="text-align:center">${j === 0 || j === days.length - 1 || j % 7 === 0 ? +d.date.slice(8) : ''}</div>`).join('') + '</div>';
      $('heat').innerHTML = h;
    }
    $('tDaily').innerHTML = '<tr><th>Date</th><th class="n">Gen kWh</th><th class="n">Revenue ₹</th><th class="n">DC CUF</th><th class="n">Performance</th><th class="n">Ambient °C</th><th class="n">Module °C</th><th class="n">Grid min</th><th class="n">Plant min</th><th class="n">Loss kWh</th><th>Weather</th><th>Remarks</th></tr>' +
      s.daily.slice().reverse().map(d => `<tr><td>${dl(d.date)}</td><td class="n">${nf(d.gen)}</td><td class="n">${tf(s) && d.gen != null ? nf(d.gen * tf(s)) : '—'}</td><td class="n">${d.cuf == null ? '—' : nf(d.cuf * 100, 1) + '%'}</td><td class="n">${d.pi == null ? '—' : `<span style="color:${d.pi < SET.siteGapHigh ? 'var(--bad)' : 'inherit'}">${pct(d.pi)}</span>`}</td><td class="n">${d.amb == null ? '—' : nf(d.amb, 1)}</td><td class="n">${d.mod == null ? '—' : nf(d.mod, 1)}</td><td class="n">${nf(d.grid)}</td><td class="n">${nf(d.plant)}</td><td class="n">${nf(d.invLoss + d.gridLoss + d.plantLoss + d.resid)}</td><td>${esc(d.weather || '—')}${/yes/i.test(d.rain || '') ? ', rain' : ''}</td><td class="clip" title="${esc(d.remarks || '')}">${esc((d.remarks || '').replace(/\s+/g, ' '))}</td></tr>`).join('');
  }

  // ---------- Inverters ----------
  function renderInverters(A) {
    // per-site inverter charts and drill-down
    const names = A.siteNames.filter(n => A.sites[n].invN);
    if (!names.includes(state.invSite)) state.invSite = names.includes(state.site) ? state.site : names[0] || null;
    $('invSite').innerHTML = names.map(n => `<option${n === state.invSite ? ' selected' : ''}>${esc(n)}</option>`).join('');
    const s = A.sites[state.invSite];
    if (s) {
      const I = s.inv.filter(x => x.obs > 0), lab = I.map(x => 'Inv ' + x.inv);
      const cufOf = x => x.dc ? x.gen / (x.dc * 24 * x.obs) : null;
      $('invMeta').textContent = `${I.length} inverters · ${nf(s.dc, 1)} kWp DC · ${dl(A.from)} – ${dl(A.to)}${tf(s) ? ' · tariff ₹' + nf(tf(s), 3) : ''}`;
      const sel = I.findIndex(x => x.inv === state.invSel);
      barChart($('chInvGen'), lab, I.map(x => x.gen), { color: '--accent', fmt: v => nf(v) + ' kWh', click: 'inv', keys: I.map(x => x.inv), sel: sel >= 0 ? sel : null, label: 'Generation by inverter' });
      barChart($('chInvCuf'), lab, I.map(x => { const c = cufOf(x); return c == null ? null : c * 100; }), { unit: '%', fmt: v => nf(v, 2) + '%', ref: s.cuf != null ? s.cuf * 100 : null, refLabel: s.cuf != null ? 'site ' + nf(s.cuf * 100, 1) + '%' : '', click: 'inv', keys: I.map(x => x.inv), sel: sel >= 0 ? sel : null,
        colorOf: (i, v) => v != null && s.cuf && v / 100 < s.cuf * 0.9 ? '--bad' : '--accent', label: 'DC CUF by inverter' });
      barChart($('chInvLoss'), lab, I.map(x => x.short), { fmt: v => nf(v) + ' kWh', click: 'inv', keys: I.map(x => x.inv), sel: sel >= 0 ? sel : null, colorOf: (i, v) => v > 0 ? '--bad' : '--line', min: 10, label: 'Loss by inverter' });
      $('tInvSite').innerHTML = '<tr><th>Inverter</th><th class="n">DC kW</th><th class="n">Generation kWh</th><th class="n">DC CUF</th><th class="n">vs site reference</th><th class="n">Days below 90%</th><th class="n">Days at 0</th><th class="n">Lost kWh</th><th class="n">Lost ₹</th></tr>' +
        I.slice().sort((x, y) => y.short - x.short).map(x => `<tr class="click" data-inv="${x.inv}"><td><b style="font-weight:600">Inv ${x.inv}</b></td><td class="n">${nf(x.dc, 1)}</td><td class="n">${nf(x.gen)}</td><td class="n">${cufOf(x) == null ? '—' : nf(cufOf(x) * 100, 2) + '%'}</td><td class="n"><span class="pill ${x.avg < SET.invLow ? 'r' : x.avg < 0.9 ? 'a' : x.avg < 0.95 ? 'n' : 'g'}">${pct(x.avg)}</span></td><td class="n">${x.under} / ${x.obs}</td><td class="n">${x.zero}</td><td class="n"><b>${nf(x.short)}</b></td><td class="n">${tf(s) ? nf(x.short * tf(s)) : '—'}</td></tr>`).join('');
      renderInvDrill(A, s);
    } else { ['chInvGen', 'chInvCuf', 'chInvLoss', 'tInvSite'].forEach(id => $(id).innerHTML = ''); $('invMeta').textContent = 'No inverter data in the selected dates.'; $('invDrill').hidden = true; }
    // portfolio list
    document.querySelectorAll('#invSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.f === state.invF));
    const list = A.inverters.filter(I => I.obs > 0 && (state.invF === 'all' || I.avg < 0.95 || I.zero > 0)).sort((a, b) => a.avg - b.avg);
    $('tInv').innerHTML = '<tr><th>Site</th><th>Inverter</th><th class="n">DC kW</th><th class="n">Avg vs reference</th><th class="n">Days &lt;90%</th><th class="n">Days &lt;70%</th><th class="n">Days at 0</th><th class="n">Lost kWh</th><th class="n">Latest</th></tr>' +
      (list.length ? list.map(I => { const ld = I.days.filter(Boolean).pop(); return `<tr class="click" data-invsite="${esc(I.site)}" data-inv="${I.inv}"><td>${esc(I.site)}</td><td>Inv ${I.inv}</td><td class="n">${nf(I.dc, 1)}</td><td class="n"><span class="pill ${I.avg < SET.invLow ? 'r' : I.avg < 0.9 ? 'a' : I.avg < 0.95 ? 'n' : 'g'}">${pct(I.avg)}</span></td><td class="n">${I.under} / ${I.obs}</td><td class="n">${I.low}</td><td class="n">${I.zero}</td><td class="n">${nf(I.short)}</td><td class="n">${ld ? pct(ld.k) + ' · ' + dl(ld.date) : '—'}</td></tr>`; }).join('')
        : '<tr class="more"><td colspan="9">Every inverter averaged 95% or more of its site reference</td></tr>');
    const D = A.dips;
    $('dipDesc').textContent = `Days an inverter fell below 30% of its site reference and was back to ${Math.round(SET.invLow * 100)}% or more on the next DGR. ${D.length} found${D.length > 12 ? ', latest 12 shown' : ''}.`;
    $('dips').innerHTML = D.length ? D.slice(0, 12).map(e => `<div class="ticket" data-invsite="${esc(e.site)}" data-inv="${e.inv}" style="cursor:pointer"><div class="head"><span class="site">${esc(e.site)} · Inv ${e.inv}</span><span class="pill g">Recovered next DGR</span></div><div class="row">${dl(e.date)}: <b>${nf(e.v)} kWh</b> (${pct(e.k)} of reference)</div><div class="row">${dl(e.nextDate)}: <b>${nf(e.nv)} kWh</b> (${pct(e.nk)})</div></div>`).join('') : '<p class="desc">None in this range.</p>';
  }
  function renderInvDrill(A, s) {
    const box = $('invDrill'); const I = s && s.inv.find(x => x.inv === state.invSel && x.obs > 0);
    if (!I) { box.hidden = true; return; }
    box.hidden = false;
    const days = I.days.filter(Boolean), t = tf(s);
    $('invDrillTitle').textContent = `${s.name} · Inverter ${I.inv}, day by day`;
    $('invDrillDesc').textContent = `${dl(A.from)} – ${dl(A.to)}. "Lost" = what it made below the site's median inverter per kWp that day (only counted when below 95%).`;
    $('invDrillKpis').innerHTML = [
      kpi('Generated', energy(I.gen), `${days.length} days · DC ${nf(I.dc, 1)} kW`),
      kpi('DC CUF', I.dc ? pct(I.gen / (I.dc * 24 * I.obs), 2) : '—', `Site ${pct(s.cuf, 2)}`),
      kpi('Lost', energy(I.short), `${nf(I.short / Math.max(1, I.gen + I.short) * 100, 1)}% of what it could have made`, I.short > 0 ? 'alert' : ''),
      kpi('Lost ₹', t ? inr(I.short * t) : '—', t ? `at ₹${nf(t, 3)}/kWh` : 'No tariff'),
    ].join('');
    stackChart($('chInvDay'), days.map(d => d.date), [{ vals: days.map(d => d.v), color: '--accent', label: 'Generated' }, { vals: days.map(d => d.loss), color: '--bad', label: 'Lost' }], { label: 'Inverter daily generation and loss' });
    $('tInvDay').innerHTML = '<tr><th>Date</th><th class="n">Generated kWh</th><th class="n">DC CUF</th><th class="n">vs site reference</th><th class="n">Lost kWh</th><th class="n">Lost ₹</th></tr>' +
      days.slice().reverse().map(d => `<tr><td>${dl(d.date)}</td><td class="n">${nf(d.v)}</td><td class="n">${d.cuf == null ? '—' : nf(d.cuf * 100, 2) + '%'}</td><td class="n"><span class="pill ${d.k < SET.invLow ? 'r' : d.k < 0.9 ? 'a' : d.k < 0.95 ? 'n' : 'g'}">${pct(d.k)}</span></td><td class="n">${nf(d.loss)}</td><td class="n">${t ? nf(d.loss * t) : '—'}</td></tr>`).join('') +
      `<tr><td><b>Total</b></td><td class="n"><b>${nf(I.gen)}</b></td><td></td><td></td><td class="n"><b>${nf(I.short)}</b></td><td class="n"><b>${t ? nf(I.short * t) : '—'}</b></td></tr>`;
  }

  // ---------- Temperature ----------
  function renderTemp(A) {
    const S = Object.values(A.sites), T = A.trend, amb = S.filter(s => s.ambDays), mod = S.filter(s => s.modDays);
    $('tpKpis').innerHTML = [
      kpi('Average ambient', amb.length ? nf(DGR.mean(T.map(t => t.amb)), 1) + ' <small>°C</small>' : 'Not logged', `${amb.length} of ${S.length} sites logged it`),
      kpi('Hottest ambient', amb.length ? nf(Math.max(...amb.map(s => s.ambMax)), 1) + ' <small>°C</small>' : '—', amb.length ? esc(amb.slice().sort((x, y) => y.ambMax - x.ambMax)[0].name) : ''),
      kpi('Average module', mod.length ? nf(DGR.mean(T.map(t => t.mod)), 1) + ' <small>°C</small>' : 'Not in DGR', mod.length ? `${mod.length} sites logged it` : 'Add "Module Temp (°C)" to the DGR form', mod.length ? '' : 'alert'),
      kpi('Days with ambient logged', `${nf(S.reduce((x, s) => x + s.ambDays, 0))} <small>of ${nf(S.reduce((x, s) => x + s.days, 0))}</small>`, 'Site-days in the selected dates'),
    ].join('');
    lineChart($('chTp'), T.map(t => t.date), [{ vals: T.map(t => t.amb), color: '--series2', label: 'Ambient', fmt: v => nf(v, 1) + ' °C' }, { vals: T.map(t => t.mod), color: '--bad', label: 'Module', fmt: v => nf(v, 1) + ' °C' }], { unitL: '°', label: 'Temperature' });
    $('tpDesc').textContent = mod.length ? 'Module minus ambient shows how hot the panels run; every 1 °C above 25 °C costs roughly 0.35–0.45% of output for typical crystalline modules.' : 'Module temperature is not in the DGR yet. Once the DGR app has a "Module Temp (°C)" column, it fills in here automatically. Ambient is logged at few sites; ask site engineers to fill it daily.';
    $('tTp').innerHTML = '<tr><th>Site</th><th class="n">Ambient avg °C</th><th class="n">Ambient max °C</th><th class="n">Days logged</th><th class="n">Module avg °C</th><th class="n">Module max °C</th><th class="n">Module − ambient</th><th class="n">WTI avg °C</th></tr>' +
      S.slice().sort((x, y) => (y.ambAvg ?? -99) - (x.ambAvg ?? -99)).map(s => `<tr class="click" data-site="${esc(s.name)}"><td>${esc(s.name)}</td><td class="n">${nf(s.ambAvg, 1)}</td><td class="n">${isFinite(s.ambMax) ? nf(s.ambMax, 1) : '—'}</td><td class="n">${s.ambDays ? s.ambDays + ' / ' + s.days : '<span class="pill a">0 / ' + s.days + '</span>'}</td><td class="n">${nf(s.modAvg, 1)}</td><td class="n">${isFinite(s.modMax) ? nf(s.modMax, 1) : '—'}</td><td class="n">${s.modAvg != null && s.ambAvg != null ? nf(s.modAvg - s.ambAvg, 1) : '—'}</td><td class="n">${nf(s.wtiAvg, 1)}</td></tr>`).join('');
  }

  // ---------- Equipment schedule ----------
  function maint() {
    const key = state.Ykey + '|' + state.all.length + '|' + JSON.stringify(state.mfreq) + '|' + state.mlog.length;
    if (state.MT && state.MTkey === key) return state.MT;
    state.MT = OPS.maintenance(state.all, { freq: state.mfreq, log: state.mlog }); state.MTkey = key; return state.MT;
  }
  const eqTxt = x => x.status === 'none' ? '—' : x.status === 'overdue' ? `Overdue ${-x.left} d` : x.left === 0 ? 'Due today' : x.status === 'due' ? `Due in ${x.left} d` : `${x.left} d left`;
  function renderEquip() {
    const M = maint(), f = $('eqStatus').value;
    const cnt = { overdue: 0, due: 0, ok: 0, none: 0 }; M.sites.forEach(s => M.eq.forEach(e => cnt[M.by[s][e.key].status]++));
    $('navEquip').textContent = cnt.overdue || '';
    $('eqKpis').innerHTML = [kpi('Overdue', `${cnt.overdue}`, 'Site × equipment checks past their date', cnt.overdue ? 'alert' : ''), kpi('Due in 7 days', `${cnt.due}`, 'Plan these this week'), kpi('Up to date', `${cnt.ok}`, 'Done within their frequency'), kpi('No record yet', `${cnt.none}`, 'Never seen in the DGR or log')].join('');
    $('eqDesc').textContent = `As of ${dly(M.today)}. "Last done" comes from the DGR Daily Activity and Remarks (words like inspection, checking, cleaning, tightness) and from work marked done here.`;
    const sites = M.sites.filter(s => !f || M.eq.some(e => M.by[s][e.key].status === f));
    $('tEq').innerHTML = '<tr><th style="text-align:left">Site</th>' + M.eq.map(e => `<th title="${esc(e.what)}">${esc(e.name)}<br><span class="muted" style="font-weight:400">every ${M.by[M.sites[0]][e.key].freq} d</span></th>`).join('') + '</tr>' +
      sites.map(s => `<tr><td>${esc(s)}</td>` + M.eq.map(e => { const x = M.by[s][e.key]; const show = !f || x.status === f; return `<td class="e ${show ? x.status : 'none'}" data-eqsite="${esc(s)}" data-eqkey="${e.key}" title="${esc(e.name)} at ${esc(s)}: ${x.last ? 'last ' + dly(x.last.date) + ', next ' + dly(x.next) : 'no record'}">${show ? eqTxt(x) : ''}</td>`; }).join('') + '</tr>').join('');
    $('tEqFreq').innerHTML = '<tr><th>Equipment</th><th>What to check</th><th class="n">Every (days)</th></tr>' + M.eq.map(e => `<tr><td><b style="font-weight:600">${esc(e.name)}</b></td><td class="muted">${esc(e.what)}</td><td class="n"><input type="number" min="1" max="730" style="width:80px" data-freq="${e.key}" value="${state.mfreq[e.key] || e.freq}" aria-label="${esc(e.name)} frequency in days"></td></tr>`).join('');
    renderEqPanel();
  }
  function renderEqPanel() {
    const box = $('eqPanel'); const sel = state.eqSel; if (!sel) { box.hidden = true; return; }
    const M = maint(), e = M.eq.find(q => q.key === sel.eq), x = M.by[sel.site] && M.by[sel.site][sel.eq]; if (!e || !x) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="card-head"><div><h3>${esc(e.name)} · ${esc(sel.site)}</h3><p class="desc">${esc(e.what)}. Every ${x.freq} days. ${x.last ? `Last done ${dly(x.last.date)}, next due ${dly(x.next)} (${eqTxt(x)}).` : 'No record yet.'}</p></div><button class="btn" id="eqClose">Close</button></div>
      <form id="eqForm" class="actions" style="margin:0 0 12px"><label for="eqDate">Mark done on</label><input type="date" id="eqDate" value="${M.today}"><input type="text" id="eqBy" placeholder="Done by" style="font:inherit;font-size:12.5px;padding:7px 10px;border:1px solid var(--line);border-radius:7px;background:var(--card);color:var(--ink)"><input type="text" id="eqNote" placeholder="Note (optional)" style="flex:1;min-width:160px;font:inherit;font-size:12.5px;padding:7px 10px;border:1px solid var(--line);border-radius:7px;background:var(--card);color:var(--ink)"><button class="btn primary" type="submit">Mark done</button><span class="status" id="eqSaveMsg"></span></form>
      <div class="tw"><table><tr><th>Date</th><th>Source</th><th>By</th><th>Detail</th></tr>${x.history.slice().reverse().slice(0, 30).map(h => `<tr><td>${dly(h.date)}</td><td><span class="pill ${h.src === 'Logged' ? 'g' : 'n'}">${h.src === 'Logged' ? 'Marked done' : 'From DGR'}</span></td><td>${esc(h.by || '—')}</td><td>${esc(h.text || '')}</td></tr>`).join('') || '<tr class="more"><td colspan="4">No record</td></tr>'}</table></div>`;
    box.scrollIntoView({ block: 'nearest' });
  }
  async function saveMaint(msgEl) {
    const body = JSON.stringify({ updated: new Date().toISOString(), freq: state.mfreq, log: state.mlog });
    try { localStorage.setItem('stockwell-dgr-maint', body); } catch (e) { /* storage blocked */ }
    if (!artifactNs) { msgEl.className = 'status'; msgEl.textContent = 'Saved in this browser only. Saving for everyone needs the published dashboard or the DGR app.'; return; }
    try { await artifactNs.publish({ 'data/maintenance.json': { content: body, contentType: 'application/json' } }); msgEl.className = 'status ok'; msgEl.textContent = 'Saved for everyone.'; }
    catch (e) { msgEl.className = 'status err'; msgEl.textContent = e && (e.code === 'not_writer' || e.code === 'not_granted') ? 'Saved in this browser only: you can view but not edit this dashboard.' : 'Could not save for everyone (' + ((e && e.code) || 'error') + '). Kept in this browser.'; }
  }
  async function loadMaint() {
    let j = null;
    try { const r = await fetch(CFG.maintenanceUrl || 'data/maintenance.json', { cache: 'no-store' }); if (r.ok) j = await r.json(); } catch (e) { /* none yet */ }
    try { const l = JSON.parse(localStorage.getItem('stockwell-dgr-maint') || 'null'); if (l && (!j || l.updated > j.updated)) j = l; } catch (e) { /* ignore */ }
    if (j) { state.mlog = j.log || []; state.mfreq = j.freq || {}; }
  }
  function eqCsv() { const M = maint(); offer(`Stockwell_maintenance_schedule_${M.today}.csv`, csv([['Site', 'Equipment', 'Every (days)', 'Last done', 'Source', 'Next due', 'Status', 'Days left']].concat(M.sites.flatMap(s => M.eq.map(e => { const x = M.by[s][e.key]; return [s, e.name, x.freq, x.last ? x.last.date : '', x.last ? x.last.src : '', x.next || '', x.status, x.left ?? '']; })))), $('eqMsg')); }

  // ---------- Maintenance report (one site, one month) ----------
  function renderMReport() {
    const all = state.all, sites = [...new Set(all.map(r => r.site))].sort((x, y) => x.localeCompare(y));
    const months = [...new Set(all.filter(r => r._src !== 'cuf').map(r => r.date.slice(0, 7)))].sort().reverse();
    if (!sites.includes(state.mrSite)) state.mrSite = sites.includes(state.site) ? state.site : sites[0];
    if (!months.includes(state.mrMonth)) state.mrMonth = months[0];
    $('mrSite').innerHTML = sites.map(n => `<option${n === state.mrSite ? ' selected' : ''}>${esc(n)}</option>`).join('');
    $('mrMonth').innerHTML = months.map(m => `<option value="${m}"${m === state.mrMonth ? ' selected' : ''}>${MONL(m)}</option>`).join('');
    const rows = all.filter(r => r.site === state.mrSite && r.date.slice(0, 7) === state.mrMonth).sort((x, y) => x.date < y.date ? -1 : 1);
    const dgr = rows.filter(r => r._src !== 'cuf'), txt = r => (r.activity || '') + ' ' + (r.remarks || '');
    const has = re => dgr.filter(r => re.test(txt(r))).length;
    const days = new Date(Date.UTC(+state.mrMonth.slice(0, 4), +state.mrMonth.slice(5), 0)).getUTCDate();
    const gen = rows.reduce((x, r) => x + (r.gen_kwh || 0), 0), dc = rows.find(r => r.dc_kwp) ? rows.find(r => r.dc_kwp).dc_kwp : null, t = tariffOfName(state.mrSite);
    const cleaned = dgr.reduce((x, r) => x + (r.modules_cleaned || 0), 0), cleanDays = dgr.filter(r => r.modules_cleaned > 0).length;
    const M = maint(), eqs = M.eq.map(e => ({ e, x: M.by[state.mrSite] && M.by[state.mrSite][e.key], inMonth: (M.by[state.mrSite] ? M.by[state.mrSite][e.key].history : []).filter(h => h.date.slice(0, 7) === state.mrMonth) }));
    const partOf = (txt, re) => String(txt).split(/\n|\/|\.\s|;|,|\(|(?:^|\s)\d+\s*[.)-]\s*/).map(z => z.trim()).find(z => z && re.test(z)) || '';
    const probs = OPS.REMARK_CATS.map(c => { const hits = dgr.filter(r => r.remarks && partOf(r.remarks, c.re)); return hits.length ? { c, n: hits.length, last: hits[hits.length - 1], line: partOf(hits[hits.length - 1].remarks, c.re) } : null; }).filter(Boolean);
    const mr = state.mr = { rows, dgr, eqs, probs };
    $('mrBody').innerHTML = `
      <div class="grid kpis mt">
        ${kpi('DGRs submitted', `${dgr.length} <small>of ${days}</small>`, dgr.length < days ? `${days - dgr.length} days missing` : 'Every day', dgr.length < days ? 'alert' : '')}
        ${kpi('Generation', energy(gen), `${dc ? 'DC CUF ' + nf(gen / (dc * 24 * Math.max(1, rows.filter(r => r.gen_kwh != null).length)) * 100, 2) + '%' : ''}${t ? ' · ' + inr(gen * t) : ''}`)}
        ${kpi('Module cleaning', `${nf(cleaned)} <small>modules</small>`, `${cleanDays} days with cleaning logged`)}
        ${kpi('Grass cutting', `${has(/grass|bush|vegetation/i)} <small>days</small>`, 'Days mentioning grass or bush cutting')}
        ${kpi('Inspections', `${has(/inspect|checking|check\b/i)} <small>days</small>`, 'Days with inspection or checking work')}
        ${kpi('Outages', `${nf(rows.reduce((x, r) => x + (r.plant_out_min || 0), 0))} <small>min plant</small>`, `${nf(rows.reduce((x, r) => x + (r.grid_out_min || 0), 0))} min grid`)}
      </div>
      <div class="card mr-sec"><h3>Equipment maintenance</h3><p class="desc">Work found in this month's DGRs or marked done, and the current schedule status.</p><div class="tw"><table><tr><th>Equipment</th><th class="n">Done this month</th><th>Last done</th><th>Next due</th><th>Status</th></tr>${eqs.map(({ e, x, inMonth }) => `<tr><td><b style="font-weight:600">${esc(e.name)}</b><br><span class="muted" style="font-size:11.5px">${esc(e.what)}</span></td><td class="n">${inMonth.length || '—'}</td><td>${x && x.last ? dly(x.last.date) : '—'}</td><td>${x && x.next ? dly(x.next) : '—'}</td><td><span class="pill ${!x || x.status === 'none' ? 'n' : x.status === 'overdue' ? 'r' : x.status === 'due' ? 'a' : 'g'}">${x ? (x.status === 'none' ? 'No record' : eqTxt(x)) : '—'}</span></td></tr>`).join('')}</table></div></div>
      <div class="grid two mr-sec">
        <div class="card"><h3>Problems reported</h3><p class="desc">From Remarks this month.</p>${probs.length ? '<div class="wlist">' + probs.map(p => `<div class="issue">${sevPill(p.c.sev)}<span class="t">${esc(p.c.label)}</span><span class="k">${p.n} DGR${p.n > 1 ? 's' : ''}</span><span class="d">"${esc(p.line.replace(/^remarks\s*:?-?\s*/i, '').slice(0, 160))}" (last ${dl(p.last.date)})</span></div>`).join('') + '</div>' : '<p class="desc">No problems written in Remarks.</p>'}</div>
        <div class="card"><h3>Transformer readings</h3><div class="wlist">${[['WTI avg / max', (() => { const v = dgr.map(r => r.wti).filter(x => x != null); return v.length ? nf(DGR.mean(v), 1) + ' / ' + nf(Math.max(...v), 1) + ' °C' : 'Not logged'; })()], ['OTI avg / max', (() => { const v = dgr.map(r => r.oti).filter(x => x != null); return v.length ? nf(DGR.mean(v), 1) + ' / ' + nf(Math.max(...v), 1) + ' °C' : 'Not logged'; })()], ['Silica gel (last)', esc((dgr.slice().reverse().find(r => r.silica_gel) || {}).silica_gel || 'Not logged')], ['MOG level (last)', esc((dgr.slice().reverse().find(r => r.mog_level) || {}).mog_level || 'Not logged')], ['Ambient avg', (() => { const v = dgr.map(r => r.amb_temp).filter(x => x != null); return v.length ? nf(DGR.mean(v), 1) + ' °C (' + v.length + ' days)' : 'Not logged'; })()], ['Fault codes', esc([...new Set(dgr.flatMap(r => String(r.fault_codes || '').split(/[;,]/).map(z => z.trim()).filter(Boolean)))].join(', ') || 'None')]].map(([k, v]) => `<div class="wrow"><span>${k}</span><b>${v}</b></div>`).join('')}</div></div>
      </div>
      <div class="card mr-sec"><h3>Daily activity log</h3><div class="tw tall"><table><tr><th>Date</th><th class="n">Gen kWh</th><th class="n">Cleaned</th><th>Activity</th><th>Remarks</th><th>By</th></tr>${rows.slice().reverse().map(r => `<tr><td>${dl(r.date)}</td><td class="n">${nf(r.gen_kwh)}</td><td class="n">${r.modules_cleaned ? nf(r.modules_cleaned) : '—'}</td><td style="max-width:360px">${esc((r.activity || (r._src === 'cuf' ? '(no DGR text)' : '—')).replace(/\s+/g, ' '))}</td><td style="max-width:360px">${esc((r.remarks || '').replace(/\s+/g, ' '))}</td><td class="muted">${esc(r.submitted_by || '')}</td></tr>`).join('')}</table></div></div>`;
  }
  function mrCsv() { const m = state.mr; if (!m) return; offer(`Stockwell_maintenance_${state.mrSite.replace(/\W+/g, '_')}_${state.mrMonth}.csv`, csv([['Date', 'Generation kWh', 'Modules cleaned', 'Plant outage min', 'Grid outage min', 'WTI', 'OTI', 'Silica gel', 'MOG', 'Activity', 'Remarks', 'Submitted by']].concat(m.rows.map(r => [r.date, r.gen_kwh, r.modules_cleaned, r.plant_out_min, r.grid_out_min, r.wti, r.oti, r.silica_gel, r.mog_level, (r.activity || '').replace(/\s+/g, ' '), (r.remarks || '').replace(/\s+/g, ' '), r.submitted_by]))
    .concat([[], ['Equipment', 'Done this month', 'Last done', 'Next due', 'Status']]).concat(m.eqs.map(({ e, x, inMonth }) => [e.name, inMonth.length, x && x.last ? x.last.date : '', x && x.next ? x.next : '', x ? x.status : '']))), $('mrMsg')); }

  // ---------- Ranking ----------
  const rankRows = A => Object.values(A.sites).sort((a, b) => (a.pi ?? 9) - (b.pi ?? 9));
  function renderRanking(A) {
    $('tRank').innerHTML = '<tr><th class="n">#</th><th>Site</th><th>Status</th><th class="n">DC kWp</th><th class="n">Gen kWh</th><th class="n">Revenue ₹</th><th class="n">Tariff</th><th class="n">DC CUF %</th><th class="n">Performance</th><th class="n">Last 7 days</th><th class="n">AC CUF %</th><th class="n">Loss kWh</th><th class="n">Loss %</th><th class="n">Grid min</th><th class="n">Trips</th></tr>' +
      rankRows(A).map((s, i) => `<tr class="click" data-site="${esc(s.name)}"><td class="n">${i + 1}</td><td>${esc(s.name)}</td><td><span class="pill sev ${s.status}">${s.status}</span></td><td class="n">${nf(s.dc, 1)}</td><td class="n">${nf(s.gen)}</td><td class="n">${revOf(s) != null ? nf(revOf(s)) : '—'}</td><td class="n">${tf(s) ? nf(tf(s), 3) : '—'}</td><td class="n">${s.cuf == null ? '—' : nf(s.cuf * 100, 2)}</td><td class="n"><b>${pct(s.pi)}</b></td><td class="n">${pct(s.pi7)}</td><td class="n">${nf(s.ac_cuf, 2)}</td><td class="n">${nf(s.loss.total)}</td><td class="n">${nf(s.lossPct, 1)}</td><td class="n">${nf(s.grid)}</td><td class="n">${nf(s.gridEv)}</td></tr>`).join('');
  }

  // ---------- Transformers ----------
  function renderTrafo(A) {
    const T = A.trend;
    lineChart($('chTemp'), T.map(t => t.date), [{ vals: T.map(t => t.wti), color: '--bad', label: 'WTI', fmt: v => nf(v, 1) + ' °C' }, { vals: T.map(t => t.oti), color: '--series2', label: 'OTI', dash: true, fmt: v => nf(v, 1) + ' °C' }], { unitL: '°', label: 'WTI and OTI' });
    const S = Object.values(A.sites);
    const hot = S.filter(s => s.wti >= SET.wtiWatch || s.oti >= SET.otiWatch), sil = S.filter(s => s.silica && !/blue/i.test(s.silica)), mog = S.filter(s => s.mog && /at\s*1\/4|below/i.test(s.mog)), nol = S.filter(s => s.wti == null);
    $('trafoDesc').textContent = `Latest DGR per site. Watch levels are set in Settings (WTI ${SET.wtiWatch} °C, OTI ${SET.otiWatch} °C).`;
    $('trafoSummary').innerHTML = [['At or above temperature watch level', hot], ['Silica gel not blue', sil], ['MOG at 1/4 or below', mog], ['WTI not logged', nol]].map(([k, l]) => `<div class="wrow"><span>${k}</span><b><span class="pill ${l.length ? 'a' : 'g'}">${l.length} of ${S.length}</span></b></div>${l.length ? `<div class="desc" style="margin:-4px 0 4px">${l.map(s => esc(s.name)).join(', ')}</div>` : ''}`).join('');
    const rows = S.slice().sort((a, b) => (b.wti ?? -1) - (a.wti ?? -1));
    $('tTrafo').innerHTML = '<tr><th>Site</th><th class="n">WTI °C</th><th class="n">OTI °C</th><th class="n">WTI 7-day max</th><th>Silica gel</th><th>MOG level</th><th>Latest DGR</th></tr>' + rows.map(s => {
      const hotC = s.wti >= SET.wtiWatch || s.oti >= SET.otiWatch;
      return `<tr class="click" data-site="${esc(s.name)}"><td>${esc(s.name)}</td><td class="n">${hotC ? `<span class="pill r">${nf(s.wti, 1)}</span>` : nf(s.wti, 1)}</td><td class="n">${nf(s.oti, 1)}</td><td class="n">${isFinite(s.wtiMax7) ? nf(s.wtiMax7, 1) : '—'}</td><td><span class="pill ${!s.silica ? 'n' : /blue/i.test(s.silica) ? 'g' : 'a'}">${esc(s.silica || '—')}</span></td><td>${s.mog && /at\s*1\/4|below/i.test(s.mog) ? `<span class="pill a">${esc(s.mog)}</span>` : esc(s.mog || '—')}</td><td>${dl(s.latest)}</td></tr>`;
    }).join('');
  }

  // ---------- Discipline ----------
  function renderDiscipline(A) {
    const S = Object.values(A.sites), M = state.Md, n = A.allSites.length, nd = A.dates.length;
    const sub = DGR.median(S.map(s => s.subHours)), rev = DGR.median(S.map(s => s.reviewHours)), same = DGR.mean(S.map(s => s.sameDay));
    const expected = n * nd, got = A.kpi.rows;
    $('discKpis').innerHTML = [
      kpi('DGRs received', `${nf(got)} <small>of ${nf(expected)}</small>`, `${nf(got / Math.max(1, expected) * 100, 1)}% of site-days in range`, got < expected ? 'alert' : ''),
      kpi('Typical submission', hhmm(sub), 'Median time across sites'),
      kpi('Submitted same day', same == null ? '—' : nf(same * 100) + '%', 'Before midnight of the report day'),
      kpi('Approval time', rev == null ? '—' : nf(rev, 1) + ' <small>h</small>', 'Median from submission to approval'),
    ].join('');
    const sb = M.kpi.latestSubmitted;
    $('blankDesc').textContent = `Blank cells across the ${sb} DGRs for ${dly(M.latest)}.`;
    $('tBlank').innerHTML = '<tr><th>Field</th><th>Blank</th></tr>' + (M.blankLatest.filter(b => b.blank).map(b => `<tr><td>${esc(b.label)}</td><td><span class="bar r"><i style="width:${b.blank / Math.max(1, sb) * 100}%"></i></span>${b.blank} of ${sb}</td></tr>`).join('') || '<tr class="more"><td colspan="2">Every field filled</td></tr>');
    const ns = M.notSubmittedLatest;
    $('nsDesc').textContent = `${ns.length} of ${M.allSiteNames.length} sites have no DGR for ${dly(M.latest)}.`;
    $('notSub').innerHTML = ns.length ? ns.map(x => `<div class="wrow"><span>${esc(x)}</span><b><span class="pill r">${A.sites[x] ? 'last ' + dl(A.sites[x].latest) : 'missing'}</span></b></div>`).join('') : '<span class="muted">All sites submitted.</span>';
    $('tRev').innerHTML = '<tr><th>Reviewer</th><th class="n">DGRs approved</th></tr>' + (A.reviewers.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${nf(v)}</td></tr>`).join('') || '<tr class="more"><td colspan="2">No reviewer data</td></tr>');
    const rows = A.allSites.map(name => ({ name, s: A.sites[name] })).sort((a, b) => ((a.s ? a.s.days : 0) - (b.s ? b.s.days : 0)) || ((b.s ? b.s.missing.length : 0) - (a.s ? a.s.missing.length : 0)));
    $('tDisc').innerHTML = '<tr><th>Site</th><th class="n">DGRs</th><th>Latest</th><th class="n">Typical time</th><th class="n">Same day</th><th class="n">Approval h</th><th class="n">Blank fields</th><th class="n">Ambient logged</th><th class="n">WTI logged</th><th>Submitted by</th></tr>' + rows.map(({ name, s }) => s ?
      `<tr class="click" data-site="${esc(name)}"><td>${esc(name)}</td><td class="n">${s.days < nd ? `<span class="pill a">${s.days} / ${nd}</span>` : s.days + ' / ' + nd}</td><td>${s.submittedLatest ? dl(s.latest) : `<span class="pill r">${dl(s.latest)}</span>`}</td><td class="n">${hhmm(s.subHours)}</td><td class="n">${s.sameDay == null ? '—' : nf(s.sameDay * 100) + '%'}</td><td class="n">${nf(s.reviewHours, 1)}</td><td class="n"><span class="pill ${s.missing.length > 5 ? 'r' : s.missing.length ? 'a' : 'g'}">${s.missing.length}</span></td><td class="n">${s.ambDays} / ${s.days}</td><td class="n">${s.wtiDays} / ${s.days}</td><td class="muted">${esc(s.submitters.join(', '))}</td></tr>`
      : `<tr><td>${esc(name)}</td><td class="n"><span class="pill r">0 / ${nd}</span></td><td colspan="8" class="muted">No DGR in range</td></tr>`).join('');
  }

  // ---------- Data & settings ----------
  function renderData() {
    const meta = state.meta || {}, all = state.all, dates = all.map(r => r.date).sort();
    const srcTxt = { sample: 'Built-in sample (made-up demo sites)', saved: 'Saved DGR data on this dashboard', api: CFG.apiUrl ? 'DGR application API: ' + esc(CFG.apiUrl) : 'DGR application, live', local: 'Unsaved upload in this browser' }[state.source];
    $('dataNow').innerHTML = [['Source', srcTxt], ['Rows', `${nf(all.length)} site-days`], ['Sites', nf(new Set(all.map(r => r.site)).size)], ['Dates', dates.length ? `${dly(dates[0])} – ${dly(dates[dates.length - 1])}` : '—'],
      meta.updated ? [state.source === 'api' ? 'Loaded' : 'Last saved', `${new Date(meta.updated).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}${meta.file ? ' · ' + esc(meta.file) : ''}`] : null]
      .filter(Boolean).map(([k, v]) => `<div class="wrow"><span>${k}</span><b>${v}</b></div>`).join('');
  }
  const SET_FIELDS = [['sTariff', 'tariff', 1], ['sGenHours', 'genHours', 1], ['sInvLow', 'invLow', 100], ['sGapHigh', 'siteGapHigh', 100], ['sGapMed', 'siteGapMed', 100], ['sWti', 'wtiWatch', 1], ['sOti', 'otiWatch', 1], ['sGrid', 'gridWeekMin', 1]];
  function renderSettings() { SET_FIELDS.forEach(([id, k, f]) => { $(id).value = SET[k] == null ? '' : Math.round(SET[k] * f * 100) / 100; }); }

  // ---------- upload ----------
  async function readFile(file) {
    const out = $('parseOut'); out.innerHTML = `<p class="status">Reading ${esc(file.name)}…</p>`;
    try {
      const name = file.name.toLowerCase(); let res;
      if (name.endsWith('.json')) { const j = JSON.parse(await file.text()); res = j.fields ? { rows: DGR.unpack(j), report: { sheets: [{ name: 'JSON', rows: 0 }], found: {}, missing: [], warnings: [], derived: { ac_cuf: 0, dc_cuf: 0 } } } : DGR.rowsFromObjects(Array.isArray(j) ? j : (j.rows || j.data || [])); }
      else {
        if (!window.XLSX) throw new Error('The Excel reader did not load. Check the internet connection and reload.');
        const wb = name.endsWith('.csv') ? XLSX.read(await file.text(), { type: 'string', raw: true }) : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
        const sheets = {}; wb.SheetNames.forEach(n => { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }); });
        res = DGR.parseSheets(sheets);
      }
      showReport(file.name, res);
    } catch (e) { out.innerHTML = `<p class="status err">Could not read ${esc(file.name)}: ${esc(e.message)}</p>`; }
  }
  function showReport(fileName, res) {
    const { rows, report } = res; const out = $('parseOut');
    fixNames(rows);
    if (!rows.length) { out.innerHTML = `<p class="status err">${esc((report.warnings || [])[0] || 'No DGR rows found.')}</p>`; return; }
    const dates = rows.map(r => r.date).sort(); const sites = new Set(rows.map(r => r.site));
    state.pending = { file: fileName, rows, report };
    const cap = rows.length === 1000 ? '<p class="status err">This file has exactly 1,000 rows. The DGR app cuts exports off at 1,000, so some days are probably missing. Export a shorter period.</p>' : '';
    const missing = DGR.FIELDS.filter(f => !report.found[f.key]).map(f => f.label);
    out.innerHTML = `<div class="card mt" style="background:var(--paper)"><h3>${esc(fileName)}</h3>
      <p class="desc">${nf(rows.length)} site-days · ${sites.size} sites · ${dly(dates[0])} – ${dly(dates[dates.length - 1])} · ${report.invCount || 0} inverter columns${report.invDc ? ' with DC kW' : ''}</p>${cap}
      ${missing.length ? `<p class="desc">Columns not in this file: ${missing.map(esc).join(', ')}</p>` : '<p class="desc">All DGR columns recognised.</p>'}
      <div class="actions" style="margin:0"><button class="btn primary" id="btnSaveMerge" ${canSave === false ? 'disabled' : ''}>Save, adding to existing data</button><button class="btn" id="btnSaveReplace" ${canSave === false ? 'disabled' : ''}>Save, replacing existing data</button><button class="btn" id="btnDiscard">Discard</button>
      <span class="status" id="saveMsg">${canSave === false ? 'Saving is not available in this view; the data stays in this tab.' : 'Showing this file now. Same site and date replace older rows when adding.'}</span></div></div>`;
    state.source = 'local'; state.all = DGR.mergeRows(state.saved, rows); setDefaultRange(); renderAll();
    $('btnSaveMerge').onclick = () => save(false); $('btnSaveReplace').onclick = () => save(true);
    $('btnDiscard').onclick = () => { state.pending = null; state.all = state.saved.length ? state.saved : DGR.sampleRows(); state.source = state.saved.length ? (state.loadedFrom || 'saved') : 'sample'; $('parseOut').innerHTML = ''; setDefaultRange(); renderAll(); };
  }
  async function save(replace) {
    const msg = $('saveMsg'); if (!state.pending) return;
    if (!artifactNs) { msg.className = 'status err'; msg.textContent = 'Saving is not available in this view.'; return; }
    const rows = replace ? DGR.mergeRows([], state.pending.rows) : DGR.mergeRows(state.saved, state.pending.rows);
    const dates = rows.map(r => r.date).sort();
    const meta = { updated: new Date().toISOString(), file: state.pending.file, rows: rows.length, from: dates[0], to: dates[dates.length - 1], renamed: !!(state.master && state.master.rename) };
    const body = JSON.stringify(DGR.pack(rows, meta));
    if (body.length > 15e6) { msg.className = 'status err'; msg.textContent = 'The saved data would exceed 15 MB. Use "Save, replacing" with fewer months.'; return; }
    document.querySelectorAll('#parseOut .btn').forEach(b => { b.disabled = true; }); msg.className = 'status'; msg.textContent = 'Saving…';
    try {
      await artifactNs.publish({ [CFG.dataUrl]: { content: body, contentType: 'application/json' } });
      state.saved = rows; state.all = rows; state.meta = meta; state.source = 'saved'; state.pending = null;
      $('parseOut').innerHTML = `<p class="status ok">Saved ${nf(rows.length)} site-days. Everyone who opens the dashboard now sees this data.</p>`; renderAll();
    } catch (e) {
      const code = e && e.code; document.querySelectorAll('#parseOut .btn').forEach(b => { b.disabled = false; }); msg.className = 'status err';
      msg.textContent = code === 'conflict' ? 'Someone else saved new data a moment ago. The page is reloading with their version; load your file again after it opens.'
        : code === 'not_writer' || code === 'not_granted' || code === 'consent_required' ? 'You can view this dashboard but not save data to it. Ask the owner for edit access.'
        : code === 'too_large' ? 'The data is too large to save. Use "Save, replacing" with fewer months.'
        : code === 'rate_limited' ? 'Too many saves in a short time. Wait a minute and save again.'
        : code === 'capability_disabled' || code === 'not_declared' ? 'Saving is not available in this view. The data stays in this tab only.'
        : 'Saving failed (' + (code || (e && e.message) || 'unknown error') + '). Try again in a moment.';
      if (['not_writer', 'not_granted', 'capability_disabled', 'not_declared'].includes(code)) canSave = false;
    }
  }

  // ---------- downloads ----------
  async function offer(filename, data, msgEl) {
    if (downloadsNs) {
      try { await downloadsNs.save({ filename, data }); msgEl.className = 'status ok'; msgEl.textContent = 'Saved ' + filename + '.'; }
      catch (e) { msgEl.className = 'status'; msgEl.textContent = e && e.code === 'cancelled' ? 'Download cancelled.' : 'Download not available here (' + ((e && e.code) || 'error') + ').'; }
      return;
    }
    if (!window.claude) { const blob = data instanceof Blob ? data : new Blob([data]); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); msgEl.className = 'status ok'; msgEl.textContent = 'Downloaded ' + filename + '.'; return; }
    msgEl.className = 'status'; msgEl.textContent = 'Downloads are not available in this view.';
  }
  const csv = rows => '﻿' + rows.map(l => l.map(v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
  const r1 = v => v == null || !isFinite(v) ? '' : Math.round(v * 10) / 10;
  function issuesCsv() { const A = state.A; offer(`Stockwell_issues_${A.latest}.csv`, csv([['Severity', 'Site', 'Category', 'Issue', 'Detail', 'Since', 'Days', 'Est kWh']].concat(filteredIssues(A).map(i => [i.sev, i.site, i.cat, i.title, i.detail, i.since || '', i.days ?? '', Math.round(i.kwh)]))), $('issuesMsg')); }
  function lossCsv() { const A = state.A; offer(`Stockwell_loss_${A.from}_to_${A.to}.csv`, csv([['Site', 'Generation kWh', 'Loss kWh', 'Loss %', 'Inverter kWh', 'Plant outage kWh', 'Grid outage kWh', 'Unexplained kWh', 'Performance %'].concat(SET.tariff > 0 ? ['Loss ₹'] : [])].concat(Object.values(A.sites).sort((a, b) => b.loss.total - a.loss.total).map(s => [s.name, Math.round(s.gen), Math.round(s.loss.total), r1(s.lossPct), Math.round(s.loss.inv), Math.round(s.loss.plant), Math.round(s.loss.grid), Math.round(s.loss.resid), r1(s.pi * 100)].concat(SET.tariff > 0 ? [Math.round(s.loss.total * SET.tariff)] : [])))), $('lossMsg')); }
  function rankCsv() { const A = state.A; offer(`Stockwell_site_ranking_${A.from}_to_${A.to}.csv`, csv([['Rank', 'Site', 'Status', 'DC kWp', 'AC kW', 'Tariff ₹/kWh', 'Revenue ₹', 'Generation kWh', 'DC CUF %', 'Performance %', 'Last 7 days %', 'AC CUF %', 'Loss kWh', 'Loss %', 'Grid min', 'Grid trips', 'Plant min', 'Open issues']].concat(rankRows(A).map((s, i) => [i + 1, s.name, s.status, s.dc, s.ac, tf(s) || '', revOf(s) != null ? Math.round(revOf(s)) : '', Math.round(s.gen), r1(s.cuf * 100), r1(s.pi * 100), r1(s.pi7 * 100), r1(s.ac_cuf), Math.round(s.loss.total), r1(s.lossPct), s.grid, s.gridEv, s.plant, s.issues]))), $('rankMsg')); }
  function revCsv() { const A = state.A; offer(`Stockwell_revenue_${A.from}_to_${A.to}.csv`, csv([['Site', 'Tariff ₹/kWh', 'Generation kWh', 'Revenue ₹', 'Est. loss kWh', 'Est. loss ₹', 'Vs target kWh', 'Vs target ₹']].concat(Object.values(A.sites).map(s => [s.name, tf(s) || '', Math.round(s.gen), revOf(s) != null ? Math.round(revOf(s)) : '', Math.round(s.loss.total), tf(s) ? Math.round(s.loss.total * tf(s)) : '', s.target ? Math.round(s.target.dev) : '', s.target && tf(s) ? Math.round(s.target.dev * tf(s)) : '']))), $('revMsg')); }
  function tgCsv() { const A = state.A; offer(`Stockwell_targets_${A.from}_to_${A.to}.csv`, csv([['Site', 'PVsyst DC CUF %', 'Target DC CUF %', 'Target kWh', 'Actual kWh', 'Deviation kWh', 'Deviation %', 'Tariff', 'Deviation ₹', 'Performance %']].concat(Object.values(A.sites).filter(s => s.target).map(s => [s.name, r1(s.pvsyst * 100), Math.round(s.target.cuf * 10000) / 100, Math.round(s.target.kwh), Math.round(s.target.actual), Math.round(s.target.dev), r1(s.target.devPct), tf(s) || '', tf(s) ? Math.round(s.target.dev * tf(s)) : '', r1(s.pi * 100)]))), $('tgMsg')); }
  function templateXlsx() {
    if (!window.XLSX) { $('tplMsg').textContent = 'The Excel library did not load.'; return; }
    const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet([DGR.templateHeaders(20)]);
    XLSX.utils.book_append_sheet(wb, ws, 'DGR');
    offer('Stockwell_DGR_Template.xlsx', new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), $('tplMsg'));
  }

  // ---------- navigation & range ----------
  const TITLES = { temp: 'Temperature', equip: 'Equipment Schedule', mreport: 'Maintenance Report', targets: 'Targets & Revenue', history: 'Monthly History', meter: 'Meter vs DGR', overview: 'Portfolio Overview', pm: 'Maintenance & Activity', cc: 'Command Centre', issues: 'Issues', loss: 'Generation Loss', site: 'Site Details', inverters: 'Inverters', ranking: 'Site Ranking', trafo: 'Transformers', discipline: 'DGR Discipline', data: 'Load DGR Data', settings: 'Settings' };
  function go(view) {
    if (!TITLES[view]) view = 'cc';
    const btn = document.querySelector(`.side button[data-view="${view}"]`);
    if (simple() && btn && btn.classList.contains('adv')) view = 'cc';
    state.view = view;
    document.querySelectorAll('.side button').forEach(b => { if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'v-' + view; });
    const nb = document.querySelector(`.side button[data-view="${view}"]`); $('pageTitle').textContent = simple() && nb && nb.dataset.sl ? (view === 'cc' ? 'Today at a glance' : nb.dataset.sl) : TITLES[view];
    try { history.replaceState(null, '', location.pathname + location.search + '#' + view); } catch (e) { /* ignore */ }
    renderView(view); window.scrollTo(0, 0);
  }
  function openSite(name) { state.site = name; go('site'); }
  function setDefaultRange() {
    const ds = state.all.map(r => r.date).sort(); if (!ds.length) { state.from = state.to = null; return; }
    const last = ds[ds.length - 1]; state.to = last; state.from = last.slice(0, 8) + '01'; if (+last.slice(8) < 7) state.from = addDays(last, -29); if (state.from < ds[0]) state.from = ds[0]; syncRangeInputs();
  }
  function syncRangeInputs() {
    const ds = state.all.map(r => r.date).sort();
    ['dFrom', 'dTo'].forEach(id => { $(id).min = ds[0] || ''; $(id).max = ds[ds.length - 1] || ''; });
    $('dFrom').value = state.from || ''; $('dTo').value = state.to || ''; $('dPreset').value = ''; const pt = $('periodTxt'); if (pt) pt.textContent = state.from ? `Showing ${dl(state.from)} – ${dly(state.to)}` : '';
  }

  function wire() {
    document.addEventListener('click', e => {
      const nav = e.target.closest('.side button'); if (nav) { go(nav.dataset.view); return; }
      const g = e.target.closest('[data-go]'); if (g) { go(g.dataset.go); return; }
      const sv = e.target.closest('[data-sev]'); if (sv) { const s = sv.dataset.sev; state.sev.has(s) ? state.sev.delete(s) : state.sev.add(s); renderIssues(state.A); return; }
      const so = e.target.closest('[data-sort]'); if (so) { state.boardSort = so.dataset.sort; renderCC(state.A); return; }
      const hc = e.target.closest('#hiSeg [data-hc]'); if (hc) { state.hc = hc.dataset.hc; renderHistory(); return; }
      const iv = e.target.closest('#invSeg [data-f]'); if (iv) { state.invF = iv.dataset.f; renderInverters(state.A); return; }
      const iv2 = e.target.closest('[data-inv]'); if (iv2) { if (iv2.dataset.invsite) state.invSite = iv2.dataset.invsite; state.invSel = +iv2.dataset.inv; if (state.view !== 'inverters') go('inverters'); else renderInverters(state.A); $('invDrill').scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      const eqc = e.target.closest('[data-eqsite]'); if (eqc) { state.eqSel = { site: eqc.dataset.eqsite, eq: eqc.dataset.eqkey }; renderEqPanel(); return; }
      if (e.target.id === 'eqClose') { state.eqSel = null; renderEqPanel(); return; }
      if (e.target.id === 'invDrillClose') { state.invSel = null; renderInverters(state.A); return; }
      const st = e.target.closest('[data-site]'); if (st) { openSite(st.dataset.site); }
    });
    $('modeBtn').addEventListener('click', () => { MODE = simple() ? 'full' : 'simple'; try { localStorage.setItem('stockwell-dgr-mode', MODE); } catch (e) { /* ignore */ } applyMode(); go(state.view); });
    $('invSite').addEventListener('change', e => { state.invSite = e.target.value; state.invSel = null; renderInverters(state.A); });
    $('eqStatus').addEventListener('change', () => renderEquip());
    $('btnEqCsv').addEventListener('click', eqCsv); $('btnMrCsv').addEventListener('click', mrCsv);
    $('mrSite').addEventListener('change', e => { state.mrSite = e.target.value; renderMReport(); });
    $('mrMonth').addEventListener('change', e => { state.mrMonth = e.target.value; renderMReport(); });
    $('btnEqFreq').addEventListener('click', () => { document.querySelectorAll('[data-freq]').forEach(i => { const v = parseInt(i.value, 10); if (v > 0) state.mfreq[i.dataset.freq] = v; }); state.MT = null; renderEquip(); saveMaint($('eqFreqMsg')); });
    document.addEventListener('submit', e => { if (e.target.id !== 'eqForm') return; e.preventDefault(); const sel = state.eqSel; if (!sel) return;
      state.mlog.push({ site: sel.site, eq: sel.eq, date: $('eqDate').value || maint().today, by: $('eqBy').value.trim(), note: $('eqNote').value.trim(), at: new Date().toISOString() });
      state.MT = null; renderEquip(); saveMaint($('eqSaveMsg')); });
    $('mtMonth').addEventListener('change', e => { state.mtMonth = e.target.value; renderMeter(); });
    $('btnTgCsv').addEventListener('click', tgCsv); $('btnRevCsv').addEventListener('click', revCsv);
    $('siteSel').addEventListener('change', e => { state.site = e.target.value; renderSite(state.A); });
    $('fCat').addEventListener('change', e => { state.cat = e.target.value; renderIssues(state.A); });
    $('fSite').addEventListener('change', e => { state.fsite = e.target.value; renderIssues(state.A); });
    $('fText').addEventListener('input', e => { state.text = e.target.value; renderIssues(state.A); });
    $('dFrom').addEventListener('change', e => { state.from = e.target.value || null; if (state.to && state.from > state.to) state.to = state.from; syncRangeInputs(); renderAll(); });
    $('dTo').addEventListener('change', e => { state.to = e.target.value || null; if (state.from && state.to < state.from) state.from = state.to; syncRangeInputs(); renderAll(); });
    $('dPreset').addEventListener('change', e => {
      const v = e.target.value; const ds = state.all.map(r => r.date).sort(); if (!v || !ds.length) return; const last = ds[ds.length - 1];
      if (v === 'all') { state.from = ds[0]; state.to = last; } else if (v === 'month') { state.from = last.slice(0, 8) + '01'; state.to = last; } else { state.from = addDays(last, -(+v - 1)); state.to = last; }
      syncRangeInputs(); renderAll();
    });
    $('fileIn').addEventListener('change', e => { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ''; });
    const drop = $('drop');
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
    $('btnIssuesCsv').addEventListener('click', issuesCsv); $('btnLossCsv').addEventListener('click', lossCsv); $('btnRankCsv').addEventListener('click', rankCsv); $('btnTemplate').addEventListener('click', templateXlsx);
    $('setForm').addEventListener('submit', e => {
      e.preventDefault(); const s = Object.assign({}, SET);
      SET_FIELDS.forEach(([id, k, f]) => { const v = $(id).value.trim(); s[k] = v === '' ? (k === 'tariff' ? null : OPS.DEFAULTS[k]) : parseFloat(v) / f; });
      if (s.siteGapMed < s.siteGapHigh) s.siteGapMed = s.siteGapHigh;
      saveSettings(s); renderAll(); $('setMsg').className = 'status ok'; $('setMsg').textContent = 'Applied.';
    });
    $('btnReset').addEventListener('click', () => { saveSettings(Object.assign({}, OPS.DEFAULTS)); renderAll(); $('setMsg').className = 'status ok'; $('setMsg').textContent = 'Defaults restored.'; });
    let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => renderView(state.view), 200); });
  }

  // ---------- data loading ----------
  const inFrame = (() => { try { return window.parent !== window; } catch (e) { return true; } })();
  function waitForParentRows() {
    return new Promise(resolve => {
      const t = setTimeout(() => resolve(null), CFG.embedWaitMs);
      window.addEventListener('message', function once(ev) {
        if (ev.origin !== CFG.parentOrigin || !ev.data || ev.data.type !== 'dgr-rows') return;
        clearTimeout(t); window.removeEventListener('message', once); resolve(ev.data.master ? { rows: ev.data.rows, master: ev.data.master } : ev.data.rows);
      });
      try { window.parent.postMessage({ type: 'dgr-ready' }, CFG.parentOrigin); } catch (e) { /* not embedded */ }
    });
  }
  function fixNames(rows) {
    const R = state.master && state.master.rename; if (!R) return rows;
    rows.forEach(r => { if (R[r.site]) r.site = R[r.site]; }); return rows;
  }
  function useRows(list, source) {
    if (list && !Array.isArray(list) && list.master && list.master.sites) state.master = list.master;
    const rows = DGR.unpack(Array.isArray(list) ? list : list && (list.fields ? list : list.rows || list.data) || []);
    if (!rows.length) return null;
    fixNames(rows);
    state.saved = rows; state.source = source; state.loadedFrom = source; state.meta = { updated: new Date().toISOString() }; return rows;
  }
  async function loadMaster() {
    try { const r = await fetch(CFG.masterUrl || 'data/master.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (j && j.sites && Object.keys(j.sites).length) state.master = j; } } catch (e) { /* no site master */ }
  }
  async function loadData() {
    if (typeof CFG.loadRows === 'function') { try { const r = useRows(await CFG.loadRows(), 'api'); if (r) return r; } catch (e) { state.apiError = String(e.message || e); } }
    if (CFG.embed && inFrame) { const r = useRows(await waitForParentRows(), 'api'); if (r) return r; state.apiError = 'No rows received from the DGR app'; }
    if (CFG.apiUrl) {
      try { const r = await fetch(CFG.apiUrl, { headers: CFG.apiHeaders, credentials: 'include' }); if (!r.ok) throw new Error('HTTP ' + r.status); const rows = useRows(await r.json(), 'api'); if (rows) return rows; }
      catch (e) { state.apiError = CFG.apiUrl + ' returned ' + String(e.message || e); }
    }
    try { const r = await fetch(CFG.dataUrl, { cache: 'no-store' }); if (r.ok) { const j = await r.json(); const rows = DGR.unpack(j); if (rows.length && !(j.meta && j.meta.renamed)) fixNames(rows); if (rows.length) { state.saved = rows; state.meta = j.meta || {}; state.source = 'saved'; state.loadedFrom = 'saved'; return rows; } } } catch (e) { /* none saved yet */ }
    state.source = 'sample'; return DGR.sampleRows();
  }

  async function boot() {
    BOARD_LEGEND = $('boardLegend').innerHTML;
    if (CFG.embed) document.body.classList.add('embed');
    applyMode();
    wire();
    const hv = (location.hash || '').slice(1);
    await loadMaster(); await loadMaint(); state.all = await loadData();
    setDefaultRange(); analyse(); renderChip(); renderBanner(); go(TITLES[hv] ? hv : 'cc');
    if (CFG.embed && inFrame) window.addEventListener('message', ev => {
      if (ev.origin !== CFG.parentOrigin || !ev.data || ev.data.type !== 'dgr-rows') return;
      if (useRows(ev.data.master ? { rows: ev.data.rows, master: ev.data.master } : ev.data.rows, 'api')) { state.all = state.saved; state.apiError = null; setDefaultRange(); renderAll(); }
    });
    if (window.claude && window.claude.use) {
      claude.use('artifact').then(ns => { artifactNs = ns; if (!ns) canSave = false; }).catch(() => { canSave = false; });
      claude.use('downloads').then(ns => { downloadsNs = ns; }).catch(() => {});
    } else canSave = false;
  }
  boot();
})();
