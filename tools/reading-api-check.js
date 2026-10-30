/* Reading ribbon, book-open analytics and chapter video alerts — one check that
   runs the real server against a throw-away database.

   Usage: node tools/reading-api-check.js
   (The server is started on a free port; the seeded demo data is untouched.) */
const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cbp-reading-check-'));
const DB_FILE = path.join(TEMP_DIR, 'db.json');
let server;
let failures = 0;

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
  try { data = await response.json(); } catch (error) { /* Response may be empty. */ }
  return { status: response.status, data };
}

async function login(base, slug, identifier, password) {
  const response = await call(base, '/auth/login', null, {
    method: 'POST', body: { slug, identifier, password }
  });
  return response.data.token || null;
}

async function waitForServer(base) {
  let lastError;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error('Test server exited before readiness');
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw lastError || new Error('Timed out waiting for the test server');
}

function prepareDatabase() {
  const env = Object.assign({}, process.env, { APP_DB_FILE: DB_FILE });
  const seed = childProcess.spawnSync(process.execPath, [path.join(ROOT, 'server', 'seed.js')], {
    cwd: ROOT, env, encoding: 'utf8'
  });
  if (seed.status !== 0) throw new Error(seed.stderr || 'Could not create isolated test database');
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

const CHAPTER_TEXT = 'This chapter showed me that character grows through small honest choices ' +
  'made daily, especially when nobody is watching and no reward is offered.';
const UNCOMMON_TEXT = 'Quiet persistence turns ordinary practice into reliable habits, ' +
  'and honest reflection keeps those habits from drifting into comfortable excuses.';

async function main() {
  const seedData = prepareDatabase();
  check('the demo database starts with a reading history', (seedData.book_opens || []).length > 0);

  const port = await findPort();
  const base = 'http://127.0.0.1:' + port;
  server = childProcess.spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port), APP_DB_FILE: DB_FILE }),
    stdio: 'ignore'
  });
  await waitForServer(base);

  const admin = await login(base, 'greenfield-academy', 'admin@greenfield.edu', 'Admin@123');
  const student = await login(base, 'greenfield-academy', 'STU-001', 'Student@123');
  const otherStudent = await login(base, 'greenfield-academy', 'STU-002', 'Student@123');
  const horizonAdmin = await login(base, 'horizon-alliance', 'admin@horizon.org', 'Admin@123');
  const horizonSupervisor = await login(base, 'horizon-alliance', 'supervisor@horizon.org', 'Super@123');
  check('account admin, two learners and a second account can sign in',
    !!admin && !!student && !!otherStudent && !!horizonAdmin && !!horizonSupervisor);
  if (!admin || !student || !otherStudent || !horizonAdmin) throw new Error('Missing seeded accounts');

  /* ------------------------------------------------ 1. the students ribbon */
  const ribbon = await call(base, '/reports/top-performers?limit=50', admin);
  const performers = (ribbon.data && ribbon.data.performers) || [];
  check('the students page gets a best-performer ribbon', ribbon.status === 200 && performers.length > 0,
    'status ' + ribbon.status);
  check('every ribbon entry carries a name, marks, coverage and a rank',
    performers.every(p => p.name && (p.marks === null || typeof p.marks === 'number') &&
      typeof p.coverage === 'number' && p.rank >= 1));
  /* a learner whose written work carries no score yet is still ranked on coverage */
  check('a learner with coverage but no scored work is still on the belt',
    performers.every(p => p.marks != null || p.coverage > 0 || p.submissions > 0 || p.work > 0));
  check('the ribbon is ranked by marks and coverage, best first',
    performers.every((p, i) => i === 0 || performers[i - 1].score >= p.score));
  const capped = await call(base, '/reports/top-performers?limit=500', admin);
  check('the ribbon never returns more than 50 learners',
    ((capped.data || {}).performers || []).length <= 50);
  const horizonRibbon = await call(base, '/reports/top-performers?limit=50', horizonAdmin);
  const greenIds = new Set(performers.map(p => p.id));
  check('the ribbon only shows learners of the same account',
    ((horizonRibbon.data || {}).performers || []).every(p => !greenIds.has(p.id)));
  const supervised = await call(base, '/reports/top-performers', horizonSupervisor);
  const olive = seedData.users.find(u => u.email === 'olive@horizon.org');
  check('a supervisor only sees the learners they look after',
    ((supervised.data || {}).performers || []).every(p => p.id === olive.id));
  const learnerRibbon = await call(base, '/reports/top-performers', student);
  const learnerIds = ((learnerRibbon.data || {}).performers || []).map(p => p.id);
  /* the learner's own dashboard shows the same belt, so a learner reads their
     own account — and only their own account */
  check('a learner reads the belt of their own account',
    learnerRibbon.status === 200 && learnerIds.length > 0 &&
      learnerIds.every(id => greenIds.has(id)),
    'status ' + learnerRibbon.status);
  const anonymous = await call(base, '/reports/top-performers', null);
  check('the ribbon is never readable without signing in', anonymous.status === 401,
    'status ' + anonymous.status);

  /* ------------------------------------------------------ 2. book opens */
  const gamma = seedData.books.filter(b => b.moduleId === 'mod_gamma').sort((a, b) => a.order - b.order);
  const firstBook = gamma[0];
  /* the demo history already contains opens, so the counts build on it */
  const me = await call(base, '/me', student);
  const mySeedOpens = (seedData.book_opens || []).filter(o =>
    o.userId === me.data.user.id && o.bookId === firstBook.id).length;
  const bookSeedOpens = (seedData.book_opens || []).filter(o => o.bookId === firstBook.id).length;
  const opens = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    opens.push(await call(base, '/reading/open', student, { method: 'POST', body: { bookId: firstBook.id } }));
  }
  check('a book open is counted every single time',
    opens[0].data.timesOpened === mySeedOpens + 1 &&
      opens[1].data.timesOpened === mySeedOpens + 2 &&
      opens[2].data.timesOpened === mySeedOpens + 3,
    JSON.stringify(opens.map(o => o.data.timesOpened)) + ' from ' + mySeedOpens);
  const libraryBook = seedData.library.find(l => l.type === 'book');
  const libraryOpen = await call(base, '/reading/open', student,
    { method: 'POST', body: { libraryId: libraryBook.id } });
  check('a book opened from the library is counted', libraryOpen.status === 200 &&
    libraryOpen.data.key === 'library:' + libraryBook.id, JSON.stringify(libraryOpen.data));
  const letter = seedData.library.find(l => l.type === 'letter');
  const letterOpen = await call(base, '/reading/open', student,
    { method: 'POST', body: { libraryId: letter.id } });
  check('only books are counted, not letters', letterOpen.status === 400, 'status ' + letterOpen.status);
  const unknown = await call(base, '/reading/open', student,
    { method: 'POST', body: { bookId: 'book_missing' } });
  check('an unknown book cannot be counted', unknown.status === 404, 'status ' + unknown.status);

  /* --------------------------------------------- 3. reading analytics */
  const analytics = await call(base, '/admin/analytics', admin);
  const reading = (analytics.data || {}).reading || {};
  const totals = reading.totals || {};
  const bookRows = reading.books || [];
  check('the analytics page carries a reading activity block',
    analytics.status === 200 && !!reading.totals, 'status ' + analytics.status);
  const bookRow = bookRows.find(b => b.key === 'book:' + firstBook.id);
  check('it shows how many times a book was opened', !!bookRow && bookRow.opens === bookSeedOpens + 3,
    bookRow ? String(bookRow.opens) + ' vs ' + (bookSeedOpens + 3) : 'missing');
  check('it shows how many books were opened at least once',
    totals.booksOpened === bookRows.length && totals.booksOpened <= totals.opens,
    'booksOpened ' + totals.booksOpened + ' of ' + bookRows.length);
  check('it shows which book is liked most and how often',
    !!reading.mostLiked && bookRows.length > 0 &&
      reading.mostLiked.opens === Math.max.apply(null, bookRows.map(b => b.opens)));
  const myRow = (reading.readers || []).find(r => r.userId === me.data.user.id);
  const myBook = myRow ? (myRow.books || []).find(b => b.key === 'book:' + firstBook.id) : null;
  check('it shows how often one learner opened one book',
    !!myBook && myBook.opens === mySeedOpens + 3, JSON.stringify(myBook));
  const horizonAnalytics = await call(base, '/admin/analytics', horizonAdmin);
  const oliveOpens = (seedData.book_opens || []).filter(o =>
    o.userId === olive.id && o.bookId === firstBook.id).length;
  const horizonRow = (((horizonAnalytics.data || {}).reading || {}).books || [])
    .find(b => b.key === 'book:' + firstBook.id);
  check('reading statistics never cross accounts',
    (horizonRow ? horizonRow.opens : 0) === oliveOpens,
    (horizonRow ? horizonRow.opens : 0) + ' vs ' + oliveOpens);
  /* a module filter must narrow the card to that module's own books: a book kept
     in the library belongs to no module, so it drops out even though it was just
     opened (it was, a few lines up) */
  const gammaAnalytics = await call(base, '/admin/analytics?moduleId=mod_gamma', admin);
  const gammaReading = (gammaAnalytics.data || {}).reading || {};
  const gammaBooks = gammaReading.books || [];
  const gammaKeys = new Set(gamma.map(b => 'book:' + b.id));
  check('a module filter keeps only the books of that module',
    gammaBooks.length > 0 && gammaBooks.every(b => gammaKeys.has(b.key)),
    JSON.stringify(gammaBooks.map(b => b.key)));
  check('a library book drops out of a module-filtered reading card',
    !gammaBooks.some(b => String(b.key).indexOf('library:') === 0),
    JSON.stringify(gammaBooks.map(b => b.key)));
  check('the module-filtered reading totals still add up',
    ((gammaReading.totals || {}).opens || 0) ===
      gammaBooks.reduce((n, b) => n + b.opens, 0),
    ((gammaReading.totals || {}).opens || 0) + ' vs ' +
      gammaBooks.reduce((n, b) => n + b.opens, 0));

  /* --------------------------------------- 4. chapter video alerts */
  const flow = await call(base, '/flow', student);
  if (flow.data.showLetter) {
    await call(base, '/flow/letter-feedback', student,
      { method: 'POST', body: { feedback: 'I will build my character with patience and honesty.' } });
  }
  const chapterIds = seedData.chapters
    .filter(c => c.bookId === firstBook.id).sort((a, b) => a.order - b.order).map(c => c.id);
  const submit = chapterId => call(base, '/submissions', student,
    { method: 'POST', body: { type: 'chapter_summary', chapterId, text: CHAPTER_TEXT } });
  const one = await submit(chapterIds[0]);
  const two = await submit(chapterIds[1]);
  const three = await submit(chapterIds[2]);
  check('the first two chapters unlock no video',
    one.status === 200 && two.status === 200 && !one.data.videoAlert && !two.data.videoAlert,
    one.status + '/' + two.status + ' ' + JSON.stringify(two.data));
  const firstAlert = three.data.videoAlert;
  check('finishing three chapters sends a video alert',
    !!firstAlert && !!firstAlert.libraryId && !!firstAlert.videoUrl &&
      firstAlert.chaptersCompleted === 3, JSON.stringify(three.data));
  const videos = seedData.library.filter(l => l.type === 'video' && l.url).map(v => v.id);
  check('the alert links a real library video',
    !!firstAlert && videos.indexOf(firstAlert.libraryId) !== -1);
  const inbox = await call(base, '/notifications', student);
  const alerts = ((inbox.data || {}).notifications || []).filter(n => n.type === 'video_alert');
  check('the alert arrives in the messages, ready to play',
    alerts.length === 1 && alerts[0].libraryId === firstAlert.libraryId && !!alerts[0].videoUrl,
    JSON.stringify(alerts.map(a => a.libraryId)));

  /* the same chapter cannot be submitted again, so no duplicate alert appears */
  const repeat = await submit(chapterIds[2]);
  const afterRepeat = await call(base, '/notifications', student);
  check('re-submitting a chapter never repeats the alert',
    repeat.status === 400 &&
      ((afterRepeat.data || {}).notifications || []).filter(n => n.type === 'video_alert').length === 1,
    'status ' + repeat.status);

  /* book 1 is closed with its letter before book 2 opens */
  await call(base, '/submissions', student,
    { method: 'POST', body: { type: 'letter_summary', bookId: firstBook.id, text: CHAPTER_TEXT } });
  const nextBookChapters = seedData.chapters
    .filter(c => c.bookId === gamma[1].id).sort((a, b) => a.order - b.order).map(c => c.id);
  for (const chapterId of nextBookChapters.slice(0, 2)) {
    await submit(chapterId);
  }
  const sixth = await submit(nextBookChapters[2]);
  const secondAlert = sixth.data.videoAlert;
  check('a second milestone unlocks a second video', !!secondAlert && !!secondAlert.libraryId,
    JSON.stringify(sixth.data));
  check('a video already sent to a learner is never sent to them again',
    !!secondAlert && secondAlert.libraryId !== firstAlert.libraryId,
    firstAlert.libraryId + ' / ' + (secondAlert && secondAlert.libraryId));
  const finalInbox = await call(base, '/notifications', student);
  const finalAlerts = ((finalInbox.data || {}).notifications || []).filter(n => n.type === 'video_alert');
  check('two milestones leave exactly two alerts, each a different video',
    finalAlerts.length === 2 && new Set(finalAlerts.map(a => a.libraryId)).size === 2,
    JSON.stringify(finalAlerts.map(a => a.libraryId)));

  /* another learner has their own alerts: nothing was used up for them */
  const otherInbox = await call(base, '/notifications', otherStudent);
  check('video alerts are kept for one learner only',
    ((otherInbox.data || {}).notifications || []).filter(n => n.type === 'video_alert').length === 0);

  /* ------------- 6. work that carries no score must still be ranked ------ */
  /* The live account looked empty for exactly this reason: its chapters carried
     no key words, so every typed answer scored nothing (marks = null) even
     though the learners had done the work. Such a learner must still hold a
     place on the belt and on the account's own login page. */
  const plainBook = await call(base, '/books', admin,
    { method: 'POST', body: { title: 'A book whose chapters carry no key words', moduleId: 'mod_gamma' } });
  const plainChapter = await call(base, '/books/' + (plainBook.data.book || {}).id + '/chapters', admin,
    { method: 'POST', body: { title: 'Chapter one', content: '', keywords: [] } });
  check('an admin can add a chapter that carries no key words',
    plainBook.status === 200 && plainChapter.status === 200,
    plainBook.status + '/' + plainChapter.status);
  const unscored = await call(base, '/submissions', otherStudent,
    { method: 'POST', body: { type: 'chapter_summary',
      chapterId: (plainChapter.data.chapter || {}).id, text: UNCOMMON_TEXT } });
  check('an answer to a chapter with no key words is accepted but scores nothing',
    unscored.status === 200 && !unscored.data.assessment && !unscored.data.warning,
    unscored.status + ' ' + JSON.stringify(unscored.data));
  const beltAfter = await call(base, '/reports/top-performers?limit=50', admin);
  const otherMe = await call(base, '/me', otherStudent);
  const workerName = otherMe.data.user.fullName;
  const worker = ((beltAfter.data || {}).performers || []).find(p => p.name === workerName);
  check('a learner whose answers carry no score still holds a place on the belt',
    !!worker && worker.marks === null && worker.submissions === 0 && worker.work >= 1,
    JSON.stringify(worker));
  const loginAfter = await call(base, '/public/top-performers?slug=greenfield-academy');
  const loginWorker = ((loginAfter.data || {}).performers || []).find(p => p.name === workerName);
  check('the account login page lists a learner whose work is not scored yet',
    !!loginWorker && loginWorker.marks === null && typeof loginWorker.coverage === 'number',
    JSON.stringify(loginWorker));
  check('unscored learners are ranked on their coverage alone',
    !!loginWorker && loginWorker.score === loginWorker.coverage,
    JSON.stringify(loginWorker));

  console.log('\n' + (failures ? failures + ' reading check(s) failed' : 'Reading checks passed'));
  if (failures) process.exitCode = 1;
}

main().catch(error => {
  console.error('FATAL ' + error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (server && server.exitCode === null) {
    await new Promise(resolve => {
      server.once('exit', resolve);
      server.kill();
    });
  }
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});


