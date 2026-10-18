const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cbp-supervisor-check-'));
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
  try { data = await response.json(); } catch (error) { /* non-JSON response */ }
  return { status: response.status, data };
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

async function main() {
  const port = await findPort();
  const base = 'http://127.0.0.1:' + port;
  server = childProcess.spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port), APP_DB_FILE: DB_FILE }),
    stdio: 'ignore'
  });
  await waitForServer(base);

  let response = await call(base, '/auth/login', null, { method: 'POST', body: {
    slug: 'greenfield-academy', identifier: 'admin@greenfield.edu', password: 'Admin@123'
  } });
  const token = response.data.token;
  check('school admin login', response.status === 200 && !!token, 'status ' + response.status);
  if (!token) throw new Error('Cannot run assignment checks without the seeded school admin');

  response = await call(base, '/users', token);
  const legacyLearners = (response.data.users || []).filter(u => ['student', 'member'].includes(u.role));
  check('existing unassigned learners enter the waitlist',
    legacyLearners.length >= 2 && legacyLearners.every(u => u.supervisorWaitlisted && !u.supervisorId));

  response = await call(base, '/users', token, { method: 'POST', body: {
    role: 'supervisor', fullName: 'Capacity Supervisor One',
    email: 'capacity.sup.one@example.test', password: 'Supervisor@123'
  } });
  const firstSupervisor = response.data.user;
  check('creating a supervisor drains the existing waitlist',
    response.status === 200 && !!firstSupervisor && !!firstSupervisor.supervisorCode);
  response = await call(base, '/users', token);
  const assignedLegacy = (response.data.users || []).filter(u => ['student', 'member'].includes(u.role));
  check('unassigned learners receive the new supervisor',
    assignedLegacy.length >= 2 && assignedLegacy.every(u =>
      u.supervisorId === firstSupervisor.id && !u.supervisorWaitlisted));

  response = await call(base, '/users', token, { method: 'POST', body: {
    role: 'supervisor', fullName: 'Suspended Supervisor',
    email: 'capacity.sup.suspended@example.test', password: 'Supervisor@123'
  } });
  const suspendedSupervisor = response.data.user;
  const suspended = await call(base, '/users/' + suspendedSupervisor.id, token, {
    method: 'PUT', body: { suspended: true }
  });
  check('suspended supervisors are excluded from automatic assignment',
    response.status === 200 && suspended.status === 200);

  response = await call(base, '/users', token, { method: 'POST', body: {
    role: 'student', fullName: 'Automatically Assigned Student', studentNumber: 'STU-AUTO',
    password: 'Student@123'
  } });
  check('new registration is automatically assigned to available capacity',
    response.status === 200 && response.data.user &&
      response.data.user.supervisorId === firstSupervisor.id &&
      !response.data.user.supervisorWaitlisted);

  const assignedCount = assignedLegacy.length + 1;
  const bulk = Array.from({ length: 100 - assignedCount }, (_, index) => ({
    role: 'student',
    fullName: 'Capacity Student ' + (index + 1),
    studentNumber: 'STU-CAP-' + (index + 1),
    password: 'Student@123',
    supervisorId: firstSupervisor.id
  }));
  response = await call(base, '/users/bulk', token, { method: 'POST', body: { users: bulk } });
  check('capacity is filled to exactly 100', response.status === 200 &&
    (response.data.created || []).length === bulk.length &&
    (response.data.errors || []).length === 0);

  response = await call(base, '/users', token, { method: 'POST', body: {
    role: 'student', fullName: 'Explicit Full Supervisor', studentNumber: 'STU-EXPLICIT-FULL',
    password: 'Student@123', supervisorId: firstSupervisor.id
  } });
  check('explicit assignment cannot exceed 100', response.status === 409);

  response = await call(base, '/users', token, { method: 'POST', body: {
    role: 'student', fullName: 'Waitlisted Student', studentNumber: 'STU-WAITLIST',
    password: 'Student@123'
  } });
  const waitingStudent = response.data.user;
  check('the 101st student is waitlisted when all supervisors are full',
    response.status === 200 && !!waitingStudent && waitingStudent.supervisorWaitlisted &&
      !waitingStudent.supervisorId);

  response = await call(base, '/users', token, { method: 'POST', body: {
    role: 'supervisor', fullName: 'Capacity Supervisor Two',
    email: 'capacity.sup.two@example.test', password: 'Supervisor@123'
  } });
  const secondSupervisor = response.data.user;
  const updatedUsers = await call(base, '/users', token);
  const assignedWaitingStudent = (updatedUsers.data.users || []).find(u => u.id === (waitingStudent || {}).id);
  check('a newly available supervisor receives the oldest waitlisted student',
    response.status === 200 && !!secondSupervisor && assignedWaitingStudent &&
      assignedWaitingStudent.supervisorId === secondSupervisor.id &&
      !assignedWaitingStudent.supervisorWaitlisted);

  const fillSecondSupervisor = Array.from({ length: 99 }, (_, index) => ({
    role: 'student',
    fullName: 'Second Capacity Student ' + (index + 1),
    studentNumber: 'STU-CAP-TWO-' + (index + 1),
    password: 'Student@123',
    supervisorId: secondSupervisor.id
  }));
  response = await call(base, '/users/bulk', token, { method: 'POST', body: { users: fillSecondSupervisor } });
  check('second supervisor also stops at 100',
    response.status === 200 && (response.data.created || []).length === 99 &&
      (response.data.errors || []).length === 0);
  const secondSupervisorStudents = response.data.created || [];
  response = await call(base, '/users', token, { method: 'POST', body: {
    role: 'student', fullName: 'Second Waitlisted Student', studentNumber: 'STU-WAITLIST-TWO',
    password: 'Student@123'
  } });
  const secondWaitingStudent = response.data.user;
  const releasedStudent = secondSupervisorStudents[0];
  const removed = await call(base, '/users/' + releasedStudent.id, token, { method: 'DELETE' });
  const afterRelease = await call(base, '/users', token);
  const reassignedWaitingStudent = (afterRelease.data.users || []).find(u =>
    u.id === (secondWaitingStudent || {}).id);
  check('a freed slot is given to the oldest waitlisted student',
    response.status === 200 && secondWaitingStudent && secondWaitingStudent.supervisorWaitlisted &&
      removed.status === 200 && reassignedWaitingStudent &&
      reassignedWaitingStudent.supervisorId === secondSupervisor.id &&
      !reassignedWaitingStudent.supervisorWaitlisted);

  console.log('\n' + (failures ? failures + ' supervisor assignment check(s) failed' : 'Supervisor assignment checks passed'));
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
