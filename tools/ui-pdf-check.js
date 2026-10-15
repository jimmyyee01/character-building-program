/* Checks (a) the book-style PDF reader logic/markup and (b) that user lists are
   rendered BELOW the search area, not beside it. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const dir = path.join(__dirname, '..', 'public') + path.sep;

const listeners = {};
function makeEl(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(), className: '', textContent: '', disabled: false,
    dataset: {}, _attrs: {}, _children: [],
    style: { setProperty() {}, removeProperty() {} },
    classList: {
      _s: {},
      add(c) { this._s[c] = true; }, remove(c) { delete this._s[c]; },
      contains(c) { return !!this._s[c]; },
      toggle(c) { if (this._s[c]) { delete this._s[c]; return false; } this._s[c] = true; return true; }
    },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] == null ? null : this._attrs[k]; },
    appendChild(c) { this._children.push(c); }, remove() {}, click() {}, focus() {},
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }
  };
}
const doc = {
  addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
  removeEventListener() {}, createElement: makeEl,
  getElementById: () => makeEl('div'), querySelector: () => null, querySelectorAll: () => [],
  body: makeEl('body'), documentElement: makeEl('html'), head: makeEl('head'),
  readyState: 'complete', title: ''
};
global.document = doc;
global.window = { location: { href: 'http://x/', pathname: '/', search: '', hash: '' }, addEventListener() {}, print() {}, document: doc };
global.location = global.window.location;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.Blob = function () {}; global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
global.FileReader = function () { this.readAsDataURL = function () {}; };
global.navigator = { userAgent: 'node' };
global.alert = () => {}; global.confirm = () => false; global.prompt = () => '';

vm.runInThisContext(fs.readFileSync(dir + 'js/common.js', 'utf8'), { filename: 'common.js' });

let bad = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || !extra ? '' : '  [' + extra + ']'));
  if (!cond) bad++;
}

const html = bookReaderHtml('/uploads/books/alpha.pdf', { title: 'Alpha Book' });
check('reader markup: wrapper + one-page fragment',
  html.indexOf('class="book-reader"') !== -1 && html.indexOf('data-book="/uploads/books/alpha.pdf"') !== -1 &&
  html.indexOf('#page=1') !== -1 && html.indexOf('view=Fit') !== -1 &&
  html.indexOf('toolbar=0') !== -1 && html.indexOf('navpanes=0') !== -1);
check('reader markup: turn arrows both sides + bar buttons',
  html.indexOf('class="page-turn prev"') !== -1 && html.indexOf('class="page-turn next"') !== -1 &&
  (html.match(/data-book-turn="1"/g) || []).length === 2 &&
  (html.match(/data-book-turn="-1"/g) || []).length === 2);
check('reader markup: page counter + full page + fallback link',
  html.indexOf('data-book-page') !== -1 && html.indexOf('data-book-total') !== -1 &&
  html.indexOf('data-book-full') !== -1 && html.indexOf('target="_blank"') !== -1);
check('non-PDF urls still fall back to a link',
  pdfHtml('/uploads/img/photo.jpg').indexOf('book-reader') === -1 &&
  pdfHtml('/uploads/img/photo.jpg').indexOf('Open') !== -1);
check('pdfHtml keeps the book shut: cover only, no iframe',
  pdfHtml('/uploads/books/alpha.pdf').indexOf('book-open-card') !== -1 &&
  pdfHtml('/uploads/books/alpha.pdf').indexOf('book-reader') === -1 &&
  pdfHtml('/uploads/books/alpha.pdf').indexOf('<iframe') === -1);
check('cover carries url + title + Open button for later',
  pdfHtml('/uploads/books/alpha.pdf', { title: 'Alpha Book' }).indexOf('data-book-url="/uploads/books/alpha.pdf"') !== -1 &&
  pdfHtml('/uploads/books/alpha.pdf', { title: 'Alpha Book' }).indexOf('data-book-title="Alpha Book"') !== -1 &&
  pdfHtml('/uploads/books/alpha.pdf').indexOf('data-book-load') !== -1);
check('pdfHtml({open:true}) shows the reader straight away',
  pdfHtml('/uploads/books/alpha.pdf', { open: true }).indexOf('class="book-reader"') !== -1);
check('query-string PDF urls are recognised (and stay shut)',
  pdfHtml('/f/documents/book.pdf?v=12').indexOf('book-open-card') !== -1);

/* clicking the cover must swap in the reader (nothing loads before that) */
const card = makeEl('div');
card.setAttribute('data-book-url', '/uploads/books/alpha.pdf');
card.setAttribute('data-book-title', 'Alpha Book');
let inserted = '', removed = false;
card.insertAdjacentHTML = (pos, s) => { inserted = pos + '|' + s; };
card.remove = () => { removed = true; };
card.parentNode = makeEl('div');
card.closest = sel => (sel === '.book-open-card' ? card : null);
(listeners.click || []).forEach(function (fn) {
  try { fn({ target: card, preventDefault() {} }); } catch (e) {}
});
check('clicking the cover replaces it with the open reader',
  inserted.indexOf('beforebegin|') === 0 && inserted.indexOf('class="book-reader"') !== -1 &&
  inserted.indexOf('#page=1') !== -1 && removed, inserted.slice(0, 60));
