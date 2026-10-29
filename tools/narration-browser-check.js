/* Real-browser check for read-aloud: each PDF page is rendered once, its words
   are highlighted in step with speech, page turns switch to the new page only,
   and the same player works for plain text. Uses a fake speech engine so the
   test can run in headless Chrome without audio output.
   Usage: node tools/narration-browser-check.js [base] */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const BASE = (process.argv[2] || 'http://127.0.0.1:3000');
const API = BASE + '/api';
const PROBE = path.join(__dirname, '..', 'public', '_narration-probe.html');

let bad = 0;
const check = (n, c, x) => {
  console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c || !x ? '' : '  [' + String(x).slice(0, 300) + ']'));
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

function pdfBase64() {
  const parts = [];
  let n = 0;
  const obj = s => { n++; parts.push(n + ' 0 obj\n' + s + '\nendobj\n'); };
  obj('<< /Type /Catalog /Pages 2 0 R >>');
  obj('<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>');
  obj('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    '/Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>');
  obj('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    '/Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>');
  obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const one = 'BT /F1 28 Tf 72 700 Td (Page one says hello) Tj ET\n' +
    'BT /F1 18 Tf 72 650 Td (The open page is the only page narrated.) Tj ET\n';
  const two = 'BT /F1 28 Tf 72 700 Td (Page two says goodbye) Tj ET\n' +
    'BT /F1 18 Tf 72 650 Td (Turn the page and the narrator follows.) Tj ET\n';
  obj('<< /Length ' + Buffer.byteLength(one) + ' >>\nstream\n' + one + 'endstream');
  obj('<< /Length ' + Buffer.byteLength(two) + ' >>\nstream\n' + two + 'endstream');
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (const p of parts) { offsets.push(Buffer.byteLength(out)); out += p; }
  const xref = Buffer.byteLength(out);
  out += 'xref\n0 ' + (parts.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i <= parts.length; i++) {
    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  out += 'trailer\n<< /Size ' + (parts.length + 1) + ' /Root 1 0 R >>\n' +
    'startxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1').toString('base64');
}

function probeHtml(url) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>narration probe</title></head>
<body><div id="host"></div><div id="textHost"></div><div id="result" data-result="pending">pending</div>
<script>
(function () {
  function FakeUtterance(text) { this.text = text; this.volume = 1; }
  var fake = {
    paused: false,
    getVoices: function () { return [{ name: 'Probe Voice', lang: 'en-US', localService: true }]; },
    speak: function (u) {
      setTimeout(function () { if (u.onstart) u.onstart(); }, 0);
      setTimeout(function () { if (u.onboundary) u.onboundary({ charIndex: 0 }); }, 15);
    },
    cancel: function () {}, pause: function () { this.paused = true; },
    resume: function () { this.paused = false; }
  };
  try {
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
  } catch (e) {
    window.SpeechSynthesisUtterance = FakeUtterance;
    window.speechSynthesis = fake;
  }
})();
</script>
<script src="/js/common.js?v=35"></script>
<script>
(function () {
  function out(v) { document.getElementById('result').setAttribute('data-result', v); }
  function run() {
    try {
      var host = document.getElementById('host');
      host.innerHTML = pdfHtml(${JSON.stringify(url)}, { open: true, title: 'Narration Probe' });
      var root = document.querySelector('.book-reader');
      if (!root) { out('no-reader'); return; }
      root.querySelector('[data-book-narrator] [data-narrate="play"]').click();
      var tries = 0, phase = 0, page1Words = '', page1Active = '';
      var timer = setInterval(function () {
        tries++;
        var layer = root.querySelector('.pdf-text-layer');
        var words = root.querySelectorAll('.pdf-word');
        var canvas = root.querySelector('.pdf-canvas');
        var joined = Array.prototype.map.call(words, function (w) { return w.textContent; }).join(' ');
        if (phase === 0 && (words.length && canvas && layer || tries > 100)) {
          phase = 1; tries = 0; page1Words = joined;
          setTimeout(function () {
            var active = root.querySelector('.pdf-word.narrating');
            page1Active = active ? active.textContent : '';
            bookGo(root, 1);
          }, 250);
          return;
        }
        if (phase === 1 && ((joined.indexOf('goodbye') !== -1 && canvas && layer) || tries > 120)) {
          clearInterval(timer);
          var page2Words = joined;
          var page2Page = root.dataset.page;
          var textHost = document.getElementById('textHost');
          textHost.innerHTML = narratedTextHtml('Alpha beta gamma', { className: 'letter-box' });
          initNarrators(textHost);
          textHost.querySelector('[data-narrate="play"]').click();
          setTimeout(function () {
            var textActive = textHost.querySelector('.narrate-word.narrating');
            out(JSON.stringify({
              page1Words: page1Words, page1Active: page1Active,
              page2Words: page2Words, page2Page: page2Page,
              rendered: !!root.querySelector('.pdf-render'),
              canvas: !!canvas, layer: !!layer,
              textWords: textHost.querySelectorAll('.narrate-word').length,
              textActive: textActive ? textActive.textContent : ''
            }));
          }, 120);
        }
      }, 100);
    } catch (e) { out('error: ' + (e && e.message)); }
  }
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run);
})();
</script></body></html>`;
}

(async function () {
  const browser = findBrowser();
  check('a browser engine is available for the read-aloud check', !!browser, 'no chrome/edge found');
  if (!browser) { console.log(bad + ' FAILED'); process.exit(1); }

  const sup = await api('/auth/super-login', null, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'superadmin', password: 'SuperAdmin@123' }) });
  check('super admin login', !!sup.token);
  const up = await post('/library', { type: 'book', title: 'Narration Browser Probe', scope: 'global',
    file: { name: 'narration-probe.pdf', base64: pdfBase64() } }, sup.token);
  const item = up.item || {};
  check('two-page PDF uploaded for the probe', up.ok && !!item.url, JSON.stringify(up).slice(0, 160));

  let dom = '';
  try {
    fs.writeFileSync(PROBE, probeHtml(item.url), 'utf8');
    let probeUrl = null;
    for (const p of ['/_narration-probe.html', '/public/_narration-probe.html']) {
      const res = await fetch(BASE + p);
      const body = res.ok ? await res.text() : '';
      if (body.indexOf('narration probe') !== -1) { probeUrl = BASE + p; break; }
    }
    check('the probe page is served by the backend', !!probeUrl);
    dom = execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-sandbox',
      '--virtual-time-budget=30000', '--dump-dom', probeUrl || BASE + '/_narration-probe.html'],
      { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    dom = String(e.stdout || '') + String(e.stderr || '');
  } finally {
    try { fs.unlinkSync(PROBE); } catch (e) {}
    if (item.id) await api('/library/' + item.id, sup.token, { method: 'DELETE' });
    if (item.url && item.url.indexOf('/uploads/') === 0) {
      try { fs.unlinkSync(path.join(__dirname, '..', 'uploads', path.basename(item.url))); } catch (e) {}
    }
  }

  const m = dom.match(/data-result="([^"]*)"/);
  const raw = m ? m[1].replace(/&quot;/g, '"') : '';
  let r = null;
  try { r = JSON.parse(raw); } catch (e) {}
  check('the probe ran in the browser', !!r, raw.slice(0, 300));
  if (r) {
    check('page 1 is rendered and its words are in the text layer',
      r.rendered === true && r.canvas === true && r.layer === true, JSON.stringify(r));
    check('page 1 words are the open page only',
      /Page one says hello/.test(r.page1Words) && !/goodbye/.test(r.page1Words), r.page1Words);
    check('speech highlight follows the first spoken word',
      r.page1Active === 'Page', r.page1Active);
    check('turning the page renders page 2, not the old page',
      r.page2Page === '2' && /Page two says goodbye/.test(r.page2Words) &&
      !/Page one/.test(r.page2Words), JSON.stringify({ page: r.page2Page, words: r.page2Words }));
    check('plain text gets one span per word and its own highlight',
      r.textWords === 3 && r.textActive === 'Alpha', JSON.stringify(r));
  }
  console.log(bad ? '\n' + bad + ' FAILED' : '\nREAD-ALOUD BROWSER CHECK OK');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(1); });

