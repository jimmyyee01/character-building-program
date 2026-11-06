'use strict';
/* System log and Trash.
   ------------------------------------------------------------------
   Two promises live here:
     1. WHAT EVERYBODY DID, AND WHEN. Every change made through the API -
        a book written, a chapter edited, a learner added, a sign-in, a
        sign-out, a deletion - is recorded in the `activity_log` collection
        with the person, their role, their account, the time and the item.
        The super admin reads it on the "System log" screen.
     2. NOTHING IS GONE BY DEFAULT. A deletion moves the record (and the
        chapters/questions that hang off it) into `trash` instead of
        throwing it away. An admin can put it back, or delete it for good.

   The log is written by logRequest(), which the router calls once for every
   request that changed something; a handler that knows better can describe
   its own entry by returning `activity` in its result. */

const dbm = require('./db');

const LOG_CAP = 20000;      /* entries kept; the oldest fall off the end */
const TRASH_CAP = 5000;     /* deleted items kept */

/* An error the router answers with its own status (400, 404, 409 ...). */
function fail(message, status) {
  const err = new Error(message);
  err.status = status || 400;
  throw err;
}

function clip(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

function actorName(user) {
  if (!user) return 'Unknown';
  return clip(user.fullName || user.email || user.studentNumber || user.username || user.role, 80);
}

function tenantNameOf(id) {
  const tenant = id ? dbm.byId('tenants', id) : null;
  return tenant ? tenant.name : null;
}

/* Who was at the machine? Behind a proxy the first X-Forwarded-For wins. */
function ipOf(req) {
  if (!req) return null;
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  const first = forwarded ? String(forwarded).split(',')[0].trim() : '';
  return clip(first || (req.socket && req.socket.remoteAddress) || '', 60) || null;
}


/* --------------------------------------------------------------- shapes --- */
/* Which kind of thing a route touches, and where a readable name lives.
   The specific routes come first: /api/books/1/chapters makes a CHAPTER. */
const SHAPES = [
  { re: /^\/api\/upload$/, entity: 'file', label: b => b.file && b.file.name },
  { re: /^\/api\/auth\/(?:login|super-login)$/, entity: 'session', label: b => b.identifier || b.username },
  { re: /^\/api\/auth\/logout$/, entity: 'session', label: () => '' },
  { re: /^\/api\/auth\/register$/, entity: 'session', label: b => b.email || b.identifier },
  { re: /^\/api\/tenant\/settings$/, entity: 'settings', label: () => 'Account letter' },
  { re: /^\/api\/flow\/letter-feedback$/, entity: 'letter', label: () => 'Answer to the letter' },
  { re: /^\/api\/flow\/optional-video-seen$/, entity: 'video', label: () => 'Optional video' },
  { re: /^\/api\/assessment\/(?:pre|post)$/, entity: 'assessment', label: b => b.kind || b.type || 'Self-assessment' },
  { re: /^\/api\/super\/assessment\/categories\/[^/]+\/statements$/, entity: 'assessment-statement', label: b => b.text },
  { re: /^\/api\/super\/assessment\/categories/, entity: 'assessment-category', label: b => b.title },
  { re: /^\/api\/super\/assessment\/statements/, entity: 'assessment-statement', label: b => b.text },
  { re: /^\/api\/super\/assessment$/, entity: 'assessment', label: () => 'Self-assessment' },
  { re: /^\/api\/chapter\/[^/]+\/read$/, entity: 'reading', label: () => 'Chapter pages' },
  { re: /^\/api\/reading\/open$/, entity: 'reading', label: b => b.title || b.kind },
  { re: /^\/api\/submissions$/, entity: 'submission', label: b => b.type },
  { re: /^\/api\/certificates\/issue$/, entity: 'certificate', label: () => 'Certificate' },
  { re: /^\/api\/videos\/[^/]+\/watched$/, entity: 'video', label: () => 'Library video' },
  { re: /^\/api\/thoughts$/, entity: 'thought', label: b => b.text },
  { re: /^\/api\/super\/portals/, entity: 'portal', label: b => b.name },
  { re: /^\/api\/super\/tenants/, entity: 'tenant', label: b => b.name },
  { re: /^\/api\/super\/modules/, entity: 'module', label: b => b.title },
  { re: /^\/api\/super\/settings$/, entity: 'settings', label: () => 'Global settings' },
  { re: /^\/api\/super\/video-alerts$/, entity: 'video-alert', label: () => 'Video alert points' },
  { re: /^\/api\/super\/trash/, entity: 'trash', label: () => '' },
  { re: /^\/api\/super\/users/, entity: 'user', label: b => b.fullName },
  { re: /^\/api\/books\/[^/]+\/chapters$/, entity: 'chapter', label: b => b.title },
  { re: /^\/api\/books/, entity: 'book', label: b => b.title },
  { re: /^\/api\/chapters\/[^/]+\/objectives$/, entity: 'objective', label: b => b.question },
  { re: /^\/api\/chapters/, entity: 'chapter', label: b => b.title },
  { re: /^\/api\/objectives/, entity: 'objective', label: b => b.question },
  { re: /^\/api\/library/, entity: 'library', label: b => b.title },
  { re: /^\/api\/(?:super\/)?users/, entity: 'user', label: b => b.fullName },
  { re: /^\/api\/admin\/branding$/, entity: 'branding', label: () => 'Logo' },
  { re: /^\/api\/messages/, entity: 'message', label: b => b.body || b.text },
  { re: /^\/api\/notifications/, entity: 'notification', label: () => 'Notification' },
  { re: /^\/api\/live-lessons$/, entity: 'live-lesson', label: b => b.title }
];

function shapeOf(path, body) {
  body = body || {};
  for (const shape of SHAPES) {
    if (!shape.re.test(path)) continue;
    let label = '';
    try { label = shape.label(body) || ''; } catch (e) { label = ''; }
    return { entity: shape.entity, label: clip(label, 160) };
  }
  return { entity: 'record', label: '' };
}

/* ----------------------------------------------------------- the log ------ */
function record(entry) {
  entry = entry || {};
  const list = dbm.collection('activity_log');
  const row = {
    id: dbm.uid('log'),
    at: entry.at || dbm.nowISO(),
    action: clip(entry.action || 'updated', 30),
    entity: clip(entry.entity || 'record', 40),
    entityId: entry.entityId ? clip(entry.entityId, 80) : null,
    label: clip(entry.label, 160),
    detail: clip(entry.detail, 300),
    userId: entry.userId || null,
    userName: entry.userName || null,
    role: entry.role || null,
    tenantId: entry.tenantId || null,
    tenantName: entry.tenantName || null,
    ip: entry.ip || null
  };
  list.push(row);
  if (list.length > LOG_CAP) list.splice(0, list.length - LOG_CAP);
  dbm.save();
  return row;
}

/* An update is worth describing by the fields it touched, so the log answers
   "what did they change?" and not only "they changed something". */
function fieldNames(body) {
  const skip = ['password', 'newPassword', 'base64', 'file', 'photo', 'logo', 'programLogo'];
  const keys = Object.keys(body || {}).filter(k => skip.indexOf(k) === -1);
  return keys.length ? keys.slice(0, 8).join(', ') + (keys.length > 8 ? ' and more' : '') : '';
}

/* A creation has no id in the URL, so it is read from the record the handler
   returns: { ok, book: {...} }, { ok, item: {...} }, ... */
function createdId(out) {
  if (!out || typeof out !== 'object') return null;
  if (out.id) return out.id;
  const likely = ['item', 'book', 'chapter', 'objective', 'user', 'module', 'portal',
    'tenant', 'lesson', 'submission', 'certificate', 'record', 'category', 'statement'];
  for (const key of likely) {
    const value = out[key];
    if (value && typeof value === 'object' && value.id) return value.id;
  }
  for (const key of Object.keys(out)) {
    const value = out[key];
    if (key === 'logEntry' || key === 'deleted') continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && value.id) return value.id;
  }
  return null;
}

