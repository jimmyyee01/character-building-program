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

/* line chart for trends: items = [{label, value}] (optionally a second series) */
function chartLine(items, opts) {
  opts = opts || {};
  const list = items || [];
  if (!list.length) return '<div class="chart-empty">No data yet.</div>';
  const w = 320, h = 150, padL = 26, padR = 8, padT = 14, padB = 24;
  const max = Math.max(1, list.reduce(function (m, i) {
    return Math.max(m, Number(i.value) || 0, Number(i.value2) || 0);
  }, 0));
  const stepX = list.length > 1 ? (w - padL - padR) / (list.length - 1) : 0;
  const yOf = v => (h - padB) - ((h - padB - padT) * ((Number(v) || 0) / max));
  const pts = list.map(function (it, i) {
    return (padL + i * stepX).toFixed(1) + ',' + yOf(it.value).toFixed(1);
  });
  const pts2 = list.map(function (it, i) {
    return (padL + i * stepX).toFixed(1) + ',' + yOf(it.value2).toFixed(1);
  });
  const area = 'M' + (padL) + ',' + (h - padB) + ' L' + pts.join(' L') + ' L' +
    (padL + stepX * (list.length - 1)) + ',' + (h - padB) + ' Z';
  let grid = '';
  for (let g = 0; g <= 3; g++) {
    const y = padT + ((h - padB - padT) * g / 3);
    grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + y.toFixed(1) +
      '" stroke="#e6ecf5" stroke-width="1"></line>' +
      '<text x="' + (padL - 4) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="8" fill="#94a3b8">' +
      Math.round(max * (1 - g / 3)) + '</text>';
  }
  let labels = '';
  list.forEach(function (it, i) {
    if (list.length > 8 && i % 2 === 1) return;
    labels += '<text x="' + (padL + i * stepX).toFixed(1) + '" y="' + (h - 8) +
      '" text-anchor="middle" font-size="8" fill="#64748b">' + esc(String(it.label).slice(0, 6)) + '</text>';
  });
  const dot = (p, colour) => '<circle cx="' + p.split(',')[0] + '" cy="' + p.split(',')[1] +
    '" r="2.6" fill="' + colour + '"><title></title></circle>';
  return '<div class="chart"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img">' + grid +
    '<path d="' + area + '" fill="' + (opts.fill || 'rgba(47,111,208,.14)') + '"></path>' +
    '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + (opts.color || 'var(--brand)') +
      '" stroke-width="2" stroke-linejoin="round"></polyline>' +
    (opts.second ? '<polyline points="' + pts2.join(' ') + '" fill="none" stroke="#b45309" stroke-width="2"' +
      ' stroke-dasharray="4 3"></polyline>' : '') +
    list.map(function (it, i) {
      return dot(pts[i], opts.color || 'var(--brand)') +
        (opts.second ? dot(pts2[i], '#b45309') : '');
    }).join('') +
    labels +
    '</svg></div>' + (opts.caption ? '<p class="chart-sub">' + esc(opts.caption) + '</p>' : '');
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

/* ================================================= chapter page picker ==== */
/* Every page of the book is offered — no 99-page cut-off. The chips wrap and
   scroll inside the panel (so they fit under the field), the total can be set
   by hand, and if the book is linked to a PDF the real page count is read from
   it so all of its pages appear. */
function pgChipsHTML(total, selected) {
  const set = new Set((selected || []).map(Number));
  const n = Math.max(1, Math.min(5000, Number(total) || 1));
  let h = '';
  for (let i = 1; i <= n; i++) {
    h += '<label class="chip pg-chip' + (set.has(i) ? ' on' : '') + '">' +
      '<input type="checkbox" class="pg-ck" value="' + i + '"' + (set.has(i) ? ' checked' : '') + '> ' + i +
      '</label>';
  }
  return h;
}
function pagePickerHTML(selected, total, opts) {
  opts = opts || {};
  const sel = (selected || []).map(Number).filter(function (n) { return n >= 1; });
  const maxSel = sel.length ? Math.max.apply(null, sel) : 0;
  const n = Math.max(Number(total) || 0, maxSel, Number(opts.min) || 60);
  return '<div class="page-pick" data-pg data-pg-total="' + n + '"' +
      (opts.pdf ? ' data-pg-pdf="' + esc(opts.pdf) + '"' : '') + '>' +
    '<label>Select pages *</label>' +
    '<div class="pg-tools">' +
      '<label class="pg-count">Pages in this book' +
        '<input type="number" min="1" max="5000" class="pg-total-num" value="' + n + '"></label>' +
      '<label>From<input type="number" min="1" class="pg-from" placeholder="1"></label>' +
      '<label>To<input type="number" min="1" class="pg-to" placeholder="' + n + '"></label>' +
      '<button type="button" class="small" data-act="pg-range">Select range</button>' +
      '<button type="button" class="small ghost" data-act="pg-all">All pages</button>' +
      '<button type="button" class="small ghost" data-act="pg-clear">Clear</button>' +
    '</div>' +
    '<div class="pg-grid" data-pg-grid>' + pgChipsHTML(n, sel) + '</div>' +
    '<p class="muted small pg-hint">Scroll the box to reach every page. "All pages" ticks the whole book.</p>' +
  '</div>';
}
function pgRootOf(el) { return el && el.closest ? el.closest('[data-pg]') : null; }
function pgSelected(root) {
  if (!root) return [];
  return Array.prototype.map.call(root.querySelectorAll('.pg-ck:checked'), function (c) {
    return Number(c.value);
  }).filter(function (n) { return n >= 1; });
}
function pgRebuild(root, total, sel) {
  if (!root) return;
  const grid = root.querySelector('[data-pg-grid]');
  const n = Math.max(1, Math.min(5000, Number(total) || 1));
  root.dataset.pgTotal = n;
  if (grid) grid.innerHTML = pgChipsHTML(n, sel || pgSelected(root));
  const num = root.querySelector('.pg-total-num');
  if (num) num.value = n;
}
/* Sizes the picker from a linked PDF (all pages of the book appear). */
function pgInit(root, pdfUrl) {
  if (!root || root.dataset.pgInit === '1') return;
  root.dataset.pgInit = '1';
  const url = pdfUrl || root.dataset.pgPdf;
  if (!url || typeof pdfPageCount !== 'function') return;
  pdfPageCount(url).then(function (n) {
    if (!n) return;
    const sel = pgSelected(root);
    const maxSel = sel.length ? Math.max.apply(null, sel) : 0;
    if (n > Number(root.dataset.pgTotal || 0)) pgRebuild(root, Math.max(n, maxSel), sel);
  });
}
function pgAllRanges(root, on) {
  root.querySelectorAll('.pg-ck').forEach(function (c) {
    c.checked = on;
    const chip = c.closest('.pg-chip');
    if (chip) chip.classList.toggle('on', on);
  });
}
function pgRange(root, from, to) {
  const a = Math.max(1, Math.min(Number(from) || 1, Number(to) || 1));
  const b = Math.max(Number(from) || 1, Number(to) || 1);
  root.querySelectorAll('.pg-ck').forEach(function (c) {
    const v = Number(c.value);
    if (v >= a && v <= b) {
      c.checked = true;
      const chip = c.closest('.pg-chip');
      if (chip) chip.classList.add('on');
    }
  });
}

/* Delegated so every page picker works, wherever it is rendered. */
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const btn = t.closest('[data-act="pg-range"], [data-act="pg-all"], [data-act="pg-clear"]');
    if (!btn) return;
    const root = pgRootOf(btn);
    if (!root) return;
    e.preventDefault();
    const act = btn.getAttribute('data-act');
    if (act === 'pg-all') pgAllRanges(root, true);
    else if (act === 'pg-clear') pgAllRanges(root, false);
    else {
      const f = root.querySelector('.pg-from');
      const to = root.querySelector('.pg-to');
      pgRange(root, f ? f.value : 1, to ? to.value : 1);
    }
  });
  document.addEventListener('change', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.classList && t.classList.contains('pg-total-num')) {
      pgRebuild(pgRootOf(t), t.value, pgSelected(pgRootOf(t)));
      return;
    }
    if (t.classList && t.classList.contains('pg-ck')) {
      const chip = t.closest('.pg-chip');
      if (chip) chip.classList.toggle('on', !!t.checked);
    }
  });
}

