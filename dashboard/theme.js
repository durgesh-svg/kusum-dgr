/* Stockwell DGR Dashboard — themes and background artwork.
 * Each viewer picks a theme and a background; editors can make their choice the default for everyone.
 * Backgrounds are drawn here as SVG (no external images); a site photo can be uploaded instead. */
(function () {
  'use strict';
  const KEY = 'stockwell-dgr-appearance';

  // ---------- themes ----------
  // side: sidebar ground, hover, text, muted text, highlight; L/D: accent + second series for light / dark mode; paper: light-mode page tint
  const SKINS = {
    navy:     { name: 'Stockwell Navy',  side: ['#0F2A4A', '#173E66', '#C9D5E3', '#7F97B2', '#C08A1E'], L: ['#0F2A4A', '#C08A1E'], D: ['#8FB3DC', '#E0B55A'], paper: '#F2F4F7' },
    desert:   { name: 'Thar Desert',     side: ['#4A2A17', '#6B3D20', '#F1DCC5', '#C49A76', '#E8A23B'], L: ['#A4501F', '#2F6DB5'], D: ['#F0A675', '#7FB0E8'], paper: '#F6F1EA' },
    green:    { name: 'Solar Green',     side: ['#0F3B2E', '#175443', '#CFE6DC', '#82AA98', '#C6D84A'], L: ['#0F6B4F', '#D08A1E'], D: ['#6FD3A8', '#F0B860'], paper: '#F1F5F2' },
    sky:      { name: 'Clear Sky',       side: ['#12355B', '#1B4C80', '#D6E6F7', '#8FB0D3', '#3BB2E8'], L: ['#1565C0', '#F08A24'], D: ['#8CC2FF', '#F6B26B'], paper: '#F2F6FB' },
    saffron:  { name: 'Saffron Sunrise', side: ['#3A1F3D', '#562D5A', '#F0DDF0', '#B993BC', '#FF9F1C'], L: ['#C2410C', '#6D28D9'], D: ['#FDBA74', '#C4B5FD'], paper: '#FBF6EF' },
    graphite: { name: 'Control Room (dark)', dark: true, side: ['#0B0E13', '#1A2029', '#C8D0DA', '#6E7A88', '#F5B700'], L: ['#F5B700', '#5CC4FF'], D: ['#F5B700', '#5CC4FF'], paper: '#0E1116' },
    contrast: { name: 'High Contrast',   side: ['#000000', '#262626', '#FFFFFF', '#BBBBBB', '#FFD400'], L: ['#000000', '#B45309'], D: ['#FFD400', '#7DD3FC'], paper: '#FFFFFF', line: ['#9CA3AF', '#6B7280'] },
  };
  function skinCss() {
    let css = '';
    Object.entries(SKINS).forEach(([k, s]) => {
      const side = `--navy:${s.side[0]};--navy2:${s.side[1]};--navy-ink:${s.side[2]};--navy-mute:${s.side[3]};--gold:${s.side[4]};`;
      if (s.dark) {
        const dk = `${side}--accent:${s.D[0]};--series2:${s.D[1]};--paper:#0E1116;--card:#171B22;--ink:#E8EBEF;--muted:#9AA4B1;--line:#29303A;--good:#5CC48F;--good-bg:#12321F;--warn:#E5B650;--warn-bg:#382B0C;--bad:#EE7A73;--bad-bg:#3A1816;--crit:#FFB0AA;--crit-bg:#5A1814;--heat-2:#2B3A4C;--heat-3:#4F78A6;color-scheme:dark;`;
        css += `:root[data-skin="${k}"]{${dk}}\n`;
        return;
      }
      const ln = s.line ? `--line:${s.line[0]};` : '';
      css += `:root[data-skin="${k}"]{${side}--accent:${s.L[0]};--series2:${s.L[1]};--paper:${s.paper};${ln}}\n`;
      const dark = `${side}--accent:${s.D[0]};--series2:${s.D[1]};--paper:#0E1116;${s.line ? `--line:${s.line[1]};` : ''}`;
      css += `@media (prefers-color-scheme: dark){:root[data-skin="${k}"]:not([data-theme="light"]){${dark}}}\n:root[data-theme="dark"][data-skin="${k}"]{${dark}}\n`;
    });
    css += `
      #bgArt{position:fixed;inset:0;z-index:0;pointer-events:none;background-size:cover;background-position:center;}
      #bgArt::after{content:"";position:absolute;inset:0;background:var(--paper);opacity:var(--bg-veil,.86);}
      body.has-bg .shell{position:relative;z-index:1;}
      body.has-bg .side{background:linear-gradient(color-mix(in srgb,var(--navy) 88%,transparent),color-mix(in srgb,var(--navy) 94%,transparent)),var(--bg-img) center/cover;}
      body.has-bg .card{box-shadow:0 1px 2px rgba(0,0,0,.06);}
      .hero{display:none;height:150px;border-radius:12px;margin-bottom:14px;background:linear-gradient(90deg,color-mix(in srgb,var(--navy) 92%,transparent) 0%,color-mix(in srgb,var(--navy) 55%,transparent) 45%,transparent 75%),var(--bg-img) center 78%/cover;color:#fff;padding:22px 26px;flex-direction:column;justify-content:center;gap:6px;border:1px solid var(--line);}
      body.has-bg .hero{display:flex;}
      .hero b{font-size:22px;letter-spacing:.01em;} .hero span{font-size:13px;color:var(--navy-ink);max-width:60ch;}
      @media (max-width:820px){.hero{height:120px;padding:16px;} .hero b{font-size:18px;}}
      .ap-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;}
      .ap-opt{all:unset;box-sizing:border-box;cursor:pointer;border:2px solid var(--line);border-radius:10px;overflow:hidden;background:var(--card);display:flex;flex-direction:column;}
      .ap-opt:hover{border-color:var(--muted);} .ap-opt:focus-visible{outline:2px solid var(--gold);outline-offset:2px;}
      .ap-opt[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 30%,transparent);}
      .ap-sw{height:58px;display:flex;} .ap-sw i{flex:1;}
      .ap-th{height:84px;background-size:cover;background-position:center;background-color:var(--paper);}
      .ap-nm{font-size:12.5px;font-weight:600;padding:8px 10px;color:var(--ink);}
      .ap-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px;font-size:13px;}
      .ap-row input[type=range]{width:180px;}
      .ap-h{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600;margin:16px 0 8px;}
    `;
    return css;
  }

  // ---------- background artwork (original SVG illustrations) ----------
  const W = 1600, H = 900;
  function rnd(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  function sky(p) {
    return `<defs><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p[0]}"/><stop offset=".55" stop-color="${p[1]}"/><stop offset="1" stop-color="${p[2]}"/></linearGradient>
      <radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFF6D6"/><stop offset=".35" stop-color="#FFD87A"/><stop offset="1" stop-color="#FFD87A" stop-opacity="0"/></radialGradient>
      <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D9B98A"/><stop offset="1" stop-color="#B98F5C"/></linearGradient>
      <linearGradient id="pv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3D6FA8"/><stop offset=".5" stop-color="#1D3F6E"/><stop offset="1" stop-color="#132C50"/></linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#sk)"/>
      <circle cx="1220" cy="250" r="260" fill="url(#sun)"/><circle cx="1220" cy="250" r="62" fill="#FFF3C4"/>`;
  }
  function hills() {
    return `<path d="M0 470 C200 430 360 455 520 440 S860 410 1040 445 1380 420 1600 450 V560 H0Z" fill="#C9A87C" opacity=".55"/>
      <rect y="500" width="${W}" height="${H - 500}" fill="url(#gr)"/>`;
  }
  // rows of fixed-tilt tables receding towards the horizon
  function arrays(y0, rows, opts = {}) {
    let s = ''; const vp = { x: 800, y: 470 };
    for (let r = 0; r < rows; r++) {
      const t = r / rows, y = y0 + (H - y0) * Math.pow(t, 1.6) * (opts.depth || 1);
      const scale = 0.25 + 1.6 * Math.pow(t, 1.6), h = 26 * scale, gap = 6 * scale;
      const xl = vp.x - (vp.x + 200) * (0.15 + t * 1.1), xr = vp.x + (W - vp.x + 200) * (0.15 + t * 1.1);
      if (opts.skipFrom && xr > opts.skipFrom && r >= rows - 3) continue;
      // legs
      for (let x = xl; x < xr; x += 70 * scale) s += `<rect x="${x.toFixed(1)}" y="${(y + h).toFixed(1)}" width="${Math.max(1, 3 * scale).toFixed(1)}" height="${(10 * scale).toFixed(1)}" fill="#5B6573"/>`;
      // panel face (tilted towards the viewer/south)
      s += `<polygon points="${xl},${(y + h).toFixed(1)} ${xr},${(y + h).toFixed(1)} ${(xr - 8 * scale).toFixed(1)},${y.toFixed(1)} ${(xl + 8 * scale).toFixed(1)},${y.toFixed(1)}" fill="url(#pv)"/>`;
      // module grid
      const cols = Math.round((xr - xl) / (28 * scale));
      for (let c = 1; c < cols; c++) { const x = xl + (xr - xl) * c / cols; s += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + h).toFixed(1)}" stroke="#9FC2EA" stroke-opacity=".35" stroke-width="${Math.max(.4, .8 * scale).toFixed(2)}"/>`; }
      s += `<line x1="${xl}" y1="${(y + h / 2).toFixed(1)}" x2="${xr}" y2="${(y + h / 2).toFixed(1)}" stroke="#9FC2EA" stroke-opacity=".3" stroke-width="${Math.max(.4, .7 * scale).toFixed(2)}"/>`;
      s += `<line x1="${xl + 8 * scale}" y1="${y.toFixed(1)}" x2="${xr - 8 * scale}" y2="${y.toFixed(1)}" stroke="#D8E8FA" stroke-opacity=".7" stroke-width="${Math.max(.5, 1.2 * scale).toFixed(2)}"/>`;
      if (gap) { /* row spacing is implicit */ }
    }
    return s;
  }
  function pylon(x, y, k) {
    return `<g stroke="#6B7684" stroke-width="${2 * k}" fill="none" opacity=".8"><path d="M${x} ${y} L${x + 30 * k} ${y - 150 * k} L${x + 60 * k} ${y} M${x + 8 * k} ${y - 40 * k} H${x + 52 * k} M${x + 16 * k} ${y - 80 * k} H${x + 44 * k} M${x + 6 * k} ${y - 120 * k} H${x + 54 * k} M${x + 30 * k} ${y - 150 * k} V${y - 165 * k}"/></g>`;
  }
  // a site engineer: hard hat, hi-vis vest with reflective tape
  function engineer(x, y, k, o) {
    const hat = o.hat || '#F7C325', vest = o.vest || '#F26B1D', skin = o.skin || '#8A5A3C', pant = o.pant || '#2E3A4C', shirt = o.shirt || '#E9EEF4';
    let s = `<g transform="translate(${x} ${y}) scale(${k})">`;
    s += `<ellipse cx="0" cy="0" rx="34" ry="7" fill="#000" opacity=".18"/>`;
    s += `<path d="M-14 -4 L-11 -92 H11 L14 -4 H5 L1 -70 L-3 -4Z" fill="${pant}"/>`;
    s += `<rect x="-16" y="-6" width="12" height="6" rx="2" fill="#2A2018"/><rect x="4" y="-6" width="12" height="6" rx="2" fill="#2A2018"/>`;
    s += `<path d="M-22 -150 Q0 -160 22 -150 L20 -88 H-20Z" fill="${shirt}"/>`;
    s += `<path d="M-21 -148 Q0 -156 21 -148 L19 -92 H-19Z" fill="${vest}"/>`;
    s += `<rect x="-19" y="-118" width="38" height="5" fill="#E8EEF2" opacity=".95"/><rect x="-19" y="-104" width="38" height="5" fill="#E8EEF2" opacity=".95"/>`;
    s += `<rect x="-3" y="-150" width="6" height="58" fill="${shirt}" opacity=".9"/>`;
    // arms
    if (o.point) s += `<path d="M18 -146 L58 -170 L62 -164 L22 -136Z" fill="${shirt}"/><circle cx="62" cy="-168" r="5" fill="${skin}"/>`;
    else s += `<path d="M19 -146 L26 -100 L19 -98 L13 -140Z" fill="${shirt}"/><circle cx="23" cy="-97" r="5" fill="${skin}"/>`;
    if (o.tablet) s += `<path d="M-19 -146 L-30 -112 L-6 -104 L-2 -110 L-20 -116 L-13 -140Z" fill="${shirt}"/><rect x="-14" y="-124" width="26" height="18" rx="2" fill="#1F2937" transform="rotate(-12 -1 -115)"/><rect x="-11" y="-121" width="20" height="12" fill="#5CC4FF" opacity=".8" transform="rotate(-12 -1 -115)"/>`;
    else s += `<path d="M-19 -146 L-26 -100 L-19 -98 L-13 -140Z" fill="${shirt}"/><circle cx="-23" cy="-97" r="5" fill="${skin}"/>`;
    s += `<rect x="-5" y="-162" width="10" height="10" fill="${skin}"/><ellipse cx="0" cy="-174" rx="13" ry="15" fill="${skin}"/>`;
    s += `<path d="M-16 -178 Q0 -200 16 -178 Z" fill="${hat}"/><rect x="-19" y="-180" width="38" height="5" rx="2.5" fill="${hat}"/><rect x="-2" y="-196" width="4" height="16" fill="#000" opacity=".12"/>`;
    s += `</g>`;
    return s;
  }
  function inverterRoom(x, y, k) {
    return `<g transform="translate(${x} ${y}) scale(${k})"><rect x="0" y="-70" width="150" height="70" fill="#E7E2D8"/><rect x="0" y="-80" width="158" height="12" fill="#8C8577"/><rect x="18" y="-50" width="26" height="50" fill="#4B5563"/><rect x="70" y="-52" width="60" height="22" fill="#9CA3AF"/><rect x="74" y="-48" width="52" height="14" fill="#CBD5E1"/></g>`;
  }
  const ART = {
    field: { name: 'Solar plant at sunrise', svg: () => sky(['#F6C48A', '#FBE3C0', '#FCEFD9']) + hills() + pylon(120, 500, .9) + pylon(1470, 500, .8) + `<path d="M150 360 Q 800 330 1500 365" stroke="#6B7684" stroke-width="1.5" fill="none" opacity=".6"/>` + inverterRoom(1290, 540, .9) + arrays(500, 11) },
    engineers: { name: 'Engineers inspecting the array', svg: () => sky(['#9CC9EF', '#D6EAF8', '#F1F7FC']) + hills() + pylon(1450, 500, .8) + arrays(500, 9, { depth: .82 }) +
      engineer(1090, 860, 1.55, { point: true }) + engineer(1250, 872, 1.6, { tablet: true, hat: '#FFFFFF', vest: '#C6E83A', skin: '#6E452D', shirt: '#2D4B6B' }) + engineer(1380, 850, 1.45, { hat: '#F7C325', vest: '#F26B1D', skin: '#A06A47', pant: '#3B3B3B' }) },
    aerial: { name: 'Plant from above', svg: () => { let s = `<rect width="${W}" height="${H}" fill="#D8BE93"/><rect x="0" y="420" width="${W}" height="36" fill="#BFA27A"/><rect x="770" y="0" width="36" height="${H}" fill="#BFA27A"/>`; const R = rnd(7);
      for (let bx = 0; bx < 2; bx++) for (let by = 0; by < 2; by++) { const x0 = bx ? 840 : 40, y0 = by ? 490 : 30, w = 700, h = 360;
        for (let y = y0; y < y0 + h; y += 30) { s += `<rect x="${x0}" y="${y}" width="${w}" height="18" fill="#1F3F6B"/>`; for (let x = x0; x < x0 + w; x += 22) s += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 18}" stroke="#6E9BD0" stroke-opacity=".5"/>`; s += `<line x1="${x0}" y1="${y + 9}" x2="${x0 + w}" y2="${y + 9}" stroke="#6E9BD0" stroke-opacity=".35"/>`; } }
      s += `<rect x="740" y="380" width="96" height="70" fill="#ECE7DD" stroke="#8C8577" stroke-width="3"/><rect x="752" y="392" width="72" height="20" fill="#9CA3AF"/>`;
      for (let i = 0; i < 40; i++) { const x = R() * W, y = R() * H; if ((x > 30 && x < 750 && ((y > 25 && y < 395) || (y > 485 && y < 855))) || (x > 830 && ((y > 25 && y < 395) || (y > 485 && y < 855)))) continue; s += `<circle cx="${x}" cy="${y}" r="${6 + R() * 10}" fill="#7C8F4A" opacity=".8"/>`; }
      return s; } },
    dusk: { name: 'Evening over the plant', svg: () => sky(['#2B2F5A', '#C2577A', '#F6B26B']) + `<path d="M0 470 C200 430 360 455 520 440 S860 410 1040 445 1380 420 1600 450 V560 H0Z" fill="#4A3B55" opacity=".6"/><rect y="500" width="${W}" height="${H - 500}" fill="#6B4A43"/>` + pylon(160, 500, .9) + arrays(500, 10) },
  };
  const svgUrl = svg => "url('data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${svg}</svg>`).replace(/'/g, '%27') + "')";
  const artCache = {};
  const artUrl = k => artCache[k] || (artCache[k] = svgUrl(ART[k].svg()));

  // ---------- state ----------
  const DEF = { skin: 'navy', bg: 'engineers', veil: 0.84, photo: null };
  let shared = {}, local = {};
  try { local = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { local = {}; }
  const cur = () => Object.assign({}, DEF, shared, local);
  function saveLocal(patch) { local = Object.assign({}, local, patch); try { localStorage.setItem(KEY, JSON.stringify(local)); } catch (e) { /* storage full or blocked */ } apply(); render(); }

  function apply() {
    const c = cur(), root = document.documentElement;
    root.setAttribute('data-skin', SKINS[c.skin] ? c.skin : 'navy');
    let bgEl = document.getElementById('bgArt');
    const url = c.bg === 'photo' ? (c.photo ? `url('${c.photo}')` : (shared.photoUrl ? `url('${shared.photoUrl}')` : null)) : (ART[c.bg] ? artUrl(c.bg) : null);
    if (!url) { if (bgEl) bgEl.remove(); document.body.classList.remove('has-bg'); root.style.removeProperty('--bg-img'); }
    else {
      if (!bgEl) { bgEl = document.createElement('div'); bgEl.id = 'bgArt'; bgEl.setAttribute('aria-hidden', 'true'); document.body.prepend(bgEl); }
      bgEl.style.backgroundImage = url; document.body.classList.add('has-bg');
      root.style.setProperty('--bg-veil', String(c.veil)); root.style.setProperty('--bg-img', url);
    }
    const sel = document.getElementById('skinSel'); if (sel) sel.value = c.skin;
  }

  // ---------- Appearance panel (Settings) ----------
  let artifactNs = null;
  function render() {
    const box = document.getElementById('appearance'); if (!box) return;
    const c = cur();
    const skins = Object.entries(SKINS).map(([k, s]) => `<button class="ap-opt" data-skin="${k}" aria-pressed="${c.skin === k}"><span class="ap-sw"><i style="background:${s.side[0]}"></i><i style="background:${s.side[4]}"></i><i style="background:${s.L[0]}"></i><i style="background:${s.dark ? '#171B22' : s.paper}"></i></span><span class="ap-nm">${s.name}</span></button>`).join('');
    const bgs = [['none', 'No background', '']].concat(Object.entries(ART).map(([k, a]) => [k, a.name, artUrl(k)])).concat([['photo', c.photo || shared.photoUrl ? 'Your photo' : 'Upload a site photo…', c.photo ? `url('${c.photo}')` : shared.photoUrl ? `url('${shared.photoUrl}')` : '']])
      .map(([k, n, u]) => `<button class="ap-opt" data-bg="${k}" aria-pressed="${c.bg === k}"><span class="ap-th" style="${u ? `background-image:${u}` : ''}"></span><span class="ap-nm">${n}</span></button>`).join('');
    box.innerHTML = `<div class="ap-h">Theme</div><div class="ap-grid">${skins}</div>
      <div class="ap-h">Background</div><div class="ap-grid">${bgs}</div>
      <div class="ap-row"><label for="apVeil">Background strength</label><input type="range" id="apVeil" min="0.6" max="0.97" step="0.01" value="${c.veil}"><span class="muted" style="font-size:12px">Stronger shows more of the picture; tables stay on solid cards.</span></div>
      <div class="ap-row"><label class="btn" for="apFile">Upload site or team photo</label><input type="file" id="apFile" accept="image/*" hidden>
        <button class="btn primary" id="apShare" ${artifactNs ? '' : 'hidden'}>Use my choice for everyone</button><button class="btn" id="apReset">Reset to default</button><span class="status" id="apMsg"></span></div>
      <p class="desc" style="margin-top:10px">Your choice is saved in this browser. Photos are resized to 1600 px before use.</p>`;
  }
  async function readPhoto(file) {
    const img = await createImageBitmap(file); const k = Math.min(1, 1600 / img.width);
    const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.78);
  }
  async function share() {
    const msg = document.getElementById('apMsg'); const c = cur();
    if (!artifactNs) { msg.textContent = 'Only editors on the published dashboard can set the default.'; return; }
    msg.className = 'status'; msg.textContent = 'Saving…';
    const files = { 'data/appearance.json': { content: JSON.stringify({ skin: c.skin, bg: c.bg, veil: c.veil, photoUrl: c.bg === 'photo' && c.photo ? 'data/bg-photo.jpg' : (c.bg === 'photo' ? shared.photoUrl || null : null) }), contentType: 'application/json' } };
    if (c.bg === 'photo' && c.photo) files['data/bg-photo.jpg'] = await (await fetch(c.photo)).blob();
    try { await artifactNs.publish(files); msg.className = 'status ok'; msg.textContent = 'Saved. Everyone now opens the dashboard with this look.'; }
    catch (e) { msg.className = 'status err'; msg.textContent = e && e.code === 'not_writer' || e && e.code === 'not_granted' ? 'You can view but not change this dashboard.' : 'Could not save (' + ((e && e.code) || 'error') + ').'; }
  }
  document.addEventListener('click', e => {
    const s = e.target.closest('[data-skin].ap-opt'); if (s) { saveLocal({ skin: s.dataset.skin }); return; }
    const b = e.target.closest('[data-bg].ap-opt'); if (b) { if (b.dataset.bg === 'photo' && !cur().photo && !shared.photoUrl) { document.getElementById('apFile').click(); return; } saveLocal({ bg: b.dataset.bg }); return; }
    if (e.target.id === 'apShare') share();
    if (e.target.id === 'apReset') { local = {}; try { localStorage.removeItem(KEY); } catch (er) { /* ignore */ } apply(); render(); }
  });
  document.addEventListener('input', e => { if (e.target.id === 'apVeil') { local.veil = +e.target.value; document.documentElement.style.setProperty('--bg-veil', e.target.value); } });
  document.addEventListener('change', async e => {
    if (e.target.id === 'apVeil') saveLocal({ veil: +e.target.value });
    if (e.target.id === 'skinSel') saveLocal({ skin: e.target.value });
    if (e.target.id === 'apFile' && e.target.files[0]) {
      const msg = document.getElementById('apMsg');
      try { const d = await readPhoto(e.target.files[0]); saveLocal({ photo: d, bg: 'photo' }); }
      catch (er) { if (msg) { msg.className = 'status err'; msg.textContent = 'That photo could not be read. Try a JPG or PNG.'; } }
    }
  });

  // ---------- boot ----------
  const st = document.createElement('style'); st.textContent = skinCss(); document.body.appendChild(st);  // after the page's own styles so themes win ties
  const sel = document.getElementById('skinSel');
  if (sel) sel.innerHTML = Object.entries(SKINS).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
  apply(); render();
  fetch((window.DGR_CONFIG && window.DGR_CONFIG.appearanceUrl) || 'data/appearance.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { if (j) { shared = j; apply(); render(); } }).catch(() => {});
  if (window.claude && window.claude.use) window.claude.use('artifact').then(ns => { artifactNs = ns; render(); }).catch(() => {});
  window.DGR_THEME = { SKINS, ART, apply };
})();
