/* Chapter page picker: every page offered (no 99 cap), chips fit below the
   field, range/all/clear work, and both consoles share one implementation. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const dir = path.join(__dirname, '..', 'public') + path.sep;

const listeners = {};
function el(tag) {
  const e = {
    tagName: (tag || 'div').toUpperCase(), className: '', textContent: '', value: '', checked: false,
    disabled: false, dataset: {}, _attrs: {}, _parent: null, _cls: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: {
      add(c) { e._cls[c] = 1; }, remove(c) { delete e._cls[c]; },
      contains(c) { return !!e._cls[c]; },
      toggle(c, on) { const want = on === undefined ? !e._cls[c] : on; if (want) e._cls[c] = 1; else delete e._cls[c]; return want; }
    },
    setAttribute(k, v) { e._attrs[k] = String(v); }, getAttribute(k) { return e._attrs[k] == null ? null : e._attrs[k]; },
    appendChild(c) { c._parent = e; }, remove() {}, click() {}, focus() {}, addEventListener() {},
    insertAdjacentHTML() {}, removeChild() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }
  };
  return e;
}
const doc = {
  addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); }, removeEventListener() {},
  createElement: el, getElementById: () => el('div'), querySelector: () => null, querySelectorAll: () => [],
  body: el('body'), documentElement: el('html'), head: el('head'), readyState: 'complete', title: ''
};
const ctx = vm.createContext({
  document: doc, console: console, navigator: { userAgent: 'node' },
  window: { location: { href: 'http://x/', pathname: '/', search: '', hash: '' }, addEventListener() {}, print() {}, document: doc },
  location: { href: 'http://x/', pathname: '/', search: '', hash: '' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  FileReader: function () { this.readAsDataURL = function () {}; },
  fetch: () => Promise.resolve({ ok: false }), setTimeout: setTimeout, clearTimeout: clearTimeout,
  alert() {}, confirm: () => false, prompt: () => ''
});
ctx.self = ctx; ctx.location = ctx.window.location;
vm.runInContext(fs.readFileSync(dir + 'js/common.js', 'utf8'), ctx, { filename: 'common.js' });
const F = (expr, args) => vm.runInContext(expr, ctx).apply(null, args || []);

let bad = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || !extra ? '' : '  [' + String(extra).slice(0, 140) + ']'));
  if (!cond) bad++;
}
const count = (s, re) => (String(s).match(re) || []).length;

const chips150 = F('pgChipsHTML', [150, [1, 3]]);
check('chips go past 99 (all pages of the book)', count(chips150, /class="pg-ck"/g) === 150 &&
  chips150.indexOf('> 99<') !== -1 && chips150.indexOf('> 150<') !== -1);
check('selected pages come back ticked + highlighted', count(chips150, /"pg-ck" value="1" checked/g) === 1 &&
  count(chips150, /pg-chip on/g) === 2);
const picker = F('pagePickerHTML', [[], 0, {}]);
check('picker has toolbar + grid + hint',
  picker.indexOf('data-pg-grid') !== -1 && picker.indexOf('pg-total-num') !== -1 &&
  picker.indexOf('pg-from') !== -1 && picker.indexOf('pg-to') !== -1 &&
  picker.indexOf('data-act="pg-range"') !== -1 && picker.indexOf('data-act="pg-all"') !== -1 &&
  picker.indexOf('data-act="pg-clear"') !== -1 && picker.indexOf('pg-hint') !== -1);
check('default picker offers at least 60 pages', count(picker, /class="pg-ck"/g) >= 60,
  'chips=' + count(picker, /class="pg-ck"/g));
check('a total of 400 renders all 400 pages', count(F('pagePickerHTML', [[], 400, {}]), /class="pg-ck"/g) === 400);
check('selections above the total are kept', count(F('pagePickerHTML', [[250], 0, {}]), /class="pg-ck"/g) === 250);
check('linked PDF is offered to the picker',
  F('pagePickerHTML', [[], 10, { pdf: '/uploads/x.pdf' }]).indexOf('data-pg-pdf="/uploads/x.pdf"') !== -1);
/* --------------------------------------------------------- fake picker --- */
check('the 99-page cap is gone from the source',
  !/i <= 99/.test(fs.readFileSync(dir + 'js/super.js', 'utf8')) &&
  !/i <= 99/.test(fs.readFileSync(dir + 'js/common.js', 'utf8')));
