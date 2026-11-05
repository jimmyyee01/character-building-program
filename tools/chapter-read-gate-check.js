/* The chapter reading gate — a learner may only answer a chapter once its own
   pages have been read to the LAST page, may always go back and read again, and
   a chapter without pages of its own stays answerable.

   Usage: node tools/chapter-read-gate-check.js
   The real server runs against a throw-away database on a free port, so the
   seeded demo data is untouched. */
const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cbp-read-gate-'));
const DB_FILE = path.join(TEMP_DIR, 'db.json');
const SUMMARY_TEXT = 'This chapter taught me that character grows through small honest choices ' +
  'made every day, especially when nobody is watching and no reward is offered.';

let server;
let failures = 0;
const extraServers = [];
const extraDirs = [];

function check(name, condition, detail) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + name + (condition || !detail ? '' : ' [' + detail + ']'));
  if (!condition) failures++;
}

function findPort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const port = listener.address().port;
      listener.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function call(base, endpoint, token, options) {
  options = options || {};
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(base + '/api' + endpoint, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  let data = {};
  try { data = await response.json(); } catch (error) { /* some replies are empty */ }
  return { status: response.status, data };
}

async function login(base, slug, identifier, password) {
  const response = await call(base, '/auth/login', null, {
    method: 'POST', body: { slug, identifier, password }
  });
  return response.data.token || null;
}

async function waitForServer(base, proc) {
  let lastError;
  for (let i = 0; i < 80; i++) {
    if (proc.exitCode !== null) throw new Error('Test server exited before readiness');
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw lastError || new Error('Timed out waiting for the test server');
}

function prepareDatabase(file) {
  const env = Object.assign({}, process.env, { APP_DB_FILE: file || DB_FILE });
  const seed = childProcess.spawnSync(process.execPath, [path.join(ROOT, 'server', 'seed.js')], {
    cwd: ROOT, env, encoding: 'utf8'
  });
  if (seed.status !== 0) throw new Error(seed.stderr || 'Could not create isolated test database');
}

/* the chapter the learner is working on right now, from the learner's own view */
function chapterOf(book, id) {
  return ((book.data || {}).chapters || []).find(c => c.id === id) || {};
}

/* The same gate on an OBJECTIVES module, where the answer area is a set of
   multiple-choice questions. A second throw-away database is patched so the
   learner's own book is an objectives book with pages, and a second server runs
   that database, so the summary scenario above stays untouched. */
async function objectivesGate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbp-read-gate-obj-'));
  const file = path.join(dir, 'db.json');
  extraDirs.push(dir);
  prepareDatabase(file);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const chapterId = 'book_gamma_1_ch1';
  data.modules.find(m => m.id === 'mod_gamma').mode = 'objectives';
  data.library.push({ id: 'lib_gate_probe', type: 'book', scope: 'global',
    title: 'Gate probe PDF', url: '/uploads/gate-probe.pdf', createdAt: new Date().toISOString() });
  data.books.find(b => b.id === 'book_gamma_1').libraryId = 'lib_gate_probe';
  const chapter = data.chapters.find(c => c.id === chapterId);
  chapter.pageStart = 1;
  chapter.pageEnd = 4;
  data.objectives.push({ id: 'obj_gate_probe', chapterId, scope: 'global', order: 1,
    question: 'Which choice shows character?',
    options: ['Looking away', 'Keeping your word', 'Blaming others'], answerIndex: 1,
    createdAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));

  const port = await findPort();
  const base = 'http://127.0.0.1:' + port;
  const proc = childProcess.spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port), APP_DB_FILE: file }),
    stdio: 'ignore'
  });
  extraServers.push(proc);
  await waitForServer(base, proc);

  const student = await login(base, 'greenfield-academy', 'STU-001', 'Student@123');
  /* the questions come back shuffled for this login, so the answer is the index
     of the correct option IN THAT ORDER (exactly what the learner's radios show) */
  const objs = await call(base, '/chapter/' + chapterId + '/objectives', student);
  const question = ((objs.data || {}).objectives || [])[0] || {};
  const correctIndex = (question.options || []).indexOf('Keeping your word');
  const answers = [{ objectiveId: 'obj_gate_probe', choice: correctIndex }];
  check('the objectives screen hands the learner its shuffled choices',
    correctIndex >= 0, JSON.stringify(question).slice(0, 200));
  const view = await call(base, '/book/book_gamma_1', student);
  const state = chapterOf(view, chapterId);
  check('an objectives chapter with pages must be read before it is answered',
    view.status === 200 && state.requiresReading === true && state.read === false,
    JSON.stringify(state));

  const early = await call(base, '/submissions', student, { method: 'POST',
    body: { type: 'objectives', chapterId, answers } });
  check('choosing answers before the last page is refused',
    early.status === 403 && /last page/i.test(early.data.error || ''),
    early.status + ' ' + JSON.stringify(early.data).slice(0, 200));

  await call(base, '/chapter/' + chapterId + '/read', student, { method: 'POST', body: { page: 4 } });
  const after = await call(base, '/submissions', student, { method: 'POST',
    body: { type: 'objectives', chapterId, answers } });
  check('the answers are accepted once the last page has been read',
    after.status === 200 && !!after.data.submission && after.data.submission.score === 1,
    after.status + ' ' + JSON.stringify(after.data).slice(0, 200));

  try { proc.kill('SIGKILL'); } catch (e) { /* already gone */ }
  await new Promise(resolve => setTimeout(resolve, 400));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* later */ }
}

