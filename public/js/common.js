/* Shared client helpers: API wrapper, auth state, formatting, uploads. */
const API = {
  token() { return localStorage.getItem('cbp_token'); },
  setToken(t) { t ? localStorage.setItem('cbp_token', t) : localStorage.removeItem('cbp_token'); },
  user() { try { return JSON.parse(localStorage.getItem('cbp_user') || 'null'); } catch (e) { return null; } },
  setUser(u) { u ? localStorage.setItem('cbp_user', JSON.stringify(u)) : localStorage.removeItem('cbp_user'); },

  async call(path, opts) {
    opts = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    const t = API.token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    const init = { method: opts.method || 'GET', headers };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    const res = await fetch('/api' + path, init);
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (res.status === 401 && path.indexOf('/auth/') !== 0 && path !== '/public/portals') {
      API.setToken(null); API.setUser(null);
      if (!/^\/(super|t\/)/.test(location.pathname) && location.pathname !== '/') location.href = '/';
    }
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || ('Request failed (' + res.status + ')'));
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get(p) { return API.call(p); },
  post(p, body) { return API.call(p, { method: 'POST', body: body || {} }); },
  put(p, body) { return API.call(p, { method: 'PUT', body: body || {} }); },
  del(p) { return API.call(p, { method: 'DELETE' }); },
  async logout() {
    try { await API.post('/auth/logout'); } catch (e) {}
    API.setToken(null); API.setUser(null);
    location.href = '/';
  }
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
let _toastTimer = null;
function toast(msg, kind) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = kind || '';
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 4200);
}
function fileToDataUrl(file) {
  return new Promise(function (resolve, reject) {
    const r = new FileReader();
    r.onload = function () { resolve(r.result); };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    const r = new FileReader();
    r.onload = function () { resolve(String(r.result).split(',')[1]); };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
/* Prevents paste/cut/drop into "own words" boxes (server also enforces length). */
function blockPaste(el) {
  ['paste', 'cut', 'drop', 'copy'].forEach(function (evt) {
    el.addEventListener(evt, function (e) { e.preventDefault(); toast('Please type your own words.', 'err'); });
  });
}
function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function requireSession(roles) {
  try {
    const me = await API.get('/me');
    if (roles && roles.indexOf(me.user.role) === -1) throw new Error('Not permitted');
    API.setUser(me.user);
    return me;
  } catch (e) {
    location.href = '/';
    throw e;
  }
}

/* ============================================================== charts === */
/* Dependency-free chart helpers (inline SVG / CSS) used by every dashboard
   and report. Each one returns an HTML string. */

/* vertical bar chart: items = [{label, value, color?}] */
function chartBars(items, opts) {
  opts = opts || {};
  const list = (items || []).slice(0, opts.max || 12);
  if (!list.length) return '<div class="chart-empty">No data yet.</div>';
  const w = 320, h = 158, gap = 8, baseY = h - 24, topPad = 18;
  const max = Math.max(1, list.reduce(function (m, i) { return Math.max(m, Number(i.value) || 0); }, 0));
  const bw = (w - gap * (list.length - 1)) / list.length;
  let out = '';
  list.forEach(function (it, i) {
    const v = Number(it.value) || 0;
    const bh = Math.max(2, Math.round((baseY - topPad) * (v / max)));
    const x = i * (bw + gap);
    const y = baseY - bh;
    out += '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + bw.toFixed(1) + '" height="' + bh +
      '" rx="3" fill="' + (it.color || 'var(--brand)') + '"><title>' + esc(it.label + ': ' + v) + '</title></rect>' +
      '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 4) + '" text-anchor="middle" font-size="9" fill="#475569">' + esc(String(v)) + '</text>' +
      '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle" font-size="8.5" fill="#64748b">' +
        esc(String(it.label).slice(0, 12)) + '</text>';
  });
  return '<div class="chart"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img">' + out + '</svg></div>' +
    (opts.caption ? '<p class="chart-sub">' + esc(opts.caption) + '</p>' : '');
}

/* horizontal comparison bars: items = [{label, value, color?}] */
function chartBarsH(items, opts) {
  opts = opts || {};
  const list = (items || []).filter(function (x) { return Number(x.value) > 0; }).slice(0, opts.max || 10);
  if (!list.length) return '<div class="chart-empty">No data yet.</div>';
  const max = Math.max.apply(null, list.map(function (i) { return Number(i.value) || 0; }));
  return '<div class="bars">' + list.map(function (it) {
    const v = Number(it.value) || 0;
    const pct = Math.max(3, Math.round(v / max * 100));
    return '<div class="bar-row"><span class="label" title="' + esc(it.label) + '">' + esc(it.label) + '</span>' +
      '<span class="track"><i style="width:' + pct + '%;background:' + (it.color || 'var(--brand)') + '"></i></span>' +
      '<b>' + esc(String(v)) + '</b></div>';
  }).join('') + '</div>' + (opts.caption ? '<p class="chart-sub">' + esc(opts.caption) + '</p>' : '');
}

/* donut: segments = [{label, value, color?}] */
function chartDonut(segments, opts) {
  opts = opts || {};
  const segs = (segments || []).filter(function (s) { return Number(s.value) > 0; });
  const total = segs.reduce(function (a, s) { return a + (Number(s.value) || 0); }, 0);
  if (!total) return '<div class="chart-empty">No data yet.</div>';
  const r = 54, c = 2 * Math.PI * r;
  let off = 0, arcs = '';
  segs.forEach(function (s) {
    const len = c * ((Number(s.value) || 0) / total);
    arcs += '<circle r="' + r + '" cx="70" cy="70" fill="none" stroke="' + (s.color || 'var(--brand)') +
      '" stroke-width="20" stroke-dasharray="' + len.toFixed(2) + ' ' + (c - len).toFixed(2) +
      '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 70 70)"></circle>';
    off += len;
  });
  const legend = segs.map(function (s) {
    return '<span><i style="background:' + (s.color || 'var(--brand)') + '"></i>' + esc(s.label) +
      ' — <b>' + (Number(s.value) || 0) + '</b></span>';
  }).join('');
  const center = opts.center != null ? opts.center : total;
  return '<div class="donut-wrap"><svg viewBox="0 0 140 140" class="donut" role="img">' + arcs +
    '<text x="70" y="68" text-anchor="middle" font-size="22" font-weight="700" fill="#17203a">' + esc(String(center)) + '</text>' +
    '<text x="70" y="86" text-anchor="middle" font-size="9" fill="#64748b">' + esc(opts.centerLabel || 'total') + '</text>' +
    '</svg><div class="legend">' + legend + '</div></div>';
}

/* simple progress rows: items = [{label, percent, note?}] */
function chartProgress(items) {
  const list = items || [];
  if (!list.length) return '<div class="chart-empty">No data yet.</div>';
  return '<div class="bars">' + list.map(function (it) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(it.percent) || 0)));
    return '<div class="bar-row"><span class="label" title="' + esc(it.label) + '">' + esc(it.label) + '</span>' +
      '<span class="track"><i style="width:' + Math.max(2, pct) + '%;background:' + (it.color || 'var(--brand)') + '"></i></span>' +
      '<b>' + pct + '%</b></div>';
  }).join('') + '</div>';
}

