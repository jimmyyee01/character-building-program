/* Renders the new report builders against realistic payloads to catch runtime
   errors and confirm the "expand summary only when finished" rule. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const base = path.join(__dirname, '..', 'public', 'js') + path.sep;

function stub() {
  return { style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() { return true; }, contains() { return false; } },
    appendChild() {}, remove() {}, click() {}, focus() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, innerHTML: '', textContent: '', value: '', dataset: {} };
}
const doc = { addEventListener() {}, createElement: stub, getElementById: stub, querySelector: stub,
  querySelectorAll() { return []; }, body: stub(), documentElement: stub(), head: stub(),
  readyState: 'loading', title: '' };
const ctx = vm.createContext({
  document: doc, console: console, navigator: { userAgent: 'node' },
  window: { location: { href: 'http://x/', pathname: '/', search: '', hash: '' }, addEventListener() {},
    setTimeout: setTimeout, clearTimeout: clearTimeout, document: doc, print() {} },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  fetch: () => new Promise(function () {}),
  Blob: function () {}, FileReader: function () { this.readAsDataURL = function () {}; },
  URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} },
  setTimeout: setTimeout, clearTimeout: clearTimeout, alert() {}, confirm() { return false; }, prompt() { return ''; }
});
ctx.location = ctx.window.location; ctx.self = ctx.window;
['common.js', 'admin.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(base + f, 'utf8'), ctx, { filename: f });
});

const finished = {
  id: 'usr_grad', fullName: 'Grace Graduate', email: null, studentNumber: 'STU-100', className: 'Grade 12A',
  progress: 100, submissions: 50, certificates: 4, flagged: 0, lastActiveAt: new Date().toISOString(),
  modulesCompleted: 3, moduleCount: 3, supervisorName: null, tenantName: 'Greenfield Academy',
  level: { index: 3, title: 'All modules completed', percent: 100, state: 'Completed' },
  modules: [{ id: 'module_a', title: 'MODULE ONE', percent: 100, status: 'completed' },
            { id: 'module_b', title: 'MODULE TWO', percent: 98, status: 'completed' }],
  recent: [{ type: 'best_book', createdAt: new Date().toISOString(), score: null, total: null,
    flagged: false, similarity: 0, label: 'The Heart of Relationships', chapter: null, book: 'Book A' },
    { type: 'objectives', createdAt: new Date().toISOString(), score: 4, total: 5, flagged: false,
      similarity: 0, chapter: 'Chapter 1' }]
};
const unfinished = Object.assign({}, finished, {
  id: 'usr_jane', fullName: 'Jane Student', progress: 12, modulesCompleted: 0,
  level: { index: 1, title: 'MODULE ONE — BUILDING CHARACTER / FOUNDATION', percent: 12, state: 'In progress' }
});

const html = vm.runInContext('progressTableHtml', ctx)([finished, unfinished]);
const checks = [
  ['rank table built', html.indexOf('<table>') !== -1 && html.indexOf('</tbody></table>') !== -1],
  ['ranked row 1 = finished learner', html.indexOf('<td><b>1</b></td>') !== -1],
  ['summary button only for finished learner',
    (html.match(/data-sum="/g) || []).length === 1 && html.indexOf('data-sum="usr_grad"') !== -1],
  ['unfinished learner shows a locked note',
    html.indexOf('Not finished yet') !== -1 && html.indexOf('data-sum="usr_jane"') === -1],
  ['expandable row exists for the finished learner',
    html.indexOf('id="sum-usr_grad"') !== -1 && html.indexOf('class="sum-row hidden"') !== -1],
  ['summary contains coverage chart + totals + recent work',
    html.indexOf('Programme coverage') !== -1 && html.indexOf('class="bar-row"') !== -1 &&
    html.indexOf('class="track"') !== -1 && html.indexOf('Copy flags') !== -1 &&
    html.indexOf('Recent work') !== -1 && html.indexOf('Book A') !== -1],
  ['summary shows supervisor/account/level meta', html.indexOf('Account: <b>Greenfield Academy</b>') !== -1]
];
const charts = vm.runInContext(
  'JSON.stringify([typeof chartBars([]), typeof chartDonut([{label:"x",value:0}]), chartProgress([{label:"M1",percent:40}]).indexOf("<svg") === -1, chartWeekly([], 8).length > 50])', ctx);
checks.push(['chart helpers survive empty data', JSON.parse(charts)[0] === 'string' && JSON.parse(charts)[3] === true]);
checks.push(['donut empty -> message', /No data yet/.test(vm.runInContext('chartDonut([])', ctx))]);

const superCtx = vm.createContext({
  document: doc, console: console, navigator: { userAgent: 'node' },
  window: { location: { href: 'http://x/', pathname: '/', search: '', hash: '' },
    addEventListener() {}, setTimeout: setTimeout, clearTimeout: clearTimeout, document: doc, print() {} },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  fetch: () => new Promise(function () {}),
  Blob: function () {}, FileReader: function () { this.readAsDataURL = function () {}; },
  URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} },
  setTimeout: setTimeout, clearTimeout: clearTimeout, alert() {}, confirm() { return false; }, prompt() { return ''; }
});
superCtx.location = superCtx.window.location; superCtx.self = superCtx.window;
['common.js', 'super.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(base + f, 'utf8'), superCtx, { filename: f });
});
const rankingStudents = Array.from({ length: 12 }, function (_, i) {
  return {
    id: 'learner_' + i, fullName: 'Learner ' + i, tenantName: 'Account A',
    studentNumber: 'STU-' + i, moduleCount: 3, modulesCompleted: 3,
    certificates: 12 - i, submissions: 30 - i, progress: 100 - i * 4,
    modules: [{ id: 'module_a', percent: 100 - i * 5, status: i === 0 ? 'completed' : 'active' }]
  };
});
rankingStudents.push({
  id: 'unfinished', fullName: 'Unfinished learner', tenantName: 'Account B',
  moduleCount: 3, modulesCompleted: 2, certificates: 99, submissions: 99, progress: 99,
  modules: [{ id: 'module_a', percent: 100, status: 'active' }]
});
const modules = [{ id: 'module_a', title: 'Module A' }];
const accountModuleRanking = vm.runInContext('accountRankingHtml', ctx)('module:module_a',
  rankingStudents.slice(0, 12), modules);
checks.push(['account admins get a top-ten module ranking',
  (accountModuleRanking.match(/<td><b>\d+<\/b><\/td>/g) || []).length === 10 &&
  accountModuleRanking.indexOf('Learner 0') < accountModuleRanking.indexOf('Learner 1') &&
  accountModuleRanking.indexOf('Learner 9') !== -1 && accountModuleRanking.indexOf('Learner 10') === -1]);
const accountGraduationRanking = vm.runInContext('accountRankingHtml', ctx)('graduation',
  rankingStudents, modules);
checks.push(['account graduation ranking excludes unfinished learners and caps at ten',
  (accountGraduationRanking.match(/<td><b>\d+<\/b><\/td>/g) || []).length === 10 &&
  accountGraduationRanking.indexOf('Unfinished learner') === -1]);
const moduleRanking = vm.runInContext('moduleRankingHTML', superCtx)('module:module_a', rankingStudents.slice(0, 12), modules);
checks.push(['module top 10 sorts by module progress and caps at ten',
  (moduleRanking.match(/<td><b>\d+<\/b><\/td>/g) || []).length === 10 &&
  moduleRanking.indexOf('Learner 0') < moduleRanking.indexOf('Learner 1') &&
  moduleRanking.indexOf('Learner 9') !== -1 && moduleRanking.indexOf('Learner 10') === -1]);
const graduationRanking = vm.runInContext('moduleRankingHTML', superCtx)('graduation', rankingStudents, modules);
checks.push(['graduation top 10 includes graduates only and ranks certificates',
  (graduationRanking.match(/<td><b>\d+<\/b><\/td>/g) || []).length === 10 &&
  graduationRanking.indexOf('Learner 0') < graduationRanking.indexOf('Learner 1') &&
  graduationRanking.indexOf('Unfinished learner') === -1]);

let bad = 0;
checks.forEach(function (c) {
  console.log((c[1] ? 'PASS  ' : 'FAIL  ') + c[0]);
  if (!c[1]) bad++;
});
console.log(bad ? bad + ' FAILED' : 'REPORT + MODULE RANKINGS OK');
process.exit(bad ? 1 : 0);
