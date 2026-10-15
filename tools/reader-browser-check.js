/* Runs the shipped reader in a real browser engine (headless Chrome/Edge) and
   checks that Next/Previous really rebuild the sheet with the new page fragment
   — the fix for "the buttons did not go to the next page".
   Usage: node tools/reader-browser-check.js [base] */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const BASE = (process.argv[2] || 'http://127.0.0.1:3000');
const API = BASE + '/api';
const PROBE = path.join(__dirname, '..', 'public', '_reader-probe.html');

let bad = 0;
const check = (n, c, x) => {
  console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c || !x ? '' : '  [' + String(x).slice(0, 200) + ']'));
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
const post = (p, body, token) => api(p, token, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/* the page the browser loads: builds a reader, turns pages, records the result */
function probeHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>reader probe</title></head>
<body><div id="host"></div><div id="result" data-result="pending">pending</div>
<script src="/js/common.js"></script>
<script>
(function () {
  function out(v) { document.getElementById('result').setAttribute('data-result', v); }
  try {
    var url = decodeURIComponent((location.search.match(/[?&]pdf=([^&]+)/) || [])[1] || '');
    if (!url || typeof pdfHtml !== 'function') { out('setup-failed'); return; }
    var host = document.getElementById('host');
    host.innerHTML = pdfHtml(url, { open: true, from: 1, to: 3, title: 'Probe' });
    var root = document.querySelector('.book-reader');
    var wrap = root.querySelector('.book-frame-wrap');
    function frame() { return wrap.querySelector('iframe'); }
    var src = function (f) { return f ? f.getAttribute('src') : ''; };
    var first = frame();
    bookGo(root, 1);                       /* -> page 2, must be a fresh frame */
    var second = frame();
    var replaced = !!second && second !== first;
    bookGo(root, 0);                       /* same page: must NOT rebuild */
    var keptWhenSame = frame() === second;
    bookGo(root, 1);                       /* -> page 3 */
    var third = frame();
    var atEnd = root.querySelectorAll('[data-book-turn="1"]')[0].disabled;
    bookGo(root, -1);                      /* -> back to page 2 */
    var back = frame();
    out(JSON.stringify({
      frames: wrap.querySelectorAll('iframe').length,
      start: src(first), next: src(second), third: src(third), back: src(back),
      replaced: replaced, keptWhenSame: keptWhenSame, atEnd: atEnd,
      page: root.dataset.page, counter: (root.querySelector('[data-book-page]') || {}).textContent,
      prevDisabled: root.querySelectorAll('[data-book-turn="-1"]')[0].disabled,
      shield: !!root.querySelector('[data-book-shield]'),
      close: !!root.querySelector('[data-book-close]')
    }));
  } catch (e) { out('error: ' + e.message); }
})();
</script></body></html>`;
}


(async function () {
  const browser = findBrowser();
  check('a browser engine is available for the real check', !!browser, 'no chrome/edge found');
  if (!browser) { console.log(bad + ' FAILED'); process.exit(1); }

  const sup = await api('/auth/super-login', null, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'superadmin', password: 'SuperAdmin@123' }) });
  check('super admin login', !!sup.token);

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
    '2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj\n' +
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj\n' +
    '4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj\n' +
    '5 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj\n' +
    'trailer << /Root 1 0 R /Size 6 >>\n%%EOF\n', 'latin1').toString('base64');
  const up = await post('/library', { type: 'book', title: 'Reader Browser Probe', scope: 'global',
    file: { name: 'reader-probe.pdf', base64: pdf } }, sup.token);
  const item = up.item || up || {};
  check('three-page book uploaded for the probe', up.ok && !!item.url, JSON.stringify(up).slice(0, 140));

  let dom = '';
  try {
    fs.writeFileSync(PROBE, probeHtml(), 'utf8');
    /* find the URL this server actually serves the probe page from */
    let probeUrl = null;
    for (const p of ['/_reader-probe.html', '/public/_reader-probe.html']) {
      const res = await fetch(BASE + p);
      const body = res.ok ? await res.text() : '';
      if (body.indexOf('reader probe') !== -1) { probeUrl = BASE + p; break; }
    }
    check('the probe page is served by the backend', !!probeUrl, 'tried /_reader-probe.html and /public/...');
    const url = (probeUrl || BASE + '/_reader-probe.html') + '?pdf=' + encodeURIComponent(item.url);
    let raw = '';
    try {
      raw = execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-sandbox',
        '--virtual-time-budget=6000', '--dump-dom', url],
        { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      raw = String(e.stdout || '') + String(e.stderr || '');
      if (!raw) check('headless browser ran', false, e.message);
    }
    dom = String(raw || '');
  } finally {
    try { fs.unlinkSync(PROBE); } catch (e) {}
    if (item.id) await api('/library/' + item.id, sup.token, { method: 'DELETE' });
  }

  const m = dom.match(/data-result="([^"]*)"/);
  if (!m) check('probe page produced a result', false, dom.slice(0, 200));
  const rawVal = m ? m[1] : '';
  let r = null;
  try { r = JSON.parse(rawVal.replace(/&quot;/g, '"')); } catch (e) {}
  check('probe ran in the browser', !!r, rawVal.slice(0, 200));
  if (r) {
    check('the sheet holds exactly one frame', r.frames === 1, JSON.stringify(r).slice(0, 200));
    check('starting frame shows page 1', /#page=1/.test(r.start), r.start);
    check('Next builds a NEW frame for page 2', r.replaced === true && /#page=2/.test(r.next), JSON.stringify(r).slice(0, 200));
    check('a same-page call does not rebuild the frame', r.keptWhenSame === true);
    check('Next again shows page 3 and stops there', /#page=3/.test(r.third) && r.atEnd === true, r.third);
    check('Previous goes back to page 2', /#page=2/.test(r.back) && Number(r.page) === 2, JSON.stringify(r).slice(0, 200));
    check('counter follows the page', String(r.counter) === '2', String(r.counter));
    check('sheet stays shielded (no scrolling) and closable', r.shield === true && r.close === true,
      JSON.stringify({ shield: r.shield, close: r.close }));
  }
  console.log(bad ? '\n' + bad + ' FAILED' : '\nREAL BROWSER READER OK');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(1); });
