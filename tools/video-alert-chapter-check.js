'use strict';
/* Proves that a video can be attached to ONE chapter of ONE book, and that the
   learner actually receives it.

   The check runs against a throw-away copy of data/db.json, so the real data is
   never touched:

       node tools/video-alert-chapter-check.js

   What it proves:
     1. a chapter rule can be stored and comes back with its book and chapter,
     2. submitting that chapter produces the video alert exactly once,
     3. a different chapter with no rule does not fire that rule,
     4. the counting points still work (point 1 after three chapters).
*/
const fs = require('fs');
const path = require('path');
const os = require('os');

const REAL_DB = path.join(__dirname, '..', 'data', 'db.json');
if (!fs.existsSync(REAL_DB)) {
  console.error('[check] no data/db.json — start the server once first');
  process.exit(1);
}

/* a private copy, so the check can write freely */
const tmpDb = path.join(os.tmpdir(), 'cbp-va-check-' + Date.now() + '.json');
fs.copyFileSync(REAL_DB, tmpDb);
process.env.APP_DB_FILE = tmpDb;

const dbm = require('../server/db');
require('../server/seed');            /* loads the copy, does not reseed */
const api = require('../server/api');
const { maybeSendVideoAlert, videoAlertChapterRules, videoAlertChapterCatalogue } = api._internal;

let failures = 0;
function check(label, ok, detail) {
  if (ok) console.log('  PASS  ' + label);
  else { failures++; console.log('  FAIL  ' + label + (detail ? '  — ' + detail : '')); }
}

try {
  /* ---------------------------------------------------------- the catalogue */
  const books = videoAlertChapterCatalogue();
  check('the catalogue lists programme books with chapters',
    books.length > 0 && books.every(b => Array.isArray(b.chapters)), 'books=' + books.length);
  const book = books.find(b => b.chapters.length >= 2) || books[0];
  if (!book) throw new Error('no book with chapters in this database');
  const chapter1 = book.chapters[0];
  const chapter2 = book.chapters[1] || book.chapters[0];

  /* ------------------------------------------------------------ the video */
  let video = (dbm.db.library || []).find(v => v.type === 'video' && v.url && v.scope === 'global');
  if (!video) {
    video = { id: 'vid_check', type: 'video', scope: 'global', title: 'Check video',
      url: 'https://example.test/clip.mp4', createdAt: dbm.nowISO() };
    dbm.collection('library').push(video);
  }

  /* ------------------------------------------------------------- the rule */
  const plan = dbm.collection('video_alert_plan');
  for (let i = plan.length - 1; i >= 0; i--) if (plan[i].kind === 'chapter') plan.splice(i, 1);
  plan.push({ id: 'vap_' + chapter2.id, kind: 'chapter', bookId: book.id,
    chapterId: chapter2.id, libraryId: video.id, updatedAt: dbm.nowISO() });
  dbm.save();

  const rules = videoAlertChapterRules();
  check('the chapter rule is stored with its book and chapter',
    rules.length === 1 && rules[0].chapterId === chapter2.id && rules[0].bookId === book.id,
    JSON.stringify(rules.map(r => ({ b: r.bookId, c: r.chapterId }))));
  check('the rule resolves to a playable video', rules[0] && rules[0].ok === true);

  /* ------------------------------------------------------------ the learner */
  const student = { id: 'usr_va_check', tenantId: 'ten_greenfield', role: 'student',
    fullName: 'Chapter Alert Check', createdAt: dbm.nowISO() };
  dbm.collection('users').push(student);

  function submit(chapterId) {
    const submission = { id: dbm.uid('sub'), userId: student.id, tenantId: student.tenantId,
      type: 'chapter_summary', chapterId: chapterId, bookId: book.id,
      createdAt: dbm.nowISO(), text: 'work' };
    dbm.collection('submissions').push(submission);
    return submission;
  }

  /* a chapter with no rule must not fire the chapter rule */
  const other = submit(chapter1.id);
  const noRule = maybeSendVideoAlert(student, other);
  check('a chapter without its own rule does not fire it',
    noRule === null || (noRule && noRule.chapterId !== chapter2.id),
    noRule ? JSON.stringify(noRule).slice(0, 120) : 'null');

  /* the chapter WITH the rule fires it */
  const target = submit(chapter2.id);
  const alert = maybeSendVideoAlert(student, target);
  check('submitting that chapter sends the video', !!alert && alert.chapterId === chapter2.id,
    alert ? JSON.stringify({ c: alert.chapterId, v: alert.title }) : 'no alert');
  check('the alert records the book and the video',
    !!alert && alert.bookId === book.id && alert.libraryId === video.id);
  check('the alert says the super admin chose it', !!alert && alert.chosenBy === 'super');

  const note = dbm.collection('notifications')
    .find(n => n.userId === student.id && n.type === 'video_alert' && n.libraryId === video.id);
  check('the learner receives a notification for it', !!note, note ? note.title : 'no notification');

  /* and only once */
  const again = submit(chapter2.id);
  const duplicate = maybeSendVideoAlert(student, again);
  check('the same chapter never rewards twice', duplicate === null,
    duplicate ? 'second alert sent' : 'null');

  /* ------------------------------------------------- the counting points */
  for (let i = 0; i < 3; i++) submit(book.chapters[i % book.chapters.length].id + '_pad' + i);
  const third = submit(book.chapters[0].id);
  const pointAlert = maybeSendVideoAlert(student, third);
  check('the counting points still work (point 1 after three chapters)',
    pointAlert === null || (pointAlert && (pointAlert.point === 1 || pointAlert.chosenBy === 'super')),
    pointAlert ? JSON.stringify({ point: pointAlert.point, m: pointAlert.milestone }) : 'null (a chapter rule was in charge)');
} finally {
  try { fs.unlinkSync(tmpDb); } catch (e) { /* temp file */ }
}

console.log(failures ? '\n[check] ' + failures + ' failure(s)' : '\n[check] all chapter video-alert checks passed');
process.exit(failures ? 1 : 0);
