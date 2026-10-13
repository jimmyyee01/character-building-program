/* Tenant admin / supervisor console — served at /admin. */
let ME = null, ROLE = null, VIEW = 'dashboard';
let supOverview = null, newSupCode = null, usersCache = [];
const booksState = { modules: [], moduleId: null, books: [], openBookId: null };
const submState = { flagged: false, type: '', search: '' };
const usersState = { search: '' };
const certState = { search: '' };
const brandState = { logo: undefined, programLogo: undefined };
const RENDER = {};

function sec(name) { return document.getElementById('view-' + name); }
function isAdmin() { return ROLE === 'tenant_admin'; }
function msg(e) { return (e && e.message) || 'Something went wrong'; }
function renderView() {
  const f = RENDER[VIEW];
  if (!f) return;
  Promise.resolve().then(f).catch(function (e) { toast(msg(e), 'err'); });
}

/* Wrap an async event handler: any error surfaces as a toast. */
function wrap(fn) {
  return function () {
    try {
      const r = fn.apply(this, arguments);
      if (r && typeof r.catch === 'function') r.catch(function (e) { toast(msg(e), 'err'); });
    } catch (e) { toast(msg(e), 'err'); }
  };
}

function statCard(n, l) {
  return '<div class="stat"><div class="n">' + esc(n == null ? 0 : n) +
    '</div><div class="l">' + esc(l) + '</div></div>';
}
function bar(p) {
  const v = Math.max(0, Math.min(100, Math.round(Number(p) || 0)));
  return '<div class="progress"><i style="width:' + v + '%"></i></div>';
}
function roleBadge(role) {
  const map = { tenant_admin: ['info', 'Admin'], supervisor: ['warn', 'Supervisor'],
    student: ['info', 'Student'], teacher: ['ok', 'Teacher'], member: ['lock', 'Member'] };
  const m = map[role] || ['lock', role];
  return '<span class="badge ' + m[0] + '">' + esc(m[1]) + '</span>';
}
function typeBadge(t) {
  const map = { book: ['info', 'Book'], letter: ['warn', 'Letter'], video: ['ok', 'Video'],
    objectives: ['info', 'Objectives'], chapter_summary: ['warn', 'Chapter summary'],
    letter_summary: ['warn', 'Letter summary'], book_summary: ['warn', 'Book summary'],
    best_book: ['ok', 'Best book'], general_summary: ['warn', 'General summary'] };
  const m = map[t] || ['lock', t];
  return '<span class="badge ' + m[0] + '">' + esc(m[1]) + '</span>';
}
/* Builds a lowercase haystack from every visible field of a report row. */
function searchText(o) {
  const parts = [];
  ['userName', 'userRole', 'type', 'label', 'chapter', 'book', 'text',
    'fullName', 'email', 'studentNumber', 'className', 'supervisorName',
    'role', 'name', 'title', 'code', 'userName', 'similarity'].forEach(function (k) {
    if (o && o[k] != null) parts.push(String(o[k]));
  });
  if (o && o.score != null && o.total != null) parts.push(o.score + '/' + o.total);
  if (o && o.createdAt) parts.push(fmtDate(o.createdAt));
  if (o && o.issuedAt) parts.push(fmtDate(o.issuedAt));
  if (o && Array.isArray(o.books)) parts.push(o.books.join(' '));
  if (o && o.bestBook) parts.push(String(o.bestBook));
  return parts.join(' | ').toLowerCase();
}
/* Filters rendered table rows by the text in a search input (no re-fetch). */
function applyTableSearch(tableEl, inputEl, countEl) {
  if (!tableEl || !inputEl) return;
  const q = inputEl.value.trim().toLowerCase();
  let shown = 0;
  tableEl.querySelectorAll('tbody tr[data-search]').forEach(function (tr) {
    const hit = !q || (tr.dataset.search || '').indexOf(q) !== -1;
    tr.style.display = hit ? '' : 'none';
    if (hit) shown++;
  });
  if (countEl) countEl.textContent = shown + ' shown';
}
function copyText(text) {
  const done = function () { toast('Copied: ' + text, 'ok'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('Could not copy', 'err'); }
  document.body.removeChild(ta);
}
function openModal(html, wide) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = '<div class="modal-bg" id="modalBg"><div class="modal' + (wide ? ' wide' : '') +
    '"><button type="button" class="x no-print" id="modalX" title="Close">&#10005;</button>' + html + '</div></div>';
  document.getElementById('modalX').onclick = closeModal;
  document.getElementById('modalBg').onclick = function (e) {
    if (e.target.id === 'modalBg') closeModal();
  };
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }
async function filePayload(input) {
  const f = input.files[0];
  if (!f) return null;
  if (f.size > 40 * 1024 * 1024) throw new Error('File too large (max 40MB)');
  return { name: f.name, base64: await fileToBase64(f) };
}
function setFlagCount(n) {
  const b = document.querySelector('#nav .nav-btn[data-view="submissions"]');
  if (!b) return;
  const old = b.querySelector('.cnt');
  if (old) old.remove();
  if (n > 0) {
    const s = document.createElement('span');
    s.className = 'cnt';
    s.textContent = String(n);
    b.appendChild(s);
  }
}
/* Shared: supervisors table (dashboard + supervisors view). */
function supTableHtml(sups) {
  if (!sups || !sups.length) return '<p class="muted">No supervisors yet.</p>';
  let h = '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th>' +
    '<th>Access code</th><th style="width:190px">Members</th></tr></thead><tbody>';
  sups.forEach(function (s) {
    const used = s.users || 0, max = s.limit || 100;
    h += '<tr><td><b>' + esc(s.fullName || '—') + '</b></td><td>' + esc(s.email || '—') + '</td>' +
      '<td><span class="code-chip">' + esc(s.code || '—') + '</span> ' +
      '<button type="button" class="ghost small" data-copy="' + esc(s.code || '') + '">Copy</button></td>' +
      '<td><div class="small">' + used + ' / ' + max + '</div>' +
      bar(Math.round(used / max * 100)) + '</td></tr>';
  });
  return h + '</tbody></table></div>';
}
function newSupCodeHtml() {
  if (!newSupCode) return '';
  return '<div class="card" style="border-left:6px solid var(--gold)"><h3>Supervisor created</h3>' +
    '<p><b>' + esc(newSupCode.name) + '</b> — this supervisor\'s team code (use it when adding members under this supervisor):</p>' +
    '<p><span class="code-chip">' + esc(newSupCode.code) + '</span> ' +
    '<button type="button" class="ghost small" data-copy="' + esc(newSupCode.code) + '">Copy</button> ' +
    '<button type="button" class="ghost small" data-dismiss="1">Dismiss</button></p></div>';
}

