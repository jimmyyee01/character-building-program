/* Drives the real learner screen in a REAL browser (headless Chrome/Edge) and
   checks the letter that closes a module end to end:
     - the letter is shown, the letter questions are NOT — only the learner's own
       TWO of the pool are rendered, with the pair taken from the account;
     - pressing "Answer my 2 of N questions" veils the letter (its text, its clip
       and its read-aloud are blurred) and opens the answer form;
     - "Back to the letter" lifts the veil again, and starting again veils it.

   Usage: node tools/letter-browser-check.js [base]
   It signs in as the seeded graduate STU-100 (whose modules are all finished, so
   the throw-away module it creates last is the active one), adds a module with a
   letter pool, one book and one chapter, and deletes them again at the end. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const BASE = (process.argv[2] || 'http://127.0.0.1:3000');
const API = BASE + '/api';
const PROBE = path.join(__dirname, '..', 'public', '_module-letter-probe.html');

let bad = 0;
const check = (n, c, x) => {
  console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c || !x ? '' : '  [' + String(x).slice(0, 260) + ']'));
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
  let data = {};
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  return data;
}
const json = { 'Content-Type': 'application/json' };
async function login(slug, identifier, password) {
  const r = await api('/auth/login', null, { method: 'POST', headers: json,
    body: JSON.stringify({ slug, identifier, password }) });
  return r.token || null;
}

/* The probe page: a shell the learner screen expects, then the real app.js. It
   walks the learner to the letter stage and reports what the screen looks like
   before, during and after answering. */