function fakePicker(total) {
  const chips = [];
  const root = el('div');
  root.classList.add('page-pick');
  root.dataset = { pgTotal: String(total) };
  for (let i = 1; i <= total; i++) {
    const chip = el('label');
    chip.classList.add('pg-chip');
    const ck = el('input');
    ck.className = 'pg-ck'; ck.value = String(i); ck.checked = false;
    ck.closest = sel => (sel === '.pg-chip' ? chip : (sel === '[data-pg]' ? root : null));
    chip.closest = () => root;
    chips.push(ck);
  }
  const grid = el('div');
  grid.className = 'pg-grid';
  const num = el('input');
  num.className = 'pg-total-num'; num.value = String(total);
  root.querySelector = sel => (sel === '[data-pg-grid]' ? grid : (sel === '.pg-total-num' ? num : null));
  root.querySelectorAll = sel => (sel === '.pg-ck' ? chips : (sel === '.pg-ck:checked' ? chips.filter(c => c.checked) : []));
  root._ = { grid, num, chips };
  return root;
}
let root = fakePicker(120);
try {
  F('pgRange', [root, 5, 8]);
  check('Select range ticks only that range',
    root._.chips.filter(c => c.checked).map(c => Number(c.value)).join(',') === '5,6,7,8' &&
    root._.chips[4].closest('.pg-chip').classList.contains('on'));
  F('pgAllRanges', [root, true]);
  check('All pages ticks every chip', root._.chips.filter(c => c.checked).length === 120);
  F('pgAllRanges', [root, false]);
  check('Clear empties the selection', root._.chips.filter(c => c.checked).length === 0);
  F('pgRebuild', [root, 300, [1, 2]]);
  check('changing the page total rebuilds the grid',
    count(root._.grid.innerHTML, /class="pg-ck"/g) === 300 && String(root._.num.value) === '300' &&
    count(root._.grid.innerHTML, /checked/g) === 2);
} catch (e) {
  check('picker helper calls run without error', false, e.message);
}
check('page click/change handlers are registered',
  (listeners.click || []).length >= 2 && (listeners.change || []).length >= 1);

/* --------------------------------------------- wired into both consoles -- */
const admin = fs.readFileSync(dir + 'js/admin.js', 'utf8');
const sup = fs.readFileSync(dir + 'js/super.js', 'utf8');
const common = fs.readFileSync(dir + 'js/common.js', 'utf8');
const css = fs.readFileSync(dir + 'css/style.css', 'utf8');
check('only common.js defines pagePickerHTML',
  /function pagePickerHTML/.test(common) && !/function pagePickerHTML/.test(admin) && !/function pagePickerHTML/.test(sup));
check('admin fills both Select-pages boxes (add + edit chapter)',
  /#chfPages/.test(admin) && /pagePickerHTML\(\[\], total, \{ pdf: pdf \}\)/.test(admin) &&
  /#cePages/.test(admin) && /pagePickerHTML\(booksState\.editPages/.test(admin) &&
  /initPagePickers\(area\)/.test(admin) && /initPagePickers\(document\)/.test(admin) &&
  !/chfPages"><label>Select pages \*<\/label><\/div>/.test(admin));
check('super sets the current book so the picker knows the size',
  /S\.curBook = b;/.test(sup) && /pgInit\(p\)/.test(sup) && /S\.library = library;/.test(sup) &&
  sup.indexOf('page-pick"><label>Select pages *</label>\' + pagePickerHTML') === -1);
check('picker CSS wraps and scrolls instead of overflowing',
  /\.page-pick \{ display: block; flex: 1 1 100%/.test(css) &&
  /max-height: 190px;[\s\S]{0,120}?overflow: auto;/.test(css));
console.log(bad ? bad + ' FAILED' : 'PAGE PICKER OK');
process.exit(bad ? 1 : 0);

