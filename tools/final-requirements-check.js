/* Focused regression checks for the final menu/report/certificate request. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(name, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + name);
  if (!condition) failures++;
}
const certFile = path.join(ROOT, 'public', 'js', 'certificates.js');
const ctx = vm.createContext({ window: {}, document: {}, console });
vm.runInContext(fs.readFileSync(certFile, 'utf8'), ctx, { filename: 'certificates.js' });
const templates = vm.runInContext('CERT_TEMPLATES', ctx);
const render = vm.runInContext('certificateSheetHtml', ctx);
check('certificate catalogue contains 120 unique designs',
  templates.length === 120 && new Set(templates.map(t => t.id)).size === 120);
check('all 12 layouts are available in every one of the 10 palettes',
  vm.runInContext('CERT_LAYOUTS.length', ctx) === 12 &&
  vm.runInContext('CERT_PALETTES.length', ctx) === 10 &&
  vm.runInContext('CERT_PALETTES.every(p => CERT_TEMPLATES.filter(t => t.palette.id === p.id).length === 12)', ctx));
const sample = {
  title: 'Stored module title', userName: 'Jane Student', tenantName: 'School A',
  books: ['Book One'], performance: 87, code: 'CODE-1', issuedAt: '2026-11-17T10:00:00Z'
};
check('every template can render a certificate',
  templates.every(t => render({ templateId: t.id, data: sample }).includes('data-layout="' + t.layout.id + '"')));
const positioned = render({
  templateId: 'tpl_navy_classic', schoolLogo: '/uploads/school.png',
  programLogo: '/uploads/program.png', data: sample, extraBlocks: [{ text: 'Extra award line' }]
});
check('school logo is left and programme logo is right',
  positioned.indexOf('cert-logo-left') !== -1 && positioned.indexOf('cert-logo-right') !== -1 &&
  positioned.indexOf('cert-logo-left') < positioned.indexOf('cert-logo-right'));
check('performance stays in the body and issue date stays in the right footer',
  positioned.indexOf('Overall performance') < positioned.indexOf('<div class="foot">') &&
  positioned.indexOf('Overall performance') < positioned.indexOf('Issued: 2026-11-17') &&
  positioned.includes('<span>Issued: 2026-11-17</span>'));
check('extra certificate areas render',
  positioned.includes('<div class="cert-extra">Extra award line</div>'));
check('an untouched certificate keeps its stored title',
  render({ data: sample }).includes('<h1>Stored module title</h1>'));
check('a custom heading overrides the stored title',
  render({ texts: { title: 'Custom award heading' }, data: sample })
    .includes('<h1>Custom award heading</h1>'));
const removed = render({
  texts: { title: '', presentedTo: '', completion: '', performanceLabel: '',
    signLeftLabel: '', signRightLabel: '' }, data: sample
});
check('blank wording is genuinely removed instead of restored',
  !removed.includes('<h1>') && !removed.includes('This certificate is proudly presented to') &&
  !removed.includes('for the successful completion of') && !removed.includes('cert-signs') &&
  !removed.includes('Overall performance'));
check('removing a label never removes the required performance value', removed.includes('<b>87%</b>'));

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const superHtml = read('public/super.html');
const superJs = read('public/js/super.js');
const adminJs = read('public/js/admin.js');
const css = read('public/css/style.css');
check('tracking exposes separate Students and Submission reports screens',
  superHtml.includes('data-view="students"') && superHtml.includes('data-view="reports"') &&
  superHtml.includes('id="view-students"') && superHtml.includes('id="view-reports"') &&
  superJs.includes('async function renderStudentList()') &&
  superJs.includes('async function renderSubmissionReports()'));
check('students table includes Actions and preserves its Edit click handler',
  superJs.includes('<th>Self-assessment</th><th>Status</th><th>Actions</th>') &&
  superJs.includes("const edit = e.target.closest('button[data-edit-student]')") &&
  superJs.includes('openStudentEdit(edit.dataset.editStudent)'));
check('all menu carets are encoding-safe CSS shapes',
  ['public/super.html', 'public/admin.html', 'public/app.html'].every(p =>
    read(p).includes('<span class="nav-group-caret"></span>')) &&
  css.includes('.nav-group-caret') && !/A-3\/4|â–¾|â€“|Ã¢/.test(superHtml + adminJs + superJs));
check('tenant login logo and watermark are horizontally centred',
  css.includes('.auth-logos { display: flex; align-items: center; justify-content: center;') &&
  css.includes('left: 50%; bottom: 8px; transform: translateX(-50%);'));
check('certificate preview uses a real school logo',
  superJs.includes('S.certPreviewAccount = accounts.filter') &&
  superJs.includes('schoolLogo: account.logo || null'));
check('account edit stores the selected user and sends both suspension states',
  /function openUserEdit\(u\) \{\s*userEditState = u;/.test(adminJs) &&
  adminJs.includes('if (susp) payload.suspended = !!susp.checked;') &&
  adminJs.includes('if (sup) payload.supervisorId = sup.value || null;'));
if (failures) {
  console.error('\n' + failures + ' final-requirement check(s) failed');
  process.exitCode = 1;
} else console.log('\nFINAL REQUIREMENT CHECKS PASSED');
