'use strict';
/* All REST endpoints for the Character Building Program.
   Routes are registered as [METHOD, regex, handler].
   A handler returns a plain object (sent as JSON 200) or writes the response itself. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dbm = require('./db');
const auth = require('./auth');

const UPLOADS = path.join(__dirname, '..', 'uploads');

class HttpError extends Error {
  constructor(message, status) { super(message); this.status = status || 400; }
}
function need(cond, message, status) { if (!cond) throw new HttpError(message, status || 400); }

/* Which build is actually running? Bump this on every release — /api/health
   reports it, so a server that was not updated is easy to spot. */
const BUILD = '2026-10-15-analytics';
const FEATURES = ['health', 'super.analytics', 'admin.analytics', 'reports.students', 'keywords',
  'reader.book', 'library.lock', 'certificates', 'chapter.pages', 'exports'];

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function ordered(list) {
  return list.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}

/* ---------------------------------------------------------- scheduling ---- */
function mdOf(str) {
  const p = String(str || '').split('-');
  return Number(p[0]) * 100 + Number(p[1]);
}

/* A portal is active when it is enabled and "today" falls inside a configured
   window. scheduleMode "windows" with no dates => system inactive (per spec). */
function portalActive(portal, now) {
  if (!portal || portal.enabled === false) return false;
  if (portal.scheduleMode === 'always') return true;
  if (portal.scheduleMode !== 'windows' || !portal.windows || !portal.windows.length) return false;
  now = now || new Date();
  const cur = (now.getMonth() + 1) * 100 + now.getDate();
  return portal.windows.some(w => {
    const from = mdOf(w.from), to = mdOf(w.to);
    if (!from || !to) return false;
    if (from === to) return cur === from;
    if (from < to) return cur >= from && cur <= to;
    return cur >= from || cur <= to; // window wraps the new year (e.g. 10-01 -> 02-01)
  });
}

/* --------------------------------------------------------------- guards --- */
function requireRole(user, roles) {
  need(user, 'Sign in required', 401);
  need(roles.indexOf(user.role) !== -1, 'Not permitted for this account', 403);
  return user;
}
const SUPER = ['super'];
const ADMINS = ['super', 'tenant_admin'];
const PARTICIPANTS = ['student', 'teacher', 'member', 'supervisor'];

function tenantOf(user) {
  return user && user.tenantId ? dbm.byId('tenants', user.tenantId) : null;
}

function canEdit(user, doc) {
  if (user.role === 'super') return true;
  if (user.role === 'tenant_admin') return !!doc && doc.scope === user.tenantId;
  return false;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName,
    email: u.email, studentNumber: u.studentNumber, className: u.className,
    photo: u.photo, supervisorId: u.supervisorId || null,
    supervisorCode: u.supervisorCode || null,
    letterFeedbackAt: u.letterFeedbackAt || null,
    optionalVideoSeen: !!u.optionalVideoSeen,
    suspended: !!u.suspended, createdAt: u.createdAt
  };
}

/* Only a valid #rrggbb colour is stored; anything else clears the theme. */
function hexColor(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null;
}
function tenantBranding(tenant) {
  const settings = dbm.db.settings;
  return {
    tenantName: tenant ? tenant.name : settings.programName,
    tenantLogo: tenant ? tenant.logo : null,
    programLogo: (tenant && tenant.programLogo) || settings.programLogo,
    themeColor: (tenant && tenant.themeColor) || null,
    programName: settings.programName
  };
}

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/* ------------------------------------------------------------ file save --- */
function saveUpload(file) {
  if (!file || !file.base64 || !file.name) return null;
  const cleaned = String(file.name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const id = dbm.uid('upl');
  const name = id + '-' + cleaned;
  fs.mkdirSync(UPLOADS, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS, name), Buffer.from(file.base64, 'base64'));
  return '/uploads/' + name;
}

/* -------------------------------------------------------------- routing --- */
const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, re: new RegExp('^' + pattern + '$'), handler });
}

async function handle(req, res, p, body) {
  const user = auth.currentUser(req);
  const token = auth.tokenFromRequest(req);
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = p.match(r.re);
    if (!m) continue;
    try {
      const out = await r.handler({ req, res, body, user, token, params: m.slice(1) });
      if (out !== undefined && !res.writableEnded) send(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) send(res, e.status, { ok: false, error: e.message });
      else { console.error('[api]', e); send(res, 500, { ok: false, error: e.message || 'Server error' }); }
    }
    return;
  }
  send(res, 404, { ok: false, error: 'Unknown endpoint: ' + req.method + ' ' + p });
}

/* ===================================================== public + auth ===== */
/* Public: which backend and which build is answering (spot a stale deploy). */
route('GET', '/api/health', () => ({
  ok: true, backend: 'node', build: BUILD, features: FEATURES, routes: routes.length,
  node: process.version, time: dbm.nowISO(),
  analytics: FEATURES.indexOf('super.analytics') !== -1
}));

route('GET', '/api/public/portals', () => {
  const settings = dbm.db.settings;
  return {
    ok: true,
    programName: settings.programName,
    programLogo: settings.programLogo,
    superLoginUrl: '/super',
    portals: ordered(dbm.db.portals).map(p => ({
      id: p.id, key: p.key, name: p.name, type: p.type,
      description: p.description || null, scheduleMode: p.scheduleMode,
      windows: p.windows || [], enabled: p.enabled !== false, active: portalActive(p),
      tenants: dbm.db.tenants.filter(t => t.portalId === p.id)
        .map(t => ({ slug: t.slug, name: t.name, logo: t.logo }))
    }))
  };
});

route('GET', '/api/public/tenant/([a-z0-9-]+)', ({ params }) => {
  const tenant = dbm.db.tenants.find(t => t.slug === params[0]);
  need(tenant, 'Portal not found', 404);
  const portal = dbm.byId('portals', tenant.portalId);
  return {
    ok: true,
    tenant: { slug: tenant.slug, name: tenant.name, logo: tenant.logo },
    portal: { name: portal.name, type: portal.type, active: portalActive(portal),
      scheduleMode: portal.scheduleMode, windows: portal.windows || [] },
    branding: tenantBranding(tenant)
  };
});

/* Self-registration is disabled: only admins (and supervisors for members)
   create accounts through POST /api/users (or /api/users/bulk). */
route('POST', '/api/auth/register', () => {
  need(false, 'Self-registration is disabled. Ask your administrator to add you to the system.', 403);
});

route('POST', '/api/auth/login', ({ body, req, res }) => {
  body = body || {};
  const tenant = dbm.db.tenants.find(t => t.slug === body.slug);
  need(tenant, 'Portal not found', 404);
  const portal = dbm.byId('portals', tenant.portalId);
  const identifier = String(body.identifier || '').trim().toLowerCase();
  const user = dbm.db.users.find(u => u.tenantId === tenant.id &&
    ((u.email && u.email.toLowerCase() === identifier) ||
     (u.studentNumber && u.studentNumber.toLowerCase() === identifier)));
  need(user, 'Invalid login details', 401);
  need(auth.verifyPassword(String(body.password || ''), user.salt, user.passwordHash), 'Invalid login details', 401);
  need(!user.suspended, 'This account has been suspended. Contact your administrator.', 403);
  const open = portalActive(portal);
  if (!open && user.role !== 'tenant_admin') {
    throw new HttpError('This portal is closed right now. The programme reopens on the scheduled dates.', 403);
  }
  const token = auth.createSession(req, res, user);
  return { ok: true, token, user: publicUser(user), portalClosed: !open };
});

route('POST', '/api/auth/super-login', ({ body, req, res }) => {
  body = body || {};
  const sa = dbm.db.settings.superAdmin;
  const uname = String(body.username || '').trim();
  need(uname && sa && uname === sa.username, 'Invalid credentials', 401);
  need(auth.verifyPassword(String(body.password || ''), sa.salt, sa.passwordHash), 'Invalid credentials', 401);
  let su = dbm.db.users.find(u => u.role === 'super');
  if (!su) {
    su = { id: dbm.uid('usr'), tenantId: null, role: 'super', fullName: 'Super Administrator',
      email: null, studentNumber: null, className: null, photo: null, username: sa.username,
      salt: sa.salt, passwordHash: sa.passwordHash, createdAt: dbm.nowISO(),
      letterFeedbackAt: dbm.nowISO(), optionalVideoSeen: true, watchedVideos: [], suspended: false };
    dbm.collection('users').push(su);
    dbm.save();
  }
  const token = auth.createSession(req, res, su);
  return { ok: true, token, user: publicUser(su) };
});

route('POST', '/api/auth/logout', ({ req, res }) => {
  auth.destroySession(req, res);
  return { ok: true };
});

route('GET', '/api/me', ({ user }) => {
  need(user, 'Sign in required', 401);
  const tenant = tenantOf(user);
  const portal = tenant ? dbm.byId('portals', tenant.portalId) : null;
  const letter = dbm.byId('library', dbm.db.settings.letterId);
  const video = dbm.byId('library', dbm.db.settings.letterVideoId);
  return {
    ok: true,
    user: publicUser(user),
    branding: tenantBranding(tenant),
    portal: portal ? { name: portal.name, active: portalActive(portal),
      scheduleMode: portal.scheduleMode, windows: portal.windows || [] } : null,
    letter: { title: letter ? letter.title : null, text: letter ? letter.text : null,
      done: !!user.letterFeedbackAt, feedbackAt: user.letterFeedbackAt || null },
    letterVideo: video ? { id: video.id, title: video.title, url: video.url } : null,
    optionalVideoSeen: !!user.optionalVideoSeen
  };
});

/* =================================================== progress engine ===== */
function visibleBooks(tenantId, moduleId) {
  return ordered(dbm.where('books', b =>
    (!moduleId || b.moduleId === moduleId) && (b.scope === 'global' || b.scope === tenantId)));
}
function chaptersOf(bookId, tenantId) {
  return ordered(dbm.where('chapters', c => c.bookId === bookId && (c.scope === 'global' || c.scope === tenantId)));
}
function objectivesOf(chapterId, tenantId) {
  return ordered(dbm.where('objectives', o => o.chapterId === chapterId && (o.scope === 'global' || o.scope === tenantId)));
}
function findSub(userId, type, match) {
  const keys = match ? Object.keys(match) : [];
  return dbm.where('submissions', s => s.userId === userId && s.type === type &&
    keys.every(k => s[k] === match[k]))[0] || null;
}
/* Key-word assessment of a submission: the stored score, or computed from the
   text for submissions made before the key-word feature existed. */
function assessOf(s) {
  if (!s) return null;
  if (s.keywordScore != null) {
    return { keywordScore: s.keywordScore, keywordsUsed: s.keywordsUsed == null ? null : s.keywordsUsed,
      keywordsTotal: s.keywordsTotal == null ? null : s.keywordsTotal, keywordsMissing: s.keywordsMissing || [] };
  }
  if (!s.text) return null;
  let list = null;
  if (s.chapterId) {
    const ch = dbm.byId('chapters', s.chapterId);
    if (ch) list = chapterKeywords(ch).list;
  } else if (s.bookId) {
    list = suggestKeywords(dbm.where('chapters', c => c.bookId === s.bookId).map(c => c.content).join(' '), 10);
  }
  if (!list || !list.length) return null;
  const a = keywordAssessment(s.text, list);
  return { keywordScore: a.keywordScore, keywordsUsed: a.keywordsUsed,
    keywordsTotal: a.keywordsTotal, keywordsMissing: a.keywordsMissing };
}

function subMeta(s) {
  const kw = assessOf(s);
  return s ? { id: s.id, createdAt: s.createdAt, score: s.score, flagged: !!s.flagged,
    similarity: s.similarity || 0, color: s.color || null, text: s.text || null,
    bookId: s.bookId || null, chapterId: s.chapterId || null,
    moduleId: s.moduleId || null, index: s.index || null,
    keywordScore: kw ? kw.keywordScore : null,
    keywordsUsed: kw ? kw.keywordsUsed : null,
    keywordsTotal: kw ? kw.keywordsTotal : null,
    keywordsMissing: kw ? kw.keywordsMissing : [] } : null;
}

/* One book inside a module: chapter gating, letter stage, colour summaries. */
function bookProgress(user, module, book) {
  const tenantId = user.tenantId;
  const chapters = chaptersOf(book.id, tenantId);
  let prevDone = true;
  const states = chapters.map(ch => {
    const type = module.mode === 'summary' ? 'chapter_summary' : 'objectives';
    const sub = findSub(user.id, type, { chapterId: ch.id });
    const unlocked = prevDone;
    const kwords = chapterKeywords(ch);
    const state = {
      id: ch.id, title: ch.title, content: ch.content,
      pageStart: ch.pageStart, pageEnd: ch.pageEnd, order: ch.order,
      objectiveCount: objectivesOf(ch.id, tenantId).length,
      keywords: kwords.list, keywordsSource: kwords.source,
      submission: subMeta(sub),
      status: sub ? 'done' : (unlocked ? 'active' : 'locked')
    };
    prevDone = !!sub;
    return state;
  });

  const allDone = chapters.length > 0 && states.every(s => s.submission);
  let stage = 'chapters';
  let summaries = [];
  let letter = null;
  let letterSubmission = null;

  if (allDone) {
    if (module.mode === 'summary') {
      const lsub = findSub(user.id, 'letter_summary', { bookId: book.id });
      letterSubmission = subMeta(lsub);
      const lib = dbm.byId('library', book.letterId);
      letter = lib ? { id: lib.id, title: lib.title, text: lib.text } : null;
      if (!letter) stage = 'complete';           // no letter configured -> book finished
      else stage = lsub ? 'complete' : 'letter';
    } else {
      const prompts = module.summaryPrompts || [];
      if (!prompts.length) stage = 'complete';
      else {
        let next = -1;
        summaries = prompts.map((p, i) => {
          const sub = findSub(user.id, 'book_summary', { bookId: book.id, index: i + 1 });
          if (!sub && next === -1) next = i;
          return { index: i + 1, label: p.label, color: p.color,
            submission: subMeta(sub),
            status: sub ? 'done' : (i === next ? 'active' : 'locked') };
        });
        stage = next === -1 ? 'complete' : 'summaries';
      }
    }
  }

  return {
    book: { id: book.id, title: book.title, order: book.order, moduleId: book.moduleId,
      libraryId: book.libraryId || null, letterId: book.letterId || null },
    chapters: states, stage, summaries, letter, letterSubmission,
    complete: stage === 'complete'
  };
}