/* chapter-scoped reading: only the chapter's own pages can be reached */
check('ranged reader starts at the chapter page and is clamped to it',
  (function () {
    const r = bookReaderHtml('/uploads/book.pdf', { title: 'Chapter pages 12-18', from: 12, to: 18 });
    return r.indexOf('data-page="12"') !== -1 && r.indexOf('data-book-min="12"') !== -1 &&
      r.indexOf('data-book-max="18"') !== -1 && r.indexOf('#page=12') !== -1 &&
      r.indexOf('Chapter pages 12') !== -1 && r.indexOf('of 18') !== -1;
  })());
check('ranged reader cannot page outside the chapter',
  (function () {
    const root = fakeRoot(0);
    root.dataset = { book: '/uploads/book.pdf', page: '12', bookMin: '12', bookMax: '18' };
    bookGo(root, -1);
    const atStart = Number(root.dataset.page) === 12 && root._.prevs[0].disabled === true;
    bookGo(root, 9);
    const atEnd = Number(root.dataset.page) === 18 && root._.nexts[0].disabled === true;
    return atStart && atEnd;
  })());
check('a chapter cover carries its page range and never embeds the book',
  (function () {
    const c = pdfHtml('/uploads/book.pdf', { title: 'Chapter pages 12-18', from: 12, to: 18 });
    return c.indexOf('book-open-card') !== -1 && c.indexOf('data-book-from="12"') !== -1 &&
      c.indexOf('data-book-to="18"') !== -1 && c.indexOf('Pages 12') !== -1 &&
      c.indexOf('<iframe') === -1 && c.indexOf('book-reader') === -1;
  })());
check('a locked book renders a lock card, not a reader',
  (function () {
    const c = bookLockedHtml('Daily Meditations', 'Finish every module to open the books.');
    return c.indexOf('book-open-card locked') !== -1 && c.indexOf('data-book-url') === -1 && c.indexOf('<iframe') === -1;
  })());
check('a chapter click opens its own pages with a Close button',
  (function () {
    const app = fs.readFileSync(dir + 'js/app.js', 'utf8');
    return /open: true, back: true/.test(app) &&
      /from: ch\.pageStart, to: ch\.pageEnd/.test(app) &&
      /chapter-book/.test(app);
  })());
check('no full-book PDF is offered on the chapter page',
  (function () {
    const app = fs.readFileSync(dir + 'js/app.js', 'utf8');
    return !/Open the whole book/.test(app) && !/S\.flow && S\.flow\.allDone && d\.book\.pdf/.test(app) &&
      !/Open full book/.test(app);
  })());
