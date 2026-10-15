/* Per-page load test in an isolated context + cross-check the DOM ids that
   each page script touches against the ids actually present in its HTML. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const pub = path.join(__dirname, '..', 'public') + path.sep;

function stubEl(id) {
  return {
    id: id || '', tagName: 'DIV',
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, removeChild() {}, click() {}, remove() {}, focus() {}, blur() {},
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, insertAdjacentHTML() {},
    innerHTML: '', textContent: '', value: '', src: '', href: '', dataset: {}, files: [],
    options: [], checked: false
  };
}
function makeContext(seen) {
  const doc = {
    addEventListener() {}, removeEventListener() {},
    createElement() { return stubEl(); },
    getElementById(id) { seen.add(id); return stubEl(id); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    body: stubEl(), documentElement: stubEl(), head: stubEl(), title: ''
  };
  const ctx = {
    document: doc, console: console,
    window: { location: { href: 'http://localhost/', pathname: '/', search: '', hash: '' },
      addEventListener() {}, open() { return null; }, print() {}, focus() {},
      setTimeout: setTimeout, clearTimeout: clearTimeout, document: doc },
    navigator: { userAgent: 'node' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    Blob: function () {}, FileReader: function () { this.readAsDataURL = function () {}; },
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
    fetch: function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true }); } }); },
    alert: function () {}, confirm: function () { return false; }, prompt: function () { return null; },
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval
  };
  ctx.location = ctx.window.location;
  ctx.self = ctx.window;
  return vm.createContext(ctx);
}

const pages = ['admin.html', 'super.html', 'app.html', 'login.html', 'index.html'];
let problems = 0;
/* page boot code runs against a stubbed fetch, so ignore its async noise */
process.on('unhandledRejection', function () {});
process.on('uncaughtException', function (e) { console.log('ASYNC NOTE (stub fetch): ' + e.message); });

pages.forEach(function (page) {
  const html = fs.readFileSync(pub + page, 'utf8');
  const scripts = [];
  html.replace(/<script src="\/js\/([A-Za-z0-9_.-]+)(\?[^"]*)?"><\/script>/g, function (m, f) { scripts.push(f); return m; });
  const htmlIds = {};
  html.replace(/id="([^"]+)"/g, function (m, id) { htmlIds[id] = true; return m; });
  const seen = {};
  const ctx = makeContext({ add: function (id) { seen[id] = true; } });
  let ok = true;
  scripts.forEach(function (f) {
    try { vm.runInContext(fs.readFileSync(pub + 'js/' + f, 'utf8'), ctx, { filename: f }); }
    catch (e) { ok = false; problems++; console.log('LOAD ERROR ' + page + ' -> ' + f + ': ' + e.message); }
  });
  const missing = Object.keys(seen).filter(function (id) { return !htmlIds[id]; });
  if (missing.length) { problems++; console.log('MISSING IDS in ' + page + ': ' + missing.join(', ')); }
  if (ok && !missing.length) console.log('OK ' + page + '  scripts: ' + scripts.join(', '));
});
/* nav button <-> <section id="view-X"> <-> renderer mapping wiring check */
function checkViews(page, jsFile, mapName) {
  const html = fs.readFileSync(pub + page, 'utf8');
  const js = fs.readFileSync(pub + 'js/' + jsFile, 'utf8');
  const views = [];
  html.replace(/data-view="([^"]+)"/g, function (m, v) { if (views.indexOf(v) === -1) views.push(v); return m; });
  const missing = [];
  views.forEach(function (v) {
    if (!new RegExp('id="view-' + v + '"').test(html)) missing.push(v + ' (no section)');
    const mapped = new RegExp(mapName + '\\.' + v + '\\s*=').test(js) ||
      new RegExp('(^|[{,\\s])' + v + ':\\s*render').test(js);
    if (!mapped) missing.push(v + ' (no renderer)');
  });
  if (missing.length) { problems++; console.log('VIEW WIRING ' + page + ': ' + missing.join(', ')); return; }
  console.log('VIEWS OK ' + page + ' (' + views.length + '): ' + views.join(', '));
}
checkViews('admin.html', 'admin.js', 'RENDER');
checkViews('super.html', 'super.js', 'RENDERERS');
console.log(problems === 0 ? 'ALL PAGES CLEAN' : problems + ' problem group(s)');
/* page boot code keeps running against the stub fetch, so exit now: the result
   above is what matters and the exit code stays deterministic. */
process.exit(problems ? 1 : 0);