function moduleProgress(user, module) {
  const books = visibleBooks(user.tenantId, module.id);
  const states = books.map(b => bookProgress(user, module, b));
  const allBooks = books.length > 0 && states.every(s => s.complete);
  const cert = dbm.where('certificates', c => c.userId === user.id && c.moduleId === module.id)[0] || null;
  const bestPick = findSub(user.id, 'best_book', { moduleId: module.id });

  let stage = 'work';
  if (cert) stage = 'certified';
  else if (bestPick) stage = 'video';
  else if (allBooks) stage = 'best_book';

  let total = 2; // best book pick + certificate
  let done = 0;
  states.forEach(s => {
    s.chapters.forEach(c => { total++; if (c.submission) done++; });
    if (module.mode === 'summary') { total++; if (s.letterSubmission) done++; }
    else { s.summaries.forEach(x => { total++; if (x.submission) done++; }); }
  });
  if (bestPick) done++;
  if (cert) done++;

  const objSubs = dbm.where('submissions', s => s.userId === user.id && s.type === 'objectives' &&
    states.some(st => st.chapters.some(c => c.id === s.chapterId)));
  let objScore = 0, objTotal = 0;
  objSubs.forEach(s => { objScore += (s.score || 0); objTotal += (s.total || 0); });

  return {
    module: { id: module.id, order: module.order, title: module.title, mode: module.mode,
      certificateName: module.certificateName, summaryPrompts: module.summaryPrompts || [],
      completionVideoId: module.completionVideoId || null },
    books: states, stage, bestPick: subMeta(bestPick), certificate: cert || null,
    percent: total ? Math.round(100 * done / total) : 0,
    objectiveScore: objTotal ? Math.round(100 * objScore / objTotal) : null
  };
}

/* Has this learner finished every module? (books unlock only then.) */
function allModulesComplete(user) {
  const st = moduleStatuses(user);
  return st.length > 0 && st.every(s => s.status === 'completed');
}

function moduleStatuses(user) {
  const modules = ordered(dbm.db.modules);
  let prevOk = true;
  return modules.map(m => {
    const p = moduleProgress(user, m);
    let status;
    if (p.stage === 'certified') status = 'completed';
    else if (prevOk) status = 'active';
    else { status = 'locked'; }
    if (p.stage !== 'certified') prevOk = false;
    return { id: m.id, order: m.order, title: m.title, mode: m.mode,
      certificateName: m.certificateName, completionVideoId: m.completionVideoId || null,
      status, progress: p };
  });
}

/* ============================================= copy detection / scores === */
function normalizeWords(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(w => w.length > 2);
}
function jaccard(aSet, bSet) {
  let inter = 0;
  aSet.forEach(w => { if (bSet.has(w)) inter++; });
  const uni = aSet.size + bSet.size - inter;
  return uni ? inter / uni : 0;
}
/* ============================================== key words from a chapter == */
/* Module 1 (and any summary-mode module) is answered by typing, so each chapter
   carries key words taken from its own text. A learner's summary is assessed on
   how many of those key words it uses — the list can be curated by an admin, or
   is derived automatically from the chapter text. */
const KEYWORD_STOP = new Set(('the and for are but not you all any can had her was one our out day get has him his how man new now old see two way who boy did its let put say she too use that this these those from with have your will they them their there here when where which while what why how about into over after before under above again further once during shall should would could must might been being does doing done having been très para como que los las del una por con mas pero sus esta este esto que son para con sin sobre entre cuando donde porque tambien solo cada otro otra todos todas').split(/\s+/));

