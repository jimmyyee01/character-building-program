'use strict';
/* One-off upgrade for an existing data/db.json:
   - adds the graduation reading-list books
   - gives the demo graduate (STU-100) a 5-required + 10-optional library
   - attaches a video alert to the first book
   Safe to re-run; it never duplicates an id. */
const fs = require('fs');
const path = require('path');
const dbFile = path.join(__dirname, '..', 'data', 'db.json');
if (!fs.existsSync(dbFile)) {
  console.log('[migrate-demo] data/db.json does not exist; run the server first or use npm run fresh.');
  process.exit(0);
}
const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
const lib = db.library || (db.library = []);
const titles = [
  'The Quiet Hour', 'Words That Build', 'The Courage to Begin Again', 'A Table of Kindness',
  'The Steward’s Ledger', 'Listening Well', 'The Habit of Truth', 'Strength Under Control',
  'A Life of Thanks', 'The Long Obedience', 'Peace in the Storm', 'The Generous Hand',
  'Learning to Wait', 'The Whole Heart', 'Character in Ordinary Days'
];
titles.forEach(function (title, i) {
  const id = 'lib_grad_book_' + (i + 1);
  if (!lib.some(function (x) { return x.id === id; })) {
    lib.push({
      id, type: 'book', title, scope: 'global',
      text: 'A graduation library reading book: ' + title + '. Available to a graduated learner as a required or optional selection.',
      url: null, fileName: null, createdAt: new Date().toISOString()
    });
  }
});
const grad = (db.users || []).find(function (u) { return u.studentNumber === 'STU-100'; });
if (grad) {
  grad.graduated = true;
  grad.copyCount = Number(grad.copyCount) || 0;
  grad.library = {
    required: ['lib_grad_book_1', 'lib_grad_book_2', 'lib_grad_book_3', 'lib_grad_book_4', 'lib_grad_book_5'],
    optional: ['lib_grad_book_6', 'lib_grad_book_7', 'lib_grad_book_8', 'lib_grad_book_9', 'lib_grad_book_10',
      'lib_grad_book_11', 'lib_grad_book_12', 'lib_grad_book_13', 'lib_grad_book_14', 'lib_grad_book_15'],
    addedAt: new Date().toISOString(),
    reads: { lib_grad_book_1: 3, lib_grad_book_2: 2, lib_grad_book_6: 4, lib_grad_book_7: 1 }
  };
}
if (db.books && db.books[0] && !db.books[0].videoAlertId) {
  db.books[0].videoAlertId = 'lib_extra_video_1';
}
fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf8');
console.log('[migrate-demo] library books:', lib.length, '· graduate:', grad ? grad.fullName : 'not found');