/* ================================================ book-style PDF reader === */
/* PDFs open one page at a time, like turning the pages of a book: no long
   scroll and no viewer chrome. Prev/Next buttons (or the arrow keys, or the
   arrows either side of the page) flip from page to page. */
function pdfSrc(url, page) {
  /* zoom=page-fit AND view=Fit: every viewer shows the WHOLE page inside the
     frame (the text may be smaller, but nothing is cut off) */
  return url + '#page=' + page + '&view=Fit&zoom=page-fit&toolbar=0&navpanes=0&pagemode=none';
}
/* One sheet of the book. A fresh element per page is what actually moves the
   browser's PDF viewer: changing only the #page= fragment of a frame that is
   already loaded is ignored, so every turn re-creates the frame. */
function bookFrameHtml(url, page, title) {
  return '<iframe class="pdf-frame" src="' + esc(pdfSrc(url, page)) + '" title="' +
    esc(title || 'Book') + '" loading="eager" scrolling="no"></iframe>';
}
/* The reader itself — only injected when a book is actually opened. */
function bookReaderHtml(url, opts) {
  opts = opts || {};
  const label = opts.title || 'Book';
  const from = Math.max(1, Number(opts.from) || 1);
  const to = Number(opts.to) > from ? Number(opts.to) : 0;   /* 0 = no upper limit */
  const rangeNote = to ? 'Chapter pages ' + from + '–' + to + ' only'
    : 'Turn the pages — the book never scrolls';
  return '<div class="book-reader" data-book="' + esc(url) + '" data-page="' + from + '"' +
      ' data-book-title="' + esc(label) + '"' +
      (opts.back ? ' data-book-back="1"' : '') +
      ' data-book-rendered="' + from + '"' +
      ' data-book-min="' + from + '"' + (to ? ' data-book-max="' + to + '"' : '') + '>' +
    '<div class="book-stage">' +
      '<button type="button" class="page-turn prev" data-book-turn="-1" aria-label="Previous page"' +
        ' title="Previous page">‹</button>' +
      '<div class="book-page">' +
        /* the sheet is clipped and covered by a shield, so the viewer inside can
           only be moved a page at a time (wheel / swipe / arrows), never scrolled */
        '<div class="book-frame-wrap">' + bookFrameHtml(url, from, label) +
          '<span class="book-scroll-cover" aria-hidden="true"></span></div>' +
        '<div class="book-shield" data-book-shield aria-hidden="true"' +
          ' title="Scroll or swipe to turn the page"></div>' +
      '</div>' +
      '<button type="button" class="page-turn next" data-book-turn="1" aria-label="Next page"' +
        ' title="Next page">›</button>' +
    '</div>' +
    '<div class="book-bar">' +
      '<button type="button" class="ghost small" data-book-turn="-1">‹ Previous</button>' +
      '<span class="book-page-no">Page <b data-book-page>' + from + '</b>' +
        '<span data-book-total>' + (to ? ' of ' + to : '') + '</span></span>' +
      '<button type="button" class="ghost small" data-book-turn="1">Next ›</button>' +
      '<span class="book-spacer"></span>' +
      '<span class="muted small book-hint">' + esc(rangeNote) + '</span>' +
      '<button type="button" class="ghost small" data-book-full>Full page</button>' +
      '<button type="button" class="ghost small danger" data-book-close>Close</button>' +
      '<a class="btn ghost small" href="' + esc(url) + '" target="_blank" rel="noopener">Open ↗</a>' +
    '</div></div>';
}
/* A book stays shut until someone clicks it, and can be limited to a page range
   (a chapter's own pages) so the rest of the book is never reachable. */
