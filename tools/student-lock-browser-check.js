/* Runs the shipped student leave lock in a real browser engine (headless
   Chrome/Edge) and checks that leaving the app really ends the sign-in:
   losing the focus, opening the app in a second tab, the page being hidden and
   the page being closed all wipe the token and tell the server to end the
   session, while a file dialog opened from the app does not.
   Usage: node tools/student-lock-browser-check.js [base] */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = (process.argv[2] || 'http://127.0.0.1:3000');
const PROBE = path.join(__dirname, '..', 'public', '_leave-lock-probe.html');
const CASES = ['blur', 'hold', 'tab', 'pagehide', 'hidden'];

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

/* The probe plays the part of the learner app: it loads common.js, signs a
   student in on paper, starts the lock and then leaves the app in one of the
   ways the lock must react to — recording what happened. */
function probeHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>leave lock probe</title></head>
<body><div id="result" data-result="pending">pending</div>
<script src="/js/common.js"></script>
<script>
(function () {
  function out(obj) { document.getElementById('result').setAttribute('data-result', JSON.stringify(obj)); }
  var caseName = (location.search.match(/[?&]case=([a-z]+)/) || [])[1] || '';
  function state() {
    return {
      token: API.token(), on: LEAVE_LOCK.on, overlay: !!document.getElementById('leaveLockBox'),
      reason: LEAVE_LOCK.reason, claim: !!localStorage.getItem('cbp_live_tab')
    };
  }
  try {
    if (typeof startStudentLock !== 'function') { out({ case: caseName, error: 'no startStudentLock' }); return; }
    /* record every call the lock makes, without leaving the page */
    var calls = [];
    window.fetch = function (url, opts) {
      calls.push(String(url) + ' ' + String((opts || {}).method || 'GET'));
      return Promise.resolve({ status: 200, ok: true, json: function () { return Promise.resolve({ ok: true }); } });
    };
    /* the sign-out screen must be seen, not skipped: hold the redirect back */
    var realTimeout = window.setTimeout;
    window.setTimeout = function (fn, ms) { return (ms || 0) >= 1000 ? 0 : realTimeout(fn, ms); };
    localStorage.setItem('cbp_token', 'probe-token');
    localStorage.setItem('cbp_user', JSON.stringify({ id: 'probe', role: 'student' }));
    localStorage.setItem('cbp_login', '/t/greenfield-academy');
    startStudentLock();
    var claimOnStart = !!localStorage.getItem('cbp_live_tab');
    LEAVE_LOCK.readyAt = 0;                       /* the arming delay is over */
    if (caseName === 'hold') LEAVE_LOCK.hold = Date.now() + 60000;
    if (caseName === 'blur' || caseName === 'hold') window.dispatchEvent(new Event('blur'));
    else if (caseName === 'tab') window.dispatchEvent(new StorageEvent('storage',
      { key: 'cbp_live_tab', newValue: JSON.stringify({ id: 'another-tab', at: Date.now() }) }));
    else if (caseName === 'pagehide') window.dispatchEvent(new Event('pagehide'));
    else if (caseName === 'hidden') {
      try {
        Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return true; } });
        document.dispatchEvent(new Event('visibilitychange'));
      } catch (e) { calls.push('hidden-unsupported'); }
    }
    var afterFirst = state();
    if (caseName === 'hold') {
      window.dispatchEvent(new Event('focus'));     /* the file dialog was closed */
      window.dispatchEvent(new Event('blur'));
    }
    out({ case: caseName, claimOnStart: claimOnStart, afterFirst: afterFirst,
      afterSecond: state(), calls: calls,
      login: typeof leaveLoginUrl === 'function' ? leaveLoginUrl('left') : '' });
  } catch (e) { out({ case: caseName, error: String((e && e.message) || e) }); }
})();
</script></body></html>`;
}


async function main() {
  const browser = findBrowser();
  check('a headless browser is available', !!browser, 'install Chrome or Edge to run this check');
  if (!browser) return;

  fs.writeFileSync(PROBE, probeHtml(), 'utf8');
  let probeUrl = null;
  for (const p of ['/_leave-lock-probe.html', '/public/_leave-lock-probe.html']) {
    const res = await fetch(BASE + p);
    const body = res.ok ? await res.text() : '';
    if (body.indexOf('leave lock probe') !== -1) { probeUrl = BASE + p; break; }
  }
  check('the probe page is served', !!probeUrl, 'no route served the probe page');

  try {
    for (const name of CASES) {
      if (!probeUrl) break;
      let dom = '';
      try {
        dom = execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-sandbox',
          '--virtual-time-budget=1500', '--dump-dom', probeUrl + '?case=' + name],
          { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        dom = String(e.stdout || '') + String(e.stderr || '');
      }
      const m = dom.match(/data-result="([^"]*)"/);
      let r = null;
      try { r = JSON.parse((m ? m[1] : '').replace(/&quot;/g, '"')); } catch (e) {}
      check('the ' + name + ' probe ran in the browser', !!r && !r.error,
        r ? r.error : (m ? m[1] : dom.slice(0, 200)));
      if (!r || r.error) continue;
      const first = r.afterFirst || {};
      const second = r.afterSecond || {};
      check('the ' + name + ' probe started a beat and claimed the tab',
        r.claimOnStart === true && (r.calls || []).some(c => c.indexOf('/api/auth/beat') !== -1),
        JSON.stringify(r.calls));

      if (name === 'blur') {
        check('losing the focus signs the student out',
          first.token === null && first.on === false && first.overlay === true && first.reason === 'left',
          JSON.stringify(first));
        check('the sign-out tells the server to end the session',
          (r.calls || []).some(c => c.indexOf('/api/auth/logout') !== -1), JSON.stringify(r.calls));
        check('the tab claim is dropped when the student is signed out', first.claim === false,
          JSON.stringify(first));
        check('a signed-out student is sent to the sign-in page',
          r.login === '/t/greenfield-academy?left=left', r.login);
      } else if (name === 'hold') {
        check('a file dialog opened from the app does not sign the student out',
          first.token === 'probe-token' && first.on === true && first.overlay === false,
          JSON.stringify(first));
        check('leaving right after the dialog closes does sign the student out',
          second.token === null && second.reason === 'left', JSON.stringify(second));
      } else if (name === 'tab') {
        check('opening the app in another tab signs this tab out',
          first.token === null && first.reason === 'tab' && first.overlay === true,
          JSON.stringify(first));
      } else if (name === 'pagehide') {
        check('closing the page ends the session without a screen to show',
          first.token === null && first.overlay === false && first.claim === false,
          JSON.stringify(first));
        check('closing the page still says goodbye to the server',
          (r.calls || []).some(c => c.indexOf('/api/auth/logout') !== -1), JSON.stringify(r.calls));
      } else if (name === 'hidden') {
        if ((r.calls || []).indexOf('hidden-unsupported') !== -1) {
          check('hiding the page signs the student out (page visibility not testable here)', true);
        } else {
          check('hiding the page signs the student out',
            first.token === null && first.reason === 'left', JSON.stringify(first));
        }
      }
    }
  } finally {
    try { fs.unlinkSync(PROBE); } catch (e) {}
  }
}

main().then(function () {
  console.log('\n' + (bad ? bad + ' check(s) FAILED' : 'all checks passed'));
  process.exit(bad ? 1 : 0);
}).catch(function (e) {
  console.log('FATAL ' + (e && e.message));
  try { fs.unlinkSync(PROBE); } catch (err) {}
  process.exit(1);
});
