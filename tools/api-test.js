/* End-to-end API test suite — runs against either backend:
     node api_test.js http://127.0.0.1:3000   (Node)
     node api_test.js http://127.0.0.1:8080   (PHP)                                   */
const base = process.argv[2] || 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const fails = [];

async function call(path, opts, token) {
  opts = opts || {};
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const init = { method: opts.method || 'GET', headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await fetch(base + '/api' + path, init);
  let data = {};
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  return { status: res.status, ok: res.ok, data: data };
}
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; fails.push(name + (extra ? '  [' + extra + ']' : '')); console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}

async function main() {
  console.log('=== API test suite: ' + base + ' ===');

  let r = await call('/public/portals');
  check('GET /public/portals', r.ok && r.data.ok && (r.data.portals || []).length >= 4);
  r = await call('/health');
  check('GET /health reports the running build and its features',
    r.ok && r.data.ok && !!r.data.build && Array.isArray(r.data.features) &&
    (r.data.backend === 'node' || r.data.backend === 'php'), JSON.stringify(r.data).slice(0, 160));
  check('this deployment includes the analytics features',
    r.ok && (r.data.features || []).indexOf('super.analytics') !== -1 &&
    (r.data.features || []).indexOf('admin.analytics') !== -1,
    'build ' + (r.data.build || '?') + ' features ' + JSON.stringify(r.data.features || []));

  r = await call('/public/tenant/greenfield-academy');
  check('GET /public/tenant/<slug>', r.ok && r.data.tenant && r.data.tenant.name, 'status ' + r.status);
  check('tenant branding exposes themeColor', !!(r.data.branding && 'themeColor' in r.data.branding));

  const sr = await call('/auth/super-login', { method: 'POST', body: { username: 'superadmin', password: 'SuperAdmin@123' } });
  check('super admin login', sr.ok && sr.data.token, JSON.stringify(sr.data).slice(0, 120));
  const superToken = sr.data.token;

  r = await call('/super/tenants', null, superToken);
  check('GET /super/tenants', r.ok && (r.data.tenants || []).length >= 4, 'status ' + r.status);
  r = await call('/super/users', null, superToken);
  check('GET /super/users', r.ok && (r.data.users || []).length >= 8, 'count ' + (r.data.users || []).length);

  const portals = [
    ['greenfield-academy', 'admin@greenfield.edu', 'Admin@123', 'schools'],
    ['horizon-alliance', 'admin@horizon.org', 'Admin@123', 'organization'],
    ['beloved-family', 'admin@family.example', 'Admin@123', 'family'],
    ['covenant-couples', 'admin@married.example', 'Admin@123', 'married']
  ];
  const tok = {};
  for (const p of portals) {
    r = await call('/auth/login', { method: 'POST', body: { slug: p[0], identifier: p[1], password: p[2] } });
    check('login ' + p[3] + ' admin', r.ok && r.data.token, JSON.stringify(r.data).slice(0, 120));
    tok[p[3]] = r.data.token;
  }

  for (const t of Object.keys(tok)) {
    r = await call('/me', null, tok[t]);
    check('/me ' + t + ' -> tenant_admin', r.ok && r.data.user && r.data.user.role === 'tenant_admin');
    check('/me ' + t + ' branding.themeColor', !!(r.data.branding && 'themeColor' in r.data.branding));
  }

  r = await call('/admin/branding', { method: 'PUT', body: { themeColor: '#0f766e' } }, tok.schools);
  check('PUT /admin/branding sets colour', r.ok, JSON.stringify(r.data).slice(0, 120));
  r = await call('/me', null, tok.schools);
  check('colour persisted', r.data.branding && r.data.branding.themeColor === '#0f766e', JSON.stringify(r.data.branding || {}));
  r = await call('/admin/branding', { method: 'PUT', body: { themeColor: 'javascript:alert(1)' } }, tok.schools);
  check('invalid colour accepted but sanitised', r.ok, 'status ' + r.status);
  r = await call('/me', null, tok.schools);
  check('invalid colour stored as null', !r.data.branding.themeColor, JSON.stringify(r.data.branding || {}));

  await part2(r, tok, check);
  await part3(r, tok, check);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('FAILURES:\n - ' + fails.join('\n - ')); }
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('FATAL ' + e.message); process.exit(1); });

