/* Drives the real learner screen in a REAL browser (headless Chrome/Edge) and
   checks the requirement end to end: a chapter's answer area is open ONLY while
   the reader is on the chapter's LAST page — shut everywhere else, opened the
   moment that page is reached, shut again as soon as the learner turns away — and
   the reader still lets the learner go back and forward as often as they like.

   Usage: node tools/chapter-read-gate-browser-check.js [base]
   It signs in as the seeded student STU-002 and creates a throw-away book (with
   a paged chapter) that is deleted again, so nothing else is touched — the
   learner submits nothing. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const BASE = (process.argv[2] || 'http://127.0.0.1:3000');
const API = BASE + '/api';
const PROBE = path.join(__dirname, '..', 'public', '_read-gate-probe.html');

let bad = 0;
const check = (n, c, x) => {
  console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c || !x ? '' : '  [' + String(x).slice(0, 240) + ']'));
  if (!c) bad++;
};
function findBrowser() {
  const cands = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ];
  return cands.filter(p => { try { return fs.existsSync(p); } catch (e) { return false; } })[0] || null;
}
async function api(pathname, token, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + pathname, Object.assign({}, opts, { headers }));
  return res.json();
}
async function login(slug, identifier, password) {
  const r = await api('/auth/login', null, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, identifier, password }) });
  return r.token || null;
}

/* The probe page: a small shell (app.js touches #logoutBtn while loading), then
   the real learner screen. It reports the answer area BEFORE and AFTER the
   learner turns the pages to the chapter's last page. */
