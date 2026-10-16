/* Super Admin console for the Character Building Program (/super page).
   Depends on common.js: API, esc, fmtDate, toast, fileToDataUrl, fileToBase64, requireSession. */

const S = {
  view: 'dashboard',
  portals: null, tenants: null, modules: null, library: null, videos: null,
  books: [], bookModuleId: '',
  users: [], usersTenant: '', usersSearch: '',
  editPortalId: null, editTenantId: null, editModuleId: null, editLibraryId: null,
  editChapterId: null,
  rpFlagged: false, rpType: '', rpSearch: '',
  settings: {}
};

function $(id) { return document.getElementById(id); }
function val(id) { const el = $(id); return el ? String(el.value).trim() : ''; }
function loadMsg() { return '<div class="muted">Loading…</div>'; }
function errBox(e) {
  return '<div class="closed-banner">' + esc(e.message || 'Something went wrong') + '</div>';
}
function fail(e) {
  toast(e.message || 'Request failed', 'err');
  if (e && e.status === 401) showLogin();
}
function activeBadge(on, yes, no) {
  return on ? '<span class="badge ok">' + esc(yes || 'ACTIVE') + '</span>'
    : '<span class="badge off">' + esc(no || 'CLOSED') + '</span>';
}
function roleBadge(role) {
  const r = String(role || '');
  const cls = r === 'tenant_admin' ? 'info' : r === 'supervisor' ? 'ok'
    : r === 'teacher' ? 'warn' : r === 'super' ? 'ok' : 'lock';
  return '<span class="badge ' + cls + '">' + esc(r || '—') + '</span>';
}
function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60);
}
function num(n) { return esc(String(n == null || n === '' ? 0 : n)); }
function intOr(v, fallback) {
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}
/* Image inputs (logos) → data URL, max 1.5 MB. */
async function logoDataUrl(input) {
  const f = input.files[0];
  if (!f) return null;
  if (f.size > 1500000) throw new Error('Image too large (max 1.5 MB)');
  return await fileToDataUrl(f);
}
/* Any file input → {name, base64} payload, max 40 MB. */
async function filePayload(input) {
  const f = input.files[0];
  if (!f) return null;
  if (f.size > 40 * 1024 * 1024) throw new Error('File too large (max 40MB)');
  return { name: f.name, base64: await fileToBase64(f) };
}
/* Fetch-once caches shared between views. */
async function ensure(key, path, mapKey) {
  if (S[key]) return S[key];
  const d = await API.get(path);
  S[key] = d[mapKey] || [];
  return S[key];
}
function drop(key) { S[key] = null; }
/* ==================================================== session / views ==== */
function showLogin() {
  $('appView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
}
function showApp() {
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
}

const RENDERERS = {
  dashboard: renderDashboard, portals: renderPortals, accounts: renderAccounts,
  modules: renderModules, library: renderLibrary, books: renderBooks,
  users: renderUsers, reports: renderReports, progress: renderProgress,
  analytics: renderAnalytics, settings: renderSettings
};

function showView(name) {
  if (!RENDERERS[name]) name = 'dashboard';
  S.view = name;
  const btns = document.querySelectorAll('.side .nav-btn');
  for (let i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].dataset.view === name);
  }
  const secs = document.querySelectorAll('.main section');
  for (let i = 0; i < secs.length; i++) {
    secs[i].classList.toggle('hidden', secs[i].id !== 'view-' + name);
  }
  RENDERERS[name]();
}
function reloadView() { RENDERERS[S.view](); }