check('the reader carries a Close control and can leave a reopenable cover',
  (function () {
    const r = bookReaderHtml('/uploads/book.pdf', { title: 'Chapter pages 4-9', from: 4, to: 9, back: true });
    return r.indexOf('data-book-close') !== -1 && r.indexOf('data-book-back="1"') !== -1 &&
      r.indexOf('data-book-title="Chapter pages 4-9"') !== -1;
  })());
check('Close shuts the book and leaves the cover behind',
  (function () {
    const click = (listeners.click || [])[0];
    if (!click) return false;
    const root = makeEl('div');
    root.dataset = { book: '/uploads/book.pdf', bookTitle: 'Chapter pages 4-9', bookMin: '4', bookMax: '9',
      bookBack: '1', page: '4' };
    let inserted = '', closed = false;
    root.insertAdjacentHTML = (pos, html) => { inserted = pos + '|' + html; };
    root.remove = () => { closed = true; };
    root.parentNode = makeEl('div');
    const btn = makeEl('button');
    btn.setAttribute('data-book-close', '1');
    btn.closest = sel => (sel === '[data-book-close]' ? btn : (sel === '.book-reader' ? root : null));
    (listeners.click || []).forEach(function (fn) {
      try { fn({ target: btn, preventDefault() {} }); } catch (e) {}
    });
    return closed && inserted.indexOf('beforebegin|') === 0 &&
      inserted.indexOf('book-open-card') !== -1 && inserted.indexOf('data-book-from="4"') !== -1 &&
      inserted.indexOf('data-book-to="9"') !== -1 && inserted.indexOf('Open chapter pages') !== -1;
  })());

/* the book turns pages instead of scrolling */
check('reader markup clips the sheet and shields it (no scrolling)',
  (function () {
    const r = bookReaderHtml('/uploads/book.pdf', {});
    return r.indexOf('class="book-frame-wrap"') !== -1 && r.indexOf('data-book-shield') !== -1 &&
      r.indexOf('scrolling="no"') !== -1 && r.indexOf('never scrolls') !== -1;
  })());
check('wheel over the sheet turns the page and is prevented from scrolling',
  (function () {
    const wheel = (listeners.wheel || [])[0];
    if (!wheel) return false;
    /* fast reader: cooldown off, so wheel down/up both act */
    const root = fakeRoot(10);
    root.dataset.bookCooldown = '0';
    const shield = makeEl('div');
    shield.closest = sel => (sel === '[data-book-shield]' ? shield : (sel === '.book-reader' ? root : null));
    let prevented = false;
    const down = { target: shield, deltaY: 120, deltaX: 0, preventDefault: function () { prevented = true; } };
    wheel(down);
    const a = Number(root.dataset.page);
    wheel(down);
    const b = Number(root.dataset.page);
    wheel({ target: shield, deltaY: -160, deltaX: 0, preventDefault: function () {} });
    const c = Number(root.dataset.page);
    /* the shared cooldown stops one flick from flipping several readers/pages */
    const root2 = fakeRoot(10);
    const shield2 = makeEl('div');
    shield2.closest = sel => (sel === '[data-book-shield]' ? shield2 : (sel === '.book-reader' ? root2 : null));
    wheel({ target: shield2, deltaY: 120, deltaX: 0, preventDefault: function () {} });
    const d1 = Number(root2.dataset.page);
    const src = fs.readFileSync(dir + 'js/common.js', 'utf8');
    const coolOk = /Number\(root\.dataset\.bookCooldown \|\| 220\)/.test(src);
    return prevented && a === 2 && b === 3 && c === 2 && d1 === 1 && coolOk &&
      root._.sheet.classList.contains('turning');
  })());
