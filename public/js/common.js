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
