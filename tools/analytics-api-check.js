/* Account analytics: isolation between accounts, supervisor scope, and the person
   a copy flag is connected to. Usage: node tools/analytics-api-check.js [base] */
const BASE = (process.argv[2] || 'http://127.0.0.1:3000') + '/api';
let bad = 0;
const check = (n, c, x) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c || !x ? '' : '  [' + String(x).slice(0, 190) + ']')); if (!c) bad++; };
async function api(path, token, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, Object.assign({}, opts, { headers }));
  return res.json();
}
const post = (p, body, token) => api(p, token, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

(async function () {
  const sup = await post('/auth/super-login', { username: 'superadmin', password: 'SuperAdmin@123' });
  const gf = await post('/auth/login', { slug: 'greenfield-academy', identifier: 'admin@greenfield.edu', password: 'Admin@123' });
  const hor = await post('/auth/login', { slug: 'horizon-alliance', identifier: 'admin@horizon.org', password: 'Admin@123' });
  const supv = await post('/auth/login', { slug: 'horizon-alliance', identifier: 'supervisor@horizon.org', password: 'Super@123' });
  const stu1 = await post('/auth/login', { slug: 'greenfield-academy', identifier: 'STU-001', password: 'Student@123' });
  const stu2 = await post('/auth/login', { slug: 'greenfield-academy', identifier: 'STU-002', password: 'Student@123' });
  check('all logins', !!sup.token && !!gf.token && !!hor.token && !!supv.token && !!stu1.token && !!stu2.token);

  const A = await api('/admin/analytics', gf.token);
  check('account analytics loads for the account admin', A.ok && Array.isArray(A.accounts) && !!A.impact,
    JSON.stringify(A).slice(0, 140));
  check('it reports only that account', (A.accounts || []).length === 1 &&
    (A.accounts || [])[0].name === 'Greenfield Academy' && (A.filters.tenants || []).length === 1,
    JSON.stringify((A.accounts || []).map(a => a.name)));
  check('it carries individuals, modules/books/chapters and weekly activity',
    (A.learners || []).length > 0 && (A.modules || []).length > 0 &&
    (((A.modules || [])[0].books || [])[0] || {}).chapters && (A.activity || []).length >= 4,
    'learners=' + (A.learners || []).length);

  const H = await api('/admin/analytics', hor.token);
  check('another account sees only itself', (H.accounts || []).length === 1 &&
    (H.accounts || [])[0].name === 'Horizon Alliance', JSON.stringify((H.accounts || []).map(a => a.name)));
  const gfNames = (A.learners || []).map(l => l.name);
  const horNames = (H.learners || []).map(l => l.name);
  check('no learner of one account leaks into another',
    horNames.every(n => gfNames.indexOf(n) === -1) && horNames.length > 0,
    JSON.stringify(horNames));
  check('the portal list is limited to the viewer too',
    (H.filters.portals || []).length === 1 && (H.filters.portals || [])[0].name === 'Organization Portal',
    JSON.stringify((H.filters.portals || []).map(p => p.name)));

  const S = await api('/admin/analytics', supv.token);
  check('a supervisor only sees the members they look after',
    S.ok && (S.learners || []).length === 1 && (S.learners || [])[0].name === 'Olive Worker',
    JSON.stringify((S.learners || []).map(l => l.name)));

  const denied = await api('/admin/analytics', stu1.token);
  check('a learner cannot open account analytics (403)', denied.ok === false && denied.error, JSON.stringify(denied).slice(0, 120));

  /* ---- the person a copy flag is connected to ---- */
  /* two fresh learners so the check never depends on other tests' progress */
  const mkA = await post('/users', { role: 'student', fullName: 'Copy Check A', studentNumber: 'STU-901', password: 'Student@123' }, gf.token);
  const mkB = await post('/users', { role: 'student', fullName: 'Copy Check B', studentNumber: 'STU-902', password: 'Student@123' }, gf.token);
  check('two learners created for the copy check', mkA.ok !== false && mkB.ok !== false,
    JSON.stringify(mkA).slice(0, 120) + JSON.stringify(mkB).slice(0, 120));
  const ca = await post('/auth/login', { slug: 'greenfield-academy', identifier: 'STU-901', password: 'Student@123' });
  const cb = await post('/auth/login', { slug: 'greenfield-academy', identifier: 'STU-902', password: 'Student@123' });
  check('the copy-check learners can log in', !!ca.token && !!cb.token);
  const books = await api('/books?moduleId=mod_gamma', sup.token);
  const book = (books.books || [])[0] || {};
  const first = (book.chapters || [])[0] || {};
  const text = 'Communication is the vehicle of leadership and character is built in the quiet choices, ' +
    'so integrity in my words shapes the people around me every single day of this programme.';
  const s1 = await post('/submissions', { type: 'chapter_summary', chapterId: first.id, text: text }, ca.token);
  const s2 = await post('/submissions', { type: 'chapter_summary', chapterId: first.id, text: text }, cb.token);
  check('first submission is original', s1.ok !== false, JSON.stringify(s1).slice(0, 140));
  check('second submission is flagged as a copy', s2.ok !== false && s2.submission && s2.submission.flagged === true,
    JSON.stringify(s2).slice(0, 160));
  const flaggedList = await api('/admin/submissions?flagged=1', gf.token);
  const flagged = (flaggedList.submissions || []).filter(function (f) {
    return f.userName === 'Copy Check B';
  })[0] || {};
  check('the flagged submission names the person it matched',
    flagged.matchedWith && flagged.matchedWith.name === 'Copy Check A' && flagged.matchedWith.similarity >= 75,
    JSON.stringify(flagged).slice(0, 190));
  check('the flag names both sides', flagged.userName === 'Copy Check B' && flagged.matchedName === 'Copy Check A',
    JSON.stringify({ who: flagged.userName, matched: flagged.matchedName }));
  const A2 = await api('/admin/analytics', gf.token);
  const anFlag = (A2.flagged || []).filter(function (f) { return f.userName === 'Copy Check B'; })[0] || {};
  check('the analytics report lists the copy flag with both people',
    anFlag.userName === 'Copy Check B' && anFlag.matchedName === 'Copy Check A' &&
    anFlag.matchedWith && anFlag.matchedWith.similarity >= 75, JSON.stringify(anFlag).slice(0, 190));
  const SF = await api('/super/analytics', sup.token);
  check('the super report has the same copy-flag detail',
    (SF.flagged || []).some(function (f) { return f.matchedWith && f.matchedWith.name === 'Copy Check A'; }),
    JSON.stringify((SF.flagged || [])[0] || {}).slice(0, 160));
  check('the super report also filters by portal and account',
    (SF.filters.portals || []).length >= 4 && (SF.filters.tenants || []).length >= 4);

  console.log(bad ? '\n' + bad + ' FAILED' : '\nANALYTICS SCOPING OK');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(1); });