/* Called by the router once for every request that changed something.
   Returns the entry it wrote (or null when the request was only a read). */
function logRequest(user, req, method, path, body, out) {
  method = String(method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  if (!path || path === '/api/auth/beat' || path === '/api/health') return null;
  const own = (out && out.logEntry) || {};
  const gone = (out && out.deleted) || {};
  const shape = shapeOf(path, body);
  const actor = own.actor || user || null;
  const action = own.action || (method === 'DELETE' ? 'deleted'
    : method === 'PUT' ? 'updated' : 'created');
  const entity = own.entity || gone.entity || shape.entity;
  let label = own.label || gone.label || shape.label;
  if (!label) label = actorName(actor);
  let detail = own.detail || '';
  if (!detail && method === 'PUT' && body && typeof body === 'object') {
    const names = fieldNames(body);
    if (names) detail = 'Changed: ' + names;
  }
  return record({
    action: action,
    entity: entity,
    entityId: own.entityId || gone.id || createdId(out) || null,
    label: label,
    detail: detail,
    userId: actor ? actor.id : null,
    userName: actor ? actorName(actor) : null,
    role: actor ? actor.role : null,
    tenantId: actor ? (actor.tenantId || null) : (own.tenantId || null),
    tenantName: actor ? tenantNameOf(actor.tenantId) : (own.tenantName || null),
    ip: ipOf(req)
  });
}

/* A date without a time means "the whole of that day". */
function endOfDay(value) {
  const text = String(value || '').trim();
  if (!text) return NaN;
  const parsed = Date.parse(text);
  if (isNaN(parsed)) return NaN;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? parsed + 86399999 : parsed;
}

/* The System log screen: newest first, with a total and per-action counts so
   the badges describe the whole result and not just the page being shown. */
function listLog(filters) {
  filters = filters || {};
  const q = String(filters.q || '').trim().toLowerCase();
  const from = filters.from ? Date.parse(filters.from) : NaN;
  const to = endOfDay(filters.to);
  const matched = dbm.collection('activity_log').filter(row => {
    if (filters.action && row.action !== filters.action) return false;
    if (filters.entity && row.entity !== filters.entity) return false;
    if (filters.role && row.role !== filters.role) return false;
    if (filters.tenantId && row.tenantId !== filters.tenantId) return false;
    if (filters.userId && row.userId !== filters.userId) return false;
    const at = Date.parse(row.at);
    if (!isNaN(from) && at < from) return false;
    if (!isNaN(to) && at > to) return false;
    if (q) {
      const hay = [row.userName, row.role, row.action, row.entity, row.label,
        row.detail, row.tenantName, row.ip].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
  const counts = {};
  matched.forEach(row => { counts[row.action] = (counts[row.action] || 0) + 1; });
  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 1000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const newestFirst = matched.slice().sort((a, b) => (a.at === b.at ? 0 : (a.at < b.at ? 1 : -1)));
  return {
    entries: newestFirst.slice(offset, offset + limit),
    total: matched.length,
    counts: counts,
    limit: limit,
    offset: offset
  };
}

/* --------------------------------------------------------- the trash ----- */
/* `records` is a list of { collection, doc } pairs: the item itself first, then
   whatever belonged to it (a book's chapters and their questions). The copies
   are deep, so a later change to a live record cannot rewrite the past. */
function trash(user, entity, label, records) {
  const clean = (records || []).filter(r => r && r.collection && r.doc).map(r => ({
    collection: r.collection,
    doc: JSON.parse(JSON.stringify(r.doc)),
    kind: r.kind || null,
    categoryId: r.categoryId || null,
    index: typeof r.index === 'number' ? r.index : null
  }));
  const main = clean[0] || null;
  if (!main) return null;
  const entry = {
    id: dbm.uid('trs'),
    at: dbm.nowISO(),
    entity: clip(entity, 40),
    entityId: main.doc.id || null,
    label: clip(label || main.doc.title || main.doc.name || main.doc.full_name ||
      main.doc.question || main.doc.text || main.doc.fullName, 160),
    byId: user ? user.id : null,
    byName: actorName(user),
    byRole: user ? user.role : null,
    tenantId: user ? (user.tenantId || null) : null,
    tenantName: tenantNameOf(user && user.tenantId),
    records: clean,
    restoredAt: null,
    restoredBy: null
  };
  const list = dbm.collection('trash');
  list.push(entry);
  if (list.length > TRASH_CAP) list.splice(0, list.length - TRASH_CAP);
  dbm.save();
  return entry;
}

function trashById(id) {
  return dbm.collection('trash').find(entry => entry.id === id) || null;
}

/* The list says who deleted what and when - never the payloads themselves,
   which may hold photos and whole chapters. */
function listTrash(filters) {
  filters = filters || {};
  const q = String(filters.q || '').trim().toLowerCase();
  const all = dbm.collection('trash').filter(entry => {
    if (filters.entity && entry.entity !== filters.entity) return false;
    if (q) {
      const hay = [entry.label, entry.entity, entry.byName, entry.byRole,
        entry.tenantName, entry.entityId].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
  const counts = {};
  all.forEach(entry => { counts[entry.entity] = (counts[entry.entity] || 0) + 1; });
  const limit = Math.min(Math.max(Number(filters.limit) || 300, 1), 1000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const newestFirst = all.slice().sort((a, b) => (a.at === b.at ? 0 : (a.at < b.at ? 1 : -1)));
  const items = newestFirst.slice(offset, offset + limit).map(entry => ({
    id: entry.id,
    at: entry.at,
    entity: entry.entity,
    entityId: entry.entityId,
    label: entry.label,
    byId: entry.byId,
    byName: entry.byName,
    byRole: entry.byRole,
    tenantId: entry.tenantId,
    tenantName: entry.tenantName,
    size: (entry.records || []).length,
    restoredAt: entry.restoredAt || null
  }));
  return { items: items, total: all.length, counts: counts, limit: limit, offset: offset };
}

/* Putting something back must not create a second copy of a unique name, and it
   must not leave an orphan behind: both are refused with a message that says
   what to do first. `batch` holds the ids that are coming back in the same
   restore, so a book and its chapters do not block each other. */
function guard(collection, doc, batch) {
  const has = (name, id) => !!id && (!!dbm.byId(name, id) || batch.has(id));
  if (dbm.byId(collection, doc.id)) fail('That item is already back in the system', 409);
  if (collection === 'portals') {
    if (dbm.collection('portals').some(p => p.key === doc.key)) {
      fail('Another portal already uses the key "' + doc.key + '" - rename it first', 409);
    }
  } else if (collection === 'tenants') {
    if (dbm.collection('tenants').some(t => t.slug === doc.slug)) {
      fail('Another account already uses the address "' + doc.slug + '" - rename it first', 409);
    }
    if (doc.portalId && !has('portals', doc.portalId)) fail('Put the portal back first', 409);
  } else if (collection === 'users') {
    if (doc.tenantId && !has('tenants', doc.tenantId)) fail('Put the account back first', 409);
    const clash = dbm.collection('users').some(u => u.tenantId === doc.tenantId && (
      (doc.email && u.email && u.email.toLowerCase() === String(doc.email).toLowerCase()) ||
      (doc.studentNumber && u.studentNumber &&
        String(u.studentNumber).toLowerCase() === String(doc.studentNumber).toLowerCase())));
    if (clash) fail('Someone with that email or number is already in the account', 409);
  } else if (collection === 'books') {
    if (doc.moduleId && !has('modules', doc.moduleId)) fail('Put the module back first', 409);
  } else if (collection === 'chapters') {
    if (!has('books', doc.bookId)) fail('Put the book back first', 409);
  } else if (collection === 'objectives') {
    if (!has('chapters', doc.chapterId)) fail('Put the chapter back first', 409);
  }
}

/* Everything that came out together goes back together: a restored book brings
   back its chapters and their questions. */
function restore(entry, user) {
  const records = entry.records || [];
  if (!records.length) fail('That entry has nothing to put back', 409);
  const batch = new Set(records.map(rec => rec.doc && rec.doc.id).filter(Boolean));
  records.forEach(rec => guard(rec.collection, rec.doc || {}, batch));
  let restored = 0;
  records.forEach(rec => {
    if (!rec.doc || !rec.doc.id) return;
    dbm.collection(rec.collection).push(JSON.parse(JSON.stringify(rec.doc)));
    restored++;
  });
  entry.restoredAt = dbm.nowISO();
  entry.restoredBy = user ? user.id : null;
  dbm.save();
  return restored;
}

/* Gone for good: the record left the system when it was deleted, so only the
   copy kept in the trash is dropped. */
function purge(id) {
  const list = dbm.collection('trash');
  const entry = list.find(row => row.id === id);
  if (!entry) return null;
  dbm.db.trash = list.filter(row => row.id !== id);
  dbm.save();
  return entry;
}

function clearTrash() {
  const count = dbm.collection('trash').length;
  dbm.db.trash = [];
  dbm.save();
  return count;
}

module.exports = {
  record: record, logRequest: logRequest, shapeOf: shapeOf, listLog: listLog,
  trash: trash, trashById: trashById, listTrash: listTrash,
  restore: restore, purge: purge, clearTrash: clearTrash,
  actorName: actorName, tenantNameOf: tenantNameOf, ipOf: ipOf, fail: fail,
  LOG_CAP: LOG_CAP, TRASH_CAP: TRASH_CAP
};