function probeHtml(moduleId, chapterId, poolTexts) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>letter probe</title>
<link rel="stylesheet" href="/css/style.css?v=68"></head>
<body>
<div class="app-side"><button data-view="home"></button><b id="sideName"></b>
<img id="sideLogo" class="hidden"><button id="logoutBtn"></button></div>
<div id="dashStrip"></div>
<section id="view-home"></section><section id="view-modules" class="hidden"></section>
<section id="view-book" class="hidden"></section><section id="view-certificates" class="hidden"></section>
<div id="modalRoot"></div>
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
  function filterOf(el) { return el ? (getComputedStyle(el).filter || 'none') : null; }
  function visible(el) {
    if (!el) return false;
    var b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && el.offsetParent !== null;
  }
  (async function run() {
    try {
      var token = decodeURIComponent((location.search.match(/[?&]token=([^&]+)/) || [])[1] || '');
      var moduleId = ${JSON.stringify(moduleId)};
      var chapterId = ${JSON.stringify(chapterId)};
      API.setToken(token);

      /* 1. walk the learner to the letter: the module's only chapter is answered,
            every book is then finished and the letter stage opens. */
      var flow = await API.get('/modules');
      var mine = (flow.modules || []).filter(function (m) { return m.id === moduleId; })[0] || {};
      var startStage = (mine.progress || {}).stage || null;
      if (startStage === 'work') {
        await API.post('/submissions', { type: 'chapter_summary', chapterId: chapterId,
          text: 'This chapter taught me patience and courage, and I will put both into practice '
            + 'at home and in class this week, one small step at a time.' });
      }
      var after = await API.get('/module/' + moduleId);
      var stage = ((after || {}).progress || {}).stage || null;

      /* 2. open the module: the screen routes itself to the letter stage */
      await openModule(moduleId);
      await wait(1200);


      function snap() {
        var sheet = document.getElementById('moduleLetterSheet');
        var box = sheet ? sheet.querySelector('.letter-box') : null;
        var narrator = sheet ? sheet.querySelector('.narrator') : null;
        var start = document.getElementById('moduleLetterStart');
        var form = document.getElementById('moduleLetterForm');
        var note = document.getElementById('moduleLetterNote');
        var rows = form ? form.querySelectorAll('.letter-q') : [];
        var qs = [];
        var opts = [];
        for (var i = 0; i < rows.length; i++) {
          var head = rows[i].querySelector('b');
          qs.push(head ? head.textContent.replace(/\s+/g, ' ').trim() : '');
          opts.push(rows[i].querySelectorAll('input[type=radio]').length);
        }
        return {
          sheet: !!sheet,
          letterText: box ? box.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : null,
          veiled: !!(sheet && sheet.classList.contains('veiled')),
          boxFilter: filterOf(box),
          boxCopy: box ? (getComputedStyle(box).userSelect || '') : null,
          narratorFilter: filterOf(narrator),
          startShown: visible(start),
          startText: start ? start.textContent.replace(/\s+/g, ' ').trim() : '',
          formShown: form ? visible(form) : null,
          noteShown: note ? (!note.hasAttribute('hidden') && getComputedStyle(note).display !== 'none') : null,
          questions: qs, options: opts,
          radios: form ? form.querySelectorAll('input[type=radio]').length : 0,
          textareas: form ? form.querySelectorAll('textarea').length : 0
        };
      }

      var before = snap();                        /* the letter, nothing veiled */
      var startBtn = document.getElementById('moduleLetterStart');
      if (startBtn) startBtn.click();
      await wait(500);
      var open = snap();                          /* answering: the letter set aside */
      var backBtn = document.getElementById('moduleLetterBack');
      if (backBtn) backBtn.click();
      await wait(500);
      var back = snap();                          /* back to reading the letter */
      startBtn = document.getElementById('moduleLetterStart');
      if (startBtn) startBtn.click();
      await wait(500);
      var again = snap();                         /* answering once more */

      /* the pool never reaches the browser whole: only the issued pair is drawn.
         Only the app's own markup is searched — the probe page itself holds the
         three question texts as its fixture. */
      var shellIds = ['view-home', 'view-modules', 'view-book', 'view-certificates',
        'modalRoot', 'dashStrip'];
      var shell = shellIds.map(function (id) {
        var el = document.getElementById(id);
        return el ? el.outerHTML : '';
      }).join('');
      var POOL = ${JSON.stringify(poolTexts)};
      var leak = POOL.filter(function (t) { return shell.indexOf(t) !== -1; });

      out(JSON.stringify({ startStage: startStage, stage: stage, before: before, open: open,
        back: back, again: again, leak: leak }));
    } catch (e) { out('error: ' + e.message); }
  })();
})();
</script></body></html>`;
}


/* The three questions the admin writes for this probe. Two of them are issued to
   the learner, so exactly one must never appear in the page. */
const POOL = [
  { question: 'Which promise does the letter make about being patient?',
    options: ['To wait without complaining', 'To hurry every task', 'To avoid people'],
    answerIndex: 0 },
  { question: 'What does the letter ask of you at home?',
    options: ['To keep quiet', 'To serve with a glad heart', 'To ask for rewards'],
    answerIndex: 1 },
  { question: 'Which habit does the letter name as a small beginning?',
    options: ['Speaking first', 'Complaining softly', 'Saying thank you'],
    answerIndex: 2 }
];

(async function () {
  const browser = findBrowser();
  check('a browser engine is available', !!browser, 'no chrome/edge found');
  if (!browser) { console.log(bad + ' FAILED'); process.exit(1); }

  const superTok = (await api('/auth/super-login', null, { method: 'POST', headers: json,
    body: JSON.stringify({ username: 'superadmin', password: 'SuperAdmin@123' }) })).token || null;
  const admin = await login('greenfield-academy', 'admin@greenfield.edu', 'Admin@123');
  check('signed in as the super admin and the account admin', !!superTok && !!admin);
  if (!superTok || !admin) { console.log(bad + ' FAILED'); process.exit(1); }

  /* A run that was cut short (server restarted, browser missing) can leave its
     throw-away module behind, and a leftover unfinished module would make the
     graduate's new one locked. Clear any such module away before probing. */
  const stale = ((await api('/super/modules', superTok)).modules || [])
    .filter(m => /^Letter UI probe /.test(String(m.title || '')));
  for (const s of stale) {
    const own = ((await api('/books?moduleId=' + encodeURIComponent(s.id), admin)).books || []);
    for (const b of own) await api('/books/' + b.id, admin, { method: 'DELETE' });
    await api('/super/modules/' + encodeURIComponent(s.id), superTok, { method: 'DELETE' });
  }
  const left = ((await api('/super/modules', superTok)).modules || [])
    .filter(m => /^Letter UI probe /.test(String(m.title || '')));
  check('the modules left by earlier probe runs are cleared away', left.length === 0,
    left.map(m => m.title).join(', '));


  /* A learner whose modules are all finished, so the throw-away module added last
     is the one that is active for them (a fresh account's earlier modules would be
     the active ones and the new module would stay locked). */
  const run = Date.now().toString(36).slice(-5).toUpperCase();
  const student = await login('greenfield-academy', 'STU-100', 'Student@123');
  check('signed in as the graduate the probe drives', !!student);
  if (!student) { console.log(bad + ' FAILED'); process.exit(1); }

  const modRes = await api('/super/modules', superTok, { method: 'POST', headers: json,
    body: JSON.stringify({ title: 'Letter UI probe ' + run, mode: 'summary',
      letter: { enabled: true, mode: 'objectives', questions: POOL } }) });
  const mod = modRes.module || (modRes && modRes.id ? modRes : {});
  check('a module with a letter pool is ready',
    !!mod.id && ((mod.letter || {}).questions || []).length === 3,
    JSON.stringify(mod).slice(0, 240));
  if (!mod.id) { console.log(bad + ' FAILED'); process.exit(1); }

  const bookRes = await api('/books', admin, { method: 'POST', headers: json,
    body: JSON.stringify({ moduleId: mod.id, title: 'Letter UI probe book' }) });
  const book = bookRes.book || bookRes;
  const chapRes = book && book.id ? await api('/books/' + book.id + '/chapters', admin,
    { method: 'POST', headers: json, body: JSON.stringify({ title: 'Only chapter',
      content: 'Patience and courage are learned one small step at a time.' }) }) : {};
  const chapter = chapRes.chapter || chapRes;
  check('the probe book and its chapter are ready', !!book.id && !!chapter.id,
    JSON.stringify({ book: book && book.id, chapter: chapter && chapter.id }));
  if (!book.id || !chapter.id) { console.log(bad + ' FAILED'); process.exit(1); }

  let dom = '';
  try {
    fs.writeFileSync(PROBE, probeHtml(mod.id, chapter.id, POOL.map(q => q.question)), 'utf8');
    const url = BASE + '/_module-letter-probe.html?token=' + encodeURIComponent(student);
    try {
      dom = execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-sandbox',
        '--window-size=1200,900', '--virtual-time-budget=30000', '--dump-dom', url],
        { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      dom = String(e.stdout || '') + String(e.stderr || '');
      if (!dom) check('the headless browser ran', false, e.message);
    }
  } finally {
    try { fs.unlinkSync(PROBE); } catch (e) {}
    await api('/books/' + book.id, admin, { method: 'DELETE' });
    await api('/super/modules/' + encodeURIComponent(mod.id), superTok, { method: 'DELETE' });
  }


  const m = dom.match(/data-result="([^"]*)"/);
  const rawVal = m ? m[1] : '';
  let r = null;
  try { r = JSON.parse(rawVal.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'")); } catch (e) {}
  check('the learner screen ran in the browser', !!r, rawVal.slice(0, 260));
  if (r) {
    if (r.error) {
      check('the probe completed', false, r.error);
    } else {
      check('the letter stage opens once every book is finished',
        r.startStage === 'work' && r.stage === 'letter', JSON.stringify({ start: r.startStage, now: r.stage }));
      check('the letter itself is drawn for the learner',
        r.before.sheet === true && !!r.before.letterText && r.before.letterText.length > 10,
        JSON.stringify(r.before.letterText));
      check('nothing of the letter is veiled before the learner answers',
        r.before.veiled === false && r.before.boxFilter === 'none' && r.before.noteShown === false,
        JSON.stringify({ veiled: r.before.veiled, filter: r.before.boxFilter, note: r.before.noteShown }));
      check('the learner is offered "2 of 3" questions',
        r.before.startShown === true && /2 of 3/.test(r.before.startText), r.before.startText);
      check('the answer form stays off screen until the learner starts',
        r.before.formShown === false && r.before.veiled === false,
        JSON.stringify({ formShown: r.before.formShown, veiled: r.before.veiled }));
      check('starting the answers veils the letter',
        r.open.veiled === true && /blur/.test(r.open.boxFilter || '') &&
          r.open.noteShown === true, JSON.stringify({ veiled: r.open.veiled, filter: r.open.boxFilter }));
      check('the read-aloud of the letter is out of reach while answering',
        /blur/.test(r.open.narratorFilter || '') || r.open.narratorFilter === null,
        r.open.narratorFilter);
      check('the letter text cannot be selected while answering',
        String(r.open.boxCopy || '').toLowerCase() === 'none', r.open.boxCopy);
      check('exactly two of the three questions are issued',
        (r.open.questions || []).length === 2, JSON.stringify(r.open.questions));
      check('each issued question carries its own choices',
        (r.open.options || []).length === 2 && r.open.options.every(n => n === 3) &&
          r.open.textareas === 0, JSON.stringify(r.open.options));
      check('the start button steps aside while answering', r.open.startShown === false);
      check('the answer form is on screen while answering',
        r.open.formShown === true && r.open.radios === 6, JSON.stringify({ form: r.open.formShown, radios: r.open.radios }));
      check('only the issued pair is in the browser, never the whole pool',
        (r.leak || []).length === 2, JSON.stringify(r.leak));
      check('"Back to the letter" lifts the veil again',
        r.back.veiled === false && r.back.boxFilter === 'none' && r.back.startShown === true &&
          r.back.formShown === false, JSON.stringify({ veiled: r.back.veiled, filter: r.back.boxFilter }));
      check('answering again veils the letter again',
        r.again.veiled === true && /blur/.test(r.again.boxFilter || '') &&
          r.again.formShown === true, JSON.stringify({ veiled: r.again.veiled, form: r.again.formShown }));
    }
  }
  console.log(bad ? '\n' + bad + ' FAILED' : '\nLETTER AFTER MODULE BROWSER OK');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(1); });

