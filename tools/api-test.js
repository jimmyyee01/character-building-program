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
  check('the login serves the live top-performers build and its features',
    r.ok && r.data.build === '2026-11-06-video-alert-points' &&
      (r.data.features || []).indexOf('reports.module-performers') !== -1 &&
      (r.data.features || []).indexOf('reports.top-performers') !== -1 &&
      (r.data.features || []).indexOf('public.top-performers') !== -1 &&
      (r.data.features || []).indexOf('reading.activity') !== -1 &&
      (r.data.features || []).indexOf('reading.video-alerts') !== -1 &&
      (r.data.features || []).indexOf('reading.video-alert-points') !== -1 &&
      (r.data.features || []).indexOf('assessment') !== -1 &&
      (r.data.features || []).indexOf('assessment.admin') !== -1,
    'build ' + (r.data.build || '?') + ' features ' + JSON.stringify(r.data.features || []));
  check('this deployment carries the letter that closes each module',
    r.ok && (r.data.features || []).indexOf('letter.after-module') !== -1,
    'features ' + JSON.stringify(r.data.features || []));
  check('this deployment carries the library media and letter features',
    r.ok && (r.data.features || []).indexOf('library.media') !== -1 &&
      (r.data.features || []).indexOf('library.letters') !== -1,
    'features ' + JSON.stringify(r.data.features || []));
  check('this deployment includes scoped student details',
    r.ok && (r.data.features || []).indexOf('reports.student-detail') !== -1,
    'features ' + JSON.stringify(r.data.features || []));
  check('this deployment includes capped automatic supervisor assignment',
    r.ok && (r.data.features || []).indexOf('users.supervisor-auto-assignment') !== -1,
    'features ' + JSON.stringify(r.data.features || []));
  check('this deployment includes messaging and notifications',
    r.ok && (r.data.features || []).indexOf('messaging') !== -1 &&
      (r.data.features || []).indexOf('notifications') !== -1,
    'features ' + JSON.stringify(r.data.features || []));

  r = await call('/public/tenant/greenfield-academy');
  check('GET /public/tenant/<slug>', r.ok && r.data.tenant && r.data.tenant.name, 'status ' + r.status);
  check('tenant branding exposes themeColor', !!(r.data.branding && 'themeColor' in r.data.branding));

  r = await call('/public/top-performers?slug=greenfield-academy');
  check('GET /public/top-performers returns a ranked top-ten list for the login page',
    r.ok && r.data.tenant && r.data.tenant.slug === 'greenfield-academy' &&
      Array.isArray(r.data.performers) && r.data.performers.length <= 10 &&
      r.data.performers.every(function (p, i, rows) {
        return p.name && p.displayName && typeof p.score === 'number' &&
          p.score >= 0 && p.score <= 100 && p.rank === i + 1 &&
          (i === 0 || rows[i - 1].score >= p.score);
      }),
    'status ' + r.status + ' count ' + ((r.data.performers || []).length));
  check('login-page top performers exclude learners who completed every module',
    r.ok && !(r.data.performers || []).some(function (p) { return p.name === 'Grace Graduate'; }),
    JSON.stringify((r.data.performers || []).map(function (p) { return p.name; })));
  const limitedPerformers = await call('/public/top-performers?slug=greenfield-academy&limit=2');
  check('login-page top performers honour the small display limit',
    limitedPerformers.ok && (limitedPerformers.data.performers || []).length <= 2);
  check('login-page top performers require an account slug',
    (await call('/public/top-performers')).status === 400);

  const sr = await call('/auth/super-login', { method: 'POST', body: { username: 'superadmin', password: 'SuperAdmin@123' } });
  check('super admin login', sr.ok && sr.data.token, JSON.stringify(sr.data).slice(0, 120));
  const superToken = sr.data.token;

  r = await call('/super/tenants', null, superToken);
  check('GET /super/tenants', r.ok && (r.data.tenants || []).length >= 4, 'status ' + r.status);
  r = await call('/super/users', null, superToken);
  check('GET /super/users', r.ok && (r.data.users || []).length >= 8, 'count ' + (r.data.users || []).length);
  r = await call('/super/assessment', null, superToken);
  check('super admin can read the editable self-assessment definition',
    r.ok && r.data.assessment && (r.data.assessment.categories || []).length > 0 &&
      r.data.assessment.statementCount > 0,
    JSON.stringify(r.data).slice(0, 180));

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
  /* each run makes its own people, so the suite can be run again on the same
     database without meeting "an account with those details already exists" */
  const run = Date.now().toString(36).slice(-5);
  const teacherEmail = 'api.teacher.' + run + '@greenfield.edu';
  const supervisorEmail = 'api.sup.' + run + '@horizon.org';
  r = await call('/users', { method: 'POST', body: { role: 'teacher', fullName: 'API Teacher', email: teacherEmail, password: 'Teacher@123' } }, tok.schools);
  check('schools admin creates teacher', r.ok, JSON.stringify(r.data).slice(0, 140));
  r = await call('/users', { method: 'POST', body: { role: 'student', fullName: 'API Student', studentNumber: 'STU-API-' + run, password: 'Student@123' } }, tok.schools);
  check('schools admin creates student with supervisor assignment or waitlist',
    r.ok && r.data.user && (r.data.user.supervisorId || r.data.user.supervisorWaitlisted),
    JSON.stringify(r.data).slice(0, 180));

  r = await call('/users', { method: 'POST', body: { role: 'member', fullName: 'Nope', email: 'nope@horizon.org', password: 'Member@123' } }, tok.organization);
  check('org admin CANNOT create member (403)', r.status === 403, 'status ' + r.status);
  r = await call('/users', { method: 'POST', body: { role: 'supervisor', fullName: 'API Supervisor', email: supervisorEmail, password: 'Super@123' } }, tok.organization);
  check('org admin creates supervisor', r.ok, JSON.stringify(r.data).slice(0, 160));
  const newSup = r.data.user || {};
  check('supervisor gets an access code', !!newSup.supervisorCode, JSON.stringify(newSup).slice(0, 140));
  check('supervisor is not nested under another', newSup.supervisorId === null || newSup.supervisorId === undefined);

  if (newSup.id) {
    const sl = await call('/auth/login', { method: 'POST', body: { slug: 'horizon-alliance', identifier: supervisorEmail, password: 'Super@123' } });
    check('new supervisor can log in', sl.ok && sl.data.token, JSON.stringify(sl.data).slice(0, 120));
    const st = sl.data.token;
    r = await call('/users', { method: 'POST', body: { role: 'member', fullName: 'Sup Member', email: 'sup.member.' + run + '@horizon.org', password: 'Member@123' } }, st);
    check('supervisor creates member under self', r.ok && r.data.user && r.data.user.supervisorId === newSup.id, JSON.stringify(r.data.user || {}).slice(0, 160));
    r = await call('/users', null, st);
    check('supervisor quota max = 100 (GET /users)', r.data.limit && r.data.limit.max === 100, JSON.stringify(r.data.limit || {}));
    r = await call('/users', { method: 'POST', body: { role: 'tenant_admin', fullName: 'No Escalate', email: 'no.escalate.' + run + '@horizon.org', password: 'Abc12345' } }, st);
    check('supervisor cannot escalate (created as member or 403)',
      (r.status === 403) || (r.ok && r.data.user && r.data.user.role === 'member'),
      'status ' + r.status + ' role ' + ((r.data.user || {}).role));
    r = await call('/users', { method: 'POST', body: { role: 'supervisor', fullName: 'No Sup', email: 'no.sup.' + run + '@horizon.org', password: 'Abc12345' } }, st);
    check('supervisor cannot create supervisors (member or 403)',
      (r.status === 403) || (r.ok && r.data.user && r.data.user.role === 'member'),
      'status ' + r.status + ' role ' + ((r.data.user || {}).role));
    r = await call('/reports/students', null, st);
    check('GET /reports/students (supervisor sees own members)',
      r.ok && Array.isArray(r.data.students), 'status ' + r.status);
    check('student progress report carries self-assessment category totals',
      r.ok && Array.isArray(r.data.assessmentCategories) &&
        r.data.assessmentCategories.length > 0 &&
        r.data.students.every(s => s.assessment && 'pre' in s.assessment && 'post' in s.assessment),
      'categories ' + ((r.data.assessmentCategories || []).length));
    if (r.data.students && r.data.students.length) {
      const member = r.data.students[0];
      r = await call('/reports/student-detail?studentId=' + encodeURIComponent(member.id), null, st);
      check('GET /reports/student-detail (supervisor sees own member submissions)',
        r.ok && Array.isArray(r.data.submissions) && typeof r.data.count === 'number',
        'status ' + r.status);
      r = await call('/reports/student-assessment?studentId=' + encodeURIComponent(member.id), null, st);
      check('GET /reports/student-assessment (statement-level pre/post detail)',
        r.ok && Array.isArray(r.data.categories) &&
          r.data.categories.every(c => Array.isArray(c.statements)),
        'status ' + r.status);
    }
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
  check('progress report includes stable module ids for ranking views',
    !r.data.students.length || r.data.students[0].modules.every(function (m) {
      return typeof m.id === 'string' && typeof m.percent === 'number';
    }));
  const progressReport = r;
  if (r.data.students && r.data.students.length) {
    const learner = r.data.students[0];
    r = await call('/reports/student-detail?studentId=' + encodeURIComponent(learner.id), null, tok.schools);
    check('GET /reports/student-detail (tenant admin sees in-account submissions)',
      r.ok && Array.isArray(r.data.submissions) && typeof r.data.count === 'number',
      'status ' + r.status);
  }
  r = progressReport;
  check('progress report provides available calendar years for module activity',
    Array.isArray(r.data.activityYears) && r.data.activityYears.every(function (year) {
      return /^\d{4}$/.test(year);
    }));
  const periodReport = r;
  const rankingYear = (periodReport.data.activityYears || [])[0] || String(new Date().getFullYear());
  r = await call('/reports/module-performers?moduleId=mod_beta&from=' + rankingYear +
    '-01-01&to=' + rankingYear + '-12-31', null, tok.schools);
  const accountLearnerIds = new Set((periodReport.data.students || []).map(function (s) { return s.id; }));
  check('module period ranking is scoped to the account and capped at ten',
    r.ok && r.data.scope === 'module' && Array.isArray(r.data.rankings.combined) &&
      r.data.rankings.combined.length > 0 && r.data.rankings.combined.length <= 10 &&
      r.data.rankings.combined.every(function (s) {
        return accountLearnerIds.has(s.id) && s.combinedPercent >= 0 && s.activityCount > 0;
      }) && r.data.rankings.combined.every(function (s, i, rows) {
        return i === 0 || rows[i - 1].combinedPercent >= s.combinedPercent;
      }),
    'status ' + r.status + ' count ' + ((r.data.rankings && r.data.rankings.combined || []).length));
  check('module rankings return objective-only marks with points earned and available',
    Array.isArray(r.data.rankings.objectives) && r.data.rankings.objectives.length > 0 &&
      r.data.rankings.objectives.every(function (s) {
        return s.objectivePercent >= 0 && s.objectiveScore > 0 && s.objectiveTotal >= s.objectiveScore;
      }));
  r = await call('/reports/module-performers?scope=all-completed&from=' + rankingYear +
    '-01-01&to=' + rankingYear + '-12-31', null, tok.schools);
  const completedLearnerIds = new Set((periodReport.data.students || []).filter(function (student) {
    return student.moduleCount > 0 && student.modulesCompleted === student.moduleCount;
  }).map(function (student) { return student.id; }));
  check('all-modules ranking includes completed learners and marks from every module',
    r.ok && r.data.scope === 'all-completed' && r.data.moduleCount >= 3 &&
      Array.isArray(r.data.rankings.combined) &&
      r.data.rankings.combined.some(function (s) {
        return s.id === (periodReport.data.students.find(function (student) {
          return student.studentNumber === 'STU-100';
        }) || {}).id;
      }) && r.data.rankings.objectives.length > 0 &&
      r.data.rankings.combined.every(function (s) { return completedLearnerIds.has(s.id); }) &&
      r.data.rankings.objectives.every(function (s) { return completedLearnerIds.has(s.id); }),
    'status ' + r.status + ' count ' + ((r.data.rankings && r.data.rankings.combined || []).length));
  r = await call('/reports/module-performers?moduleId=mod_beta&from=' + rankingYear +
    '-12-31&to=' + rankingYear + '-01-01', null, tok.schools);
  check('module period ranking rejects an inverted date range', r.status === 400, 'status ' + r.status);
  r = await call('/reports/module-performers?moduleId=mod_beta&from=' + rankingYear +
    '-01-01&to=' + (Number(rankingYear) + 1) + '-01-01', null, tok.schools);
  check('module period ranking rejects a range crossing calendar years', r.status === 400, 'status ' + r.status);
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
  const graduateCerts = await call('/certificates', null, grad.data.token);
  const generalCert = (graduateCerts.data.certificates || []).find(function (c) { return c.type === 'general'; });
  check('graduate automatically receives general certificate with a module transcript',
    graduateCerts.ok && !!generalCert && Array.isArray(generalCert.transcript) &&
      generalCert.transcript.length > 0 &&
      generalCert.transcript.every(function (m) { return m.status === 'completed'; }),
    JSON.stringify(generalCert || {}).slice(0, 180));
  const graduateCertsAgain = await call('/certificates', null, grad.data.token);
  check('general graduation certificate is issued only once',
    (graduateCertsAgain.data.certificates || []).filter(function (c) { return c.type === 'general'; }).length === 1);
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

  /* ------------------------- library media size + the Letter of Christ --- */
  const audioBytes = Buffer.from('ID3-not-really-audio-just-bytes-to-measure');
  r = await call('/library', { method: 'POST', body: { type: 'audio',
    title: 'Size check track',
    file: { name: 'size-check.mp3', base64: audioBytes.toString('base64'), size: audioBytes.length } } },
    tok.schools);
  const sizeItem = r.data && (r.data.item || r.data);
  check('an uploaded audio file is stored with its size',
    r.ok && !!sizeItem && /^\/uploads\//.test(sizeItem.url || '') &&
      sizeItem.fileSize === audioBytes.length && sizeItem.fileName === 'size-check.mp3',
    JSON.stringify(sizeItem).slice(0, 200));
  const sizeLibId = r.ok && sizeItem ? sizeItem.id : null;

  const letterHtml = '<p>Dear learner,</p><p><b>Bold truth</b> and <i>italic grace</i>.</p>' +
    '<script>alert(1)</script><p onclick="steal()">Plain ending</p>';
  r = await call('/library', { method: 'POST', body: { type: 'letter',
    title: 'A test letter', text: letterHtml, useAsAccountLetter: true } }, tok.schools);
  const letterItem = r.data && (r.data.item || r.data);
  check('a letter keeps its formatting but drops any script',
    r.ok && !!letterItem && /<b>Bold truth<\/b>/.test(letterItem.text || '') &&
      !/<script|onclick/i.test(letterItem.text || ''), JSON.stringify(letterItem.text).slice(0, 160));
  check('the title of a letter stays editable',
    !!letterItem && letterItem.title === 'A test letter');
  r = await call('/me', null, tok.schools);
  check('the account admin sees their own letter as the Letter of Christ',
    r.ok && !!r.data.letter && r.data.letter.id === (letterItem || {}).id,
    JSON.stringify(r.data.letter).slice(0, 140));
  r = await call('/tenant/settings', { method: 'PUT', body: { letterId: null } }, tok.schools);
  check('an account letter can be cleared again',
    r.ok && (r.data.letterId === null || r.data.letterId === ''), JSON.stringify(r.data));
  r = await call('/me', null, tok.schools);
  check('clearing it falls back to the program-wide letter',
    r.ok && !!r.data.letter && r.data.letter.id !== null &&
      r.data.letter.id !== (letterItem || {}).id, JSON.stringify(r.data.letter).slice(0, 140));

  /* --------------------- an optional clip on a letter and a book --------- */
  const clipBytes = Buffer.from('fake-mp4-bytes-for-the-media-picker');
  r = await call('/upload', { method: 'POST', body: {
    file: { name: 'clip.mp4', base64: clipBytes.toString('base64'), size: clipBytes.length } } },
    tok.schools);
  const clip = r.data || {};
  check('the media picker upload returns a stored link, size and kind',
    r.ok && /^\/uploads\//.test(clip.url || '') && clip.size === clipBytes.length &&
      clip.kind === 'video' && clip.name === 'clip.mp4', JSON.stringify(clip).slice(0, 200));
  check('an audio upload is reported as audio',
    (await call('/upload', { method: 'POST', body: { file: {
      name: 'song.mp3', base64: clipBytes.toString('base64'), size: clipBytes.length } } },
      tok.schools)).data.kind === 'audio');
  r = await call('/library', { method: 'POST', body: { type: 'letter',
    title: 'Letter with a clip', text: '<p>Read me.</p>', useAsAccountLetter: true,
    mediaUrl: clip.url, mediaKind: clip.kind, mediaName: clip.name, mediaSize: clip.size } },
    tok.schools);
  const mediaLetter = r.data && (r.data.item || r.data);
  check('a letter stores its attached clip',
    r.ok && !!mediaLetter && mediaLetter.mediaUrl === clip.url &&
      mediaLetter.mediaKind === 'video', JSON.stringify(mediaLetter).slice(0, 200));
  r = await call('/me', null, tok.schools);
  check('the learner letter payload carries the attached clip',
    r.ok && !!r.data.letter && !!r.data.letter.media && r.data.letter.media.url === clip.url,
    JSON.stringify(r.data.letter && r.data.letter.media));
  const modId = ((await call('/modules', null, tok.schools)).data.modules || [{}])[0].id;
  r = await call('/books', { method: 'POST', body: { moduleId: modId, title: 'Book with a clip',
    mediaUrl: clip.url, mediaKind: 'video', mediaName: clip.name, mediaSize: clip.size } },
    tok.schools);
  const mediaBook = r.data && (r.data.book || r.data);
  check('a book stores its attached clip', r.ok && !!mediaBook && mediaBook.mediaUrl === clip.url,
    JSON.stringify(mediaBook).slice(0, 200));
  /* a stale pointer (the linked letter was deleted) must not show "not configured" */
  await call('/tenant/settings', { method: 'PUT', body: { letterId: 'lib_deleted_letter' } }, tok.schools);
  r = await call('/me', null, tok.schools);
  check('a stale letter pointer still resolves to a readable letter',
    r.ok && !!r.data.letter && r.data.letter.id !== null && !!(r.data.letter.text || '').length,
    JSON.stringify(r.data.letter).slice(0, 140));
  await call('/tenant/settings', { method: 'PUT', body: { letterId: null } }, tok.schools);
  await call('/library/' + (mediaLetter || {}).id, { method: 'DELETE' }, tok.schools);
  if (mediaBook && mediaBook.id) await call('/books/' + mediaBook.id, { method: 'DELETE' }, tok.schools);
  await call('/library/' + (letterItem || {}).id, { method: 'DELETE' }, tok.schools);
  if (sizeLibId) await call('/library/' + sizeLibId, { method: 'DELETE' }, tok.schools);

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
  r = await call('/reports/module-performers?moduleId=mod_beta&from=2026-01-01&to=2026-12-31',
    null, stu.data.token);
  check('student blocked from period marks rankings (403)', r.status === 403, 'status ' + r.status);
  r = await call('/not-a-real-endpoint', null, stu.data.token);
  check('unknown endpoint -> 404', r.status === 404, 'status ' + r.status);

  r = await call('/admin/overview');
  check('no token -> 401 (not 500)', r.status === 401, 'status ' + r.status);
  r = await call('/admin/branding', { method: 'PUT', body: { themeColor: '#123456' } });
  check('no token on PUT -> 401 (not 500)', r.status === 401, 'status ' + r.status);

  /* -------------------------------------------------- chapter reading gate -- */
  /* A chapter's answer area opens only at its own LAST page. The whole learner
     journey (and the "no pages, no gate" case) is checked by
     tools/chapter-read-gate-check.js; here both backends must at least expose
     the same payload and the same refusal. */
  const gateFile = await call('/library', { method: 'POST', body: {
    type: 'book', title: 'Reading gate check', url: '/uploads/read-gate-check.pdf' } }, tok.schools);
  const gateItem = gateFile.data.item || gateFile.data;
  const gateModule = (((await call('/modules', null, tok.schools)).data).modules || [])[0];
  const gateBookRes = await call('/books', { method: 'POST', body: {
    moduleId: gateModule.id, title: 'Reading gate check', libraryId: gateItem.id } }, tok.schools);
  const gateBook = gateBookRes.data.book || gateBookRes.data;
  const gateChapterRes = await call('/books/' + gateBook.id + '/chapters', { method: 'POST', body: {
    title: 'Paged chapter', content: 'Read these pages.', pageStart: 2, pageEnd: 5 } }, tok.schools);
  const gateChapter = gateChapterRes.data.chapter || gateChapterRes.data;
  check('a book with a PDF and a paged chapter can be set up for the gate',
    !!gateItem && !!gateItem.id && !!gateBook && !!gateChapter && !!gateChapter.id,
    JSON.stringify(gateChapterRes.data).slice(0, 160));

  r = await call('/book/' + gateBook.id, null, stu.data.token);
  const gateMode = ((r.data || {}).module || {}).mode;
  const gateState = ((r.data || {}).chapters || [])[0] || {};
  check('a chapter with its own pages must be read before it can be answered',
    r.ok && gateState.requiresReading === true && gateState.read === false &&
      Number(gateState.pageEnd) === 5,
    JSON.stringify(gateState).slice(0, 220));

  const earlyAnswer = gateMode === 'objectives'
    ? { type: 'objectives', chapterId: gateChapter.id, answers: [] }
    : { type: 'chapter_summary', chapterId: gateChapter.id,
      text: 'An answer typed before the chapter pages have been read to their very last page.' };
  r = await call('/submissions', { method: 'POST', body: earlyAnswer }, stu.data.token);
  check('answering before the last page is refused and asks for the last page',
    r.status === 403 && /last page/i.test(r.data.error || ''),
    r.status + ' ' + JSON.stringify(r.data).slice(0, 200));

  r = await call('/chapter/' + gateChapter.id + '/read', { method: 'POST', body: { page: 3 } }, stu.data.token);
  check('a page before the last one only bookmarks the chapter',
    r.ok && r.data.read === false && Number(r.data.lastPage) === 3, JSON.stringify(r.data).slice(0, 160));

  r = await call('/chapter/' + gateChapter.id + '/read', { method: 'POST', body: { page: 5 } }, stu.data.token);
  check('reaching the last page marks the chapter as read',
    r.ok && r.data.read === true && Number(r.data.pageEnd) === 5, JSON.stringify(r.data).slice(0, 160));

  r = await call('/book/' + gateBook.id, null, stu.data.token);
  const gateAfter = ((r.data || {}).chapters || [])[0] || {};
  check('the learner\'s own book view reports the chapter as read',
    gateAfter.read === true && !!gateAfter.readAt, JSON.stringify(gateAfter).slice(0, 220));

  await call('/books/' + gateBook.id, { method: 'DELETE' }, tok.schools);
  await call('/library/' + gateItem.id, { method: 'DELETE' }, tok.schools);
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
  /* the super dashboard reads this one; it used to 500 with "tenants is not defined" */
  r = await call('/super/overview', null, st);
  check('GET /super/overview -> {counts, tenants}',
    r.ok && !!r.data.counts && Array.isArray(r.data.tenants) && r.data.tenants.length >= 4,
    'status ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 140));
  const ovTenant = (r.data.tenants || [])[0] || {};
  check('super overview tenant rows carry every dashboard column',
    ['id', 'name', 'slug', 'type', 'users', 'submissions', 'certificates', 'flagged', 'active']
      .every(function (k) { return ovTenant[k] !== undefined; }), JSON.stringify(ovTenant).slice(0, 160));
  check('super overview counts agree with its own tenant rows',
    (r.data.counts || {}).tenants === (r.data.tenants || []).length &&
    (r.data.tenants || []).reduce(function (n, t) { return n + (Number(t.users) || 0); }, 0) <=
      (r.data.counts || {}).users,
    'counts.tenants=' + (r.data.counts || {}).tenants + ' rows=' + (r.data.tenants || []).length +
      ' sum(users)=' + (r.data.tenants || []).reduce(function (n, t) { return n + (Number(t.users) || 0); }, 0) +
      ' counts.users=' + (r.data.counts || {}).users);

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

  /* ------------- the letter that closes each module (super admin) -------- */
  /* The admin writes a pool of up to ten questions for the letter that closes a
     module; every learner is issued only TWO of them, seeded by their own
     account. The pool must never reach a learner whole. */
  const su = await call('/auth/super-login', { method: 'POST', body: { username: 'superadmin', password: 'SuperAdmin@123' } });
  const suTok = su.data.token;
  /* a run that was killed mid-way can leave its throw-away module behind, and such
     a leftover unfinished module would make the seeded graduates look unfinished */
  const stale = await call('/super/modules', null, suTok);
  for (const m of (stale.data.modules || []).filter(function (x) {
    return /^Letter pool module /.test(String(x.title || ''));
  })) {
    const own = await call('/books?moduleId=' + encodeURIComponent(m.id), null, suTok);
    for (const b of (own.data.books || [])) {
      await call('/books/' + encodeURIComponent(b.id), { method: 'DELETE' }, suTok);
    }
    await call('/super/modules/' + encodeURIComponent(m.id), { method: 'DELETE' }, suTok);
  }
  const letterRun = Date.now().toString(36).slice(-5);
  const poolQs = [];
  for (let i = 1; i <= 12; i++) {
    poolQs.push({ question: 'Letter question ' + i + '?',
      options: ['Answer A' + i, 'Answer B' + i, 'Answer C' + i], answerIndex: 1 });
  }
  /* a blank row in the middle is dropped and the pool stops at ten */
  const withBlank = poolQs.slice();
  withBlank.splice(2, 0, { question: '   ', options: [], answerIndex: 0 });
  let lr = await call('/super/modules', { method: 'POST', body: {
    title: 'Letter pool module ' + letterRun, mode: 'summary', order: 99,
    letter: { enabled: true, letterId: null, mode: 'objectives', questions: withBlank } } }, suTok);
  /* the two backends answer either {module} or the module itself */
  const letterMod = lr.data.module || (lr.data && lr.data.id ? lr.data : {});
  const savedPool = ((letterMod.letter || {}).questions || []);
  check('the super admin saves a letter pool with a module',
    lr.ok && !!letterMod.id && savedPool.length === 10,
    'status ' + lr.status + ' pool ' + savedPool.length);
  check('blank question rows are dropped from the letter pool',
    savedPool.length === 10 && savedPool.every(function (q) { return !!String(q.question || '').trim(); }),
    JSON.stringify(savedPool.map(function (q) { return q.question; })));
  check('a letter question keeps its options and the right answer',
    savedPool.length > 0 && (savedPool[0].options || []).length === 3 && savedPool[0].answerIndex === 1,
    JSON.stringify(savedPool[0] || {}));

  /* the learner sees the size of the pool and their own two questions only */
  let lv = await call('/modules', null, stuTok);
  const letterListed = (lv.data.modules || []).filter(function (m) { return m.id === letterMod.id; })[0] || {};
  const letterProg = (letterListed.progress || {}).letter || null;
  check('the learner is told "2 of 10" and never the questions themselves',
    lv.ok && !!letterProg && letterProg.meta.pool === 10 && letterProg.meta.pick === 2 &&
      JSON.stringify(lv.data).indexOf('Letter question') === -1,
    JSON.stringify(letterProg).slice(0, 200));
  lv = await call('/module/' + encodeURIComponent(letterMod.id) + '/letter', null, stuTok);
  check('the letter questions are not issued before every book is finished',
    !lv.ok && (lv.status === 403 || lv.status === 400) &&
      JSON.stringify(lv.data).indexOf('Letter question') === -1,
    'status ' + lv.status + ' ' + JSON.stringify(lv.data).slice(0, 160));
  lv = await call('/submissions', { method: 'POST', body: { type: 'module_letter',
    moduleId: letterMod.id,
    answers: [{ questionId: 'q1', choice: 0 }, { questionId: 'q2', choice: 0 }] } }, stuTok);
  check('the letter cannot be answered while its module is unfinished',
    !lv.ok && lv.status === 403, 'status ' + lv.status + ' ' + JSON.stringify(lv.data).slice(0, 160));

  /* the answering style can be changed without losing the questions */
  lr = await call('/super/modules/' + encodeURIComponent(letterMod.id), { method: 'PUT',
    body: { letter: { enabled: true, mode: 'summary', questions: poolQs.slice(3, 6) } } }, suTok);
  const switched = ((lr.data.module || lr.data || {}).letter) || {};
  check('a module letter can be switched to typed answers',
    lr.ok && switched.mode === 'summary' && (switched.questions || []).length === 3,
    'status ' + lr.status + ' ' + JSON.stringify(switched).slice(0, 160));
  lr = await call('/super/modules/' + encodeURIComponent(letterMod.id), { method: 'PUT',
    body: { letter: { enabled: false, mode: 'objectives', questions: poolQs.slice(0, 3) } } }, suTok);
  lv = await call('/modules', null, stuTok);
  const offListed = (lv.data.modules || []).filter(function (m) { return m.id === letterMod.id; })[0] || {};
  check('switching the letter off removes it from the learner flow',
    lr.ok && !((offListed.progress || {}).letter), JSON.stringify((offListed.progress || {}).letter || null));
  lr = await call('/super/modules/' + encodeURIComponent(letterMod.id), { method: 'DELETE' }, suTok);
  check('the letter test module is removed again', lr.ok, 'status ' + lr.status + ' ' + JSON.stringify(lr.data).slice(0, 160));

  /* --------- the letter is mandatory once the super admin switches it on --- */
  /* The rule: with a letter switched on, a module cannot close — no video, no
     certificate, and so no next module — until the learner has answered it.
     Even a learner who picked the best book BEFORE the letter was switched on
     is pulled back to it. A throwaway student walks the first module to prove
     it; the module is put back the way it was afterwards. */
  const gateRun = Date.now().toString(36).slice(-5);
  const gateNum = 'STU-GATE-' + gateRun;
  const gateNew = await call('/users', { method: 'POST', body: { role: 'student',
    fullName: 'Letter Gate Student', studentNumber: gateNum, password: 'Student@123' } }, tok.schools);
  const gateId = ((gateNew.data && (gateNew.data.user || gateNew.data)) || {}).id || null;
  const gateLogin = await call('/auth/login', { method: 'POST', body: {
    slug: 'greenfield-academy', identifier: gateNum, password: 'Student@123' } });
  const gateTok = gateLogin.data && gateLogin.data.token;
  check('a throwaway learner is created for the mandatory-letter walk',
    gateNew.ok && !!gateId && !!gateTok,
    'status ' + gateNew.status + ' ' + JSON.stringify(gateNew.data).slice(0, 140));
  const gl = await call('/modules', null, gateTok);
  const gateMods = ((gl.data && gl.data.modules) || []).slice()
    .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  const gateMod = gateMods[0] || {};
  const gateNextMod = gateMods[1] || {};
  check('the first module is a typing (summary) module, so the walk can be driven',
    !!gateMod.id && gateMod.mode === 'summary', 'mode ' + gateMod.mode);
  /* self-healing: a run that was killed mid-walk can leave the letter switched
     on, which would stop the walk at the letter before the best book exists */
  await call('/super/modules/' + encodeURIComponent(gateMod.id), { method: 'PUT',
    body: { letter: { enabled: false, mode: 'objectives', questions: [] } } }, suTok);
  /* every chapter in order, then each book's own letter — the reading gate is
     walked through properly, exactly as the screen would */
  for (const b of (((gateMod.progress || {}).books) || [])) {
    for (const c of (b.chapters || [])) {
      if (c.requiresReading && !c.read) {
        await call('/chapter/' + c.id + '/read', { method: 'POST', body: { page: c.pageEnd } }, gateTok);
      }
      if (!c.submission) {
        await call('/submissions', { method: 'POST', body: { type: 'chapter_summary', chapterId: c.id,
          text: 'My own answer for ' + c.title + ' — what the chapter said, in my own words (' + c.id + ').' } }, gateTok);
      }
    }
    /* a summary-mode book closes with its own letter: the flag lives on the
       book, because the letter document itself is only handed out once the
       chapters are finished */
    if (b.book && b.book.letterId && !b.letterSubmission) {
      await call('/submissions', { method: 'POST', body: { type: 'letter_summary', bookId: b.book.id,
        text: 'What ' + b.book.title + ' said to me, written from what I read, in my own words.' } }, gateTok);
    }
  }
  let gg = await call('/module/' + gateMod.id, null, gateTok);
  const gateP = (gg.data && gg.data.progress) || {};
  check('the walked module now waits for its best book',
    gateP.stage === 'best_book', 'stage ' + gateP.stage);
  const gateBest = ((gateP.books || []).filter(function (b) { return b.complete; })[0] || {}).book || {};
  const gatePick = await call('/submissions', { method: 'POST', body: { type: 'best_book',
    moduleId: gateMod.id, bookId: gateBest.id } }, gateTok);
  check('the best book is picked before any letter exists', gatePick.ok,
    'status ' + gatePick.status + ' ' + JSON.stringify(gatePick.data).slice(0, 140));
  gg = await call('/module/' + gateMod.id, null, gateTok);
  check('with the best book picked the module waits on its certificate',
    ((gg.data.progress || {}).stage) === 'video', 'stage ' + ((gg.data.progress || {}).stage));

  /* now the super admin switches the module's letter on */
  const gatePool = [
    { question: 'What does the letter close?', options: ['The book', 'The module', 'The portal'], answerIndex: 1 },
    { question: 'When may the next module open?', options: ['Before the letter', 'After the letter', 'Never'], answerIndex: 1 },
    { question: 'Who answers the letter?', options: ['The learner', 'The teacher', 'Nobody'], answerIndex: 0 }
  ];
  const gateSwitch = await call('/super/modules/' + encodeURIComponent(gateMod.id), { method: 'PUT',
    body: { letter: { enabled: true, letterId: null, mode: 'objectives', questions: gatePool } } }, suTok);
  check('the super admin switches a letter on for a module already in progress',
    gateSwitch.ok && ((((gateSwitch.data.module || gateSwitch.data) || {}).letter || {}).enabled === true),
    'status ' + gateSwitch.status + ' ' + JSON.stringify(gateSwitch.data).slice(0, 140));
  gg = await call('/module/' + gateMod.id, null, gateTok);
  check('a pending letter pulls the learner back from the certificate',
    ((gg.data.progress || {}).stage) === 'letter', 'stage ' + ((gg.data.progress || {}).stage));
  const gateStalled = await call('/certificates/issue', { method: 'POST',
    body: { moduleId: gateMod.id } }, gateTok);
  check('no certificate can be claimed while the letter is unanswered',
    !gateStalled.ok && gateStalled.status === 403 && /letter/i.test(JSON.stringify(gateStalled.data)),
    'status ' + gateStalled.status + ' ' + JSON.stringify(gateStalled.data).slice(0, 140));
  const gateRepeat = await call('/submissions', { method: 'POST', body: { type: 'best_book',
    moduleId: gateMod.id, bookId: gateBest.id } }, gateTok);
  check('re-picking the best book cannot get round the letter', !gateRepeat.ok,
    'status ' + gateRepeat.status + ' ' + JSON.stringify(gateRepeat.data).slice(0, 140));
  const gateNextNow = ((await call('/modules', null, gateTok)).data.modules || [])
    .filter(function (m) { return m.id === gateNextMod.id; })[0] || {};
  check('the next module stays locked until the letter is answered',
    !!gateNextMod.id && gateNextNow.status === 'locked', 'status ' + gateNextNow.status);
  const gateLetter = await call('/module/' + gateMod.id + '/letter', null, gateTok);
  const gateQs = ((gateLetter.data && gateLetter.data.questions) || []);
  check('the letter opens with this learner\'s two questions and points at the certificate',
    gateLetter.ok && gateQs.length === 2 && gateLetter.data.next === 'video',
    'status ' + gateLetter.status + ' ' + JSON.stringify(gateLetter.data).slice(0, 160));
  const gateSub = await call('/submissions', { method: 'POST', body: { type: 'module_letter',
    moduleId: gateMod.id,
    answers: gateQs.map(function (q) { return { questionId: q.id, choice: 0 }; }) } }, gateTok);
  check('the letter can be answered even when the best book was picked first',
    gateSub.ok, 'status ' + gateSub.status + ' ' + JSON.stringify(gateSub.data).slice(0, 140));
  gg = await call('/module/' + gateMod.id, null, gateTok);
  check('answering the letter opens the certificate again',
    ((gg.data.progress || {}).stage) === 'video', 'stage ' + ((gg.data.progress || {}).stage));
  const gateCert = await call('/certificates/issue', { method: 'POST',
    body: { moduleId: gateMod.id } }, gateTok);
  check('the module certificate is issued once the letter is answered', gateCert.ok,
    'status ' + gateCert.status + ' ' + JSON.stringify(gateCert.data).slice(0, 140));
  const gateAfter = ((await call('/modules', null, gateTok)).data.modules || [])
    .filter(function (m) { return m.id === gateNextMod.id; })[0] || {};
  check('only now does the next module open', gateAfter.status === 'active',
    'status ' + gateAfter.status);

  /* -------- one chapter, many questions: only three are asked ------------ */
  /* The rule: the school admin and the super admin may keep adding objective
     questions to a chapter, and each learner is served THREE of them — drawn
     afresh on every login — so the bank is shared but no class can copy one
     another. The bank's own questions are never taken away, and only the three
     that were served are ever marked. The learner who just certified
     module 1 is standing in module 2 (objective mode), so this runs there. */
  check('the module now open is answered with objective questions',
    gateAfter.mode === 'objectives', 'mode ' + gateAfter.mode);
  const bankProgress = await call('/module/' + encodeURIComponent(gateNextMod.id), null, gateTok);
  const bankBookState = (((bankProgress.data || {}).progress || {}).books || [])
    .filter(function (b) { return b.chapters && b.chapters.length; })[0] || {};
  const bankCh = (bankBookState.chapters || [])[0] || {};
  const bankStart = Number(bankCh.objectiveCount) || 0;
  const added = [];
  for (let i = 1; i <= 3; i++) {
    const ores = await call('/chapters/' + encodeURIComponent(bankCh.id) + '/objectives', { method: 'POST',
      body: { question: 'Bank question ' + i + ' of ' + bankCh.title + '?',
        options: ['First ' + i, 'Second ' + i, 'Third ' + i], answerIndex: 1 } }, suTok);
    /* the two backends answer either {objective} or the objective itself */
    const made = (ores.data || {}).objective || ores.data || {};
    added.push(ores.ok && made && made.id ? made.id : null);
  }
  const bankPool = bankStart + added.filter(Boolean).length;
  check('the super admin can keep adding questions to one chapter',
    added.filter(Boolean).length === 3 && bankPool > 3,
    'start ' + bankStart + ' added ' + added.filter(Boolean).length);
  if (bankCh.requiresReading && !bankCh.read) {
    await call('/chapter/' + encodeURIComponent(bankCh.id) + '/read', { method: 'POST',
      body: { page: bankCh.pageEnd } }, gateTok);
  }
  const bankView = await call('/chapter/' + encodeURIComponent(bankCh.id) + '/objectives', null, gateTok);
  const served = ((bankView.data || {}).objectives || []);
  const servedIds = served.map(function (o) { return o.id; });
  check('a learner is served three questions from the chapter, never the whole bank',
    bankView.ok && served.length === 3 &&
      (((bankView.data || {}).counts) || {}).pool === bankPool &&
      (((bankView.data || {}).counts) || {}).pick === 3,
    'status ' + bankView.status + ' ' + JSON.stringify((bankView.data || {}).counts || null));
  check('the questions served do not carry the right answer',
    served.every(function (o) { return o.answerIndex === undefined; }),
    JSON.stringify(served[0] || {}).slice(0, 160));
  const bankAgain = await call('/chapter/' + encodeURIComponent(bankCh.id) + '/objectives', null, gateTok);
  const againIds = (((bankAgain.data || {}).objectives) || []).map(function (o) { return o.id; }).sort();
  check('the same login is served the same three questions on a reload',
    againIds.length === 3 && againIds.join(',') === servedIds.slice().sort().join(','),
    againIds.join(','));
  /* the three are drawn per LOGIN, not per account: signing in again starts a
     fresh session, and the server marks against the draw of the session that
     sends the submission */
  const bankLogin2 = await call('/auth/login', { method: 'POST', body: {
    slug: 'greenfield-academy', identifier: gateNum, password: 'Student@123' } });
  const bankTok2 = (bankLogin2.data || {}).token || null;
  const bankView2 = await call('/chapter/' + encodeURIComponent(bankCh.id) + '/objectives', null, bankTok2);
  const served2 = ((bankView2.data || {}).objectives || []);
  check('logging in again draws the three afresh for that login',
    !!bankTok2 && bankView2.ok && served2.length === 3 &&
      (((bankView2.data || {}).counts) || {}).pool === bankPool,
    'status ' + bankView2.status + ' ' + JSON.stringify((bankView2.data || {}).counts || null));
  const bankShort = await call('/submissions', { method: 'POST', body: { type: 'objectives',
    chapterId: bankCh.id,
    answers: served2.slice(0, 2).map(function (o) { return { objectiveId: o.id, choice: 0 }; }) } }, bankTok2);
  check('a login cannot be marked on anything but its own three',
    !bankShort.ok, 'status ' + bankShort.status + ' ' + JSON.stringify(bankShort.data || {}).slice(0, 140));
  const bankSub = await call('/submissions', { method: 'POST', body: { type: 'objectives',
    chapterId: bankCh.id,
    answers: served.map(function (o) { return { objectiveId: o.id, choice: 0 }; }) } }, gateTok);
  check('answering the three served questions is enough to submit the chapter',
    bankSub.ok && ((bankSub.data || {}).submission || {}).total === 3,
    'status ' + bankSub.status + ' ' + JSON.stringify(bankSub.data || {}).slice(0, 160));
  const bankDone = await call('/chapter/' + encodeURIComponent(bankCh.id) + '/objectives', null, gateTok);
  const bankDoneIds = (((bankDone.data || {}).objectives) || []).map(function (o) { return o.id; }).sort();
  check('after submitting, the chapter shows back the three questions that were marked',
    ((bankDone.data || {}).submitted) === true && bankDoneIds.length === 3 &&
      bankDoneIds.join(',') === servedIds.slice().sort().join(','),
    bankDoneIds.join(','));
  /* the whole bank is still there for the administrators to edit */
  const bankStill = await call('/chapter/' + encodeURIComponent(bankCh.id) + '/objectives', null, stuTok);
  check('the rest of the bank is kept for the administrators',
    (((bankStill.data || {}).counts) || {}).pool === bankPool,
    JSON.stringify((bankStill.data || {}).counts || null));
  for (const oid of added) {
    if (oid) await call('/objectives/' + encodeURIComponent(oid), { method: 'DELETE' }, suTok);
  }

  /* --------- video alert points: the super admin picks the video --------- */
  /* The rule: every third finished chapter opens a point and hands the learner
     ONE library video. It used to be drawn anonymously — now the super admin
     chooses the video each point opens, the learner receives exactly that video,
     the alert names the point, and a point left unset still sends a video the
     learner has never had. A point belongs to every account, so only a global
     library video may be chosen. */
  const vaList = await call('/super/video-alerts', null, suTok);
  const vaPoints = (vaList.data || {}).points || [];
  const vaVideos = (vaList.data || {}).videos || [];
  check('the super admin can read every video point and the global videos',
    vaList.ok && vaPoints.length >= 3 && vaPoints[0].chapters === 3 &&
      vaPoints.every(function (p, i) { return p.point === i + 1 && p.chapters === (i + 1) * 3; }) &&
      vaVideos.length > 0,
    'status ' + vaList.status + ' points ' + vaPoints.length + ' videos ' + vaVideos.length);
  const vaOriginal = (vaPoints[0] || {}).libraryId || '';
  const vaVid = vaVideos[0].id;
  const vaOwnVideo = await call('/library', { method: 'POST', body: {
    type: 'video', title: 'Point video (one account only)', url: '/uploads/point-local.mp4' } },
    tok.schools);
  const vaOwnId = ((vaOwnVideo.data || {}).item || {}).id || null;
  const vaScoped = await call('/super/video-alerts', { method: 'PUT',
    body: { chapters: 3, libraryId: vaOwnId } }, suTok);
  check('a point refuses an account-only video (the plan is shared by every account)',
    !!vaOwnId && vaScoped.status === 400,
    'status ' + vaScoped.status + ' ' + JSON.stringify(vaScoped.data).slice(0, 140));
  const vaOddChapter = await call('/super/video-alerts', { method: 'PUT',
    body: { chapters: 4, libraryId: vaVid } }, suTok);
  check('only a real point (every third chapter) can hold a video', vaOddChapter.status === 400,
    'status ' + vaOddChapter.status);
  const vaForbidden = await call('/super/video-alerts', { method: 'PUT',
    body: { chapters: 3, libraryId: vaVid } }, tok.schools);
  check('only the super admin chooses the video for a point', vaForbidden.status === 403,
    'status ' + vaForbidden.status);
  const vaSet = await call('/super/video-alerts', { method: 'PUT',
    body: { chapters: 3, libraryId: vaVid } }, suTok);
  const vaFirstPoint = ((vaSet.data || {}).points || [])[0] || {};
  check('the video chosen for point 1 is kept',
    vaSet.ok && vaFirstPoint.libraryId === vaVid && vaFirstPoint.ok === true,
    'status ' + vaSet.status + ' ' + JSON.stringify(vaFirstPoint).slice(0, 160));

  /* a throwaway learner walks three chapters of the first (typing) module */
  const vaRun = Date.now().toString(36).slice(-5);
  const vaNum = 'STU-VA-' + vaRun;
  const vaNew = await call('/users', { method: 'POST', body: { role: 'student',
    fullName: 'Video Point Student', studentNumber: vaNum, password: 'Student@123' } }, tok.schools);
  const vaId = (((vaNew.data || {}).user || vaNew.data) || {}).id || null;
  const vaLogin = await call('/auth/login', { method: 'POST', body: {
    slug: 'greenfield-academy', identifier: vaNum, password: 'Student@123' } });
  const vaTok = (vaLogin.data || {}).token || null;
  check('a throwaway learner is created for the video point walk', !!vaId && !!vaTok,
    'status ' + vaNew.status + ' ' + JSON.stringify(vaNew.data).slice(0, 140));
  const vaMods = (((await call('/modules', null, vaTok)).data || {}).modules || [])
    .slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  const vaMod = vaMods.filter(function (m) { return m.mode === 'summary'; })[0] || vaMods[0] || {};
  const vaChapters = [];
  (((vaMod.progress || {}).books) || []).forEach(function (b) {
    (b.chapters || []).forEach(function (c) { vaChapters.push(c); });
  });
  check('the video point learner can see three chapters to finish',
    vaChapters.length >= 3, 'chapters ' + vaChapters.length);
  let vaAlert = null;
  for (let i = 0; i < 3 && i < vaChapters.length; i++) {
    const chapter = vaChapters[i];
    if (chapter.requiresReading && !chapter.read) {
      await call('/chapter/' + encodeURIComponent(chapter.id) + '/read', { method: 'POST',
        body: { page: chapter.pageEnd } }, vaTok);
    }
    const res = await call('/submissions', { method: 'POST', body: { type: 'chapter_summary',
      chapterId: chapter.id,
      text: 'My own words about ' + (chapter.title || 'this chapter') + ' (' + chapter.id + ').' } }, vaTok);
    if (i === 2) vaAlert = (res.data || {}).videoAlert || null;
  }
  check('the third finished chapter unlocks the video the super admin chose',
    !!vaAlert && vaAlert.libraryId === vaVid && vaAlert.point === 1 && vaAlert.chosenBy === 'super',
    JSON.stringify(vaAlert).slice(0, 200));
  const vaInbox = await call('/notifications', null, vaTok);
  const vaNotes = (((vaInbox.data || {}).notifications) || [])
    .filter(function (n) { return n.type === 'video_alert'; });
  check('the alert names the point and carries the chosen video',
    vaNotes.length === 1 && vaNotes[0].libraryId === vaVid &&
      /point 1/i.test((vaNotes[0].title || '') + ' ' + (vaNotes[0].body || '')),
    JSON.stringify(vaNotes.map(function (n) { return n.title; })).slice(0, 180));
  const vaAfter = await call('/super/video-alerts', null, suTok);
  const vaRecent = (((vaAfter.data || {}).recent) || [])[0] || {};
  check('the console lists the unlocked point and who chose the video',
    vaRecent.point === 1 && vaRecent.chosenBy === 'super' && vaRecent.title === vaVideos[0].title,
    JSON.stringify(vaRecent).slice(0, 200));
  const vaCleared = await call('/super/video-alerts', { method: 'PUT',
    body: { chapters: 3, libraryId: '' } }, suTok);
  check('a point can be handed back to the automatic pick',
    vaCleared.ok && ((((vaCleared.data || {}).points) || [])[0] || {}).libraryId === null,
    'status ' + vaCleared.status + ' ' + JSON.stringify((vaCleared.data || {}).points || []).slice(0, 160));
  /* leave the plan as the run found it, and drop the throwaway pieces */
  await call('/super/video-alerts', { method: 'PUT',
    body: { chapters: 3, libraryId: vaOriginal } }, suTok);
  if (vaOwnId) await call('/library/' + encodeURIComponent(vaOwnId), { method: 'DELETE' }, tok.schools);
  if (vaId) await call('/users/' + encodeURIComponent(vaId), { method: 'DELETE' }, tok.schools);

  /* put the module back the way it was, then drop the throwaway learner */
  await call('/super/modules/' + encodeURIComponent(gateMod.id), { method: 'PUT',
    body: { letter: { enabled: false, mode: 'objectives', questions: [] } } }, suTok);
  const gateRestored = await call('/module/' + gateMod.id, null, stuTok);
  check('the walked module is left without a letter again',
    gateRestored.ok && !((gateRestored.data.progress || {}).letter),
    JSON.stringify((gateRestored.data.progress || {}).letter || null));
  if (gateId) await call('/users/' + encodeURIComponent(gateId), { method: 'DELETE' }, tok.schools);

  const certs = await call('/certificates', null, stuTok);
  const first = (certs.data.certificates || [])[0];
  if (first) {
    r = await call('/certificate/' + encodeURIComponent(first.id), null, stuTok);
    check('GET /certificate/:id -> {certificate, branding}', r.ok && !!r.data.certificate && !!r.data.branding, 'status ' + r.status);
  } else {
    check('GET /certificate/:id (no certificate issued yet — skipped)', true);
  }
}
