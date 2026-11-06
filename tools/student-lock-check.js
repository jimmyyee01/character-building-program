/* A STUDENT's sign-in must not outlive the app window. The learner app beats
   every few seconds; a session that goes quiet is destroyed, while staff
   sessions keep working exactly as before.

     node tools/student-lock-check.js

   Runs against its own throw-away database and its own port, so it never
   touches the development or production data. The idle limit is shortened to
   three seconds through STUDENT_IDLE_MS so the check stays quick. */
const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cbp-student-lock-'));
const DB_FILE = path.join(TEMP_DIR, 'db.json');
const IDLE_MS = 3000;
let server;
let failures = 0;

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
  if (options.cookie) headers.Cookie = options.cookie;
  const response = await fetch(base + '/api' + endpoint, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  let data = {};
  try { data = await response.json(); } catch (error) { /* Response may be empty. */ }
  return { status: response.status, data, cookie: response.headers.get('set-cookie') || '' };
}

async function login(base, slug, identifier, password) {
  const response = await call(base, '/auth/login', null, {
    method: 'POST', body: { slug, identifier, password }
  });
  return { token: response.data.token || null, cookie: response.cookie };
}

function prepareDatabase() {
  const seed = childProcess.spawnSync(process.execPath, [path.join(ROOT, 'server', 'seed.js')], {
    cwd: ROOT, env: Object.assign({}, process.env, { APP_DB_FILE: DB_FILE }), encoding: 'utf8'
  });
  if (seed.status !== 0) throw new Error(seed.stderr || 'Could not create the test database');
}

async function waitForServer(base) {
  let lastError;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error('Test server exited before it was ready');
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await sleep(250);
  }
  throw lastError || new Error('Timed out waiting for the test server');
}


async function main() {
  prepareDatabase();
  const port = await findPort();
  const base = 'http://127.0.0.1:' + port;
  server = childProcess.spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env,
      { PORT: String(port), APP_DB_FILE: DB_FILE, STUDENT_IDLE_MS: String(IDLE_MS) }),
    stdio: 'ignore'
  });
  await waitForServer(base);

  const health = await call(base, '/health');
  check('the deployment reports the student leave lock',
    health.data.ok && (health.data.features || []).indexOf('auth.student-leave-lock') !== -1,
    JSON.stringify(health.data.features || []).slice(0, 200));

  const student = await login(base, 'greenfield-academy', 'STU-001', 'Student@123');
  const staff = await login(base, 'horizon-alliance', 'supervisor@horizon.org', 'Super@123');
  check('the learner and the supervisor can sign in', !!student.token && !!staff.token);

  /* the beat the learner page sends every few seconds */
  const beat = await call(base, '/auth/beat', student.token, { method: 'POST', body: {} });
  check('a student beat is accepted and reports the lock',
    beat.status === 200 && beat.data.ok === true && beat.data.leaveLocked === true,
    'status ' + beat.status + ' ' + JSON.stringify(beat.data).slice(0, 140));
  const staffBeat = await call(base, '/auth/beat', staff.token, { method: 'POST', body: {} });
  check('a staff beat is accepted and reports no lock',
    staffBeat.status === 200 && staffBeat.data.leaveLocked === false,
    'status ' + staffBeat.status + ' ' + JSON.stringify(staffBeat.data).slice(0, 140));
  const anon = await call(base, '/auth/beat', null, { method: 'POST', body: {} });
  check('an anonymous beat is refused', anon.status === 401, 'status ' + anon.status);

  /* every learner request counts as "still here" */
  await sleep(Math.round(IDLE_MS * 0.6));
  const firstTouch = await call(base, '/me', student.token);
  await sleep(Math.round(IDLE_MS * 0.6));
  const secondTouch = await call(base, '/me', student.token);
  check('a learner who keeps working stays signed in',
    firstTouch.status === 200 && secondTouch.status === 200,
    'statuses ' + firstTouch.status + '/' + secondTouch.status);

  /* ...and a window that has gone quiet is not */
  await sleep(IDLE_MS + 800);
  const silent = await call(base, '/me', student.token);
  check('a silent learner session is over after the idle limit', silent.status === 401,
    'status ' + silent.status + ' ' + JSON.stringify(silent.data).slice(0, 140));
  const silentAgain = await call(base, '/videos', student.token);
  check('the same dead session cannot be used again', silentAgain.status === 401, 'status ' + silentAgain.status);
  const staffAfter = await call(base, '/me', staff.token);
  check('a staff session is untouched by the wait', staffAfter.status === 200, 'status ' + staffAfter.status);

  /* a beat every so often keeps the learner signed in past the limit */
  const busy = await login(base, 'greenfield-academy', 'STU-001', 'Student@123');
  let beatStatus = 200;
  for (let i = 0; i < 4; i++) {
    await sleep(Math.round(IDLE_MS * 0.5));
    beatStatus = (await call(base, '/auth/beat', busy.token, { method: 'POST', body: {} })).status;
    if (beatStatus !== 200) break;
  }
  const busyMe = await call(base, '/me', busy.token);
  check('beats keep a learner signed in beyond the idle limit',
    beatStatus === 200 && busyMe.status === 200, 'beat ' + beatStatus + ' me ' + busyMe.status);

  /* the goodbye a closing tab sends: cookie only, exactly like sendBeacon */
  const cookieOnly = String(busy.cookie || '').split(';')[0];
  const beacon = await call(base, '/auth/logout', null, { method: 'POST', cookie: cookieOnly, body: {} });
  check('the beacon goodbye (cookie only) is accepted', beacon.status === 200, 'status ' + beacon.status);
  const afterBeacon = await call(base, '/me', busy.token);
  check('the session is gone after the goodbye', afterBeacon.status === 401, 'status ' + afterBeacon.status);

  /* signing in again is all it takes to carry on */
  const again = await login(base, 'greenfield-academy', 'STU-001', 'Student@123');
  const againMe = await call(base, '/me', again.token);
  check('the learner can sign in again straight away',
    !!again.token && againMe.status === 200, 'status ' + againMe.status);
}

main().then(function () {
  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'all checks passed'));
  if (server) server.kill();
  try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch (error) {}
  process.exit(failures ? 1 : 0);
}).catch(function (error) {
  console.log('FATAL ' + (error && error.message));
  if (server) server.kill();
  try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch (e) {}
  process.exit(1);
});
