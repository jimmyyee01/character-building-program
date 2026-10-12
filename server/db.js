'use strict';
/* Zero-dependency JSON file database.
   All application data lives in data/db.json (git-ignored, auto-seeded on first run). */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let db = null;
let saveTimer = null;

function uid(prefix) {
  return (prefix || 'id') + '_' + crypto.randomBytes(7).toString('hex');
}

function nowISO() {
  return new Date().toISOString();
}

function load() {
  if (db) return db;
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.error('[db] Failed to parse db.json, recreating:', e.message);
      db = null;
    }
  }
  return db;
}

function init(initial) {
  db = initial;
  save(true);
}

function writeNow() {
  if (!db) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

function save(immediate) {
  if (!db) return;
  if (immediate) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    writeNow();
    return;
  }
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; writeNow(); }, 200);
}

function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  writeNow();
}

function collection(name) {
  if (!db[name]) db[name] = [];
  return db[name];
}

function byId(name, id) {
  return collection(name).find(x => x.id === id) || null;
}

function where(name, pred) {
  return collection(name).filter(pred);
}

function insert(name, doc) {
  collection(name).push(doc);
  save();
  return doc;
}

function update(name, id, patch) {
  const doc = byId(name, id);
  if (!doc) return null;
  Object.assign(doc, patch);
  save();
  return doc;
}

function remove(name, id) {
  db[name] = collection(name).filter(x => x.id !== id);
  save();
}

module.exports = {
  get db() { return db; },
  load, init, save, flush, uid, nowISO,
  collection, byId, where, insert, update, remove,
  DATA_DIR, DB_FILE
};