/* ============================================================== dashboard == */
async function renderDashboard() {
  const el = sec('dashboard');
  el.innerHTML = '<div class="card"><p class="muted">Loading dashboard…</p></div>';
  let d, flagged = [];
  try {
    const res = await Promise.all([
      API.get('/admin/overview'),
      API.get('/admin/submissions?flagged=1').catch(function () { return { submissions: [] }; })
    ]);
    d = res[0];
    flagged = res[1].submissions || [];
  } catch (e) {
    el.innerHTML = '<div class="card"><p class="muted">Could not load the dashboard: ' +
      esc(msg(e)) + '</p></div>';
    toast(msg(e), 'err');
    return;
  }
  supOverview = d;
  setFlagCount(flagged.length);
  const c = d.counts || {};
  let html = '<h2>Dashboard</h2><div class="grid cols-4">' +
    statCard(c.users, isAdmin() ? 'Users' : 'My members') +
    statCard(c.submissions, 'Submissions') +
    statCard(c.flagged, 'Flagged') +
    statCard(c.certificates, 'Certificates');
  if (isAdmin()) html += statCard(c.supervisors, 'Supervisors');
  if (d.limit) html += statCard((d.limit.used || 0) + ' / ' + (d.limit.max || 0), 'Member quota');
  html += '</div>';

  if (isAdmin()) {
    html += '<div class="card"><h3>Supervisors</h3>' + supTableHtml(d.supervisors) +
      '<p class="mt"><button type="button" class="ghost" data-goto="supervisors">Manage supervisors</button></p></div>';
  } else if (d.limit) {
    html += '<div class="card"><h3>Member quota</h3><p class="muted small">' +
      (d.limit.used || 0) + ' of ' + (d.limit.max || 0) + ' members used</p>' +
      bar(Math.round((d.limit.used || 0) / (d.limit.max || 1) * 100)) + '</div>';
  }

  html += '<div class="card"><h3>Flagged submissions' +
    (flagged.length ? ' <span class="badge off">' + flagged.length + '</span>' : '') + '</h3>';
  if (!flagged.length) {
    html += '<p class="muted">Nothing is flagged right now.</p>';
  } else {
    html += '<div class="table-wrap"><table><thead><tr><th>User</th><th>Type</th>' +
      '<th>Similarity</th><th>Date</th><th></th></tr></thead><tbody>';
    flagged.slice(0, 6).forEach(function (s) {
      html += '<tr><td><b>' + esc(s.userName || '—') + '</b></td><td>' + typeBadge(s.type) + '</td>' +
        '<td>' + esc(s.similarity || 0) + '%</td><td class="small">' + fmtDate(s.createdAt) + '</td>' +
        '<td><button type="button" class="small" data-review="1">Review</button></td></tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';

  el.innerHTML = html;
  el.onclick = function (e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.copy) copyText(b.dataset.copy);
    else if (b.dataset.goto) setView(b.dataset.goto);
    else if (b.dataset.review) { submState.flagged = true; setView('submissions'); }
  };
}
/* ================================================================ users ==== */
function roleSelectHtml() {
  /* Supervisors always create plain members (server enforces this too). */
  if (!isAdmin()) {
    return '<select id="ufRole"><option value="member">Member</option></select>';
  }
  const t = ME.portal ? ME.portal.type : null;
  let opts;
  if (t === 'schools') opts = [['student', 'Student'], ['teacher', 'Teacher']];
  else if (t === 'organization') opts = [['member', 'Member / User']];
  else if (t === 'family' || t === 'married') opts = [['member', 'Member']];
  else opts = [['student', 'Student'], ['teacher', 'Teacher'], ['member', 'Member']];
  opts.push(['supervisor', 'Supervisor']);
  let h = '<select id="ufRole">';
  opts.forEach(function (o) { h += '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; });
  return h + '</select>';
}
function userFormHtml(limit) {
  let quota = '';
  if (!isAdmin() && limit) {
    const used = limit.used || 0, max = limit.max || 100;
    quota = '<p class="muted small" style="margin-bottom:4px">Quota: <b>' + used + ' / ' + max +
      '</b> members — ' + Math.max(0, max - used) + ' remaining</p>' +
      bar(Math.round(used / max * 100));
  }
  let supRow = '';
  if (isAdmin() && supOverview && supOverview.supervisors && supOverview.supervisors.length) {
    supRow = '<div><label>Assign to supervisor (optional)</label><select id="ufSup">' +
      '<option value="">— none —</option>';
    supOverview.supervisors.forEach(function (s) {
      supRow += '<option value="' + esc(s.id) + '">' + esc(s.fullName) + '</option>';
    });
    supRow += '</select></div>';
  }
  return '<div class="card"><h3 id="userFormTitle">Add user</h3>' + quota +
    '<p id="ufSupNote" class="muted small hidden">A unique supervisor access code will be generated automatically.</p>' +
    '<form id="userForm"><div class="row">' +
    '<div><label>Full name</label><input type="text" id="ufName" required></div>' +
    '<div><label>Role</label>' + roleSelectHtml() + '</div>' +
    '<div id="ufEmailRow"><label>Email</label><input type="email" id="ufEmail"></div>' +
    '</div><div class="row" id="ufStudentRow">' +
    '<div><label>Student number</label><input type="text" id="ufNumber"></div>' +
    '<div><label>School class</label><input type="text" id="ufClass" placeholder="e.g. Grade 10A"></div>' +
    '</div><div class="row">' + supRow +
    '<div><label>Password (min 6 characters)</label><input type="password" id="ufPw" required minlength="6"></div>' +
    '<div class="fixed"><button type="submit">Create user</button></div>' +
    '</div></form></div>';
}
let bulkRows = [];
let bulkResult = null;

function bulkDefaultRole() {
  const t = ME.portal ? ME.portal.type : null;
  return t === 'schools' ? 'student' : 'member';
}

function parseBulkCsv(text) {
  const rows = [];
  String(text || '').split(/\r?\n/).forEach(function (line) {
    line = line.trim();
    if (!line) return;
    const parts = line.split(',').map(function (p) { return p.trim(); });
    if (/^full\s?name/i.test(parts[0])) return; // header row
    rows.push({
      fullName: parts[0] || '',
      email: parts[1] || '',
      studentNumber: parts[2] || '',
      className: parts[3] || ''
    });
  });
  return rows;
}

function bulkPanelHtml() {
  const t = ME.portal ? ME.portal.type : null;
  const hint = t === 'schools'
    ? 'CSV columns: <b>fullName, email, studentNumber, className</b> — students need a student number, e.g. <span class="mono">Jane Doe,,STU-101,Grade 10A</span>'
    : 'CSV columns: <b>fullName, email, studentNumber, className</b> — e.g. <span class="mono">John Doe,john@example.com,,Group A</span>';
  const roles = t === 'schools'
    ? [['student', 'Student'], ['teacher', 'Teacher']]
    : [['member', t === 'organization' ? 'Member / User' : 'Member']];
  const roleOpts = roles.map(function (o) {
    return '<option value="' + o[0] + '"' + (bulkDefaultRole() === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
  }).join('');
  let supRow = '';
  if (isAdmin() && supOverview && supOverview.supervisors && supOverview.supervisors.length && t === 'organization') {
    supRow = '<div><label>Assign all rows to supervisor</label><select id="bulkSup">' +
      '<option value="">— none —</option>' +
      supOverview.supervisors.map(function (s) {
        return '<option value="' + esc(s.id) + '">' + esc(s.fullName) + '</option>';
      }).join('') + '</select></div>';
  }
  let result = '';
  if (bulkResult) {
    result = '<div class="card" style="border-left:6px solid ' +
      (bulkResult.errors.length ? 'var(--warn)' : 'var(--ok)') + '"><h3>Bulk insert result</h3>' +
      '<p><b>' + bulkResult.created.length + '</b> created out of <b>' + bulkResult.total + '</b> rows.' +
      (bulkResult.errors.length ? ' <b>' + bulkResult.errors.length + '</b> failed:' : ' All rows succeeded.') + '</p>';
    if (bulkResult.errors.length) {
      result += '<div class="table-wrap"><table><thead><tr><th>Row</th><th>Name</th><th>Error</th></tr></thead><tbody>' +
        bulkResult.errors.map(function (ex) {
          return '<tr><td>' + esc(ex.index) + '</td><td>' + esc(ex.name || '—') + '</td><td>' + esc(ex.error) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    result += '</div>';
  }
  return '<div class="card"><h3>Bulk insert users</h3>' +
    '<p class="muted small">' + hint + '. Maximum 500 users per insert. Each row is validated like a single create — bad rows are skipped and listed below.</p>' +
    '<div class="row">' +
      '<div><label>Role for all rows</label><select id="bulkRole">' + roleOpts + '</select></div>' +
      '<div><label>Default password (min 6, applies to all rows)</label>' +
        '<input type="text" id="bulkPw" value="ChangeMe123" minlength="6"></div>' +
      supRow +
    '</div>' +
    '<div class="row"><div><label>Paste CSV rows</label>' +
      '<textarea id="bulkText" rows="4" placeholder="Jane Doe,,STU-101,Grade 10A"></textarea></div></div>' +
    '<div class="row"><div><label>…or upload a .csv file</label>' +
      '<input type="file" id="bulkFile" accept=".csv,text/csv,text/plain"></div>' +
      '<div class="fixed" style="padding-bottom:2px">' +
        '<button type="button" class="ghost" id="bulkTemplate">Download template</button> ' +
        '<button type="button" class="ghost" id="bulkPreview">Preview</button> ' +
        '<button type="button" id="bulkSubmit" disabled>Insert <span id="bulkCount">0</span> users</button>' +
      '</div></div>' +
    '<div id="bulkPreviewBox" class="mt"></div></div>' + result;
}
function renderBulkPreview() {
  const box = document.getElementById('bulkPreviewBox');
  const btn = document.getElementById('bulkSubmit');
  if (!box) return;
  if (!bulkRows.length) {
    box.innerHTML = '<p class="muted small">No rows to preview.</p>';
    if (btn) { btn.disabled = true; document.getElementById('bulkCount').textContent = '0'; }
    return;
  }
  const show = bulkRows.slice(0, 10);
  box.innerHTML = '<div class="table-wrap"><table><thead><tr><th>#</th><th>Full name</th>' +
    '<th>Email</th><th>Student number</th><th>Class</th></tr></thead><tbody>' +
    show.map(function (r, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(r.fullName) + '</td><td>' + esc(r.email) +
        '</td><td>' + esc(r.studentNumber) + '</td><td>' + esc(r.className) + '</td></tr>';
    }).join('') + '</tbody></table></div>' +
    (bulkRows.length > 10 ? '<p class="muted small">…and ' + (bulkRows.length - 10) + ' more rows.</p>' : '');
  if (btn) { btn.disabled = false; document.getElementById('bulkCount').textContent = String(bulkRows.length); }
}

function wireBulkPanel() {
  const prev = document.getElementById('bulkPreview');
  if (!prev) return;
  prev.onclick = function () {
    bulkRows = parseBulkCsv(document.getElementById('bulkText').value);
    if (!bulkRows.length) toast('Paste or upload CSV rows first', 'err');
    renderBulkPreview();
  };
  document.getElementById('bulkTemplate').onclick = function () {
    const csv = 'fullName,email,studentNumber,className\n' +
      (bulkDefaultRole() === 'student'
        ? 'Jane Doe,,STU-101,Grade 10A\nJohn Doe,,STU-102,Grade 10A\n'
        : 'John Doe,john@example.com,,\nMary Roe,mary@example.com,,\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bulk-users-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  document.getElementById('bulkFile').onchange = function (e) {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = function () {
      document.getElementById('bulkText').value = String(r.result || '');
      bulkRows = parseBulkCsv(String(r.result || ''));
      renderBulkPreview();
    };
    r.readAsText(f);
  };
  document.getElementById('bulkSubmit').onclick = wrap(async function () {
    if (!bulkRows.length) { toast('Nothing to insert', 'err'); return; }
    const role = document.getElementById('bulkRole').value;
    const pw = document.getElementById('bulkPw').value;
    if (!pw || pw.length < 6) { toast('Default password must be at least 6 characters', 'err'); return; }
    const supSel = document.getElementById('bulkSup');
    const supId = supSel && supSel.value ? supSel.value : undefined;
    const users = bulkRows.map(function (r) {
      const b = { role: role, fullName: r.fullName, password: pw };
      if (r.email) b.email = r.email;
      if (r.studentNumber) b.studentNumber = r.studentNumber;
      if (r.className) b.className = r.className;
      if (supId) b.supervisorId = supId;
      return b;
    });
    if (role === 'supervisor' && !isAdmin()) { toast('Not permitted', 'err'); return; }
    const res = await API.post('/users/bulk', { users: users });
    bulkRows = [];
    bulkResult = res;
    toast(res.created.length + ' users created' + (res.errors.length ? ', ' + res.errors.length + ' failed' : ''),
      res.errors.length ? 'err' : 'ok');
    renderUsers();
  });
}

function usersTableHtml() {
  let h = '<div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th>' +
    '<th>Email / Number</th><th>Class</th><th>Supervisor</th><th style="width:130px">Progress</th>' +
    '<th>Status</th><th>Actions</th></tr></thead><tbody>';
  usersCache.forEach(function (u) {
    const av = u.photo ? '<img class="avatar-sm" src="' + esc(u.photo) + '" alt="">'
      : '<span class="badge lock">' + esc(String(u.fullName || '?').charAt(0).toUpperCase()) + '</span>';
    let code = '';
    if (u.supervisorCode) {
      code = '<div><span class="code-chip">' + esc(u.supervisorCode) + '</span> ' +
        '<button type="button" class="ghost small" data-copy="' + esc(u.supervisorCode) + '">Copy</button></div>';
    }
    const det = u.role === 'student' ? esc(u.studentNumber || '—')
      : esc(u.email || u.studentNumber || '—');
    const prog = u.progress == null ? '<span class="muted">—</span>'
      : bar(u.progress) + ' <span class="small">' + esc(u.progress) + '%</span>';
    const status = u.suspended ? '<span class="badge off">Suspended</span>'
      : '<span class="badge ok">Active</span>';
    let acts = '<button type="button" class="ghost small" data-act="reset" data-id="' +
      esc(u.id) + '">Password</button> ';
    if (isAdmin()) {
      acts += '<button type="button" class="ghost small" data-act="toggle" data-id="' + esc(u.id) +
        '">' + (u.suspended ? 'Unsuspend' : 'Suspend') + '</button> ';
    }
    acts += '<button type="button" class="danger small" data-act="del" data-id="' +
      esc(u.id) + '">Delete</button>';
    h += '<tr data-search="' + esc(searchText(u)) + '"><td>' + av + '<b>' + esc(u.fullName) + '</b>' + code + '</td>' +
      '<td>' + roleBadge(u.role) + '</td><td>' + det + '</td>' +
      '<td>' + esc(u.className || '—') + '</td><td>' + esc(u.supervisorName || '—') + '</td>' +
      '<td>' + prog + '</td><td>' + status + '</td>' +
      '<td style="white-space:nowrap">' + acts + '</td></tr>';
  });
  return h + '</tbody></table></div>';
}
async function renderUsers() {
  const el = sec('users');
  el.innerHTML = '<div class="card"><p class="muted">Loading users…</p></div>';
  let d;
  try {
    const reqs = [API.get('/users')];
    if (isAdmin()) reqs.push(API.get('/admin/overview'));
    const res = await Promise.all(reqs);
    d = res[0];
    if (isAdmin()) supOverview = res[1];
  } catch (e) {
    el.innerHTML = '<div class="card"><p class="muted">Could not load users: ' +
      esc(msg(e)) + '</p></div>';
    toast(msg(e), 'err');
    return;
  }
  usersCache = d.users || [];
  const heading = isAdmin() ? 'Users' : 'My members';
  let html = newSupCodeHtml();
  if (!isAdmin() && ME.user.supervisorCode) {
    html += '<div class="card"><h3>My supervisor access code</h3>' +
      '<p class="muted small">Give this code to members of your team so an administrator can add them under you.</p>' +
      '<p><span class="code-chip">' + esc(ME.user.supervisorCode) + '</span> ' +
      '<button type="button" class="ghost small" data-copy="' + esc(ME.user.supervisorCode) +
      '">Copy</button></p></div>';
  }
  html += userFormHtml(d.limit);
  html += bulkPanelHtml();
  html += '<div class="card"><div class="row" style="align-items:flex-end">' +
    '<div style="min-width:200px"><label>Search users</label>' +
      '<input type="text" id="usSearch" placeholder="Name, email, number, class…" value="' +
      esc(usersState.search) + '"></div>' +
    '<div class="fixed" style="padding-bottom:10px"><h3 style="margin:0">' + heading +
      ' <span class="badge info">' + usersCache.length + '</span> ' +
      '<span class="badge lock" id="usTableCount">' + usersCache.length + ' shown</span></h3></div>' +
    '</div>' +
    (usersCache.length ? usersTableHtml() : '<p class="muted">No users yet.</p>') + '</div>';
  el.innerHTML = html;

  const roleSel = document.getElementById('ufRole');
  roleSel.onchange = syncUserForm;
  syncUserForm();
  document.getElementById('userForm').onsubmit = wrap(createUser);
  wireBulkPanel();
  const usSearch = document.getElementById('usSearch');
  const usTable = el.querySelector('table');
  usSearch.addEventListener('input', function () {
    usersState.search = this.value;
    applyTableSearch(usTable, usSearch, document.getElementById('usTableCount'));
  });
  applyTableSearch(usTable, usSearch, document.getElementById('usTableCount'));
  el.onclick = wrap(userRowClick);
}

function syncUserForm() {
  const sel = document.getElementById('ufRole');
  if (!sel) return;
  const role = sel.value;
  const isStudent = role === 'student';
  document.getElementById('ufEmailRow').classList.toggle('hidden', isStudent);
  document.getElementById('ufStudentRow').classList.toggle('hidden', !isStudent);
  document.getElementById('ufSupNote').classList.toggle('hidden', role !== 'supervisor');
  const t = document.getElementById('userFormTitle');
  if (t) {
    t.textContent = role === 'supervisor' ? 'Add supervisor'
      : (isStudent ? 'Add student' : (role === 'teacher' ? 'Add teacher'
        : (ROLE === 'supervisor' ? 'Add member' : 'Add user')));
  }
}

async function createUser(e) {
  e.preventDefault();
  const role = document.getElementById('ufRole').value;
  if (role === 'supervisor' && !isAdmin()) { toast('Not permitted', 'err'); return; }
  const body = {
    role: role,
    fullName: document.getElementById('ufName').value.trim(),
    password: document.getElementById('ufPw').value
  };
  if (role === 'student') {
    const num = document.getElementById('ufNumber').value.trim();
    if (!num) { toast('Student number is required', 'err'); return; }
    body.studentNumber = num;
    const cls = document.getElementById('ufClass').value.trim();
    if (cls) body.className = cls;
  } else {
    const email = document.getElementById('ufEmail').value.trim();
    if (!email) { toast('Email is required for this role', 'err'); return; }
    body.email = email;
  }
  const sup = document.getElementById('ufSup');
  if (sup && sup.value) body.supervisorId = sup.value;
  const res = await API.post('/users', body);
  if (res.user && res.user.supervisorCode) {
    newSupCode = { name: res.user.fullName, code: res.user.supervisorCode };
    toast('Supervisor created — access code ' + res.user.supervisorCode, 'ok');
  } else {
    toast('User created', 'ok');
  }
  renderUsers();
}
async function userRowClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.copy) { copyText(b.dataset.copy); return; }
  if (b.dataset.dismiss) { newSupCode = null; renderUsers(); return; }
  const act = b.dataset.act;
  if (!act) return;
  const u = usersCache.filter(function (x) { return x.id === b.dataset.id; })[0];
  if (!u) return;
  if (act === 'reset') {
    const pw = prompt('New password for ' + u.fullName + ' (min 6 characters):');
    if (pw === null) return;
    if (pw.length < 6) { toast('Password must be at least 6 characters', 'err'); return; }
    await API.put('/users/' + u.id, { password: pw });
    toast('Password updated', 'ok');
  } else if (act === 'toggle') {
    await API.put('/users/' + u.id, { suspended: !u.suspended });
    toast(u.suspended ? 'User unsuspended' : 'User suspended', 'ok');
  } else if (act === 'del') {
    if (u.id === ME.user.id) { toast('You cannot delete your own account', 'err'); return; }
    if (!confirm('Delete ' + u.fullName + '? This cannot be undone.')) return;
    await API.del('/users/' + u.id);
    toast('User deleted', 'ok');
  }
  renderUsers();
}

/* ========================================================== supervisors ==== */
async function renderSupervisors() {
  const el = sec('supervisors');
  if (!isAdmin()) { setView('dashboard'); return; }
  el.innerHTML = '<div class="card"><p class="muted">Loading supervisors…</p></div>';
  let d;
  try {
    d = await API.get('/admin/overview');
  } catch (e) {
    el.innerHTML = '<div class="card"><p class="muted">' + esc(msg(e)) + '</p></div>';
    toast(msg(e), 'err');
    return;
  }
  supOverview = d;
  const sups = d.supervisors || [];
  let html = newSupCodeHtml();
  html += '<div class="card"><h3>Create supervisor</h3>' +
    '<p class="muted small">Supervisors manage members and receive a shareable access code.</p>' +
    '<form id="supForm"><div class="row">' +
    '<div><label>Full name</label><input type="text" id="sfName" required></div>' +
    '<div><label>Email</label><input type="email" id="sfEmail" required></div>' +
    '<div><label>Password (min 6 characters)</label><input type="password" id="sfPw" required minlength="6"></div>' +
    '<div class="fixed"><button type="submit">Create supervisor</button></div>' +
    '</div></form></div>';
  html += '<div class="card"><h3>Supervisors <span class="badge info">' + sups.length +
    '</span></h3>' + supTableHtml(sups) + '</div>';
  el.innerHTML = html;

  document.getElementById('supForm').onsubmit = wrap(async function (e) {
    e.preventDefault();
    const res = await API.post('/users', {
      role: 'supervisor',
      fullName: document.getElementById('sfName').value.trim(),
      email: document.getElementById('sfEmail').value.trim(),
      password: document.getElementById('sfPw').value
    });
    if (res.user && res.user.supervisorCode) {
      newSupCode = { name: res.user.fullName, code: res.user.supervisorCode };
    }
    toast('Supervisor created', 'ok');
    renderSupervisors();
  });
  el.onclick = function (e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.copy) copyText(b.dataset.copy);
    else if (b.dataset.dismiss) { newSupCode = null; renderSupervisors(); }
  };
}
/* =============================================================== library === */
function libIndicator(it) {
  if (it.fileName) return '<span class="mono small">' + esc(it.fileName) + '</span>';
  if (it.text) return '<span class="badge warn">Text · ' + String(it.text).length + ' chars</span>';
  if (it.url) return '<a href="' + esc(it.url) + '" target="_blank" rel="noopener">Open link</a>';
  return '<span class="muted">—</span>';
}
async function renderLibrary() {
  const el = sec('library');
  if (!isAdmin()) { setView('dashboard'); return; }
  el.innerHTML = '<div class="card"><p class="muted">Loading library…</p></div>';
  let items = [], videos = [];
  try {
    const res = await Promise.all([
      API.get('/library'),
      API.get('/videos').catch(function () { return { videos: [] }; })
    ]);
    items = res[0].library || [];
    videos = res[1].videos || [];
  } catch (e) {
    el.innerHTML = '<div class="card"><p class="muted">' + esc(msg(e)) + '</p></div>';
    toast(msg(e), 'err');
    return;
  }

  let html = '<div class="card"><h3>Add to library</h3><form id="libForm"><div class="row">' +
    '<div><label>Type</label><select id="lfType">' +
    '<option value="book">Book / Reading (file)</option>' +
    '<option value="letter">Letter (text)</option>' +
    '<option value="video">Video (URL)</option></select></div>' +
    '<div><label>Title</label><input type="text" id="lfTitle" required></div>' +
    '</div>' +
    '<div id="lfTextRow"><label>Text (for letters)</label>' +
    '<textarea id="lfText" placeholder="Paste the letter text"></textarea></div>' +
    '<div id="lfUrlRow" class="hidden"><label>Video URL</label>' +
    '<input type="text" id="lfUrl" placeholder="https://…"></div>' +
    '<label>File (optional — max 40MB)</label><input type="file" id="lfFile">' +
    '<div class="mt"><button type="submit">Upload</button></div></form></div>';

  html += '<div class="card"><h3>Library <span class="badge info">' + items.length + '</span></h3>';
  if (!items.length) {
    html += '<p class="muted">The library is empty.</p>';
  } else {
    html += '<div class="table-wrap"><table><thead><tr><th>Type</th><th>Title</th>' +
      '<th>Scope</th><th>Content</th><th>Actions</th></tr></thead><tbody>';
    items.forEach(function (it) {
      const scope = it.scope === 'global'
        ? '<span class="badge lock">Global</span>'
        : '<span class="badge info">This account</span>';
      const acts = it.canEdit
        ? '<button type="button" class="ghost small" data-libedit="' + esc(it.id) + '">Edit</button> ' +
          '<button type="button" class="danger small" data-libdel="' + esc(it.id) + '">Delete</button>'
        : '<span class="badge lock">Read-only</span>';
      html += '<tr><td>' + typeBadge(it.type) + '</td><td><b>' + esc(it.title) + '</b></td>' +
        '<td>' + scope + '</td><td>' + libIndicator(it) + '</td>' +
        '<td style="white-space:nowrap">' + acts + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';
  html += '<div class="card"><h3>Videos <span class="badge info">' + videos.length + '</span></h3>';
  if (!videos.length) {
    html += '<p class="muted">No videos yet.</p>';
  } else {
    html += '<div class="table-wrap"><table><thead><tr><th>Title</th><th>Link</th><th>Status</th></tr></thead><tbody>';
    videos.forEach(function (v) {
      html += '<tr><td><b>' + esc(v.title) + '</b></td><td>' +
        (v.url ? '<a href="' + esc(v.url) + '" target="_blank" rel="noopener">Open</a>'
               : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (v.watched ? '<span class="badge ok">Watched</span>'
                            : '<span class="badge lock">Not watched</span>') + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';

  el.innerHTML = html;

  const typeSel = document.getElementById('lfType');
  const syncType = function () {
    const t = typeSel.value;
    document.getElementById('lfTextRow').classList.toggle('hidden', t !== 'letter');
    document.getElementById('lfUrlRow').classList.toggle('hidden', t !== 'video');
  };
  typeSel.onchange = syncType;
  syncType();

  document.getElementById('libForm').onsubmit = wrap(async function (e) {
    e.preventDefault();
    const type = typeSel.value;
    const title = document.getElementById('lfTitle').value.trim();
    const text = document.getElementById('lfText').value.trim();
    const url = document.getElementById('lfUrl').value.trim();
    const file = await filePayload(document.getElementById('lfFile'));
    const body = { type: type, title: title };
    if (type === 'letter') {
      if (!text && !file) { toast('Add text or a file for the letter', 'err'); return; }
      if (text) body.text = text;
    } else if (type === 'video') {
      if (!url && !file) { toast('Add a video URL', 'err'); return; }
      if (url) body.url = url;
    } else {
      if (!file && !url) { toast('Attach a file or provide a URL', 'err'); return; }
      if (url) body.url = url;
    }
    if (file) body.file = file;
    await API.post('/library', body);
    toast('Library entry added', 'ok');
    renderLibrary();
  });

  el.onclick = wrap(async function (e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.libedit) {
      const it = items.filter(function (x) { return x.id === b.dataset.libedit; })[0];
      if (it) openLibEdit(it);
      return;
    }
    if (b.dataset.libdel) {
      const it = items.filter(function (x) { return x.id === b.dataset.libdel; })[0];
      if (!it) return;
      if (!confirm('Delete "' + it.title + '" from the library?')) return;
      await API.del('/library/' + it.id);
      toast('Entry deleted', 'ok');
      renderLibrary();
    }
  });
}

function openLibEdit(it) {
  openModal('<h3>Edit library entry</h3>' +
    '<p class="muted small">Type: <b>' + esc(it.type) + '</b>' +
    (it.fileName ? ' — current file: <span class="mono">' + esc(it.fileName) + '</span>' : '') + '</p>' +
    '<form id="libEditForm"><label>Title</label>' +
    '<input type="text" id="leTitle" value="' + esc(it.title) + '" required>' +
    '<label>Text</label><textarea id="leText">' + esc(it.text || '') + '</textarea>' +
    '<label>URL</label><input type="text" id="leUrl" value="' + esc(it.url || '') + '" placeholder="https://…">' +
    '<label>Replace file (optional — max 40MB)</label><input type="file" id="leFile">' +
    '<div class="mt"><button type="submit">Save changes</button></div></form>');
  document.getElementById('libEditForm').onsubmit = wrap(async function (e) {
    e.preventDefault();
    const body = {
      title: document.getElementById('leTitle').value.trim(),
      text: document.getElementById('leText').value.trim(),
      url: document.getElementById('leUrl').value.trim()
    };
    const f = await filePayload(document.getElementById('leFile'));
    if (f) body.file = f;
    await API.put('/library/' + it.id, body);
    closeModal();
    toast('Entry updated', 'ok');
    renderLibrary();
  });
}
/* ======================================================== modules & books == */
async function renderBooks() {
  const el = sec('books');
  if (!isAdmin()) { setView('dashboard'); return; }
  el.innerHTML = '<div class="card"><p class="muted">Loading modules…</p></div>';
  let mods = [], lib = [];
  try {
    const res = await Promise.all([
      API.get('/modules'),
      API.get('/library').catch(function () { return { library: [] }; })
    ]);
    mods = res[0].modules || [];
    lib = res[1].library || [];
  } catch (e) {
    el.innerHTML = '<div class="card"><p class="muted">' + esc(msg(e)) + '</p></div>';
    toast(msg(e), 'err');
    return;
  }
  booksState.modules = mods;
  if (!booksState.moduleId || !mods.some(function (m) { return m.id === booksState.moduleId; })) {
    booksState.moduleId = mods.length ? mods[0].id : null;
    booksState.openBookId = null;
  }
  if (!mods.length) {
    el.innerHTML = '<div class="card"><h3>Modules &amp; Books</h3>' +
      '<p class="muted">No modules found — ask the super admin to create one.</p></div>';
    return;
  }
  const libOpts = function (type) {
    let h = '<option value="">— none —</option>';
    lib.filter(function (l) { return l.type === type; }).forEach(function (l) {
      h += '<option value="' + esc(l.id) + '">' + esc(l.title) + '</option>';
    });
    return h;
  };
  let tabs = '<div class="final-tabs">';
  mods.forEach(function (m) {
    tabs += '<button type="button" data-mod="' + esc(m.id) + '"' +
      (m.id === booksState.moduleId ? ' class="active"' : '') + '>' + esc(m.title) + '</button>';
  });
  tabs += '</div>';

  el.innerHTML = '<div class="card"><h3>Modules &amp; Books</h3>' +
    '<p class="muted small">Pick a module, then open a book to manage its chapters and quiz questions.</p>' +
    tabs +
    '<form id="bookForm" class="mt"><div class="row">' +
    '<div><label>New book title</label><input type="text" id="bfTitle" required></div>' +
    '<div><label>Order (optional)</label><input type="number" id="bfOrder" min="1"></div>' +
    '<div><label>Linked reading (library)</label><select id="bfLib">' + libOpts('book') + '</select></div>' +
    '<div><label>Linked letter</label><select id="bfLetter">' + libOpts('letter') + '</select></div>' +
    '<div class="fixed"><button type="submit">Add book</button></div>' +
    '</div></form></div><div id="booksArea"></div>';

  el.querySelectorAll('[data-mod]').forEach(function (b) {
    b.onclick = wrap(function () {
      booksState.moduleId = b.dataset.mod;
      booksState.openBookId = null;
      el.querySelectorAll('[data-mod]').forEach(function (x) {
        x.classList.toggle('active', x === b);
      });
      return refreshBooks();
    });
  });
  document.getElementById('bookForm').onsubmit = wrap(async function (e) {
    e.preventDefault();
    const body = { moduleId: booksState.moduleId, title: document.getElementById('bfTitle').value.trim() };
    const order = document.getElementById('bfOrder').value;
    if (order) body.order = Number(order);
    const libId = document.getElementById('bfLib').value;
    if (libId) body.libraryId = libId;
    const letId = document.getElementById('bfLetter').value;
    if (letId) body.letterId = letId;
    await API.post('/books', body);
    toast('Book added', 'ok');
    document.getElementById('bfTitle').value = '';
    refreshBooks();
  });
  await refreshBooks();
}
async function refreshBooks() {
  const area = document.getElementById('booksArea');
  if (!area) return;
  if (!booksState.moduleId) {
    area.innerHTML = '<div class="card"><p class="muted">Select a module first.</p></div>';
    return;
  }
  area.innerHTML = '<div class="card"><p class="muted">Loading books…</p></div>';
  let books = [];
  try {
    const d = await API.get('/books?moduleId=' + encodeURIComponent(booksState.moduleId));
    books = d.books || [];
  } catch (e) {
    area.innerHTML = '<div class="card"><p class="muted">' + esc(msg(e)) + '</p></div>';
    toast(msg(e), 'err');
    return;
  }
  booksState.books = books;
  let html = '<div class="card"><h3>Books <span class="badge info">' + books.length + '</span></h3>';
  if (!books.length) {
    html += '<p class="muted">No books in this module yet — add one above.</p>';
  } else {
    html += '<div class="book-grid">';
    books.forEach(function (b) {
      const can = b.canEdit !== false;
      html += '<div class="book-card' + (b.id === booksState.openBookId ? ' current' : '') +
        '" data-book="' + esc(b.id) + '"><b>' + esc(b.title) + '</b>' +
        '<div class="small muted">' + (b.chapters || []).length + ' chapter(s) · order ' +
        esc(b.order == null ? '—' : b.order) + '</div>' +
        (can ? '<span class="badge ok">Editable</span>'
             : '<span class="badge lock">Managed by the super admin</span>') + '</div>';
    });
    html += '</div>';
  }
  html += '</div>';
  if (booksState.openBookId) {
    const ob = books.filter(function (b) { return b.id === booksState.openBookId; })[0];
    if (ob) html += bookDetailHtml(ob);
    else booksState.openBookId = null;
  }
  area.innerHTML = html;
  bindBookEvents(area);
}

function bookDetailHtml(book) {
  const can = book.canEdit !== false;
  let h = '<div class="card" id="bookDetail">' +
    '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">' +
    '<h3 style="margin:0">' + esc(book.title) + '</h3>' +
    '<button type="button" class="ghost small" data-closedetail="1">Close book</button></div>';
  if (!can) {
    h += '<p class="muted small mt">This book is managed by the super admin — you can review ' +
      'its chapters and questions here, but only the super admin can change them.</p>';
  }
  const chs = book.chapters || [];
  if (!chs.length) h += '<p class="muted mt">No chapters yet.</p>';
  chs.forEach(function (ch, i) { h += chapterHtml(ch, i, can); });
  if (can) {
    h += '<form id="chForm" class="qform" style="margin-top:16px"><h4>Add chapter</h4><div class="row">' +
      '<div><label>Title</label><input type="text" id="chfTitle" required></div>' +
      '<div><label>Page start</label><input type="number" id="chfStart" min="1"></div>' +
      '<div><label>Page end</label><input type="number" id="chfEnd" min="1"></div>' +
      '<div><label>Order</label><input type="number" id="chfOrder" min="1"></div>' +
      '</div><label>Content</label>' +
      '<textarea id="chfContent" placeholder="Chapter text (optional)"></textarea>' +
      '<div class="mt"><button type="submit">Add chapter</button></div></form>';
  }
  return h + '</div>';
}
function chapterHtml(ch, idx, can) {
  const pages = (ch.pageStart != null || ch.pageEnd != null)
    ? ' <span class="timestamp">(p. ' + esc(ch.pageStart == null ? '—' : ch.pageStart) +
      '–' + esc(ch.pageEnd == null ? '—' : ch.pageEnd) + ')</span>'
    : '';
  let h = '<div class="chap"><div class="q">' + (idx + 1) + '. ' + esc(ch.title) + pages + '</div>';
  if (ch.content) {
    h += '<details class="exp"><summary>Content</summary>' +
      '<div class="small" style="white-space:pre-wrap;margin-top:6px">' + esc(ch.content) + '</div></details>';
  }
  if (can) {
    h += '<p class="mt"><button type="button" class="ghost small" data-editch="' + esc(ch.id) +
      '">Edit chapter</button> <button type="button" class="danger small" data-delch="' +
      esc(ch.id) + '">Delete</button></p>';
  }
  const objs = ch.objectives || [];
  h += '<p class="small muted" style="margin-bottom:6px">Questions (' + objs.length + ')</p>';
  if (!objs.length) h += '<p class="small muted">No questions yet.</p>';
  objs.forEach(function (o, i) {
    const opts = o.options || [];
    const correct = opts[o.answerIndex];
    h += '<div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;' +
      'background:#f8faff;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:6px">' +
      '<div class="small"><b>Q' + (i + 1) + '.</b> ' + esc(o.question) +
      '<br><span class="muted">Answer: ' + esc(correct == null ? '—' : correct) + '</span></div>' +
      (can ? '<button type="button" class="danger small" data-delobj="' + esc(o.id) + '">Delete</button>' : '') +
      '</div>';
  });
  if (can) h += questionFormHtml(ch);
  return h + '</div>';
}
function questionFormHtml(ch) {
  let opts = optRowHtml(ch.id, 0, true) + optRowHtml(ch.id, 1, false);
  return '<form class="qform" data-ch="' + esc(ch.id) + '">' +
    '<h4>Add question</h4>' +
    '<label>Question</label>' +
    '<textarea class="qtext" style="min-height:70px" required placeholder="Type the question"></textarea>' +
    '<label>Options — tick the radio next to the correct answer</label>' +
    '<div class="optlist">' + opts + '</div>' +
    '<div class="row" style="align-items:center">' +
    '<div class="fixed"><button type="button" class="ghost small" data-addopt>Add option</button></div>' +
    '<div class="fixed"><button type="submit">Save question</button></div></div></form>';
}
function optRowHtml(chId, i, checked) {
  return '<div class="opt-row">' +
    '<input type="radio" class="radio" name="cor-' + esc(chId) + '"' + (checked ? ' checked' : '') +
    ' title="Correct answer">' +
    '<input type="text" class="opttext" placeholder="Option ' + (i + 1) + '">' +
    '<button type="button" class="ghost small" data-rmopt title="Remove option">&#10005;</button></div>';
}
function bindBookEvents(area) {
  area.onclick = wrap(async function (e) {
    const b = e.target.closest('button');
    if (b) {
      if (b.hasAttribute('data-addopt')) { addOption(b); return; }
      if (b.hasAttribute('data-rmopt')) { removeOption(b); return; }
      if (b.dataset.closedetail) { booksState.openBookId = null; await refreshBooks(); return; }
      if (b.dataset.editch) { openChapterEdit(b.dataset.editch); return; }
      if (b.dataset.delch) {
        if (!confirm('Delete this chapter and all of its questions?')) return;
        await API.del('/chapters/' + b.dataset.delch);
        toast('Chapter deleted', 'ok');
        await refreshBooks();
        return;
      }
      if (b.dataset.delobj) {
        if (!confirm('Delete this question?')) return;
        await API.del('/objectives/' + b.dataset.delobj);
        toast('Question deleted', 'ok');
        await refreshBooks();
        return;
      }
      return;
    }
    const card = e.target.closest('.book-card');
    if (card && card.dataset.book) {
      booksState.openBookId = booksState.openBookId === card.dataset.book ? null : card.dataset.book;
      await refreshBooks();
    }
  });

  area.querySelectorAll('form.qform[data-ch]').forEach(function (f) {
    f.onsubmit = wrap(async function (ev) {
      ev.preventDefault();
      await saveQuestion(f);
    });
  });

  const chForm = area.querySelector('#chForm');
  if (chForm) {
    chForm.onsubmit = wrap(async function (ev) {
      ev.preventDefault();
      const body = { title: document.getElementById('chfTitle').value.trim() };
      const content = document.getElementById('chfContent').value.trim();
      if (content) body.content = content;
      const s = document.getElementById('chfStart').value;
      const en = document.getElementById('chfEnd').value;
      const o = document.getElementById('chfOrder').value;
      if (s) body.pageStart = Number(s);
      if (en) body.pageEnd = Number(en);
      if (o) body.order = Number(o);
      await API.post('/books/' + booksState.openBookId + '/chapters', body);
      toast('Chapter added', 'ok');
      await refreshBooks();
    });
  }
}

async function saveQuestion(f) {
  const q = f.querySelector('.qtext').value.trim();
  if (!q) { toast('Type the question', 'err'); return; }
  const rows = f.querySelectorAll('.opt-row');
  const options = [];
  let answerIndex = -1;
  rows.forEach(function (r) {
    const v = r.querySelector('.opttext').value.trim();
    if (!v) return;
    if (r.querySelector('input[type=radio]').checked) answerIndex = options.length;
    options.push(v);
  });
  if (options.length < 2) { toast('Provide at least two options', 'err'); return; }
  if (answerIndex < 0) { toast('Mark the correct answer with the radio button', 'err'); return; }
  await API.post('/chapters/' + f.dataset.ch + '/objectives', {
    question: q, options: options, answerIndex: answerIndex
  });
  toast('Question added', 'ok');
  await refreshBooks();
}
function addOption(btn) {
  const form = btn.closest('form');
  const list = form.querySelector('.optlist');
  const chId = form.dataset.ch;
  const div = document.createElement('div');
  div.className = 'opt-row';
  div.innerHTML = '<input type="radio" class="radio" name="cor-' + esc(chId) + '" title="Correct answer">' +
    '<input type="text" class="opttext" placeholder="Option ' + (list.children.length + 1) + '">' +
    '<button type="button" class="ghost small" data-rmopt title="Remove option">&#10005;</button>';
  list.appendChild(div);
  div.querySelector('.opttext').focus();
}
function removeOption(btn) {
  const row = btn.closest('.opt-row');
  const list = row.parentElement;
  if (list.children.length <= 2) { toast('A question needs at least two options', 'err'); return; }
  const wasChecked = row.querySelector('input[type=radio]').checked;
  row.remove();
  if (wasChecked) list.querySelector('input[type=radio]').checked = true;
}
function openChapterEdit(id) {
  let ch = null;
  booksState.books.forEach(function (b) {
    (b.chapters || []).forEach(function (c) { if (c.id === id) ch = c; });
  });
  if (!ch) return;
  openModal('<h3>Edit chapter</h3><form id="chEditForm">' +
    '<label>Title</label><input type="text" id="ceTitle" value="' + esc(ch.title) + '" required>' +
    '<label>Content</label><textarea id="ceContent">' + esc(ch.content || '') + '</textarea>' +
    '<div class="row">' +
    '<div><label>Page start</label><input type="number" id="ceStart" value="' +
      esc(ch.pageStart == null ? '' : ch.pageStart) + '"></div>' +
    '<div><label>Page end</label><input type="number" id="ceEnd" value="' +
      esc(ch.pageEnd == null ? '' : ch.pageEnd) + '"></div>' +
    '<div><label>Order</label><input type="number" id="ceOrder" value="' +
      esc(ch.order == null ? '' : ch.order) + '"></div>' +
    '</div><div class="mt"><button type="submit">Save chapter</button></div></form>');
  document.getElementById('chEditForm').onsubmit = wrap(async function (e) {
    e.preventDefault();
    const body = {
      title: document.getElementById('ceTitle').value.trim(),
      content: document.getElementById('ceContent').value
    };
    const s = document.getElementById('ceStart').value;
    const en = document.getElementById('ceEnd').value;
    const o = document.getElementById('ceOrder').value;
    body.pageStart = s ? Number(s) : null;
    body.pageEnd = en ? Number(en) : null;
    if (o) body.order = Number(o);
    await API.put('/chapters/' + id, body);
    closeModal();
    toast('Chapter updated', 'ok');
    await refreshBooks();
  });
}
/* ========================================================== submissions ==== */
async function renderSubmissions() {
  const el = sec('submissions');
  const types = [['', 'All types'], ['objectives', 'Objectives'],
    ['chapter_summary', 'Chapter summary'], ['letter_summary', 'Letter summary'],
    ['book_summary', 'Book summary'], ['best_book', 'Best book'],
    ['general_summary', 'General summary']];
  let opts = '';
  types.forEach(function (t) {
    opts += '<option value="' + t[0] + '"' + (submState.type === t[0] ? ' selected' : '') +
      '>' + esc(t[1]) + '</option>';
  });
  el.innerHTML = '<div class="card"><div class="row" style="align-items:flex-end">' +
    '<div style="min-width:200px"><label>Search submissions</label>' +
      '<input type="text" id="sfSearch" placeholder="Name, chapter, book, text…" value="' +
      esc(submState.search) + '"></div>' +
    '<div class="fixed"><label style="margin-bottom:10px">' +
    '<input type="checkbox" id="sfFlag"' + (submState.flagged ? ' checked' : '') +
    '> Flagged only</label></div>' +
    '<div><label>Type</label><select id="sfType">' + opts + '</select></div>' +
    '</div></div><div id="submRows"><div class="card"><p class="muted">Loading…</p></div></div>';
  document.getElementById('sfFlag').onchange = function () {
    submState.flagged = this.checked;
    loadSubmRows();
  };
  document.getElementById('sfType').onchange = function () {
    submState.type = this.value;
    loadSubmRows();
  };
  document.getElementById('sfSearch').addEventListener('input', function () {
    submState.search = this.value;
    applyTableSearch(document.querySelector('#submRows table'),
      document.getElementById('sfSearch'), document.getElementById('sfTableCount'));
  });
  await loadSubmRows();
}

async function loadSubmRows() {
  const box = document.getElementById('submRows');
  if (!box) return;
  box.innerHTML = '<div class="card"><p class="muted">Loading submissions…</p></div>';
  let rows = [];
  try {
    const q = [];
    if (submState.flagged) q.push('flagged=1');
    if (submState.type) q.push('type=' + encodeURIComponent(submState.type));
    const d = await API.get('/admin/submissions' + (q.length ? '?' + q.join('&') : ''));
    rows = d.submissions || [];
  } catch (e) {
    box.innerHTML = '<div class="card"><p class="muted">' + esc(msg(e)) + '</p></div>';
    toast(msg(e), 'err');
    return;
  }
  let html = '<div class="card"><h3>Submissions <span class="badge info">' + rows.length +
    '</span> <span class="badge lock" id="sfTableCount">' + rows.length + ' shown</span></h3>';
  if (!rows.length) {
    html += '<p class="muted">No submissions match these filters.</p>';
  } else {
    html += '<div class="table-wrap"><table><thead><tr><th>User</th><th>Type</th>' +
      '<th>Chapter / Book</th><th>Date</th><th>Score</th><th>Similarity</th><th>Text</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (s) {
      const score = (s.score != null && s.total != null)
        ? '<span class="badge info">' + esc(s.score) + ' / ' + esc(s.total) + '</span>'
        : '<span class="muted">—</span>';
      const sim = esc(s.similarity || 0) + '% ' + (s.flagged
        ? '<span class="badge off">Flagged</span>' : '<span class="badge ok">OK</span>');
      const label = s.label
        ? '<div class="small"><span style="display:inline-block;width:10px;height:10px;' +
          'border-radius:50%;background:' + esc(s.color || '#999') + '"></span> ' +
          esc(s.label) + '</div>'
        : '';
      const loc = [s.book, s.chapter].filter(Boolean).map(esc).join(' — ');
      html += '<tr data-search="' + esc(searchText(s)) + '"><td><b>' + esc(s.userName || '—') + '</b>' +
        (s.userRole ? '<div class="small muted">' + esc(s.userRole) + '</div>' : '') + '</td>' +
        '<td>' + typeBadge(s.type) + label + '</td>' +
        '<td>' + (loc || '<span class="muted">—</span>') + '</td>' +
        '<td class="small">' + fmtDate(s.createdAt) + '</td>' +
        '<td>' + score + '</td><td class="small">' + sim + '</td>' +
        '<td style="min-width:220px"><details class="exp"><summary>Read text</summary>' +
        '<div class="small" style="white-space:pre-wrap;margin-top:6px">' +
        esc(s.text || '(empty)') + '</div></details></td></tr>';
    });
    html += '</tbody></table></div>';
  }
  box.innerHTML = html + '</div>';
  applyTableSearch(box.querySelector('table'),
    document.getElementById('sfSearch'), document.getElementById('sfTableCount'));
}
/* ========================================================= certificates ==== */
async function renderCertificates() {
  const el = sec('certificates');
  el.innerHTML = '<div class="card"><p class="muted">Loading certificates…</p></div>';
  let certs = [];
  try {
    const d = await API.get('/admin/certificates');
    certs = d.certificates || [];
  } catch (e) {
    el.innerHTML = '<div class="card"><p class="muted">' + esc(msg(e)) + '</p></div>';
    toast(msg(e), 'err');
    return;
  }
  let html = '<div class="card"><div class="row" style="align-items:flex-end">' +
    '<div style="min-width:200px"><label>Search certificates</label>' +
      '<input type="text" id="ctSearch" placeholder="Code, title, user, book…" value="' +
      esc(certState.search) + '"></div>' +
    '<div class="fixed" style="padding-bottom:10px"><h3 style="margin:0">Certificates ' +
      '<span class="badge info">' + certs.length + '</span> ' +
      '<span class="badge lock" id="ctTableCount">' + certs.length + ' shown</span></h3></div></div>';
  if (!certs.length) {
    html += '<p class="muted">No certificates issued yet.</p>';
  } else {
    html += '<div class="table-wrap"><table><thead><tr><th>Code</th><th>Title</th><th>User</th>' +
      '<th>Books</th><th>Performance</th><th>Issued</th><th></th></tr></thead><tbody>';
    certs.forEach(function (c) {
      const books = c.books && c.books.length ? c.books : (c.bestBook ? [c.bestBook] : []);
      const perf = c.performance != null ? esc(c.performance) + '%' : '<span class="muted">—</span>';
      html += '<tr data-search="' + esc(searchText(c)) + '"><td class="mono">' + esc(c.code || '—') + '</td>' +
        '<td>' + esc(c.title || '—') + '</td>' +
        '<td><b>' + esc(c.userName || '—') + '</b></td>' +
        '<td class="small">' + (books.length ? esc(books.join(', '))
          : '<span class="muted">—</span>') + '</td>' +
        '<td>' + perf + '</td><td class="small">' + fmtDate(c.issuedAt) + '</td>' +
        '<td><button type="button" class="small" data-cert="' + esc(c.id) + '">View</button></td></tr>';
    });
    html += '</tbody></table></div>';
  }
  el.innerHTML = html + '</div>';
  const ctSearch = document.getElementById('ctSearch');
  const ctTable = el.querySelector('table');
  if (ctSearch && ctTable) {
    ctSearch.addEventListener('input', function () {
      certState.search = this.value;
      applyTableSearch(ctTable, ctSearch, document.getElementById('ctTableCount'));
    });
    applyTableSearch(ctTable, ctSearch, document.getElementById('ctTableCount'));
  }
  el.onclick = function (e) {
    const b = e.target.closest('button[data-cert]');
    if (!b) return;
    const c = certs.filter(function (x) { return x.id === b.dataset.cert; })[0];
    if (c) openCertModal(c);
  };
}

function openCertModal(c) {
  const b = ME.branding || {};
  const books = c.books && c.books.length ? c.books : (c.bestBook ? [c.bestBook] : []);
  let logos = '';
  if (b.tenantLogo) logos += '<img class="logo" src="' + esc(b.tenantLogo) + '" alt="Logo">';
  if (b.programLogo) logos += '<img class="logo" src="' + esc(b.programLogo) + '" alt="Program logo">';
  let bookList = '';
  books.forEach(function (t) { bookList += '<li>' + esc(t) + '</li>'; });
  const sheet = '<div class="cert-sheet">' +
    (logos ? '<div class="cert-logos">' + logos + '</div>' : '') +
    '<h1>' + esc(c.title || 'Certificate') + '</h1>' +
    '<p>This certificate is proudly presented to</p>' +
    '<div class="name">' + esc(c.userName || '—') + '</div>' +
    (books.length ? '<p>for the successful completion of</p>' +
      '<div class="books"><ul>' + bookList + '</ul></div>' : '') +
    (c.performance != null ? '<p>Overall performance: <b>' + esc(c.performance) + '%</b></p>' : '') +
    (c.objectiveScore != null ? '<p class="small muted">Objective score: ' +
      esc(c.objectiveScore) + '</p>' : '') +
    '<div class="foot"><span>Code: <b class="mono">' + esc(c.code || '—') + '</b></span>' +
    '<span>Issued: ' + fmtDate(c.issuedAt) + '</span></div></div>' +
    '<div class="no-print center mt"><button type="button" id="certPrint">Print certificate</button></div>';
  openModal(sheet, true);
  document.getElementById('certPrint').onclick = function () { window.print(); };
}
/* ============================================================= branding ==== */
function updateTopbarLogos() {
  const t = document.getElementById('logoTenant');
  const p = document.getElementById('logoProgram');
  if (ME.branding.tenantLogo) {
    t.src = ME.branding.tenantLogo;
    t.classList.remove('hidden');
  } else {
    t.removeAttribute('src');
    t.classList.add('hidden');
  }
  if (ME.branding.programLogo) {
    p.src = ME.branding.programLogo;
    p.classList.remove('hidden');
  } else {
    p.removeAttribute('src');
    p.classList.add('hidden');
  }
}
async function renderBranding() {
  const el = sec('branding');
  if (!isAdmin()) { setView('dashboard'); return; }
  const b = ME.branding || {};
  brandState.logo = undefined;
  brandState.programLogo = undefined;
  el.innerHTML = '<div class="card"><h3>Branding</h3>' +
    '<p class="muted small">Images must be under 1.5 MB (PNG, JPG or SVG). ' +
    'Pick a file to replace an image, or use the remove button to clear it.</p>' +
    '<form id="brandForm"><div class="grid cols-2">' +
    '<div><label>Organization / school logo</label>' +
    '<div>' + (b.tenantLogo
      ? '<img id="pvTenant" class="thumb" src="' + esc(b.tenantLogo) + '" alt="Current logo">'
      : '<img id="pvTenant" class="thumb hidden" alt="Preview">') + '</div>' +
    '<input type="file" id="bfLogo" accept="image/*">' +
    '<p><button type="button" class="ghost small" id="clearLogo">Remove current logo</button></p></div>' +
    '<div><label>Program logo</label>' +
    '<div>' + (b.programLogo
      ? '<img id="pvProgram" class="thumb" src="' + esc(b.programLogo) + '" alt="Current program logo">'
      : '<img id="pvProgram" class="thumb hidden" alt="Preview">') + '</div>' +
    '<input type="file" id="bfProgram" accept="image/*">' +
    '<p><button type="button" class="ghost small" id="clearProgram">Remove program logo</button></p></div>' +
    '</div><div class="mt"><button type="submit">Save branding</button></div></form></div>';

  const bindPreview = function (inputId, previewId, key) {
    document.getElementById(inputId).onchange = wrap(async function () {
      const f = this.files[0];
      if (!f) return;
      if (f.size > 1500000) {
        this.value = '';
        throw new Error('Please choose an image under 1.5 MB');
      }
      const url = await fileToDataUrl(f);
      brandState[key] = url;
      const img = document.getElementById(previewId);
      img.src = url;
      img.classList.remove('hidden');
    });
  };
  bindPreview('bfLogo', 'pvTenant', 'logo');
  bindPreview('bfProgram', 'pvProgram', 'programLogo');

  document.getElementById('clearLogo').onclick = function () {
    brandState.logo = null;
    const img = document.getElementById('pvTenant');
    img.removeAttribute('src');
    img.classList.add('hidden');
    document.getElementById('bfLogo').value = '';
  };
  document.getElementById('clearProgram').onclick = function () {
    brandState.programLogo = null;
    const img = document.getElementById('pvProgram');
    img.removeAttribute('src');
    img.classList.add('hidden');
    document.getElementById('bfProgram').value = '';
  };

  document.getElementById('brandForm').onsubmit = wrap(async function (e) {
    e.preventDefault();
    const body = {};
    if (brandState.logo !== undefined) body.logo = brandState.logo;
    if (brandState.programLogo !== undefined) body.programLogo = brandState.programLogo;
    if (body.logo === undefined && body.programLogo === undefined) {
      toast('Choose a new image first', 'err');
      return;
    }
    await API.put('/admin/branding', body);
    if (body.logo !== undefined) ME.branding.tenantLogo = body.logo;
    if (body.programLogo !== undefined) ME.branding.programLogo = body.programLogo;
    updateTopbarLogos();
    toast('Branding saved', 'ok');
    renderBranding();
  });
}
/* =============================================================== wiring ==== */
RENDER.dashboard = renderDashboard;
RENDER.users = renderUsers;
RENDER.supervisors = renderSupervisors;
RENDER.library = renderLibrary;
RENDER.books = renderBooks;
RENDER.submissions = renderSubmissions;
RENDER.certificates = renderCertificates;
RENDER.branding = renderBranding;

const ADMIN_ONLY_VIEWS = ['supervisors', 'library', 'books', 'branding'];

function setView(name) {
  if (ADMIN_ONLY_VIEWS.indexOf(name) !== -1 && !isAdmin()) name = 'dashboard';
  VIEW = name;
  document.querySelectorAll('#nav .nav-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.view === name);
  });
  document.querySelectorAll('.view').forEach(function (s) {
    s.classList.toggle('active', s.id === 'view-' + name);
  });
  renderView();
}

/* /api/me does not include the portal type — resolve it from the public
   portal list using the tenant name so role options match this portal. */
async function resolvePortalType() {
  if (ME.portal && ME.portal.type) return ME.portal.type;
  try {
    const d = await API.get('/public/portals');
    const name = ME.branding ? ME.branding.tenantName : null;
    const list = d.portals || [];
    for (let i = 0; i < list.length; i++) {
      const hit = (list[i].tenants || []).filter(function (t) {
        return name && t.name === name;
      })[0];
      if (hit) return list[i].type;
    }
  } catch (e) { /* keep null — server validates roles anyway */ }
  return null;
}

async function boot() {
  let me = null;
  try {
    me = await requireSession(['tenant_admin', 'supervisor']);
  } catch (e) {
    document.getElementById('sessionMsg').classList.remove('hidden');
    return;
  }
  ME = me;
  ROLE = me.user.role;
  if (!ME.branding) ME.branding = {};
  if (!ME.portal) ME.portal = {};
  API.setUser(me.user);

  try {
    const t = await resolvePortalType();
    if (t) ME.portal.type = t;
  } catch (e) { /* ignore */ }

  document.title = (ME.branding.tenantName || 'Admin') + ' — Admin Console';
  document.getElementById('tenantName').textContent =
    ME.branding.tenantName || 'Admin Console';
  document.getElementById('whoName').textContent =
    me.user.fullName || me.user.email || '';
  updateTopbarLogos();
  document.getElementById('btnLogout').onclick = function () { API.logout(); };

  if (!isAdmin()) {
    document.querySelectorAll('#nav .admin-only').forEach(function (b) {
      b.classList.add('hidden');
    });
    document.getElementById('navUsers').textContent = 'My Users';
  }
  document.getElementById('nav').onclick = function (e) {
    const b = e.target.closest('.nav-btn');
    if (b && b.dataset.view) setView(b.dataset.view);
  };
  setView('dashboard');
}

boot();