/* groups dated rows into the last N ISO weeks: rows = [{createdAt}] */
function chartWeekly(rows, weeks, opts) {
  opts = opts || {};
  const n = weeks || 8;
  const now = new Date();
  const buckets = [];
  for (let i = n - 1; i >= 0; i--) {
    const end = new Date(now.getTime() - i * 7 * 24 * 3600 * 1000);
    const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
    buckets.push({ start: start, end: end, label: (i === 0 ? 'now' : '-' + i + 'w'), value: 0 });
  }
  (rows || []).forEach(function (r) {
    const t = new Date(r.createdAt || r.issuedAt || 0);
    if (isNaN(t.getTime())) return;
    for (let i = 0; i < buckets.length; i++) {
      if (t > buckets[i].start && t <= buckets[i].end) { buckets[i].value++; return; }
    }
  });
  return chartBars(buckets, { caption: opts.caption || 'Grouped into the last ' + n + ' weeks' });
}

function blobDownload(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
function tableToCsv(table) {
  const rows = [];
  table.querySelectorAll('tbody tr').forEach(function (tr) {
    const cells = [];
    tr.querySelectorAll('th, td').forEach(function (td) {
      let v = td.textContent.replace(/\r\n/g, ' ').replace(/\n/g, ' ');
      v = v.replace(/"/g, '""');
      cells.push('"' + v + '"');
    });
    rows.push(cells.join(','));
  });
  return rows.join('\r\n');
}
const reportPrintCss = [
  '.no-print, .export-buttons { display: none !important; }',
  '@media print {',
  '  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #222; margin: 1.2cm; }',
  '  .no-print, .export-buttons { display: none !important; }',
  '  .card { border: 1px solid #d0d7de; border-radius: 8px; padding: 14px 16px; margin: 10px 0; background: #fff; }',
  '  table { border-collapse: collapse; width: 100%; margin: 6px 0; }',
  '  th, td { border: 1px solid #c8d6e5; padding: 6px 8px; font-size: 13px; color: #333; }',
  '  th { background: #eef2f7; color: #1f3a5f; font-weight: 600; text-align: left; }',
  '  tr:nth-child(even) td { background: #fafafa; }',
  '  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }',
  '  .badge.ok { background: #e6f4ea; color: #1a7f37; }',
  '  .badge.warn { background: #fef3c7; color: #92400e; }',
  '  .badge.info { background: #dbeafe; color: #1d4ed8; }',
  '  .badge.off { background: #fee2e2; color: #b91c1c; }',
  '  .badge.lock { background: #e5e7eb; color: #6b7280; }',
  '  .muted { color: #6b7280; }',
  '  .small { font-size: 12px; }',
  '  .exp { display: none; }',
  '  .exp[open] { display: block; }',
  '  .mono { font-family: ui-monospace, SFMono-Regular, monospace; }',
  '  .cert-sheet { border: 1px solid #d0d7de; border-radius: 8px; padding: 24px; text-align: center; }',
  '  .cert-logos { display: flex; justify-content: center; gap: 12px; margin-bottom: 12px; }',
  '  .cert-logos img { max-width: 120px; height: auto; }',
  '  .name { font-size: 22px; font-weight: 700; }',
  '  .books { margin: 10px 0; text-align: left; }',
  '  .books ul { margin: 6px 0 0 22px; padding: 0; }',
  '  .books li { margin: 2px 0; }',
  '  .foot { margin-top: 14px; font-size: 12px; color: #6b7280; }',
  '  .module-card { border: 1px solid #d0d7de; border-radius: 10px; padding: 16px; text-align: center; background: #fff; }',
  '  .module-card .badge { margin-top: 6px; }',
  '  .cert-page { page-break-after: always; }',
  '  .cert-page:last-child { page-break-after: auto; }',
  '  .export-buttons { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }',
  '  .export-buttons button { padding: 5px 10px; font-size: 12px; border-radius: 6px; border: 1px solid #d0d7de; background: #fff; cursor: pointer; }',
  '  .export-buttons button.ghost { border-color: #24508c; color: #24508c; }',
  '  .export-buttons button.ghost:hover { background: #f6f8fb; }',
  '  .report-hint { font-size: 11px; color: #6b7280; margin-top: 4px; }',
  '}',
  'body { font-family: "Helvetica Neue", Arial, sans-serif; color: #222; }',
  'h1, h2, h3, h4 { margin: 0 0 6px 0; }',
  'p { margin: 4px 0; }',
  '.exp summary { cursor: pointer; }',
  '.exp { display: none; }',
  '.exp[open] { display: block; }',
  'input, select, textarea, button { font: inherit; }',
  '',
].join('\n');
function exportReport(type, title, source) {
  const isPrint = type === 'print';
  const isPdf = type === 'pdf';
  const isWord = type === 'word';
  const isExcel = type === 'excel';
  if (isPrint || isPdf) {
    const win = window.open('', '_blank', 'scrollbars=yes,width=800,height=600');
    if (!win) { toast('Allow pop-ups so you can print/export reports.', 'err'); return; }
    const d = win.document;
    d.open();
    d.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>');
    d.write('<style>' + reportPrintCss + '</style></head><body>');
    d.write(escapeHtml(source.nodeType === 1 ? (source.outerHTML || source.innerHTML) : source));
    d.write('</body></html>');
    d.close();
    win.focus();
    win.print();
    return;
  }
  let html = '';
  let csv = '';
  if (source.nodeType === 1) {
    const table = source.tagName === 'TABLE' ? source : source.querySelector('table');
    if (table) csv = tableToCsv(table);
    html = source.outerHTML || source.innerHTML;
  } else {
    html = source;
  }
  const base = (title || 'report').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  if (isExcel) {
    blobDownload(base + '.csv', csv, 'text/csv;charset=utf-8');
    toast('Exported as Excel (.csv)', 'ok');
  } else if (isWord) {
    const doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<style>' + reportPrintCss + '</style></head><body>' + escapeHtml(html) + '</body></html>';
    blobDownload(base + '.doc', doc, 'application/msword');
    toast('Exported as Word (.doc)', 'ok');
  }
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
/* click handler for report export buttons (data-export / data-target) */
document.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-export]');
  if (!btn) return;
  const t = btn.dataset.export;
  let source = null;
  let title = btn.dataset.title || '';
  const row = btn.closest('[data-target]');
  if (row && row.dataset.target) {
    try { source = document.querySelector(row.dataset.target); } catch (err) { source = null; }
  }
  if (!source) {
    const card = btn.closest('.card');
    if (card) source = card.querySelector('.table-wrap') || card.querySelector('table') || card;
  }
  if (!source) source = document.querySelector('.modal .cert-sheet') || document.querySelector('.cert-sheet');
  if (!source) return;
  if (!title) {
    const head = source.querySelector ? (source.querySelector('h3') || null) : null;
    const card = source.closest ? source.closest('.card') : null;
    const cardHead = card ? card.querySelector('h3') : null;
    title = (head || cardHead) ? (head || cardHead).textContent.trim() : 'Report';
  }
  exportReport(t, title, source);
});


