'use strict';
/* Removes records that are NOT real data, so every screen shows only what the
   school actually entered.

   There are two levels, because they mean different things:

     node tools/clean-demo-data.js
       Removes the residue left behind by the automated test suites
       ("API Student", "Sup Member", "No Escalate", "Copy Check A", …). These
       are never real people; they only exist because a check script created a
       user and did not remove it. Safe to run at any time.

     node tools/clean-demo-data.js --demo
       ALSO removes the demonstration accounts that the seed creates on a fresh
       install (Greenfield Academy and its demo teacher, students, supervisor and
       graduate, plus the other three demo accounts). Use this once the real
       school / organisation has been created, so the console lists only real
       accounts.

   Everything removed is written to data/db.backup-<timestamp>.json first, so a
   cleanup can always be undone by copying that file back over data/db.json.
   A user's dependent records (submissions, certificates, messages, book opens,
   chapter reads, notifications, sessions) are removed with them, so nothing is
   left pointing at a person who is no longer there. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_FILE = process.env.APP_DB_FILE
  ? path.resolve(process.env.APP_DB_FILE)
  : path.join(ROOT, 'data', 'db.json');

const args = process.argv.slice(2);
const withDemo = args.indexOf('--demo') !== -1;
const dryRun = args.indexOf('--dry-run') !== -1;

/* ------------------------------------------------------------- patterns --- */
/* Names an automated check script gives a throw-away user. */
const TEST_NAMES = [
  /^API\s/i,
  /^Sup Member$/i,
  /^No Escalate$/i,
  /^No Sup$/i,
  /^Nope$/i,
  /^Copy Check [A-Z]$/i,
  /^Letter Gate Student$/i,
  /^Video Point Student$/i,
  /^Log Check Learner\b/i,
  /^Waitlist Render Check$/i,
  /^Capacity Student \d+$/i,
  /^Second Capacity Student \d+$/i,
  /^Automatically Assigned Student$/i,
  /^Explicit Full Supervisor$/i,
  /^Waitlisted Student$/i,
  /^Second Waitlisted Student$/i,
  /^Messaging Test Learner$/i,
  /^Other Supervisor Learner$/i,
  /^Period Learner \d+$/i,
  /^Unfinished learner$/i,
  /^Capacity Supervisor/i,
  /^Messaging Scope Supervisor$/i,
  /^Suspended Supervisor$/i
];
/* Email shapes only a test script uses. */
const TEST_EMAILS = [
  /^api\./i,
  /^sup\.member\./i,
  /^no\.escalate\./i,
  /^no\.sup\./i,
  /@example\.test$/i
];
/* People the seed creates so a fresh install can be explored. */
const DEMO_NAMES = [
  /^Jane Student$/i,
  /^John Student$/i,
  /^Martha Teachwell$/i,
  /^Sam Supervisor$/i,
  /^Olive Worker$/i,
  /^Grace Graduate$/i,
  /^Greenfield Admin$/i,
  /^Horizon Admin$/i,
  /^Family Admin$/i,
  /^Married Admin$/i
];
const DEMO_TENANT_IDS = ['ten_greenfield', 'ten_horizon', 'ten_beloved', 'ten_covenant'];

function matches(list, value) {
  const s = String(value || '').trim();
  if (!s) return false;
  return list.some(function (re) { return re.test(s); });
}

/* --------------------------------------------------------------- load ----- */
if (!fs.existsSync(DB_FILE)) {
  console.error('[clean] No database at ' + DB_FILE);
  process.exit(1);
}
const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const users = Array.isArray(db.users) ? db.users : [];

/* Who is going, and why. */
const doomed = [];
const kept = [];
users.forEach(function (u) {
  const reason = matches(TEST_NAMES, u.fullName) ? 'automated test'
    : matches(TEST_EMAILS, u.email) ? 'automated test'
      : (withDemo && matches(DEMO_NAMES, u.fullName)) ? 'demo account'
        : null;
  if (reason) doomed.push({ user: u, reason: reason });
  else kept.push(u);
});