function bookCoverHtml(url, opts) {
  opts = opts || {};
  const label = opts.title || 'Book';
  const note = opts.note || (opts.from && opts.to
    ? 'Pages ' + opts.from + '–' + opts.to + ' of the book only.'
    : 'PDF book — it only opens when you click it.');
  return '<div class="book-open-card" data-book-url="' + esc(url) + '" data-book-title="' + esc(label) + '"' +
    (opts.from ? ' data-book-from="' + esc(String(opts.from)) + '"' : '') +
    (opts.to ? ' data-book-to="' + esc(String(opts.to)) + '"' : '') + '>' +
    '<span class="book-open-icon" aria-hidden="true">📖</span>' +
    '<span class="book-open-text"><b>' + esc(label) + '</b>' +
      '<span class="muted small">' + esc(note) + '</span></span>' +
    '<button type="button" class="small" data-book-load>' + esc(opts.button || 'Open book') + '</button>' +
  '</div>';
}
/* a book the learner may not open yet (e.g. before finishing every module) */
function bookLockedHtml(title, note) {
  return '<div class="book-open-card locked">' +
    '<span class="book-open-icon" aria-hidden="true">🔒</span>' +
    '<span class="book-open-text"><b>' + esc(title || 'Book') + '</b>' +
      '<span class="muted small">' + esc(note || 'This book opens once you have completed every module.') + '</span></span>' +
  '</div>';
}
/* pdfHtml(): pass { open: true } to show the reader straight away, or
   { from, to } to limit it to a page range (a chapter). */
