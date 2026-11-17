/* Isolated API checks for certificate selection, user editing and ACME webroot. */
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cbp-final-api-'));
const DB = path.join(TEMP, 'db.json');
let server, failures = 0, base;
function check(name, condition, detail) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + name + (condition || !detail ? '' : ' [' + detail + ']'));
  if (!condition) failures++;
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(e => e ? reject(e) : resolve(port));
    });
  });
}
async function call(endpoint, options, token) {
  options = options || {};
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(base + '/api' + endpoint, {
    method: options.method || 'GET', headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, ok: res.ok, data };
}
async function main() {
  const seeded = cp.spawnSync(process.execPath, [path.join(ROOT, 'server', 'seed.js')], {
    cwd: ROOT, env: Object.assign({}, process.env, { APP_DB_FILE: DB }), encoding: 'utf8'
  });
  if (seeded.status !== 0) throw new Error(seeded.stderr || 'Seed failed');
  const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
  const student = db.users.find(u => u.studentNumber === 'STU-001');
  const tenant = db.tenants.find(t => t.id === student.tenantId);
  const module = db.modules[0];
  const year = String(new Date().getFullYear());
  tenant.logo = '/uploads/school-logo.png';
  db.settings.programLogo = '/uploads/program-logo.png';
  db.certificates.push({ id: 'cert_final_check', type: 'module', code: 'FINAL-CHECK',
    userId: student.id, tenantId: tenant.id, moduleId: module.id, title: 'Stored module title',
    books: ['Book One'], performance: 87, userName: student.fullName,
    tenantName: tenant.name, issuedAt: year + '-11-17T10:00:00.000Z' });
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
  const port = await freePort();
  base = 'http://127.0.0.1:' + port;
  const webroot = path.join(TEMP, 'webroot');
  const challengeDir = path.join(webroot, '.well-known', 'acme-challenge');
  fs.mkdirSync(challengeDir, { recursive: true });
  fs.writeFileSync(path.join(challengeDir, 'test_token-123'), 'challenge-response');
  server = cp.spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(port), APP_DB_FILE: DB,
      HTTPS_PORT: 'off', HTTP_REDIRECT_PORT: 'off', ACME_WEBROOT: webroot }), stdio: 'ignore'
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch (e) {}
    if (i === 79) throw new Error('Test server did not start');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  const health = await (await fetch(base + '/api/health')).json();
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'build.json'), 'utf8'));
  check('health reports the exact release manifest',
    health.build === manifest.build && manifest.features.every(f => health.features.includes(f)));
  let r = await call('/auth/super-login', { method: 'POST',
    body: { username: 'superadmin', password: 'SuperAdmin@123' } });
  const superToken = r.data.token;
  check('super admin login works in isolated database', !!superToken);
  r = await call('/super/certificate-templates', null, superToken);
  check('certificate settings provide years and modules',
    r.ok && r.data.years.includes(year) && r.data.modules.some(m => m.id === module.id));
  r = await call('/super/certificate-templates', { method: 'PUT', body: {
    defaultTemplate: 'tpl_navy_classic',
    byYear: { [year]: { default: 'tpl_forest_modern', modules: { [module.id]: 'tpl_rose_ornate' } } },
    texts: { title: 'Custom heading', presentedTo: '', footerNote: 'Saved note' },
    extraBlocks: [{ id: 'one', text: 'Additional recognition' }]
  } }, superToken);
  check('year/module design and editable wording save', r.ok, JSON.stringify(r.data));
  r = await call('/certificates/cert_final_check/config', null, superToken);
  check('module selection wins and both logos reach the renderer',
    r.ok && r.data.templateId === 'tpl_rose_ornate' &&
    r.data.schoolLogo === tenant.logo && r.data.programLogo === db.settings.programLogo &&
    r.data.texts.title === 'Custom heading' && r.data.texts.presentedTo === '' &&
    r.data.extraBlocks[0].text === 'Additional recognition', JSON.stringify(r.data));
  await call('/super/certificate-templates', { method: 'PUT', body: {
    byYear: { [year]: { default: 'tpl_forest_modern', modules: {} } }
  } }, superToken);
  r = await call('/certificates/cert_final_check/config', null, superToken);
  check('year default applies when no module override exists', r.data.templateId === 'tpl_forest_modern');
  await call('/super/certificate-templates', { method: 'PUT', body: {
    defaultTemplate: 'tpl_teal_minimal', byYear: { [year]: { default: '', modules: {} } }
  } }, superToken);
  r = await call('/certificates/cert_final_check/config', null, superToken);
  check('programme default applies when the year has no design', r.data.templateId === 'tpl_teal_minimal');
  r = await call('/auth/login', { method: 'POST', body: {
    slug: 'greenfield-academy', identifier: 'admin@greenfield.edu', password: 'Admin@123' } });
  const adminToken = r.data.token;
  r = await call('/users/' + student.id, { method: 'PUT', body: {
    fullName: 'Edited Student', className: '', email: '', studentNumber: 'STU-EDITED', suspended: true
  } }, adminToken);
  check('account admin can edit/clear fields and suspend',
    r.ok && r.data.user.fullName === 'Edited Student' && r.data.user.className === null &&
    r.data.user.email === null && r.data.user.studentNumber === 'STU-EDITED' && r.data.user.suspended === true,
    JSON.stringify(r.data));
  r = await call('/users/' + student.id, { method: 'PUT', body: { suspended: false } }, adminToken);
  check('account admin can unsuspend', r.ok && r.data.user.suspended === false, JSON.stringify(r.data));
  r = await call('/users/' + student.id, { method: 'PUT', body: { studentNumber: 'STU-002' } }, adminToken);
  check('duplicate student numbers are rejected', r.status === 409, JSON.stringify(r.data));

  const challenge = await fetch(base + '/.well-known/acme-challenge/test_token-123');
  check('ACME HTTP-01 token is served without an HTTPS redirect',
    challenge.status === 200 && await challenge.text() === 'challenge-response');
  const invalid = await fetch(base + '/.well-known/acme-challenge/%2e%2e%2fsecret');
  check('ACME path traversal is rejected', invalid.status === 400);
  if (failures) process.exitCode = 1;
  else console.log('\nFINAL API CHECKS PASSED');
}
main().catch(e => { console.error('FATAL ' + e.stack); process.exitCode = 1; }).finally(() => {
  if (server && server.exitCode === null) server.kill('SIGKILL');
  try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch (e) {}
});