/* most telling words of a chapter: frequent, long enough, not a stop word */
function suggestKeywords(text, max) {
  const counts = {};
  normalizeWords(text || '').forEach(function (w) {
    if (w.length < 4 || KEYWORD_STOP.has(w)) return;
    counts[w] = (counts[w] || 0) + 1;
  });
  return Object.keys(counts).sort(function (a, b) {
    return counts[b] - counts[a] || b.length - a.length || a.localeCompare(b);
  }).slice(0, max || 8);
}
/* accepts an array or a comma / line separated string, cleans and de-dupes */
function cleanKeywords(input) {
  let list = [];
  if (Array.isArray(input)) list = input;
  else if (typeof input === 'string') list = input.split(/[,;\n\r]+/);
  const seen = new Set(), out = [];
  list.forEach(function (k) {
    const v = String(k).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (!v || v.length < 3 || v.length > 40 || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out.slice(0, 20);
}
/* the key words used for assessment: the curated list, else auto-derived */
function chapterKeywords(ch) {
  const own = cleanKeywords(ch && ch.keywords);
  if (own.length) return { list: own, source: 'set' };
  const auto = suggestKeywords(ch && ch.content, 8);
  return { list: auto, source: auto.length ? 'auto' : 'none' };
}
function matchKeyWord(token, key) {
  if (!token || !key) return false;
  if (token === key) return true;
  if (token.length >= 5 && key.length >= 5 &&
      (token.indexOf(key) === 0 || key.indexOf(token) === 0)) return true;
  if (token.length >= 5 && key.length >= 5 && token.indexOf(key) !== -1) return true;
  return false;
}
/* how much of the chapter's key-word list a typed answer covers */
function keywordAssessment(text, keywords) {
  const list = (keywords || []).filter(Boolean);
  const words = normalizeWords(text || '');
  const flat = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const covered = [], missing = [];
  list.forEach(function (k) {
    const parts = String(k).split(' ').filter(Boolean);
    const hit = parts.length > 1
      ? flat.indexOf(' ' + k + ' ') !== -1
      : words.some(function (w) { return matchKeyWord(w, parts[0]); });
    (hit ? covered : missing).push(k);
  });
  return { keywordsTotal: list.length, keywordsUsed: covered.length,
    keywordScore: list.length ? Math.round(100 * covered.length / list.length) : null,
    keywordsCovered: covered, keywordsMissing: missing.slice(0, 8) };
}

/* Compares a typed submission with every other user's submission for the same
   target (same chapter / same summary). >= 75% word overlap is flagged. */
function assessCopy(user, type, match, text) {
  const words = new Set(normalizeWords(text));
  if (words.size < 10) return { similarity: 0, flagged: false };
  const keys = match ? Object.keys(match) : [];
  let best = 0;
  dbm.where('submissions', s => s.type === type && s.userId !== user.id && s.text &&
    keys.every(k => s[k] === match[k])).forEach(s => {
      const sim = jaccard(words, new Set(normalizeWords(s.text)));
      if (sim > best) best = sim;
    });
  return { similarity: Math.round(best * 100), flagged: best >= 0.75 };
}

function performance(user) {
  const statuses = moduleStatuses(user);
  const overall = statuses.length
    ? Math.round(statuses.reduce((a, m) => a + m.progress.percent, 0) / statuses.length) : 0;
  return {
    overall,
    flagged: dbm.where('submissions', s => s.userId === user.id && s.flagged).length,
    certificates: dbm.where('certificates', c => c.userId === user.id).length,
    modules: statuses.map(s => ({ id: s.id, title: s.title, status: s.status,
      percent: s.progress.percent, objectiveScore: s.progress.objectiveScore }))
  };
}

/* Deterministic shuffle that changes on every login (seeded by user+session+day). */
function shuffleWithSeed(arr, seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const j = (h >>> 0) % (i + 1);
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}
function shuffledForLogin(user, token, list) {
  const day = new Date().toISOString().slice(0, 10);
  return shuffleWithSeed(list, user.id + '|' + (token || '') + '|' + day);
}

function flowFor(user) {
  const tenant = tenantOf(user);
  const portal = tenant ? dbm.byId('portals', tenant.portalId) : null;
  const modules = moduleStatuses(user);
  const current = modules.find(m => m.status === 'active') || null;
  const allDone = modules.length > 0 && modules.every(m => m.status === 'completed');
  return {
    showLetter: !user.letterFeedbackAt,
    letterDone: !!user.letterFeedbackAt,
    optionalVideoSeen: !!user.optionalVideoSeen,
    portalClosed: portal ? !portalActive(portal) : false,
    currentModuleId: current ? current.id : null,
    allDone,
    performance: performance(user),
    modules: modules.map(m => ({ id: m.id, order: m.order, title: m.title, mode: m.mode,
      certificateName: m.certificateName, status: m.status,
      percent: m.progress.percent, stage: m.progress.stage }))
  };
}

/* ============================================ participant experience ===== */
route('GET', '/api/flow', ({ user }) => {
  requireRole(user, PARTICIPANTS.concat(ADMINS));
  return Object.assign({ ok: true }, flowFor(user));
});

route('POST', '/api/flow/letter-feedback', ({ user, body }) => {
  requireRole(user, PARTICIPANTS);
  body = body || {};
  const text = String(body.feedback || '').trim();
  need(text.length >= 20, 'Please write your feedback (at least 20 characters) before continuing');
  need(!user.letterFeedbackAt, 'Feedback already submitted');
  user.letterFeedbackAt = dbm.nowISO();
  user.letterFeedback = text;
  dbm.save();
  return { ok: true, feedbackAt: user.letterFeedbackAt };
});

route('POST', '/api/flow/optional-video-seen', ({ user }) => {
  requireRole(user, PARTICIPANTS);
  user.optionalVideoSeen = true;
  dbm.save();
  return { ok: true };
});

route('GET', '/api/modules', ({ user }) => {
  requireRole(user, PARTICIPANTS.concat(ADMINS));
  return { ok: true, modules: moduleStatuses(user), performance: performance(user), allDone: flowFor(user).allDone };
});

route('GET', '/api/module/([a-z0-9_-]+)', ({ user, params }) => {
  requireRole(user, PARTICIPANTS);
  const module = dbm.byId('modules', params[0]);
  need(module, 'Module not found', 404);
  const st = moduleStatuses(user).find(m => m.id === module.id);
  need(st, 'Module not found', 404);
  return { ok: true, status: st.status, progress: st.progress };
});

/* Book detail: stages, chapter gating, letter and colour summaries. */
route('GET', '/api/book/([a-z0-9_-]+)', ({ user, params }) => {
  requireRole(user, PARTICIPANTS);
  const book = dbm.byId('books', params[0]);
  need(book, 'Book not found', 404);
  need(book.scope === 'global' || book.scope === user.tenantId, 'Not available', 403);
  const module = dbm.byId('modules', book.moduleId);
  const st = moduleStatuses(user).find(m => m.id === module.id);
  need(st, 'Module not found', 404);
  const progress = bookProgress(user, module, book);
  const lib = book.libraryId ? dbm.byId('library', book.libraryId) : null;
  return { ok: true, moduleStatus: st.status, pdfUnlocked: allModulesComplete(user),
    module: { id: module.id, mode: module.mode, title: module.title },
    book: Object.assign({}, progress.book, { pdf: lib && lib.type === 'book' ? (lib.url || null) : null,
      pdfTitle: lib ? lib.title : null }),
    chapters: progress.chapters, stage: progress.stage, summaries: progress.summaries,
    letter: progress.letter, letterSubmission: progress.letterSubmission };
});

/* Objectives for a chapter, shuffled for this login (answers hidden until submitted). */
route('GET', '/api/chapter/([a-z0-9_-]+)/objectives', ({ user, token, params }) => {
  requireRole(user, PARTICIPANTS);
  const chapter = dbm.byId('chapters', params[0]);
  need(chapter, 'Chapter not found', 404);
  const book = dbm.byId('books', chapter.bookId);
  need(book.scope === 'global' || book.scope === user.tenantId, 'Not available', 403);
  const module = dbm.byId('modules', book.moduleId);
  const objs = objectivesOf(chapter.id, user.tenantId);
  const done = findSub(user.id, 'objectives', { chapterId: chapter.id });

  if (done) {
    const answers = done.answers || [];
    return { ok: true, submitted: true, submission: subMeta(done),
      objectives: objs.map(o => {
        const a = answers.find(x => x.objectiveId === o.id);
        return { id: o.id, question: o.question, options: o.options,
          yourChoice: a ? a.choice : null, correct: a ? !!a.correct : null,
          answerIndex: o.answerIndex };
      }) };
  }
  const shuffled = shuffledForLogin(user, token, objs);
  return { ok: true, submitted: false,
    objectives: shuffled.map(o => ({ id: o.id, question: o.question, options: shuffleWithSeed(o.options, o.id + token) })) };
});

/* ------------------------------------------------------- submissions ----- */
route('POST', '/api/submissions', ({ user, body }) => {
  requireRole(user, PARTICIPANTS);
  body = body || {};
  const type = String(body.type || '');
  const now = dbm.nowISO();
  const tenantId = user.tenantId;
  const text = body.text != null ? String(body.text).trim() : '';
  let sub = null;
  let warning = null;
  let assessment = null;

  /* typed answers are measured against the chapter's key words */
  function keywordsFor(base) {
    if (!text) return null;
    let list = null;
    if (base.chapterId) {
      const ch = dbm.byId('chapters', base.chapterId);
      if (ch) list = chapterKeywords(ch).list;
    } else if (base.bookId) {
      const chs = dbm.where('chapters', c => c.bookId === base.bookId);
      list = suggestKeywords(chs.map(c => c.content).join(' '), 10);
    } else if (base.type === 'general_summary') {
      list = suggestKeywords(dbm.db.chapters.map(c => c.content).join(' '), 12);
    }
    if (!list || !list.length) return null;
    return keywordAssessment(text, list);
  }

  function store(base, matchForCopy) {
    let copy = { similarity: 0, flagged: false };
    if (text) copy = assessCopy(user, base.type, matchForCopy || {}, text);
    sub = Object.assign({
      id: dbm.uid('sub'), userId: user.id, tenantId, createdAt: now,
      flagged: copy.flagged, similarity: copy.similarity, text: text || null
    }, base);
    const kw = keywordsFor(base);
    if (kw) {
      assessment = kw;
      sub.keywordScore = kw.keywordScore;
      sub.keywordsUsed = kw.keywordsUsed;
      sub.keywordsTotal = kw.keywordsTotal;
      sub.keywordsCovered = kw.keywordsCovered;
      sub.keywordsMissing = kw.keywordsMissing;
    }
    dbm.collection('submissions').push(sub);
    dbm.save();
    if (copy.flagged) warning = 'Copy assessment: your work matches another submission by ' + copy.similarity + '%.';
  }
  function requireText() {
    need(text.length >= 30, 'Please type at least 30 characters in your own words (copy and paste is not allowed).');
  }
  function activeModule(mod) {
    const st = moduleStatuses(user).find(m => m.id === mod.id);
    need(st && st.status === 'active', 'This module is not active for you right now', 403);
    return st;
  }
  function chapterGates(book, chapter) {
    const list = chaptersOf(book.id, tenantId);
    const idx = list.findIndex(c => c.id === chapter.id);
    need(idx !== -1, 'Chapter does not belong to this book');
    const doneType = dbm.byId('modules', book.moduleId).mode === 'summary' ? 'chapter_summary' : 'objectives';
    for (let i = 0; i < idx; i++) {
      need(findSub(user.id, doneType, { chapterId: list[i].id }),
        'Submit the previous chapter before opening this one', 403);
    }
  }

  if (type === 'chapter_summary') {
    const chapter = dbm.byId('chapters', body.chapterId);
    need(chapter, 'Chapter not found', 404);
    const book = dbm.byId('books', chapter.bookId);
    need(book && (book.scope === 'global' || book.scope === tenantId), 'Not available', 403);
    const mod = dbm.byId('modules', book.moduleId);
    need(mod.mode === 'summary', 'This module uses objectives, not typed chapter summaries', 403);
    activeModule(mod);
    chapterGates(book, chapter);
    need(!findSub(user.id, 'chapter_summary', { chapterId: chapter.id }), 'You already submitted this chapter');
    requireText();
    store({ type, chapterId: chapter.id, bookId: book.id, moduleId: mod.id }, { chapterId: chapter.id });

  } else if (type === 'objectives') {
    const chapter = dbm.byId('chapters', body.chapterId);
    need(chapter, 'Chapter not found', 404);
    const book = dbm.byId('books', chapter.bookId);
    need(book && (book.scope === 'global' || book.scope === tenantId), 'Not available', 403);
    const mod = dbm.byId('modules', book.moduleId);
    need(mod.mode === 'objectives', 'This module uses typed summaries, not objectives', 403);
    activeModule(mod);
    chapterGates(book, chapter);
    need(!findSub(user.id, 'objectives', { chapterId: chapter.id }), 'You already submitted this chapter');
    const objs = objectivesOf(chapter.id, tenantId);
    need(objs.length, 'No objectives have been set for this chapter yet. Ask your administrator.');
    const answers = Array.isArray(body.answers) ? body.answers : [];
    let score = 0;
    const detail = [];
    objs.forEach(o => {
      const a = answers.find(x => x && x.objectiveId === o.id);
      need(a, 'Answer every objective before submitting');
      const correct = Number(a.choice) === o.answerIndex;
      if (correct) score++;
      detail.push({ objectiveId: o.id, choice: Number(a.choice), correct });
    });
    store({ type, chapterId: chapter.id, bookId: book.id, moduleId: mod.id,
      answers: detail, score, total: objs.length }, {});

  } else if (type === 'letter_summary') {
    const book = dbm.byId('books', body.bookId);
    need(book, 'Book not found', 404);
    need(book.scope === 'global' || book.scope === tenantId, 'Not available', 403);
    const mod = dbm.byId('modules', book.moduleId);
    activeModule(mod);
    const prog = bookProgress(user, mod, book);
    need(prog.stage === 'letter', 'Complete every chapter of this book first', 403);
    need(!findSub(user.id, 'letter_summary', { bookId: book.id }), 'You already submitted this letter summary');
    requireText();
    store({ type, bookId: book.id, moduleId: mod.id }, { bookId: book.id });

  } else if (type === 'book_summary') {
    const book = dbm.byId('books', body.bookId);
    need(book, 'Book not found', 404);
    need(book.scope === 'global' || book.scope === tenantId, 'Not available', 403);
    const mod = dbm.byId('modules', book.moduleId);
    activeModule(mod);
    const prog = bookProgress(user, mod, book);
    need(prog.stage === 'summaries', 'Finish the chapters of this book first', 403);
    const idx = Number(body.index);
    const item = prog.summaries.find(s => s.index === idx);
    need(item && item.status === 'active', 'This summary is not open yet — summaries unlock in order', 403);
    requireText();
    store({ type, bookId: book.id, moduleId: mod.id, index: idx,
      color: item.color, label: item.label }, { bookId: book.id, index: idx });

  } else if (type === 'best_book') {
    const mod = dbm.byId('modules', body.moduleId);
    need(mod, 'Module not found', 404);
    activeModule(mod);
    const mp = moduleProgress(user, mod);
    need(mp.stage === 'best_book', 'Complete every book in this module before choosing the best book', 403);
    const book = dbm.byId('books', body.bookId);
    need(book && (book.scope === 'global' || book.scope === tenantId), 'Book not found', 404);
    const entry = mp.books.find(b => b.book.id === book.id);
    need(entry && entry.complete, 'That book is not complete yet', 403);
    store({ type, moduleId: mod.id, bookId: book.id }, { moduleId: mod.id });

  } else if (type === 'general_summary') {
    const statuses = moduleStatuses(user);
    need(statuses.length && statuses.every(s => s.status === 'completed'),
      'Complete every module before the general summary', 403);
    requireText();
    store({ type }, {});

  } else {
    need(false, 'Unknown submission type');
  }

  return { ok: true, submission: subMeta(sub), assessment: assessment, warning };
});

/* ----------------------------------------------------- certificates ------ */
function ensureGeneralCertificate(user) {
  const statuses = moduleStatuses(user);
  const allDone = statuses.length > 0 && statuses.every(s => s.status === 'completed');
  if (!allDone) return null;
  const existing = dbm.where('certificates', c => c.userId === user.id && c.type === 'general')[0];
  const transcript = statuses.map(s => ({
    moduleId: s.id, moduleTitle: s.title, status: s.status,
    performance: s.progress.percent, objectiveScore: s.progress.objectiveScore
  }));
  if (existing) {
    if (!Array.isArray(existing.transcript)) {
      existing.transcript = transcript;
      dbm.save();
    }
    return existing;
  }
  const books = [];
  statuses.forEach(s => s.progress.books.forEach(b => { if (b.complete) books.push(b.book.title); }));
  const tenant = tenantOf(user);
  const gen = {
    id: dbm.uid('cert'), type: 'general',
    code: 'GEN-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    userId: user.id, tenantId: user.tenantId, moduleId: null,
    title: 'GENERAL CERTIFICATE — CHARACTER BUILDING PROGRAM',
    books, bestBook: null, performance: performance(user).overall, objectiveScore: null, transcript,
    userName: user.fullName, tenantName: tenant ? tenant.name : null, issuedAt: dbm.nowISO()
  };
  dbm.collection('certificates').push(gen);
  dbm.save();
  return gen;
}

route('POST', '/api/certificates/issue', ({ user, body }) => {
  requireRole(user, PARTICIPANTS);
  body = body || {};
  const mod = dbm.byId('modules', body.moduleId);
  need(mod, 'Module not found', 404);
  const mp = moduleProgress(user, mod);
  need(mp.stage === 'video', 'Complete every book and pick the best book first', 403);
  if (body.videoId && dbm.byId('library', body.videoId)) {
    user.watchedVideos = user.watchedVideos || [];
    if (user.watchedVideos.indexOf(body.videoId) === -1) user.watchedVideos.push(body.videoId);
  }
  const tenant = tenantOf(user);
  const bestId = mp.bestPick ? mp.bestPick.bookId : null;
  const bestBook = bestId ? dbm.byId('books', bestId) : null;
  const cert = {
    id: dbm.uid('cert'), type: 'module',
    code: String(mod.key || 'MOD').toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    userId: user.id, tenantId: user.tenantId, moduleId: mod.id,
    title: mod.certificateName,
    books: mp.books.map(b => b.book.title),
    bestBookId: bestId || null, bestBook: bestBook ? bestBook.title : null,
    performance: mp.percent, objectiveScore: mp.objectiveScore,
    userName: user.fullName, tenantName: tenant ? tenant.name : null, issuedAt: dbm.nowISO()
  };
  dbm.collection('certificates').push(cert);
  dbm.save();
  const general = ensureGeneralCertificate(user);
  return { ok: true, certificate: cert, generalCertificate: general };
});

route('GET', '/api/certificates', ({ user }) => {
  requireRole(user, PARTICIPANTS.concat(ADMINS));
  ensureGeneralCertificate(user);
  return { ok: true, certificates: dbm.where('certificates', c => c.userId === user.id) };
});

route('GET', '/api/certificate/([a-z0-9_-]+)', ({ user, params }) => {
  requireRole(user, PARTICIPANTS.concat(ADMINS));
  const c = dbm.byId('certificates', params[0]);
  need(c, 'Certificate not found', 404);
  const allowed = c.userId === user.id || user.role === 'super' ||
    (user.role === 'tenant_admin' && c.tenantId === user.tenantId);
  need(allowed, 'Not permitted', 403);
  const settings = dbm.db.settings;
  const tenant = c.tenantId ? dbm.byId('tenants', c.tenantId) : null;
  return { ok: true, certificate: c,
    branding: { programName: settings.programName,
      programLogo: (tenant && tenant.programLogo) || settings.programLogo } };
});

/* ------------------------------------------------------------ videos ----- */
route('GET', '/api/videos', ({ user }) => {
  requireRole(user, PARTICIPANTS.concat(ADMINS));
  const watched = user.watchedVideos || [];
  return { ok: true, videos: dbm.where('library', l => l.type === 'video' &&
      (l.scope === 'global' || l.scope === user.tenantId))
    .map(v => ({ id: v.id, title: v.title, url: v.url, watched: watched.indexOf(v.id) !== -1 })) };
});

route('POST', '/api/videos/([a-z0-9_-]+)/watched', ({ user, params }) => {
  requireRole(user, PARTICIPANTS);
  const v = dbm.byId('library', params[0]);
  need(v && v.type === 'video', 'Video not found', 404);
  user.watchedVideos = user.watchedVideos || [];
  if (user.watchedVideos.indexOf(v.id) === -1) user.watchedVideos.push(v.id);
  dbm.save();
  return { ok: true };
});

/* ----------------------------------------------------------- thoughts ---- */
route('GET', '/api/thoughts', ({ user }) => {
  requireRole(user, PARTICIPANTS);
  return { ok: true, thoughts: dbm.where('thoughts', t => t.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
});

route('POST', '/api/thoughts', ({ user, body }) => {
  requireRole(user, PARTICIPANTS);
  const text = String((body || {}).text || '').trim();
  need(text.length >= 3, 'Write your thought first');
  const t = { id: dbm.uid('tht'), userId: user.id, tenantId: user.tenantId,
    text, createdAt: dbm.nowISO() };
  dbm.collection('thoughts').push(t);
  dbm.save();
  return { ok: true, thought: t };
});

/* --------------------------------------------------------- final view ---- */
function describeSub(s) {
  const ch = s.chapterId ? dbm.byId('chapters', s.chapterId) : null;
  const bk = s.bookId ? dbm.byId('books', s.bookId) : null;
  const md = s.moduleId ? dbm.byId('modules', s.moduleId) : null;
  const kw = assessOf(s);
  return { id: s.id, type: s.type, text: s.text, createdAt: s.createdAt,
    color: s.color || null, label: s.label || null, score: s.score, total: s.total,
    flagged: !!s.flagged, similarity: s.similarity || 0,
    keywordScore: kw ? kw.keywordScore : null,
    keywordsUsed: kw ? kw.keywordsUsed : null,
    keywordsTotal: kw ? kw.keywordsTotal : null,
    keywordsMissing: kw ? kw.keywordsMissing : [],
    chapter: ch ? ch.title : null, book: bk ? bk.title : null,
    module: md ? md.title : null, index: s.index || null };
}

function libMin(l) {
  return { id: l.id, type: l.type, title: l.title, url: l.url, fileName: l.fileName,
    hasText: !!l.text, createdAt: l.createdAt };
}

route('GET', '/api/final', ({ user }) => {
  requireRole(user, PARTICIPANTS);
  const flow = flowFor(user);
  need(flow.allDone, 'Complete every module to unlock the final toolbar', 403);
  const tenantId = user.tenantId;
  const subs = dbm.where('submissions', s => s.userId === user.id);
  const byType = t => subs.filter(s => s.type === t).map(describeSub);
  const visibleBooksList = dbm.where('books', b => b.scope === 'global' || b.scope === tenantId);
  const moduleBookLibIds = visibleBooksList.map(b => b.libraryId).filter(Boolean);
  const lib = dbm.where('library', l => l.scope === 'global' || l.scope === tenantId);
  const watched = user.watchedVideos || [];
  ensureGeneralCertificate(user);

  const bookQuestions = subs.filter(s => s.type === 'objectives').map(s => {
    const ch = s.chapterId ? dbm.byId('chapters', s.chapterId) : null;
    const bk = s.bookId ? dbm.byId('books', s.bookId) : null;
    return { createdAt: s.createdAt, score: s.score, total: s.total,
      chapter: ch ? ch.title : null, book: bk ? bk.title : null,
      answers: (s.answers || []).map(a => {
        const o = dbm.byId('objectives', a.objectiveId);
        return { question: o ? o.question : '(removed)', choice: a.choice, correct: a.correct };
      }) };
  });

  return {
    ok: true,
    summaries: {
      chapterSummaries: byType('chapter_summary'),
      letterSummaries: byType('letter_summary'),
      bookSummaries: byType('book_summary'),
      objectiveSubmissions: byType('objectives'),
      bestPicks: byType('best_book'),
      generalSummaries: byType('general_summary')
    },
    bookQuestions,
    thoughts: dbm.where('thoughts', t => t.userId === user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    library: {
      books: lib.filter(l => l.type === 'book').map(libMin),
      letters: lib.filter(l => l.type === 'letter').map(libMin),
      otherBooks: lib.filter(l => l.type === 'book' && moduleBookLibIds.indexOf(l.id) === -1).map(libMin),
      videos: lib.filter(l => l.type === 'video')
        .map(v => Object.assign(libMin(v), { watched: watched.indexOf(v.id) !== -1 }))
    },
    certificates: dbm.where('certificates', c => c.userId === user.id),
    performance: performance(user)
  };
});

route('GET', '/api/dashboard', ({ user }) => {
  requireRole(user, PARTICIPANTS);
  const recent = dbm.where('submissions', s => s.userId === user.id)
    .slice().reverse().slice(0, 12).map(describeSub);
  return { ok: true, performance: performance(user), recent,
    certificates: dbm.where('certificates', c => c.userId === user.id).length,
    thoughts: dbm.where('thoughts', t => t.userId === user.id).length };
});

route('GET', '/api/library', ({ user }) => {
  need(user, 'Sign in required', 401);
  const items = dbm.where('library', l => l.scope === 'global' || l.scope === user.tenantId);
  const canConfig = user.role === 'super' || user.role === 'tenant_admin';
  const allDone = PARTICIPANTS.indexOf(user.role) !== -1 ? allModulesComplete(user) : true;
  return { ok: true, library: items.map(l => {
    const base = Object.assign({}, l, canConfig ? { canEdit: canEdit(user, l) } : {});
    /* learners may not open the books before they finish every module */
    if (!canConfig && l.type === 'book' && l.url && !allDone) {
      base.url = null;
      base.locked = true;
      base.lockedReason = 'Finish every module to open the books.';
    }
    return base;
  }) };
});

/* ================================================== super admin ========== */
function normalizeWindows(windows) {
  if (!Array.isArray(windows)) return [];
  const out = [];
  windows.forEach(w => {
    if (w && /^\d{2}-\d{2}$/.test(String(w.from)) && /^\d{2}-\d{2}$/.test(String(w.to))) {
      out.push({ from: w.from, to: w.to });
    }
  });
  return out;
}

/* ================================================= super analytics ======= */
/* Everything the super admin needs to see the impact of the programme: per
   portal, per account, per module / book / chapter and per individual, with the
   weekly activity behind it. Filters: ?portalId= &tenantId= &moduleId= &weeks= */
function weekBuckets(weeks) {
  const out = [];
  const now = Date.now();
  for (let i = weeks - 1; i >= 0; i--) {
    const end = now - i * 7 * 86400000;
    out.push({ start: end - 7 * 86400000, end: end, label: i === 0 ? 'now' : '-' + i + 'w',
      submissions: 0, certificates: 0, newUsers: 0, active: [] });
  }
  return out;
}
function bucketIndex(buckets, iso) {
  const t = Date.parse(iso || '');
  if (!t) return -1;
  for (let i = 0; i < buckets.length; i++) {
    if (t > buckets[i].start && t <= buckets[i].end) return i;
  }
  return -1;
}
function pctOf(part, whole) { return whole ? Math.round(100 * part / whole) : 0; }
function meanOf(list) {
  const nums = list.filter(n => typeof n === 'number' && !isNaN(n));
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
}
function round2(n) { return Math.round(n * 100) / 100; }
/* average key-word coverage of a list of submissions (stored score, else live) */
function coverageOf(list) {
  return meanOf((list || []).map(s => {
    const a = assessOf(s);
    return a ? a.keywordScore : null;
  }));
}

/* Who did a flagged submission match? (the other person's work) */
const copyMatchCache = {};
function copyMatch(sub) {
  if (!sub || !sub.flagged || !sub.text) return null;
  const key = sub.id;
  if (copyMatchCache[key] !== undefined) return copyMatchCache[key];
  const mine = new Set(normalizeWords(sub.text));
  let best = null;
  dbm.db.submissions.forEach(other => {
    if (other.userId === sub.userId || !other.text || other.type !== sub.type) return;
    if ((other.chapterId || null) !== (sub.chapterId || null)) return;
    if ((other.bookId || null) !== (sub.bookId || null)) return;
    if ((other.moduleId || null) !== (sub.moduleId || null)) return;
    if ((other.index || null) !== (sub.index || null)) return;
    const sim = Math.round(100 * jaccard(mine, new Set(normalizeWords(other.text))));
    if (sim >= 75 && (!best || sim > best.similarity)) {
      const u = dbm.byId('users', other.userId) || {};
      best = { submissionId: other.id, userId: other.userId, name: u.fullName || 'Unknown',
        className: u.className || null, studentNumber: u.studentNumber || null,
        similarity: sim, createdAt: other.createdAt };
    }
  });
  copyMatchCache[key] = best;
  return best;
}

function analyticsPayload(scope) {
  const weeks = scope.weeks || 12;
  const fPortal = scope.portalId || null;
  const fTenant = scope.tenantId || null;
  const fModule = scope.moduleId || null;
  const onlyUserIds = scope.userIds || null;
  const inOnly = id => !onlyUserIds || onlyUserIds.indexOf(id) !== -1;

  const portals = scope.portals || dbm.db.portals.filter(p => !fPortal || p.id === fPortal);
  const portalById = {};
  dbm.db.portals.forEach(p => { portalById[p.id] = p; });
  const tenants = (scope.tenants || dbm.db.tenants.filter(t =>
    (!fPortal || t.portalId === fPortal) && (!fTenant || t.id === fTenant)));
  const tenantIds = {};
  tenants.forEach(t => { tenantIds[t.id] = true; });
  const modules = ordered(dbm.db.modules).filter(m => !fModule || m.id === fModule);
  const moduleIds = {};
  modules.forEach(m => { moduleIds[m.id] = true; });

  const participants = dbm.db.users.filter(u =>
    PARTICIPANTS.indexOf(u.role) !== -1 && tenantIds[u.tenantId] && inOnly(u.id));
  const staff = dbm.db.users.filter(u =>
    ADMINS.concat(['supervisor']).indexOf(u.role) !== -1 && tenantIds[u.tenantId]);
  const subs = dbm.db.submissions.filter(s =>
    tenantIds[s.tenantId] && (!fModule || moduleIds[s.moduleId]) && inOnly(s.userId));
  const certs = dbm.db.certificates.filter(c =>
    tenantIds[c.tenantId] && (!fModule || moduleIds[c.moduleId]) && inOnly(c.userId));

  /* per learner: progress, completion, activity, integrity */
  const subsByUser = {};
  subs.forEach(s => { (subsByUser[s.userId] = subsByUser[s.userId] || []).push(s); });
  const certsByUser = {};
  certs.forEach(c => { (certsByUser[c.userId] = certsByUser[c.userId] || []).push(c); });
  const perfByUser = {};
  participants.forEach(u => {
    const st = moduleStatuses(u).filter(m => !fModule || m.id === fModule);
    perfByUser[u.id] = {
      user: u,
      statuses: st,
      completed: st.filter(m => m.status === 'completed').length,
      modules: st.length,
      progress: meanOf(st.map(m => m.progress.percent))
    };
  });

  const flaggedSubs = subs.filter(s => s.flagged);
  const typedSubs = subs.map(s => assessOf(s)).filter(Boolean);
  const objSubs = subs.filter(s => s.type === 'objectives' && s.total);
  const recentCut = Date.now() - 14 * 86400000;
  const involved = participants.filter(u => (subsByUser[u.id] || []).length > 0);
  const finished = participants.filter(u => {
    const p = perfByUser[u.id];
    return p.modules > 0 && p.completed === p.modules;
  });
  const recentlyActive = participants.filter(u => (subsByUser[u.id] || [])
    .some(s => Date.parse(s.createdAt || '') > recentCut));

  /* weekly activity (submissions, certificates, new learners, active learners) */
  const buckets = weekBuckets(weeks);
  subs.forEach(s => {
    const i = bucketIndex(buckets, s.createdAt);
    if (i === -1) return;
    buckets[i].submissions++;
    if (buckets[i].active.indexOf(s.userId) === -1) buckets[i].active.push(s.userId);
  });
  certs.forEach(c => {
    const i = bucketIndex(buckets, c.issuedAt || c.createdAt);
    if (i !== -1) buckets[i].certificates++;
  });
  participants.forEach(u => {
    const i = bucketIndex(buckets, u.createdAt);
    if (i !== -1) buckets[i].newUsers++;
  });

  const impact = {
    participants: participants.length,
    staff: staff.length,
    involved: involved.length,
    involvementRate: pctOf(involved.length, participants.length),
    finished: finished.length,
    completionRate: pctOf(finished.length, participants.length),
    certificates: certs.length,
    certificatesPerLearner: participants.length ? round2(certs.length / participants.length) : 0,
    avgProgress: meanOf(participants.map(u => perfByUser[u.id].progress)),
    keywordCoverage: meanOf(typedSubs.map(a => a.keywordScore)),
    objectiveAccuracy: meanOf(objSubs.map(s => Math.round(100 * (s.score || 0) / s.total))),
    integrity: pctOf(subs.length - flaggedSubs.length, subs.length),
    flaggedRate: pctOf(flaggedSubs.length, subs.length),
    activeShare: pctOf(recentlyActive.length, participants.length),
    submissionsPerLearner: participants.length ? round2(subs.length / participants.length) : 0,
    chaptersDone: subs.filter(s => s.type === 'chapter_summary').length,
    objectivesAnswered: objSubs.length
  };

  /* ---- per portal ---------------------------------------------------- */
  const portalStats = portals.map(p => {
    const tIds = tenants.filter(t => t.portalId === p.id).map(t => t.id);
    const inP = id => tIds.indexOf(id) !== -1;
    const ps = participants.filter(u => inP(u.tenantId));
    const psubs = subs.filter(s => inP(s.tenantId));
    const pcerts = certs.filter(c => inP(c.tenantId));
    const pfin = ps.filter(u => {
      const q = perfByUser[u.id];
      return q.modules > 0 && q.completed === q.modules;
    });
    const pflagged = psubs.filter(s => s.flagged).length;
    return {
      id: p.id, key: p.key, name: p.name, type: p.type, enabled: p.enabled !== false,
      accounts: tIds.length, participants: ps.length,
      involved: ps.filter(u => (subsByUser[u.id] || []).length > 0).length,
      submissions: psubs.length, certificates: pcerts.length,
      flagged: pflagged, flaggedRate: pctOf(pflagged, psubs.length),
      avgProgress: meanOf(ps.map(u => perfByUser[u.id].progress)),
      completionRate: pctOf(pfin.length, ps.length), finished: pfin.length,
      keywordCoverage: coverageOf(psubs),
      objectiveAccuracy: meanOf(psubs.filter(s => s.type === 'objectives' && s.total)
        .map(s => Math.round(100 * (s.score || 0) / s.total))),
      perLearner: ps.length ? round2(psubs.length / ps.length) : 0
    };
  });

  /* ---- per account --------------------------------------------------- */
  const accounts = tenants.map(t => {
    const us = participants.filter(u => u.tenantId === t.id);
    const asubs = subs.filter(s => s.tenantId === t.id);
    const acerts = certs.filter(c => c.tenantId === t.id);
    const af = us.filter(u => {
      const q = perfByUser[u.id];
      return q.modules > 0 && q.completed === q.modules;
    });
    const byType = {};
    asubs.forEach(s => { byType[s.type] = (byType[s.type] || 0) + 1; });
    const aflagged = asubs.filter(s => s.flagged).length;
    return {
      id: t.id, name: t.name, slug: t.slug, type: t.type,
      portalId: t.portalId, portalName: (portalById[t.portalId] || {}).name || null,
      active: t.active !== false,
      staff: staff.filter(u => u.tenantId === t.id).length,
      participants: us.length,
      involved: us.filter(u => (subsByUser[u.id] || []).length > 0).length,
      submissions: asubs.length, byType,
      certificates: acerts.length,
      flagged: aflagged, flaggedRate: pctOf(aflagged, asubs.length),
      avgProgress: meanOf(us.map(u => perfByUser[u.id].progress)),
      completionRate: pctOf(af.length, us.length), finished: af.length,
      keywordCoverage: coverageOf(asubs),
      objectiveAccuracy: meanOf(asubs.filter(s => s.type === 'objectives' && s.total)
        .map(s => Math.round(100 * (s.score || 0) / s.total))),
      lastActivity: asubs.reduce((a, s) => (!a || String(s.createdAt) > a) ? s.createdAt : a, null),
      chaptersDone: asubs.filter(s => s.type === 'chapter_summary').length,
      objectivesAnswered: asubs.filter(s => s.type === 'objectives').length,
      modules: modules.map(m => {
        const ms = asubs.filter(s => s.moduleId === m.id);
        const done = us.filter(u => {
          const st = perfByUser[u.id].statuses.filter(x => x.id === m.id)[0];
          return st && st.status === 'completed';
        }).length;
        const started = us.filter(u => ms.some(s => s.userId === u.id)).length;
        return { id: m.id, title: m.title, mode: m.mode, submissions: ms.length,
          started, completed: done, completionRate: pctOf(done, us.length) };
      })
    };
  });

  /* ---- per module / book / chapter (the finest grain of the exercise) -- */
  const moduleStats = modules.map(m => {
    const msubs = subs.filter(s => s.moduleId === m.id);
    const books = ordered(dbm.db.books.filter(b => b.moduleId === m.id)).map(b => {
      const chapters = ordered(dbm.db.chapters.filter(c => c.bookId === b.id)).map(c => {
        const csubs = msubs.filter(s => s.chapterId === c.id);
        const obj = csubs.filter(s => s.type === 'objectives' && s.total);
        return {
          id: c.id, title: c.title, pageStart: c.pageStart, pageEnd: c.pageEnd,
          submissions: csubs.length,
          learners: new Set(csubs.map(s => s.userId)).size,
          completed: new Set(csubs.filter(s => s.type === 'chapter_summary').map(s => s.userId)).size,
          keywordCoverage: coverageOf(csubs),
          objectivesAnswered: obj.length,
          accuracy: meanOf(obj.map(s => Math.round(100 * (s.score || 0) / s.total))),
          flagged: csubs.filter(s => s.flagged).length
        };
      });
      return { id: b.id, title: b.title, order: b.order, scope: b.scope,
        submissions: msubs.filter(s => s.bookId === b.id).length, chapters };
    });
    const completed = participants.filter(u => {
      const st = perfByUser[u.id].statuses.filter(x => x.id === m.id)[0];
      return st && st.status === 'completed';
    }).length;
    const started = participants.filter(u => msubs.some(s => s.userId === u.id)).length;
    return {
      id: m.id, order: m.order, title: m.title, mode: m.mode, certificateName: m.certificateName,
      participants: participants.length, started, completed,
      startedRate: pctOf(started, participants.length),
      completionRate: pctOf(completed, participants.length),
      avgProgress: participants.length ? meanOf(participants.map(u => {
        const st = perfByUser[u.id].statuses.filter(x => x.id === m.id)[0];
        return st ? st.progress.percent : 0;
      })) : 0,
      submissions: msubs.length, flagged: msubs.filter(s => s.flagged).length,
      keywordCoverage: coverageOf(msubs),
      objectiveAccuracy: meanOf(msubs.filter(s => s.type === 'objectives' && s.total)
        .map(s => Math.round(100 * (s.score || 0) / s.total))),
      books
    };
  });

  /* ---- individuals (the smallest point of all) ------------------------ */
  const learnerRows = participants.map(u => {
    const p = perfByUser[u.id];
    const mine = subsByUser[u.id] || [];
    const typed = mine.filter(s => s.keywordScore != null);
    const obj = mine.filter(s => s.type === 'objectives' && s.total);
    const t = tenants.filter(x => x.id === u.tenantId)[0] || {};
    const active = p.statuses.filter(m => m.status === 'active')[0] || null;
    return {
      id: u.id, name: u.fullName, role: u.role, className: u.className,
      studentNumber: u.studentNumber, account: t.name || null, accountId: u.tenantId,
      portal: (portalById[t.portalId] || {}).name || null,
      progress: p.progress || 0, modulesCompleted: p.completed, moduleCount: p.modules,
      finished: p.modules > 0 && p.completed === p.modules,
      level: active ? active.title : (p.modules > 0 && p.completed === p.modules ? 'All modules completed' : '—'),
      submissions: mine.length,
      certificates: (certsByUser[u.id] || []).length,
      flagged: mine.filter(s => s.flagged).length,
      keywordCoverage: coverageOf(mine),
      objectiveAccuracy: meanOf(obj.map(s => Math.round(100 * (s.score || 0) / s.total))),
      lastActiveAt: mine.reduce((a, s) => (!a || String(s.createdAt) > a) ? s.createdAt : a, null)
    };
  }).sort((a, b) => b.progress - a.progress || b.submissions - a.submissions ||
    String(a.name).localeCompare(String(b.name)));

  const activity = buckets.map(b => ({ label: b.label, submissions: b.submissions,
    certificates: b.certificates, newUsers: b.newUsers, activeLearners: b.active.length }));

  const bookCount = dbm.db.books.filter(b => moduleIds[b.moduleId]).length;
  const chapterCount = dbm.db.chapters.filter(c => {
    const b = dbm.byId('books', c.bookId);
    return b && moduleIds[b.moduleId];
  }).length;

  return {
    ok: true,
    generatedAt: dbm.nowISO(),
    scope: { portalId: fPortal || null, tenantId: fTenant || null, moduleId: fModule || null, weeks },
    filters: {
      /* only what this viewer is allowed to pick from */
      portals: portals.map(p => ({ id: p.id, name: p.name, key: p.key })),
      tenants: tenants.map(t => ({ id: t.id, name: t.name, portalId: t.portalId })),
      modules: ordered(dbm.db.modules).map(m => ({ id: m.id, title: m.title, mode: m.mode }))
    },
    totals: {
      portals: portals.length, accounts: tenants.length, participants: participants.length,
      staff: staff.length, submissions: subs.length, certificates: certs.length,
      flagged: flaggedSubs.length, modules: modules.length, books: bookCount, chapters: chapterCount,
      objectives: dbm.db.objectives.length
    },
    impact: impact,
    portals: portalStats,
    accounts: accounts,
    modules: moduleStats,
    learners: learnerRows.slice(0, 300),
    learnersTotal: learnerRows.length,
    activity: activity,
    /* every copy flag, and the person the work matched */
    flagged: flaggedSubs.slice(0, 200).map(s => {
      const m = copyMatch(s);
      return Object.assign(describeSub(s), {
        userId: s.userId,
        userName: (dbm.byId('users', s.userId) || {}).fullName || null,
        className: (dbm.byId('users', s.userId) || {}).className || null,
        matchedWith: m, matchedName: m ? m.name : null
      });
    })
  };
}

route('GET', '/api/super/analytics', ({ req, user }) => {
  requireRole(user, ['super']);
  return analyticsPayload({
    weeks: Math.max(4, Math.min(52, Number(qp(req, 'weeks')) || 12)),
    portalId: qp(req, 'portalId'),
    tenantId: qp(req, 'tenantId'),
    moduleId: qp(req, 'moduleId')
  });
});

/* The same analysis for one account (never anything outside it). A supervisor
   only ever sees the members they look after. */
route('GET', '/api/admin/analytics', ({ req, user }) => {
  requireRole(user, ADMINS.concat(['supervisor']));
  const myTenants = dbm.db.tenants.filter(t => t.id === user.tenantId);
  const scope = {
    weeks: Math.max(4, Math.min(52, Number(qp(req, 'weeks')) || 12)),
    moduleId: qp(req, 'moduleId'),
    tenants: myTenants,
    portals: dbm.db.portals.filter(p => myTenants.some(t => t.portalId === p.id))
  };
  if (user.role === 'supervisor') {
    /* only the members this supervisor looks after (staff are not learners) */
    scope.userIds = dbm.db.users.filter(u => u.supervisorId === user.id).map(u => u.id);
  } else {
    scope.tenantId = user.tenantId;
  }
  const d = analyticsPayload(scope);
  d.viewer = { role: user.role, tenantId: user.tenantId,
    tenantName: (myTenants[0] || {}).name || null,
    portalName: ((dbm.db.portals.filter(p => myTenants.some(t => t.portalId === p.id))[0]) || {}).name || null };
  return d;
});

route('GET', '/api/super/overview', ({ user }) => {
  requireRole(user, SUPER);
  /* Per-tenant rows for the super dashboard: the Tenants overview table there
     shows users / submissions / certificates / flagged per account, and the
     status column reads `active` (the account's portal is open today).
     Mirrors r_super_overview() in the PHP build. */
  const tenants = dbm.db.tenants.map(t => ({
    id: t.id, name: t.name, slug: t.slug, type: t.type, portalId: t.portalId || null,
    users: dbm.db.users.filter(u => u.tenantId === t.id).length,
    submissions: dbm.db.submissions.filter(s => s.tenantId === t.id).length,
    certificates: dbm.db.certificates.filter(c => c.tenantId === t.id).length,
    flagged: dbm.db.submissions.filter(s => s.tenantId === t.id && s.flagged).length,
    active: portalActive(dbm.byId('portals', t.portalId))
  }));
  return { ok: true,
    counts: { portals: dbm.db.portals.length, tenants: dbm.db.tenants.length,
      users: dbm.db.users.length, submissions: dbm.db.submissions.length,
      certificates: dbm.db.certificates.length,
      flagged: dbm.db.submissions.filter(s => s.flagged).length,
      modules: dbm.db.modules.length, library: dbm.db.library.length },
    tenants };
});

route('GET', '/api/super/portals', ({ user }) => {
  requireRole(user, SUPER);
  return { ok: true, portals: ordered(dbm.db.portals)
    .map(p => Object.assign({}, p, { active: portalActive(p),
      tenantCount: dbm.db.tenants.filter(t => t.portalId === p.id).length })) };
});

route('POST', '/api/super/portals', ({ user, body }) => {
  requireRole(user, SUPER);
  body = body || {};
  need(body.name && String(body.name).trim(), 'Portal name is required');
  const key = slugify(body.key || body.name);
  need(!dbm.db.portals.some(p => p.key === key), 'A portal with that key already exists');
  const p = {
    id: dbm.uid('prt'), key, name: String(body.name).trim(),
    type: body.type || 'custom',
    scheduleMode: body.scheduleMode || 'windows',
    windows: normalizeWindows(body.windows),
    enabled: body.enabled !== false,
    description: body.description || '',
    createdAt: dbm.nowISO()
  };
  dbm.collection('portals').push(p);
  dbm.save();
  return { ok: true, portal: Object.assign({}, p, { active: portalActive(p) }) };
});

route('PUT', '/api/super/portals/([a-z0-9_-]+)', ({ user, params, body }) => {
  requireRole(user, SUPER);
  const p = dbm.byId('portals', params[0]);
  need(p, 'Portal not found', 404);
  body = body || {};
  if (body.name) p.name = String(body.name).trim();
  if (body.type) p.type = body.type;
  if (body.description !== undefined) p.description = body.description;
  if (body.scheduleMode) p.scheduleMode = body.scheduleMode;
  if (body.windows !== undefined) p.windows = normalizeWindows(body.windows);
  if (body.enabled !== undefined) p.enabled = body.enabled !== false;
  dbm.save();
  return { ok: true, portal: Object.assign({}, p, { active: portalActive(p) }) };
});

route('DELETE', '/api/super/portals/([a-z0-9_-]+)', ({ user, params }) => {
  requireRole(user, SUPER);
  const p = dbm.byId('portals', params[0]);
  need(p, 'Portal not found', 404);
  need(!dbm.db.tenants.some(t => t.portalId === p.id),
    'Delete or move the accounts created under this portal first');
  dbm.remove('portals', p.id);
  return { ok: true };
});

route('GET', '/api/super/tenants', ({ user }) => {
  requireRole(user, SUPER);
  return { ok: true, tenants: dbm.db.tenants.map(t => {
    const admin = dbm.db.users.find(u => u.tenantId === t.id && u.role === 'tenant_admin');
    return Object.assign({}, t, {
      portalName: (dbm.byId('portals', t.portalId) || {}).name || null,
      admin: admin ? publicUser(admin) : null,
      userCount: dbm.db.users.filter(u => u.tenantId === t.id).length,
      active: portalActive(dbm.byId('portals', t.portalId))
    });
  }) };
});

route('POST', '/api/super/tenants', ({ user, body }) => {
  requireRole(user, SUPER);
  body = body || {};
  const portal = dbm.byId('portals', body.portalId);
  need(portal, 'Choose a portal for this account');
  need(body.name && String(body.name).trim(), 'Name is required');
  const slug = slugify(body.slug || body.name);
  need(slug, 'Could not build a URL slug from the name');
  need(!dbm.db.tenants.some(t => t.slug === slug), 'That URL slug is already taken', 409);
  const admin = body.admin || {};
  need(admin.fullName && String(admin.fullName).trim().length >= 3, 'Administrator full name is required');
  need(admin.email && String(admin.email).trim(), 'Administrator email is required');
  need(admin.password && String(admin.password).length >= 6, 'Administrator password must be at least 6 characters');

  const tenant = { id: dbm.uid('ten'), portalId: portal.id, type: portal.type, slug,
    name: String(body.name).trim(), logo: body.logo || null, programLogo: body.programLogo || null,
    createdAt: dbm.nowISO() };
  dbm.collection('tenants').push(tenant);

  const h = auth.hashPassword(String(admin.password));
  const adminUser = { id: dbm.uid('usr'), tenantId: tenant.id, role: 'tenant_admin',
    fullName: String(admin.fullName).trim(), email: String(admin.email).trim().toLowerCase(),
    studentNumber: null, className: null, photo: admin.photo || null,
    salt: h.salt, passwordHash: h.hash, createdAt: dbm.nowISO(),
    letterFeedbackAt: dbm.nowISO(), optionalVideoSeen: true, watchedVideos: [], suspended: false };
  dbm.collection('users').push(adminUser);
  dbm.save();
  return { ok: true, tenant, admin: publicUser(adminUser), loginUrl: '/t/' + tenant.slug };
});

route('PUT', '/api/super/tenants/([a-z0-9_-]+)', ({ user, params, body }) => {
  requireRole(user, SUPER);
  const t = dbm.byId('tenants', params[0]);
  need(t, 'Account not found', 404);
  body = body || {};
  if (body.name) t.name = String(body.name).trim();
  if (body.logo !== undefined) t.logo = body.logo;
  if (body.programLogo !== undefined) t.programLogo = body.programLogo;
  if (body.themeColor !== undefined) t.themeColor = hexColor(body.themeColor);
  dbm.save();
  return { ok: true, tenant: t };
});

route('DELETE', '/api/super/tenants/([a-z0-9_-]+)', ({ user, params }) => {
  requireRole(user, SUPER);
  const t = dbm.byId('tenants', params[0]);
  need(t, 'Account not found', 404);
  const ids = dbm.db.users.filter(u => u.tenantId === t.id).map(u => u.id);
  dbm.db.users = dbm.db.users.filter(u => u.tenantId !== t.id);
  dbm.db.submissions = dbm.db.submissions.filter(s => s.tenantId !== t.id);
  dbm.db.certificates = dbm.db.certificates.filter(c => c.tenantId !== t.id);
  dbm.db.thoughts = (dbm.db.thoughts || []).filter(x => x.tenantId !== t.id);
  dbm.db.sessions = dbm.db.sessions.filter(s => ids.indexOf(s.userId) === -1);
  dbm.remove('tenants', t.id);
  return { ok: true };
});

/* ---------------------------------------------------------- modules ------ */
route('GET', '/api/super/modules', ({ user }) => {
  requireRole(user, SUPER);
  return { ok: true, modules: ordered(dbm.db.modules).map(m => Object.assign({}, m, {
    bookCount: dbm.db.books.filter(b => b.moduleId === m.id).length })) };
});

route('POST', '/api/super/modules', ({ user, body }) => {
  requireRole(user, SUPER);
  body = body || {};
  need(body.title && String(body.title).trim(), 'Module title is required');
  const order = Number(body.order) || (ordered(dbm.db.modules).length + 1);
  const objectives = body.mode === 'objectives';
  const mod = {
    id: dbm.uid('mod'), key: slugify(body.key || body.title).replace(/-/g, '_').slice(0, 24),
    order, title: String(body.title).trim(),
    mode: objectives ? 'objectives' : 'summary',
    certificateName: String(body.certificateName || ('CERTIFICATE (' + body.title + ')')).toUpperCase(),
    defaultBooks: Number(body.defaultBooks) || 3,
    letterAfterBook: !objectives,
    summaryPrompts: Array.isArray(body.summaryPrompts) && body.summaryPrompts.length
      ? body.summaryPrompts.map((p, i) => ({ label: p.label || ('Summary ' + (i + 1)), color: p.color || '#3498db' }))
      : (objectives ? [{ label: 'Summary 1', color: '#e74c3c' },
          { label: 'Summary 2', color: '#f39c12' },
          { label: 'Summary 3', color: '#27ae60' }] : []),
    completionVideoId: null, createdAt: dbm.nowISO()
  };
  dbm.collection('modules').push(mod);
  dbm.save();
  return { ok: true, module: mod };
});

route('PUT', '/api/super/modules/([a-z0-9_-]+)', ({ user, params, body }) => {
  requireRole(user, SUPER);
  const mod = dbm.byId('modules', params[0]);
  need(mod, 'Module not found', 404);
  body = body || {};
  if (body.title) mod.title = String(body.title).trim();
  if (body.certificateName) mod.certificateName = String(body.certificateName).trim().toUpperCase();
  if (body.order) mod.order = Number(body.order);
  if (body.mode) mod.mode = body.mode === 'objectives' ? 'objectives' : 'summary';
  if (body.defaultBooks) mod.defaultBooks = Number(body.defaultBooks);
  if (body.summaryPrompts !== undefined) mod.summaryPrompts = body.summaryPrompts;
  if (body.completionVideoId !== undefined) mod.completionVideoId = body.completionVideoId;
  dbm.save();
  return { ok: true, module: mod };
});

route('DELETE', '/api/super/modules/([a-z0-9_-]+)', ({ user, params }) => {
  requireRole(user, SUPER);
  const mod = dbm.byId('modules', params[0]);
  need(mod, 'Module not found', 404);
  need(!dbm.db.books.some(b => b.moduleId === mod.id), 'Remove the books of this module first');
  dbm.remove('modules', mod.id);
  return { ok: true };
});

route('GET', '/api/super/settings', ({ user }) => {
  requireRole(user, ['super']);
  const s = dbm.db.settings;
  return { ok: true, settings: { programName: s.programName, programLogo: s.programLogo,
    letterId: s.letterId, letterVideoId: s.letterVideoId } };
});

route('PUT', '/api/super/settings', ({ user, body }) => {
  requireRole(user, SUPER);
  body = body || {};
  const s = dbm.db.settings;
  if (body.programName) s.programName = String(body.programName).trim();
  if (body.programLogo !== undefined) s.programLogo = body.programLogo;
  if (body.letterId) s.letterId = body.letterId;
  if (body.letterVideoId) s.letterVideoId = body.letterVideoId;
  if (body.password) {
    need(String(body.password).length >= 6, 'Password must be at least 6 characters');
    const h = auth.hashPassword(String(body.password));
    s.superAdmin.salt = h.salt;
    s.superAdmin.passwordHash = h.hash;
    const su = dbm.db.users.find(u => u.role === 'super');
    if (su) { su.salt = h.salt; su.passwordHash = h.hash; }
  }
  if (body.username) {
    s.superAdmin.username = String(body.username).trim();
    const su = dbm.db.users.find(u => u.role === 'super');
    if (su) su.username = s.superAdmin.username;
  }
  dbm.save();
  return { ok: true };
});

/* ============================================= content management ======== */
function qp(req, name) {
  return new URL(req.url, 'http://localhost').searchParams.get(name);
}

route('POST', '/api/library', ({ user, body }) => {
  requireRole(user, ADMINS);
  body = body || {};
  need(body.title && String(body.title).trim(), 'Title is required');
  const type = ['book', 'letter', 'video'].indexOf(body.type) !== -1 ? body.type : 'book';
  const scope = user.role === 'super' ? (body.scope || 'global') : user.tenantId;
  const item = { id: dbm.uid('lib'), type, title: String(body.title).trim(), scope,
    text: body.text ? String(body.text) : null, url: body.url || null, fileName: null,
    createdAt: dbm.nowISO() };
  if (body.file) {
    item.url = saveUpload(body.file);
    item.fileName = body.file.name;
    need(item.url, 'File upload failed');
  }
  need(item.url || item.text || type === 'book', 'Provide a file, a link or text');
  dbm.collection('library').push(item);
  dbm.save();
  return { ok: true, item };
});

route('PUT', '/api/library/([a-z0-9_-]+)', ({ user, params, body }) => {
  requireRole(user, ADMINS);
  const item = dbm.byId('library', params[0]);
  need(item, 'Not found', 404);
  need(canEdit(user, item), 'You can only edit your own entries', 403);
  body = body || {};
  if (body.title) item.title = String(body.title).trim();
  if (body.text !== undefined) item.text = body.text || null;
  if (body.url !== undefined) item.url = body.url || null;
  if (body.type) item.type = body.type;
  if (body.file) { item.url = saveUpload(body.file); item.fileName = body.file.name; }
  if (body.scope && user.role === 'super') item.scope = body.scope;
  dbm.save();
  return { ok: true, item };
});

route('DELETE', '/api/library/([a-z0-9_-]+)', ({ user, params }) => {
  requireRole(user, ADMINS);
  const item = dbm.byId('library', params[0]);
  need(item, 'Not found', 404);
  need(canEdit(user, item), 'You can only delete your own entries', 403);
  dbm.remove('library', item.id);
  return { ok: true };
});

route('GET', '/api/books', ({ req, user }) => {
  requireRole(user, ADMINS);
  const moduleId = qp(req, 'moduleId');
  const all = ordered(dbm.db.books).filter(b => !moduleId || b.moduleId === moduleId);
  const list = user.role === 'super' ? all
    : all.filter(b => b.scope === 'global' || b.scope === user.tenantId);
  return { ok: true, books: list.map(b => {
    const chs = ordered(dbm.where('chapters', c => c.bookId === b.id &&
      (user.role === 'super' || c.scope === 'global' || c.scope === user.tenantId)));
    return Object.assign({}, b, { canEdit: canEdit(user, b),
      chapters: chs.map(c => Object.assign({}, c, {
        keywords: cleanKeywords(c.keywords),
        suggestedKeywords: suggestKeywords(c.content, 8),
        keywordsSource: (cleanKeywords(c.keywords).length ? 'set' : 'auto'),
        objectives: ordered(dbm.where('objectives', o => o.chapterId === c.id &&
          (user.role === 'super' || o.scope === 'global' || o.scope === user.tenantId))) })) });
  }) };
});

route('POST', '/api/books', ({ user, body }) => {
  requireRole(user, ADMINS);
  body = body || {};
  need(body.title && String(body.title).trim(), 'Book title is required');
  const mod = dbm.byId('modules', body.moduleId);
  need(mod, 'Choose a module');
  const scope = user.role === 'super' ? (body.scope || 'global') : user.tenantId;
  const order = Number(body.order) ||
    (dbm.db.books.filter(b => b.moduleId === mod.id && b.scope === scope).length + 1);
  const book = { id: dbm.uid('bk'), moduleId: mod.id, scope, order,
    title: String(body.title).trim(),
    libraryId: body.libraryId || null, letterId: body.letterId || null,
    createdAt: dbm.nowISO() };
  dbm.collection('books').push(book);
  dbm.save();
  return { ok: true, book };
});

route('PUT', '/api/books/([a-z0-9_-]+)', ({ user, params, body }) => {
  requireRole(user, ADMINS);
  const book = dbm.byId('books', params[0]);
  need(book, 'Book not found', 404);
  need(canEdit(user, book), 'Not permitted', 403);
  body = body || {};
  if (body.title) book.title = String(body.title).trim();
  if (body.order) book.order = Number(body.order);
  if (body.moduleId && dbm.byId('modules', body.moduleId)) book.moduleId = body.moduleId;
  if (body.libraryId !== undefined) book.libraryId = body.libraryId || null;
  if (body.letterId !== undefined) book.letterId = body.letterId || null;
  dbm.save();
  return { ok: true, book };
});

route('DELETE', '/api/books/([a-z0-9_-]+)', ({ user, params }) => {
  requireRole(user, ADMINS);
  const book = dbm.byId('books', params[0]);
  need(book, 'Book not found', 404);
  need(canEdit(user, book), 'Not permitted', 403);
  const chIds = dbm.db.chapters.filter(c => c.bookId === book.id).map(c => c.id);
  dbm.db.objectives = dbm.db.objectives.filter(o => chIds.indexOf(o.chapterId) === -1);
  dbm.db.chapters = dbm.db.chapters.filter(c => c.bookId !== book.id);
  dbm.remove('books', book.id);
  return { ok: true };
});

/* ---------------------------------------- chapters & objective questions -- */
route('POST', '/api/books/([a-z0-9_-]+)/chapters', ({ user, params, body }) => {
  requireRole(user, ADMINS);
  const book = dbm.byId('books', params[0]);
  need(book, 'Book not found', 404);
  need(user.role === 'super' || book.scope === 'global' || book.scope === user.tenantId, 'Not permitted', 403);
  body = body || {};
  need(body.title && String(body.title).trim(), 'Chapter title is required');
  const scope = user.role === 'super' ? (body.scope || 'global') : user.tenantId;
  const order = Number(body.order) || (dbm.db.chapters.filter(c => c.bookId === book.id).length + 1);
  const ch = { id: dbm.uid('ch'), bookId: book.id, scope, order,
    title: String(body.title).trim(), content: body.content ? String(body.content) : '',
    pageStart: body.pageStart || null, pageEnd: body.pageEnd || null,
    keywords: cleanKeywords(body.keywords),
    createdAt: dbm.nowISO() };
  dbm.collection('chapters').push(ch);
  dbm.save();
  return { ok: true, chapter: ch };
});

route('PUT', '/api/chapters/([a-z0-9_-]+)', ({ user, params, body }) => {
  requireRole(user, ADMINS);
  const ch = dbm.byId('chapters', params[0]);
  need(ch, 'Chapter not found', 404);
  need(canEdit(user, ch), 'Not permitted', 403);
  body = body || {};
  if (body.title) ch.title = String(body.title).trim();
  if (body.content !== undefined) ch.content = String(body.content || '');
  if (body.pageStart !== undefined) ch.pageStart = body.pageStart;
  if (body.pageEnd !== undefined) ch.pageEnd = body.pageEnd;
  if (body.keywords !== undefined) ch.keywords = cleanKeywords(body.keywords);
  if (body.order) ch.order = Number(body.order);
  if (body.scope && user.role === 'super') ch.scope = body.scope;
  dbm.save();
  return { ok: true, chapter: ch };
});

route('DELETE', '/api/chapters/([a-z0-9_-]+)', ({ user, params }) => {
  requireRole(user, ADMINS);
  const ch = dbm.byId('chapters', params[0]);
  need(ch, 'Chapter not found', 404);
  need(canEdit(user, ch), 'Not permitted', 403);
  dbm.db.objectives = dbm.db.objectives.filter(o => o.chapterId !== ch.id);
  dbm.remove('chapters', ch.id);
  return { ok: true };
});

/* Questions are entered by the school/organization administrator or the super admin. */
route('POST', '/api/chapters/([a-z0-9_-]+)/objectives', ({ user, params, body }) => {
  requireRole(user, ADMINS);
  const ch = dbm.byId('chapters', params[0]);
  need(ch, 'Chapter not found', 404);
  const book = dbm.byId('books', ch.bookId);
  need(user.role === 'super' || book.scope === 'global' || book.scope === user.tenantId, 'Not permitted', 403);
  body = body || {};
  need(body.question && String(body.question).trim(), 'Question is required');
  const options = (Array.isArray(body.options) ? body.options : [])
    .map(o => String(o).trim()).filter(Boolean);
  need(options.length >= 2, 'Provide at least two options');
  const answerIndex = Number(body.answerIndex);
  need(answerIndex >= 0 && answerIndex < options.length, 'Mark the correct option');
  const scope = user.role === 'super' ? (body.scope || 'global') : user.tenantId;
  const obj = { id: dbm.uid('obj'), chapterId: ch.id, scope,
    order: dbm.db.objectives.filter(o => o.chapterId === ch.id).length + 1,
    question: String(body.question).trim(), options, answerIndex,
    createdAt: dbm.nowISO() };
  dbm.collection('objectives').push(obj);
  dbm.save();
  return { ok: true, objective: obj };
});

route('DELETE', '/api/objectives/([a-z0-9_-]+)', ({ user, params }) => {
  requireRole(user, ADMINS);
  const obj = dbm.byId('objectives', params[0]);
  need(obj, 'Not found', 404);
  need(canEdit(user, obj), 'Not permitted', 403);
  dbm.remove('objectives', obj.id);
  return { ok: true };
});

/* ================================================ user management ======== */
function allowedRolesFor(portalType, creatorRole) {
  if (creatorRole === 'supervisor') return ['member'];
  if (portalType === 'schools') return ['student', 'teacher', 'supervisor'];
  /* Organization portal: the admin only adds supervisors; supervisors then add
     their own users (max 100 each). Super admin bypasses this restriction. */
  if (portalType === 'organization' && creatorRole === 'tenant_admin') return ['supervisor'];
  return ['member', 'supervisor'];
}

route('GET', '/api/users', ({ req, user }) => {
  need(user, 'Sign in required', 401);
  let list;
  if (user.role === 'super') {
    const tid = qp(req, 'tenantId');
    list = tid ? dbm.db.users.filter(u => u.tenantId === tid) : dbm.db.users;
  } else if (user.role === 'tenant_admin') {
    list = dbm.db.users.filter(u => u.tenantId === user.tenantId);
  } else if (user.role === 'supervisor') {
    list = dbm.db.users.filter(u => u.supervisorId === user.id);
  } else {
    need(false, 'Not permitted', 403);
  }
  return { ok: true,
    users: list.map(u => Object.assign(publicUser(u), {
      supervisorName: u.supervisorId ? ((dbm.byId('users', u.supervisorId) || {}).fullName || null) : null,
      progress: PARTICIPANTS.indexOf(u.role) !== -1 ? performance(u).overall : null })),
    limit: user.role === 'supervisor' ? { max: 100, used: list.length } : null };
});

function buildUserRecord(actingUser, body) {
  body = body || {};
  let tenantId = actingUser.tenantId;
  if (actingUser.role === 'super') {
    need(body.tenantId, 'Choose the account this user belongs to');
    tenantId = body.tenantId;
  } else if (actingUser.role !== 'tenant_admin' && actingUser.role !== 'supervisor') {
    need(false, 'Not permitted', 403);
  }
  const tenant = dbm.byId('tenants', tenantId);
  need(tenant, 'Account not found', 404);
  const portal = dbm.byId('portals', tenant.portalId);

  let role = body.role || 'member';
  if (actingUser.role === 'supervisor') {
    const mine = dbm.db.users.filter(u => u.supervisorId === actingUser.id);
    need(mine.length < 100, 'A supervisor can only add a maximum of 100 users', 403);
    role = 'member';
    tenantId = actingUser.tenantId;
  } else {
    const allowed = allowedRolesFor(portal.type, actingUser.role);
    need(role === 'tenant_admin' ? actingUser.role === 'tenant_admin' || actingUser.role === 'super'
      : allowed.indexOf(role) !== -1, 'That role is not allowed on this portal', 403);
  }
  need(role !== 'super', 'Not permitted', 403);

  need(body.fullName && String(body.fullName).trim().length >= 3, 'Full name is required');
  need(body.password && String(body.password).length >= 6, 'Password must be at least 6 characters');
  const email = body.email ? String(body.email).trim().toLowerCase() : null;
  const sn = body.studentNumber ? String(body.studentNumber).trim() : null;
  if (role === 'student') need(sn, 'Student number is required');
  else if (role === 'teacher' || role === 'tenant_admin' || role === 'supervisor') need(email, 'Email is required');
  need(email || sn, 'Provide an email or student number');
  need(!dbm.db.users.some(u => u.tenantId === tenantId &&
    ((email && u.email === email) || (sn && u.studentNumber && u.studentNumber.toLowerCase() === sn.toLowerCase()))),
    'An account with those details already exists', 409);

  const h = auth.hashPassword(String(body.password));
  const u = { id: dbm.uid('usr'), tenantId, role,
    supervisorId: actingUser.role === 'supervisor' ? actingUser.id
      : (role === 'supervisor' ? null : (body.supervisorId || null)),
    fullName: String(body.fullName).trim(), email, studentNumber: sn,
    className: body.className ? String(body.className).trim() : null,
    photo: body.photo || null, salt: h.salt, passwordHash: h.hash,
    createdAt: dbm.nowISO(), letterFeedbackAt: null, optionalVideoSeen: false,
    watchedVideos: [], suspended: false };
  if (role === 'supervisor') {
    u.supervisorCode = 'SUP-' + String(Math.floor(1000 + Math.random() * 9000));
  }
  return u;
}

route('POST', '/api/users', ({ user, body }) => {
  need(user, 'Sign in required', 401);
  const u = buildUserRecord(user, body);
  dbm.collection('users').push(u);
  dbm.save();
  return { ok: true, user: publicUser(u) };
});

/* Bulk insert: same validation as single create, per-row results.
   Schools portal → many students at once; organization portal → many users. */
route('POST', '/api/users/bulk', ({ user, body }) => {
  need(user, 'Sign in required', 401);
  need(user.role === 'super' || user.role === 'tenant_admin' || user.role === 'supervisor',
    'Not permitted', 403);
  body = body || {};
  const rows = body.users;
  need(Array.isArray(rows) && rows.length, 'No rows supplied');
  need(rows.length <= 500, 'Maximum 500 users per bulk insert');
  const created = [];
  const errors = [];
  rows.forEach((row, i) => {
    try {
      const doc = buildUserRecord(user, row || {});
      dbm.collection('users').push(doc);
      created.push(publicUser(doc));
    } catch (e) {
      errors.push({ index: i + 1,
        name: row && row.fullName ? String(row.fullName) : '',
        error: (e && e.message) || 'Failed' });
    }
  });
  dbm.save();
  return { ok: true, total: rows.length, created, errors };
});

/* Super admin creates a user inside any tenant (uses the same rules as POST /api/users). */
/* The super console lists every user through /api/super/users (same payload
   as GET /api/users, optionally filtered with ?tenantId=). */
route('GET', '/api/super/users', ({ req, user }) => {
  requireRole(user, ['super']);
  const tid = qp(req, 'tenantId');
  const list = tid ? dbm.db.users.filter(u => u.tenantId === tid) : dbm.db.users;
  return { ok: true,
    users: list.map(u => Object.assign(publicUser(u), {
      supervisorName: u.supervisorId ? ((dbm.byId('users', u.supervisorId) || {}).fullName || null) : null,
      progress: PARTICIPANTS.indexOf(u.role) !== -1 ? performance(u).overall : null })),
    limit: null };
});

route('POST', '/api/super/users', ({ user, body }) => {
  need(user, 'Sign in required', 401);
  need(user.role === 'super', 'Not permitted', 403);
  const u = buildUserRecord(user, body);
  dbm.collection('users').push(u);
  dbm.save();
  return { ok: true, user: publicUser(u) };
});

route('PUT', '/api/users/([a-z0-9_-]+)', ({ user, params, body }) => {
  need(user, 'Sign in required', 401);
  const t = dbm.byId('users', params[0]);
  need(t, 'User not found', 404);
  const allowed = user.role === 'super' ||
    (user.role === 'tenant_admin' && t.tenantId === user.tenantId) ||
    (user.role === 'supervisor' && t.supervisorId === user.id);
  need(allowed, 'Not permitted', 403);
  body = body || {};
  if (t.role === 'super' && user.role !== 'super') need(false, 'Not permitted', 403);
  if (body.fullName) t.fullName = String(body.fullName).trim();
  if (body.className !== undefined) t.className = body.className || null;
  if (body.email) t.email = String(body.email).trim().toLowerCase();
  if (body.studentNumber) t.studentNumber = String(body.studentNumber).trim();
  if (body.photo !== undefined) t.photo = body.photo;
  if (body.password) {
    need(String(body.password).length >= 6, 'Password must be at least 6 characters');
    const h = auth.hashPassword(String(body.password));
    t.salt = h.salt; t.passwordHash = h.hash;
  }
  if (body.role && (user.role === 'super' || user.role === 'tenant_admin') && t.role !== 'super') {
    t.role = body.role;
  }
  if (body.suspended !== undefined && user.role !== 'supervisor') {
    t.suspended = !!body.suspended;
    if (t.suspended) dbm.db.sessions = dbm.db.sessions.filter(s => s.userId !== t.id);
  }
  dbm.save();
  return { ok: true, user: publicUser(t) };
});

route('DELETE', '/api/users/([a-z0-9_-]+)', ({ user, params }) => {
  need(user, 'Sign in required', 401);
  const t = dbm.byId('users', params[0]);
  need(t, 'User not found', 404);
  const allowed = user.role === 'super' ||
    (user.role === 'tenant_admin' && t.tenantId === user.tenantId) ||
    (user.role === 'supervisor' && t.supervisorId === user.id);
  need(allowed, 'Not permitted', 403);
  need(t.id !== user.id, 'You cannot delete your own account', 403);
  need(t.role !== 'super', 'Not permitted', 403);
  dbm.db.sessions = dbm.db.sessions.filter(s => s.userId !== t.id);
  dbm.db.users.forEach(x => { if (x.supervisorId === t.id) x.supervisorId = null; });
  dbm.remove('users', t.id);
  return { ok: true };
});

route('PUT', '/api/admin/branding', ({ user, body }) => {
  requireRole(user, ADMINS);
  body = body || {};
  const t = user.role === 'super' ? dbm.byId('tenants', body.tenantId) : tenantOf(user);
  need(t, 'Account not found', 404);
  if (body.logo !== undefined) t.logo = body.logo;
  /* the programme logo belongs to the super admin only */
  if (body.programLogo !== undefined && user.role === 'super') t.programLogo = body.programLogo;
  if (body.themeColor !== undefined) t.themeColor = hexColor(body.themeColor);
  if (body.name && user.role === 'super') t.name = String(body.name).trim();
  dbm.save();
  return { ok: true, tenant: t };
});

/* ============================================ student progress report ===== */
/* How each learner is using the system, which level they are on, ranked by
   how much of the programme they have covered. */
route('GET', '/api/reports/students', ({ req, user }) => {
  requireRole(user, ADMINS.concat(['supervisor']));
  let list = dbm.db.users.filter(u => PARTICIPANTS.indexOf(u.role) !== -1);
  if (user.role === 'tenant_admin') list = list.filter(u => u.tenantId === user.tenantId);
  else if (user.role === 'supervisor') list = list.filter(u => u.supervisorId === user.id);
  else { const tid = qp(req, 'tenantId'); if (tid) list = list.filter(u => u.tenantId === tid); }

  const learnerIds = new Set(list.map(u => u.id));
  const activityYears = new Set();
  dbm.where('submissions', s => learnerIds.has(s.userId) && s.moduleId).forEach(s => {
    const year = String(s.createdAt || '').slice(0, 4);
    if (/^\d{4}$/.test(year)) activityYears.add(year);
  });
  dbm.where('certificates', c => learnerIds.has(c.userId) && c.type === 'module').forEach(c => {
    const year = String(c.issuedAt || '').slice(0, 4);
    if (/^\d{4}$/.test(year)) activityYears.add(year);
  });

  const students = list.map(u => {
    const perf = performance(u);
    const subs = dbm.where('submissions', s => s.userId === u.id);
    const last = subs.reduce((a, s) => (!a || String(s.createdAt || '') > a) ? s.createdAt : a, null);
    const mods = perf.modules || [];
    const activeIdx = mods.map(m => m.status).indexOf('active');
    const completed = mods.filter(m => m.status === 'completed').length;
    let level;
    if (activeIdx !== -1) {
      level = { index: activeIdx + 1, title: mods[activeIdx].title, percent: mods[activeIdx].percent, state: 'In progress' };
    } else if (mods.length && completed === mods.length) {
      level = { index: mods.length, title: 'All modules completed', percent: 100, state: 'Completed' };
    } else if (mods.length) {
      level = { index: 1, title: mods[0].title, percent: mods[0].percent || 0, state: 'Not started' };
    } else {
      level = { index: 0, title: '—', percent: 0, state: 'Not started' };
    }
    const tenant = u.tenantId ? dbm.byId('tenants', u.tenantId) : null;
    const typed = subs.filter(s => s.keywordScore != null);
    return {
      id: u.id, fullName: u.fullName, email: u.email, studentNumber: u.studentNumber,
      className: u.className, role: u.role, suspended: !!u.suspended,
      tenantId: u.tenantId, tenantName: tenant ? tenant.name : null,
      supervisorName: u.supervisorId ? ((dbm.byId('users', u.supervisorId) || {}).fullName || null) : null,
      submissions: subs.length, lastActiveAt: last,
      certificates: perf.certificates, flagged: perf.flagged,
      progress: perf.overall, modulesCompleted: completed, moduleCount: mods.length, level: level,
      keywordScore: meanOf(subs.map(s => { const a = assessOf(s); return a ? a.keywordScore : null; })),
      typedAnswers: subs.filter(s => assessOf(s)).length,
      modules: mods.map(m => ({ id: m.id, title: m.title, percent: m.percent, status: m.status })),
      recent: subs.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 6)
        .map(s => ({ type: s.type, createdAt: s.createdAt, text: String(s.text || '').slice(0, 240),
          score: s.score == null ? null : s.score, total: s.total == null ? null : s.total,
          flagged: !!s.flagged, similarity: s.similarity || 0, label: s.label || null,
          keywordScore: s.keywordScore == null ? null : s.keywordScore,
          keywordsUsed: s.keywordsUsed == null ? null : s.keywordsUsed,
          keywordsTotal: s.keywordsTotal == null ? null : s.keywordsTotal,
          keywordsMissing: s.keywordsMissing || [],
          chapter: s.chapterId ? ((dbm.byId('chapters', s.chapterId) || {}).title || null) : null,
          book: s.bookId ? ((dbm.byId('books', s.bookId) || {}).title || null) : null }))
    };
  });
  students.sort((a, b) => b.progress - a.progress || b.modulesCompleted - a.modulesCompleted ||
    b.submissions - a.submissions || String(a.fullName).localeCompare(String(b.fullName)));

  const total = students.length;
  return { ok: true, students: students, count: total,
    activityYears: Array.from(activityYears).sort().reverse(),
    average: total ? Math.round(students.reduce((s, x) => s + x.progress, 0) / total) : 0,
    finished: students.filter(s => s.moduleCount > 0 && s.modulesCompleted === s.moduleCount).length,
    started: students.filter(s => s.submissions > 0).length,
    notStarted: students.filter(s => s.submissions === 0).length };
});

route('GET', '/api/reports/module-performers', ({ req, user }) => {
  requireRole(user, ADMINS.concat(['supervisor']));
  const moduleId = qp(req, 'moduleId');
  const allCompleted = qp(req, 'scope') === 'all-completed';
  const from = qp(req, 'from');
  const to = qp(req, 'to');
  need(allCompleted || moduleId, 'Choose a module or all-modules view', 400);
  const selectedModule = allCompleted ? null : dbm.byId('modules', moduleId);
  need(allCompleted || selectedModule, 'Module not found', 404);
  need(from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to),
    'Choose a valid start and end date', 400);
  const start = new Date(from + 'T00:00:00.000Z');
  const end = new Date(to + 'T00:00:00.000Z');
  need(!Number.isNaN(start.getTime()) && start.toISOString().slice(0, 10) === from &&
    !Number.isNaN(end.getTime()) && end.toISOString().slice(0, 10) === to,
  'Choose valid calendar dates', 400);
  need(from <= to, 'The start date must be before or equal to the end date', 400);
  need(from.slice(0, 4) === to.slice(0, 4), 'Choose a period within one calendar year', 400);
  const moduleIds = allCompleted
    ? ordered(dbm.db.modules).map(module => module.id)
    : [selectedModule.id];
  need(moduleIds.length > 0, 'There are no modules to rank', 400);

  let learners = dbm.db.users.filter(u => PARTICIPANTS.indexOf(u.role) !== -1);
  if (user.role === 'tenant_admin') learners = learners.filter(u => u.tenantId === user.tenantId);
  else if (user.role === 'supervisor') learners = learners.filter(u => u.supervisorId === user.id);
  else {
    const tenantId = qp(req, 'tenantId');
    if (tenantId) learners = learners.filter(u => u.tenantId === tenantId);
  }

  const eligibleLearners = allCompleted
    ? learners.filter(student => {
      const completedModuleIds = new Set(dbm.where('certificates', certificate =>
        certificate.userId === student.id && certificate.type === 'module' &&
        moduleIds.indexOf(certificate.moduleId) !== -1 &&
        String(certificate.issuedAt || '').slice(0, 10) <= to
      ).map(certificate => certificate.moduleId));
      return completedModuleIds.size === moduleIds.length;
    })
    : learners;
  const eligibleIds = new Set(eligibleLearners.map(student => student.id));
  const moduleIdSet = new Set(moduleIds);
  const scores = new Map();
  function scoreFor(userId) {
    let result = scores.get(userId);
    if (!result) {
      result = { activityMarks: 0, activityCount: 0, objectiveScore: 0, objectiveTotal: 0 };
      scores.set(userId, result);
    }
    return result;
  }
  dbm.where('submissions', submission => eligibleIds.has(submission.userId) &&
    moduleIdSet.has(submission.moduleId) &&
    String(submission.createdAt || '').slice(0, 10) >= from &&
    String(submission.createdAt || '').slice(0, 10) <= to
  ).forEach(submission => {
    const marks = scoreFor(submission.userId);
    if (submission.type === 'objectives' && Number(submission.total) > 0) {
      const total = Number(submission.total);
      const earned = Math.max(0, Math.min(total, Number(submission.score) || 0));
      marks.activityMarks += earned * 100 / total;
      marks.activityCount++;
      marks.objectiveScore += earned;
      marks.objectiveTotal += total;
    } else if (['chapter_summary', 'letter_summary', 'book_summary'].indexOf(submission.type) !== -1) {
      const assessment = assessOf(submission);
      if (assessment && assessment.keywordScore != null && Number.isFinite(Number(assessment.keywordScore))) {
        marks.activityMarks += Math.max(0, Math.min(100, Number(assessment.keywordScore)));
        marks.activityCount++;
      }
    }
  });
  function studentRow(student) {
    const marks = scores.get(student.id) || {
      activityMarks: 0, activityCount: 0, objectiveScore: 0, objectiveTotal: 0
    };
    return {
      id: student.id, fullName: student.fullName, studentNumber: student.studentNumber,
      className: student.className,
      combinedPercent: marks.activityCount ? Math.round(marks.activityMarks / marks.activityCount) : null,
      activityCount: marks.activityCount,
      objectiveScore: marks.objectiveScore,
      objectiveTotal: marks.objectiveTotal,
      objectivePercent: marks.objectiveTotal
        ? Math.round(100 * marks.objectiveScore / marks.objectiveTotal) : null
    };
  }
  const candidates = eligibleLearners.map(studentRow);
  function topTen(metric) {
    return candidates.filter(student => student[metric] != null).sort((a, b) =>
      b[metric] - a[metric] ||
      (b.objectivePercent == null ? -1 : b.objectivePercent) -
        (a.objectivePercent == null ? -1 : a.objectivePercent) ||
      String(a.fullName).localeCompare(String(b.fullName))
    ).slice(0, 10);
  }
  return {
    ok: true,
    scope: allCompleted ? 'all-completed' : 'module',
    module: allCompleted ? null : { id: selectedModule.id, title: selectedModule.title },
    moduleCount: moduleIds.length,
    from, to,
    completedBy: allCompleted ? to : null,
    rankings: { combined: topTen('combinedPercent'), objectives: topTen('objectivePercent') }
  };
});

route('GET', '/api/admin/overview', ({ user }) => {
  need(user, 'Sign in required', 401);
  if (user.role === 'super') {
    return { ok: true, scope: 'all',
      counts: { tenants: dbm.db.tenants.length, users: dbm.db.users.length,
        submissions: dbm.db.submissions.length, certificates: dbm.db.certificates.length,
        flagged: dbm.db.submissions.filter(s => s.flagged).length } };
  }
  need(user.role === 'tenant_admin' || user.role === 'supervisor', 'Not permitted', 403);
  const tenant = tenantOf(user);
  let users = dbm.db.users.filter(u => u.tenantId === user.tenantId);
  if (user.role === 'supervisor') users = users.filter(u => u.supervisorId === user.id);
  const ids = users.map(u => u.id);
  const subs = dbm.db.submissions.filter(s => ids.indexOf(s.userId) !== -1);
  const supervisors = user.role === 'tenant_admin'
    ? users.filter(u => u.role === 'supervisor').map(s => ({
        id: s.id, fullName: s.fullName, email: s.email, code: s.supervisorCode,
        users: users.filter(u => u.supervisorId === s.id).length, limit: 100 }))
    : [];
  return { ok: true,
    branding: tenantBranding(tenant),
    portal: tenant ? (dbm.byId('portals', tenant.portalId) || {}) : {},
    counts: { users: users.length, supervisors: supervisors.length,
      submissions: subs.length, flagged: subs.filter(s => s.flagged).length,
      certificates: dbm.db.certificates.filter(c => ids.indexOf(c.userId) !== -1).length },
    supervisors,
    limit: user.role === 'supervisor' ? { max: 100, used: users.length } : null };
});

/* --------------------------------------------------- reporting views ----- */
function adminSubmissions(user, req) {
  let list;
  if (user.role === 'super') list = dbm.db.submissions.slice();
  else if (user.role === 'tenant_admin') list = dbm.db.submissions.filter(s => s.tenantId === user.tenantId);
  else if (user.role === 'supervisor') {
    const ids = dbm.db.users.filter(u => u.supervisorId === user.id).map(u => u.id);
    list = dbm.db.submissions.filter(s => ids.indexOf(s.userId) !== -1);
  } else list = [];
  if (qp(req, 'flagged') === '1') list = list.filter(s => s.flagged);
  const type = qp(req, 'type');
  if (type) list = list.filter(s => s.type === type);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 400)
    .map(s => {
      const who = dbm.byId('users', s.userId);
      const ch = s.chapterId ? dbm.byId('chapters', s.chapterId) : null;
      const bk = s.bookId ? dbm.byId('books', s.bookId) : null;
      return { id: s.id, type: s.type, createdAt: s.createdAt, text: s.text,
        color: s.color || null, label: s.label || null, score: s.score, total: s.total,
        flagged: !!s.flagged, similarity: s.similarity || 0,
        matchedWith: copyMatch(s), matchedName: (copyMatch(s) || {}).name || null,
      userName: who ? who.fullName : '(removed user)',
        userRole: who ? who.role : null,
        chapter: ch ? ch.title : null, book: bk ? bk.title : null,
        tenantId: s.tenantId };
    });
}

route('GET', '/api/admin/submissions', ({ req, user }) => {
  need(user, 'Sign in required', 401);
  need(user.role !== 'participant', 'Not permitted', 403);
  return { ok: true, submissions: adminSubmissions(user, req) };
});

route('GET', '/api/admin/certificates', ({ user }) => {
  need(user, 'Sign in required', 401);
  let list;
  if (user.role === 'super') list = dbm.db.certificates;
  else if (user.role === 'tenant_admin') list = dbm.db.certificates.filter(c => c.tenantId === user.tenantId);
  else if (user.role === 'supervisor') {
    const ids = dbm.db.users.filter(u => u.supervisorId === user.id).map(u => u.id);
    list = dbm.db.certificates.filter(c => ids.indexOf(c.userId) !== -1);
  } else list = [];
  return { ok: true, certificates: list.slice().sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)) };
});

/* Super admin: every school / organization submission, incl. copy flags. */
route('GET', '/api/super/submissions', ({ req, user }) => {
  requireRole(user, SUPER);
  return { ok: true, submissions: adminSubmissions(user, req) };
});

module.exports = { handle };