function pdfHtml(url, opts) {
  opts = opts || {};
  const isPdf = typeof url === 'string' && /\.pdf($|[?#])/i.test(url);
  if (!isPdf) {
    return '<a class="btn ghost small" href="' + esc(url) + '" target="_blank" rel="noopener">Open ↗</a>';
  }
  return opts.open ? bookReaderHtml(url, opts) : bookCoverHtml(url, opts);
}

/* Page count found by scanning the PDF (no libraries, no server round-trip). */
const pdfPageCache = {};
function pdfPageCount(url) {
  if (pdfPageCache[url] != null) return Promise.resolve(pdfPageCache[url]);
  const done = function (n) { pdfPageCache[url] = n; return n; };
  if (typeof fetch !== 'function') return Promise.resolve(0);
  return fetch(url, { credentials: 'same-origin' }).then(function (r) {
    return r && r.ok ? r.arrayBuffer() : null;
  }).then(function (buf) {
    if (!buf || !buf.byteLength || buf.byteLength > 40 * 1024 * 1024) return done(0);
    const bytes = new Uint8Array(buf);
    let text = '';
    const step = 1 << 16;
    for (let i = 0; i < bytes.length; i += step) {
      text += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + step, bytes.length)));
    }
    const direct = text.match(/\/Type\s*\/Page(?![s])/g);
    if (direct && direct.length) return done(direct.length);
    const counts = text.match(/\/Count\s+(\d+)/g) || [];
    const nums = counts.map(function (s2) { return Number(String(s2).replace(/[^0-9]/g, '')) || 0; });
    return done(nums.length ? Math.max.apply(null, nums) : 0);
  }).catch(function () { return done(0); });
}

