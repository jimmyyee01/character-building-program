/* Submits a chapter in a REAL browser and checks the requirement end to end:
   after a chapter's work is submitted, that chapter must become inactive — a
   disabled button that responds to no click.

   Usage: node tools/chapter-lock-browser-check.js [base]
   It signs in as the seeded student STU-002 (untouched by the other suites), so a
   fresh seed is expected; after three runs that learner has submitted everything
   and the database needs reseeding. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const BASE = (process.argv[2] || 'http://127.0.0.1:3000');
const API = BASE + '/api';
const PROBE = path.join(__dirname, '..', 'public', '_chapter-lock-probe.html');

let bad = 0;
const check = (n, c, x) => {
  console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c || !x ? '' : '  [' + String(x).slice(0, 220) + ']'));
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

/* The probe page: a small shell (app.js touches #logoutBtn while loading), then
   the real renderer. It reports the chapter buttons BEFORE and AFTER a real
   submission, and what a click on the submitted chapter does. */
const PROBE_HEAD = `<!doctype html><html><head><meta charset="utf-8"><title>chapter lock probe</title></head>
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
  function snap() {
    return Array.prototype.slice.call(document.querySelectorAll('#view-book [data-ch]')).map(function (b) {
      return { id: b.getAttribute('data-ch'), disabled: b.disabled === true,
        cls: String(b.className || ''), title: b.getAttribute('title') || '' };
    });
  }
  (async function run() {
    try {
      var token = decodeURIComponent((location.search.match(/[?&]token=([^&]+)/) || [])[1] || '');
      API.setToken(token);
      S.bookData = await API.get('/book/book_gamma_1');
      S.selectedChapterId = null;
      renderBook();
      var before = snap();
      var active = null;
      for (var i = 0; i < before.length; i++) { if (!before[i].disabled) active = before[i]; }
      if (!active) { out(JSON.stringify({ error: 'no open chapter (reseed needed)', before: before })); return; }
      await API.post('/submissions', { type: 'chapter_summary', chapterId: active.id,
        text: 'Probe answer for the chapter lock check: honesty matters more than applause, and every ' +
          'small choice builds the person I am becoming, so I will keep my word even when nobody is watching.' });
      S.bookData = await API.get('/book/book_gamma_1');   /* what refreshBook() does */
      renderBook();
      var after = snap();
      var submitted = null;
      for (var j = 0; j < after.length; j++) { if (after[j].id === active.id) submitted = after[j]; }
      var openNow = [];
      for (var k = 0; k < after.length; k++) { if (!after[k].disabled) openNow.push(after[k].id); }
      S.selectedChapterId = null;
      var el = document.querySelector('#view-book [data-ch="' + active.id + '"]');
      var clicked = false;
      try { if (el && typeof el.click === 'function') { el.click(); clicked = true; } } catch (e3) {}
      out(JSON.stringify({ before: before, after: after, activeId: active.id, submitted: submitted,
        openNow: openNow, clicked: clicked, selectionAfterClick: S.selectedChapterId,
        clickDidNothing: S.selectedChapterId === null,
        statuses: (S.bookData.chapters || []).map(function (c) { return c.id + ':' + c.status; }) }));
    } catch (e) { out('error: ' + e.message); }
  })();
})();
</script></body></html>`;

(async function () {
  const browser = findBrowser();
  check('a browser engine is available', !!browser, 'no chrome/edge found');
  if (!browser) { console.log(bad + ' FAILED'); process.exit(1); }

  const login = await api('/auth/login', null, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: 'greenfield-academy', identifier: 'STU-002', password: 'Student@123' }) });
  check('signed in as the probe learner (STU-002)', !!login.token);
  if (!login.token) { console.log(bad + ' FAILED'); process.exit(1); }

  let dom = '';
  try {
    fs.writeFileSync(PROBE, PROBE_HEAD, 'utf8');
    let probeUrl = null;
    for (const p of ['/_chapter-lock-probe.html', '/public/_chapter-lock-probe.html']) {
      const res = await fetch(BASE + p);
      const body = res.ok ? await res.text() : '';
      if (body.indexOf('chapter lock probe') !== -1) { probeUrl = BASE + p; break; }
    }
    check('the probe page is served by the backend', !!probeUrl, 'tried /_chapter-lock-probe.html');
    const url = (probeUrl || BASE + '/_chapter-lock-probe.html') + '?token=' + encodeURIComponent(login.token);
    try {
      dom = execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-sandbox',
        '--window-size=1200,900', '--virtual-time-budget=15000', '--dump-dom', url],
        { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      dom = String(e.stdout || '') + String(e.stderr || '');
      if (!dom) check('headless browser ran', false, e.message);
    }
  } finally {
    try { fs.unlinkSync(PROBE); } catch (e) {}
  }

  const m = dom.match(/data-result="([^"]*)"/);
  const rawVal = m ? m[1] : '';
  let r = null;
  try { r = JSON.parse(rawVal.replace(/&quot;/g, '"')); } catch (e) {}
  check('probe ran in the browser', !!r, rawVal.slice(0, 220));
  if (r) {
    if (r.error) {
      check('the learner still has a chapter to submit (reseed needed)', false, r.error);
    } else {
      const beforeOpen = (r.before || []).filter(b => !b.disabled);
      const afterOpen = (r.after || []).filter(b => !b.disabled);
      check('before submitting, exactly one chapter is open and clickable',
        beforeOpen.length === 1 && beforeOpen[0].id === r.activeId, JSON.stringify(r.before));
      check('the submission was accepted and that chapter turned "done"',
        (r.statuses || []).indexOf(r.activeId + ':done') !== -1, JSON.stringify(r.statuses));
      check('after submitting, the chapter is inactive (disabled, dimmed, with the reason)',
        !!r.submitted && r.submitted.disabled === true && /locked/.test(r.submitted.cls) &&
        r.submitted.title.indexOf('closed now') !== -1, JSON.stringify(r.submitted));
      check('clicking the submitted chapter does nothing at all',
        r.clicked === true && r.clickDidNothing === true && r.selectionAfterClick === null,
        JSON.stringify({ clicked: r.clicked, selection: r.selectionAfterClick, open: afterOpen.map(b => b.id) }));
      check('only the next chapter (if any) stays clickable',
        afterOpen.length <= 1 && afterOpen.every(b => b.id !== r.activeId),
        JSON.stringify(afterOpen.map(b => b.id)));
    }
  }
  console.log(bad ? '\n' + bad + ' FAILED' : '\nCHAPTER LOCK BROWSER OK');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(1); });