async function main() {
  prepareDatabase();
  const port = await findPort();
  const base = 'http://127.0.0.1:' + port;
  server = childProcess.spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port), APP_DB_FILE: DB_FILE }),
    stdio: 'ignore'
  });
  await waitForServer(base, server);

  const admin = await login(base, 'greenfield-academy', 'admin@greenfield.edu', 'Admin@123');
  const student = await login(base, 'greenfield-academy', 'STU-001', 'Student@123');
  const stranger = await login(base, 'horizon-alliance', 'olive@horizon.org', 'Member@123');
  check('the account admin, a learner and a second account can sign in',
    !!admin && !!student && !!stranger);
  if (!admin || !student) throw new Error('Missing seeded accounts');

  /* -------------------------------------------------- the book to read ---- */
  const modules = await call(base, '/modules', student);
  const activeModule = ((modules.data || {}).modules || []).find(m => m.status === 'active');
  check('the learner has an active module', !!activeModule, JSON.stringify(modules.data).slice(0, 160));
  if (!activeModule) throw new Error('No active module in the seeded database');

  const pdf = await call(base, '/library', admin, { method: 'POST',
    body: { type: 'book', title: 'Reading gate test book', url: '/uploads/read-gate-test.pdf' } });
  const pdfItem = (pdf.data || {}).item;
  check('the admin can put a PDF book in the library', pdf.status === 200 && !!pdfItem,
    pdf.status + ' ' + JSON.stringify(pdf.data).slice(0, 160));
  if (!pdfItem) throw new Error('Could not create the test book file');

  const created = await call(base, '/books', admin, { method: 'POST',
    body: { moduleId: activeModule.id, title: 'Reading gate test', libraryId: pdfItem.id } });
  const book = (created.data || {}).book;
  check('a book can carry the PDF its chapters are read from', created.status === 200 && !!book,
    created.status + ' ' + JSON.stringify(created.data).slice(0, 160));
  if (!book) throw new Error('Could not create the test book');

  const chapter = await call(base, '/books/' + book.id + '/chapters', admin, { method: 'POST',
    body: { title: 'Chapter with pages', content: 'Read pages 3 to 6 of the book.',
      pageStart: 3, pageEnd: 6 } });
  const chapterId = (chapter.data || {}).chapter && chapter.data.chapter.id;
  check('a chapter can be limited to its own pages (3-6)', chapter.status === 200 && !!chapterId,
    JSON.stringify(chapter.data).slice(0, 160));
  if (!chapterId) throw new Error('Could not create the test chapter');

  const plain = await call(base, '/books/' + book.id + '/chapters', admin, { method: 'POST',
    body: { title: 'Chapter without pages', content: 'There is nothing paged to read here.' } });
  const plainId = (plain.data || {}).chapter && plain.data.chapter.id;
  check('a chapter without a page range can exist beside it', plain.status === 200 && !!plainId);
  if (!plainId) throw new Error('Could not create the second chapter');

  /* ------------------------------------------- 1. shut until last page ---- */
  let view = await call(base, '/book/' + book.id, student);
  check('the book opens for the learner with both chapters',
    view.status === 200 && ((view.data || {}).chapters || []).length === 2,
    view.status + ' ' + JSON.stringify((view.data || {}).chapters || []).slice(0, 200));
  const gated = chapterOf(view, chapterId);
  check('a chapter with pages says reading is required and not done yet',
    gated.requiresReading === true && gated.read === false, JSON.stringify(gated));
  check('the last page of the chapter is carried to the page view',
    Number(gated.pageEnd) === 6 && Number(gated.pageStart) === 3, JSON.stringify(gated));
  check('a chapter without pages needs no reading and is open',
    chapterOf(view, plainId).requiresReading === false && chapterOf(view, plainId).read === true,
    JSON.stringify(chapterOf(view, plainId)));

  const tooEarly = await call(base, '/submissions', student, { method: 'POST',
    body: { type: 'chapter_summary', chapterId, text: SUMMARY_TEXT } });
  check('answering before reaching the last page is refused',
    tooEarly.status === 403 && /last page/i.test(tooEarly.data.error || ''),
    tooEarly.status + ' ' + JSON.stringify(tooEarly.data).slice(0, 200));

  /* ------------------------------------------------ 2. turning the pages -- */
  const halfway = await call(base, '/chapter/' + chapterId + '/read', student, { method: 'POST',
    body: { page: 4 } });
  check('a page before the last one is only bookmarked',
    halfway.status === 200 && halfway.data.read === false && Number(halfway.data.lastPage) === 4,
    halfway.status + ' ' + JSON.stringify(halfway.data));

  view = await call(base, '/book/' + book.id, student);
  check('the bookmark does not open the answer area',
    chapterOf(view, chapterId).read === false && Number(chapterOf(view, chapterId).lastPage) === 4,
    JSON.stringify(chapterOf(view, chapterId)));

  const stillShut = await call(base, '/submissions', student, { method: 'POST',
    body: { type: 'chapter_summary', chapterId, text: SUMMARY_TEXT } });
  check('answering stays refused until the last page is reached', stillShut.status === 403,
    stillShut.status + ' ' + JSON.stringify(stillShut.data).slice(0, 160));

  const lastPage = await call(base, '/chapter/' + chapterId + '/read', student, { method: 'POST',
    body: { page: 6 } });
  check('reaching the last page marks the chapter as read',
    lastPage.status === 200 && lastPage.data.read === true && !!lastPage.data.readAt,
    lastPage.status + ' ' + JSON.stringify(lastPage.data));

  view = await call(base, '/book/' + book.id, student);
  check('the book now reports the chapter as read',
    chapterOf(view, chapterId).read === true && !!chapterOf(view, chapterId).readAt,
    JSON.stringify(chapterOf(view, chapterId)));

  const answer = await call(base, '/submissions', student, { method: 'POST',
    body: { type: 'chapter_summary', chapterId, text: SUMMARY_TEXT } });
  check('the answer is accepted once the chapter has been read',
    answer.status === 200 && !!answer.data.submission,
    answer.status + ' ' + JSON.stringify(answer.data).slice(0, 200));

  /* ----------------------------------- 3. going back does not re-lock it --- */
  const back = await call(base, '/chapter/' + chapterId + '/read', student, { method: 'POST',
    body: { page: 3 } });
  check('going back to an earlier page never takes the unlock away',
    back.status === 200 && back.data.read === true && Number(back.data.lastPage) === 6,
    back.status + ' ' + JSON.stringify(back.data));

  view = await call(base, '/book/' + book.id, student);
  check('the chapter keeps its pages after answering, so it can be read again',
    Number(chapterOf(view, chapterId).pageStart) === 3 && Number(chapterOf(view, chapterId).pageEnd) === 6 &&
      chapterOf(view, chapterId).read === true,
    JSON.stringify(chapterOf(view, chapterId)));

  const again = await call(base, '/auth/login', null, { method: 'POST',
    body: { slug: 'greenfield-academy', identifier: 'STU-001', password: 'Student@123' } });
  view = await call(base, '/book/' + book.id, again.data.token);
  check('a fresh login still sees the chapter as read (the mark is on the server)',
    chapterOf(view, chapterId).read === true, JSON.stringify(chapterOf(view, chapterId)));

  /* ------------------------------- 4. pages beyond the range are clamped --- */
  const overshoot = await call(base, '/chapter/' + chapterId + '/read', student, { method: 'POST',
    body: { page: 99 } });
  check('a page past the last page is clamped to the chapter',
    overshoot.status === 200 && Number(overshoot.data.lastPage) === 6 &&
      Number(overshoot.data.pageEnd) === 6, JSON.stringify(overshoot.data));

  /* ------------------------- 5. a chapter with no pages needs no reading --- */
  const plainAnswer = await call(base, '/submissions', student, { method: 'POST',
    body: { type: 'chapter_summary', chapterId: plainId, text: SUMMARY_TEXT } });
  check('a chapter with no pages of its own is answered without reading',
    plainAnswer.status === 200 && !!plainAnswer.data.submission,
    plainAnswer.status + ' ' + JSON.stringify(plainAnswer.data).slice(0, 200));

  /* ------------------------------------------------- 6. scope and access -- */
  const anonymous = await call(base, '/chapter/' + chapterId + '/read', null, { method: 'POST',
    body: { page: 6 } });
  check('reading cannot be reported without signing in', anonymous.status === 401,
    'status ' + anonymous.status);

  const otherAccount = await call(base, '/chapter/' + chapterId + '/read', stranger, { method: 'POST',
    body: { page: 6 } });
  check('another account cannot report reading of this chapter',
    otherAccount.status === 403, otherAccount.status + ' ' + JSON.stringify(otherAccount.data).slice(0, 160));

  const missing = await call(base, '/chapter/ch_does_not_exist/read', student, { method: 'POST',
    body: { page: 1 } });
  check('an unknown chapter is a 404', missing.status === 404, 'status ' + missing.status);

  /* ------------------------------------------------------- 7. clean up ---- */
  await call(base, '/books/' + book.id, admin, { method: 'DELETE' });
  await call(base, '/library/' + pdfItem.id, admin, { method: 'DELETE' });
  const gone = await call(base, '/book/' + book.id, student);
  check('the test book is removed again', gone.status === 404, 'status ' + gone.status);

  /* ------------------------------------- 8. the same rule for objectives --- */
  await objectivesGate();

  console.log('\n' + (failures ? failures + ' reading-gate check(s) failed' : 'Chapter reading gate checks passed'));
  if (failures) process.exitCode = 1;
}

main().catch(error => {
  console.error('FATAL ' + error.message);
  process.exitCode = 1;
}).finally(async () => {
  const stop = proc => new Promise(resolve => {
    if (!proc || proc.exitCode !== null) return resolve();
    const timer = setTimeout(resolve, 3000);
    proc.once('exit', () => { clearTimeout(timer); resolve(); });
    try { proc.kill('SIGKILL'); } catch (e) { clearTimeout(timer); resolve(); }
  });
  for (const proc of extraServers) await stop(proc);
  await stop(server);
  const rm = dir => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* later */ } };
  for (const dir of extraDirs) rm(dir);
  rm(TEMP_DIR);
});