function bookRootOf(el) { return el && el.closest ? el.closest('.book-reader') : null; }
function bookGo(root, delta) {
  if (!root) return 1;
  const min = Math.max(1, Number(root.dataset.bookMin || 1));
  const hardMax = Number(root.dataset.bookMax || 0);
  const total = hardMax || Number(root.dataset.total || 0);
  let page = Number(root.dataset.page || min) + Number(delta || 0);
  if (page < min) page = min;
  if (total && page > total) page = total;
  root.dataset.page = page;
  const no = root.querySelector('[data-book-page]');
  if (no) no.textContent = String(page);
  /* A fresh frame per page is the only reliable way to move the browser's PDF
     viewer: editing just the #page= fragment of a loaded frame is ignored. */
  if (String(root.dataset.bookRendered || '') !== String(page)) {
    root.dataset.bookRendered = String(page);
    const frame = bookFrameHtml(root.dataset.book, page, root.dataset.bookTitle);
    const wrap = root.querySelector('.book-frame-wrap');
    if (wrap && 'innerHTML' in wrap) {
      wrap.innerHTML = frame;
    } else {
      const old = root.querySelector('iframe');
      if (old && old.parentNode && old.parentNode.insertAdjacentHTML) {
        old.parentNode.insertAdjacentHTML('beforebegin', frame);
        if (old.remove) old.remove();
      } else if (old) {
        old.setAttribute('src', pdfSrc(root.dataset.book, page));
      }
    }
  }
  /* a small page-turn flick so it reads like a book */
  const sheet = root.querySelector('.book-page');
  if (sheet && sheet.classList && delta) {
    sheet.classList.remove('turning');
    void (sheet.offsetWidth || 0);
    sheet.classList.add('turning');
  }
  root.querySelectorAll('[data-book-turn="-1"]').forEach(function (b) { b.disabled = page <= min; });
  root.querySelectorAll('[data-book-turn="1"]').forEach(function (b) {
    b.disabled = !!total && page >= total;
  });
  return page;
}
function bookCount(root) {
  if (!root || root.dataset.counted === '1') return;
  root.dataset.counted = '1';
  /* a chapter-scoped reader is already limited to its own pages */
  if (root.dataset.bookMax) return;
  pdfPageCount(root.dataset.book).then(function (n) {
    if (!n) return;
    root.dataset.total = n;
    const t = root.querySelector('[data-book-total]');
    if (t) t.textContent = ' of ' + n;
    bookGo(root, 0);
  });
}
function bookActivate(root) {
  if (!root) return;
  document.querySelectorAll('.book-reader.book-active').forEach(function (r) {
    if (r !== root) r.classList.remove('book-active');
  });
  root.classList.add('book-active');
}
/* Delegated, so readers rendered later (library, books, chapters) all work. */
let wheelAcc = 0, wheelLock = 0, touchX = null, touchY = null;
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    /* a closed book opens only here — on the click */
    const cover = t.closest('.book-open-card');
    if (cover && !t.closest('a')) {
      e.preventDefault();
      const url = cover.getAttribute('data-book-url') || cover.dataset.bookUrl;
      const title = cover.getAttribute('data-book-title') || cover.dataset.bookTitle || 'Book';
      const from = cover.getAttribute('data-book-from') || '';
      const to = cover.getAttribute('data-book-to') || '';
      const holder = cover.parentNode;
      if (url && holder && cover.insertAdjacentHTML) {
        cover.insertAdjacentHTML('beforebegin', bookReaderHtml(url, { title: title, from: from, to: to }));
        if (cover.remove) cover.remove(); else if (holder.removeChild) holder.removeChild(cover);
      }
      return;
    }
    const turn = t.closest('[data-book-turn]');
    if (turn) {
      const root = bookRootOf(turn);
      if (root) {
        e.preventDefault();
        bookActivate(root);
        bookGo(root, turn.getAttribute('data-book-turn'));
      }
      return;
    }
    const full = t.closest('[data-book-full]');
    if (full) {
      const root = bookRootOf(full);
      if (root) {
        const on = root.classList.toggle('book-full');
        full.textContent = on ? 'Close full page' : 'Full page';
      }
      return;
    }
    /* Close: shut the book (and leave a cover the learner can reopen) */
    const closer = t.closest('[data-book-close]');
    if (closer) {
      const root = bookRootOf(closer);
      if (root) {
        e.preventDefault();
        root.classList.remove('book-full');
        const holder = root.parentNode;
        if (root.dataset.bookBack === '1' && holder && root.insertAdjacentHTML) {
          root.insertAdjacentHTML('beforebegin', bookCoverHtml(root.dataset.book, {
            title: root.dataset.bookTitle || 'Book',
            from: root.dataset.bookMin,
            to: root.dataset.bookMax || '',
            button: 'Open chapter pages',
            note: 'Reopen this chapter’s pages.'
          }));
        }
        if (root.remove) root.remove();
        else if (holder && holder.removeChild) holder.removeChild(root);
      }
      return;
    }
  });
  document.addEventListener('load', function (e) {
    const f = e.target;
    if (f && f.tagName === 'IFRAME' && String(f.className || '').indexOf('pdf-frame') !== -1) {
      bookCount(bookRootOf(f));
    }
  }, true);
  document.addEventListener('wheel', function (e) {
    const shield = e.target && e.target.closest ? e.target.closest('[data-book-shield]') : null;
    if (!shield) return;
    const root = bookRootOf(shield);
    if (!root) return;
    e.preventDefault();                      /* the book never scrolls */
    const now = Date.now();
    const cool = Number(root.dataset.bookCooldown || 220);
    if (now - wheelLock < cool) return;
    wheelAcc += (e.deltaY || 0) + (e.deltaX || 0);
    if (Math.abs(wheelAcc) > 40) {
      const step = wheelAcc > 0 ? 1 : -1;
      wheelAcc = 0;
      wheelLock = now;
      bookActivate(root);
      bookGo(root, step);
    }
  }, { passive: false });
  document.addEventListener('touchstart', function (e) {
    const shield = e.target && e.target.closest ? e.target.closest('[data-book-shield]') : null;
    if (!shield) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    touchX = t.clientX; touchY = t.clientY;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (touchX == null) return;
    const t = e.changedTouches && e.changedTouches[0];
    const dx = t ? t.clientX - touchX : 0;
    const dy = t ? t.clientY - touchY : 0;
    touchX = null; touchY = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    const root = bookRootOf(document.querySelector('[data-book-shield]'));
    if (!root) return;
    bookActivate(root);
    bookGo(root, dx < 0 ? 1 : -1);
  }, { passive: true });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const tag = String((e.target && e.target.tagName) || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const root = document.querySelector('.book-reader.book-active') ||
      document.querySelector('.book-reader');
    if (!root) return;
    e.preventDefault();
    bookGo(root, e.key === 'ArrowRight' ? 1 : -1);
  });
}

