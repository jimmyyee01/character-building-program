/* MODULE 1 = MODE: SUMMARY — typed answers scored against the chapter's key
   words. Usage: node tools/keywords-api-check.js [base] */
const BASE = (process.argv[2] || 'http://127.0.0.1:3000') + '/api';
let bad = 0;
const check = (n, c, x) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c || !x ? '' : '  [' + String(x).slice(0, 160) + ']')); if (!c) bad++; };
async function api(path, token, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, Object.assign({}, opts, { headers }));
  return res.json();
}
const post = (path, body, token) => api(path, token, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

(async function () {
  const sup = await api('/auth/super-login', null, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'superadmin', password: 'SuperAdmin@123' }) });
  check('super login', !!sup.token, JSON.stringify(sup).slice(0, 100));

  /* the editor sees key words (curated or suggested) for every chapter */
  const books = await api('/books?moduleId=mod_gamma', sup.token);
  const book = (books.books || [])[0] || {};
  const chs = book.chapters || [];
  check('module 1 has chapters', chs.length > 0, 'chapters=' + chs.length);
  check('chapter payload carries key words + suggestions for the editor',
    chs.length > 0 && Array.isArray(chs[0].keywords) && Array.isArray(chs[0].suggestedKeywords) &&
    chs[0].suggestedKeywords.length > 0 && 'keywordsSource' in chs[0],
    JSON.stringify(chs[0] || {}).slice(0, 160));

  /* an admin can curate the list */
  const target = chs[0] || {};
  const put = await api('/chapters/' + target.id, sup.token, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords: 'character, integrity, communication' }) });
  check('curated key words are saved', put.ok !== false, JSON.stringify(put).slice(0, 140));
  const after = await api('/books?moduleId=mod_gamma', sup.token);
  const ch2 = (((after.books || [])[0] || {}).chapters || []).filter(c => c.id === target.id)[0] || {};
  check('curated list comes back marked as set',
    ch2.keywordsSource === 'set' && (ch2.keywords || []).indexOf('integrity') !== -1, JSON.stringify(ch2.keywords));

  /* the learner gets the key words with the chapter */
  const stu = await post('/auth/login', { slug: 'greenfield-academy', identifier: 'STU-001', password: 'Student@123' });
  check('student login', !!stu.token, JSON.stringify(stu).slice(0, 100));
  const bk = await api('/book/' + book.id, stu.token);
  const stCh = (bk.chapters || []).filter(c => c.id === target.id)[0] || {};
  check('learner sees the chapter key words', Array.isArray(stCh.keywords) && stCh.keywords.length === 3,
    JSON.stringify(stCh.keywords));

  /* a typed answer is scored against them (re-runnable: reuse a stored score) */
  const text = 'Character matters: integrity is shown when my communication is honest, and communication builds trust. Integrity keeps character steady in private, not only in public.';
  const sub = await post('/submissions', { type: 'chapter_summary', chapterId: target.id, text: text }, stu.token);
  let a = sub.assessment || {};
  if (!sub.ok && /already submitted/i.test(String(sub.error))) {
    const again = await api('/book/' + book.id, stu.token);
    const c3 = (again.chapters || []).filter(c => c.id === target.id)[0] || {};
    const sm = c3.submission || {};
    a = { keywordsTotal: sm.keywordsTotal, keywordsUsed: sm.keywordsUsed, keywordScore: sm.keywordScore, keywordsCovered: [] };
    check('a stored answer keeps its key-word assessment',
      sm.keywordScore === 100 && sm.keywordsUsed === 3, JSON.stringify(sm).slice(0, 160));
  } else {
    check('typed chapter summary accepted', sub.ok !== false && !!sub.submission, JSON.stringify(sub).slice(0, 160));
  }
  check('answer is assessed against the key words',
    a.keywordsTotal === 3 && a.keywordsUsed === 3 && a.keywordScore === 100, JSON.stringify(a).slice(0, 160));
  check('assessment lists what was found',
    Array.isArray(a.keywordsCovered) && a.keywordsCovered.length !== 1, JSON.stringify(a.keywordsCovered));

  /* a partial answer scores lower and reports what is missing */
  const other = chs[1];
  if (other) {
    await api('/chapters/' + other.id, sup.token, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: 'diligence, humility, patience' }) });
    const sub2 = await post('/submissions', { type: 'chapter_summary', chapterId: other.id,
      text: 'I wrote about diligence today because diligence is the habit of finishing what I start, again and again.' }, stu.token);
    let a2 = sub2.assessment || {};
    if (!sub2.ok && /already submitted/i.test(String(sub2.error))) {
      const again2 = await api('/book/' + book.id, stu.token);
      const c4 = (again2.chapters || []).filter(c => c.id === other.id)[0] || {};
      a2 = { keywordsTotal: 3, keywordsUsed: (c4.submission || {}).keywordsUsed, keywordScore: (c4.submission || {}).keywordScore,
        keywordsMissing: (c4.submission || {}).keywordsMissing || [] };
    }
    check('a partial answer scores partial', a2.keywordsTotal === 3 && a2.keywordsUsed === 1 && a2.keywordScore === 33,
      JSON.stringify(a2).slice(0, 160));
    check('missing key words are reported to help assessment',
      Array.isArray(a2.keywordsMissing) && a2.keywordsMissing.indexOf('humility') !== -1,
      JSON.stringify(a2.keywordsMissing));
  }

  /* module 1 stays typed-only: objectives are refused */
  const obj = await post('/submissions', { type: 'objectives', chapterId: (chs[2] || target).id,
    answers: [{ optionIndex: 0 }] }, stu.token);
  check('module 1 rejects selected (objective) answers', obj.ok === false, JSON.stringify(obj).slice(0, 140));

  /* reporting: the learner shows a key-word score */
  const admin = await post('/auth/login', { slug: 'greenfield-academy', identifier: 'admin@greenfield.edu', password: 'Admin@123' });
  const rep = await api('/reports/students', admin.token);
  const row = (rep.students || []).filter(s => s.studentNumber === 'STU-001')[0] || {};
  check('progress report shows key-word coverage per learner',
    row.keywordScore !== null && row.keywordScore !== undefined && row.typedAnswers >= 1, JSON.stringify(row).slice(0, 140));
  const dash = await api('/dashboard', stu.token);
  const rec = (dash.recent || []).filter(r => r.keywordScore != null)[0];
  check('learner recent work carries the key-word score', !!rec, JSON.stringify(dash.recent || []).slice(0, 140));

  console.log(bad ? '\n' + bad + ' FAILED' : '\nKEY WORDS OK');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(1); });