async function init() {
  if (!API.token()) { showLogin(); return; }
  try {
    const me = await requireSession(['super']);
    startApp(me.user);
  } catch (e) {
    API.setToken(null); API.setUser(null); showLogin();
  }
}
function startApp(user) {
  showApp();
  $('whoName').textContent = (user && (user.fullName || user.username)) || 'Super admin';
  showView(S.view);
}
/* ======================================================= dashboard ======= */
async function renderDashboard() {
  const v = $('view-dashboard');
  v.innerHTML = loadMsg();
  let d;
  try { d = await API.get('/super/overview'); }
  catch (e) { v.innerHTML = errBox(e); return; }
  const c = d.counts || {};
  const cards = [
    ['Portals', c.portals, 'blue'], ['Tenants', c.tenants, 'teal'], ['Users', c.users, 'violet'],
    ['Submissions', c.submissions, 'green'], ['Certificates', c.certificates, 'pink'],
    ['Flagged', c.flagged, 'red'], ['Modules', c.modules, 'amber'], ['Library items', c.library, 'slate']
  ].map(function (x) {
    return '<div class="stat tone-' + x[2] + '"><div class="n">' + num(x[1]) + '</div>' +
      '<div class="l">' + esc(x[0]) + '</div></div>';
  }).join('');
  const ts = d.tenants || [];
  const byType = {};
  ts.forEach(function (t) { const k = t.type || 'custom'; byType[k] = (byType[k] || 0) + 1; });
  const charts = '<div class="card"><h3>Statistics</h3><div class="chart-grid">' +
    '<div class="chart-box"><h4>Users per account</h4>' +
      chartBarsH(ts.map(function (t) { return { label: t.name, value: Number(t.users) || 0, color: '#2f6fd0' }; })) + '</div>' +
    '<div class="chart-box"><h4>Submissions per account</h4>' +
      chartBarsH(ts.map(function (t) { return { label: t.name, value: Number(t.submissions) || 0, color: '#6d3fd1' }; })) + '</div>' +
    '<div class="chart-box"><h4>Accounts per portal</h4>' +
      chartBars(Object.keys(byType).map(function (k) { return { label: k, value: byType[k] }; })) + '</div>' +
    '<div class="chart-box"><h4>Copy check (all accounts)</h4>' +
      chartDonut([
        { label: 'Original work', value: Math.max(0, (Number(c.submissions) || 0) - (Number(c.flagged) || 0)), color: '#1f7a44' },
        { label: 'Flagged', value: Number(c.flagged) || 0, color: '#c62828' }
      ], { centerLabel: 'submissions' }) + '</div>' +
  '</div></div>';
  let rows = '<tr><td colspan="7" class="muted">No tenants yet.</td></tr>';
  if (ts.length) {
    rows = ts.map(function (t) {
      const flagged = Number(t.flagged) || 0;
      return '<tr><td><b>' + esc(t.name) + '</b>' +
        '<div class="muted small mono">' + esc(t.slug || '') + '</div></td>' +
        '<td>' + esc(t.type || '—') + '</td>' +
        '<td>' + num(t.users) + '</td>' +
        '<td>' + num(t.submissions) + '</td>' +
        '<td>' + num(t.certificates) + '</td>' +
        '<td>' + (flagged
          ? '<span class="badge off">' + flagged + '</span>'
          : '<span class="badge ok">0</span>') + '</td>' +
        '<td>' + activeBadge(t.active !== false) + '</td></tr>';
    }).join('');
  }
  v.innerHTML = '<h2><span class="motto">Be True</span>Dashboard</h2>' +
    '<div class="grid cols-4">' + cards + '</div>' +
    charts +
    '<div class="card mt"><h3>Tenants overview</h3><table><thead><tr>' +
    '<th>Tenant</th><th>Type</th><th>Users</th><th>Submissions</th>' +
    '<th>Certificates</th><th>Flagged</th><th>Status</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}
/* ==================================================== analytics & impact === */
/* Reports the super admin asked for: performance of every portal, account and
   individual, plus the statistical picture of the impact — down to module, book,
   chapter and question level, with the weekly activity behind it. */
const ANALYTICS = { data: null, portalId: '', tenantId: '', moduleId: '', weeks: 12 };

function analyticsQuery() {
  const q = [];
  if (ANALYTICS.portalId) q.push('portalId=' + encodeURIComponent(ANALYTICS.portalId));
  if (ANALYTICS.tenantId) q.push('tenantId=' + encodeURIComponent(ANALYTICS.tenantId));
  if (ANALYTICS.moduleId) q.push('moduleId=' + encodeURIComponent(ANALYTICS.moduleId));
  q.push('weeks=' + encodeURIComponent(ANALYTICS.weeks || 12));
  return '?' + q.join('&');
}
function analyticsOption(value, label, selected) {
  return '<option value="' + esc(value) + '"' + (String(value) === String(selected) ? ' selected' : '') +
    '>' + esc(label) + '</option>';
}
function analyticsFiltersHtml(d) {
  const f = d.filters || {};
  const portals = f.portals || [];
  const tenants = (f.tenants || []).filter(t => !ANALYTICS.portalId || String(t.portalId) === String(ANALYTICS.portalId));
  const mods = f.modules || [];
  const weekOpts = [4, 8, 12, 26, 52];
  return '<div class="card"><div class="row" style="align-items:flex-end">' +
    '<div><label>Portal</label><select id="anPortal">' + analyticsOption('', 'All portals', ANALYTICS.portalId) +
      portals.map(p => analyticsOption(p.id, p.name, ANALYTICS.portalId)).join('') + '</select></div>' +
    '<div><label>Account</label><select id="anTenant">' + analyticsOption('', 'All accounts', ANALYTICS.tenantId) +
      tenants.map(t => analyticsOption(t.id, t.name, ANALYTICS.tenantId)).join('') + '</select></div>' +
    '<div><label>Module</label><select id="anModule">' + analyticsOption('', 'All modules', ANALYTICS.moduleId) +
      mods.map(m => analyticsOption(m.id, m.title, ANALYTICS.moduleId)).join('') + '</select></div>' +
    '<div><label>Period</label><select id="anWeeks">' +
      weekOpts.map(w => analyticsOption(w, 'last ' + w + ' weeks', ANALYTICS.weeks)).join('') + '</select></div>' +
    '<div class="fixed" style="padding-bottom:10px">' +
      '<button type="button" id="anApply">Apply</button> ' +
      '<button type="button" class="ghost" id="anReset">Reset</button></div>' +
  '</div>' +
  '<p class="muted small" style="margin-bottom:0">Impact of the exercise across every portal, account, module, ' +
    'book, chapter and learner. Generated ' + esc(fmtDate(d.generatedAt)) + '.</p></div>';
}
function kpi(label, value, tone, note) {
  return '<div class="stat tone-' + tone + '"><div class="n">' + esc(String(value)) + '</div>' +
    '<div class="l">' + esc(label) + '</div>' +
    (note ? '<div class="small" style="opacity:.75;margin-top:2px">' + esc(note) + '</div>' : '') + '</div>';
}
function analyticsKpisHtml(d) {
  const i = d.impact || {};
  const t = d.totals || {};
  return '<div class="grid cols-4">' +
    kpi('Participants', i.participants == null ? 0 : i.participants, 'blue',
      t.staff + ' staff in ' + t.accounts + ' accounts') +
    kpi('Involvement', (i.involvementRate == null ? 0 : i.involvementRate) + '%', 'violet',
      (i.involved || 0) + ' of ' + (i.participants || 0) + ' have submitted work') +
    kpi('Completion', (i.completionRate == null ? 0 : i.completionRate) + '%', 'green',
      (i.finished || 0) + ' finished every module') +
    kpi('Certificates', i.certificates == null ? 0 : i.certificates, 'pink',
      (i.certificatesPerLearner == null ? 0 : i.certificatesPerLearner) + ' per learner') +
    kpi('Average progress', (i.avgProgress == null ? 0 : i.avgProgress) + '%', 'teal',
      (i.submissionsPerLearner == null ? 0 : i.submissionsPerLearner) + ' submissions per learner') +
    kpi('Key-word coverage', i.keywordCoverage == null ? '—' : i.keywordCoverage + '%', 'amber',
      (i.chaptersDone || 0) + ' typed chapter answers') +
    kpi('Objective accuracy', i.objectiveAccuracy == null ? '—' : i.objectiveAccuracy + '%', 'slate',
      (i.objectivesAnswered || 0) + ' objectives answered') +
    kpi('Original work', (i.integrity == null ? 100 : i.integrity) + '%', 'red',
      (i.flaggedRate == null ? 0 : i.flaggedRate) + '% of submissions flagged') +
  '</div>';
}

/* Same ranking as the account console, but across every account. */
/* ==================================================== analytics charts ==== */
function analyticsChartsHtml(d) {
  const act = d.activity || [];
  const portals = d.portals || [];
  const accounts = (d.accounts || []).slice().sort((a, b) => b.submissions - a.submissions);
  const learners = d.learners || [];
  const i = d.impact || {};
  const weeks = act.map(a => ({ label: a.label, value: a.submissions, value2: a.certificates }));
  const newActive = act.map(a => ({ label: a.label, value: a.newUsers }));
  const bands = [
    { label: 'Finished all modules', value: learners.filter(l => l.finished).length, color: '#1f7a44' },
    { label: '75% or more', value: learners.filter(l => !l.finished && l.progress >= 75).length, color: '#2f6fd0' },
    { label: '25 – 74%', value: learners.filter(l => l.progress >= 25 && l.progress < 75).length, color: '#b45309' },
    { label: 'Under 25%', value: learners.filter(l => l.progress < 25).length, color: '#c62828' }
  ];
  const modBars = [];
  (d.modules || []).forEach(m => {
    const short = String(m.title).replace(/^MODULE\s+\w+\s*[—-]\s*/i, '').slice(0, 14);
    modBars.push({ label: short + ' started', value: m.started, color: '#2f6fd0' });
    modBars.push({ label: short + ' completed', value: m.completed, color: '#1f7a44' });
  });
  const chapterItems = [];
  const sel = ANALYTICS.moduleId ? (d.modules || []) : (d.modules || []).slice(0, 1);
  sel.forEach(m => {
    (m.books || []).forEach(b => {
      (b.chapters || []).forEach(c => {
        chapterItems.push({
          label: String(c.title).replace(/^Chapter\s*\d+\s*[—-]\s*/i, '').slice(0, 18),
          value: c.completed || 0
        });
      });
    });
  });
  return '<div class="card"><h3>Graphical analysis</h3><div class="chart-grid">' +
    '<div class="chart-box"><h4>Weekly activity</h4>' +
      chartLine(weeks, { second: true, caption: 'Submissions (solid) and certificates (dashed)' }) + '</div>' +
    '<div class="chart-box"><h4>New learners per week</h4>' + chartBars(newActive) + '</div>' +
    '<div class="chart-box"><h4>Participants per portal</h4>' +
      chartBarsH(portals.map(p => ({ label: p.name, value: p.participants, color: '#2f6fd0' }))) + '</div>' +
    '<div class="chart-box"><h4>Completion per portal</h4>' +
      chartBars(portals.map(p => ({ label: String(p.name).slice(0, 10), value: p.completionRate }))) +
      chartBarsH(portals.map(p => ({ label: p.name, value: p.involved, color: '#6d3fd1' })),
        { caption: 'Learners who have submitted work' }) + '</div>' +
    '<div class="chart-box"><h4>Progress distribution</h4>' +
      chartDonut(bands, { centerLabel: 'learners' }) + '</div>' +
    '<div class="chart-box"><h4>Submissions per account</h4>' +
      chartBarsH(accounts.slice(0, 10).map(a => ({ label: a.name, value: a.submissions, color: '#0f766e' }))) + '</div>' +
    '<div class="chart-box"><h4>Key-word coverage per account</h4>' +
      chartBarsH(accounts.map(a => ({ label: a.name, value: a.keywordCoverage == null ? 0 : a.keywordCoverage, color: '#b45309' }))) + '</div>' +
    '<div class="chart-box"><h4>Copy check per account</h4>' +
      chartBarsH(accounts.map(a => ({ label: a.name, value: a.flagged, color: '#c62828' }))) + '</div>' +
    '<div class="chart-box"><h4>Module funnel</h4>' + chartBarsH(modBars) + '</div>' +
    '<div class="chart-box"><h4>Chapter completions' + (ANALYTICS.moduleId ? '' : ' (first module)') + '</h4>' +
      chartBarsH(chapterItems, { max: 14, caption: 'Learners who completed each chapter' }) + '</div>' +
    '<div class="chart-box"><h4>Impact indices</h4>' +
      chartProgress([
        { label: 'Involvement', percent: i.involvementRate || 0, color: '#6d3fd1' },
        { label: 'Completion', percent: i.completionRate || 0, color: '#1f7a44' },
        { label: 'Active (14 days)', percent: i.activeShare || 0, color: '#2f6fd0' },
        { label: 'Key words', percent: i.keywordCoverage || 0, color: '#b45309' },
        { label: 'Objectives', percent: i.objectiveAccuracy || 0, color: '#475569' },
        { label: 'Original work', percent: i.integrity == null ? 100 : i.integrity, color: '#b8217a' }
      ]) + '</div>' +
  '</div></div>';
}

/* ==================================================== analytics tables ==== */
function exportBtns(target) {
  return '<button type="button" class="ghost" data-export="print">Print</button>' +
    '<button type="button" class="ghost" data-export="pdf">PDF</button>' +
    '<button type="button" class="ghost" data-export="excel">Excel</button>' +
    '<button type="button" class="ghost" data-export="word">Word</button>';
}
function accountsTableHtml(rows) {
  let h = '<div class="table-wrap"><table><thead><tr><th>Account</th><th>Portal</th><th>Learners</th>' +
    '<th>Active</th><th>Submissions</th><th>Certificates</th><th>Completion</th><th>Covered</th>' +
    '<th>Key words</th><th>Accuracy</th><th>Flagged</th><th>Last activity</th></tr></thead><tbody>';
  rows.forEach(a => {
    h += '<tr data-search="' + esc(searchText(a)) + '">' +
      '<td><b>' + esc(a.name) + '</b><div class="small muted">' + esc(a.slug || '') + ' · ' + esc(a.type || '') + '</div></td>' +
      '<td class="small">' + esc(a.portalName || '—') + '</td>' +
      '<td>' + num(a.participants) + '</td>' +
      '<td>' + num(a.involved) + '</td>' +
      '<td>' + num(a.submissions) + '</td>' +
      '<td>' + num(a.certificates) + '</td>' +
      '<td style="min-width:120px"><b>' + num(a.completionRate) + '%</b>' + supBar(a.completionRate || 0) + '</td>' +
      '<td>' + (a.avgProgress == null ? '—' : num(a.avgProgress) + '%') + '</td>' +
      '<td>' + (a.keywordCoverage == null ? '—' : num(a.keywordCoverage) + '%') + '</td>' +
      '<td>' + (a.objectiveAccuracy == null ? '—' : num(a.objectiveAccuracy) + '%') + '</td>' +
      '<td>' + (a.flagged ? '<span class="badge off">' + num(a.flagged) + '</span>' : '<span class="badge ok">0</span>') + '</td>' +
      '<td class="small">' + (a.lastActivity ? fmtDate(a.lastActivity) : '<span class="muted">never</span>') + '</td></tr>';
  });
  return h + '</tbody></table></div>';
}
function analyticsAccountsCard(d) {
  const rows = (d.accounts || []).slice().sort((a, b) => (b.avgProgress || 0) - (a.avgProgress || 0) ||
    b.submissions - a.submissions);
  return '<div class="card"><div class="row" style="align-items:flex-end">' +
    '<div style="min-width:200px"><label>Search accounts</label>' +
      '<input type="text" id="anAccSearch" placeholder="Account, portal, type…"></div>' +
    '<div class="fixed" style="padding-bottom:10px"><h3 style="margin:0">Accounts <span class="badge info">' +
      rows.length + '</span></h3></div></div>' +
    '<div class="row export-buttons" data-target="#anAccounts">' + exportBtns() + '</div>' +
    '<div id="anAccounts">' + (rows.length ? accountsTableHtml(rows) : '<p class="muted">No accounts in this scope.</p>') +
    '</div></div>';
}
function analyticsModulesCard(d) {
  const mods = d.modules || [];
  if (!mods.length) return '';
  let h = '<div class="card"><h3>Module / book / chapter analysis</h3>' +
    '<p class="muted small">Every level of the exercise: how many learners started and finished each part, ' +
    'submissions, key-word coverage, objective accuracy and copy flags.</p>';
  mods.forEach((m, mi) => {
    h += '<details class="exp"' + (mi === 0 ? ' open' : '') + '><summary><b>' + esc(m.title) + '</b> — ' +
      esc(String(m.mode || '').toUpperCase()) + ' · started ' + num(m.started) + '/' + num(m.participants) +
      ' · completed ' + num(m.completed) + ' (' + num(m.completionRate) + '%)</summary>' +
      '<div class="small muted" style="margin:8px 0">Average progress <b>' + num(m.avgProgress) + '%</b> · ' +
      num(m.submissions) + ' submissions · key words ' +
      (m.keywordCoverage == null ? '—' : num(m.keywordCoverage) + '%') + ' · objectives ' +
      (m.objectiveAccuracy == null ? '—' : num(m.objectiveAccuracy) + '%') + ' · flagged ' + num(m.flagged) +
      (m.certificateName ? ' · certificate: ' + esc(m.certificateName) : '') + '</div>';
    (m.books || []).forEach(b => {
      h += '<div class="chap"><div class="q">Book ' + num(b.order) + ': ' + esc(b.title) +
        ' <span class="muted small">· ' + num(b.submissions) + ' submissions</span></div>';
      if (!(b.chapters || []).length) {
        h += '<p class="muted small">No chapters yet.</p></div>';
        return;
      }
      h += '<div class="table-wrap"><table><thead><tr><th>Chapter</th><th>Pages</th><th>Learners</th>' +
        '<th>Completed</th><th>Submissions</th><th>Key words</th><th>Accuracy</th><th>Flagged</th>' +
        '</tr></thead><tbody>';
      (b.chapters || []).forEach(c => {
        const pages = (c.pageStart || c.pageEnd) ? (c.pageStart || '—') + '–' + (c.pageEnd || '—') : '—';
        h += '<tr><td>' + esc(c.title) + '</td><td class="small">' + esc(String(pages)) + '</td>' +
          '<td>' + num(c.learners) + '</td><td>' + num(c.completed) + '</td><td>' + num(c.submissions) + '</td>' +
          '<td>' + (c.keywordCoverage == null ? '—' : num(c.keywordCoverage) + '%') + '</td>' +
          '<td>' + (c.accuracy == null ? '—' : num(c.accuracy) + '%') + '</td>' +
          '<td>' + (c.flagged ? '<span class="badge off">' + num(c.flagged) + '</span>' : '<span class="badge ok">0</span>') +
          '</td></tr>';
      });
      h += '</tbody></table></div></div>';
    });
    h += '</details>';
  });
  return h + '</div>';
}

function learnersTableHtml(rows) {
  let h = '<div class="table-wrap"><table><thead><tr><th>#</th><th>Learner</th><th>Account</th>' +
    '<th>Covered</th><th>Level</th><th>Modules</th><th>Submissions</th><th>Certificates</th>' +
    '<th>Key words</th><th>Accuracy</th><th>Flagged</th><th>Last active</th></tr></thead><tbody>';
  rows.forEach((l, i) => {
    h += '<tr data-search="' + esc(searchText(l)) + '">' +
      '<td><b>' + (i + 1) + '</b></td>' +
      '<td><b>' + esc(l.name) + '</b><div class="small muted">' +
        esc([l.className, l.studentNumber].filter(Boolean).join(' · ')) + '</div></td>' +
      '<td class="small">' + esc(l.account || '—') + '<div class="muted">' + esc(l.portal || '') + '</div></td>' +
      '<td style="min-width:120px"><b>' + num(l.progress) + '%</b>' + supBar(l.progress || 0) + '</td>' +
      '<td class="small">' + esc(l.level || '—') + '<div class="muted">' +
        num(l.modulesCompleted) + '/' + num(l.moduleCount) + ' modules</div></td>' +
      '<td>' + num(l.modulesCompleted) + '</td>' +
      '<td>' + num(l.submissions) + '</td>' +
      '<td>' + num(l.certificates) + '</td>' +
      '<td>' + (l.keywordCoverage == null ? '—' : num(l.keywordCoverage) + '%') + '</td>' +
      '<td>' + (l.objectiveAccuracy == null ? '—' : num(l.objectiveAccuracy) + '%') + '</td>' +
      '<td>' + (l.flagged ? '<span class="badge off">' + num(l.flagged) + '</span>' : '<span class="badge ok">0</span>') + '</td>' +
      '<td class="small">' + (l.lastActiveAt ? fmtDate(l.lastActiveAt) : '<span class="muted">never</span>') + '</td></tr>';
  });
  return h + '</tbody></table></div>';
}
function analyticsLearnersCard(d) {
  const rows = d.learners || [];
  return '<div class="card"><div class="row" style="align-items:flex-end">' +
    '<div style="min-width:220px"><label>Search learners</label>' +
      '<input type="text" id="anLearnerSearch" placeholder="Name, account, class, level…"></div>' +
    '<div class="fixed" style="padding-bottom:10px"><h3 style="margin:0">Individuals ' +
      '<span class="badge info">' + num(d.learnersTotal) + '</span> ' +
      '<span class="badge lock" id="anLearnerCount">' + rows.length + ' shown</span></h3></div></div>' +
    '<div class="row export-buttons" data-target="#anLearners">' + exportBtns() + '</div>' +
    '<p class="muted small">Ranked by how much of the programme each learner has covered — the smallest ' +
      'point of the impact analysis.</p>' +
    '<div id="anLearners">' + (rows.length ? learnersTableHtml(rows) : '<p class="muted">No learners in this scope.</p>') +
    '</div></div>';
}

async function renderAnalytics() {
  const v = $('view-analytics');
  v.innerHTML = loadMsg();
  let d;
  try { d = await API.get('/super/analytics' + analyticsQuery()); }
  catch (e) {
    if (isStaleServerError(e)) {
      const info = await deploymentInfo();
      v.innerHTML = '<h2><span class="motto">Be True</span>Analytics &amp; impact</h2>' +
        deploymentNoticeHtml(info) +
        '<div class="card"><p class="muted small">Restart the backend, then reload — the portfolio ' +
        'analytics will appear here.</p>' +
        '<p><button type="button" class="ghost" id="anRetry">Try again</button></p></div>';
      const rt = document.getElementById('anRetry');
      if (rt) rt.onclick = renderAnalytics;
      return;
    }
    v.innerHTML = errBox(e);
    return;
  }
  ANALYTICS.data = d;
  v.innerHTML = '<h2><span class="motto">Be True</span>Analytics &amp; impact</h2>' +
    analyticsFiltersHtml(d) +
    analyticsKpisHtml(d) +
    analyticsChartsHtml(d) +
    analyticsAccountsCard(d) +
    analyticsModulesCard(d) +
    analyticsLearnersCard(d);
  wireAnalytics();
}
function wireAnalytics() {
  const portal = $('anPortal');
  if (portal) {
    portal.onchange = function () {
      ANALYTICS.portalId = val('anPortal');
      ANALYTICS.tenantId = '';
      renderAnalytics();
    };
  }
  if ($('anApply')) {
    $('anApply').onclick = function () {
      ANALYTICS.portalId = val('anPortal');
      ANALYTICS.tenantId = val('anTenant');
      ANALYTICS.moduleId = val('anModule');
      ANALYTICS.weeks = Number(val('anWeeks')) || 12;
      renderAnalytics();
    };
  }
  if ($('anReset')) {
    $('anReset').onclick = function () {
      ANALYTICS.portalId = ''; ANALYTICS.tenantId = ''; ANALYTICS.moduleId = ''; ANALYTICS.weeks = 12;
      renderAnalytics();
    };
  }
  const acc = $('anAccSearch');
  if (acc) {
    acc.addEventListener('input', function () { applyTableSearch('anAccounts', 'anAccSearch'); });
    applyTableSearch('anAccounts', 'anAccSearch');
  }
  const lrn = $('anLearnerSearch');
  if (lrn) {
    lrn.addEventListener('input', function () {
      applyTableSearch('anLearners', 'anLearnerSearch');
      const badge = $('anLearnerCount');
      if (badge) {
        let shown = 0;
        document.querySelectorAll('#anLearners tbody tr[data-search]').forEach(function (tr) {
          if (tr.style.display !== 'none') shown++;
        });
        badge.textContent = shown + ' shown';
      }
    });
    applyTableSearch('anLearners', 'anLearnerSearch');
  }
}

async function renderProgress() {
  const v = $('view-progress');
  v.innerHTML = loadMsg();
  let d;
  try { d = await API.get('/reports/students'); }
  catch (e) { v.innerHTML = errBox(e); return; }
  const list = d.students || [];
  const finished = function (s) { return s.moduleCount > 0 && s.modulesCompleted === s.moduleCount; };
  const byAccount = {};
  list.forEach(function (s) { const k = s.tenantName || '—'; byAccount[k] = (byAccount[k] || 0) + 1; });
  const bands = [
    { label: 'Finished all modules', value: list.filter(finished).length, color: '#1f7a44' },
    { label: '75% or more', value: list.filter(function (s) { return !finished(s) && s.progress >= 75; }).length, color: '#2f6fd0' },
    { label: '25 – 74%', value: list.filter(function (s) { return s.progress >= 25 && s.progress < 75; }).length, color: '#b45309' },
    { label: 'Under 25%', value: list.filter(function (s) { return s.progress < 25; }).length, color: '#c62828' }
  ];
  v.innerHTML = '<h2><span class="motto">Be True</span>Student progress</h2>' +
    '<div class="grid cols-4">' +
      statCardBox(d.count, 'Learners', 'blue') +
      statCardBox(d.average + '%', 'Average coverage', 'violet') +
      statCardBox(d.finished, 'Finished all modules', 'green') +
      statCardBox(d.notStarted, 'Never submitted', 'red') +
    '</div>' +
    '<div class="card"><h3>How learners are progressing</h3><div class="chart-grid">' +
      '<div class="chart-box"><h4>Learners per account</h4>' +
        chartBarsH(Object.keys(byAccount).map(function (k) { return { label: k, value: byAccount[k] }; })) + '</div>' +
      '<div class="chart-box"><h4>Progress bands</h4>' + chartDonut(bands, { centerLabel: 'learners' }) + '</div>' +
      '<div class="chart-box"><h4>Most submissions</h4>' +
        chartBarsH(list.slice(0, 10).map(function (s) {
          return { label: s.fullName + (s.tenantName ? ' (' + s.tenantName + ')' : ''), value: s.submissions, color: '#6d3fd1' }; })) + '</div>' +
      '<div class="chart-box"><h4>Certificates earned</h4>' +
        chartBarsH(list.slice().sort(function (a, b) { return b.certificates - a.certificates; }).slice(0, 10)
          .map(function (s) { return { label: s.fullName, value: s.certificates, color: '#b8217a' }; })) + '</div>' +
    '</div></div>' +
    '<div class="card"><div class="row" style="align-items:flex-end">' +
      '<div style="min-width:220px"><label>Search learners</label>' +
        '<input type="text" id="spSearch" placeholder="Name, account, level…"></div>' +
      '<div class="fixed" style="padding-bottom:10px"><h3 style="margin:0">Ranking ' +
        '<span class="badge info">' + list.length + '</span> ' +
        '<span class="badge lock" id="spCount">' + list.length + ' shown</span></h3></div>' +
    '</div>' +
    '<p class="muted small">Ranked by how much of the programme each learner has covered. ' +
      'A full summary can be opened for learners who finished every module.</p>' +
    '<div id="supProgress">' + supProgressTable(list) + '</div></div>';

  $('spSearch').addEventListener('input', function () {
    applyTableSearch('supProgress', 'spSearch');
    const badge = $('spCount');
    if (badge) {
      let shown = 0;
      document.querySelectorAll('#supProgressTable tbody tr[data-search]').forEach(function (tr) {
        if (tr.style.display !== 'none') shown++;
      });
      badge.textContent = shown + ' shown';
    }
  });
  applyTableSearch('supProgress', 'spSearch');
  v.onclick = function (e) {
    const b = e.target.closest('button[data-sum]');
    if (!b) return;
    const row = document.getElementById('sum-' + b.dataset.sum);
    if (!row) return;
    const nowHidden = row.classList.toggle('hidden');
    b.textContent = nowHidden ? 'Summary' : 'Hide summary';
  };
}
function statCardBox(n, label, tone) {
  return '<div class="stat tone-' + tone + '"><div class="n">' + esc(n == null ? 0 : n) +
    '</div><div class="l">' + esc(label) + '</div></div>';
}
function supProgressTable(list) {
  if (!list.length) return '<p class="muted">No learners yet.</p>';
  let h = '<div class="table-wrap"><table id="supProgressTable"><thead><tr>' +
    '<th>#</th><th>Learner</th><th>Account</th><th>Level (module)</th><th>Covered</th>' +
    '<th>Submissions</th><th>Certificates</th><th>Flagged</th><th>Last active</th><th>Summary</th>' +
    '</tr></thead><tbody>';
  list.forEach(function (s, i) {
    const done = s.moduleCount > 0 && s.modulesCompleted === s.moduleCount;
    const level = s.level || {};
    const ident = [s.email, s.studentNumber].filter(Boolean).map(esc).join(' · ');
    h += '<tr data-search="' + esc(searchText(s)) + '">' +
      '<td><b>' + (i + 1) + '</b></td>' +
      '<td><b>' + esc(s.fullName || '—') + '</b>' +
        (ident ? '<div class="small muted">' + ident + '</div>' : '') + '</td>' +
      '<td class="small">' + esc(s.tenantName || '—') +
        (s.supervisorName ? '<div class="muted">sup. ' + esc(s.supervisorName) + '</div>' : '') + '</td>' +
      '<td class="small"><b>' + esc(level.title || '—') + '</b>' +
        '<div class="muted">' + esc(level.state || '') +
        (s.moduleCount ? ' · ' + s.modulesCompleted + '/' + s.moduleCount + ' modules' : '') + '</div></td>' +
      '<td style="min-width:130px"><b>' + (s.progress || 0) + '%</b>' + supBar(s.progress || 0) + '</td>' +
      '<td>' + (s.submissions || 0) + '</td>' +
      '<td>' + (s.certificates || 0) + '</td>' +
      '<td>' + (s.flagged ? '<span class="badge off">' + s.flagged + '</span>' : '<span class="badge ok">0</span>') + '</td>' +
      '<td class="small">' + (s.lastActiveAt ? fmtDate(s.lastActiveAt) : '<span class="muted">never</span>') + '</td>' +
      '<td>' + (done
        ? '<button type="button" class="small" data-sum="' + esc(s.id) + '">Summary</button>'
        : '<span class="muted small">Not finished yet</span>') + '</td></tr>';
    if (done) h += supSummaryRow(s);
  });
  return h + '</tbody></table></div>';
}
function supBar(p) {
  const v2 = Math.max(0, Math.min(100, Math.round(Number(p) || 0)));
  return '<div class="progress mt" style="height:8px"><i style="width:' + v2 + '%"></i></div>';
}
function supSummaryRow(s) {
  const recent = (s.recent || []).map(function (r) {
    const where = [r.book, r.chapter].filter(Boolean).map(esc).join(' — ') || esc(r.label || '—');
    const status = r.flagged
      ? '<span class="flag">Copied ' + esc(r.similarity) + '%</span>'
      : (r.total ? '<span class="badge ok">' + esc(r.score) + '/' + esc(r.total) + '</span>'
                 : '<span class="badge ok">Submitted</span>');
    return '<tr><td class="small">' + fmtDate(r.createdAt) + '</td><td class="small">' + esc(r.type) + '</td>' +
      '<td class="small">' + where + '</td><td>' + status + '</td></tr>';
  }).join('');
  return '<tr class="sum-row hidden" id="sum-' + esc(s.id) + '"><td colspan="10"><div class="sum-box">' +
    '<div class="chart-grid">' +
      '<div><h4>Programme coverage</h4>' +
        chartProgress((s.modules || []).map(function (m) {
          return { label: m.title, percent: m.percent,
            color: m.status === 'completed' ? '#1f7a44' : (m.status === 'active' ? undefined : '#94a3b8') };
        })) + '</div>' +
      '<div><h4>Totals</h4><div class="grid cols-2">' +
        statCardBox(s.submissions || 0, 'Submissions', 'blue') +
        statCardBox(s.certificates || 0, 'Certificates', 'green') +
        statCardBox((s.progress || 0) + '%', 'Covered', 'violet') +
        statCardBox(s.flagged || 0, 'Copy flags', 'red') +
      '</div><p class="muted small mt">Account: <b>' + esc(s.tenantName || '—') + '</b>' +
        (s.supervisorName ? ' · Supervisor: <b>' + esc(s.supervisorName) + '</b>' : '') +
        ' · Last active: <b>' + (s.lastActiveAt ? fmtDate(s.lastActiveAt) : 'never') + '</b></p></div>' +
    '</div>' +
    '<h4 class="mt">Recent work</h4>' +
    (recent
      ? '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Chapter / book</th>' +
        '<th>Result</th></tr></thead><tbody>' + recent + '</tbody></table></div>'
      : '<p class="muted small">No submissions recorded.</p>') +
  '</div></td></tr>';
}
/* ======================================================== portals ======== */
function winRowHTML(from, to) {
  return '<div class="row win-row" style="align-items:flex-end;margin-bottom:8px">' +
    '<div><label class="muted small" style="margin:0 0 3px">From</label>' +
    '<input type="text" class="win-from" placeholder="MM-DD" value="' + esc(from || '') + '"></div>' +
    '<div><label class="muted small" style="margin:0 0 3px">To</label>' +
    '<input type="text" class="win-to" placeholder="MM-DD" value="' + esc(to || '') + '"></div>' +
    '<div class="fixed"><button type="button" class="small danger" data-act="win-del">Remove</button></div>' +
    '</div>';
}
function portalScheduleCell(p) {
  if (p.scheduleMode === 'always') return '<span class="badge info">OPEN ALL YEAR</span>';
  if (!p.windows || !p.windows.length) {
    return '<span class="badge off">NO DATES — INACTIVE</span>';
  }
  return '<span class="mono small">' +
    p.windows.map(function (w) { return esc(w.from) + ' → ' + esc(w.to); }).join('<br>') + '</span>';
}
async function renderPortals() {
  const v = $('view-portals');
  v.innerHTML = loadMsg();
  try {
    const d = await API.get('/super/portals');
    S.portals = d.portals || [];
  } catch (e) { v.innerHTML = errBox(e); return; }

  const ep = S.editPortalId
    ? S.portals.find(function (p) { return String(p.id) === String(S.editPortalId); })
    : null;
  if (S.editPortalId && !ep) S.editPortalId = null;
  const mode = ep ? (ep.scheduleMode || 'windows') : 'windows';
  const wins = ep && ep.windows && ep.windows.length
    ? ep.windows : [{ from: '', to: '' }];

  const rows = S.portals.length ? S.portals.map(function (p) {
    return '<tr><td><b>' + esc(p.name) + '</b>' +
      '<div class="muted small mono">' + esc(p.key || '') + '</div></td>' +
      '<td>' + esc(p.type || '—') + '</td>' +
      '<td>' + portalScheduleCell(p) + '</td>' +
      '<td>' + activeBadge(!!p.active) + '<br>' +
        (p.enabled ? '<span class="badge ok">ENABLED</span>'
                   : '<span class="badge off">DISABLED</span>') + '</td>' +
      '<td>' + num(p.tenantCount) + '</td>' +
      '<td class="nowrap">' +
        '<button type="button" class="small ghost" data-act="p-edit" data-id="' +
          esc(String(p.id)) + '">Edit</button> ' +
        '<button type="button" class="small danger" data-act="p-del" data-id="' +
          esc(String(p.id)) + '">Delete</button>' +
      '</td></tr>';
  }).join('') : '<tr><td colspan="6" class="muted">No portals yet — create the first one.</td></tr>';

  v.innerHTML = '<h2>Portals</h2>' +
    '<div class="card"><h3>' +
      (ep ? 'Edit portal — ' + esc(ep.name) : 'New portal') + '</h3>' +
    '<form id="portalForm">' +
      '<div class="row">' +
        '<div><label>Name *</label><input type="text" id="pfName" required value="' +
          esc(ep ? ep.name : '') + '"></div>' +
        '<div><label>Key</label><input type="text" id="pfKey" placeholder="auto from name" value="' +
          esc(ep && ep.key ? ep.key : '') + '"></div>' +
        '<div><label>Type</label><input type="text" id="pfType" placeholder="schools / organization" value="' +
          esc(ep && ep.type ? ep.type : '') + '"></div>' +
      '</div>' +
      '<div class="row">' +
        '<div><label>Schedule mode</label><select id="pfMode">' +
          '<option value="windows"' + (mode === 'windows' ? ' selected' : '') + '>Date windows</option>' +
          '<option value="always"' + (mode === 'always' ? ' selected' : '') + '>Always open</option>' +
        '</select></div>' +
        '<div class="fixed" style="align-self:flex-end;padding-bottom:11px">' +
          '<label style="margin:0"><input type="checkbox" id="pfEnabled"' +
            (!ep || ep.enabled ? ' checked' : '') + '> Enabled</label>' +
        '</div>' +
      '</div>' +
      '<div id="pfWinsWrap"' + (mode === 'always' ? ' class="hidden"' : '') + '>' +
        '<label>Schedule windows (MM-DD)</label>' +
        '<div id="pfWins">' +
          wins.map(function (w) { return winRowHTML(w.from, w.to); }).join('') +
        '</div>' +
        '<button type="button" class="ghost small" data-act="p-add-win">+ Add window</button>' +
        '<p class="muted small" style="margin-top:8px;margin-bottom:0">' +
          'Schools default: <b>02-01 → 09-20</b> and <b>10-01 → 02-01</b>. ' +
          'No dates selected = the system stays inactive.</p>' +
      '</div>' +
      '<label>Description</label>' +
      '<textarea id="pfDesc" style="min-height:80px">' +
        esc(ep && ep.description ? ep.description : '') + '</textarea>' +
      '<div class="mt row">' +
        '<div class="fixed"><button type="submit">' +
          (ep ? 'Save changes' : 'Create portal') + '</button></div>' +
        (ep ? '<div class="fixed"><button type="button" class="ghost" data-act="p-cancel">' +
          'Cancel</button></div>' : '') +
      '</div>' +
    '</form></div>' +
    '<div class="card"><h3>All portals</h3><table><thead><tr>' +
      '<th>Name</th><th>Type</th><th>Schedule</th><th>Status</th>' +
      '<th>Tenants</th><th>Actions</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}
async function savePortal(e) {
  e.preventDefault();
  const ep = S.editPortalId
    ? S.portals.find(function (p) { return String(p.id) === String(S.editPortalId); })
    : null;
  const mode = val('pfMode');
  const body = {
    name: val('pfName'),
    scheduleMode: mode,
    enabled: $('pfEnabled').checked,
    description: val('pfDesc')
  };
  const key = val('pfKey'); if (key) body.key = key;
  const type = val('pfType'); if (type) body.type = type;
  if (mode === 'windows') {
    const wins = [];
    const rows = document.querySelectorAll('#pfWins .win-row');
    for (let i = 0; i < rows.length; i++) {
      const from = rows[i].querySelector('.win-from').value.trim();
      const to = rows[i].querySelector('.win-to').value.trim();
      if (from || to) wins.push({ from: from, to: to });
    }
    body.windows = wins;
  }
  try {
    if (ep) {
      await API.put('/super/portals/' + encodeURIComponent(ep.id), body);
      toast('Portal updated', 'ok');
    } else {
      await API.post('/super/portals', body);
      toast('Portal created', 'ok');
    }
    S.editPortalId = null;
    drop('tenants');
    renderPortals();
  } catch (err) { fail(err); }
}
async function deletePortal(id) {
  if (!confirm('Delete this portal? It is only allowed when no tenants remain under it.')) return;
  try {
    await API.del('/super/portals/' + encodeURIComponent(id));
    toast('Portal deleted', 'ok');
    S.editPortalId = null;
    drop('tenants');
    renderPortals();
  } catch (err) { fail(err); }
}
/* ======================================================= accounts ======== */
async function renderAccounts() {
  const v = $('view-accounts');
  v.innerHTML = loadMsg();
  let portals = [], tenants = [];
  try {
    portals = await ensure('portals', '/super/portals', 'portals');
    tenants = await ensure('tenants', '/super/tenants', 'tenants');
  } catch (e) { v.innerHTML = errBox(e); return; }

  const et = S.editTenantId
    ? tenants.find(function (t) { return String(t.id) === String(S.editTenantId); })
    : null;
  if (S.editTenantId && !et) S.editTenantId = null;

  const portalOpts = '<option value="">— choose portal —</option>' +
    portals.map(function (p) {
      return '<option value="' + esc(String(p.id)) + '">' + esc(p.name) + '</option>';
    }).join('');

  const rows = tenants.length ? tenants.map(function (t) {
    const admin = t.admin && t.admin.email ? esc(t.admin.email) : '<span class="muted">—</span>';
    return '<tr><td><b>' + esc(t.name) + '</b></td>' +
      '<td class="mono small">/t/' + esc(t.slug) +
        ' <a href="/t/' + esc(t.slug) + '" target="_blank" rel="noopener">open</a></td>' +
      '<td>' + esc(t.portalName || '—') + '</td>' +
      '<td class="small">' + admin + '</td>' +
      '<td>' + num(t.userCount) + '</td>' +
      '<td>' + activeBadge(!!t.active) + '</td>' +
      '<td class="nowrap">' +
        '<button type="button" class="small ghost" data-act="t-edit" data-id="' +
          esc(String(t.id)) + '">Branding</button> ' +
        '<button type="button" class="small danger" data-act="t-del" data-id="' +
          esc(String(t.id)) + '">Delete</button>' +
      '</td></tr>';
  }).join('') : '<tr><td colspan="7" class="muted">No accounts yet.</td></tr>';

  let editCard = '';
  if (et) {
    editCard = '<div class="card"><h3>Edit branding — ' + esc(et.name) + '</h3>' +
      '<form id="tenantBrandForm">' +
        '<div class="row"><div><label>Name</label>' +
          '<input type="text" id="tbName" required value="' + esc(et.name) + '"></div></div>' +
        '<div class="row">' +
          '<div><label>School logo (max 1.5 MB)</label>' +
            '<input type="file" id="tbLogo" accept="image/*">' +
            '<div class="mt"><img id="tbLogoImg" alt="School logo" class="' +
              (et.logo ? '' : 'hidden') + '" src="' + esc(et.logo || '') +
              '" style="height:56px;border-radius:10px;border:1px solid var(--line);padding:4px;background:#fff"></div>' +
          '</div>' +
        '</div>' +
        '<div class="row"><div><label>Account colour</label>' +
          '<div class="row" style="align-items:center;gap:8px">' +
            '<input type="color" id="tbTheme" value="' + (themeIsHex(et.themeColor) ? esc(et.themeColor) : '#24508c') + '" style="width:64px;height:38px;padding:2px">' +
            '<span class="mono small">' + (themeIsHex(et.themeColor) ? esc(et.themeColor) : 'program default') + '</span></div>' +
          '<label style="margin-top:8px"><input type="checkbox" id="tbThemeOff"' +
            (et.themeColor ? '' : ' checked') + '> Use the default programme colour</label>' +
          '<p class="muted small">Repaints this account\u2019s layout — header, menus, buttons and its login page.</p></div></div>' +
        '<div class="mt row">' +
          '<div class="fixed"><button type="submit">Save branding</button></div>' +
          '<div class="fixed"><button type="button" class="ghost" data-act="t-cancel">Cancel</button></div>' +
        '</div>' +
      '</form></div>';
  }

  v.innerHTML = '<h2>Accounts (Tenants)</h2>' + editCard +
    '<div class="card"><h3>Create a tenant</h3>' +
    '<form id="tenantForm">' +
      '<div class="row">' +
        '<div><label>Portal *</label><select id="tnPortal" required>' + portalOpts + '</select></div>' +
        '<div><label>Organization / school name *</label>' +
          '<input type="text" id="tnName" required></div>' +
        '<div><label>Slug (login URL)</label>' +
          '<input type="text" id="tnSlug" placeholder="auto from name"></div>' +
      '</div>' +
      '<div class="row">' +
        '<div><label>Admin full name *</label><input type="text" id="tnAdminName" required></div>' +
        '<div><label>Admin email *</label><input type="email" id="tnAdminEmail" required></div>' +
        '<div><label>Admin password *</label>' +
          '<input type="password" id="tnAdminPw" required autocomplete="new-password"></div>' +
      '</div>' +
      '<div class="row">' +
        '<div><label>School logo (max 1.5 MB)</label>' +
          '<input type="file" id="tnLogo" accept="image/*">' +
          '<div class="mt"><img id="tnLogoImg" alt="School logo" class="hidden" ' +
            'style="height:56px;border-radius:10px;border:1px solid var(--line);padding:4px;background:#fff"></div>' +
        '</div>' +
      '</div>' +
      '<div class="mt"><button type="submit">Create tenant + admin</button></div>' +
    '</form></div>' +
    '<div class="card"><h3>All tenants</h3><table><thead><tr>' +
      '<th>Name</th><th>Login URL</th><th>Portal</th><th>Admin</th>' +
      '<th>Users</th><th>Status</th><th>Actions</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';

  const tnName = $('tnName'), tnSlug = $('tnSlug');
  if (tnName && tnSlug) {
    tnSlug.dataset.auto = '1';
    tnName.addEventListener('input', function () {
      if (tnSlug.dataset.auto === '1') tnSlug.value = slugify(tnName.value);
    });
    tnSlug.addEventListener('input', function () { tnSlug.dataset.auto = '0'; });
  }
}
async function createTenant(e) {
  e.preventDefault();
  try {
    const portalId = val('tnPortal');
    if (!portalId) throw new Error('Choose a portal');
    const body = {
      portalId: portalId,
      name: val('tnName'),
      admin: {
        fullName: val('tnAdminName'),
        email: val('tnAdminEmail'),
        password: $('tnAdminPw').value
      }
    };
    if (!body.name) throw new Error('Enter the organization name');
    if (!body.admin.fullName || !body.admin.email || !body.admin.password) {
      throw new Error('Admin name, email and password are required');
    }
    const slug = val('tnSlug');
    if (slug) body.slug = slug;
    const logo = await logoDataUrl($('tnLogo'));
    if (logo) body.logo = logo;
    const data = await API.post('/super/tenants', body);
    toast('Tenant created — admin login: ' +
      (data.loginUrl || ('/t/' + (body.slug || slugify(body.name)))), 'ok');
    drop('tenants');
    renderAccounts();
  } catch (err) { fail(err); }
}
async function saveTenantBrand(e) {
  e.preventDefault();
  const t = S.tenants
    ? S.tenants.find(function (x) { return String(x.id) === String(S.editTenantId); })
    : null;
  if (!t) return;
  try {
    const body = { name: val('tbName') };
    if (!body.name) throw new Error('Enter the name');
    const logo = await logoDataUrl($('tbLogo'));
    if (logo) body.logo = logo;
    const themeOff = document.getElementById('tbThemeOff');
    body.themeColor = (themeOff && themeOff.checked) ? null : val('tbTheme');
    await API.put('/super/tenants/' + encodeURIComponent(t.id), body);
    toast('Branding updated', 'ok');
    S.editTenantId = null;
    drop('tenants');
    renderAccounts();
  } catch (err) { fail(err); }
}
async function deleteTenant(id) {
  if (!confirm('Delete this tenant? All of its users and data will be removed.')) return;
  try {
    await API.del('/super/tenants/' + encodeURIComponent(id));
    toast('Tenant deleted', 'ok');
    S.editTenantId = null;
    drop('tenants');
    renderAccounts();
  } catch (err) { fail(err); }
}
/* ======================================================== modules ======== */
function promptRowHTML(label, color) {
  return '<div class="row pr-row" style="align-items:flex-end;margin-bottom:8px">' +
    '<div><label class="muted small" style="margin:0 0 3px">Prompt label</label>' +
    '<input type="text" class="pr-label" placeholder="e.g. What did you learn?" value="' +
      esc(label || '') + '"></div>' +
    '<div><label class="muted small" style="margin:0 0 3px">Colour</label>' +
    '<input type="color" class="pr-color" value="' + esc(color || '#24508c') + '"></div>' +
    '<div class="fixed"><button type="button" class="small danger" data-act="m-prompt-del">Remove</button></div>' +
    '</div>';
}
async function renderModules() {
  const v = $('view-modules');
  v.innerHTML = loadMsg();
  try {
    await ensure('modules', '/super/modules', 'modules');
    await ensure('videos', '/videos', 'videos');
  } catch (e) { v.innerHTML = errBox(e); return; }

  const em = S.editModuleId
    ? S.modules.find(function (m) { return String(m.id) === String(S.editModuleId); })
    : null;
  if (S.editModuleId && !em) S.editModuleId = null;
  const mode = em ? (em.mode || 'summary') : 'summary';
  const prompts = (em && em.summaryPrompts && em.summaryPrompts.length)
    ? em.summaryPrompts : [{ label: '', color: '#24508c' }];

  const videoOpts = '<option value="">— none —</option>' +
    S.videos.map(function (vd) {
      const sel = em && em.completionVideoId != null &&
        String(em.completionVideoId) === String(vd.id) ? ' selected' : '';
      return '<option value="' + esc(String(vd.id)) + '"' + sel + '>' + esc(vd.title) + '</option>';
    }).join('');

  const rows = S.modules.length ? S.modules.map(function (m) {
    const promptCount = (m.summaryPrompts || []).length;
    return '<tr><td>' + num(m.order) + '</td>' +
      '<td class="mono small">' + esc(m.key || '') + '</td>' +
      '<td><b>' + esc(m.title) + '</b></td>' +
      '<td>' + (m.mode === 'objectives'
        ? '<span class="badge warn">OBJECTIVES</span>'
        : '<span class="badge info">SUMMARY</span>') +
        (promptCount ? '<div class="muted small">' + promptCount + ' prompts</div>' : '') + '</td>' +
      '<td class="small">' + esc(m.certificateName || '—') + '</td>' +
      '<td>' + num(m.bookCount) + '</td>' +
      '<td class="nowrap">' +
        '<button type="button" class="small ghost" data-act="m-edit" data-id="' +
          esc(String(m.id)) + '">Edit</button> ' +
        '<button type="button" class="small danger" data-act="m-del" data-id="' +
          esc(String(m.id)) + '">Delete</button>' +
      '</td></tr>';
  }).join('') : '<tr><td colspan="7" class="muted">No modules yet.</td></tr>';

  v.innerHTML = '<h2>Modules</h2>' +
    '<div class="card"><h3>' +
      (em ? 'Edit module — ' + esc(em.title) : 'New module') + '</h3>' +
    '<form id="moduleForm">' +
      '<div class="row">' +
        '<div><label>Title *</label><input type="text" id="mfTitle" required value="' +
          esc(em ? em.title : '') + '"></div>' +
        '<div><label>Order</label><input type="number" id="mfOrder" value="' +
          esc(em && em.order != null ? em.order : '') + '"></div>' +
        '<div><label>Mode</label><select id="mfMode">' +
          '<option value="summary"' + (mode === 'summary' ? ' selected' : '') + '>Summary</option>' +
          '<option value="objectives"' + (mode === 'objectives' ? ' selected' : '') + '>Objectives</option>' +
        '</select></div>' +
      '</div>' +
      '<div class="row">' +
        '<div><label>Certificate name</label><input type="text" id="mfCert" value="' +
          esc(em && em.certificateName ? em.certificateName : '') + '"></div>' +
        '<div><label>Default books</label><input type="number" id="mfBooks" value="' +
          esc(em && em.defaultBooks != null ? em.defaultBooks : '') + '"></div>' +
        '<div><label>Completion video</label><select id="mfVideo">' + videoOpts + '</select></div>' +
      '</div>' +
      '<label>Summary prompts (label + colour)</label>' +
      '<div id="mfPrompts">' +
        prompts.map(function (p) { return promptRowHTML(p.label, p.color); }).join('') +
      '</div>' +
      '<button type="button" class="ghost small" data-act="m-add-prompt">+ Add prompt</button>' +
      '<div class="mt row">' +
        '<div class="fixed"><button type="submit">' +
          (em ? 'Save changes' : 'Create module') + '</button></div>' +
        (em ? '<div class="fixed"><button type="button" class="ghost" data-act="m-cancel">' +
          'Cancel</button></div>' : '') +
      '</div>' +
    '</form></div>' +
    '<div class="card"><h3>All modules</h3><table><thead><tr>' +
      '<th>Order</th><th>Key</th><th>Title</th><th>Mode</th><th>Certificate</th>' +
      '<th>Books</th><th>Actions</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}
async function saveModule(e) {
  e.preventDefault();
  const em = S.editModuleId
    ? S.modules.find(function (m) { return String(m.id) === String(S.editModuleId); })
    : null;
  try {
    const body = { title: val('mfTitle'), mode: val('mfMode') };
    if (!body.title) throw new Error('Enter the module title');
    const order = intOr(val('mfOrder'), null);
    if (order != null) body.order = order;
    const cert = val('mfCert');
    if (cert) body.certificateName = cert;
    const db = intOr(val('mfBooks'), null);
    if (db != null) body.defaultBooks = db;
    const vid = val('mfVideo');
    if (vid) body.completionVideoId = vid;
    const prompts = [];
    const rows = document.querySelectorAll('#mfPrompts .pr-row');
    for (let i = 0; i < rows.length; i++) {
      const label = rows[i].querySelector('.pr-label').value.trim();
      if (label) {
        prompts.push({
          label: label,
          color: rows[i].querySelector('.pr-color').value || '#24508c'
        });
      }
    }
    if (prompts.length) body.summaryPrompts = prompts;
    if (em) {
      await API.put('/super/modules/' + encodeURIComponent(em.id), body);
      toast('Module updated', 'ok');
    } else {
      await API.post('/super/modules', body);
      toast('Module created', 'ok');
    }
    S.editModuleId = null;
    drop('modules');
    renderModules();
  } catch (err) { fail(err); }
}
async function deleteModule(id) {
  if (!confirm('Delete this module? It is only allowed when it has no books.')) return;
  try {
    await API.del('/super/modules/' + encodeURIComponent(id));
    toast('Module deleted', 'ok');
    S.editModuleId = null;
    drop('modules');
    renderModules();
  } catch (err) { fail(err); }
}
/* ======================================================== library ======== */
function libraryTypeBadge(type) {
  const cls = type === 'letter' ? 'warn' : type === 'video' ? 'ok' : 'info';
  return '<span class="badge ' + cls + '">' + esc(String(type).toUpperCase()) + '</span>';
}
function libraryScope(scope, tenants) {
  if (!scope || scope === 'global') return '<span class="badge info">GLOBAL</span>';
  const t = (tenants || []).find(function (x) { return String(x.id) === String(scope); });
  return '<span class="badge lock">' + esc(t ? t.name : String(scope)) + '</span>';
}
async function renderLibrary() {
  const v = $('view-library');
  v.innerHTML = loadMsg();
  let items = [], tenants = [];
  try {
    items = await ensure('library', '/library', 'library');
    tenants = await ensure('tenants', '/super/tenants', 'tenants');
  } catch (e) { v.innerHTML = errBox(e); return; }

  const el = S.editLibraryId
    ? items.find(function (i) { return String(i.id) === String(S.editLibraryId); })
    : null;
  if (S.editLibraryId && !el) S.editLibraryId = null;

  const scopeOpts = '<option value="global">Global</option>' +
    tenants.map(function (t) {
      return '<option value="' + esc(String(t.id)) + '">' + esc(t.name) + '</option>';
    }).join('');


/* pdfHtml() lives in common.js — it renders the book-style single-page reader. */

  const rows = items.length ? items.map(function (i) {
    const flags = [];
    if (i.fileName) flags.push('<span class="badge lock">FILE: ' + esc(i.fileName) + '</span>');
    if (i.text) flags.push('<span class="badge info">TEXT</span>');
    if (i.url) flags.push(pdfHtml(i.url));
    if (!flags.length) flags.push('<span class="muted">—</span>');
    return '<tr><td>' + libraryTypeBadge(i.type) + '</td>' +
      '<td><b>' + esc(i.title) + '</b></td>' +
      '<td>' + libraryScope(i.scope, tenants) + '</td>' +
      '<td class="small">' + flags.join(' ') + '</td>' +
      '<td class="nowrap">' +
        (i.canEdit
          ? '<button type="button" class="small ghost" data-act="l-edit" data-id="' +
              esc(String(i.id)) + '">Edit</button> ' +
            '<button type="button" class="small danger" data-act="l-del" data-id="' +
              esc(String(i.id)) + '">Delete</button>'
          : '<span class="muted small">read only</span>') +
      '</td></tr>';
  }).join('') : '<tr><td colspan="5" class="muted">Library is empty.</td></tr>';

  v.innerHTML = '<h2>Library</h2>' +
    '<div class="card"><h3>' +
      (el ? 'Edit item — ' + esc(el.title) : 'Add to library') + '</h3>' +
    '<form id="libraryForm">' +
      '<div class="row">' +
        '<div><label>Type</label><select id="lfType">' +
          '<option value="book"' + (el && el.type === 'book' ? ' selected' : '') + '>Book (PDF)</option>' +
          '<option value="letter"' + (el && el.type === 'letter' ? ' selected' : '') + '>Letter</option>' +
          '<option value="video"' + (el && el.type === 'video' ? ' selected' : '') + '>Video</option>' +
        '</select></div>' +
        '<div><label>Title *</label><input type="text" id="lfTitle" required value="' +
          esc(el ? el.title : '') + '"></div>' +
        '<div><label>Scope</label><select id="lfScope">' + scopeOpts + '</select></div>' +
      '</div>' +
      '<label>Text (rich text for letters)</label>' +
      '<textarea id="lfText">' + esc(el && el.text ? el.text : '') + '</textarea>' +
      '<div class="row">' +
        '<div><label>URL (videos / external files)</label>' +
          '<input type="text" id="lfUrl" placeholder="https://…" value="' +
            esc(el && el.url ? el.url : '') + '"></div>' +
        '<div><label>File upload (max 40MB)' +
          (el && el.fileName ? ' — current: ' + esc(el.fileName) : '') + '</label>' +
          '<input type="file" id="lfFile"></div>' +
      '</div>' +
      '<div class="mt row">' +
        '<div class="fixed"><button type="submit">' +
          (el ? 'Save changes' : 'Add item') + '</button></div>' +
        (el ? '<div class="fixed"><button type="button" class="ghost" data-act="l-cancel">' +
          'Cancel</button></div>' : '') +
      '</div>' +
    '</form></div>' +
    '<div class="card"><h3>All items</h3><table><thead><tr>' +
      '<th>Type</th><th>Title</th><th>Scope</th><th>Content</th><th>Actions</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';

  if (el) {
    const sel = $('lfScope');
    if (sel) sel.value = el.scope || 'global';
  }
}
async function saveLibrary(e) {
  e.preventDefault();
  const el = S.editLibraryId
    ? S.library.find(function (i) { return String(i.id) === String(S.editLibraryId); })
    : null;
  try {
    const body = {
      type: val('lfType'),
      title: val('lfTitle'),
      scope: val('lfScope') || 'global'
    };
    if (!body.title) throw new Error('Enter a title');
    const text = $('lfText').value.trim();
    if (text) body.text = text;
    const url = val('lfUrl');
    if (url) body.url = url;
    const file = await filePayload($('lfFile'));
    if (file) body.file = file;
    if (el) {
      await API.put('/library/' + encodeURIComponent(el.id), body);
      toast('Library item updated', 'ok');
    } else {
      await API.post('/library', body);
      toast('Library item added', 'ok');
    }
    S.editLibraryId = null;
    drop('library');
    renderLibrary();
  } catch (err) { fail(err); }
}
async function deleteLibrary(id) {
  if (!confirm('Delete this library item?')) return;
  try {
    await API.del('/library/' + encodeURIComponent(id));
    toast('Library item deleted', 'ok');
    S.editLibraryId = null;
    drop('library');
    renderLibrary();
  } catch (err) { fail(err); }
}
/* ================================================ books & chapters ======= */
async function renderBooks() {
  const v = $('view-books');
  v.innerHTML = loadMsg();
  let modules = [], library = [];
  try {
    modules = await ensure('modules', '/super/modules', 'modules');
    library = await ensure('library', '/library', 'library');
  } catch (e) { v.innerHTML = errBox(e); return; }

  if (!modules.length) {
    v.innerHTML = '<h2>Books &amp; Chapters</h2><div class="card muted">' +
      'No modules yet — create one in the <b>Modules</b> section first.</div>';
    return;
  }
  if (!S.bookModuleId || !modules.some(function (m) { return String(m.id) === String(S.bookModuleId); })) {
    S.bookModuleId = String(modules[0].id);
  }
  const cur = modules.find(function (m) { return String(m.id) === String(S.bookModuleId); });
  const isSummary = !cur || cur.mode !== 'objectives';

  let books = [];
  try {
    const d = await API.get('/books?moduleId=' + encodeURIComponent(S.bookModuleId));
    books = d.books || [];
  } catch (e) { v.innerHTML = errBox(e); return; }
  S.books = books;
  S.library = library;

  const modOpts = modules.map(function (m) {
    const sel = String(m.id) === String(S.bookModuleId) ? ' selected' : '';
    return '<option value="' + esc(String(m.id)) + '"' + sel + '>' +
      esc(String(m.order == null ? '' : m.order + '. ') + m.title) + '</option>';
  }).join('');
  const libBooks = library.filter(function (i) { return i.type === 'book'; });
  const libLetters = library.filter(function (i) { return i.type === 'letter'; });
  const bookOpts = '<option value="">— none —</option>' + libBooks.map(function (i) {
    return '<option value="' + esc(String(i.id)) + '">' + esc(i.title) + '</option>';
  }).join('');
  const letterOpts = '<option value="">— none —</option>' + libLetters.map(function (i) {
    return '<option value="' + esc(String(i.id)) + '">' + esc(i.title) + '</option>';
  }).join('');

  v.innerHTML = '<h2>Books &amp; Chapters</h2>' +
    '<div class="card"><div class="row">' +
      '<div><label>Module</label><select id="bkModule">' + modOpts + '</select></div>' +
      '<div class="fixed" style="align-self:flex-end;padding-bottom:10px">' +
        '<span class="badge ' + (isSummary ? 'info' : 'warn') + '">MODE: ' +
        esc(isSummary ? 'SUMMARY' : 'OBJECTIVES') + '</span></div>' +
    '</div>' +
    '<p class="muted small" style="margin-bottom:0">Books, chapters and questions below ' +
      'belong to the selected module. Questions are entered here by the super admin.</p></div>' +
    '<div class="card"><h3>New book</h3><form id="bookForm">' +
      '<div class="row">' +
        '<div><label>Title *</label><input type="text" id="bkTitle" required></div>' +
        '<div><label>Order</label><input type="number" id="bkOrder"></div>' +
      '</div>' +
      '<div class="row">' +
        '<div><label>Library book / PDF</label><select id="bkLib">' + bookOpts + '</select></div>' +
        '<div' + (isSummary ? '' : ' class="hidden"') + '><label>Letter (summary modules)</label>' +
          '<select id="bkLetter">' + letterOpts + '</select></div>' +
      '</div>' +
      '<div class="mt"><button type="submit">Add book</button></div>' +
    '</form></div>' +
    '<div id="bookList">' +
      (books.length
        ? books.map(function (b) { return bookCardHTML(b, isSummary); }).join('')
        : '<div class="card muted">No books in this module yet.</div>') +
    '</div>';
  /* size every page picker (and read the linked PDF so all pages appear) */
  v.querySelectorAll('[data-pg]').forEach(function (p) { pgInit(p); });
}
function chapterFieldsHTML(ch) {
  const sel = pageSelection(ch);
  const book = S.curBook || null;
  return '<div class="row">' +
    '<div><label>Title *</label><input type="text" class="ch-title" required value="' +
      esc(ch ? ch.title : '') + '"></div>' +
    pagePickerHTML(sel, bookPageTotal(book), { pdf: bookPdfUrl(book) }) +
    '<div><label>Order</label><input type="number" class="ch-order" value="' +
      esc(ch && ch.order != null ? ch.order : '') + '"></div>' +
  '</div>' +
  '<label>Content</label><textarea class="ch-content" style="min-height:110px">' +
    esc(ch ? (ch.content || '') : '') + '</textarea>' +
  (S.curBookSummary
    ? '<label>Key words (comma separated — the typed answer is assessed against these)</label>' +
      '<input type="text" class="ch-keywords kw-input" value="' +
      esc(ch && ch.keywords ? ch.keywords.join(', ') : '') + '" placeholder="' +
      esc(ch && ch.suggestedKeywords ? ch.suggestedKeywords.join(', ') : 'leave empty to use the words of the chapter text') + '">'
    : '');
}
/* how many pages can be ticked: the highest page already used, or the real
   page count of the PDF linked to the book */
function bookPageTotal(book) {
  let max = 0;
  ((book && book.chapters) || []).forEach(function (c) {
    [c.pageStart, c.pageEnd].forEach(function (p) { max = Math.max(max, Number(p) || 0); });
    (c.pageSelect || []).forEach(function (p) { max = Math.max(max, Number(p) || 0); });
  });
  return max;
}
function bookPdfUrl(book) {
  const lib = (S.library || []).filter(function (l) { return String(l.id) === String(book && book.libraryId); })[0];
  return lib && lib.url && /\.pdf($|[?#])/i.test(String(lib.url)) ? lib.url : null;
}
function pageSelection(ch) {
  const s = [];
  if (ch && Array.isArray(ch.pageSelect) && ch.pageSelect.length) {
    ch.pageSelect.forEach(function (p) { if (Number(p) >= 1) s.push(Number(p)); });
  } else if (ch && (ch.pageStart != null || ch.pageEnd != null)) {
    const a = [Number(ch.pageStart), Number(ch.pageEnd)].filter(function (p) { return p >= 1; });
    if (a.length === 2 && a[1] >= a[0]) {
      for (let i = a[0]; i <= a[1] && s.length < 5000; i++) s.push(i);
    } else {
      a.forEach(function (p) { s.push(p); });
    }
  }
  return s;
}
function qOptionRowHTML(name, text, checked) {
  return '<div class="row q-opt" style="align-items:center;margin-bottom:6px">' +
    '<div><input type="text" class="q-opt-text" placeholder="Option" value="' +
      esc(text) + '"></div>' +
    '<div class="fixed"><label style="margin:0;white-space:nowrap">' +
      '<input type="radio" name="' + esc(name) + '" class="q-correct"' +
      (checked ? ' checked' : '') + '> Correct</label></div>' +
    '<div class="fixed"><button type="button" class="small danger" ' +
      'data-act="bk-q-del">✕</button></div>' +
  '</div>';
}
function questionFormHTML(chId) {
  const nm = 'qc_' + chId;
  return '<form class="q-form" data-ch="' + esc(String(chId)) +
    '" style="margin-top:10px;background:#f8faff;border:1px dashed var(--line);' +
    'border-radius:10px;padding:12px">' +
    '<label>New question</label>' +
    '<textarea class="q-text" required style="min-height:60px" ' +
      'placeholder="Type the question…"></textarea>' +
    '<label>Options — tick the correct answer (min. 2)</label>' +
    '<div class="q-opts">' + qOptionRowHTML(nm, '', true) +
      qOptionRowHTML(nm, '', false) + '</div>' +
    '<div class="mt"><button type="button" class="ghost small" data-act="bk-q-add">' +
      '+ Add option</button> ' +
      '<button type="submit" class="small">Save question</button></div>' +
  '</form>';
}
function objectiveHTML(o) {
  const opts = (o.options || []).map(function (opt, i) {
    const correct = String(o.answerIndex) === String(i);
    return '<div class="opt' + (correct ? ' correct' : '') + '">' +
      '<input type="radio" disabled' + (correct ? ' checked' : '') + '> ' +
      '<span>' + esc(opt) + '</span>' +
      (correct ? ' <span class="badge ok">correct</span>' : '') + '</div>';
  }).join('');
  return '<div class="obj" style="margin-top:8px">' +
    '<div class="q">' + esc(o.question) + '</div>' + opts +
    '<div class="mt"><button type="button" class="small danger" data-act="bk-obj-del" ' +
      'data-id="' + esc(String(o.id)) + '">Delete question</button></div>' +
  '</div>';
}
function chapterHTML(ch) {
  const id = String(ch.id);
  const editing = S.editChapterId === id;
  let head;
  if (editing) {
    head = '<form class="ch-edit-form" data-ch="' + id + '">' +
      chapterFieldsHTML(ch) +
      '<div class="mt row">' +
        '<div class="fixed"><button type="submit" class="small">Save chapter</button></div>' +
        '<div class="fixed"><button type="button" class="small ghost" ' +
          'data-act="bk-ch-cancel">Cancel</button></div>' +
      '</div></form>';
  } else {
    const pages = (ch.pageStart != null || ch.pageEnd != null)
      ? 'Pages ' + (ch.pageStart == null ? '—' : ch.pageStart) + '–' +
        (ch.pageEnd == null ? '—' : ch.pageEnd)
      : 'No page range';
    head = '<div class="row" style="align-items:center">' +
      '<div style="flex:2"><b>' + esc(ch.title) + '</b>' +
        '<div class="muted small">' + esc(pages) + '</div>' +
        (ch.content
          ? '<div class="small" style="white-space:pre-wrap;max-height:110px;' +
            'overflow:auto">' + esc(ch.content) + '</div>'
          : '') +
      '</div>' +
      '<div class="fixed"><button type="button" class="small ghost" data-act="bk-ch-edit" ' +
        'data-id="' + id + '">Edit</button></div>' +
      '<div class="fixed"><button type="button" class="small danger" data-act="bk-ch-del" ' +
        'data-id="' + id + '">Delete</button></div>' +
    '</div>';
  }
  const objs = ch.objectives || [];
  const objList = objs.length
    ? objs.map(objectiveHTML).join('')
    : '<p class="muted small">No questions yet.</p>';
  const kwRow = S.curBookSummary
    ? '<b class="small">Key words</b>' +
      ((ch.keywords && ch.keywords.length) || (ch.suggestedKeywords && ch.suggestedKeywords.length)
        ? '<p class="small muted">' + ((ch.keywords && ch.keywords.length ? ch.keywords : ch.suggestedKeywords) || [])
            .map(function (k) { return '<span class="kw">' + esc(k) + '</span>'; }).join(' ') +
          (ch.keywords && ch.keywords.length ? '' : ' <span class="badge lock">auto from the chapter text</span>') + '</p>'
        : '<p class="muted small">No key words yet — they are taken from the chapter text.</p>')
    : '';
  return '<div class="obj" style="margin-top:12px">' +
    '<div class="muted small" style="text-transform:uppercase;letter-spacing:.05em">' +
      'Chapter</div>' + head +
    '<hr style="border:0;border-top:1px solid var(--line);margin:12px 0">' +
    (S.curBookSummary
      ? kwRow + '<p class="muted small">MODE: SUMMARY — learners type their answer for this chapter, so ' +
        'questions are not used in this module.</p>'
      : '<b class="small">Questions</b>' + objList + questionFormHTML(id)) +
  '</div>';
}
function bookCardHTML(b, isSummary) {
  S.curBook = b;
  S.curBookSummary = !!isSummary;
  const chapters = (b.chapters || []).slice().sort(function (a, z) {
    return (a.order || 0) - (z.order || 0);
  });
  const flags = [];
  if (b.libraryId) flags.push('<span class="badge info">PDF LINKED</span>');
  if (b.letterId) flags.push('<span class="badge warn">LETTER LINKED</span>');
  return '<div class="card">' +
    '<div class="row" style="align-items:center">' +
      '<div style="flex:2"><h3 style="margin:0">' + esc(b.title) + '</h3>' +
        '<div class="muted small">Order ' +
          esc(b.order == null ? '—' : String(b.order)) + ' ' + flags.join(' ') + '</div></div>' +
      '<div class="fixed"><button type="button" class="small ghost" data-act="bk-add-ch" ' +
        'data-id="' + esc(String(b.id)) + '">+ Add chapter</button></div>' +
      '<div class="fixed"><button type="button" class="small danger" data-act="bk-book-del" ' +
        'data-id="' + esc(String(b.id)) + '">Delete book</button></div>' +
    '</div>' +
    '<form class="ch-form hidden" data-book="' + esc(String(b.id)) + '">' +
      chapterFieldsHTML(null) +
      '<div class="mt"><button type="submit" class="small">Save chapter</button></div>' +
    '</form>' +
    (chapters.length
      ? chapters.map(chapterHTML).join('')
      : '<p class="muted small">No chapters yet.</p>') +
  '</div>';
}
async function createBook(e) {
  e.preventDefault();
  try {
    const title = val('bkTitle');
    if (!title) throw new Error('Enter the book title');
    const body = { moduleId: S.bookModuleId, title: title };
    const order = intOr(val('bkOrder'), null);
    if (order != null) body.order = order;
    const lib = val('bkLib');
    if (lib) body.libraryId = lib;
    const letter = val('bkLetter');
    if (letter) body.letterId = letter;
    await API.post('/books', body);
    toast('Book added', 'ok');
    renderBooks();
  } catch (err) { fail(err); }
}
function chapterBody(form) {
  const body = { title: form.querySelector('.ch-title').value.trim() };
  if (!body.title) throw new Error('Enter the chapter title');
  const content = form.querySelector('.ch-content').value.trim();
  if (content) body.content = content;
  const ord = form.querySelector('.ch-order').value;
  if (ord !== '') body.order = intOr(ord, null);
  if (body.order == null) delete body.order;
  const pg = form.querySelectorAll('.pg-ck:checked');
  if (pg.length) {
    const arr = Array.prototype.map.call(pg, function (el) { return Number(el.value); })
      .filter(function (n) { return n >= 1; });
    if (arr.length) {
      body.pageStart = Math.min.apply(null, arr);
      body.pageEnd = Math.max.apply(null, arr);
    }
  }
  /* MODULE 1 = MODE: SUMMARY — typed answers are assessed against these */
  const kw = form.querySelector('.ch-keywords');
  if (kw) body.keywords = kw.value;
  return body;
}
async function addChapter(e) {
  e.preventDefault();
  const form = e.target;
  try {
    const body = chapterBody(form);
    await API.post('/books/' + encodeURIComponent(form.dataset.book) + '/chapters', body);
    toast('Chapter added', 'ok');
    renderBooks();
  } catch (err) { fail(err); }
}
async function editChapter(e) {
  e.preventDefault();
  const form = e.target;
  try {
    const body = chapterBody(form);
    await API.put('/chapters/' + encodeURIComponent(form.dataset.ch), body);
    toast('Chapter updated', 'ok');
    S.editChapterId = null;
    renderBooks();
  } catch (err) { fail(err); }
}
async function addQuestion(e) {
  e.preventDefault();
  const form = e.target;
  try {
    const question = form.querySelector('.q-text').value.trim();
    if (question.length < 3) throw new Error('Type the question');
    const rows = form.querySelectorAll('.q-opts .q-opt');
    const list = [];
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i].querySelector('.q-opt-text').value.trim();
      const correct = rows[i].querySelector('.q-correct').checked;
      if (correct && !t) throw new Error('The correct option cannot be empty');
      if (t) list.push({ t: t, c: correct });
    }
    if (list.length < 2) throw new Error('A question needs at least 2 options');
    let answerIndex = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i].c) { answerIndex = i; break; }
    }
    const body = {
      question: question,
      options: list.map(function (x) { return x.t; }),
      answerIndex: answerIndex
    };
    await API.post('/chapters/' + encodeURIComponent(form.dataset.ch) + '/objectives', body);
    toast('Question saved', 'ok');
    renderBooks();
  } catch (err) { fail(err); }
}
async function deleteBook(id) {
  if (!confirm('Delete this book and all of its chapters?')) return;
  try {
    await API.del('/books/' + encodeURIComponent(id));
    toast('Book deleted', 'ok');
    renderBooks();
  } catch (err) { fail(err); }
}
async function deleteChapter(id) {
  if (!confirm('Delete this chapter and its questions?')) return;
  try {
    await API.del('/chapters/' + encodeURIComponent(id));
    toast('Chapter deleted', 'ok');
    S.editChapterId = null;
    renderBooks();
  } catch (err) { fail(err); }
}
async function deleteObjective(id) {
  if (!confirm('Delete this question?')) return;
  try {
    await API.del('/objectives/' + encodeURIComponent(id));
    toast('Question deleted', 'ok');
    renderBooks();
  } catch (err) { fail(err); }
}
/* ========================================================== users ======== */
function userRow(u) {
  const p = Math.max(0, Math.min(100, Number(u.progress) || 0));
  const ident = [];
  if (u.email) ident.push(esc(u.email));
  if (u.studentNumber) ident.push(esc(u.studentNumber));
  if (!ident.length) ident.push('<span class="muted">—</span>');
  return '<tr data-search="' + esc(searchText(u)) + '"><td><b>' + esc(u.fullName || '—') + '</b><div>' + roleBadge(u.role) + '</div></td>' +
    '<td class="small">' + ident.join('<br>') + '</td>' +
    '<td class="small">' + esc(u.className || '—') + '</td>' +
    '<td class="small">' + esc(u.supervisorName || '—') + '</td>' +
    '<td style="min-width:120px"><b>' + p + '%</b>' +
      '<div class="progress"><i style="width:' + p + '%"></i></div></td>' +
    '<td>' + (u.suspended
      ? '<span class="badge off">SUSPENDED</span>'
      : '<span class="badge ok">ACTIVE</span>') + '</td>' +
    '<td class="nowrap">' +
      '<button type="button" class="small ' + (u.suspended ? 'ghost' : 'danger') +
        '" data-act="u-susp" data-id="' + esc(String(u.id)) + '">' +
        (u.suspended ? 'Unsuspend' : 'Suspend') + '</button> ' +
      '<button type="button" class="small danger" data-act="u-del" data-id="' +
        esc(String(u.id)) + '">Delete</button>' +
    '</td></tr>';
}
async function renderUsers() {
  const v = $('view-users');
  v.innerHTML = loadMsg();
  let tenants = [];
  try { tenants = await ensure('tenants', '/super/tenants', 'tenants'); }
  catch (e) { v.innerHTML = errBox(e); return; }

  let users = [];
  try {
    const q = S.usersTenant ? '?tenantId=' + encodeURIComponent(S.usersTenant) : '';
    const d = await API.get('/super/users' + q);
    users = d.users || [];
  } catch (e) { v.innerHTML = errBox(e); return; }
  S.users = users;

  const filterOpts = '<option value="">All tenants</option>' +
    tenants.map(function (t) {
      const sel = String(t.id) === String(S.usersTenant) ? ' selected' : '';
      return '<option value="' + esc(String(t.id)) + '"' + sel + '>' + esc(t.name) + '</option>';
    }).join('');
  const tenantOpts = '<option value="">— choose tenant —</option>' +
    tenants.map(function (t) {
      return '<option value="' + esc(String(t.id)) + '">' + esc(t.name) + '</option>';
    }).join('');

  const rows = users.length ? users.map(userRow).join('')
    : '<tr><td colspan="7" class="muted">No users found.</td></tr>';

  v.innerHTML = '<h2>Users</h2>' +
    '<div class="card"><h3>Create a user</h3><form id="userForm">' +
      '<div class="row">' +
        '<div><label>Tenant *</label><select id="cuTenant" required>' + tenantOpts + '</select></div>' +
        '<div><label>Role</label><select id="cuRole">' +
          '<option value="student">Student</option>' +
          '<option value="teacher">Teacher</option>' +
          '<option value="member">Member</option>' +
          '<option value="supervisor">Supervisor</option>' +
          '<option value="tenant_admin">Tenant admin</option>' +
        '</select></div>' +
        '<div><label>Full name *</label><input type="text" id="cuName" required></div>' +
      '</div>' +
      '<div class="row">' +
        '<div><label>Email</label><input type="email" id="cuEmail"></div>' +
        '<div><label>Student number</label><input type="text" id="cuNumber"></div>' +
        '<div><label>School class</label><input type="text" id="cuClass" placeholder="e.g. Grade 10A"></div>' +
        '<div><label>Password *</label>' +
          '<input type="password" id="cuPw" required autocomplete="new-password"></div>' +
      '</div>' +
      '<p class="muted small" style="margin-bottom:0">Enter an email or a student number ' +
        '(or both) — that is what the user logs in with.</p>' +
      '<div class="mt"><button type="submit">Create user</button></div>' +
    '</form></div>' +
    '<div class="card"><div class="row" style="align-items:flex-end">' +
      '<div style="min-width:200px"><label>Search users</label>' +
        '<input type="text" id="usSearch" placeholder="Name, email, number, class…" value="' +
        esc(S.usersSearch) + '"></div>' +
      '<div><label>Tenant filter</label><select id="usTenant">' + filterOpts + '</select></div>' +
      '<div class="fixed" style="padding-bottom:10px">' +
        '<span class="badge info">' + users.length + ' users</span> ' +
        '<span class="badge lock" id="usTableCount">' + users.length + ' shown</span></div>' +
    '</div>' +
    '<div class="row export-buttons"><button type="button" class="ghost" data-export="print">Print</button><button type="button" class="ghost" data-export="pdf">PDF</button><button type="button" class="ghost" data-export="excel">Excel</button><button type="button" class="ghost" data-export="word">Word</button></div>' +
    '<table id="usTable"><thead><tr>' +
      '<th>Name</th><th>Email / number</th><th>Class</th><th>Supervisor</th>' +
      '<th>Progress</th><th>Status</th><th>Actions</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  $('usSearch').addEventListener('input', function () {
    S.usersSearch = this.value;
    applyTableSearch('usTable', 'usSearch');
  });
  applyTableSearch('usTable', 'usSearch');
}
async function createUser(e) {
  e.preventDefault();
  try {
    const tenantId = val('cuTenant');
    if (!tenantId) throw new Error('Choose a tenant');
    const body = {
      tenantId: tenantId,
      role: val('cuRole'),
      fullName: val('cuName'),
      password: $('cuPw').value
    };
    const email = val('cuEmail');
    const number = val('cuNumber');
    if (email) body.email = email;
    if (number) body.studentNumber = number;
    if (!email && !number) throw new Error('Enter an email or a student number');
    if (!body.fullName) throw new Error('Enter the full name');
    if (!body.password) throw new Error('Enter a password');
    const cls = val('cuClass');
    if (cls) body.className = cls;
    await API.post('/super/users', body);
    toast('User created', 'ok');
    renderUsers();
  } catch (err) { fail(err); }
}
async function toggleSuspend(id) {
  const u = S.users.find(function (x) { return String(x.id) === String(id); });
  if (!u) return;
  try {
    await API.put('/users/' + encodeURIComponent(id), { suspended: !u.suspended });
    toast(u.suspended ? 'User unsuspended' : 'User suspended', 'ok');
    renderUsers();
  } catch (err) { fail(err); }
}
async function deleteUser(id) {
  if (!confirm('Delete this user? Their submissions will be removed too.')) return;
  try {
    await API.del('/users/' + encodeURIComponent(id));
    toast('User deleted', 'ok');
    renderUsers();
  } catch (err) { fail(err); }
}

