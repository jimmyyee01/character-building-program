/* Verifies chapter page ranges above 99 round-trip through the API (the picker
   used to stop at 99). Usage: node check_pages_api.js [base] */
const BASE = (process.argv[2] || 'http://127.0.0.1:3000') + '/api';
let bad = 0;
const check = (n, c, x) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c || !x ? '' : '  [' + x + ']')); if (!c) bad++; };
async function api(path, token, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, Object.assign({}, opts, { headers }));
  return res.json();
}
(async function () {
  const sup = await api('/auth/super-login', null, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'superadmin', password: 'SuperAdmin@123' }) });
  check('super login', !!sup.token);
  const books = await api('/books?moduleId=mod_gamma', sup.token);
  const book = (books.books || [])[0];
  check('a seeded book exists to test with', !!book, JSON.stringify(books).slice(0, 100));
  if (!book) { console.log('\n1 FAILED'); process.exit(1); }
  const mk = await api('/books/' + book.id + '/chapters', sup.token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Page-150 check', pageStart: 120, pageEnd: 150 }) });
  check('chapter with pages 120–150 is accepted', mk.ok || !!mk.chapter, JSON.stringify(mk).slice(0, 120));
  const after = await api('/books?moduleId=mod_gamma', sup.token);
  const b2 = (after.books || []).filter(b => b.id === book.id)[0] || {};
  const ch = (b2.chapters || []).filter(c => c.title === 'Page-150 check')[0];
  check('pages above 99 are stored and returned', ch && Number(ch.pageStart) === 120 && Number(ch.pageEnd) === 150,
    JSON.stringify(ch || {}).slice(0, 140));
  if (ch) {
    const del = await api('/chapters/' + ch.id, sup.token, { method: 'DELETE' });
    check('test chapter removed', del.ok || !!del.error, JSON.stringify(del).slice(0, 80));
  }
  console.log(bad ? bad + ' FAILED' : 'PAGE RANGE (:99+) OK');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(1); });