function probeHtml(bookId, pageEnd) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>read gate probe</title></head>
<body>
<div class="app-side"><button data-view="home"></button><b id="sideName"></b>
<img id="sideLogo" class="hidden"><button id="logoutBtn"></button></div>
<div id="view-home"></div><div id="view-modules"></div><div id="view-book"></div>
<div id="dashStrip"></div><div id="modalRoot" class="hidden"></div>
<div id="result" data-result="pending">pending</div>
<script>
try {
  var t0 = decodeURIComponent((location.search.match(/[?&]token=([^&]+)/) || [])[1] || '');
  if (t0) localStorage.setItem('cbp_token', t0);
} catch (e) {}
</script>
<script src="/js/common.js"></script>
<script src="/js/app.js"></script>
<script>
(function () {
  function out(v) { document.getElementById('result').setAttribute('data-result', v); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function answerArea() { return document.getElementById('chText'); }
  (async function run() {
    try {
      var token = decodeURIComponent((location.search.match(/[?&]token=([^&]+)/) || [])[1] || '');
      var bookId = decodeURIComponent((location.search.match(/[?&]book=([^&]+)/) || [])[1] || '');
      var pageEnd = ${JSON.stringify(pageEnd)};
      API.setToken(token);
      S.currentBookId = bookId;                  /* what openBook() sets */
      S.bookData = await API.get('/book/' + bookId);
      S.selectedChapterId = null;
      renderBook();
      function gateEl() { return document.querySelector('#view-book .read-gate'); }
      /* the note stays in the page; "shown" means it is really visible on screen */
      function gateShown() {
        var g = gateEl();
        if (!g) return null;
        return !g.hasAttribute('hidden') && getComputedStyle(g).display !== 'none';
      }
      function now() {
        var t = answerArea();
        var b = document.getElementById('chSubmit');
        var r = document.querySelector('#view-book .book-reader');
        var g = gateEl();
        return { textarea: !!t, disabled: t ? t.disabled === true : null,
          buttonDisabled: b ? b.disabled === true : null,
          gate: gateShown(), gateText: ((g || {}).textContent || '').trim(),
          page: r ? Number(r.dataset.page) : null };
      }
      function turn(delta) {
        var r = document.querySelector('#view-book .book-reader');
        var b = r ? r.querySelector('[data-book-turn="' + delta + '"]') : null;
        if (!b || b.disabled) return false;
        b.click();
        return true;
      }
      var before = now();
      var turns = 0;
      for (var i = 0; i < 20; i++) {
        var reader = document.querySelector('#view-book .book-reader');
        if (!reader) break;
        if (Number(reader.dataset.page) >= pageEnd) break;
        if (!turn(1)) break;
        turns++;
        await wait(400);
      }
      await wait(400);
      var atLast = now();                    /* the last page: the answer area is open */
      /* the rule has two sides: one page back shuts the area, one page forward
         opens it again — with nothing redrawn and nothing typed thrown away */
      var back = { skipped: true };
      var again = { skipped: true };
      if (turn(-1)) {
        await wait(300);
        back = now();
        if (turn(1)) {
          await wait(300);
          again = now();
        }
      }
      var fresh = await API.get('/book/' + bookId);
      var chapter = (fresh.chapters || [])[0] || {};
      var lastReader = document.querySelector('#view-book .book-reader');
      var backBtn = lastReader ? lastReader.querySelector('[data-book-turn="-1"]') : null;
      out(JSON.stringify({
        before: before, turns: turns, atLast: atLast, back: back, again: again,
        pageAfter: atLast.page,
        canGoBack: backBtn ? backBtn.disabled !== true : null,
        read: chapter.read, requiresReading: chapter.requiresReading
      }));
    } catch (e) { out('error: ' + e.message); }
  })();
})();
</script></body></html>`;
}


(async function () {
  const browser = findBrowser();
  check('a browser engine is available', !!browser, 'no chrome/edge found');
  if (!browser) { console.log(bad + ' FAILED'); process.exit(1); }

  const admin = await login('greenfield-academy', 'admin@greenfield.edu', 'Admin@123');
  const student = await login('greenfield-academy', 'STU-002', 'Student@123');
  check('signed in as the account admin and the probe learner', !!admin && !!student);
  if (!admin || !student) { console.log(bad + ' FAILED'); process.exit(1); }

  const modules = await api('/modules', student);
  const active = (modules.modules || []).find(m => m.status === 'active');
  check('the probe learner has an active module', !!active, JSON.stringify(modules).slice(0, 160));
  if (!active) { console.log(bad + ' FAILED'); process.exit(1); }

  const json = { 'Content-Type': 'application/json' };
  const pdfRes = await api('/library', admin, { method: 'POST', headers: json,
    body: JSON.stringify({ type: 'book', title: 'Reading gate UI probe', url: '/uploads/read-gate-probe.pdf' }) });
  const pdf = pdfRes.item || pdfRes;
  const bookRes = await api('/books', admin, { method: 'POST', headers: json,
    body: JSON.stringify({ moduleId: active.id, title: 'Reading gate UI probe', libraryId: pdf.id }) });
  const book = bookRes.book || bookRes;
  const chapterRes = await api('/books/' + book.id + '/chapters', admin, { method: 'POST', headers: json,
    body: JSON.stringify({ title: 'Paged chapter', content: 'Read pages 1 to 3 of this book.',
      pageStart: 1, pageEnd: 3 }) });
  const chapter = chapterRes.chapter || chapterRes;
  check('a throw-away book with a 3-page chapter is ready', !!book && !!chapter,
    JSON.stringify({ book: book && book.id, chapter: chapter && chapter.id }));
  if (!book || !chapter) { console.log(bad + ' FAILED'); process.exit(1); }

  const view = await api('/book/' + book.id, student);
  check('the probe uses the learner’s own summary screen', (view.module || {}).mode === 'summary',
    JSON.stringify(view.module));

  let dom = '';
  try {
    fs.writeFileSync(PROBE, probeHtml(book.id, 3), 'utf8');
    const url = BASE + '/_read-gate-probe.html?token=' + encodeURIComponent(student) +
      '&book=' + encodeURIComponent(book.id);
    try {
      dom = execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-sandbox',
        '--window-size=1200,900', '--virtual-time-budget=25000', '--dump-dom', url],
        { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      dom = String(e.stdout || '') + String(e.stderr || '');
      if (!dom) check('headless browser ran', false, e.message);
    }
  } finally {
    try { fs.unlinkSync(PROBE); } catch (e) {}
    await api('/books/' + book.id, admin, { method: 'DELETE' });
    await api('/library/' + pdf.id, admin, { method: 'DELETE' });
  }

  const m = dom.match(/data-result="([^"]*)"/);
  const rawVal = m ? m[1] : '';
  let r = null;
  try { r = JSON.parse(rawVal.replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch (e) {}
  check('the learner screen ran in the browser', !!r, rawVal.slice(0, 240));
  if (r) {
    if (r.error) {
      check('the probe completed', false, r.error);
    } else {
      check('before reading, the answer area is drawn but shut',
        r.before.textarea === true && r.before.disabled === true && r.before.buttonDisabled === true,
        JSON.stringify(r.before));
      check('a lock note tells the learner to read to the last page',
        r.before.gate === true && /last page/i.test(r.before.gateText || ''), JSON.stringify(r.before));
      check('the chapter pages can still be turned', r.turns >= 2, 'turns ' + r.turns);
      check('on the last page the answer area is open',
        r.atLast.disabled === false && r.atLast.buttonDisabled === false, JSON.stringify(r.atLast));
      check('the lock note is out of sight on the last page', r.atLast.gate === false,
        JSON.stringify(r.atLast));
      check('the server recorded the chapter as read', r.read === true && r.requiresReading === true,
        JSON.stringify({ read: r.read, requiresReading: r.requiresReading }));
      check('the reader stays on the last page it reached', r.pageAfter === 3, 'page ' + r.pageAfter);
      check('one page back shuts the answer area again',
        r.back.page === 2 && r.back.disabled === true && r.back.buttonDisabled === true && r.back.gate === true,
        JSON.stringify(r.back));
      check('the lock note is back away from the last page',
        r.back.gate === true && /last page/i.test(r.back.gateText || ''), JSON.stringify(r.back));
      check('turning to the last page again opens the answer area again',
        r.again.page === 3 && r.again.disabled === false && r.again.buttonDisabled === false &&
          r.again.gate === false, JSON.stringify(r.again));
      check('the learner can still go back and read the chapter again', r.canGoBack === true);
    }
  }
  console.log(bad ? '\n' + bad + ' FAILED' : '\nREADING GATE BROWSER OK');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(1); });

