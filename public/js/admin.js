/* Tenant admin / supervisor console — served at /admin. */
let ME = null, ROLE = null, VIEW = 'dashboard';
let supOverview = null, newSupCode = null, usersCache = [], certsCache = [];
const booksState = { modules: [], moduleId: null, books: [], openBookId: null };
const submState = { flagged: false, type: '', search: '' };
const usersState = { search: '' };
const certState = { search: '' };
const brandState = { logo: undefined };
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

function statCard(n, l, tone) {
  return '<div class="stat' + (tone ? ' tone-' + tone : '') + '"><div class="n">' +
    esc(n == null ? 0 : n) + '</div><div class="l">' + esc(l) + '</div></div>';
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
  let d, flagged = [], allSubs = [];
  try {
    const res = await Promise.all([
      API.get('/admin/overview'),
      API.get('/admin/submissions?flagged=1').catch(function () { return { submissions: [] }; }),
      API.get('/admin/submissions').catch(function () { return { submissions: [] }; })
    ]);
    d = res[0];
    flagged = res[1].submissions || [];
    allSubs = res[2].submissions || [];
  } catch (e) {
    el.innerHTML = '<div class="card"><p class="muted">Could not load the dashboard: ' +
      esc(msg(e)) + '</p></div>';
    toast(msg(e), 'err');
    return;
  }
  supOverview = d;
  setFlagCount(flagged.length);
  const c = d.counts || {};
  let html = '<h2><span class="motto">Be True</span>Dashboard</h2><div class="grid cols-4">' +
    statCard(c.users, isAdmin() ? 'Users' : 'My members', 'blue') +
    statCard(c.submissions, 'Submissions', 'violet') +
    statCard(c.flagged, 'Flagged', 'red') +
    statCard(c.certificates, 'Certificates', 'green');
  if (isAdmin()) html += statCard(c.supervisors, 'Supervisors', 'teal');
  if (d.limit) html += statCard((d.limit.used || 0) + ' / ' + (d.limit.max || 0), 'Member quota', 'amber');
  html += '</div>';

  /* ------------------------------------------------ statistics graphs --- */
  const typeNames = { objectives: 'Objectives', chapter_summary: 'Chapter summary', letter_summary: 'Letter summary',
    book_summary: 'Book summary', best_book: 'Best book', general_summary: 'General summary' };
  const byType = {};
  allSubs.forEach(function (s) { byType[s.type] = (byType[s.type] || 0) + 1; });
  const learners = Math.max(0, (c.users || 0) - (c.supervisors || 0));
  html += '<div class="card"><h3>Statistics</h3><div class="chart-grid">' +
    '<div class="chart-box"><h4>Submissions by type</h4>' +
      chartBars(Object.keys(byType).map(function (k) {
        return { label: typeNames[k] || k, value: byType[k] };
      })) + '</div>' +
    '<div class="chart-box"><h4>Copy check</h4>' +
      chartDonut([
        { label: 'Original work', value: Math.max(0, (c.submissions || 0) - flagged.length), color: '#1f7a44' },
        { label: 'Flagged', value: flagged.length, color: '#c62828' }
      ], { centerLabel: 'submissions' }) + '</div>' +
    '<div class="chart-box"><h4>Submissions per week</h4>' +
      chartWeekly(allSubs, 8, { caption: 'Activity over the last 8 weeks' }) + '</div>' +
    '<div class="chart-box"><h4>Account make-up</h4>' +
      chartBarsH([
        { label: 'Learners', value: learners, color: '#2f6fd0' },
        { label: 'Supervisors', value: c.supervisors || 0, color: '#0f766e' },
        { label: 'Certificates', value: c.certificates || 0, color: '#1f7a44' },
        { label: 'Flagged', value: c.flagged || 0, color: '#c62828' }
      ]) + '</div>' +
  '</div></div>';

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
  /* Organization portal: the admin only adds supervisors (they add the users). */
  else if (t === 'organization') opts = [['supervisor', 'Supervisor']];
  else if (t === 'family' || t === 'married') opts = [['member', 'Member']];
  else opts = [['student', 'Student'], ['teacher', 'Teacher'], ['member', 'Member']];
  if (t !== 'organization') opts.push(['supervisor', 'Supervisor']);
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
  /* Organization portal: the admin only adds supervisors — no assignment. */
  if (isAdmin() && supOverview && supOverview.supervisors && supOverview.supervisors.length &&
      !(ME.portal && ME.portal.type === 'organization')) {
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
  if (t === 'schools') return 'student';
  /* Organization portal: the admin only adds supervisors via bulk. */
  if (t === 'organization' && isAdmin()) return 'supervisor';
  return 'member';
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
  const orgAdmin = t === 'organization' && isAdmin();
  const hint = t === 'schools'
    ? 'CSV columns: <b>fullName, email, studentNumber, className</b> — students need a student number, e.g. <span class="mono">Jane Doe,,STU-101,Grade 10A</span>'
    : orgAdmin
      ? 'CSV columns: <b>fullName, email</b> — each row creates a <b>supervisor</b> (access code generated automatically), e.g. <span class="mono">Sam Supervisor,sam@example.com</span>'
      : 'CSV columns: <b>fullName, email, studentNumber, className</b> — e.g. <span class="mono">John Doe,john@example.com,,Group A</span>';
  const roles = t === 'schools'
    ? [['student', 'Student'], ['teacher', 'Teacher']]
    : (orgAdmin ? [['supervisor', 'Supervisor']]
      : [['member', t === 'organization' ? 'Member / User' : 'Member']]);
  const roleOpts = roles.map(function (o) {
    return '<option value="' + o[0] + '"' + (bulkDefaultRole() === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
  }).join('');
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
  '<div class="row export-buttons" data-target="#usersArea">' +
    '<button type="button" class="ghost" data-export="print">Print</button>' +
    '<button type="button" class="ghost" data-export="pdf">PDF</button>' +
    '<button type="button" class="ghost" data-export="excel">Excel</button>' +
    '<button type="button" class="ghost" data-export="word">Word</button>' +
  '</div>' +
  '<p class="muted small">The list below shows the users that match what you type in the search box.</p>' +
  '<div id="usersArea">' +
    (usersCache.length ? usersTableHtml() : '<p class="muted">No users yet.</p>') +
  '</div></div>';
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

/* pdfHtml() lives in common.js — it renders the book-style single-page reader. */

function libIndicator(it) {
  /* an uploaded/linked PDF offers the closed cover so it can be opened on click */
  if (it.url && /\.pdf($|[?#])/i.test(String(it.url))) {
    return pdfHtml(it.url, { title: it.fileName || it.title });
  }
  if (it.fileName) return '<span class="mono small">' + esc(it.fileName) + '</span>';
  if (it.text) return '<span class="badge warn">Text · ' + String(it.text).length + ' chars</span>';
  if (it.url) return pdfHtml(it.url);
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
        (v.url ? pdfHtml(v.url)
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
  booksState.lib = lib;
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
/* ---------------------------------------------- chapter page selection --- */
/* The picker in common.js offers every page of the book (no 99-page limit) and
   can size itself from the PDF linked to the book. */
function chapterPages(ch) {
  if (ch && Array.isArray(ch.pageSelect) && ch.pageSelect.length) {
    return ch.pageSelect.map(Number).filter(function (n) { return n >= 1; });
  }
  if (ch && (ch.pageStart != null || ch.pageEnd != null)) {
    const a = [Number(ch.pageStart), Number(ch.pageEnd)].filter(function (n) { return n >= 1; });
    if (a.length === 2 && a[1] >= a[0]) {
      const out = [];
      for (let i = a[0]; i <= a[1] && out.length < 5000; i++) out.push(i);
      return out;
    }
    return a;
  }
  return [];
}
function bookPageTotal(book) {
  let max = 0;
  ((book && book.chapters) || []).forEach(function (c) {
    [c.pageStart, c.pageEnd].forEach(function (p) { max = Math.max(max, Number(p) || 0); });
    (c.pageSelect || []).forEach(function (p) { max = Math.max(max, Number(p) || 0); });
  });
  return max;
}
function bookPdfUrl(book) {
  const lib = (booksState.lib || []).filter(function (l) { return l.id === (book && book.libraryId); })[0];
  return lib && lib.url && /\.pdf($|[?#])/i.test(String(lib.url)) ? lib.url : null;
}
/* fills the two "Select pages" boxes (add chapter + edit chapter) */
function initPagePickers(area) {
  if (!area || !area.querySelector) return;
  const book = (booksState.books || []).filter(function (b) { return b.id === booksState.openBookId; })[0];
  const total = bookPageTotal(book);
  const pdf = bookPdfUrl(book);
  const add = area.querySelector('#chfPages');
  if (add && !add.querySelector('[data-pg]')) {
    add.innerHTML = pagePickerHTML([], total, { pdf: pdf });
    pgInit(add.querySelector('[data-pg]'));
  }
  const edit = area.querySelector('#cePages');
  if (edit && !edit.querySelector('[data-pg]')) {
    edit.innerHTML = pagePickerHTML(booksState.editPages || [], total, { pdf: pdf });
    pgInit(edit.querySelector('[data-pg]'));
  }
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
  initPagePickers(area);
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
  chs.forEach(function (ch, i) { h += chapterHtml(ch, i, can, book); });
  if (can) {
    h += '<form id="chForm" class="qform" style="margin-top:16px"><h4>Add chapter</h4><div class="row">' +
      '<div><label>Title</label><input type="text" id="chfTitle" required></div>' +
      '<div id="chfPages" class="page-pick-cell"></div>' +
      '<div><label>Order</label><input type="number" id="chfOrder" min="1"></div>' +
      '</div><label>Content</label>' +
      '<textarea id="chfContent" placeholder="Chapter text (optional)"></textarea>' +
      (isSummaryModule(book)
        ? '<label>Key words (comma separated — the typed answer is assessed against these)</label>' +
          '<input type="text" class="kw-input" id="chfKeywords" placeholder="Leave empty to use the words that stand out in the chapter text">'
        : '') +
      '<div class="mt"><button type="submit">Add chapter</button></div></form>';
  }
  return h + '</div>';
}
function chapterHtml(ch, idx, can, book) {
  const pages = (ch.pageStart != null || ch.pageEnd != null)
    ? ' <span class="timestamp">(p. ' + esc(ch.pageStart == null ? '—' : ch.pageStart) +
      '–' + esc(ch.pageEnd == null ? '—' : ch.pageEnd) + ')</span>'
    : '';
  let h = '<div class="chap"><div class="q">' + (idx + 1) + '. ' + esc(ch.title) + pages + '</div>';
  if (isSummaryModule(book)) h += keyWordsRowHtml(ch);
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
  if (can) {
    if (isSummaryModule(book)) {
      h += '<p class="muted small">MODE: SUMMARY — learners type their answer for this chapter, so ' +
        'questions are not used in this module. The typed answer is assessed against the chapter key words.</p>';
    } else {
      h += questionFormHtml(ch);
    }
  }
  return h + '</div>';
}
/* is the module this book belongs to answered by typing (MODE: SUMMARY)? */
function isSummaryModule(book) {
  const mods = booksState.modules || [];
  const m = mods.filter(function (x) { return x.id === (book && book.moduleId); })[0];
  return !!m && m.mode === 'summary';
}
function keyWordsRowHtml(ch) {
  const list = (ch && Array.isArray(ch.keywords)) ? ch.keywords : [];
  const sug = (ch && Array.isArray(ch.suggestedKeywords)) ? ch.suggestedKeywords : [];
  const show = list.length ? list : sug;
  if (!show.length) return '';
  return '<p class="small muted" style="margin:4px 0 0">' +
    (list.length ? 'Key words: ' : 'Auto key words (from the chapter text): ') +
    show.map(function (k) { return '<span class="kw">' + esc(k) + '</span>'; }).join(' ') + '</p>';
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
      const pg = chForm.querySelectorAll('.pg-ck:checked');
      if (pg.length) {
        const arr = Array.prototype.map.call(pg, function (el) { return Number(el.value); })
          .filter(function (n) { return n >= 1; });
        if (arr.length) {
          body.pageStart = Math.min.apply(null, arr);
          body.pageEnd = Math.max.apply(null, arr);
        }
      }
      const o = document.getElementById('chfOrder').value;
      if (o) body.order = Number(o);
      const kwEl = document.getElementById('chfKeywords');
      if (kwEl && kwEl.value.trim()) body.keywords = kwEl.value;
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
  booksState.editPages = chapterPages(ch);
  const editBook = (booksState.books || []).filter(function (b) { return b.id === booksState.openBookId; })[0] || null;
  openModal('<h3>Edit chapter</h3><form id="chEditForm">' +
    '<label>Title</label><input type="text" id="ceTitle" value="' + esc(ch.title) + '" required>' +
    '<label>Content</label><textarea id="ceContent">' + esc(ch.content || '') + '</textarea>' +
    (isSummaryModule(editBook)
      ? '<label>Key words (comma separated — the typed answer is assessed against these)</label>' +
        '<input type="text" class="kw-input" id="ceKeywords" value="' +
        esc((ch.keywords || []).join(', ')) + '" placeholder="' +
        esc((ch.suggestedKeywords || []).join(', ')) + '">'
      : '') +
    '<div class="row">' +
    '<div id="cePages" class="page-pick-cell"></div>' +
    '<div><label>Order</label><input type="number" id="ceOrder" value="' +
      esc(ch.order == null ? '' : ch.order) + '"></div>' +
    '</div><div class="mt"><button type="submit">Save chapter</button></div></form>');
  document.getElementById('chEditForm').onsubmit = wrap(async function (e) {
    e.preventDefault();
    const body = {
      title: document.getElementById('ceTitle').value.trim(),
      content: document.getElementById('ceContent').value
    };
    const pg = document.getElementById('cePages').querySelectorAll('.pg-ck:checked');
    if (pg.length) {
      const arr = Array.prototype.map.call(pg, function (el) { return Number(el.value); })
        .filter(function (n) { return n >= 1; });
      if (arr.length) {
        body.pageStart = Math.min.apply(null, arr);
        body.pageEnd = Math.max.apply(null, arr);
      }
    }
    const o = document.getElementById('ceOrder').value;
    if (o) body.order = Number(o);
    const kwEl = document.getElementById('ceKeywords');
    if (kwEl) body.keywords = kwEl.value;
    await API.put('/chapters/' + id, body);
    closeModal();
    toast('Chapter updated', 'ok');
    await refreshBooks();
  });
  initPagePickers(document);
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
         '</div></div><div class="row export-buttons" data-target="#submRows"><button type="button" class="ghost" data-export="print">Print</button><button type="button" class="ghost" data-export="pdf">PDF</button><button type="button" class="ghost" data-export="excel">Excel</button><button type="button" class="ghost" data-export="word">Word</button></div><div id="submRows"><div class="card"><p class="muted">Loading…</p></div></div>';
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
      '<span class="badge lock" id="ctTableCount">' + certs.length + ' shown</span></h3></div></div>' +
    '<div class="row export-buttons"><button type="button" class="ghost" data-export="print">Print</button><button type="button" class="ghost" data-export="pdf">PDF</button><button type="button" class="ghost" data-export="word">Word</button></div>' +
    '<div class="row export-buttons"><span class="muted small" style="align-self:center">Bulk certificates — tick the rows below, then:</span>' +
      '<button type="button" class="ghost" data-bulk="print">Print selected</button>' +
      '<button type="button" class="ghost" data-bulk="pdf">PDF selected</button>' +
      '<button type="button" class="ghost" data-bulk="word">Word selected</button>' +
      '<button type="button" class="ghost" data-bulk="all">Print all</button></div>';

  if (!certs.length) {
    html += '<p class="muted">No certificates issued yet.</p>';
  } else {
    html += '<div class="table-wrap"><table><thead><tr><th class="no-print"><input type="checkbox" id="ctAll" title="Select all"></th><th>Code</th><th>Title</th><th>User</th>' +
      '<th>Books</th><th>Performance</th><th>Issued</th><th></th></tr></thead><tbody>';
    certs.forEach(function (c) {
      const books = c.books && c.books.length ? c.books : (c.bestBook ? [c.bestBook] : []);
      const perf = c.performance != null ? esc(c.performance) + '%' : '<span class="muted">—</span>';
      html += '<tr data-search="' + esc(searchText(c)) + '"><td class="no-print"><input type="checkbox" class="ctPick" value="' + esc(c.id) + '"></td><td class="mono">' + esc(c.code || '—') + '</td>' +
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
  certsCache = certs;
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
    const bulk = e.target.closest('button[data-bulk]');
    if (bulk) {
      const mode = bulk.dataset.bulk;
      const list = mode === 'all' ? certs.slice() : certPicked();
      if (!list.length) { toast('Tick at least one certificate first', 'err'); return; }
      const sheets = list.map(function (c) {
        return '<div class="cert-page">' + certSheetHtml(c) + '</div>';
      }).join('');
      exportReport(mode === 'all' ? 'print' : mode, 'Certificates (' + list.length + ')', sheets);
      return;
    }
    const b = e.target.closest('button[data-cert]');
    if (!b) return;
    const c = certs.filter(function (x) { return x.id === b.dataset.cert; })[0];
    if (c) openCertModal(c);
  };
  const ctAll = document.getElementById('ctAll');
  if (ctAll) {
    ctAll.onchange = function () {
      const on = !!this.checked;
      el.querySelectorAll('.ctPick').forEach(function (x) { x.checked = on; });
    };
  }
}

function certSheetHtml(c) {
  const b = ME.branding || {};
  const books = c.books && c.books.length ? c.books : (c.bestBook ? [c.bestBook] : []);
  let logos = '';
  if (b.tenantLogo) logos += '<img class="logo" src="' + esc(b.tenantLogo) + '" alt="Logo">';
  let bookList = '';
  books.forEach(function (t) { bookList += '<li>' + esc(t) + '</li>'; });
  return '<div class="cert-sheet">' +
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
    '<span>Issued: ' + fmtDate(c.issuedAt) + '</span></div></div>';
}
function certPicked() {
  const ids = [];
  document.querySelectorAll('#view-certificates .ctPick:checked').forEach(function (el) {
    ids.push(el.value);
  });
  return certsCache.filter(function (c) { return ids.indexOf(c.id) !== -1; });
}
function openCertModal(c) {
  openModal(certSheetHtml(c) +
    '<div class="no-print center mt"><div class="row export-buttons"><button type="button" class="ghost" data-export="cert-pdf">PDF</button><button type="button" class="ghost" data-export="cert-word">Word</button><button type="button" class="ghost" data-export="cert-print">Print</button></div></div>', true);
}
/* ============================================================= branding ==== */
function updateTopbarLogos() {
  const t = document.getElementById('logoTenant');
  if (ME.branding.tenantLogo) {
    t.src = ME.branding.tenantLogo;
    t.classList.remove('hidden');
  } else {
    t.removeAttribute('src');
    t.classList.add('hidden');
  }
}
async function renderBranding() {
  const el = sec('branding');
  if (!isAdmin()) { setView('dashboard'); return; }
  const b = ME.branding || {};
  brandState.logo = undefined;
  brandState.themeColor = undefined;
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
    '<div><label>Account colour</label>' +
      '<div class="row" style="align-items:center;gap:8px">' +
        '<input type="color" id="bfTheme" value="' + (themeIsHex(b.themeColor) ? esc(b.themeColor) : '#24508c') + '" style="width:64px;height:38px;padding:2px">' +
        '<span class="mono small" id="bfThemeVal">' + (themeIsHex(b.themeColor) ? esc(b.themeColor) : 'program default') + '</span></div>' +
      '<div class="row" id="themePresets" style="gap:6px;margin-top:8px">' +
        ['#24508c', '#0f766e', '#7c3aed', '#b91c1c', '#b45309', '#15803d', '#0e7490', '#be185d'].map(function (c) {
          return '<button type="button" class="ghost small" data-theme="' + c + '" title="' + c +
            '" style="background:' + c + ';color:#fff;border-color:' + c + '">' + c + '</button>';
        }).join('') +
      '</div>' +
      '<p class="muted small">Repaints this account\u2019s whole layout — header, menus, buttons and its login page.</p>' +
      '<p><button type="button" class="ghost small" id="clearTheme">Use the default colour</button></p></div>' +
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

  const themeInput = document.getElementById('bfTheme');
  const themeVal = document.getElementById('bfThemeVal');
  if (themeInput) {
    themeInput.oninput = function () {
      brandState.themeColor = this.value;
      applyThemeColor(this.value);
      if (themeVal) themeVal.textContent = this.value;
    };
    document.getElementById('themePresets').onclick = function (ev) {
      const sw = ev.target.closest('button[data-theme]');
      if (!sw) return;
      themeInput.value = sw.dataset.theme;
      brandState.themeColor = sw.dataset.theme;
      applyThemeColor(sw.dataset.theme);
      if (themeVal) themeVal.textContent = sw.dataset.theme;
    };
    document.getElementById('clearTheme').onclick = function () {
      brandState.themeColor = null;
      applyThemeColor(null);
      if (themeVal) themeVal.textContent = 'program default';
    };
  }

  document.getElementById('clearLogo').onclick = function () {
    brandState.logo = null;
    const img = document.getElementById('pvTenant');
    img.removeAttribute('src');
    img.classList.add('hidden');
    document.getElementById('bfLogo').value = '';
  };

  document.getElementById('brandForm').onsubmit = wrap(async function (e) {
    e.preventDefault();
    const body = {};
    if (brandState.logo !== undefined) body.logo = brandState.logo;
    if (brandState.themeColor !== undefined) body.themeColor = brandState.themeColor;
    if (Object.keys(body).length === 0) {
      toast('Change an image or pick a colour first', 'err');
      return;
    }
    await API.put('/admin/branding', body);
    if (body.logo !== undefined) ME.branding.tenantLogo = body.logo;
    if (body.themeColor !== undefined) {
      ME.branding.themeColor = body.themeColor;
      applyThemeColor(body.themeColor);
    }
    updateTopbarLogos();
    toast('Branding saved', 'ok');
    renderBranding();
  });
}
/* ======================================================= student progress == */
/* How each learner is using the system, which level they are on, ranked by how
   much of the programme they have covered. A summary can be expanded for every
   learner who finished all the modules. */
async function renderProgress() {
  const el = sec('progress');
  el.innerHTML = '<div class="card"><p class="muted">Loading student progress…</p></div>';
  let d;
  try { d = await API.get('/reports/students'); }
  catch (e) {
    el.innerHTML = '<div class="card"><p class="muted">' + esc(msg(e)) + '</p></div>';
    toast(msg(e), 'err');
    return;
  }
  const list = d.students || [];
  const finished = function (s) { return s.moduleCount > 0 && s.modulesCompleted === s.moduleCount; };
  const byLevel = {};
  list.forEach(function (s) {
    const k = s.level && s.level.title ? s.level.title : '—';
    byLevel[k] = (byLevel[k] || 0) + 1;
  });
  const bands = [
    { label: 'Finished all modules', value: list.filter(finished).length, color: '#1f7a44' },
    { label: '75% or more', value: list.filter(function (s) { return !finished(s) && s.progress >= 75; }).length, color: '#2f6fd0' },
    { label: '25 – 74%', value: list.filter(function (s) { return s.progress >= 25 && s.progress < 75; }).length, color: '#b45309' },
    { label: 'Under 25%', value: list.filter(function (s) { return s.progress < 25; }).length, color: '#c62828' }
  ];
  el.innerHTML = '<h2><span class="motto">Be True</span>Student progress</h2>' +
    '<div class="grid cols-4">' +
      statCard(d.count, 'Learners', 'blue') +
      statCard(d.average + '%', 'Average coverage', 'violet') +
      statCard(d.finished, 'Finished all modules', 'green') +
      statCard(d.notStarted, 'Never submitted', 'red') +
    '</div>' +
    '<div class="card"><h3>How the group is progressing</h3><div class="chart-grid">' +
      '<div class="chart-box"><h4>Learners per level</h4>' +
        chartBarsH(Object.keys(byLevel).map(function (k) { return { label: k, value: byLevel[k] }; })) + '</div>' +
      '<div class="chart-box"><h4>Progress bands</h4>' +
        chartDonut(bands, { centerLabel: 'learners' }) + '</div>' +
      '<div class="chart-box"><h4>Most submissions</h4>' +
        chartBarsH(list.slice(0, 10).map(function (s) {
          return { label: s.fullName, value: s.submissions, color: '#6d3fd1' }; })) + '</div>' +
      '<div class="chart-box"><h4>Certificates earned</h4>' +
        chartBarsH(list.slice().sort(function (a, b) { return b.certificates - a.certificates; }).slice(0, 10)
          .map(function (s) { return { label: s.fullName, value: s.certificates, color: '#b8217a' }; })) + '</div>' +
    '</div></div>' +
    '<div class="card"><div class="row" style="align-items:flex-end">' +
      '<div style="min-width:200px"><label>Search learners</label>' +
        '<input type="text" id="pgSearch" placeholder="Name, level, class…"></div>' +
      '<div class="fixed" style="padding-bottom:10px"><h3 style="margin:0">Ranking ' +
        '<span class="badge info">' + list.length + '</span> ' +
        '<span class="badge lock" id="pgCount">' + list.length + ' shown</span></h3></div>' +
    '</div>' +
    '<div class="row export-buttons" data-target="#progressArea">' +
      '<button type="button" class="ghost" data-export="print">Print</button>' +
      '<button type="button" class="ghost" data-export="pdf">PDF</button>' +
      '<button type="button" class="ghost" data-export="excel">Excel</button>' +
      '<button type="button" class="ghost" data-export="word">Word</button></div>' +
    '<p class="muted small">Ranked by how much of the programme each learner has covered. ' +
      'A full summary can be opened for learners who finished every module.</p>' +
    '<div id="progressArea">' + progressTableHtml(list) + '</div></div>';

  const search = document.getElementById('pgSearch');
  const table = el.querySelector('#progressArea table');
  if (search && table) {
    search.addEventListener('input', function () {
      applyTableSearch(table, search, document.getElementById('pgCount'));
    });
    applyTableSearch(table, search, document.getElementById('pgCount'));
  }
  el.onclick = function (e) {
    const b = e.target.closest('button[data-sum]');
    if (!b) return;
    const row = document.getElementById('sum-' + b.dataset.sum);
    if (!row) return;
    const nowHidden = row.classList.toggle('hidden');
    b.textContent = nowHidden ? 'Summary' : 'Hide summary';
  };
}

function progressTableHtml(list) {
  if (!list.length) return '<p class="muted">No learners yet.</p>';
  let h = '<div class="table-wrap"><table><thead><tr>' +
    '<th>#</th><th>Learner</th><th>Level (module)</th><th>Covered</th>' +
    '<th>Submissions</th><th>Certificates</th><th>Flagged</th><th>Last active</th><th>Summary</th>' +
    '</tr></thead><tbody>';
  list.forEach(function (s, i) {
    const done = s.moduleCount > 0 && s.modulesCompleted === s.moduleCount;
    const ident = [s.email, s.studentNumber].filter(Boolean).map(esc).join(' · ');
    const level = s.level || {};
    h += '<tr data-search="' + esc(searchText(s)) + '">' +
      '<td><b>' + (i + 1) + '</b></td>' +
      '<td><b>' + esc(s.fullName || '—') + '</b>' +
        (ident ? '<div class="small muted">' + ident + '</div>' : '') +
        (s.className ? '<div class="small muted">' + esc(s.className) + '</div>' : '') + '</td>' +
      '<td class="small"><b>' + esc(level.title || '—') + '</b>' +
        '<div class="muted">' + esc(level.state || '') +
        (s.moduleCount ? ' · ' + s.modulesCompleted + '/' + s.moduleCount + ' modules' : '') + '</div></td>' +
      '<td style="min-width:130px"><b>' + (s.progress || 0) + '%</b>' + bar(s.progress || 0) + '</td>' +
      '<td>' + (s.submissions || 0) + '</td>' +
      '<td>' + (s.certificates || 0) + '</td>' +
      '<td>' + (s.flagged ? '<span class="badge off">' + s.flagged + '</span>' : '<span class="badge ok">0</span>') + '</td>' +
      '<td class="small">' + (s.lastActiveAt ? fmtDate(s.lastActiveAt) : '<span class="muted">never</span>') + '</td>' +
      '<td>' + (done
        ? '<button type="button" class="small" data-sum="' + esc(s.id) + '">Summary</button>'
        : '<span class="muted small">Not finished yet</span>') + '</td></tr>';
    if (done) h += summaryRowHtml(s);
  });
  return h + '</tbody></table></div>';
}

/* Expanded summary row — rendered only for learners who finished everything. */
function summaryRowHtml(s) {
  const recent = (s.recent || []).map(function (r) {
    const where = [r.book, r.chapter].filter(Boolean).map(esc).join(' — ') || esc(r.label || '—');
    const status = r.flagged
      ? '<span class="flag">Copied ' + esc(r.similarity) + '%</span>'
      : (r.total ? '<span class="badge ok">' + esc(r.score) + '/' + esc(r.total) + '</span>'
                 : '<span class="badge ok">Submitted</span>');
    return '<tr><td class="small">' + fmtDate(r.createdAt) + '</td><td>' + typeBadge(r.type) + '</td>' +
      '<td class="small">' + where + '</td><td>' + status + '</td></tr>';
  }).join('');
  return '<tr class="sum-row hidden" id="sum-' + esc(s.id) + '"><td colspan="9"><div class="sum-box">' +
    '<div class="chart-grid">' +
      '<div><h4>Programme coverage</h4>' +
        chartProgress((s.modules || []).map(function (m) {
          return { label: m.title, percent: m.percent,
            color: m.status === 'completed' ? '#1f7a44' : (m.status === 'active' ? undefined : '#94a3b8') };
        })) + '</div>' +
      '<div><h4>Totals</h4><div class="grid cols-2">' +
        '<div class="stat tone-blue"><div class="n">' + (s.submissions || 0) + '</div><div class="l">Submissions</div></div>' +
        '<div class="stat tone-green"><div class="n">' + (s.certificates || 0) + '</div><div class="l">Certificates</div></div>' +
        '<div class="stat tone-violet"><div class="n">' + (s.progress || 0) + '%</div><div class="l">Covered</div></div>' +
        '<div class="stat tone-red"><div class="n">' + (s.flagged || 0) + '</div><div class="l">Copy flags</div></div>' +
      '</div><p class="muted small mt">' +
        (s.supervisorName ? 'Supervisor: <b>' + esc(s.supervisorName) + '</b> · ' : '') +
        (s.tenantName ? 'Account: <b>' + esc(s.tenantName) + '</b> · ' : '') +
        'Last active: <b>' + (s.lastActiveAt ? fmtDate(s.lastActiveAt) : 'never') + '</b></p></div>' +
    '</div>' +
    '<h4 class="mt">Recent work</h4>' +
    (recent
      ? '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Chapter / book</th>' +
        '<th>Result</th></tr></thead><tbody>' + recent + '</tbody></table></div>'
      : '<p class="muted small">No submissions recorded.</p>') +
  '</div></td></tr>';
}

/* ================================================= analytics & impact ====== */
/* Account-scoped reporting: performance of the individuals in this account and
   the statistical impact of the exercise for them and for the account itself,
   with graphs down to module / book / chapter level, and every copy flag shown
   together with the person it is connected to. Nothing outside this account is
   ever loaded (the API scopes it). */
const ASTAT = { data: null, moduleId: '', weeks: 12 };

function astatQuery() {
  const q = ['weeks=' + encodeURIComponent(ASTAT.weeks || 12)];
  if (ASTAT.moduleId) q.push('moduleId=' + encodeURIComponent(ASTAT.moduleId));
  return '?' + q.join('&');
}
function astatFiltersHtml(d) {
  const mods = (d.filters || {}).modules || [];
  const weekOpts = [4, 8, 12, 26, 52];
  const v = d.viewer || {};
  return '<div class="card"><div class="row" style="align-items:flex-end">' +
    '<div><label>Module</label><select id="asModule"><option value="">All modules</option>' +
      mods.map(function (m) {
        return '<option value="' + esc(m.id) + '"' + (String(m.id) === String(ASTAT.moduleId) ? ' selected' : '') +
          '>' + esc(m.title) + '</option>';
      }).join('') + '</select></div>' +
    '<div><label>Period</label><select id="asWeeks">' +
      weekOpts.map(function (w) {
        return '<option value="' + w + '"' + (Number(ASTAT.weeks) === w ? ' selected' : '') +
          '>last ' + w + ' weeks</option>';
      }).join('') + '</select></div>' +
    '<div class="fixed" style="padding-bottom:10px"><button type="button" id="asApply">Apply</button> ' +
      '<button type="button" class="ghost" id="asReset">Reset</button></div>' +
  '</div><p class="muted small" style="margin-bottom:0">' +
    (v.role === 'supervisor'
      ? 'Impact for the members you look after.'
      : 'Impact of the exercise for <b>' + esc(v.tenantName || 'this account') + '</b>' +
        (v.portalName ? ' (' + esc(v.portalName) + ')' : '') + '.') +
    ' Generated ' + esc(fmtDate(d.generatedAt)) + '.</p></div>';
}
function astatKpisHtml(d) {
  const i = d.impact || {};
  return '<div class="grid cols-4">' +
    statCard(i.participants == null ? 0 : i.participants, 'Participants', 'blue') +
    statCard((i.involvementRate || 0) + '%', 'Involvement', 'violet') +
    statCard((i.completionRate || 0) + '%', 'Completion', 'green') +
    statCard(i.certificates == null ? 0 : i.certificates, 'Certificates', 'pink') +
    statCard((i.avgProgress || 0) + '%', 'Average progress', 'teal') +
    statCard(i.keywordCoverage == null ? '—' : i.keywordCoverage + '%', 'Key-word coverage', 'amber') +
    statCard(i.objectiveAccuracy == null ? '—' : i.objectiveAccuracy + '%', 'Objective accuracy', 'slate') +
    statCard((i.integrity == null ? 100 : i.integrity) + '%', 'Original work', 'red') +
  '</div>';
}

function astatChartsHtml(d) {
  const act = d.activity || [];
  const learners = d.learners || [];
  const mods = d.modules || [];
  const i = d.impact || {};
  const weeks = act.map(function (a) { return { label: a.label, value: a.submissions, value2: a.certificates }; });
  const bands = [
    { label: 'Finished all modules', value: learners.filter(function (l) { return l.finished; }).length, color: '#1f7a44' },
    { label: '75% or more', value: learners.filter(function (l) { return !l.finished && l.progress >= 75; }).length, color: '#2f6fd0' },
    { label: '25 – 74%', value: learners.filter(function (l) { return l.progress >= 25 && l.progress < 75; }).length, color: '#b45309' },
    { label: 'Under 25%', value: learners.filter(function (l) { return l.progress < 25; }).length, color: '#c62828' }
  ];
  const modBars = [];
  mods.forEach(function (m) {
    const short = String(m.title).replace(/^MODULE\s+\w+\s*[—-]\s*/i, '').slice(0, 14);
    modBars.push({ label: short + ' started', value: m.started, color: '#2f6fd0' });
    modBars.push({ label: short + ' completed', value: m.completed, color: '#1f7a44' });
  });
  const chapterItems = [];
  (ASTAT.moduleId ? mods : mods.slice(0, 1)).forEach(function (m) {
    (m.books || []).forEach(function (b) {
      (b.chapters || []).forEach(function (c) {
        chapterItems.push({ label: String(c.title).replace(/^Chapter\s*\d+\s*[—-]\s*/i, '').slice(0, 18),
          value: c.completed || 0 });
      });
    });
  });
  const learnerBars = learners.slice(0, 12).map(function (l) {
    return { label: l.name, value: l.progress, color: l.finished ? '#1f7a44' : '#2f6fd0' };
  });
  return '<div class="card"><h3>Graphical analysis</h3><div class="chart-grid">' +
    '<div class="chart-box"><h4>Weekly activity</h4>' +
      chartLine(weeks, { second: true, caption: 'Submissions (solid) and certificates (dashed)' }) + '</div>' +
    '<div class="chart-box"><h4>New learners per week</h4>' +
      chartBars(act.map(function (a) { return { label: a.label, value: a.newUsers }; })) + '</div>' +
    '<div class="chart-box"><h4>Impact indices</h4>' +
      chartProgress([
        { label: 'Involvement', percent: i.involvementRate || 0, color: '#6d3fd1' },
        { label: 'Completion', percent: i.completionRate || 0, color: '#1f7a44' },
        { label: 'Active (14 days)', percent: i.activeShare || 0, color: '#2f6fd0' },
        { label: 'Key words', percent: i.keywordCoverage || 0, color: '#b45309' },
        { label: 'Objectives', percent: i.objectiveAccuracy || 0, color: '#475569' },
        { label: 'Original work', percent: i.integrity == null ? 100 : i.integrity, color: '#b8217a' }
      ]) + '</div>' +
    '<div class="chart-box"><h4>Progress distribution</h4>' +
      chartDonut(bands, { centerLabel: 'learners' }) + '</div>' +
    '<div class="chart-box"><h4>Progress per learner</h4>' + chartBarsH(learnerBars) + '</div>' +
    '<div class="chart-box"><h4>Module funnel</h4>' + chartBarsH(modBars) + '</div>' +
    '<div class="chart-box"><h4>Chapter completions' + (ASTAT.moduleId ? '' : ' (first module)') + '</h4>' +
      chartBarsH(chapterItems, { max: 14, caption: 'Learners who completed each chapter' }) + '</div>' +
    '<div class="chart-box"><h4>Most submissions</h4>' +
      chartBarsH(learners.slice(0, 10).map(function (l) {
        return { label: l.name, value: l.submissions, color: '#0f766e' };
      })) + '</div>' +
    '<div class="chart-box"><h4>Certificates earned</h4>' +
      chartBarsH(learners.slice().sort(function (a, b) { return b.certificates - a.certificates; }).slice(0, 10)
        .map(function (l) { return { label: l.name, value: l.certificates, color: '#b8217a' }; })) + '</div>' +
  '</div></div>';
}

function exportBtnsHtml() {
  return '<button type="button" class="ghost" data-export="print">Print</button>' +
    '<button type="button" class="ghost" data-export="pdf">PDF</button>' +
    '<button type="button" class="ghost" data-export="excel">Excel</button>' +
    '<button type="button" class="ghost" data-export="word">Word</button>';
}
function astatLearnersHtml(d) {
  const rows = d.learners || [];
  let h = '<div class="card"><div class="row" style="align-items:flex-end">' +
    '<div style="min-width:220px"><label>Search learners</label>' +
      '<input type="text" id="asLearnerSearch" placeholder="Name, class, level…"></div>' +
    '<div class="fixed" style="padding-bottom:10px"><h3 style="margin:0">Individuals ' +
      '<span class="badge info">' + rows.length + '</span> ' +
      '<span class="badge lock" id="asLearnerCount">' + rows.length + ' shown</span></h3></div></div>' +
    '<div class="row export-buttons" data-target="#asLearners">' + exportBtnsHtml() + '</div>' +
    '<p class="muted small">Ranked by how much of the programme each person has covered.</p>' +
    '<div id="asLearners">';
  if (!rows.length) return h + '<p class="muted">No learners in this scope.</p></div></div>';
  h += '<div class="table-wrap"><table><thead><tr><th>#</th><th>Learner</th><th>Covered</th><th>Level</th>' +
    '<th>Submissions</th><th>Certificates</th><th>Key words</th><th>Accuracy</th><th>Flagged</th>' +
    '<th>Last active</th></tr></thead><tbody>';
  rows.forEach(function (l, i) {
    h += '<tr data-search="' + esc(searchText(l)) + '">' +
      '<td><b>' + (i + 1) + '</b></td>' +
      '<td><b>' + esc(l.name) + '</b><div class="small muted">' +
        esc([l.className, l.studentNumber].filter(Boolean).join(' · ')) + '</div></td>' +
      '<td style="min-width:130px"><b>' + (l.progress || 0) + '%</b>' + bar(l.progress || 0) + '</td>' +
      '<td class="small">' + esc(l.level || '—') + '<div class="muted">' +
        (l.modulesCompleted || 0) + '/' + (l.moduleCount || 0) + ' modules</div></td>' +
      '<td>' + (l.submissions || 0) + '</td>' +
      '<td>' + (l.certificates || 0) + '</td>' +
      '<td>' + (l.keywordCoverage == null ? '—' : l.keywordCoverage + '%') + '</td>' +
      '<td>' + (l.objectiveAccuracy == null ? '—' : l.objectiveAccuracy + '%') + '</td>' +
      '<td>' + (l.flagged ? '<span class="badge off">' + l.flagged + '</span>' : '<span class="badge ok">0</span>') + '</td>' +
      '<td class="small">' + (l.lastActiveAt ? fmtDate(l.lastActiveAt) : '<span class="muted">never</span>') + '</td></tr>';
  });
  return h + '</tbody></table></div></div></div>';
}
function astatModulesHtml(d) {
  const mods = d.modules || [];
  if (!mods.length) return '';
  let h = '<div class="card"><h3>Module / book / chapter analysis</h3>' +
    '<p class="muted small">How far the people in this account got with every part of the programme.</p>';
  mods.forEach(function (m, mi) {
    h += '<details class="exp"' + (mi === 0 ? ' open' : '') + '><summary><b>' + esc(m.title) + '</b> — ' +
      esc(String(m.mode || '').toUpperCase()) + ' · started ' + (m.started || 0) + '/' + (m.participants || 0) +
      ' · completed ' + (m.completed || 0) + ' (' + (m.completionRate || 0) + '%)</summary>' +
      '<div class="small muted" style="margin:8px 0">Average progress <b>' + (m.avgProgress || 0) + '%</b> · ' +
      (m.submissions || 0) + ' submissions · key words ' +
      (m.keywordCoverage == null ? '—' : m.keywordCoverage + '%') + ' · objectives ' +
      (m.objectiveAccuracy == null ? '—' : m.objectiveAccuracy + '%') + ' · flagged ' + (m.flagged || 0) + '</div>';
    (m.books || []).forEach(function (b) {
      h += '<div class="chap"><div class="q">Book ' + (b.order == null ? '' : b.order) + ': ' + esc(b.title) +
        ' <span class="muted small">· ' + (b.submissions || 0) + ' submissions</span></div>';
      if (!(b.chapters || []).length) { h += '<p class="muted small">No chapters yet.</p></div>'; return; }
      h += '<div class="table-wrap"><table><thead><tr><th>Chapter</th><th>Pages</th><th>Learners</th>' +
        '<th>Completed</th><th>Submissions</th><th>Key words</th><th>Accuracy</th><th>Flagged</th></tr></thead><tbody>';
      (b.chapters || []).forEach(function (c) {
        const pages = (c.pageStart || c.pageEnd) ? (c.pageStart || '—') + '–' + (c.pageEnd || '—') : '—';
        h += '<tr><td>' + esc(c.title) + '</td><td class="small">' + esc(String(pages)) + '</td>' +
          '<td>' + (c.learners || 0) + '</td><td>' + (c.completed || 0) + '</td><td>' + (c.submissions || 0) + '</td>' +
          '<td>' + (c.keywordCoverage == null ? '—' : c.keywordCoverage + '%') + '</td>' +
          '<td>' + (c.accuracy == null ? '—' : c.accuracy + '%') + '</td>' +
          '<td>' + (c.flagged ? '<span class="badge off">' + c.flagged + '</span>' : '<span class="badge ok">0</span>') +
          '</td></tr>';
      });
      h += '</tbody></table></div></div>';
    });
    h += '</details>';
  });
  return h + '</div>';
}

function astatFlagsHtml(d) {
  const rows = d.flagged || [];
  let h = '<div class="card"><h3>Copy flags' +
    (rows.length ? ' <span class="badge off">' + rows.length + '</span>' : '') + '</h3>' +
    '<p class="muted small">Every submission flagged for similarity, the learner it belongs to, and ' +
    'the person whose work it matched.</p>';
  if (!rows.length) return h + '<p class="muted">No copy flags — every submission so far is original work.</p></div>';
  h += '<div class="row export-buttons" data-target="#asFlags">' + exportBtnsHtml() + '</div>' +
    '<div id="asFlags"><div class="table-wrap"><table><thead><tr><th>Learner</th><th>Class</th><th>Work</th>' +
    '<th>Similarity</th><th>Matched with</th><th>Their class</th><th>Date</th></tr></thead><tbody>';
  rows.forEach(function (f) {
    const m = f.matchedWith || {};
    h += '<tr data-search="' + esc(searchText(f)) + '">' +
      '<td><b>' + esc(f.userName || '—') + '</b></td>' +
      '<td class="small">' + esc(f.className || '—') + '</td>' +
      '<td class="small">' + typeBadge(f.type) + '<div class="muted">' +
        esc(f.chapter || f.book || f.label || '—') + '</div></td>' +
      '<td><span class="flag">' + (f.similarity || 0) + '%</span></td>' +
      '<td><b>' + esc(m.name || f.matchedName || '—') + '</b>' +
        (m.studentNumber ? '<div class="small muted">' + esc(m.studentNumber) + '</div>' : '') + '</td>' +
      '<td class="small">' + esc(m.className || '—') + '</td>' +
      '<td class="small">' + fmtDate(f.createdAt) + '</td></tr>';
  });
  return h + '</tbody></table></div></div></div>';
}
async function renderAnalytics() {
  const el = sec('analytics');
  el.innerHTML = '<div class="card"><p class="muted">Loading analytics…</p></div>';
  let d;
  try { d = await API.get('/admin/analytics' + astatQuery()); }
  catch (e) {
    el.innerHTML = '<div class="card"><p class="muted">Could not load analytics: ' + esc(msg(e)) + '</p></div>';
    toast(msg(e), 'err');
    return;
  }
  ASTAT.data = d;
  el.innerHTML = '<h2><span class="motto">Be True</span>Analytics &amp; impact</h2>' +
    astatFiltersHtml(d) + astatKpisHtml(d) + astatChartsHtml(d) +
    astatLearnersHtml(d) + astatModulesHtml(d) + astatFlagsHtml(d);
  wireAstats(el);
}
function wireAstats(el) {
  const ap = document.getElementById('asApply');
  if (ap) {
    ap.onclick = function () {
      const m = document.getElementById('asModule');
      const w = document.getElementById('asWeeks');
      ASTAT.moduleId = m ? m.value : '';
      ASTAT.weeks = Number(w ? w.value : 12) || 12;
      renderAnalytics();
    };
  }
  const rs = document.getElementById('asReset');
  if (rs) rs.onclick = function () { ASTAT.moduleId = ''; ASTAT.weeks = 12; renderAnalytics(); };
  const s = document.getElementById('asLearnerSearch');
  const table = el.querySelector('#asLearners table');
  if (s && table) {
    s.addEventListener('input', function () {
      applyTableSearch(table, s, document.getElementById('asLearnerCount'));
    });
    applyTableSearch(table, s, document.getElementById('asLearnerCount'));
  }
}

/* =============================================================== wiring ==== */
RENDER.dashboard = renderDashboard;
RENDER.users = renderUsers;
RENDER.supervisors = renderSupervisors;
RENDER.library = renderLibrary;
RENDER.books = renderBooks;
RENDER.submissions = renderSubmissions;
RENDER.certificates = renderCertificates;
RENDER.progress = renderProgress;
RENDER.analytics = renderAnalytics;
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
  applyThemeColor(ME.branding.themeColor);
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















