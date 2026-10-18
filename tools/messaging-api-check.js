const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cbp-messaging-check-'));
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
    if (server.exitCode !== null) throw new Error('Preview server exited before readiness');
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw lastError || new Error('Timed out waiting for the test server');
}

function prepareGraduationDatabase() {
  const env = Object.assign({}, process.env, { APP_DB_FILE: DB_FILE });
  const seed = childProcess.spawnSync(process.execPath, [path.join(ROOT, 'server', 'seed.js')], {
    cwd: ROOT, env, encoding: 'utf8'
  });
  if (seed.status !== 0) throw new Error(seed.stderr || 'Could not create isolated test database');
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const graduate = data.users.find(user => user.email === 'olive@horizon.org');
  if (!graduate) throw new Error('Seeded graduate account was not found');
  data.modules.forEach((module, index) => {
    data.certificates.push({
      id: 'test_completed_' + index, type: 'module', code: 'TEST-' + index,
      userId: graduate.id, tenantId: graduate.tenantId, moduleId: module.id,
      performance: 100, issuedAt: new Date().toISOString()
    });
  });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  return graduate.id;
}

async function main() {
  const graduateId = prepareGraduationDatabase();
  const port = await findPort();
  const base = 'http://127.0.0.1:' + port;
  server = childProcess.spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port), APP_DB_FILE: DB_FILE }),
    stdio: 'ignore'
  });
  await waitForServer(base);

  const admin = await login(base, 'horizon-alliance', 'admin@horizon.org', 'Admin@123');
  const supervisor = await login(base, 'horizon-alliance', 'supervisor@horizon.org', 'Super@123');
  const graduate = await login(base, 'horizon-alliance', 'olive@horizon.org', 'Member@123');
  const schoolAdmin = await login(base, 'greenfield-academy', 'admin@greenfield.edu', 'Admin@123');
  check('seeded account admin, supervisor, learner and separate-account logins',
    !!admin && !!supervisor && !!graduate && !!schoolAdmin);
  if (!admin || !supervisor || !graduate || !schoolAdmin) throw new Error('Missing seeded messaging test account');

  await call(base, '/certificates', graduate);
  const completionAlerts = await call(base, '/notifications', supervisor);
  check('all-module graduate creates a detailed supervisor completion alert',
    (completionAlerts.data.notifications || []).some(n =>
      n.type === 'completion' && n.studentId === graduateId));
  await call(base, '/certificates', graduate);
  const repeatedCompletionAlerts = await call(base, '/notifications', supervisor);
  check('reloading certificates does not duplicate completion alerts',
    (repeatedCompletionAlerts.data.notifications || []).filter(n =>
      n.type === 'completion' && n.studentId === graduateId).length === 1);

  const createdLearner = await call(base, '/users', supervisor, { method: 'POST', body: {
    role: 'member', fullName: 'Messaging Test Learner',
    email: 'messaging.test.learner@example.test', password: 'Member@123'
  } });
  const member = await login(base, 'horizon-alliance',
    'messaging.test.learner@example.test', 'Member@123');
  check('supervisor can create a learner for messaging checks',
    createdLearner.status === 200 && !!member);
  if (!member) throw new Error('Cannot run messaging checks without a test learner');

  const memberMe = await call(base, '/me', member);
  const supervisorMe = await call(base, '/me', supervisor);
  const supervisorRecipients = await call(base, '/messages', supervisor);
  check('supervisor can address assigned learners and their account admin',
    supervisorRecipients.status === 200 &&
      (supervisorRecipients.data.recipients || []).some(r => r.id === memberMe.data.user.id) &&
      (supervisorRecipients.data.recipients || []).some(r => r.role === 'tenant_admin'));
  const memberRecipients = await call(base, '/messages', member);
  check('learner can address their supervisor and account admin',
    memberRecipients.status === 200 &&
      (memberRecipients.data.recipients || []).some(r => r.role === 'supervisor') &&
      (memberRecipients.data.recipients || []).some(r => r.role === 'tenant_admin'));

  const learnerFlow = await call(base, '/flow', member);
  if (learnerFlow.data.showLetter) {
    await call(base, '/flow/letter-feedback', member, {
      method: 'POST', body: { feedback: 'I will grow through patience, respect, and kindness.' }
    });
  }
  const learnerModules = await call(base, '/modules', member);
  const activeModule = (learnerModules.data.modules || []).find(m => m.status === 'active');
  const activeBook = activeModule && (activeModule.progress.books || []).find(b =>
    (b.chapters || []).some(ch => ch.status === 'active'));
  const activeChapter = activeBook && activeBook.chapters.find(ch => ch.status === 'active');
  let submissionResult = { status: 404 };
  if (activeModule && activeChapter) {
    if (activeModule.mode === 'summary') {
      submissionResult = await call(base, '/submissions', member, { method: 'POST', body: {
        type: 'chapter_summary', chapterId: activeChapter.id,
        text: 'I learned how patience, respect, and kindness can guide my daily choices.'
      } });
    } else {
      const objectives = await call(base, '/chapter/' + activeChapter.id + '/objectives', member);
      submissionResult = await call(base, '/submissions', member, { method: 'POST', body: {
        type: 'objectives', chapterId: activeChapter.id,
        answers: (objectives.data.objectives || []).map(objective => ({ objectiveId: objective.id, choice: 0 }))
      } });
    }
  }
  const activityAlerts = await call(base, '/notifications', supervisor);
  check('student submission creates a detailed supervisor activity alert',
    submissionResult.status === 200 &&
      (activityAlerts.data.notifications || []).some(n =>
        n.type === 'submission' && n.studentId === memberMe.data.user.id),
    'submission ' + submissionResult.status + ' ' + JSON.stringify(submissionResult.data));

  let result = await call(base, '/messages', admin, {
    method: 'POST', body: { recipientIds: [memberMe.data.user.id], body: 'Welcome to the programme.' }
  });
  check('account admin can message a learner in the account', result.status === 200 && result.data.sent === 1);
  const memberInbox = await call(base, '/messages', member);
  const memberConversation = (memberInbox.data.conversations || [])[0];
  check('recipient receives an unread conversation', !!memberConversation && memberConversation.unread === 1);
  const memberAlerts = await call(base, '/notifications', member);
  const adminMessageAlert = (memberAlerts.data.notifications || []).find(n => n.type === 'message');
  check('message delivery creates an in-app alert', !!adminMessageAlert && !adminMessageAlert.readAt);

  result = await call(base, '/messages/' + memberConversation.id, member, {
    method: 'POST', body: { body: 'Thank you, I have a question.' }
  });
  check('learner can reply directly to the account admin', result.status === 200 && !!result.data.message);
  await call(base, '/messages/' + memberConversation.id, member);
  const readAlerts = await call(base, '/notifications', member);
  const readInbox = await call(base, '/messages', member);
  const openedAlert = (readAlerts.data.notifications || []).find(n => n.id === adminMessageAlert.id);
  const openedConversation = (readInbox.data.conversations || []).find(c => c.id === memberConversation.id);
  check('opening a thread clears its message alert and unread message state',
    !!openedAlert && !!openedAlert.readAt && !!openedConversation && openedConversation.unread === 0);
  const adminInbox = await call(base, '/messages', admin);
  const adminConversation = (adminInbox.data.conversations || []).find(c =>
    c.participant && c.participant.id === memberMe.data.user.id);
  check('reply appears for the account admin', !!adminConversation && adminConversation.unread === 1);
  result = await call(base, '/messages/' + memberConversation.id, supervisor);
  check('a non-participant cannot read another conversation', result.status === 404);
  result = await call(base, '/notifications/' + adminMessageAlert.id + '/read', supervisor, { method: 'PUT' });
  check('a user cannot mark another user notification read', result.status === 404);

  result = await call(base, '/messages', supervisor, {
    method: 'POST', body: { recipientIds: [memberMe.data.user.id], body: 'Please send me an update.' }
  });
  const memberInboxWithSupervisor = await call(base, '/messages', member);
  const supervisorConversation = (memberInboxWithSupervisor.data.conversations || []).find(c =>
    c.participant && c.participant.id === supervisorMe.data.user.id);
  const studentReply = supervisorConversation
    ? await call(base, '/messages/' + supervisorConversation.id, member, {
      method: 'POST', body: { body: 'I am making progress.' }
    })
    : { status: 404 };
  const supervisorInbox = await call(base, '/messages', supervisor);
  check('learner can reply directly to their supervisor',
    result.status === 200 && studentReply.status === 200 &&
      (supervisorInbox.data.conversations || []).some(c =>
        c.participant && c.participant.id === memberMe.data.user.id && c.unread > 0));

  const bulk = await call(base, '/messages', supervisor, {
    method: 'POST',
    body: { recipientIds: [memberMe.data.user.id, (supervisorRecipients.data.recipients || []).find(r => r.role === 'tenant_admin').id],
      body: 'Group announcement.' }
  });
  check('supervisor bulk send creates one private thread per recipient',
    bulk.status === 200 && bulk.data.sent === 2);

  const secondSupervisor = await call(base, '/users', admin, { method: 'POST', body: {
    role: 'supervisor', fullName: 'Messaging Scope Supervisor',
    email: 'messaging.scope.supervisor@example.test', password: 'Supervisor@123'
  } });
  const secondSupervisorLogin = await login(base, 'horizon-alliance',
    'messaging.scope.supervisor@example.test', 'Supervisor@123');
  const otherLearner = await call(base, '/users', secondSupervisorLogin, { method: 'POST', body: {
    role: 'member', fullName: 'Other Supervisor Learner',
    email: 'messaging.scope.learner@example.test', password: 'Member@123',
  } });
  result = await call(base, '/messages', supervisor, {
    method: 'POST', body: { recipientIds: [otherLearner.data.user && otherLearner.data.user.id || 'missing'], body: 'Not authorized.' }
  });
  check('created the separate supervisor and assigned learner',
    secondSupervisor.status === 200 && !!secondSupervisorLogin && otherLearner.status === 200,
    'supervisor ' + secondSupervisor.status + '; learner ' + otherLearner.status +
      ' ' + JSON.stringify(otherLearner.data));
  check('supervisor cannot message a learner assigned to another supervisor',
    !!otherLearner.data.user && result.status === 403);
  result = await call(base, '/messages', schoolAdmin, {
    method: 'POST', body: { recipientIds: [memberMe.data.user.id], body: 'Cross-account attempt.' }
  });
  check('account isolation blocks messages across tenants', result.status === 403);

  console.log('\n' + (failures ? failures + ' messaging check(s) failed' : 'Messaging checks passed'));
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