/* =================================================== tenant account theme == */
function themeIsHex(color) {
  return /^#[0-9a-f]{6}$/i.test(String(color == null ? '' : color).trim());
}
function themeShade(hex, amt) {
  if (!themeIsHex(hex)) return hex;
  const n = parseInt(String(hex).replace('#', ''), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = function (v) {
    return amt < 0 ? Math.round(v * (1 + amt)) : Math.round(v + (255 - v) * amt);
  };
  r = Math.max(0, Math.min(255, f(r)));
  g = Math.max(0, Math.min(255, f(g)));
  b = Math.max(0, Math.min(255, f(b)));
  return '#' + [r, g, b].map(function (v) {
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}
/* Repaint the whole account layout with the tenant's colour (buttons, nav,
   headers, links...). Called on boot by the admin console, login page and
   participant app so a school account always matches its own colour. */
/* Inline-SVG monogram used as an account's faint mark when it has no logo yet
   (first letters of the account name, drawn in the account colour). */
function portalMarkSrc(name, colour) {
  const initials = String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
  const fill = themeIsHex(colour) ? colour : '#24508c';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
    '<text x="100" y="142" font-family="Segoe UI, Arial, sans-serif" font-size="120" font-weight="700"' +
    ' text-anchor="middle" fill="' + fill + '">' + initials + '</text></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function applyThemeColor(color) {
  const root = document.documentElement;
  if (!themeIsHex(color)) {
    root.style.removeProperty('--brand');
    root.style.removeProperty('--brand-2');
    root.style.removeProperty('--brand-soft');
    root.style.removeProperty('--brand-tint');
    return false;
  }
  const c = String(color).trim();
  root.style.setProperty('--brand', c);
  root.style.setProperty('--brand-2', themeShade(c, -0.3));
  root.style.setProperty('--brand-soft', themeShade(c, 0.84));
  root.style.setProperty('--brand-tint', themeShade(c, 0.94));
  return true;
}

