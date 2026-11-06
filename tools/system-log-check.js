/* The super admin's system log and the Trash.
   -----------------------------------------------------------------
     node tools/system-log-check.js            (own server, own throw-away database)
     node tools/system-log-check.js http://127.0.0.1:8080   (any running server)

   What it proves:
     - every change is written down: who, which role, which account, what item,
       and when - including sign-ins, sign-outs and failed sign-ins;
     - only the super admin can read the log or open the Trash;
     - a deletion keeps the record (and the chapters/questions under it) in the
       Trash instead of throwing it away;
     - Restore puts it back, and only "Delete for good" removes it.
   Without a URL it spawns its own server with a temporary database, so it never
   touches development or production data. With a URL it tidies up after itself
   (whatever it created is deleted and its Trash emptied). */
const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const baseArgument = process.argv[2] || '';
let TEMP_DIR = null;
let DB_FILE = null;
let server = null;
let failures = 0;
const stamp = Date.now().toString().slice(-6);

function check(name, condition, detail) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + name + (condition || !detail ? '' : ' [' + detail + ']'));
  if (!condition) failures++;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

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
  try { data = await response.json(); } catch (error) { /* a body may be empty */ }
  return { status: response.status, data };
}

async function waitForServer(base) {
  let lastError;
  for (let i = 0; i < 80; i++) {
    if (server && server.exitCode !== null) throw new Error('Test server exited before it was ready');
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await sleep(250);
  }
  throw lastError || new Error('Timed out waiting for the test server');
}

/* Its own database and its own port, so the checks can create and delete freely. */
async function startServer() {
  TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cbp-system-log-'));
  DB_FILE = path.join(TEMP_DIR, 'db.json');
  const seed = childProcess.spawnSync(process.execPath, [path.join(ROOT, 'server', 'seed.js')], {
    cwd: ROOT, env: Object.assign({}, process.env, { APP_DB_FILE: DB_FILE }), encoding: 'utf8'
  });
  if (seed.status !== 0) throw new Error(seed.stderr || 'Could not create the test database');
  const port = await findPort();
  const base = 'http://127.0.0.1:' + port;
  server = childProcess.spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port), APP_DB_FILE: DB_FILE }),
    stdio: 'ignore'
  });
  await waitForServer(base);
  return base;
}


/* --------------------------------------------------------------- helpers -- */
async function login(base, slug, identifier, password) {
  const response = await call(base, '/auth/login', null, {
    method: 'POST', body: { slug: slug, identifier: identifier, password: password }
  });
  return { token: response.data.token || null, user: response.data.user || null, status: response.status };
}
async function superLogin(base) {
  const response = await call(base, '/auth/super-login', null, {
    method: 'POST', body: { username: 'superadmin', password: 'SuperAdmin@123' }
  });
  return { token: response.data.token || null, user: response.data.user || null, status: response.status };
}
/* The newest log entry that matches - the screen sorts newest first, so the
   first match is the action that was just taken. */
async function logEntry(base, token, match) {
  const response = await call(base, '/super/log?limit=100', token);
  const entries = (response.data && response.data.entries) || [];
  return entries.find(match) || null;
}
async function trashEntry(base, token, match) {
  const response = await call(base, '/super/trash?limit=200', token);
  const items = (response.data && response.data.items) || [];
  return items.find(match) || null;
}

/* Both backends answer with the record either wrapped ({ book: {...} }) or flat
   ({ id: ..., title: ... }) — read it whichever way it comes. */
function recordOf(data, key) {
  if (!data) return null;
  if (data[key] && typeof data[key] === 'object') return data[key];
  return data.id ? data : null;
}

