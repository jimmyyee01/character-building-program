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

/* ================================================================ report export helpers (client side, no server libs) */
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
  '': '',
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
    d.write(escapeHtml(source.innerHTML));
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