const doomedIds = new Set(doomed.map(function (d) { return d.user.id; }));
const doomedTenantIds = new Set(withDemo
  ? users.filter(function (u) { return DEMO_TENANT_IDS.indexOf(u.tenantId) !== -1; })
    .map(function (u) { return u.tenantId; })
  : []);

console.log('[clean] database : ' + DB_FILE);
console.log('[clean] level    : ' + (withDemo ? 'test residue + demo accounts' : 'test residue only'));
console.log('[clean] users    : ' + users.length + ' total, ' + doomed.length + ' to remove, ' + kept.length + ' kept');
if (doomed.length) {
  const byReason = {};
  doomed.forEach(function (d) { byReason[d.reason] = (byReason[d.reason] || 0) + 1; });
  Object.keys(byReason).forEach(function (k) { console.log('[clean]   ' + k + ': ' + byReason[k]); });
}
if (withDemo && doomedTenantIds.size) {
  console.log('[clean] demo accounts removed: ' + Array.from(doomedTenantIds).join(', '));
}
if (!doomed.length) {
  console.log('[clean] nothing to remove — the database already holds real data only.');
  process.exit(0);
}
if (dryRun) {
  console.log('[clean] --dry-run: nothing was written.');
  doomed.slice(0, 25).forEach(function (d) {
    console.log('[clean]   would remove: ' + (d.user.fullName || '(no name)') + '  [' + d.reason + ']');
  });
  if (doomed.length > 25) console.log('[clean]   … and ' + (doomed.length - 25) + ' more');
  process.exit(0);
}

/* -------------------------------------------------------------- backup ---- */
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(path.dirname(DB_FILE), 'db.backup-' + stamp + '.json');
fs.writeFileSync(backup, JSON.stringify(db, null, 2), 'utf8');
console.log('[clean] backup    : ' + backup);

/* ------------------------------------------------------------- separate --- */
users.forEach(function (u) { if (doomedIds.has(u.id)) u.__remove = true; });
db.users = users.filter(function (u) { return !u.__remove; });

/* A user may own records under several field names across the collections. */
function ownedBy(rec) {
  const ids = ['userId', 'senderId', 'fromUserId', 'toUserId', 'studentId',
    'learnerId', 'actorId', 'supervisorId'];
  for (let i = 0; i < ids.length; i++) {
    if (rec[ids[i]] && doomedIds.has(rec[ids[i]])) return true;
  }
  if (Array.isArray(rec.participantIds) &&
    rec.participantIds.some(function (id) { return doomedIds.has(id); })) return true;
  return false;
}

const COLLECTIONS = ['sessions', 'submissions', 'certificates', 'thoughts', 'notifications',
  'messages', 'conversations', 'book_opens', 'chapter_reads', 'video_alerts',
  'activity_log', 'assessment', 'video_alert_plan', 'liveLessons'];

const removed = {};
COLLECTIONS.forEach(function (name) {
  if (!Array.isArray(db[name])) return;
  const before = db[name].length;
  db[name] = db[name].filter(function (rec) {
    if (!rec || typeof rec !== 'object') return true;
    if (ownedBy(rec)) return false;
    if (withDemo && rec.tenantId && doomedTenantIds.has(rec.tenantId)) return false;
    return true;
  });
  const gone = before - db[name].length;
  if (gone) removed[name] = gone;
});

/* The demo accounts themselves (only with --demo). */
if (withDemo && doomedTenantIds.size) {
  const before = (db.tenants || []).length;
  db.tenants = (db.tenants || []).filter(function (t) { return !doomedTenantIds.has(t.id); });
  const gone = before - db.tenants.length;
  if (gone) removed.tenants = gone;
}

/* ---------------------------------------------------------------- write --- */
fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');

console.log('[clean] removed users: ' + doomed.length);
Object.keys(removed).forEach(function (k) {
  console.log('[clean] removed ' + k + ': ' + removed[k]);
});
console.log('[clean] remaining users: ' + db.users.length);
console.log('[clean] done. To undo, copy the backup over data/db.json.');
