/* Client mistakes must not be reported as server faults.

   A body that is not JSON, a broken %-escape in the path, a URL Node refuses to
   parse and an upload bigger than the body limit each earn a 4xx answer
   (400 / 400 / 400 / 413). All four used to answer 500, which put a stack trace
   in the journal for what was simply a bad request, and left a caller unable to
   tell "I sent rubbish" from "the server is broken". A genuine endpoint that
   does not exist must still be a 404, and a valid login must still work.

   Usage: node tools/http-errors-check.js
   The real server runs on a free port against a throw-away database with a
   deliberately small body limit, so the seeded demo data is untouched. */
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cbp-http-errors-'));
const DB_FILE = path.join(TEMP_DIR, 'db.json');
const BODY_LIMIT = 2048; /* small on purpose: proving 413 must not move 400 MB */

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

function asJSON(text) {
  try { return JSON.parse(text); } catch (error) { return {}; }
}

/* Raw http, not fetch: fetch refuses to send the malformed paths this check is
   about, and the exact bytes on the wire are the point. */
function raw(port, options) {
  const body = options.body === undefined ? null : options.body;
  const headers = Object.assign({}, options.headers);
  if (body !== null) headers['Content-Length'] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method: options.method || 'GET',
      path: options.path, headers
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text, json: asJSON(text) }));
    });
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

/* A refused upload is answered while the sender is still writing, so the write
   may fail after the 413 has already been read: only the answer matters. */
function oversized(port, size) {
  return new Promise(resolve => {
    const payload = 'x'.repeat(size);
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST', path: '/api/auth/login',
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length }
    }, res => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', error => resolve({ status: 0, error: error.code }));
    req.write(payload);
    setTimeout(() => { try { req.end(); } catch (error) { /* server hung up on purpose */ } }, 150);
  });
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
  const env = Object.assign({}, process.env, { APP_DB_FILE: file });
  const seed = childProcess.spawnSync(process.execPath, [path.join(ROOT, 'server', 'seed.js')], {
    cwd: ROOT, env, encoding: 'utf8'
  });
  if (seed.status !== 0) throw new Error(seed.stderr || 'Could not create isolated test database');
}

async function main() {
  prepareDatabase(DB_FILE);
  const port = await findPort();
  const base = 'http://127.0.0.1:' + port;
  server = childProcess.spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(port), APP_DB_FILE: DB_FILE, BODY_LIMIT: String(BODY_LIMIT)
    }),
    stdio: 'ignore'
  });
  await waitForServer(base, server);

  /* ------------------------------------------- 1. a body that is not JSON -- */
  const notJSON = await raw(port, {
    method: 'POST', path: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' }, body: 'not-json-at-all'
  });
  check('a malformed JSON body is a 400, not a 500',
    notJSON.status === 400 && /invalid json/i.test(notJSON.json.error || ''),
    notJSON.status + ' ' + notJSON.body.slice(0, 160));

  /* --------------------------------------------- 2. broken path escapes ---- */
  const badPaths = [
    ['a broken %-escape in an API path', '/api/%zz'],
    ['an escaped byte that is not valid UTF-8', '/%E0%A4%A'],
    ['a lone % at the end of a page path', '/%'],
    ['a path Node refuses to parse', '//%2e%2e%2f%2eenv']
  ];
  for (const pair of badPaths) {
    const answer = await raw(port, { path: pair[1] });
    check(pair[0] + ' is a 400', answer.status === 400,
      pair[1] + ' -> ' + answer.status + ' ' + answer.body.slice(0, 120));
  }

  /* ----------------------------------------------- 3. the body limit ------ */
  const over = await oversized(port, BODY_LIMIT * 4);
  check('an upload bigger than the body limit is a 413', over.status === 413,
    'status ' + over.status + (over.error ? ' (' + over.error + ')' : ''));

  /* ------------------------------------ 4. nothing else changed ---------- */
  const missing = await raw(port, { path: '/api/does-not-exist' });
  check('an endpoint that does not exist is still a 404',
    missing.status === 404 && /unknown endpoint/i.test(missing.json.error || ''),
    missing.status + ' ' + missing.body.slice(0, 160));

  const health = await raw(port, { path: '/api/health' });
  check('the server is still healthy after the bad requests',
    health.status === 200 && health.json.ok === true,
    health.status + ' ' + health.body.slice(0, 160));

  const page = await raw(port, { path: '/' });
  check('the login page is still served', page.status === 200 && /<html/i.test(page.body),
    'status ' + page.status);

  const login = await raw(port, {
    method: 'POST', path: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: 'greenfield-academy', identifier: 'STU-001', password: 'Student@123' })
  });
  check('a well-formed login still succeeds and returns a token',
    login.status === 200 && !!login.json.token,
    login.status + ' ' + login.body.slice(0, 160));

  console.log('\n' + (failures ? failures + ' http-error check(s) failed' : 'HTTP error checks passed'));
  if (failures) process.exitCode = 1;
}

main().catch(error => {
  console.error('FATAL ' + error.message);
  process.exitCode = 1;
}).finally(() => {
  if (server && server.exitCode === null) {
    try { server.kill('SIGKILL'); } catch (error) { /* already gone */ }
  }
  try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch (error) { /* later */ }
});