/* ================================================ stale server notice ===== */
/* When the page is newer than the running server ("Unknown endpoint" …), say so
   clearly instead of a grey error: the backend needs a restart to load the new
   routes (PHP keeps compiled files until PHP-FPM/Apache restarts). */
function isStaleServerError(err) {
  const t = typeof err === 'string' ? err : (err && err.message) || '';
  return /Unknown endpoint/i.test(t);
}
function staleServerHtml(build, missing) {
  return '<div class="card" style="border-left:5px solid #c62828;background:#fdeeee">' +
    '<b>This page is newer than the server that answered it.</b>' +
    '<p class="muted small" style="margin:6px 0 0">Running build: <b>' + esc(build || 'unknown') + '</b>' +
    (missing && missing.length ? ' — missing: <b>' + esc(missing.join(', ')) + '</b>' : '') +
    '. Restart the backend so the new routes load (PHP-FPM/Apache, or the Node process), then reload this page. ' +
    'See <a href="/api/health" target="_blank" rel="noopener">/api/health</a> for the live build.</p></div>';
}
/* What build is the server running? (null when there is no /api/health yet) */
async function serverBuild() {
  try { return await API.get('/health'); } catch (e) { return null; }
}
/* Compare the deployed FILES with the running BACKEND — they are updated by
   different steps (a pull updates the files; a restart loads the backend), so a
   mismatch points at the missing step. */