/* ======================================================== reports ======== */
/* Builds a lowercase haystack from every visible field of a report row. */
function searchText(o) {
  const parts = [];
  ['userName', 'userRole', 'type', 'label', 'chapter', 'book', 'text',
    'fullName', 'email', 'studentNumber', 'className', 'supervisorName',
    'role', 'name', 'slug', 'title', 'code', 'user', 'similarity'].forEach(function (k) {
    if (o && o[k] != null) parts.push(String(o[k]));
  });
  if (o && o.score != null && o.total != null) parts.push(o.score + '/' + o.total);
  if (o && o.createdAt) parts.push(fmtDate(o.createdAt));
  return parts.join(' | ').toLowerCase();
}
/* Filters rendered table rows by the text in a search input (no re-fetch). */
function applyTableSearch(tableId, inputId) {
  const input = $(inputId);
  const table = document.getElementById(tableId);
  if (!input || !table) return;
  const q = input.value.trim().toLowerCase();
  let shown = 0;
  table.querySelectorAll('tbody tr[data-search]').forEach(function (tr) {
    const hit = !q || (tr.dataset.search || '').indexOf(q) !== -1;
    tr.style.display = hit ? '' : 'none';
    if (hit) shown++;
  });
  const badge = document.getElementById(tableId + 'Count');
  if (badge) badge.textContent = shown + ' shown';
}
function submissionRow(s) {
  const sim = s.similarity == null ? '—' : Math.round(Number(s.similarity)) + '%';
  const label = s.label
    ? '<div class="small" style="color:' + esc(s.color || 'inherit') + '">' +
      esc(s.label) + '</div>'
    : '';
  return '<tr data-search="' + esc(searchText(s)) + '"><td><b>' + esc(s.userName || '—') + '</b>' +
    '<div>' + roleBadge(s.userRole) + '</div></td>' +
    '<td class="small">' + esc(s.type || '—') + label + '</td>' +
    '<td class="small">' + esc(s.chapter || '—') +
      (s.book ? '<div class="muted">' + esc(s.book) + '</div>' : '') + '</td>' +
    '<td class="small">' + esc(fmtDate(s.createdAt)) + '</td>' +
    '<td>' + esc(sim) + '</td>' +
    '<td>' + (s.flagged
      ? '<span class="badge off">FLAGGED</span>'
      : '<span class="badge ok">CLEAN</span>') + '</td>' +
    '<td class="small" style="max-width:340px"><details>' +
      '<summary class="muted">Text excerpt</summary>' +
      '<div style="white-space:pre-wrap;margin-top:6px">' + esc(s.text || '') + '</div>' +
    '</details></td></tr>';
}
async function renderReports() {
  const v = $('view-reports');
  v.innerHTML = loadMsg();
  const params = [];
  if (S.rpFlagged) params.push('flagged=1');
  if (S.rpType) params.push('type=' + encodeURIComponent(S.rpType));
  let subs = [];
  try {
    const d = await API.get('/super/submissions' +
      (params.length ? '?' + params.join('&') : ''));
    subs = d.submissions || [];
  } catch (e) { v.innerHTML = errBox(e); return; }

  const rows = subs.length ? subs.map(submissionRow).join('')
    : '<tr><td colspan="7" class="muted">No submissions match this filter.</td></tr>';

  v.innerHTML = '<h2>Reports</h2>' +
    '<div class="card"><div class="row" style="align-items:flex-end">' +
      '<div style="min-width:220px"><label>Search reports</label>' +
        '<input type="text" id="rpSearch" placeholder="Name, email, chapter, book, text…" value="' +
        esc(S.rpSearch) + '"></div>' +
      '<div class="fixed" style="padding-bottom:10px">' +
        '<label style="margin:0"><input type="checkbox" id="rpFlagged"' +
          (S.rpFlagged ? ' checked' : '') + '> Flagged only</label></div>' +
      '<div><label>Submission type</label><select id="rpType">' +
        '<option value="">All types</option>' +
        '<option value="chapter_summary"' + (S.rpType === 'chapter_summary' ? ' selected' : '') +
          '>Chapter summary</option>' +
        '<option value="summary"' + (S.rpType === 'summary' ? ' selected' : '') +
          '>Summary</option>' +
        '<option value="final_summary"' + (S.rpType === 'final_summary' ? ' selected' : '') +
          '>Final summary</option>' +
      '</select></div>' +
      '<div class="fixed" style="padding-bottom:10px">' +
        '<span class="badge info">' + subs.length + ' submissions</span> ' +
        '<span class="badge lock" id="rpTableCount">' + subs.length + ' shown</span></div>' +
    '</div></div>' +
    '<div class="card"><div class="row export-buttons"><button type="button" class="ghost" data-export="print">Print</button><button type="button" class="ghost" data-export="pdf">PDF</button><button type="button" class="ghost" data-export="excel">Excel</button><button type="button" class="ghost" data-export="word">Word</button></div><table id="rpTable"><thead><tr>' +
      '<th>User</th><th>Type</th><th>Chapter / book</th><th>Submitted</th>' +
      '<th>Similarity</th><th>Status</th><th>Text</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  $('rpSearch').addEventListener('input', function () {
    S.rpSearch = this.value;
    applyTableSearch('rpTable', 'rpSearch');
  });
  applyTableSearch('rpTable', 'rpSearch');
}
/* ======================================================= settings ======== */
function selectOption(value, label, current, extraSelected) {
  const sel = String(value) === String(current) || extraSelected ? ' selected' : '';
  return '<option value="' + esc(String(value)) + '"' + sel + '>' + esc(label) + '</option>';
}
async function renderSettings() {
  const v = $('view-settings');
  v.innerHTML = loadMsg();
  let cur = {};
  try {
    const d = await API.get('/super/settings');
    cur = d.settings || d || {};
  } catch (e) { cur = {}; }
  try {
    const pub = await API.get('/public/portals');
    if (cur.programName == null) cur.programName = pub.programName;
    if (cur.programLogo == null) cur.programLogo = pub.programLogo;
  } catch (e) { /* keep whatever we have */ }
  S.settings = cur;

  let library = [];
  try { library = await ensure('library', '/library', 'library'); }
  catch (e) { v.innerHTML = errBox(e); return; }
  const letters = library.filter(function (i) { return i.type === 'letter'; });
  const videos = library.filter(function (i) { return i.type === 'video'; });

  const letterIds = letters.map(function (i) { return String(i.id); });
  let letterOpts = '<option value="">— unchanged —</option>' +
    letters.map(function (i) {
      return selectOption(i.id, i.title, cur.letterId, false);
    }).join('');
  if (cur.letterId && letterIds.indexOf(String(cur.letterId)) === -1) {
    letterOpts += '<option value="' + esc(String(cur.letterId)) + '" selected>' +
      'Current letter (' + esc(String(cur.letterId)) + ')</option>';
  }
  const videoIds = videos.map(function (i) { return String(i.id); });
  let videoOpts = '<option value="">— unchanged —</option>' +
    videos.map(function (i) {
      return selectOption(i.id, i.title, cur.letterVideoId, false);
    }).join('');
  if (cur.letterVideoId && videoIds.indexOf(String(cur.letterVideoId)) === -1) {
    videoOpts += '<option value="' + esc(String(cur.letterVideoId)) + '" selected>' +
      'Current video (' + esc(String(cur.letterVideoId)) + ')</option>';
  }

  v.innerHTML = '<h2>Settings</h2>' +
    '<div class="card"><h3>Program settings</h3><form id="settingsForm">' +
      '<div class="row">' +
        '<div><label>Program name</label><input type="text" id="stName" value="' +
          esc(cur.programName || '') + '"></div>' +
        '<div><label>Letter (certificates)</label><select id="stLetter">' +
          letterOpts + '</select></div>' +
        '<div><label>Letter video</label><select id="stVideo">' +
          videoOpts + '</select></div>' +
      '</div>' +
      '<label>Program logo (max 1.5 MB)</label>' +
      '<input type="file" id="stLogo" accept="image/*">' +
      '<div class="mt"><img id="stLogoImg" alt="Program logo" class="' +
        (cur.programLogo ? '' : 'hidden') + '" src="' + esc(cur.programLogo || '') +
        '" style="height:64px;border-radius:10px;border:1px solid var(--line);' +
        'padding:4px;background:#fff"></div>' +
      '<div class="mt"><button type="submit">Save settings</button></div>' +
    '</form></div>' +
    '<div class="card"><h3>Super login credentials</h3>' +
    '<p class="muted small">Leave a field blank to keep the current value.</p>' +
    '<form id="credForm"><div class="row">' +
      '<div><label>New username</label><input type="text" id="crUser" ' +
        'autocomplete="off"></div>' +
      '<div><label>New password</label><input type="password" id="crPw" ' +
        'autocomplete="new-password"></div>' +
    '</div>' +
    '<div class="mt"><button type="submit">Update credentials</button></div>' +
    '</form></div>';
}
async function saveSettings(e) {
  e.preventDefault();
  try {
    const body = {};
    const name = val('stName');
    if (name) body.programName = name;
    const logo = await logoDataUrl($('stLogo'));
    if (logo) body.programLogo = logo;
    const letter = val('stLetter');
    if (letter) body.letterId = letter;
    const video = val('stVideo');
    if (video) body.letterVideoId = video;
    if (!Object.keys(body).length) throw new Error('Nothing to update');
    await API.put('/super/settings', body);
    toast('Settings saved', 'ok');
    S.settings = {};
    renderSettings();
  } catch (err) { fail(err); }
}
async function saveCreds(e) {
  e.preventDefault();
  try {
    const body = {};
    const username = val('crUser');
    if (username) body.username = username;
    const password = $('crPw').value;
    if (password) body.password = password;
    if (!Object.keys(body).length) {
      throw new Error('Enter a new username and/or password');
    }
    await API.put('/super/settings', body);
    toast('Credentials updated', 'ok');
    $('crPw').value = '';
    $('crUser').value = '';
  } catch (err) { fail(err); }
}
/* ==================================================== event wiring ====== */
async function onAction(btn, e) {
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  try {
    switch (act) {
      /* portals */
      case 'p-add-win': {
        const box = $('pfWins');
        if (box) box.insertAdjacentHTML('beforeend', winRowHTML('', ''));
        break;
      }
      case 'win-del': {
        const row = btn.closest('.win-row');
        if (row) row.remove();
        break;
      }
      case 'p-edit':
        S.editPortalId = id;
        renderPortals();
        break;
      case 'p-cancel':
        S.editPortalId = null;
        renderPortals();
        break;
      case 'p-del':
        deletePortal(id);
        break;
      /* tenants */
      case 't-edit':
        S.editTenantId = id;
        renderAccounts();
        break;
      case 't-cancel':
        S.editTenantId = null;
        renderAccounts();
        break;
      case 't-del':
        deleteTenant(id);
        break;
      /* modules */
      case 'm-add-prompt': {
        const box = $('mfPrompts');
        if (box) box.insertAdjacentHTML('beforeend', promptRowHTML('', '#24508c'));
        break;
      }
      case 'm-prompt-del': {
        const row = btn.closest('.pr-row');
        if (row) row.remove();
        break;
      }
      case 'm-edit':
        S.editModuleId = id;
        renderModules();
        break;
      case 'm-cancel':
        S.editModuleId = null;
        renderModules();
        break;
      case 'm-del':
        deleteModule(id);
        break;
      /* library */
      case 'l-edit':
        S.editLibraryId = id;
        renderLibrary();
        break;
      case 'l-cancel':
        S.editLibraryId = null;
        renderLibrary();
        break;
      case 'l-del':
        deleteLibrary(id);
        break;
      /* books & chapters */
      case 'bk-add-ch': {
        const form = document.querySelector('.ch-form[data-book="' + id + '"]');
        if (form) {
          form.classList.toggle('hidden');
          const t = form.querySelector('.ch-title');
          if (t && !form.classList.contains('hidden')) t.focus();
        }
        break;
      }
      case 'bk-book-del':
        deleteBook(id);
        break;
      case 'bk-ch-edit':
        S.editChapterId = id;
        renderBooks();
        break;
      case 'bk-ch-cancel':
        S.editChapterId = null;
        renderBooks();
        break;
      case 'bk-ch-del':
        deleteChapter(id);
        break;
      case 'bk-q-add': {
        const form = btn.closest('form');
        const opts = form.querySelector('.q-opts');
        const radio = opts.querySelector('input[type=radio]');
        opts.insertAdjacentHTML('beforeend',
          qOptionRowHTML(radio ? radio.name : 'qc', '', false));
        break;
      }
      case 'bk-q-del': {
        const opts = btn.closest('.q-opts');
        if (opts.children.length <= 2) {
          toast('A question needs at least 2 options', 'err');
        } else {
          btn.closest('.q-opt').remove();
        }
        break;
      }
      case 'bk-obj-del':
        deleteObjective(id);
        break;
      /* users */
      case 'u-susp':
        toggleSuspend(id);
        break;
      case 'u-del':
        deleteUser(id);
        break;
      default:
        break;
    }
  } catch (err) { fail(err); }
}
function onSubmit(e) {
  const f = e.target;
  if (!f || f.tagName !== 'FORM') return;
  e.preventDefault();
  if (f.classList.contains('ch-form')) { addChapter(e); return; }
  if (f.classList.contains('ch-edit-form')) { editChapter(e); return; }
  if (f.classList.contains('q-form')) { addQuestion(e); return; }
  const map = {
    portalForm: savePortal,
    tenantForm: createTenant,
    tenantBrandForm: saveTenantBrand,
    moduleForm: saveModule,
    libraryForm: saveLibrary,
    bookForm: createBook,
    userForm: createUser,
    settingsForm: saveSettings,
    credForm: saveCreds
  };
  const fn = map[f.id];
  if (fn) fn(e);
}
function onChange(e) {
  const id = e.target.id;
  if (id === 'pfMode') {
    const w = $('pfWinsWrap');
    if (w) w.classList.toggle('hidden', e.target.value === 'always');
    return;
  }
  if (id === 'bkModule') {
    S.bookModuleId = e.target.value;
    S.editChapterId = null;
    renderBooks();
    return;
  }
  if (id === 'usTenant') {
    S.usersTenant = e.target.value;
    renderUsers();
    return;
  }
  if (id === 'rpFlagged') {
    S.rpFlagged = e.target.checked;
    renderReports();
    return;
  }
  if (id === 'rpType') {
    S.rpType = e.target.value;
    renderReports();
    return;
  }
  const previews = {
    tnLogo: 'tnLogoImg', tbLogo: 'tbLogoImg', stLogo: 'stLogoImg'
  };
  const imgId = previews[id];
  if (imgId) {
    logoDataUrl(e.target).then(function (url) {
      const img = $(imgId);
      if (url && img) {
        img.src = url;
        img.classList.remove('hidden');
      }
    }).catch(function (err) {
      toast(err.message, 'err');
      e.target.value = '';
    });
  }
}
function onInput(e) {
  if (e.target.id === 'tnName') {
    const slug = $('tnSlug');
    if (slug && slug.dataset.auto === '1') slug.value = slugify(e.target.value);
  }
}
function wireDelegates() {
  document.addEventListener('click', function (e) {
    const nav = e.target.closest ? e.target.closest('.side .nav-btn') : null;
    if (nav && nav.dataset.view) {
      showView(nav.dataset.view);
      return;
    }
    const btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (btn) onAction(btn, e);
  });
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
}
/* ---------------------------------------------------------- boot -------- */
wireDelegates();

$('superLoginForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  try {
    const data = await API.post('/auth/super-login', {
      username: val('slUser'),
      password: $('slPw').value
    });
    API.setToken(data.token);
    API.setUser(data.user);
    $('slPw').value = '';
    toast('Signed in', 'ok');
    init();
    /* the page is newer than the server? say so right away (see README) */
    warnIfStaleServer('super.analytics', 'super.analytics');
  } catch (err) { toast(err.message, 'err'); }
});

$('logoutBtn').addEventListener('click', function () { API.logout(); });

init();


















