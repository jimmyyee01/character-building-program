/* Feeds REAL API payloads (from a running backend) through the new renderers to
   catch exceptions and undefined/NaN leaks. Usage: node check_live_render.js [base] */
const fs = require('fs');
const vm = require('vm');
const BASE = (process.argv[2] || 'http://127.0.0.1:3000') + '/api';
const path = require('path');
const dir = path.join(__dirname, '..', 'public', 'js') + path.sep;

let bad = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || !extra ? '' : '  [' + String(extra).slice(0, 160) + ']'));
  if (!cond) bad++;
}
const realFetch = globalThis.fetch;   /* captured before any stub is installed */

function makeEl(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(), className: '', textContent: '', disabled: false,
    dataset: {}, _attrs: {}, style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() { return true; }, contains() { return false; } },
    setAttribute(k, v) { this._attrs[k] = String(v); }, getAttribute(k) { return this._attrs[k] == null ? null : this._attrs[k]; },
    appendChild() {}, remove() {}, click() {}, focus() {}, addEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }
  };
}
const doc = {
  addEventListener() {}, removeEventListener() {}, createElement: makeEl,
  getElementById: () => makeEl('div'), querySelector: () => null, querySelectorAll: () => [],
  body: makeEl('body'), documentElement: makeEl('html'), head: makeEl('head'),
  readyState: 'complete', title: ''
};
const ORIGIN = BASE.replace(/\/api$/, '');
function localFetch(url, opts) {
  const u = String(url);
  let abs;
  /* API.call() prefixes '/api' itself, so honour that instead of adding another */
  if (/^https?:/i.test(u)) abs = u;
  else if (/^\/api\//i.test(u)) abs = BASE + u.slice(4);
  else if (/^\/(uploads|f|assets|css|js)\//i.test(u)) abs = ORIGIN + u;
  else abs = BASE + u;
  return realFetch(abs, opts);
}
/* one isolated context per page, exactly like the browser (app.js and super.js
   each declare their own const S, so they cannot share a context) */
function memStore() {
  const store = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  };
}
function ctxFor(files) {
  const loc = { href: 'http://x/', pathname: '/', search: '', hash: '' };
  const sandbox = {
    document: doc, console: console, navigator: { userAgent: 'node' }, location: loc,
    localStorage: memStore(),
    Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    FileReader: function () { this.readAsDataURL = function () {}; },
    alert() {}, confirm: () => false, prompt: () => '',
    fetch: localFetch,
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval
  };
  sandbox.window = { location: loc, addEventListener() {}, print() {}, document: doc, setTimeout: setTimeout };
  const c = vm.createContext(sandbox);
  c.self = sandbox;
  files.forEach(function (f) {
    try { vm.runInContext(fs.readFileSync(dir + f, 'utf8'), c, { filename: f }); }
    catch (e) { console.log('LOAD ERROR ' + f + ': ' + e.message); bad++; }
  });
  return c;
}
const adminCtx = ctxFor(['common.js', 'admin.js']);
const superCtx = ctxFor(['common.js', 'super.js']);
const appCtx = ctxFor(['common.js', 'app.js']);
const run = (ctx, expr, args) => vm.runInContext(expr, ctx).apply(null, args || []);
const fn = (ctx, expr) => vm.runInContext(expr, ctx);
const chartOf = (expr, args) => run(adminCtx, expr, args);

async function api(path, token, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await realFetch(BASE + path, Object.assign({}, opts, { headers: headers }));
  return res.json();
}
async function login(body, path) {
  const d = await api(path || '/auth/login', null, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return d && d.token ? d.token : null;
}
/* any generated markup must never leak undefined/NaN/[object Object] */
function dirty(label, html) {
  const m = String(html).match(/undefined|NaN|\[object Object\]/);
  check('clean output: ' + label, !m,
    m ? String(html).slice(Math.max(0, String(html).indexOf(m[0]) - 70), String(html).indexOf(m[0]) + 40) : '');
}

/* A fake #view-book whose chapter buttons behave like the browser's: a disabled
   button never fires its handler, so "an inactive chapter responds to no click"
   is actually testable (the shared makeEl returns no elements for selectors). */
function bookViewEl() {
  const el = makeEl('div');
  const buttons = [];
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    set(v) {
      html = String(v);
      buttons.length = 0;
      (html.match(/<button[^>]*data-ch="[^"]+"[^>]*>/g) || []).forEach(function (tag) {
        const b = makeEl('button');
        b.dataset.ch = /data-ch="([^"]+)"/.exec(tag)[1];
        b.disabled = /\sdisabled(\s|>)/.test(tag + '>');
        b.onclick = null;
        b.click = function () { if (!this.disabled && typeof this.onclick === 'function') this.onclick(); };
        buttons.push(b);
      });
    },
    get() { return html; }
  });
  el.querySelectorAll = function (sel) { return sel === '[data-ch]' ? buttons : []; };
  el._buttons = buttons;
  return el;
}
/* a 25-character slice of text that survives esc() unchanged (for presence tests) */
function cleanSlice(s) {
  s = String(s || '');
  for (let i = 0; i + 25 <= s.length; i++) {
    const w = s.substr(i, 25);
    if (!/[&<>"']/.test(w)) return w;
  }
  return '';
}

(async function () {
  const admin = await login({ slug: 'greenfield-academy', identifier: 'admin@greenfield.edu', password: 'Admin@123' });
  check('login: tenant admin', !!admin);
  const stu = await login({ slug: 'greenfield-academy', identifier: 'STU-001', password: 'Student@123' });
  check('login: student', !!stu);
  const sup = await login({ username: 'superadmin', password: 'SuperAdmin@123' }, '/auth/super-login');
  check('login: super admin', !!sup);

  /* ------------------------------------------- student progress report ---- */
  const rep = await api('/reports/students', admin);
  check('report payload shape', rep.ok && Array.isArray(rep.students) && rep.students.length > 0);
  const table = run(adminCtx, 'progressTableHtml', [rep.students]);
  dirty('progress table', table);
  check('report table: one row per learner + expander only when finished',
    (table.match(/data-search=/g) || []).length === rep.students.length &&
    (table.match(/data-sum="/g) || []).length === rep.finished &&
    (table.match(/sum-row hidden/g) || []).length === rep.finished &&
    (table.match(/Not finished yet/g) || []).length === rep.students.length - rep.finished,
    'rows=' + rep.students.length + ' finished=' + rep.finished);
  let sumOk = true, sumMsg = '';
  rep.students.forEach(function (s) {
    if (!(s.moduleCount > 0 && s.modulesCompleted === s.moduleCount)) return;
    const row = run(adminCtx, 'summaryRowHtml', [s]);
    dirty('summary row (' + s.fullName + ')', row);
    if (row.indexOf('book-row') !== -1) {} /* keep linter quiet */
    if (row.indexOf('class="sum-row hidden" id="sum-' + s.id + '"') === -1) { sumOk = false; sumMsg = 'id mismatch for ' + s.fullName; }
  });
  check('every finished learner gets a well-formed summary row', sumOk, sumMsg);
  const supTable = run(superCtx, 'supProgressTable', [rep.students]);
  dirty('super progress table', supTable);
  check('super table includes the account column', supTable.indexOf('Greenfield Academy') !== -1);

  /* ------------------------------------------------- dashboards / charts -- */
  const ov = await api('/admin/overview', admin);
  const subs = await api('/admin/submissions', admin);
  const flagged = await api('/admin/submissions?flagged=1', admin);
  dirty('admin dashboard stat cards',
    run(adminCtx, 'statCard', [ov.counts.users, 'Users', 'blue']) +
    run(adminCtx, 'statCard', [ov.counts.submissions, 'Submissions', 'violet']) +
    run(adminCtx, 'statCard', [ov.counts.flagged, 'Flagged', 'red']) +
    run(adminCtx, 'statCard', [ov.counts.certificates, 'Certificates', 'green']));
  const byType = {};
  (subs.submissions || []).forEach(function (s) { byType[s.type] = (byType[s.type] || 0) + 1; });
  dirty('submissions-by-type chart',
    chartOf('chartBars', [Object.keys(byType).map(function (k) { return { label: k, value: byType[k] }; })]));
  dirty('copy-check donut', chartOf('chartDonut', [[
    { label: 'Original work', value: Math.max(0, ov.counts.submissions - (flagged.submissions || []).length), color: '#1f7a44' },
    { label: 'Flagged', value: (flagged.submissions || []).length, color: '#c62828' }], { centerLabel: 'submissions' }]));
  dirty('weekly activity chart', chartOf('chartWeekly', [subs.submissions || [], 8]));
  dirty('level distribution',
    chartOf('chartBarsH', [rep.students.map(function (s) { return { label: s.fullName, value: s.submissions }; })]));
  dirty('progress bars', chartOf('chartProgress',
    [rep.students[0].modules.map(function (m) { return { label: m.title, percent: m.percent }; })]));

  const st = await api('/super/overview', sup);
  const ts = st.tenants || [];
  dirty('users per account',
    chartOf('chartBarsH', [ts.map(function (t) { return { label: t.name, value: Number(t.users) || 0 }; })]));
  dirty('accounts per portal', chartOf('chartBars', [Object.keys(ts.reduce(function (a, t) {
    a[t.type || 'custom'] = (a[t.type || 'custom'] || 0) + 1; return a;
  }, {})).map(function (k) { return { label: k, value: 1 }; })]));

  /* ------------------------------------------------- library / books ------ */
  const lib = await api('/library', admin);
  const books = await api('/books?moduleId=mod_gamma', admin);
  const items = (lib.library || []).concat(books.books || []);
  let libOk = true, libMsg = '';
  items.forEach(function (it) {
    const ind = run(adminCtx, 'libIndicator', [it]);
    dirty('library indicator (' + (it.title || it.id) + ')', ind);
    if (ind.indexOf('<iframe') !== -1) { libOk = false; libMsg = 'embed in listing for ' + it.title; }
  });
  check('no library/book listing embeds a viewer', libOk, libMsg);
  const pdfItem = items.filter(function (i) { return /\.pdf($|[?#])/i.test(String(i.url || '')); })[0];
  check('pdf items render the closed cover (or none exist yet)',
    !pdfItem || (run(adminCtx, 'libIndicator', [pdfItem]).indexOf('book-open-card') !== -1 &&
      run(adminCtx, 'libIndicator', [pdfItem]).indexOf('Open book') !== -1),
    pdfItem ? run(adminCtx, 'libIndicator', [pdfItem]).slice(0, 90) : 'no pdf item in seed');

  /* ---------------------------------------------- learner-side builders --- */
  const dash = await api('/dashboard', stu);
  dirty('learner weekly chart', chartOf('chartWeekly', [dash.recent || [], 8]));
  const flow = await api('/flow', stu);
  dirty('learner module chart', chartOf('chartProgress', [(flow.modules || []).map(function (m) {
    return { label: m.title, percent: (m.progress && m.progress.percent) || 0 };
  })]));
  dirty('learner stat strip',
    run(appCtx, 'statCard', [Math.round((flow.performance || {}).overall || 0) + '%', 'Overall performance', 'blue']) +
    run(appCtx, 'statCard', [(flow.modules || []).length, 'Modules completed', 'teal']));
  const mark = run(appCtx, 'portalMarkSrc', ['Greenfield Academy', '#0f766e']);
  check('monogram fallback still renders', mark.indexOf('data:image/svg+xml') === 0);

  /* ------------------- an inactive chapter responds to no click at all ---- */
  {
    const book = await api('/book/book_gamma_1', stu);
    const real = (book.chapters || []).filter(function (c) { return c.status === 'locked'; })[0];
    /* drive the real payload, with the first chapter open and the second still
       inactive, so this runs whatever state the database happens to be in */
    const probe = JSON.parse(JSON.stringify(book));
    if (probe.chapters.length > 1) {
      probe.chapters[0].status = 'active';
      probe.chapters[0].submission = null;
      probe.chapters[1].status = 'locked';
      probe.chapters[1].submission = null;
      probe.stage = 'chapters';
    }
    const openCh = probe.chapters[0];
    const lockedCh = probe.chapters[1];
    check('book payload has chapters to compare', !!openCh && !!lockedCh, 'chapters=' + probe.chapters.length);

    if (openCh && lockedCh) {
    const view = bookViewEl();
    const realGet = appCtx.document.getElementById;
    /* signed in, like the real page — API.call() reads the token from localStorage */
    run(appCtx, 'API.setToken', [stu]);
    appCtx.document.getElementById = function (id) { return id === 'view-book' ? view : makeEl('div'); };
    appCtx.__probe = probe;
    vm.runInContext('S.bookData = __probe; S.selectedChapterId = null;', appCtx);
    run(appCtx, 'renderBook');
    const html = view.innerHTML;
    dirty('book view with an inactive chapter', html);

    const tagOf = function (id) {
      const m = new RegExp('<button[^>]*data-ch="' + id + '"[^>]*>').exec(html);
      return m ? m[0] : '';
    };
    check('an inactive chapter is a disabled button (with the reason on it)',
      /\sdisabled/.test(tagOf(lockedCh.id)) && /\blocked\b/.test(tagOf(lockedCh.id)) &&
      tagOf(lockedCh.id).indexOf('unlock this one') !== -1, tagOf(lockedCh.id));
    check('an open chapter is still clickable', !/\sdisabled/.test(tagOf(openCh.id)), tagOf(openCh.id));

    const btnOf = function (id) {
      return view._buttons.filter(function (b) { return b.dataset.ch === id; })[0] || null;
    };
    vm.runInContext('S.selectedChapterId = null;', appCtx);
    const lockedBtn = btnOf(lockedCh.id);
    if (lockedBtn) lockedBtn.click();
    check('clicking an inactive chapter changes nothing (no handler, button disabled)',
      vm.runInContext('S.selectedChapterId', appCtx) === null &&
      (!lockedBtn || (lockedBtn.disabled === true && lockedBtn.onclick === null)));

    const openBtn = btnOf(openCh.id);
    if (openBtn) openBtn.click();
    check('clicking the open chapter still opens it',
      vm.runInContext('S.selectedChapterId', appCtx) === openCh.id,
      String(vm.runInContext('S.selectedChapterId', appCtx)));

    /* nothing behind the lock: no text, no pages, no form */
    const lockedPanel = run(appCtx, 'chapterPanel',
      [{ book: { pdf: '/f/chapter.pdf' }, module: { mode: 'summary' } },
        { status: 'locked', title: lockedCh.title, content: 'SECRET CHAPTER TEXT',
          pageStart: 3, pageEnd: 5 }]);
    dirty('inactive chapter panel', lockedPanel);
    check('an inactive chapter reveals no text, no pages and no form',
      lockedPanel.indexOf('SECRET CHAPTER TEXT') === -1 &&
      lockedPanel.indexOf('chapter-book') === -1 && lockedPanel.indexOf('<iframe') === -1 &&
      lockedPanel.indexOf('<textarea') === -1 && lockedPanel.indexOf('chSubmit') === -1 &&
      lockedPanel.indexOf('objBox') === -1 && lockedPanel.indexOf('unlock this one') !== -1,
      lockedPanel.slice(0, 140));

    /* a stale selection must not render an inactive chapter either */
    vm.runInContext('S.selectedChapterId = ' + JSON.stringify(lockedCh.id) + ';', appCtx);
    run(appCtx, 'renderBook');
    const forced = view.innerHTML;
    const openSnip = cleanSlice(openCh.content);
    const lockSnip = cleanSlice(lockedCh.content);
    check('a forced inactive selection falls back to the open chapter',
      (openSnip === '' || forced.indexOf(openSnip) !== -1) &&
      (lockSnip === '' || forced.indexOf(lockSnip) === -1),
      'open="' + openSnip.slice(0, 18) + '" locked="' + lockSnip.slice(0, 18) + '"');

    /* and the same rule, judged on the untouched payload when it has a lock */
    if (real) {
      const realPanel = run(appCtx, 'chapterPanel', [book, real]);
      check('the payload\'s own inactive chapter is a heading + reason only',
        realPanel.indexOf('unlock this one') !== -1 && realPanel.indexOf('chapter-book') === -1 &&
        realPanel.indexOf('<textarea') === -1 && realPanel.indexOf(String(real.title)) !== -1);
    }
    appCtx.document.getElementById = realGet;
    }
  }

  /* ------------------------------------------ real PDF upload end-to-end -- */
  const pdfText = '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
    '2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj\n' +
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj\n' +
    '4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj\n' +
    '5 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj\n' +
    'trailer << /Root 1 0 R /Size 6 >>\n%%EOF\n';
  const up = await api('/library', sup, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'book', title: 'Live Upload Check', scope: 'global',
      file: { name: 'live-upload-check.pdf', base64: Buffer.from(pdfText, 'latin1').toString('base64') } })
  });
  check('upload a PDF book', up.ok && up.item && /\.pdf$/i.test(String(up.item.url)), JSON.stringify(up).slice(0, 120));
  if (up.item) {
    const listing = run(adminCtx, 'libIndicator', [up.item]);
    dirty('uploaded pdf listing', listing);
    check('uploaded PDF does not open by itself (cover only)',
      listing.indexOf('book-open-card') !== -1 && listing.indexOf('<iframe') === -1 && listing.indexOf('book-reader') === -1,
      listing.slice(0, 90));
    const pages = await run(adminCtx, 'pdfPageCount', [up.item.url]);
    check('page count of the uploaded PDF is 3', pages === 3, 'got ' + pages);
    const rm = await api('/library/' + up.item.id, sup, { method: 'DELETE' });
    check('uploaded test book cleaned up', rm.ok || rm.error !== undefined);
  }

  /* --------------------------- super dashboard (live overview data) ------- */
  {
    const ov = await api('/super/overview', sup);
    check('super overview payload: counts + per-tenant rows',
      ov.ok && !!ov.counts && Array.isArray(ov.tenants) && ov.tenants.length > 0,
      'status keys=' + Object.keys(ov.counts || {}).length + ' tenants=' + (ov.tenants || []).length);
    const view = makeEl('div');
    const realGet = superCtx.document.getElementById;
    /* sign in inside the context: API.call() sends the token from localStorage */
    run(superCtx, 'API.setToken', [sup]);
    run(superCtx, 'API.setUser', [{ role: 'super', username: 'superadmin' }]);
    superCtx.document.getElementById = function (id) { return id === 'view-dashboard' ? view : makeEl('div'); };
    await run(superCtx, 'renderDashboard');
    superCtx.document.getElementById = realGet;
    const html = view.innerHTML;
    dirty('super dashboard', html);
    check('super dashboard renders its cards, charts and tenants table',
      html.indexOf('Statistics') !== -1 && html.indexOf('Tenants overview') !== -1 &&
      html.indexOf('No tenants yet') === -1 &&
      html.indexOf(run(superCtx, 'esc', [ov.tenants[0].name])) !== -1,
      html.slice(0, 140));
  }

  /* -------------------------------------------- super analytics render --- */
  const an = await api('/super/analytics', sup);
  check('analytics payload for the renderers', an.ok && Array.isArray(an.portals) && Array.isArray(an.modules));
  if (an.ok) {
    dirty('analytics filters', run(superCtx, 'analyticsFiltersHtml', [an]));
    dirty('analytics KPI cards', run(superCtx, 'analyticsKpisHtml', [an]));
    const charts = run(superCtx, 'analyticsChartsHtml', [an]);
    dirty('analytics charts', charts);
    check('analytics draws many charts', (charts.match(/<svg|class="bars"/g) || []).length >= 8,
      'charts=' + (charts.match(/<svg|class="bars"/g) || []).length);
    dirty('accounts table', run(superCtx, 'accountsTableHtml', [an.accounts || []]));
    dirty('learners table', run(superCtx, 'learnersTableHtml', [an.learners || []]));
    dirty('module/book/chapter analysis', run(superCtx, 'analyticsModulesCard', [an]));
    check('module analysis reaches chapter level',
      run(superCtx, 'analyticsModulesCard', [an]).indexOf('Key words') !== -1 &&
      run(superCtx, 'analyticsModulesCard', [an]).indexOf('Accuracy') !== -1);
  }

  /* -------------------------------------------- account analytics render -- */
  const aa = await api('/admin/analytics', admin);
  check('account analytics payload for the renderers', aa.ok && Array.isArray(aa.accounts) && Array.isArray(aa.flagged));
  if (aa.ok) {
    dirty('account analytics filters', run(adminCtx, 'astatFiltersHtml', [aa]));
    dirty('account analytics KPI cards', run(adminCtx, 'astatKpisHtml', [aa]));
    const ach = run(adminCtx, 'astatChartsHtml', [aa]);
    dirty('account analytics charts', ach);
    check('account analytics draws many charts', (ach.match(/<svg|class="bars"/g) || []).length >= 7,
      'charts=' + (ach.match(/<svg|class="bars"/g) || []).length);
    dirty('account individuals table', run(adminCtx, 'astatLearnersHtml', [aa]));
    dirty('account module/book/chapter analysis', run(adminCtx, 'astatModulesHtml', [aa]));
    dirty('account copy flags', run(adminCtx, 'astatFlagsHtml', [aa]));
    check('account scope never leaves this account',
      (aa.filters.tenants || []).length === 1 && (aa.accounts || []).length === 1,
      JSON.stringify((aa.accounts || []).map(a => a.name)));
  }

  check('a stale server is reported clearly instead of a grey error',
    run(adminCtx, 'isStaleServerError', ['Unknown endpoint: GET /api/admin/analytics']) === true &&
    run(adminCtx, 'isStaleServerError', ['Something else failed']) === false &&
    run(adminCtx, 'staleServerHtml', ['2026-01-01-build', ['admin.analytics']])
      .indexOf('newer than the server') !== -1);
  check('the deployment notice separates stale files from a stale backend',
    (function () {
      const filesNewBackendOld = run(adminCtx, 'deploymentNoticeHtml',
        [{ files: { build: 'b9' }, server: null }]);
      const bothOld = run(adminCtx, 'deploymentNoticeHtml', [{ files: null, server: null }]);
      const mismatch = run(adminCtx, 'deploymentNoticeHtml',
        [{ files: { build: 'b9' }, server: { build: 'b1', features: [] } }]);
      return filesNewBackendOld.indexOf('backend process') !== -1 &&
        filesNewBackendOld.indexOf('b9') !== -1 &&
        bothOld.indexOf('document root') !== -1 &&
        mismatch.indexOf('restart the backend') !== -1 &&
        filesNewBackendOld.indexOf('apache2') !== -1 &&
        filesNewBackendOld.indexOf('which-backend.sh') !== -1 &&
        filesNewBackendOld.indexOf('restart-backend.sh') !== -1 &&
        filesNewBackendOld.indexOf('php8.2-fpm') === -1;
    })());

  check('the deployment notice separates "never reached the app" from "old app copy"',
    (function () {
      const html = run(adminCtx, 'deploymentNoticeHtml',
        [{ files: { build: 'b9' }, server: null,
           health: { status: 404, html: true, body: '<!DOCTYPE HTML ...<TITLE>Not Found</TITLE>' } }]);
      const json = run(adminCtx, 'deploymentNoticeHtml',
        [{ files: { build: 'b9' }, server: null,
           health: { status: 404, json: true, body: '{"ok":false,"error":"Unknown endpoint: GET /api/health"}' } }]);
      return html.indexOf('never reached the app') !== -1 &&
        html.indexOf('AllowOverride') !== -1 &&
        html.indexOf('php/api.php?r=/health') !== -1 &&
        json.indexOf('older copy of the app') !== -1 &&
        json.indexOf('cache-clear.php') !== -1 &&
        json.indexOf('route table') !== -1;
    })());
  check('the stale notice prints the raw /api/health reply for pasting',
    (function () {
      const out = run(adminCtx, 'deploymentNoticeHtml',
        [{ files: { build: 'b9' }, server: null,
           health: { status: 404, json: true, body: '{"ok":false,"error":"Unknown endpoint: GET /api/health"}' } }]);
      return out.indexOf('replied <b>404</b>') !== -1 &&
        out.indexOf('Unknown endpoint: GET /api/health') !== -1;
    })());

  console.log(bad ? '\n' + bad + ' FAILED' : '\nLIVE RENDER OK');
  process.exit(bad ? 1 : 0);
})().catch(function (e) { console.log('FATAL ' + e.message); process.exit(1); });