async function main() {
  const base = baseArgument ? baseArgument.replace(/\/+$/, '') : await startServer();
  const created = { library: [], books: [], users: [] };

  const health = await call(base, '/health');
  const features = (health.data && health.data.features) || [];
  check('this deployment reports the system log and the trash',
    features.indexOf('super.activity-log') !== -1 && features.indexOf('super.trash') !== -1,
    'build ' + (health.data && health.data.build) + ' features ' + JSON.stringify(features));

  const superAdmin = await superLogin(base);
  check('the super admin signs in', !!superAdmin.token && superAdmin.status === 200, 'status ' + superAdmin.status);
  const admin = await login(base, 'greenfield-academy', 'admin@greenfield.edu', 'Admin@123');
  check('an account admin signs in', !!admin.token, 'status ' + admin.status);
  const student = await login(base, 'greenfield-academy', 'STU-001', 'Student@123');
  check('a learner signs in', !!student.token, 'status ' + student.status);
  const superToken = superAdmin.token;

  /* ---------------------------------------------------- the log exists ---- */
  const log = await call(base, '/super/log?limit=50', superToken);
  check('the super admin can read the whole system log',
    log.status === 200 && Array.isArray(log.data.entries) && typeof log.data.total === 'number',
    'status ' + log.status + ' ' + JSON.stringify(log.data).slice(0, 160));
  const entries = (log.data && log.data.entries) || [];
  check('each entry says who did it and when',
    /* a failed sign-in has no person yet (that is the point of it) */
    entries.length > 0 && entries.every(e => !isNaN(Date.parse(e.at)) &&
      (e.action === 'sign-in-failed' || (!!e.userName && !!e.role))),
    JSON.stringify(entries.slice(0, 2)));
  const signIns = entries.filter(e => e.action === 'sign-in');
  check('sign-ins are recorded for every kind of user',
    signIns.some(e => e.role === 'super') && signIns.some(e => e.role === 'tenant_admin') &&
      signIns.some(e => e.role === 'student'),
    JSON.stringify(signIns.map(e => e.role)));
  const adminSignIn = signIns.find(e => e.role === 'tenant_admin');
  check('a sign-in also says which account it belongs to',
    !!adminSignIn && adminSignIn.tenantName === 'Greenfield Academy', JSON.stringify(adminSignIn));

  /* a failed sign-in is worth knowing about too */
  const bad = await login(base, 'greenfield-academy', 'STU-001', 'not-the-password');
  check('a wrong password is refused', bad.status === 401, 'status ' + bad.status);
  const failed = await logEntry(base, superToken, e => e.action === 'sign-in-failed');
  check('a failed sign-in is written to the log', !!failed, JSON.stringify(failed));
  const noSecrets = JSON.stringify(entries) + JSON.stringify(failed || {});
  check('the log never carries a password',
    noSecrets.indexOf('Admin@123') === -1 && noSecrets.indexOf('Student@123') === -1,
    'a password was found in an entry');

  /* ------------------------------------------------- create / update ----- */
  const title = 'Log check item ' + stamp;
  const made = await call(base, '/library', admin.token, {
    method: 'POST', body: { type: 'book', title: title, text: 'Written by the check.' }
  });
  const madeRecord = recordOf(made.data, 'item');
  const itemId = madeRecord && madeRecord.id;
  if (itemId) created.library.push(itemId);
  check('an account admin creates a library item', made.status === 200 && !!itemId,
    'status ' + made.status + ' ' + JSON.stringify(made.data).slice(0, 160));
  const createdEntry = await logEntry(base, superToken,
    e => e.action === 'created' && e.entity === 'library' && e.entityId === itemId);
  check('the creation is in the log with the person, the item and the account',
    !!createdEntry && createdEntry.label === title && createdEntry.userId === admin.user.id &&
      createdEntry.tenantName === 'Greenfield Academy',
    JSON.stringify(createdEntry));

  const edit = await call(base, '/library/' + encodeURIComponent(itemId), admin.token, {
    method: 'PUT', body: { title: title + ' (edited)' }
  });
  check('the item can be edited', edit.status === 200, 'status ' + edit.status);
  const editEntry = await logEntry(base, superToken,
    e => e.action === 'updated' && e.entity === 'library' && e.entityId === itemId);
  check('the edit is in the log, saying which fields changed',
    !!editEntry && String(editEntry.detail).indexOf('title') !== -1, JSON.stringify(editEntry));

  /* ---------------------------------------------- delete -> the trash ---- */
  const removed = await call(base, '/library/' + encodeURIComponent(itemId), admin.token, { method: 'DELETE' });
  check('the item is deleted', removed.status === 200 && !!removed.data.deleted &&
    !!removed.data.deleted.trashId, JSON.stringify(removed.data).slice(0, 160));
  const walk = await call(base, '/library', admin.token);
  check('a deleted item leaves the list', !((walk.data.library || []).some(x => x.id === itemId)));
  const trashed = await trashEntry(base, superToken, t => t.entityId === itemId);
  check('the deleted item is waiting in the Trash, with who deleted it and when',
    !!trashed && trashed.entity === 'library' && trashed.byName === 'Greenfield Admin' &&
      !isNaN(Date.parse(trashed.at)),
    JSON.stringify(trashed));
  const deletedEntry = await logEntry(base, superToken,
    e => e.action === 'deleted' && e.entityId === itemId);
  check('the deletion itself is in the log, with the name of what went',
    !!deletedEntry && deletedEntry.label === title + ' (edited)', JSON.stringify(deletedEntry));
  const trashId = (removed.data.deleted && removed.data.deleted.trashId) || (trashed && trashed.id);

  const restored = await call(base, '/super/trash/' + encodeURIComponent(trashId) + '/restore', superToken,
    { method: 'POST', body: {} });
  check('the super admin puts it back', restored.status === 200 && restored.data.restored >= 1,
    'status ' + restored.status + ' ' + JSON.stringify(restored.data).slice(0, 160));
  const back = await call(base, '/library', admin.token);
  check('the item is live again, unchanged',
    (back.data.library || []).some(x => x.id === itemId && x.title === title + ' (edited)'),
    JSON.stringify(back.data).slice(0, 200));
  const restoredTrash = await trashEntry(base, superToken, t => t.entityId === itemId);
  check('the Trash marks it as put back', !!restoredTrash && !!restoredTrash.restoredAt,
    JSON.stringify(restoredTrash));
  const twice = await call(base, '/super/trash/' + encodeURIComponent(trashId) + '/restore', superToken,
    { method: 'POST', body: {} });
  check('the same item cannot be put back twice', twice.status === 409,
    'status ' + twice.status + ' ' + JSON.stringify(twice.data).slice(0, 160));

  /* -------------------------------------- delete for good (permanently) -- */
  const again = await call(base, '/library/' + encodeURIComponent(itemId), admin.token, { method: 'DELETE' });
  const againId = again.data.deleted && again.data.deleted.trashId;
  check('the item is deleted a second time', again.status === 200 && !!againId, JSON.stringify(again.data).slice(0, 120));
  const purged = await call(base, '/super/trash/' + encodeURIComponent(againId), superToken, { method: 'DELETE' });
  check('the super admin deletes it for good', purged.status === 200, 'status ' + purged.status);
  const gone = await trashEntry(base, superToken, t => t.id === againId);
  check('nothing is left in the Trash afterwards', !gone, JSON.stringify(gone));
  const purgeEntry = await logEntry(base, superToken, e => e.action === 'purged' && e.entityId === itemId);
  check('deleting for good is in the log too', !!purgeEntry, JSON.stringify(purgeEntry));
  const missing = await call(base, '/super/trash/trs_doesnotexist/restore', superToken, { method: 'POST', body: {} });
  check('an unknown Trash entry cannot be restored', missing.status === 404, 'status ' + missing.status);

  /* --------------------------- a book takes its chapters and questions --- */
  const modules = await call(base, '/super/modules', superToken);
  const moduleId = ((modules.data.modules || [])[0] || {}).id;
  check('the super admin can list the modules', !!moduleId, JSON.stringify(modules.data).slice(0, 160));
  const book = await call(base, '/books', admin.token, {
    method: 'POST', body: { title: 'Log check book ' + stamp, moduleId: moduleId }
  });
  const bookRecord = recordOf(book.data, 'book');
  const bookId = bookRecord && bookRecord.id;
  if (bookId) created.books.push(bookId);
  const chapter = await call(base, '/books/' + encodeURIComponent(bookId) + '/chapters', admin.token, {
    method: 'POST', body: { title: 'Chapter one' }
  });
  const chapterRecord = recordOf(chapter.data, 'chapter');
  const chapterId = chapterRecord && chapterRecord.id;
  const question = await call(base, '/chapters/' + encodeURIComponent(chapterId) + '/objectives', admin.token, {
    method: 'POST', body: { question: 'What is character?', options: ['Who you are', 'What you own'], answerIndex: 0 }
  });
  check('a book, its chapter and a question can be written', !!bookId && !!chapterId && question.status === 200,
    'book ' + bookId + ' chapter ' + chapterId + ' question ' + question.status);

  const bookGone = await call(base, '/books/' + encodeURIComponent(bookId), admin.token, { method: 'DELETE' });
  const bookTrashId = bookGone.data.deleted && bookGone.data.deleted.trashId;
  const bookTrash = await trashEntry(base, superToken, t => t.id === bookTrashId);
  check('a deleted book keeps its chapters and questions in the Trash',
    !!bookTrash && bookTrash.size >= 3, JSON.stringify(bookTrash));
  const bookBack = await call(base, '/super/trash/' + encodeURIComponent(bookTrashId) + '/restore', superToken,
    { method: 'POST', body: {} });
  check('one Restore brings the whole book back', bookBack.status === 200 && bookBack.data.restored >= 3,
    'status ' + bookBack.status + ' ' + JSON.stringify(bookBack.data).slice(0, 160));
  const shelf = await call(base, '/books?moduleId=' + encodeURIComponent(moduleId), admin.token);
  const revived = (shelf.data.books || []).find(b => b.id === bookId);
  const revivedChapter = revived && (revived.chapters || []).find(c => c.id === chapterId);
  check('the book, its chapter and its question are on the shelf again',
    !!revivedChapter && (revivedChapter.objectives || []).length === 1,
    JSON.stringify(revived ? { chapters: (revived.chapters || []).length } : shelf.data).slice(0, 200));

  /* ---------------------------------------- a deleted person comes back -- */
  const learner = await call(base, '/users', admin.token, {
    method: 'POST',
    body: { role: 'student', fullName: 'Log Check Learner ' + stamp,
      studentNumber: 'LC-' + stamp, password: 'Learner@123' }
  });
  const learnerRecord = recordOf(learner.data, 'user');
  const learnerId = learnerRecord && learnerRecord.id;
  if (learnerId) created.users.push(learnerId);
  check('the admin adds a learner', learner.status === 200 && !!learnerId,
    'status ' + learner.status + ' ' + JSON.stringify(learner.data).slice(0, 160));
  const learnerIn = await login(base, 'greenfield-academy', 'LC-' + stamp, 'Learner@123');
  check('the new learner can sign in', !!learnerIn.token, 'status ' + learnerIn.status);
  const learnerGone = await call(base, '/users/' + encodeURIComponent(learnerId), admin.token, { method: 'DELETE' });
  check('the learner is deleted', learnerGone.status === 200, 'status ' + learnerGone.status);
  const learnerOut = await login(base, 'greenfield-academy', 'LC-' + stamp, 'Learner@123');
  check('a deleted learner can no longer sign in', learnerOut.status === 401, 'status ' + learnerOut.status);
  const learnerTrashId = learnerGone.data.deleted && learnerGone.data.deleted.trashId;
  const learnerBack = await call(base, '/super/trash/' + encodeURIComponent(learnerTrashId) + '/restore',
    superToken, { method: 'POST', body: {} });
  check('the super admin restores the deleted learner', learnerBack.status === 200,
    'status ' + learnerBack.status + ' ' + JSON.stringify(learnerBack.data).slice(0, 160));
  const learnerInAgain = await login(base, 'greenfield-academy', 'LC-' + stamp, 'Learner@123');
  check('the restored learner signs in with the same password', !!learnerInAgain.token,
    'status ' + learnerInAgain.status);

  /* -------------------------------------------------------- who may look -- */
  const adminLog = await call(base, '/super/log', admin.token);
  check('an account admin cannot read the whole system log', adminLog.status === 403,
    'status ' + adminLog.status);
  const adminTrash = await call(base, '/super/trash', admin.token);
  check('an account admin cannot open the Trash', adminTrash.status === 403, 'status ' + adminTrash.status);
  const adminRestore = await call(base, '/super/trash/' + encodeURIComponent(learnerTrashId) + '/restore',
    admin.token, { method: 'POST', body: {} });
  check('an account admin cannot restore what the super admin deleted', adminRestore.status === 403,
    'status ' + adminRestore.status);
  const studentLog = await call(base, '/super/log', student.token);
  check('a learner cannot read the system log', studentLog.status === 403, 'status ' + studentLog.status);
  const anon = await call(base, '/super/log');
  check('a signed-out visitor is refused', anon.status === 401, 'status ' + anon.status);

  /* ------------------------------------------------------------ filters -- */
  const onlyDeleted = await call(base, '/super/log?action=deleted&limit=20', superToken);
  check('the log can be filtered by action',
    onlyDeleted.status === 200 && (onlyDeleted.data.entries || []).length > 0 &&
      onlyDeleted.data.entries.every(e => e.action === 'deleted'),
    JSON.stringify((onlyDeleted.data.entries || []).slice(0, 1)));
  const byRole = await call(base, '/super/log?role=student&limit=50', superToken);
  check('the log can be filtered by role',
    byRole.status === 200 && (byRole.data.entries || []).length > 0 &&
      byRole.data.entries.every(e => e.role === 'student'),
    JSON.stringify((byRole.data.entries || []).slice(0, 1)));
  const noMatch = await call(base, '/super/log?q=zzz-nothing-matches-this', superToken);
  check('a search that matches nothing shows nothing',
    noMatch.status === 200 && noMatch.data.total === 0, JSON.stringify(noMatch.data).slice(0, 120));
  const today = new Date().toISOString().slice(0, 10);
  const byDay = await call(base, '/super/log?from=' + today + '&to=' + today, superToken);
  check('the log can be narrowed to a day', byDay.status === 200 && byDay.data.total > 0,
    JSON.stringify(byDay.data).slice(0, 120));
  const counts = await call(base, '/super/log?limit=1', superToken);
  check('the log reports how much is behind it', counts.status === 200 &&
    typeof counts.data.total === 'number' && counts.data.counts && counts.data.counts['sign-in'] >= 1,
    JSON.stringify(counts.data.counts));

  /* ------------------------------------------------------------ tidy up -- */
  /* Whatever this run created is deleted again, and its Trash emptied, so a
     check against a live server leaves nothing behind. */
  for (const id of created.library) await call(base, '/library/' + encodeURIComponent(id), admin.token, { method: 'DELETE' });
  for (const id of created.books) await call(base, '/books/' + encodeURIComponent(id), admin.token, { method: 'DELETE' });
  for (const id of created.users) {
    await call(base, '/users/' + encodeURIComponent(id), admin.token, { method: 'DELETE' });
  }
  const empty = await call(base, '/super/trash', superToken, { method: 'DELETE' });
  check('the super admin can empty the Trash in one go', empty.status === 200,
    'status ' + empty.status + ' ' + JSON.stringify(empty.data).slice(0, 120));
  const emptyAgain = await call(base, '/super/trash', superToken);
  check('the Trash is empty afterwards', emptyAgain.status === 200 && emptyAgain.data.total === 0,
    JSON.stringify(emptyAgain.data).slice(0, 120));
}

main().then(function () {
  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'all checks passed'));
  if (server) server.kill();
  if (TEMP_DIR) { try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch (error) {} }
  /* exitCode (not exit) so every line above reaches a redirected file */
  process.exitCode = failures ? 1 : 0;
}).catch(function (error) {
  console.log('FATAL ' + (error && error.message));
  if (server) server.kill();
  if (TEMP_DIR) { try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch (e) {} }
  process.exitCode = 1;
});