async function part2(r, tok, check) {
  r = await call('/users', { method: 'POST', body: { role: 'teacher', fullName: 'API Teacher', email: 'api.teacher@greenfield.edu', password: 'Teacher@123' } }, tok.schools);
  check('schools admin creates teacher', r.ok, JSON.stringify(r.data).slice(0, 140));
  r = await call('/users', { method: 'POST', body: { role: 'student', fullName: 'API Student', studentNumber: 'STU-API', password: 'Student@123' } }, tok.schools);
  check('schools admin creates student', r.ok, JSON.stringify(r.data).slice(0, 140));

  r = await call('/users', { method: 'POST', body: { role: 'member', fullName: 'Nope', email: 'nope@horizon.org', password: 'Member@123' } }, tok.organization);
  check('org admin CANNOT create member (403)', r.status === 403, 'status ' + r.status);
  r = await call('/users', { method: 'POST', body: { role: 'supervisor', fullName: 'API Supervisor', email: 'api.sup@horizon.org', password: 'Super@123' } }, tok.organization);
  check('org admin creates supervisor', r.ok, JSON.stringify(r.data).slice(0, 160));
  const newSup = r.data.user || {};
  check('supervisor gets an access code', !!newSup.supervisorCode, JSON.stringify(newSup).slice(0, 140));
  check('supervisor is not nested under another', newSup.supervisorId === null || newSup.supervisorId === undefined);

  if (newSup.id) {
    const sl = await call('/auth/login', { method: 'POST', body: { slug: 'horizon-alliance', identifier: 'api.sup@horizon.org', password: 'Super@123' } });
    check('new supervisor can log in', sl.ok && sl.data.token, JSON.stringify(sl.data).slice(0, 120));
    const st = sl.data.token;
    r = await call('/users', { method: 'POST', body: { role: 'member', fullName: 'Sup Member', email: 'sup.member1@horizon.org', password: 'Member@123' } }, st);
    check('supervisor creates member under self', r.ok && r.data.user && r.data.user.supervisorId === newSup.id, JSON.stringify(r.data.user || {}).slice(0, 160));
    r = await call('/users', null, st);
    check('supervisor quota max = 100 (GET /users)', r.data.limit && r.data.limit.max === 100, JSON.stringify(r.data.limit || {}));
    r = await call('/users', { method: 'POST', body: { role: 'tenant_admin', fullName: 'No Escalate', email: 'no.escalate@horizon.org', password: 'Abc12345' } }, st);
    check('supervisor cannot escalate (created as member or 403)',
      (r.status === 403) || (r.ok && r.data.user && r.data.user.role === 'member'),
      'status ' + r.status + ' role ' + ((r.data.user || {}).role));
    r = await call('/users', { method: 'POST', body: { role: 'supervisor', fullName: 'No Sup', email: 'no.sup@horizon.org', password: 'Abc12345' } }, st);
    check('supervisor cannot create supervisors (member or 403)',
      (r.status === 403) || (r.ok && r.data.user && r.data.user.role === 'member'),
      'status ' + r.status + ' role ' + ((r.data.user || {}).role));
    r = await call('/reports/students', null, st);
    check('GET /reports/students (supervisor sees own members)',
      r.ok && Array.isArray(r.data.students), 'status ' + r.status);
  }

  r = await call('/admin/overview', null, tok.schools);
  check('GET /admin/overview', r.ok && !!r.data.counts, 'status ' + r.status);
  r = await call('/admin/submissions', null, tok.schools);
  check('GET /admin/submissions', r.ok && Array.isArray(r.data.submissions), 'status ' + r.status);
  r = await call('/admin/certificates', null, tok.schools);
  check('GET /admin/certificates', r.ok && Array.isArray(r.data.certificates), 'status ' + r.status);
  r = await call('/reports/students', null, tok.schools);
  check('GET /reports/students (tenant admin)',
    r.ok && Array.isArray(r.data.students) && typeof r.data.average === 'number', 'status ' + r.status);
  check('progress report is ranked by coverage',
    !!r.data.students && r.data.students.every(function (s, i, arr) { return i === 0 || arr[i - 1].progress >= s.progress; }));
  check('progress report has level, recent work and counts',
    !r.data.students.length || (r.data.students[0].level && typeof r.data.students[0].level.title === 'string' &&
      Array.isArray(r.data.students[0].recent) && typeof r.data.students[0].modulesCompleted === 'number' &&
      typeof r.data.students[0].submissions === 'number'),
    JSON.stringify(r.data.students[0] || {}).slice(0, 120));
  const supLogin = await call('/auth/super-login', { method: 'POST', body: { username: 'superadmin', password: 'SuperAdmin@123' } });
  r = await call('/reports/students', null, supLogin.data.token);
  check('GET /reports/students (super admin, all accounts)',
    supLogin.ok && r.ok && Array.isArray(r.data.students), 'status ' + r.status);
  r = await call('/reports/students', null, tok.married);
  check('progress report on an account with no learners returns an empty ranked list',
    r.ok && Array.isArray(r.data.students) && r.data.students.length === 0 && r.data.average === 0,
    'status ' + r.status + ' count ' + (r.data.count));

  /* ---- books open for a learner only after every module is complete ---- */
  const lockStu = await call('/auth/login', { method: 'POST', body: { slug: 'greenfield-academy', identifier: 'STU-001', password: 'Student@123' } });
  check('student login for the book-lock checks', lockStu.ok && lockStu.data.token);
  const pdfText = '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n' +
    '3 0 obj << /Type /Page /Parent 2 0 R >> endobj\ntrailer << /Root 1 0 R /Size 4 >>\n%%EOF\n';
  r = await call('/library', { method: 'POST', body: { type: 'book', title: 'Lock Check Book', scope: 'global',
    file: { name: 'lock-check.pdf', base64: Buffer.from(pdfText, 'latin1').toString('base64') } } }, supLogin.data.token);
  check('book uploaded for the lock check', r.ok && r.data.item, JSON.stringify(r.data).slice(0, 120));
  const lockId = (r.data.item || {}).id;
  const stuLib = await call('/library', null, lockStu.data.token);
  const lockItem = (stuLib.data.library || []).filter(function (i) { return i.id === lockId; })[0] || {};
  check('learner cannot open a book before finishing every module',
    lockItem.url === null && lockItem.locked === true, JSON.stringify(lockItem).slice(0, 150));
  const lockBook = await call('/book/book_gamma_1', null, lockStu.data.token);
  check('learner book payload says the full book is locked', lockBook.data.pdfUnlocked === false,
    JSON.stringify(lockBook.data.pdfUnlocked));
  check('chapter payload always carries the chapter key words',
    (lockBook.data.chapters || []).every(function (c) { return Array.isArray(c.keywords); }));
  const grad = await call('/auth/login', { method: 'POST', body: { slug: 'greenfield-academy', identifier: 'STU-100', password: 'Student@123' } });
  check('demo graduate login', grad.ok && grad.data.token, JSON.stringify(grad.data).slice(0, 120));
  const gradLib = await call('/library', null, grad.data.token);
  const openItem = (gradLib.data.library || []).filter(function (i) { return i.id === lockId; })[0] || {};
  check('a learner who finished every module can open the books',
    !!openItem.url && openItem.locked !== true, JSON.stringify(openItem).slice(0, 150));
  const gradBook = await call('/book/book_gamma_1', null, grad.data.token);
  check('graduate book payload unlocks the full book', gradBook.data.pdfUnlocked === true,
    JSON.stringify(gradBook.data.pdfUnlocked));
  await call('/library/' + lockId, { method: 'DELETE' }, supLogin.data.token);

  /* ---- super analytics: every level of the picture ---- */
  r = await call('/super/analytics', null, supLogin.data.token);
  check('GET /super/analytics (super admin)', r.ok && !!r.data.impact && Array.isArray(r.data.portals), 'status ' + r.status);
  check('analytics carries portals, accounts, modules, books, chapters, learners and activity',
    (r.data.portals || []).length > 0 && (r.data.accounts || []).length > 0 &&
    (r.data.modules || []).length > 0 && (((r.data.modules || [])[0].books || [])[0] || {}).chapters &&
    ((r.data.modules || [])[0].books[0].chapters || []).length > 0 &&
    (r.data.learners || []).length > 0 && (r.data.activity || []).length >= 4,
    JSON.stringify(r.data.totals || {}));
  check('analytics totals count every level of the exercise',
    r.data.totals.chapters >= 20 && r.data.totals.books >= 10 && r.data.totals.objectives >= 20 &&
    r.data.totals.participants >= 1, JSON.stringify(r.data.totals));
  check('analytics impact indices are present',
    typeof r.data.impact.involvementRate === 'number' && typeof r.data.impact.completionRate === 'number' &&
    typeof r.data.impact.integrity === 'number' && 'keywordCoverage' in r.data.impact &&
    'objectiveAccuracy' in r.data.impact, JSON.stringify(r.data.impact));
  r = await call('/super/analytics?portalId=prt_schools&weeks=4', null, supLogin.data.token);
  check('analytics filters by portal and period',
    r.ok && (r.data.portals || []).length === 1 && (r.data.activity || []).length === 4 &&
    r.data.scope.weeks === 4, JSON.stringify(r.data.scope));
  r = await call('/super/analytics?tenantId=ten_greenfield', null, supLogin.data.token);
  check('analytics filters by account', r.ok && (r.data.accounts || []).length === 1,
    JSON.stringify((r.data.accounts || []).map(function (a) { return a.name; })));
  r = await call('/super/analytics', null, tok.schools);
  check('analytics is super-admin only (403 for an account admin)', r.status === 403, 'status ' + r.status);
  r = await call('/modules', null, tok.schools);
  check('GET /modules', r.ok && (r.data.modules || []).length >= 3, 'count ' + (r.data.modules || []).length);
  r = await call('/library', null, tok.schools);
  check('GET /library', r.ok && Array.isArray(r.data.library), 'status ' + r.status);
  r = await call('/books?moduleId=mod_gamma', null, tok.schools);
  check('GET /books?moduleId=mod_gamma', r.ok && (r.data.books || []).length >= 3, 'count ' + (r.data.books || []).length);

  const stu = await call('/auth/login', { method: 'POST', body: { slug: 'greenfield-academy', identifier: 'STU-001', password: 'Student@123' } });
  check('student login', stu.ok && stu.data.token, JSON.stringify(stu.data).slice(0, 120));
  r = await call('/flow', null, stu.data.token);
  check('GET /flow (student) has modules + performance',
    r.ok && Array.isArray(r.data.modules) && r.data.performance !== undefined, 'status ' + r.status);
  check('GET /flow (student) first-login flags', r.data.showLetter !== undefined && r.data.letterDone !== undefined);
  r = await call('/certificates', null, stu.data.token);
  check('GET /certificates (student)', r.ok && Array.isArray(r.data.certificates), 'status ' + r.status);
  r = await call('/admin/overview', null, stu.data.token);
  check('student blocked from admin report (403)', r.status === 403, 'status ' + r.status);
  r = await call('/reports/students', null, stu.data.token);
  check('student blocked from student-progress report (403)', r.status === 403, 'status ' + r.status);
  r = await call('/not-a-real-endpoint', null, stu.data.token);
  check('unknown endpoint -> 404', r.status === 404, 'status ' + r.status);

  r = await call('/admin/overview');
  check('no token -> 401 (not 500)', r.status === 401, 'status ' + r.status);
  r = await call('/admin/branding', { method: 'PUT', body: { themeColor: '#123456' } });
  check('no token on PUT -> 401 (not 500)', r.status === 401, 'status ' + r.status);
}