check('a swipe left/right turns to the next/previous page',
  (function () {
    const start = (listeners.touchstart || [])[0];
    const end = (listeners.touchend || [])[0];
    if (!start || !end) return false;
    const root = fakeRoot(10);
    const shield = makeEl('div');
    shield.closest = sel => (sel === '[data-book-shield]' ? shield : (sel === '.book-reader' ? root : null));
    /* the swipe handler looks the shield up on the document */
    doc.querySelector = sel => (sel === '[data-book-shield]' ? shield : null);
    start({ target: shield, touches: [{ clientX: 300, clientY: 100 }] });
    end({ changedTouches: [{ clientX: 120, clientY: 110 }] });
    const next = Number(root.dataset.page);
    start({ target: shield, touches: [{ clientX: 120, clientY: 100 }] });
    end({ changedTouches: [{ clientX: 320, clientY: 105 }] });
    const prev = Number(root.dataset.page);
    doc.querySelector = () => null;
    return next === 2 && prev === 1;
  })());
check('the sheet crops the viewer scrollbar and animates the turn',
  (function () {
    const css = fs.readFileSync(dir + 'css/style.css', 'utf8');
    return /\.book-frame-wrap \{[^}]*overflow: hidden/.test(css) &&
      /\.book-frame-wrap \.pdf-frame \{ width: calc\(100% \+ 20px\); height: calc\(100% \+ 20px\); \}/.test(css) &&
      /\.book-shield \{ position: absolute; inset: 0; z-index: 3/.test(css) &&
      /@keyframes bookTurn/.test(css);
  })());

/* -------------------------------------------------------- paging logic ---- */
check('pdfSrc builds the single-page fragment',
  pdfSrc('/x.pdf', 7) === '/x.pdf#page=7&view=Fit&toolbar=0&navpanes=0&pagemode=none');
function fakeRoot(total) {
  const iframe = makeEl('iframe');
  const no = makeEl('b');
  const totalEl = makeEl('span');
  const sheet = makeEl('div');
  sheet.className = 'book-page';
  const prevs = [makeEl('button'), makeEl('button')];
  const nexts = [makeEl('button'), makeEl('button')];
  const root = makeEl('div');
  root.dataset = { book: '/uploads/books/alpha.pdf', page: '1' };
  if (total) root.dataset.total = String(total);
  root.classList.add('book-reader');
  const map = { iframe: iframe, '[data-book-page]': no, '[data-book-total]': totalEl, '.book-page': sheet };
  root.querySelector = sel => map[sel] || null;
  root.querySelectorAll = sel => (sel === '[data-book-turn="-1"]' ? prevs : nexts);
  root._ = { iframe, no, totalEl, prevs, nexts, sheet };
  return root;
}
let r = fakeRoot(5);
bookGo(r, 1);
check('next page: counter + iframe fragment + button states',
  Number(r.dataset.page) === 2 && r._.no.textContent === '2' &&
  r._.iframe.getAttribute('src') === '/uploads/books/alpha.pdf#page=2&view=Fit&toolbar=0&navpanes=0&pagemode=none' &&
  r._.prevs[0].disabled === false && r._.nexts[0].disabled === false, JSON.stringify(r.dataset));
bookGo(r, -1); bookGo(r, -1);
check('cannot page before page 1', Number(r.dataset.page) === 1 && r._.prevs[0].disabled === true);
bookGo(r, 9);
check('cannot page past the last page', Number(r.dataset.page) === 5 && r._.nexts[1].disabled === true);
r = fakeRoot(0);
bookGo(r, 1); bookGo(r, 1);
check('unknown page count still pages forward', Number(r.dataset.page) === 3 && r._.nexts[0].disabled === false);

/* the delegated click handler must actually turn the page */
const root2 = fakeRoot(5);
const turn = makeEl('button');
turn.setAttribute('data-book-turn', '1');
turn.closest = sel => (sel === '[data-book-turn]' ? turn : (sel === '.book-reader' ? root2 : null));
let prevented = false;
(listeners.click || []).forEach(function (fn) { try { fn({ target: turn, preventDefault() { prevented = true; } }); } catch (e) {} });
check('clicking a Next arrow flips the page end-to-end',
  Number(root2.dataset.page) === 2 && prevented && String(root2._.no.textContent) === '2',
  JSON.stringify(root2.dataset));

/* -------------------------------------------------------- page counting -- */
const fakePdf = Buffer.from('x'.repeat(200) + '/Type /Pages /Count 3 ' + '/Type /Page '.repeat(3) + 'y'.repeat(50), 'latin1');
global.fetch = () => Promise.resolve({
  ok: true,
  arrayBuffer: () => Promise.resolve(fakePdf.buffer.slice(fakePdf.byteOffset, fakePdf.byteOffset + fakePdf.byteLength))
});
pdfPageCount('/uploads/books/alpha.pdf').then(function (n) {
  check('page count is read from the PDF bytes', n === 3, 'got ' + n);
  const root = fakeRoot(0);
  bookCount(root);
  return new Promise(res => setTimeout(res, 20)).then(function () {
    check('reader shows the total once counted',
      Number(root.dataset.total) === 3 && root._.totalEl.textContent === ' of 3',
      JSON.stringify(root.dataset));
    check('click / keydown / iframe-load handlers are registered',
      (listeners.keydown || []).length >= 1 && (listeners.click || []).length >= 1 &&
      (listeners.load || []).length >= 1,
      'click=' + (listeners.click || []).length + ' keydown=' + (listeners.keydown || []).length +
      ' load=' + (listeners.load || []).length);
  });
}).then(function () {
  /* ------------------------------------------------ users list placement -- */
  const admin = fs.readFileSync(dir + 'js/admin.js', 'utf8');
  const sup = fs.readFileSync(dir + 'js/super.js', 'utf8');
  const i = admin.indexOf('id="usSearch"');
  const usersBlock = admin.slice(i, i + 1500);
  check('admin users: search row closes before the list',
    /<\/div>' \+\s*'<div class="row export-buttons"/.test(usersBlock) &&
    usersBlock.indexOf('<div id="usersArea">') > usersBlock.indexOf("'</div>' +"));
  check('admin users: table comes after the search area (not inside it)',
    /<div id="usersArea">' \+\s*\(usersCache\.length \? usersTableHtml\(\)/.test(usersBlock));
  check('admin users: dead duplicate markup removed',
    !/<\/div>' \+\r?\n\s+\(usersCache\.length \? usersTableHtml/.test(admin),
    'usersTableHtml calls: ' + (admin.match(/usersTableHtml\(\)/g) || []).length);
  const j = sup.indexOf('id="usSearch"');
  const supBlock = sup.slice(j, j + 1500);
  check('super users: list already sits below the search row',
    /<\/div>' \+\s*'<div class="row export-buttons"/.test(supBlock) &&
    supBlock.indexOf('<table id="usTable">') !== -1);
  check('progress report: list sits below the search row',
    admin.indexOf("<div id=\"progressArea\">' + progressTableHtml(list)") !== -1);
  /* books must not be embedded anywhere until clicked */
  const commonSrc = fs.readFileSync(dir + 'js/common.js', 'utf8');
  const pages = ['admin.js', 'app.js', 'super.js'].map(f => fs.readFileSync(dir + 'js/' + f, 'utf8'));
  check('no page embeds a PDF iframe directly (only the reader does)',
    pages.every(s => s.indexOf('pdf-frame') === -1) && (commonSrc.match(/class="pdf-frame"/g) || []).length === 1);
  check('pdfHtml / cover helpers are defined once, in common.js',
    pages.every(s => !/function (pdfHtml|bookCoverHtml|bookReaderHtml)/.test(s)) &&
    /function bookCoverHtml/.test(commonSrc) && /function pdfHtml/.test(commonSrc));
  check('library rows and reading views use the closed cover',
    /if \(it\.url\) return pdfHtml\(it\.url\);/.test(admin) &&
    (pages[1].match(/pdfHtml\(d\.book\.pdf/g) || []).length === 1 &&
    /open: true, back: true/.test(pages[1]) &&
    !/pdfHtml\(d\.book\.pdf, \{\s*title: 'Open the whole book'/.test(pages[1]));
  console.log(bad ? bad + ' FAILED' : 'PDF READER + LIST PLACEMENT OK');
  process.exit(bad ? 1 : 0);
}).catch(function (e) { console.log('FATAL ' + e.message); process.exit(1); });

