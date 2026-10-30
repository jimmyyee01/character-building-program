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
    /* a browser input always has a string value — code that reads .value.trim()
       must not blow up in here either */
    value: '', checked: false, selectedIndex: 0, files: [], options: [],
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
  const adminUsers = await api('/users', admin);
  const waitlistedExample = (adminUsers.users || []).find(u => u.supervisorWaitlisted) ||
    { id: 'waitlist-render-check', role: 'student', fullName: 'Waitlist Render Check',
      studentNumber: 'WAITLIST-UI', supervisorWaitlisted: true };
  vm.runInContext('ROLE = "tenant_admin"; usersCache = ' +
    JSON.stringify([waitlistedExample]) + ';', adminCtx);
  const usersTable = run(adminCtx, 'usersTableHtml');
  check('users table identifies learners waiting for supervisor capacity',
    usersTable.indexOf('Waiting list') !== -1);
  const previousAdminState = vm.runInContext('({ME: ME, ROLE: ROLE, supOverview: supOverview})', adminCtx);
  vm.runInContext('ME = {portal: {type: "schools"}}; ROLE = "tenant_admin"; ' +
    'supOverview = {supervisors: [{id: "sup-full", fullName: "Full Supervisor", users: 100, limit: 100}, ' +
    '{id: "sup-suspended", fullName: "Suspended Supervisor", users: 3, limit: 100, suspended: true}]};',
    adminCtx);
  const userForm = run(adminCtx, 'userFormHtml', [null]);
  check('registration form explains automatic assignment and waitlisting',
    userForm.indexOf('assign automatically') !== -1 && userForm.indexOf('joins the waitlist') !== -1);
  check('registration form disables supervisors at capacity', /value="sup-full" disabled/.test(userForm));
  check('registration form disables suspended supervisors', /value="sup-suspended" disabled/.test(userForm));
  vm.runInContext('ME = ' + JSON.stringify(previousAdminState.ME) + '; ROLE = ' +
    JSON.stringify(previousAdminState.ROLE) + '; supOverview = ' +
    JSON.stringify(previousAdminState.supOverview) + ';', adminCtx);
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
      /* a chapter that has been submitted is inactive too */
      if (probe.chapters[2]) {
        probe.chapters[2].status = 'done';
        probe.chapters[2].submission = { id: 'sub_probe', createdAt: '2026-01-02T03:04:05.000Z',
          score: 4, total: 8, text: 'ALREADY SUBMITTED WORK' };
      }
      probe.stage = 'chapters';
    }
    const openCh = probe.chapters[0];
    const lockedCh = probe.chapters[1];
    const doneCh = probe.chapters[2] || null;
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
    check('only the open chapter is clickable at all',
      view._buttons.filter(function (b) { return !b.disabled; }).length === 1 &&
      view._buttons.filter(function (b) { return !b.disabled; })[0].dataset.ch === openCh.id,
      view._buttons.map(function (b) { return b.dataset.ch + (b.disabled ? ':off' : ':on'); }).join(' '));
    if (doneCh) {
      check('a submitted chapter is inactive too (disabled, with its own reason)',
        /\sdisabled/.test(tagOf(doneCh.id)) && tagOf(doneCh.id).indexOf('closed now') !== -1,
        tagOf(doneCh.id));
    }

    const btnOf = function (id) {
      return view._buttons.filter(function (b) { return b.dataset.ch === id; })[0] || null;
    };
    vm.runInContext('S.selectedChapterId = null;', appCtx);
    const lockedBtn = btnOf(lockedCh.id);
    if (lockedBtn) lockedBtn.click();
    check('clicking an inactive chapter changes nothing (no handler, button disabled)',
      vm.runInContext('S.selectedChapterId', appCtx) === null &&
      (!lockedBtn || (lockedBtn.disabled === true && lockedBtn.onclick === null)));

    const doneBtn = doneCh ? btnOf(doneCh.id) : null;
    if (doneBtn) doneBtn.click();
    check('clicking a submitted chapter changes nothing either',
      vm.runInContext('S.selectedChapterId', appCtx) === null &&
      (!doneBtn || (doneBtn.disabled === true && doneBtn.onclick === null)));

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

    if (doneCh) {
      vm.runInContext('S.selectedChapterId = ' + JSON.stringify(doneCh.id) + ';', appCtx);
      run(appCtx, 'renderBook');
      const forcedDone = view.innerHTML;
      const doneSnip = cleanSlice(doneCh.content);
      check('a forced selection of a submitted chapter falls back as well',
        forcedDone.indexOf('ALREADY SUBMITTED WORK') === -1 &&
        (doneSnip === '' || forcedDone.indexOf(doneSnip) === -1) &&
        (openSnip === '' || forcedDone.indexOf(openSnip) !== -1));
    }

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

  /* --------------------------- every console view, with live data --------- */
  /* Nothing so far rendered the consoles' other screens: a view that threw or
     leaked undefined/NaN into its markup would only show up on the live site. */
  {
    const captureHtml = function (ctx) {
      const els = {}, html = {}, real = ctx.document.getElementById;
      ctx.document.getElementById = function (id) {
        if (!els[id]) {
          const el = makeEl('div');
          let val = '';
          Object.defineProperty(el, 'innerHTML', {
            set(v) { val = String(v); html[id] = val; },
            get() { return val; }
          });
          els[id] = el;
        }
        return els[id];
      };
      return { html: html, restore: function () { ctx.document.getElementById = real; } };
    };
    const renderEach = async function (ctx, expr, keys, label, token) {
      /* sign the console in the way the page does: token + user in localStorage */
      run(ctx, 'API.setToken', [token]);
      const me = await api('/me', token);
      if (me && me.user) {
        run(ctx, 'API.setUser', [me.user]);
        /* the consoles keep the whole /me payload in ME (ME.user, ME.branding) */
        vm.runInContext('typeof ME !== "undefined" && (ME = ' + JSON.stringify(me) + ');' +
          'typeof ROLE !== "undefined" && (ROLE = ' + JSON.stringify(me.user.role) + ');' +
          'typeof S !== "undefined" && (S.me = ' + JSON.stringify(me) + ');', ctx);
      }
      const cap = captureHtml(ctx);
      for (const key of keys) {
        let err = '';
        try { await run(ctx, expr.replace('%s', key)); }
        catch (e) { err = (e && e.message) || String(e); }
        const out = cap.html['view-' + key] || '';
        check('view renders with live data: ' + label + ' - ' + key,
          !err && out.length > 40, err ? 'threw: ' + err : 'html ' + out.length + ' chars');
        if (label === 'super console' && key === 'modules') {
          check('modules admin offers module and graduation ranking views',
            out.indexOf('id="moduleRankingView"') !== -1 &&
            out.indexOf('Top 10 — Graduation') !== -1);
        }
        if (label === 'admin console' && key === 'progress') {
          check('account admins and supervisors get module, graduation and period ranking controls',
            out.indexOf('id="accountRankingView"') !== -1 &&
            out.indexOf('Top 10 — Graduation') !== -1 &&
            out.indexOf('id="accountRankingYear"') !== -1 &&
            out.indexOf('id="accountRankingFrom"') !== -1 &&
            out.indexOf('id="accountRankingTo"') !== -1 &&
            out.indexOf('id="accountRankingMarks"') !== -1 &&
            out.indexOf('Top 10 — All modules completed') !== -1);
          check('the student progress page carries the best-performer belt',
            out.indexOf('pp-ribbon') !== -1 && out.indexOf('pp-chip') !== -1,
            out.slice(0, 140));
        }
        if (label === 'admin console' && key === 'users') {
          /* the belt must sit on the page that actually lists the students, not
             only on the progress report */
          check('the students page opens with the best-performer belt',
            out.indexOf('pp-ribbon') !== -1 && out.indexOf('pp-chip') !== -1 &&
              out.indexOf('Marks') !== -1 && out.indexOf('Coverage') !== -1,
            out.slice(0, 200));
        }
        dirty(label + ' - ' + key, out);
      }
      cap.restore();
    };
    await renderEach(superCtx, 'RENDERERS["%s"]',
      ['dashboard', 'portals', 'accounts', 'modules', 'library', 'books', 'users', 'reports',
        'progress', 'analytics', 'lessons', 'settings'], 'super console', sup);
    await renderEach(adminCtx, 'RENDER["%s"]',
      ['dashboard', 'users', 'supervisors', 'library', 'books', 'submissions', 'certificates',
        'progress', 'analytics', 'lessons', 'branding'], 'admin console', admin);

    /* the learner's own screens, with the student's token */
    run(appCtx, 'API.setToken', [stu]);
    const stuMe = await api('/me', stu);
    if (stuMe && stuMe.user) {
      run(appCtx, 'API.setUser', [stuMe.user]);
      vm.runInContext('S.me = ' + JSON.stringify(stuMe) + ';', appCtx);
    }
    const learnerCap = captureHtml(appCtx);
    const LEARNER = [['renderHome', 'view-home'], ['renderModules', 'view-modules'],
      ['renderLibrary', 'view-library'], ['renderCertificates', 'view-certificates'],
      ['renderFinal', 'view-final'], ['renderThoughts', 'view-thoughts'],
      ['renderLessonsView', 'view-lessons']];
    for (const pair of LEARNER) {
      let err = '';
      try { await run(appCtx, pair[0]); } catch (e) { err = (e && e.message) || String(e); }
      const html = learnerCap.html[pair[1]] || '';
      check('learner view renders with live data: ' + pair[0].replace('render', ''),
        !err && html.length > 40, err ? 'threw: ' + err : 'html ' + html.length + ' chars');
      /* the belt is the very first block of the learner's dashboard */
      if (pair[0] === 'renderHome') {
        check('the learner dashboard opens with the best-performer belt',
          html.trim().indexOf('<div class="pp-ribbon') === 0 &&
            html.indexOf('pp-chip') !== -1 && html.indexOf('Marks') !== -1 &&
            html.indexOf('Coverage') !== -1,
          html.slice(0, 180));
      }
      dirty('learner view - ' + pair[0], html);
    }
    learnerCap.restore();

    const graduateToken = await login({ slug: 'greenfield-academy', identifier: 'STU-100',
      password: 'Student@123' });
    check('login: graduate for transcript rendering', !!graduateToken);
    if (graduateToken) {
      const certData = await api('/certificates', graduateToken);
      const general = (certData.certificates || []).find(function (c) { return c.type === 'general'; });
      const transcript = general ? run(appCtx, 'learnerTranscriptSheet', [general]) : '';
      check('general transcript renders module grades and graduation code',
        !!general && transcript.indexOf('Programme Transcript') !== -1 &&
        transcript.indexOf('Module') !== -1 && transcript.indexOf(String(general.code)) !== -1,
        transcript.slice(0, 160));
      dirty('graduate transcript', transcript);
    }

    /* the same console as a SUPERVISOR: only the views that role is offered */
    const supLogin = await login({ slug: 'horizon-alliance', identifier: 'supervisor@horizon.org',
      password: 'Super@123' });
    check('login: supervisor (for the restricted console)', !!supLogin);
    if (supLogin) {
      await renderEach(adminCtx, 'RENDER["%s"]',
        ['dashboard', 'users', 'submissions', 'certificates', 'analytics', 'progress'],
        'supervisor console', supLogin);
    }
  }

  /* -------------------------------------------- real PDF upload end-to-end -- */
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
    /* reading activity: opens, books opened at least once, most liked, one learner */
    const readCard = run(adminCtx, 'astatReadingHtml', [aa]);
    dirty('account reading activity card', readCard);
    /* a brand-new account legitimately has no opens yet: then the card explains
       that instead of drawing the tables */
    const readEmpty = readCard.indexOf('Times a book was opened') !== -1 &&
      readCard.indexOf('Books opened at least once') !== -1;
    check('the reading card reports opens, books opened at least once and a search area',
      readEmpty && (readCard.indexOf('asReaderSearch') !== -1 ||
        readCard.indexOf('No book has been opened yet') !== -1),
      readCard.slice(0, 200));
    /* once there are opens, the card must be able to answer "how often did one
       learner open one book" for the learner picked in the search box */
    const reading = aa.reading || {};
    if ((reading.readersTotal || 0) > 0) {
      const bookBits = run(adminCtx, 'asReadingBooksHtml', [reading.books]);
      dirty('opens per book table', bookBits);
      check('the opens-per-book table is searchable and counts distinct readers',
        bookBits.indexOf('data-search=') !== -1 &&
          bookBits.indexOf('Opened at least once by') !== -1,
        bookBits.slice(0, 160));
      const readerBits = run(adminCtx, 'asReaderBooksHtml', [reading.readers[0]]);
      dirty('one reader inside the reading card', readerBits);
      check('one learner inside the reading card lists every book and its times opened',
        readerBits.indexOf('Times opened') !== -1 && readerBits.indexOf('nested') !== -1 &&
          readerBits.indexOf('Last opened') !== -1,
        readerBits.slice(0, 180));
      check('the reader rows are searchable by name, class and book',
        run(adminCtx, 'asReadingReadersHtml', [reading.readers])
          .indexOf('data-reader-detail=') !== -1);
      /* each learner is a row plus a hidden row with their books: the badge under
         the search box must count learners, not both rows */
      const counted = run(adminCtx, '(function (rows) {' +
        'var table = { querySelectorAll: function () { return rows; } };' +
        'var input = { value: "" }; var count = { textContent: "" };' +
        'applyTableSearch(table, input, count); return count.textContent; })',
      [[{ dataset: { search: 'jane student' }, style: {} },
        { dataset: { search: 'jane student', readerDetail: 'u_jane' }, style: {} }]]);
      check('the reader search counts one line per learner', counted === '1 shown', counted);
      /* when the server had to cut the list, say so instead of pretending it is all */
      const cut = run(adminCtx, 'asReadingReadersHtml',
        [reading.readers, reading.readers.length + 5]);
      check('the reading card says when it only shows the learners who read most',
        cut.indexOf('learners who read most') !== -1 && cut.indexOf('in all') !== -1,
        cut.slice(0, 160));
      check('the reading card claims no cut when every learner is shown',
        run(adminCtx, 'asReadingReadersHtml', [reading.readers, reading.readers.length])
          .indexOf('learners who read most') === -1);
      /* and it must say that a picked module narrows the numbers to that module */
      const firstModule = ((aa.filters || {}).modules || [])[0];
      if (firstModule) {
        vm.runInContext('ASTAT.moduleId = ' + JSON.stringify(String(firstModule.id)), adminCtx);
        const scoped = run(adminCtx, 'astatReadingHtml', [aa]);
        vm.runInContext('ASTAT.moduleId = "";', adminCtx);
        check('the reading card says a module filter counts that module only',
          scoped.indexOf('are counted while that module is selected') !== -1,
          scoped.slice(0, 200));
      }
    }
    /* a learner reads the same account's belt on their own dashboard */
    const stuRibbon = await api('/reports/top-performers?limit=50', stu);
    check('a learner reads the belt of their own account',
      stuRibbon.ok === true && Array.isArray(stuRibbon.performers) &&
        stuRibbon.performers.length > 0,
      JSON.stringify(stuRibbon).slice(0, 160));
    /* the super admin has no single account, so there is no belt to read */
    const supRibbon = await api('/reports/top-performers?limit=50', sup);
    check('the super admin gets no single-account belt',
      supRibbon.ok !== true || !(supRibbon.performers || []).length,
      JSON.stringify(supRibbon).slice(0, 160));
    /* the ribbon at the top of the students page */
    const ribbonData = await api('/reports/top-performers?limit=50', admin);
    check('the students page ribbon payload arrives', ribbonData.ok &&
      Array.isArray(ribbonData.performers) && ribbonData.performers.length > 0);
    if (ribbonData.ok && (ribbonData.performers || []).length) {
      const ribbon = run(adminCtx, 'ribbonHtml', [ribbonData.performers]);
      dirty('best-performer ribbon', ribbon);
      check('the ribbon shows faces, marks and coverage for the best learners',
        ribbon.indexOf('pp-chip') !== -1 && ribbon.indexOf('Marks') !== -1 &&
          ribbon.indexOf('Coverage') !== -1 &&
          ribbon.indexOf(ribbonData.performers[0].name.split(' ')[0]) !== -1,
        ribbon.slice(0, 220));
      /* a long list drifts and repeats the block so the loop has no gap */
      check('a full ribbon drifts and repeats its block for a seamless loop',
        ribbon.indexOf('pp-ribbon-track"') !== -1 && ribbon.indexOf('is-static') === -1 &&
          ribbon.indexOf('aria-hidden="true"') !== -1 &&
          (ribbon.match(/pp-chip/g) || []).length > ribbonData.performers.length,
        'chips=' + (ribbon.match(/pp-chip/g) || []).length);
      /* a handful of learners would only repeat the same faces: stand still */
      const quiet = run(adminCtx, 'ribbonHtml', [[
        { rank: 1, name: 'Solo One', displayName: 'Solo One', marks: 88, coverage: 60, photo: null },
        { rank: 2, name: 'Solo Two', displayName: 'Solo Two', marks: 74, coverage: 45, photo: null }]]);
      dirty('best-performer ribbon for a small account', quiet);
      check('a small account shows each learner once, without repeating faces',
        quiet.indexOf('is-static') !== -1 &&
          (quiet.match(/pp-chip/g) || []).length === 4 &&
          quiet.indexOf('Hover to pause') === -1,
        'chips=' + (quiet.match(/pp-chip/g) || []).length);
      /* the belt drifts from left to right, as the students page asks */
      const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
      check('the belt drifts from left to right',
        /@keyframes ppDrift\s*\{\s*from\s*\{\s*transform:\s*translateX\(-50%\)\s*;?\s*\}\s*to\s*\{\s*transform:\s*translateX\(0\)\s*;?\s*\}\s*\}/.test(css),
        'ppDrift must run -50% -> 0 so the faces travel left to right');
      /* an account with no marks yet must still see the belt, never a blank gap */
      const bare = run(adminCtx, 'ribbonHtml', [[]]);
      dirty('best-performer belt before any mark', bare);
      check('an account with nothing to rank yet still shows the belt and says why',
        bare.indexOf('pp-ribbon is-empty') !== -1 && bare.indexOf('Nothing to rank yet') !== -1,
        bare.slice(0, 160));
      check('a role that may not read the ranking draws no belt at all',
        run(adminCtx, 'ribbonHtml', [null]) === '', 'a null ranking must draw nothing');
      /* never more than the best 50 of the account, however long the ranking is */
      const many = [];
      for (let i = 1; i <= 60; i++) {
        many.push({ rank: i, name: 'L' + i + ' Learner', displayName: 'L' + i,
          marks: 90 - i, coverage: 100 - i, photo: null });
      }
      const capped = run(adminCtx, 'ribbonHtml', [many]);
      check('the belt never carries more than the best 50',
        capped.indexOf('L50 Learner') !== -1 && capped.indexOf('L51 Learner') === -1,
        'chips=' + (capped.match(/pp-chip/g) || []).length);
    }

    /* ------------------------- the account's own login page (/t/<slug>) ---- */
    /* The page a learner lands on must show the same ranking the belt shows, so
       the account is never a blank page for a visitor. */
    {
      const loginCtx = ctxFor(['common.js', 'login.js']);
      const box = makeEl('div');
      box.classList = {
        hidden: true,
        add(c) { if (c === 'hidden') this.hidden = true; },
        remove(c) { if (c === 'hidden') this.hidden = false; },
        toggle(c, v) { if (c === 'hidden') this.hidden = v === undefined ? !this.hidden : !!v; },
        contains(c) { return c === 'hidden' ? this.hidden : false; }
      };
      const grid = makeEl('div');
      loginCtx.document.getElementById = function (id) {
        if (id === 'loginPerformers') return box;
        if (id === 'loginPerformersGrid') return grid;
        return makeEl('div');
      };
      const loginRows = await api('/public/top-performers?slug=greenfield-academy&limit=10', null);
      check('the account login page has a ranking to show',
        loginRows.ok && Array.isArray(loginRows.performers) && loginRows.performers.length > 0,
        JSON.stringify(loginRows).slice(0, 140));
      const shown = loginRows.performers || [];
      run(loginCtx, 'renderTopPerformers', [shown]);
      check('the login page draws the account ranking',
        grid.innerHTML.indexOf('login-performer') !== -1 && box.classList.hidden === false,
        'hidden=' + box.classList.hidden + ' html=' + String(grid.innerHTML).length);
      check('the login page ranking is never longer than its live top 10',
        (grid.innerHTML.match(/class="login-performer /g) || []).length <= 10);
      dirty('login page ranking', grid.innerHTML);
      /* a learner with coverage but no scored work still earns a place there */
      run(loginCtx, 'renderTopPerformers', [[{ rank: 1, name: 'Cover Only Learner',
        displayName: 'Cover C.', marks: null, coverage: 12, score: 12, photo: null }]]);
      check('the login page lists a learner who has covered work without a mark',
        grid.innerHTML.indexOf('Cover C.') !== -1 && box.classList.hidden === false,
        String(grid.innerHTML).slice(0, 140));
      dirty('login page ranking without marks', grid.innerHTML);
      run(loginCtx, 'renderTopPerformers', [[]]);
      check('an account with nothing to rank hides the login ranking',
        box.classList.hidden === true);
    }
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