/* Super-console pages, the tenant-admin user list and the participant extras —
   these are the endpoints whose payload keys the consoles read directly. */
async function part3(r, tok, check) {
  const sup = await call('/auth/super-login', { method: 'POST', body: { username: 'superadmin', password: 'SuperAdmin@123' } });
  const st = sup.data.token;
  r = await call('/super/portals', null, st);
  check('GET /super/portals -> {portals}', r.ok && Array.isArray(r.data.portals) && r.data.portals.length >= 4, 'status ' + r.status);
  r = await call('/super/tenants', null, st);
  check('GET /super/tenants -> {tenants}', r.ok && Array.isArray(r.data.tenants) && r.data.tenants.length >= 4, 'status ' + r.status);
  r = await call('/super/modules', null, st);
  check('GET /super/modules -> {modules}', r.ok && Array.isArray(r.data.modules) && r.data.modules.length >= 3, 'status ' + r.status);
  r = await call('/super/users', null, st);
  check('GET /super/users -> {users}', r.ok && Array.isArray(r.data.users) && r.data.users.length >= 8, 'count ' + ((r.data.users || []).length));
  r = await call('/super/submissions', null, st);
  check('GET /super/submissions -> {submissions}', r.ok && Array.isArray(r.data.submissions), 'status ' + r.status);
  r = await call('/super/settings', null, st);
  check('GET /super/settings', r.ok, 'status ' + r.status);

  r = await call('/users', null, tok.schools);
  check('GET /users (tenant admin) -> {users}', r.ok && Array.isArray(r.data.users), 'status ' + r.status);

  /* an organization admin can brand its own pages with a theme colour */
  r = await call('/admin/branding', { method: 'PUT', body: { themeColor: '#0f766e' } }, tok.organization);
  check('org admin sets its own theme colour', r.ok, 'status ' + r.status);
  r = await call('/me', null, tok.organization);
  check('org theme colour stored on the account', r.data.branding && r.data.branding.themeColor === '#0f766e', JSON.stringify(r.data.branding || {}));
  r = await call('/public/tenant/horizon-alliance');
  check('org login page receives the colour', r.ok && r.data.branding && r.data.branding.themeColor === '#0f766e', JSON.stringify(r.data.branding || {}));
  r = await call('/admin/branding', { method: 'PUT', body: { themeColor: '#7c3aed' } }, tok.organization);
  r = await call('/me', null, tok.organization);
  check('org colour can be changed again', r.data.branding && r.data.branding.themeColor === '#7c3aed', JSON.stringify(r.data.branding || {}));
  await call('/admin/branding', { method: 'PUT', body: { themeColor: null } }, tok.organization);
  r = await call('/me', null, tok.organization);
  check('org colour can be cleared', r.data.branding && !r.data.branding.themeColor, JSON.stringify(r.data.branding || {}));

  /* the programme logo belongs to the super admin account only */
  r = await call('/admin/branding', { method: 'PUT', body: { programLogo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' } }, tok.organization);
  check('tenant admin cannot set the programme logo', r.ok, 'status ' + r.status);
  r = await call('/me', null, tok.organization);
  check('programme logo untouched by tenant admin', !r.data.branding || !r.data.branding.programLogo, JSON.stringify(r.data.branding || {}));

  const stu = await call('/auth/login', { method: 'POST', body: { slug: 'greenfield-academy', identifier: 'STU-001', password: 'Student@123' } });
  const stuTok = stu.data.token;
  r = await call('/videos', null, stuTok);
  check('GET /videos -> {videos}', r.ok && Array.isArray(r.data.videos), 'status ' + r.status);
  r = await call('/thoughts', null, stuTok);
  check('GET /thoughts -> {thoughts}', r.ok && Array.isArray(r.data.thoughts), 'status ' + r.status);
  r = await call('/dashboard', null, stuTok);
  check('GET /dashboard -> {recent, certificates}', r.ok && Array.isArray(r.data.recent), 'status ' + r.status);
  r = await call('/final', null, stuTok);
  check('GET /final (403 until every module is done)', r.ok || r.status === 403, 'status ' + r.status);

  const certs = await call('/certificates', null, stuTok);
  const first = (certs.data.certificates || [])[0];
  if (first) {
    r = await call('/certificate/' + encodeURIComponent(first.id), null, stuTok);
    check('GET /certificate/:id -> {certificate, branding}', r.ok && !!r.data.certificate && !!r.data.branding, 'status ' + r.status);
  } else {
    check('GET /certificate/:id (no certificate issued yet — skipped)', true);
  }
}