async function deploymentInfo() {
  const info = { files: null, server: null };
  try {
    const res = await fetch('/build.json?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) info.files = await res.json();
  } catch (e) { /* no build.json: very old deployment */ }
  info.server = await serverBuild();
  return info;
}
function deploymentNoticeHtml(info) {
  const files = (info && info.files) || null;
  const server = (info && info.server) || null;
  const fileBuild = files && files.build ? files.build : null;
  const serverBuild = server && server.build ? server.build : null;
  let verdict;
  if (!serverBuild && fileBuild) {
    verdict = 'The <b>files</b> on the server are current (' + esc(fileBuild) + ') but the <b>backend process</b> ' +
      'is still old (even /api/health is missing). <b>Restart the backend</b> — PHP-FPM/Apache, or the Node process — ' +
      'then reload.';
  } else if (!serverBuild && !fileBuild) {
    verdict = 'Neither /api/health nor /build.json answered, so the folder being served is not the one you ' +
      'pulled. Check the <b>document root</b>, then <code>git pull</code> there and restart the backend.';
  } else if (serverBuild && fileBuild && serverBuild !== fileBuild) {
    verdict = 'The backend runs <b>' + esc(serverBuild) + '</b> while the files are <b>' + esc(fileBuild) +
      '</b> — restart the backend so it loads the same build.';
  } else {
    verdict = 'The backend runs <b>' + esc(serverBuild || 'unknown') + '</b> but is missing a feature this page ' +
      'uses. Restart the backend, then reload.';
  }
  return '<div class="card" style="border-left:5px solid #c62828;background:#fdeeee">' +
    '<b>This page is newer than the server that answered it.</b>' +
    '<p class="small" style="margin:6px 0 0">' +
      'Files on the server: <b>' + esc(fileBuild || 'not found (/build.json)') + '</b> · ' +
      'backend build: <b>' + esc(serverBuild || 'not found (/api/health)') + '</b></p>' +
    '<p class="small" style="margin:6px 0 0">' + verdict + '</p>' +
    '<p class="small" style="margin:8px 0 0">On the server, in the folder the domain serves:</p>' +
    '<pre class="small" style="background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px;' +
      'overflow:auto">git pull && git log --oneline -1\n' +
      'grep -n "api/health" php/api.php      # route present in the new build\n' +
      'sudo systemctl restart php8.2-fpm && sudo systemctl restart apache2   # PHP\n' +
      '#   (Node instead: restart the process — npm start / pm2 restart)</pre>' +
    '<p class="small" style="margin:6px 0 0">Then check ' +
      '<a href="/api/health" target="_blank" rel="noopener">/api/health</a> and ' +
      '<a href="/build.json" target="_blank" rel="noopener">/build.json</a> — both should show the same build.</p>' +
  '</div>';
}
/* Warn (once) when the server build lacks a feature this page needs. */
async function warnIfStaleServer(feature, label) {
  const info = await deploymentInfo();
  const server = info.server;
  const feats = (server && server.features) || [];
  const stale = !server || !server.build || (feature && feats.indexOf(feature) === -1);
  if (stale) {
    const el = document.getElementById('staleBuild');
    if (el) {
      el.classList.remove('hidden');
      el.innerHTML = deploymentNoticeHtml(info);
    } else if (typeof toast === 'function') {
      toast('Server build ' + ((server && server.build) || 'unknown') +
        ' is older than this page — restart the backend (' + label + ')', 'err');
    }
  }
  return info;
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

