/* Live classes: start one, schedule one, and let it write down what is said.
   -----------------------------------------------------------------------
     node tools/live-class-check.js              (own server, own throw-away database)
     node tools/live-class-check.js http://127.0.0.1:8080   (any running server)

   What it proves:
     - only the super admin, an account admin or a supervisor may start a class,
       and each one reaches exactly the people they are responsible for;
     - starting a class sends the join link to those people through the alerts,
       and the link opens that class's room;
     - the room only opens for the host and the people invited to it;
     - what is said is captured as it is said (host only), read back in order by
       the room, and kept as a transcript after the class ends;
     - a scheduled class opens itself when its time comes, and alerts again;
     - the host ends (or cancels) a class, and nothing keeps running afterwards.
   Without a URL it spawns its own server with a temporary database, so it never
   touches development or production data. */
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

async function startServer() {
  TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cbp-live-classes-'));
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
async function alerts(base, token) {
  const response = await call(base, '/notifications', token);
  return (response.data && response.data.notifications) || [];
}
function liveAlert(list, code) {
  return (list || []).find(n => n.type === 'live_class' && String(n.liveCode || '') === String(code)) || null;
}
/* ------------------------------------------------------------- the checks -- */
(async function () {
  const base = (baseArgument || await startServer()).replace(/\/+$/, '');
  const sup = await superLogin(base);
  const admin = await login(base, 'greenfield-academy', 'admin@greenfield.edu', 'Admin@123');
  const student = await login(base, 'greenfield-academy', 'STU-001', 'Student@123');
  const otherAdmin = await login(base, 'horizon-alliance', 'admin@horizon.org', 'Admin@123');
  const otherStudent = await login(base, 'horizon-alliance', 'olive@horizon.org', 'Member@123');
  const supervisor = await login(base, 'horizon-alliance', 'supervisor@horizon.org', 'Super@123');
  check('sign in: super admin, account admin, learner, supervisor',
    !!sup.token && !!admin.token && !!student.token && !!otherAdmin.token && !!otherStudent.token && !!supervisor.token);

  const health = await call(base, '/health');
  const features = (health.data && health.data.features) || [];
  check('the running build carries the live-class features',
    features.indexOf('live.video-room') !== -1 && features.indexOf('live.captions') !== -1 &&
    features.indexOf('live.transcript') !== -1 && features.indexOf('live.scheduling') !== -1,
    'build ' + health.data.build);

  /* --------------------------------------------- who may start a class ----- */
  const anon = await call(base, '/live-lessons', null, { method: 'POST', body: { title: 'Nope' } });
  check('a signed-out visitor cannot start a class', anon.status === 401, anon.status);
  const byStudent = await call(base, '/live-lessons', student.token, { method: 'POST', body: { title: 'Nope' } });
  check('a learner cannot start a class', byStudent.status === 403, byStudent.status);
  const noTitle = await call(base, '/live-lessons', sup.token, { method: 'POST', body: {} });
  check('a class needs a title', noTitle.status === 400, noTitle.status + ' ' + noTitle.data.error);
  const badDate = await call(base, '/live-lessons', sup.token, {
    method: 'POST', body: { title: 'Bad date', scheduledAt: 'tomorrow-ish' } });
  check('a scheduled class needs a real date and time', badDate.status === 400);
  const badLink = await call(base, '/live-lessons', sup.token, {
    method: 'POST', body: { title: 'Bad link', joinUrl: 'zoom' } });
  check('a meeting link, when given, must be a web address', badLink.status === 400);

  /* ------------------------------------- the super admin, for everybody ---- */
  const started = await call(base, '/live-lessons', sup.token, {
    method: 'POST', body: { title: 'Whole system: live now' } });
  const lesson = (started.data && started.data.lesson) || {};
  check('the super admin starts a class on the spot', started.status === 200 && lesson.status === 'live',
    started.status + ' ' + (lesson.status || started.data.error));
  check('the class opens a room of its own',
    /^[A-Z0-9]{6}$/.test(String(lesson.code)) && lesson.roomPath === '/live?code=' + lesson.code,
    lesson.code + ' ' + lesson.roomPath);
  check('the room has a video address on the video server',
    /^https:\/\/[^/]+\/cbp-[a-f0-9]+$/.test(String(lesson.videoBase)), lesson.videoBase);
  check('the class reaches every user of the system', Number(started.data.invited) >= 5, started.data.invited);

  const studentAlerts = await alerts(base, student.token);
  const alert = liveAlert(studentAlerts, lesson.code);
  check('a learner receives the join link through their alerts',
    !!alert && /\/live\?code=/.test(alert.body), alert && alert.body);
  check('every account receives it, not only one school',
    !!liveAlert(await alerts(base, otherStudent.token), lesson.code));

  /* ------------------------------------------------------------ the room --- */
  const room = await call(base, '/live-class/' + lesson.code, student.token);
  check('the learner opens the class from that link',
    room.status === 200 && room.data.lesson && room.data.lesson.id === lesson.id, room.status);
  check('the room tells a learner they are not the host', room.data.me && room.data.me.host === false);
  const joined = await call(base, '/live-class/' + lesson.code + '/join', student.token, { method: 'POST', body: {} });
  check('joining puts the learner in the participant list',
    ((joined.data && joined.data.roster) || []).some(p => p.userId === student.user.id));
  const hosted = await call(base, '/live-class/' + lesson.code, sup.token);
  check('the host sees who is in the room',
    ((hosted.data && hosted.data.roster) || []).some(p => p.userId === student.user.id));
  check('the host opens the room as the host', hosted.data.me && hosted.data.me.host === true);
  const noAuthRoom = await call(base, '/live-class/' + lesson.code, null);
  check('the room needs a signed-in person', noAuthRoom.status === 401, noAuthRoom.status);

  /* --------------------------------- what is being said, as it is said ----- */
  const studentSpeaks = await call(base, '/live-class/' + lesson.code + '/captions', student.token,
    { method: 'POST', body: { text: 'not mine to say' } });
  check('only the host writes down what is being said', studentSpeaks.status === 403, studentSpeaks.status);
  const spoken = await call(base, '/live-class/' + lesson.code + '/captions', sup.token, {
    method: 'POST', body: { lines: [{ text: 'Good morning everyone.' },
      { text: 'Open your books at chapter two.' }] } });
  check('the host saves what is said',
    spoken.status === 200 && spoken.data.saved === 2 && spoken.data.seq === 2, JSON.stringify(spoken.data));
  await call(base, '/live-class/' + lesson.code + '/captions', sup.token,
    { method: 'POST', body: { text: 'Character is what you do when nobody is looking.' } });
  const heard = await call(base, '/live-class/' + lesson.code + '/captions?after=0', student.token);
  const heardLines = (heard.data && heard.data.lines) || [];
  check('the room reads the words in the order they were said',
    heardLines.length === 3 && heardLines[2].seq === 3 && /nobody is looking/.test(heardLines[2].text),
    JSON.stringify(heardLines.map(l => l.seq + ':' + l.text)));
  const onlyNew = await call(base, '/live-class/' + lesson.code + '/captions?after=1', student.token);
  check('a viewer only receives what it has not seen yet',
    ((onlyNew.data && onlyNew.data.lines) || []).length === 2 && onlyNew.data.lines[0].seq === 2);

  const transcript = await call(base, '/live-lessons/' + lesson.id + '/transcript', student.token);
  check('the transcript keeps everything that was said',
    transcript.status === 200 && /Good morning everyone/.test(transcript.data.text) &&
    /nobody is looking/.test(transcript.data.text) && Number(transcript.data.words) > 8,
    transcript.data.words + ' words');
  check('each transcript line carries a time and who said it',
    /^\[\d{2}:\d{2}:\d{2}\] .+: .+/.test(String(transcript.data.text).split('\n')[0]),
    String(transcript.data.text).split('\n')[0]);

  /* ------------------------------- an account admin, for their account ----- */
  const accountClass = await call(base, '/live-lessons', admin.token, {
    method: 'POST', body: { title: 'Greenfield lesson', joinUrl: 'https://meet.example.com/abc-defg-hij' } });
  const accountLesson = (accountClass.data && accountClass.data.lesson) || {};
  check('the account admin starts a lesson for their account',
    accountClass.status === 200 && accountLesson.status === 'live', accountClass.status);
  check('the account admin may still bring their own meeting link',
    accountLesson.joinUrl === 'https://meet.example.com/abc-defg-hij', accountLesson.joinUrl);
  check('the lesson reaches every learner in that account',
    !!liveAlert(await alerts(base, student.token), accountLesson.code));
  check('and nobody outside that account',
    !liveAlert(await alerts(base, otherStudent.token), accountLesson.code));
  const outsider = await call(base, '/live-class/' + accountLesson.code, otherStudent.token);
  check('another account cannot open the room', outsider.status === 403, outsider.status);
  const outsiderTranscript = await call(base, '/live-lessons/' + accountLesson.id + '/transcript', otherStudent.token);
  check('another account cannot read its transcript either', outsiderTranscript.status === 403);
  const unknown = await call(base, '/live-class/ZZZZZZ', student.token);
  check('a wrong code is simply not found', unknown.status === 404, unknown.status);

  /* ------------------------------------------ a supervisor, own learners --- */
  const supervised = await call(base, '/live-lessons', supervisor.token, {
    method: 'POST', body: { title: 'My learners only' } });
  const supervisedLesson = (supervised.data && supervised.data.lesson) || {};
  check('a supervisor starts a class for the learners they supervise',
    supervised.status === 200 && Number(supervised.data.invited) === 1, supervised.data.invited);
  check("only that supervisor's learners are told",
    !!liveAlert(await alerts(base, otherStudent.token), supervisedLesson.code) &&
    !liveAlert(await alerts(base, student.token), supervisedLesson.code));
  const notTheirStudent = await call(base, '/live-class/' + supervisedLesson.code, student.token);
  check("a learner outside the supervisor's group cannot join", notTheirStudent.status === 403, notTheirStudent.status);
  const adminEndsIt = await call(base, '/live-lessons/' + supervisedLesson.id + '/end', admin.token,
    { method: 'POST', body: {} });
  check('somebody who is not the host cannot end it', adminEndsIt.status === 403, adminEndsIt.status);

  /* ------------------------------------------- scheduling and cancelling --- */
  const later = new Date(Date.now() + 1500).toISOString();
  const due = await call(base, '/live-lessons', admin.token, {
    method: 'POST', body: { title: 'Opens by itself', scheduledAt: later } });
  const dueLesson = (due.data && due.data.lesson) || {};
  check('an admin schedules a lesson for later',
    due.status === 200 && dueLesson.status === 'scheduled', dueLesson.status);
  const scheduleAlert = liveAlert(await alerts(base, student.token), dueLesson.code);
  check('the alert says when the lesson is and where to go',
    !!scheduleAlert && /scheduled/i.test(scheduleAlert.title) && /\/live\?code=/.test(scheduleAlert.body),
    scheduleAlert && (scheduleAlert.title + ' | ' + scheduleAlert.body));
  await sleep(2200);
  const listed = await call(base, '/live-lessons', student.token);
  const opened = ((listed.data && listed.data.lessons) || []).find(l => l.id === dueLesson.id);
  check('a scheduled lesson opens itself when its time comes',
    !!opened && opened.status === 'live', opened && opened.status);
  const startAlert = liveAlert(await alerts(base, student.token), dueLesson.code);
  check('and it alerts again when it opens', !!startAlert && /starting/i.test(startAlert.title),
    startAlert && startAlert.title);

  const toCancel = await call(base, '/live-lessons', admin.token, {
    method: 'POST',
    body: { title: 'Cancel me', scheduledAt: new Date(Date.now() + 3600000).toISOString() } });
  const cancelled = await call(base, '/live-lessons/' + toCancel.data.lesson.id + '/cancel', admin.token,
    { method: 'POST', body: {} });
  check('a lesson that will not happen can be cancelled',
    cancelled.status === 200 && cancelled.data.lesson.status === 'cancelled',
    cancelled.data.lesson && cancelled.data.lesson.status);

  /* -------------------------------------------------------------- ending --- */
  const ended = await call(base, '/live-lessons/' + lesson.id + '/end', sup.token, { method: 'POST', body: {} });
  check('the host ends the class', ended.status === 200 && ended.data.lesson.status === 'ended');
  const afterEnd = await call(base, '/live-class/' + lesson.code + '/captions', sup.token,
    { method: 'POST', body: { text: 'too late' } });
  check('nothing is captured after the class has ended', afterEnd.status === 409, afterEnd.status);
  const kept = await call(base, '/live-lessons/' + lesson.id + '/transcript', student.token);
  check('the transcript is still there afterwards', ((kept.data && kept.data.lines) || []).length === 3);
  const endedRoom = await call(base, '/live-class/' + lesson.code, student.token);
  check('the room says the class is over', endedRoom.data.lesson && endedRoom.data.lesson.status === 'ended');

  /* ------------------------------------------------------- the system log -- */
  const log = await call(base, '/super/log?limit=200', sup.token);
  const entries = (log.data && log.data.entries) || [];
  check('the system log records the class being started',
    entries.some(e => e.entity === 'live-class' && e.action === 'started' && e.label === 'Whole system: live now'),
    entries.filter(e => e.entity === 'live-class').length + ' live-class entries');
  check('the system log records the class being ended',
    entries.some(e => e.entity === 'live-class' && e.action === 'ended' && e.label === 'Whole system: live now'));
  check('what was said is not poured into the system log',
    !entries.some(e => /nobody is looking|Good morning everyone/.test(
      String(e.label || '') + ' ' + String(e.detail || ''))));

  /* ------------------------------------------------------------- the page -- */
  const page = await fetch(base + '/live?code=' + lesson.code);
  const html = await page.text();
  check('the room page is served', page.status === 200 && /\/js\/live\.js/.test(html),
    page.status + ' ' + String(html).slice(0, 80));

  /* --------------------------------------- a room that says why it cannot --- */
  /* The video server answers "WebRTC is not available in your browser" whenever
     the browser refuses it a camera — a sentence that names the symptom and not
     the cure, and it appears on the most ordinary links there are: a plain http
     address, or a room opened inside WhatsApp. The room must therefore ask the
     browser what it can do first, and answer with the reason and the way out. */
  const roomJs = await (await fetch(base + '/js/live.js')).text();
  check('the room asks whether the address is secure before it shows the camera',
    /isSecureContext/.test(roomJs), 'no isSecureContext in live.js');
  check('the room asks whether the browser has WebRTC and a camera',
    /RTCPeerConnection/.test(roomJs) && /getUserMedia/.test(roomJs));
  check('a link opened inside an app is told to open in a real browser',
    /FBAN/.test(roomJs) && /Open in browser/.test(roomJs));
  check('a plain http room points at the secure address',
    /Open the secure address/.test(roomJs) && /'https:\/\/'/.test(roomJs));
  check('the room says the class still works as text without a camera',
    /captions and the transcript keep working/i.test(roomJs));
  check('a camera the browser has already refused is named, not suffered',
    /navigator\.permissions/.test(roomJs) && /blocked the camera for this address/.test(roomJs));
  const shaped = await call(base, '/live-class/' + lesson.code, sup.token);
  check('the room is told whether a secure address exists',
    !!(shaped.data && shaped.data.lesson) && typeof shaped.data.lesson.secure === 'boolean',
    JSON.stringify(shaped.data && shaped.data.lesson ? { secure: shaped.data.lesson.secure } : {}));
  const serverSource = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  check('the page server moves a browser from http to https when it has a certificate',
    /function secureRedirect/.test(serverSource) && /x-forwarded-proto/.test(serverSource));
  check('the page server allows the camera and the microphone in the room frame',
    /Permissions-Policy/.test(serverSource) && /camera=\(self\)/.test(serverSource));
  check('someone who types the bare address is sent to the secure one',
    /HTTP_REDIRECT_PORT/.test(serverSource) && /redirectServer/.test(serverSource));

  /* ------------------------------------------------- the consoles and the app -- */
  /* Every console starts a class from the same panel, so a page that stops
     loading common.js — or a console that stops calling it — is caught here
     rather than by a host finding an empty screen. */
  const common = await (await fetch(base + '/js/common.js')).text();
  check('the shared live-class panel is shipped', /function liveClassesPanelHtml/.test(common) &&
    /function wireLiveClasses/.test(common) && /function liveClassAction/.test(common));
  check('an alert about a live class opens the room it announces',
    /live_class/.test(common) && /'\/live\?code='/.test(common));
  const superJs = await (await fetch(base + '/js/super.js')).text();
  const adminJs = await (await fetch(base + '/js/admin.js')).text();
  check('the super admin starts classes from the shared panel',
    /liveClassesPanelHtml\(/.test(superJs) && /wireLiveClasses\(/.test(superJs));
  check('the account admin and the supervisor start classes from it too',
    /liveClassesPanelHtml\(/.test(adminJs) && /wireLiveClasses\(/.test(adminJs));
  check('the room reads the words and polls for them',
    /SpeechRecognition/.test(await (await fetch(base + '/js/live.js')).text()) &&
    /\/captions\?after=/.test(await (await fetch(base + '/js/live.js')).text()));
  check('a learner who signs in from a class link lands in the class',
    /takeNextClassLink/.test(await (await fetch(base + '/js/login.js')).text()));

  console.log('');
  if (failures) {
    console.log(failures + ' check(s) FAILED');
    process.exitCode = 1;
  } else {
    console.log('All live-class checks passed.');
  }
  if (server) { try { server.kill(); } catch (error) { /* already gone */ } }
  if (TEMP_DIR) {
    try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch (error) { /* windows lock */ }
  }
})().catch(error => {
  console.error('live-class-check crashed:', error && error.message ? error.message : error);
  if (server) { try { server.kill(); } catch (e) { /* gone */ } }
  if (TEMP_DIR) { try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch (e) { /* lock */ } }
  process.exitCode = 1;
});
