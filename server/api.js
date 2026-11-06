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
const BUILD = '2026-11-06-video-alert-points';
const FEATURES = ['health', 'super.analytics', 'admin.analytics', 'reports.students', 'reports.student-roster',
  'reports.student-detail', 'reports.student-assessment', 'reports.module-performers', 'reports.top-performers',
  'public.top-performers', 'reading.activity', 'reading.video-alerts', 'reading.video-alert-points',
  'messaging', 'notifications', 'users.supervisor-auto-assignment', 'keywords',
  'reader.book', 'library.lock', 'library.media', 'library.letters', 'certificates', 'chapter.pages',
  'chapter.reading-gate', 'exports', 'assessment', 'assessment.admin', 'read-aloud',
  'letter.after-module'];

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
    supervisorWaitlisted: !!u.supervisorWaitlisted,
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
/* Uploads arrive as { name, base64, size } over JSON. The stored size lets the
   admin screens show how big a video/audio file is without downloading it. */
function saveUpload(file) {
  if (!file || !file.base64 || !file.name) return null;
  const cleaned = String(file.name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const id = dbm.uid('upl');
  const name = id + '-' + cleaned;
  fs.mkdirSync(UPLOADS, { recursive: true });
  const buf = Buffer.from(file.base64, 'base64');
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  return { url: '/uploads/' + name, size: Number(file.size) || buf.length };
}

/* ---------------------------------------------- attached video or audio --- */
/* A letter or a book may carry one optional video or audio. The kind is read
   from the file name so the learner's player knows <video> from <audio>. */
const AUDIO_MEDIA_EXTS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus',
  'weba', 'amr', 'mid', 'midi', 'aif', 'aiff', 'wma'];
function mediaKindFromName(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  const ext = m ? m[1].toLowerCase() : '';
  return AUDIO_MEDIA_EXTS.indexOf(ext) !== -1 ? 'audio' : 'video';
}
/* The attached media a form may send. Files are uploaded first via POST
   /api/upload, so only the finished link travels here — that keeps the progress
   bar honest and nothing is "uploaded" until the bytes are on the server. */
function mediaFieldsFrom(body) {
  const out = {};
  if (body && body.mediaUrl !== undefined) {
    const url = body.mediaUrl ? String(body.mediaUrl) : null;
    out.mediaUrl = url;
    out.mediaName = url ? (body.mediaName || null) : null;
    out.mediaSize = url ? (Number(body.mediaSize) || null) : null;
    out.mediaKind = url ? (body.mediaKind === 'audio' ? 'audio' : 'video') : null;
  }
  return out;
}
/* The media a learner may play, or null when nothing is attached. */
function mediaOut(obj) {
  return obj && obj.mediaUrl
    ? { url: obj.mediaUrl, kind: obj.mediaKind === 'audio' ? 'audio' : 'video',
        name: obj.mediaName || null, size: obj.mediaSize || null }
    : null;
}
/* Save one uploaded file and hand back its link. The media pickers call this so
   a progress bar can report the real transfer. The route is registered below,
   once the router exists. */
function handleUpload({ user, body }) {
  requireRole(user, ADMINS);
  body = body || {};
  need(body.file && body.file.base64 && body.file.name, 'Choose a file');
  const saved = saveUpload(body.file);
  need(saved, 'Upload failed');
  const kind = body.kind === 'audio' || body.kind === 'video'
    ? body.kind : mediaKindFromName(body.file.name);
  return { ok: true, url: saved.url, name: body.file.name, size: saved.size, kind };
}

/* ------------------------------------------------------------- rich text -- */
/* Letters are written in a small editor on the admin pages. Only this allow-list
   of formatting tags survives a save — the same rule the browser runs before it
   shows a letter, so nothing else can ride along into a learner's screen. */
const RICH_TAGS = ['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
  'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote'];
/* Block-level tags that may carry a text alignment. */
const RICH_ALIGN_TAGS = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote'];
function sanitizeRichHtml(html) {
  let out = String(html == null ? '' : html);
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  ['script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math'].forEach(tag => {
    out = out.replace(new RegExp('<' + tag + '[^>]*>[\\s\\S]*?<\\/' + tag + '\\s*>', 'gi'), '');
    out = out.replace(new RegExp('<\\/?' + tag + '[^>]*>', 'gi'), '');
  });
  /* every attribute goes, except a safe text alignment on a block tag */
  out = out.replace(/<([a-z][a-z0-9]*)\b([^>]*)>/gi, (m, tag, attrs) => {
    const t = String(tag).toLowerCase();
    if (RICH_TAGS.indexOf(t) === -1) return '';
    const align = /text-align\s*:\s*(left|center|right|justify)/i.exec(attrs || '');
    if (align && RICH_ALIGN_TAGS.indexOf(t) !== -1) {
      return '<' + t + ' style="text-align:' + align[1].toLowerCase() + '">';
    }
    return '<' + t + '>';
  });
  out = out.replace(/<\s*\/\s*([a-z][a-z0-9]*)\s*>/gi, (m, tag) =>
    RICH_TAGS.indexOf(String(tag).toLowerCase()) !== -1 ? '</' + tag.toLowerCase() + '>' : '');
  /* a stray angle bracket could open a new tag later — escape it, but never
     disturb the allowed tags (with their optional alignment style) */
  return out.replace(/<(?!\/?(?:p|div|br|b|strong|i|em|u|s|strike|h1|h2|h3|h4|ul|ol|li|blockquote)(?=[\s/>]))/gi, '&lt;');
}

/* -------------------------------------------------------------- routing --- */
const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, re: new RegExp('^' + pattern + '$'), handler });
}
/* The media pickers upload one file here so a progress bar can report the real
   transfer; registered after the router exists. */
route('POST', '/api/upload', handleUpload);

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

/* Small, public ranking for an account's login page. It is rebuilt on every
   request, so a newly scored activity can change the order immediately. A
   learner who has covered part of the programme is listed even when their
   written work carries no score yet — their marks simply show as a dash. Only
   profile photos that are already small enough for a login page are exposed;
   everything else falls back to the learner's initials in the browser. */
function loginPhoto(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s || s.length > 220000) return null;
  return /^(https?:\/\/|\/|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(s) ? s : null;
}
function loginDisplayName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Learner';
  if (parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.';
}
function loginTopPerformers(tenantId, limit) {
  limit = Math.max(1, Math.min(10, Number(limit) || 10));
  const moduleIds = new Set(ordered(dbm.db.modules).map(module => module.id));
  let learners = dbm.db.users.filter(u => u.tenantId === tenantId &&
    ['student', 'member'].indexOf(u.role) !== -1 && !u.suspended);

  /* "Completed all modules" means a module certificate for every current
     module. If a new module is added later, the learner can appear again. */
  if (moduleIds.size) {
    const completed = new Map();
    dbm.db.certificates.forEach(certificate => {
      if (certificate.type !== 'module' || !moduleIds.has(certificate.moduleId)) return;
      if (!completed.has(certificate.userId)) completed.set(certificate.userId, new Set());
      completed.get(certificate.userId).add(certificate.moduleId);
    });
    learners = learners.filter(learner => {
      const done = completed.get(learner.id);
      return !done || done.size < moduleIds.size;
    });
  }

  const eligible = new Set(learners.map(learner => learner.id));
  const marks = new Map();
  dbm.db.submissions.forEach(submission => {
    if (!eligible.has(submission.userId) || submission.flagged ||
      !moduleIds.has(submission.moduleId)) return;
    let percent = null;
    if (submission.type === 'objectives' && Number(submission.total) > 0) {
      const total = Number(submission.total);
      const earned = Math.max(0, Math.min(total, Number(submission.score) || 0));
      percent = earned * 100 / total;
    } else if (['chapter_summary', 'letter_summary', 'book_summary'].indexOf(submission.type) !== -1) {
      const assessment = assessOf(submission);
      if (assessment && assessment.keywordScore != null &&
        Number.isFinite(Number(assessment.keywordScore))) {
        percent = Math.max(0, Math.min(100, Number(assessment.keywordScore)));
      }
    }
    if (percent == null) return;
    const mark = marks.get(submission.userId) || { sum: 0, count: 0 };
    mark.sum += percent;
    mark.count++;
    marks.set(submission.userId, mark);
  });

  /* work handed in, scored or not — a learner answering a chapter whose key
     words are not set yet still deserves their place on the list */
  const work = new Map();
  dbm.db.submissions.forEach(submission => {
    if (!eligible.has(submission.userId) || submission.flagged) return;
    if (!moduleIds.has(submission.moduleId)) return;
    work.set(submission.userId, (work.get(submission.userId) || 0) + 1);
  });

  return learners.map(learner => {
    const mark = marks.get(learner.id) || { sum: 0, count: 0 };
    const statuses = moduleStatuses(learner);
    const coverage = meanOf(statuses.map(status => status.progress.percent));
    const cover = coverage == null ? 0 : coverage;
    const scored = mark.count ? Math.round(mark.sum / mark.count) : null;
    return {
      name: learner.fullName,
      displayName: loginDisplayName(learner.fullName),
      className: learner.className || null,
      photo: loginPhoto(learner.photo),
      marks: scored, coverage: cover,
      /* the same number the belt ranks by: marks and coverage weigh the same, so
         a learner who has covered the programme is listed before their written
         work carries a score */
      score: scored == null ? cover : Math.round((scored + cover) / 2),
      activityCount: mark.count, work: work.get(learner.id) || 0
    };
  }).filter(learner => learner.activityCount > 0 || learner.coverage > 0 || learner.work > 0)
    .sort((a, b) => b.score - a.score ||
      (b.marks == null ? -1 : b.marks) - (a.marks == null ? -1 : a.marks) ||
      b.coverage - a.coverage || b.activityCount - a.activityCount ||
      String(a.name).localeCompare(String(b.name)))
    .slice(0, limit)
    .map((learner, index) => Object.assign(learner, { rank: index + 1 }));
}

route('GET', '/api/public/top-performers', ({ req, res }) => {
  /* The ranking follows the latest scored work, so never let a browser or a
     proxy serve yesterday's order. */
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const slug = String(qp(req, 'slug') || '').trim();
  need(slug, 'Account required', 400);
  const tenant = dbm.db.tenants.find(t => t.slug === slug);
  need(tenant, 'Portal not found', 404);
  const performers = loginTopPerformers(tenant.id, qp(req, 'limit'));
  return {
    ok: true,
    tenant: { slug: tenant.slug, name: tenant.name },
    basis: 'Average of scored objective answers and written-answer key-word coverage.',
    performers
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

route('PUT', '/api/tenant/settings', ({ user, body }) => {
  requireRole(user, ADMINS);
  body = body || {};
  /* An account admin manages their own account; super may pass a tenant id. */
  const tenantId = user.role === 'super' ? (body.tenantId || user.tenantId) : user.tenantId;
  need(tenantId, 'No account selected', 400);
  const tenant = dbm.byId('tenants', tenantId);
  need(tenant, 'Account not found', 404);
  if (body.letterId !== undefined) {
    if (body.letterId) {
      const lib = dbm.byId('library', body.letterId);
      need(lib && lib.type === 'letter', 'Choose a letter from the library', 400);
      need(lib.scope === 'global' || lib.scope === tenantId,
        'That letter belongs to another account', 403);
    }
    setTenantLetter(tenantId, body.letterId || null);
  }
  return { ok: true, letterId: tenant.letterId || null };
});

route('POST', '/api/auth/logout', ({ req, res }) => {
  auth.destroySession(req, res);
  return { ok: true };
});

route('GET', '/api/me', ({ user }) => {
  need(user, 'Sign in required', 401);
  const tenant = tenantOf(user);
  const portal = tenant ? dbm.byId('portals', tenant.portalId) : null;
  const letter = resolveLetterFor(tenant);
  const video = dbm.byId('library', dbm.db.settings.letterVideoId);
  return {
    ok: true,
    user: publicUser(user),
    branding: tenantBranding(tenant),
    portal: portal ? { name: portal.name, active: portalActive(portal),
      scheduleMode: portal.scheduleMode, windows: portal.windows || [] } : null,
    letter: { id: letter ? letter.id : null, title: letter ? letter.title : null,
      text: letter ? letter.text : null, media: mediaOut(letter),
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
/* A chapter of an objectives module may carry ANY number of questions — the
   school/organization administrator and the super admin keep adding them. Each
   learner is served only THREE of them, and the three are drawn afresh on every
   LOGIN: the draw is seeded by the account id plus the session token, so a logout
   and login hands the student a different three (and a different option order),
   while the same login sees the same three back on a reload. Two students never
   get the same three in the same order, so nothing can be copied. The submission
   is marked against the draw of the login that sends it, so nothing outside the
   three that were actually served is ever marked. Mirrors
   objectives_for_learner() in php/engine.php. */
const OBJECTIVE_PICK = 3;
function learnerObjectives(user, chapterId, tenantId, token) {
  const all = objectivesOf(chapterId, tenantId);
  if (!all.length) return all;
  const draw = shuffleWithSeed(all, user.id + '|' + chapterId + '|objectives|' + (token || ''));
  return draw.slice(0, OBJECTIVE_PICK);
}
function findSub(userId, type, match) {
  const keys = match ? Object.keys(match) : [];
  return dbm.where('submissions', s => s.userId === userId && s.type === type &&
    keys.every(k => s[k] === match[k]))[0] || null;
}
/* ------------------------------------------------ chapter reading gate --- */
/* A chapter's work may only be answered once its OWN pages have been read to
   the LAST page. The reader reports every page it reaches; the last page marks
   the chapter read. The mark is kept on the server, so a reload (or a direct
   call to the API) cannot skip the reading, and it is never taken away — a
   learner may always go back and read the chapter again.
   The gate only applies where there is something to read: a chapter needs its
   own page range AND its book needs a PDF. A chapter without pages stays
   answerable, exactly as before. */
function chapterPageRange(chapter) {
  const from = Number(chapter && chapter.pageStart) || 0;
  const to = Number(chapter && chapter.pageEnd) || 0;
  return (from > 0 && to >= from) ? { from, to } : null;
}
function bookPdfUrl(book) {
  const lib = book && book.libraryId ? dbm.byId('library', book.libraryId) : null;
  return lib && lib.type === 'book' ? String(lib.url || '') : '';
}
/* the pages a learner must read before answering, or null when there are none */
function readingRangeOf(book, chapter) {
  const pages = chapterPageRange(chapter);
  return pages && bookPdfUrl(book) ? pages : null;
}
function findChapterRead(userId, chapterId) {
  return dbm.where('chapter_reads', r => r.userId === userId && r.chapterId === chapterId)[0] || null;
}
function chapterReadDone(userId, chapterId) {
  const row = findChapterRead(userId, chapterId);
  return !!(row && row.completedAt);
}
function requireChapterRead(user, book, chapter) {
  const range = readingRangeOf(book, chapter);
  if (!range) return;
  need(chapterReadDone(user.id, chapter.id),
    'Read "' + String((chapter && chapter.title) || 'this chapter') + '" to its last page (page ' +
    range.to + ') before answering. Open the chapter pages and turn to page ' + range.to + '.', 403);
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
  return s ? { id: s.id, createdAt: s.createdAt, submittedAt: s.submittedAt || s.createdAt, score: s.score,
    total: s.total == null ? null : s.total, flagged: !!s.flagged,
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
    /* the answer area opens only at the chapter's last page (see the reading
       gate above); a chapter with no pages of its own is always answerable */
    const range = readingRangeOf(book, ch);
    const readRow = findChapterRead(user.id, ch.id);
    /* the whole bank the administrators wrote, and how many of it is asked */
    const objPool = objectivesOf(ch.id, tenantId).length;
    const state = {
      id: ch.id, title: ch.title, content: ch.content,
      pageStart: ch.pageStart, pageEnd: ch.pageEnd, order: ch.order,
      objectiveCount: objPool,
      objectivePick: Math.min(OBJECTIVE_PICK, objPool),
      keywords: kwords.list, keywordsSource: kwords.source,
      requiresReading: !!range,
      read: !range || !!(readRow && readRow.completedAt),
      readAt: readRow && readRow.completedAt ? readRow.completedAt : null,
      lastPage: readRow && readRow.lastPage != null ? Number(readRow.lastPage) : null,
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
      letter = lib ? { id: lib.id, title: lib.title, text: lib.text, media: mediaOut(lib) } : null;
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
  /* the letter this module closes with (only when the admin turned it on and
     wrote at least one question) */
  const letterMeta = moduleLetterMeta(module);
  const letterOn = letterMeta.enabled && letterMeta.pool > 0;
  const letterSub = letterOn ? findSub(user.id, 'module_letter', { moduleId: module.id }) : null;

  /* THE ORDER OF THESE FOUR TESTS IS THE RULE: the letter the admin switched on
     outranks a best-book pick that was made before it was switched on, so a
     learner cannot reach the video, the certificate — or the next module —
     with the letter still unanswered. A certificate already issued is history
     and is never taken back. */
  let stage = 'work';
  if (cert) stage = 'certified';
  else if (allBooks && letterOn && !letterSub) stage = 'letter';
  else if (bestPick) stage = 'video';
  else if (allBooks) stage = 'best_book';

  let total = 2; // best book pick + certificate
  if (letterOn) total++;
  let done = 0;
  states.forEach(s => {
    s.chapters.forEach(c => { total++; if (c.submission) done++; });
    if (module.mode === 'summary') { total++; if (s.letterSubmission) done++; }
    else { s.summaries.forEach(x => { total++; if (x.submission) done++; }); }
  });
  if (letterSub) done++;
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
    /* the closing letter: on/off, how many questions, the learner's result and
       where they go once it is answered */
    letter: letterOn ? { meta: letterMeta, open: !letterSub,
      next: moduleLetterNext(user, module), submission: subMeta(letterSub) } : null,
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

/* ======================================= the letter after a module ======= */
/* The super admin writes a pool of up to ten questions for the letter that
   closes a module. Each learner answers only TWO of them: the pair is drawn
   from the pool with the learner's own account as the seed, so every student
   sees a different two, in a different order, while the same student always
   sees the same two. While the questions are live the letter itself is veiled
   (blurred) so an answer is written from what was read, never copied. */
const LETTER_POOL_MAX = 10;
const LETTER_PICK = 2;

/* One authored question: a prompt plus (for objective mode) up to six
   options and the index of the right one. */
function normalizeLetterQuestions(list) {
  return (Array.isArray(list) ? list : []).map((q, i) => {
    const src = q && typeof q === 'object' ? q : { question: q };
    const question = String(src.question || src.text || '').trim();
    if (!question) return null;
    const options = (Array.isArray(src.options) ? src.options : [])
      .map(o => (o && typeof o === 'object' ? String(o.text || '') : String(o == null ? '' : o)).trim())
      .filter(Boolean).slice(0, 6);
    let answerIndex = Number(src.answerIndex);
    if (!Number.isFinite(answerIndex) || answerIndex < 0 || answerIndex >= options.length) answerIndex = 0;
    return {
      id: String(src.id || ('q' + (i + 1))),
      question,
      options,
      answerIndex: options.length ? answerIndex : null
    };
  }).filter(Boolean).slice(0, LETTER_POOL_MAX)
    .map((q, i) => ({ id: q.id || ('q' + (i + 1)), question: q.question,
      options: q.options, answerIndex: q.answerIndex }));
}

/* Where a learner goes once the letter is answered: if a best book was already
   picked (before the admin switched the letter on) the certificate is next,
   otherwise the best-book pick is. */
function moduleLetterNext(user, mod) {
  return findSub(user.id, 'best_book', { moduleId: mod.id }) ? 'video' : 'best_book';
}

/* The authored pool of one module (empty when nothing has been written yet). */
function letterQuestions(mod) {
  return normalizeLetterQuestions(mod && mod.letter ? mod.letter.questions : null);
}

/* What the admin screen and the learner screen need to know about the letter:
   whether it is on, which library letter it carries, which answering style it
   uses and how many questions are in the pool. */
function moduleLetterMeta(mod) {
  const src = mod && mod.letter && typeof mod.letter === 'object' ? mod.letter : {};
  const list = letterQuestions(mod);
  return {
    enabled: src.enabled === undefined ? list.length > 0 : !!src.enabled,
    letterId: src.letterId || null,
    mode: src.mode === 'summary' ? 'summary' : 'objectives',
    pool: list.length,
    pick: list.length ? Math.min(LETTER_PICK, list.length) : 0
  };
}

/* The letter the module's questions belong to: the module's own pick first,
   then the programme's Letter from Christ, so a module can reuse it. */
function moduleLetterDoc(mod) {
  const meta = moduleLetterMeta(mod);
  const lib = (meta.letterId && dbm.byId('library', meta.letterId)) ||
    dbm.byId('library', dbm.db.settings.letterId);
  if (!lib) return null;
  return { id: lib.id, title: lib.title, text: lib.text, media: mediaOut(lib) };
}

/* What the super admin may save for a module's letter: the on/off switch, the
   library letter it carries, the answering style ('objectives' = pick one of
   the options, 'summary' = type an answer) and the pool of questions. Blank
   rows are dropped and the pool is capped at ten. */
function normalizeModuleLetterInput(src) {
  const obj = src && typeof src === 'object' ? src : {};
  const list = normalizeLetterQuestions(obj.questions);
  return {
    enabled: obj.enabled === undefined ? list.length > 0 : !!obj.enabled,
    letterId: obj.letterId ? String(obj.letterId) : null,
    mode: obj.mode === 'summary' ? 'summary' : 'objectives',
    questions: list
  };
}

/* The TWO questions this learner has to answer, in their own stable order.
   Options are shuffled per login (the submission maps the chosen text back to
   the authored index, exactly like chapter objectives). */
function moduleLetterFor(user, mod, opts) {
  const meta = moduleLetterMeta(mod);
  if (!meta.enabled || !meta.pool) return null;
  const token = (opts && opts.token) || '';
  const all = letterQuestions(mod);
  const order = shuffleWithSeed(all, user.id + '|' + mod.id + '|letter');
  const chosen = order.slice(0, meta.pick);
  return {
    mode: meta.mode,
    letter: moduleLetterDoc(mod),
    counts: { pool: meta.pool, pick: meta.pick },
    questions: chosen.map(q => ({
      id: q.id,
      question: q.question,
      options: q.options.length ? shuffleWithSeed(q.options, q.id + token) : []
    }))
  };
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

/* ============================================ self-assessment (pre/post) === */
/* The definition is seeded from assessment.json on first use, then owned by
   the database so the super admin can add, edit and delete categories and
   objective questions after deployment. The same shape serves BOTH backends.
   The learner rates it once at the beginning (pre-score, right before the
   Letter from Christ) and once at the end (post-score, after the last
   module); each response carries its own total score. */
function defaultScale() {
  return [
    { value: 1, label: 'Strongly Disagree' }, { value: 2, label: 'Disagree' },
    { value: 3, label: 'Neutral' }, { value: 4, label: 'Agree' },
    { value: 5, label: 'Strongly Agree' }
  ];
}
function defaultAssessmentDef() {
  const file = path.join(__dirname, '..', 'assessment.json');
  try {
    return normalizeAssessmentDef(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    return { scale: defaultScale(), note: '', categories: [] };
  }
}
function normalizeAssessmentDef(def) {
  def = def && typeof def === 'object' ? def : {};
  const scale = Array.isArray(def.scale) && def.scale.length ? def.scale : defaultScale();
  const categories = (Array.isArray(def.categories) ? def.categories : [])
    .filter(c => c && c.id && c.title)
    .map((c, ci) => ({
      id: String(c.id),
      title: String(c.title).trim(),
      order: Number.isFinite(Number(c.order)) ? Number(c.order) : ci + 1,
      statements: (Array.isArray(c.statements) ? c.statements : [])
        .filter(s => s && s.id && s.text)
        .map((s, si) => ({
          id: String(s.id),
          text: String(s.text).trim(),
          order: Number.isFinite(Number(s.order)) ? Number(s.order) : si + 1
        }))
    }));
  return { scale: scale, note: String(def.note || ''), categories: categories };
}
function assessmentDef() {
  if (!dbm.db.assessment) {
    dbm.db.assessment = defaultAssessmentDef();
    dbm.save();
  }
  dbm.db.assessment = normalizeAssessmentDef(dbm.db.assessment);
  return dbm.db.assessment;
}
function saveAssessmentDef(def) {
  dbm.db.assessment = normalizeAssessmentDef(def);
  dbm.save();
  return dbm.db.assessment;
}
/* Empty categories are still being set up; participants and reports only see
   categories that already carry at least one objective question. */
function assessmentActiveDef(def) {
  const active = normalizeAssessmentDef(def);
  active.categories = active.categories.filter(c => c.statements.length > 0);
  return active;
}
function assessmentStatementIds(def) {
  const ids = [];
  (def.categories || []).forEach(c => (c.statements || []).forEach(s => ids.push(s.id)));
  return ids;
}
function assessmentCategoryId(def, title) {
  const base = slugify(title) || 'category';
  const used = new Set((def.categories || []).map(c => c.id));
  let id = base, n = 2;
  while (used.has(id)) id = base + '-' + n++;
  return id;
}
function assessmentStatementId(category) {
  const used = new Set((category.statements || []).map(s => s.id));
  let id;
  /* never reuse a deleted question's id: historical pre/post answers are keyed
     by it, and a new question must not inherit somebody else's ratings */
  do {
    id = category.id + '-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  } while (used.has(id));
  return id;
}
function assessmentCategoryById(def, id) {
  return (def.categories || []).find(c => c.id === id) || null;
}
function assessmentStatementById(def, id) {
  for (const category of (def.categories || [])) {
    const statement = (category.statements || []).find(s => s.id === id);
    if (statement) return { category, statement };
  }
  return null;
}
function assessmentStatementCount(def) {
  return (def.categories || []).reduce((total, c) => total + (c.statements || []).length, 0);
}
/* Every statement must be rated with an integer 1-5 — anything else is
   rejected before it can be stored, so a total always means something. */
function assessmentAnswers(body, def) {
  const raw = (body && typeof body.answers === 'object' && body.answers) || {};
  const ids = assessmentStatementIds(def);
  need(ids.length > 0, 'The self-assessment has no objective questions yet');
  const answers = {};
  ids.forEach(id => {
    const v = Number(raw[id]);
    need(Number.isInteger(v) && v >= 1 && v <= 5, 'Please rate every statement from 1 to 5');
    answers[id] = v;
  });
  return answers;
}
function assessmentTotals(answers, def) {
  let total = 0;
  const byCategory = {};
  (def.categories || []).forEach(c => {
    let cat = 0;
    (c.statements || []).forEach(s => { cat += Number(answers[s.id]) || 0; });
    byCategory[c.id] = { total: cat, max: (c.statements || []).length * 5 };
    total += cat;
  });
  const statements = assessmentStatementIds(def).length;
  return { total, max: statements * 5, byCategory };
}
/* Compact pre/post summary used by both progress reports and the popup. */
function assessmentForReport(user, def) {
  def = assessmentActiveDef(def);
  function one(record) {
    if (!record || !record.answers) return null;
    const t = assessmentTotals(record.answers, def);
    return {
      at: record.at || null, total: t.total, max: t.max,
      percent: t.max ? Math.round(t.total / t.max * 100) : 0,
      categories: def.categories.map(c => {
        const v = t.byCategory[c.id] || { total: 0, max: 0 };
        return { id: c.id, title: c.title, total: v.total, max: v.max,
          percent: v.max ? Math.round(v.total / v.max * 100) : 0 };
      })
    };
  }
  const pre = one(user.assessmentPre);
  const post = one(user.assessmentPost);
  return { pre: pre, post: post, growth: pre && post ? post.total - pre.total : null };
}
function assessmentReportScope(user, studentId) {
  const student = dbm.byId('users', studentId);
  need(student && ['student', 'teacher', 'member'].includes(student.role), 'Student not found', 404);
  if (user.role === 'tenant_admin') need(student.tenantId === user.tenantId, 'Not permitted', 403);
  else if (user.role === 'supervisor') need(student.supervisorId === user.id, 'Not permitted', 403);
  return student;
}
route('GET', '/api/assessment', ({ user }) => {
  requireRole(user, PARTICIPANTS);
  const def = assessmentActiveDef(assessmentDef());
  const allDone = flowFor(user).allDone;
  return {
    ok: true, scale: def.scale, categories: def.categories, note: def.note || '',
    pre: user.assessmentPre || null, post: user.assessmentPost || null,
    totals: {
      pre: user.assessmentPre ? assessmentTotals(user.assessmentPre.answers, def) : null,
      post: user.assessmentPost ? assessmentTotals(user.assessmentPost.answers, def) : null
    },
    allDone
  };
});
route('POST', '/api/assessment/pre', ({ user, body }) => {
  requireRole(user, PARTICIPANTS);
  need(!user.assessmentPre, 'Your pre-score has already been submitted');
  const def = assessmentActiveDef(assessmentDef());
  const answers = assessmentAnswers(body, def);
  const t = assessmentTotals(answers, def);
  user.assessmentPre = { answers, total: t.total, max: t.max, at: dbm.nowISO() };
  dbm.save();
  return { ok: true, pre: user.assessmentPre, total: t.total, max: t.max };
});
route('POST', '/api/assessment/post', ({ user, body }) => {
  requireRole(user, PARTICIPANTS);
  need(flowFor(user).allDone, 'The post-score opens after the last module is complete');
  need(!user.assessmentPost, 'Your post-score has already been submitted');
  const def = assessmentActiveDef(assessmentDef());
  const answers = assessmentAnswers(body, def);
  const t = assessmentTotals(answers, def);
  user.assessmentPost = { answers, total: t.total, max: t.max, at: dbm.nowISO() };
  dbm.save();
  const growth = user.assessmentPre ? t.total - user.assessmentPre.total : null;
  return { ok: true, post: user.assessmentPost, total: t.total, max: t.max, growth };
});

/* Super-admin management: the saved definition is global and shared by every
   account, exactly like the learner form it drives. */
function assessmentPublicDef(def) {
  def = normalizeAssessmentDef(def);
  return {
    scale: def.scale, note: def.note,
    categories: def.categories.map(c => ({
      id: c.id, title: c.title, order: c.order, max: c.statements.length * 5,
      statements: c.statements.map(s => ({ id: s.id, text: s.text, order: s.order }))
    })),
    statementCount: assessmentStatementCount(def),
    max: assessmentStatementCount(def) * 5
  };
}
route('GET', '/api/super/assessment', ({ user }) => {
  requireRole(user, SUPER);
  return { ok: true, assessment: assessmentPublicDef(assessmentDef()) };
});
route('POST', '/api/super/assessment/categories', ({ user, body }) => {
  requireRole(user, SUPER);
  body = body || {};
  const title = String(body.title || '').trim();
  need(title.length >= 2, 'Enter a category name (at least 2 characters)');
  const def = assessmentDef();
  const category = { id: assessmentCategoryId(def, title), title, order: def.categories.length + 1, statements: [] };
  def.categories.push(category);
  saveAssessmentDef(def);
  return { ok: true, assessment: assessmentPublicDef(def), category: category };
});
route('PUT', '/api/super/assessment/categories/([A-Za-z0-9_-]+)', ({ user, params, body }) => {
  requireRole(user, SUPER);
  body = body || {};
  const def = assessmentDef();
  const category = assessmentCategoryById(def, params[0]);
  need(category, 'Category not found', 404);
  const title = String(body.title || '').trim();
  need(title.length >= 2, 'Enter a category name (at least 2 characters)');
  category.title = title;
  saveAssessmentDef(def);
  return { ok: true, assessment: assessmentPublicDef(def), category: category };
});
route('DELETE', '/api/super/assessment/categories/([A-Za-z0-9_-]+)', ({ user, params }) => {
  requireRole(user, SUPER);
  const def = assessmentDef();
  const category = assessmentCategoryById(def, params[0]);
  need(category, 'Category not found', 404);
  const remaining = assessmentStatementCount(def) - category.statements.length;
  need(remaining > 0, 'Keep at least one objective question in the self-assessment');
  def.categories = def.categories.filter(c => c.id !== category.id);
  saveAssessmentDef(def);
  return { ok: true, assessment: assessmentPublicDef(def) };
});
route('POST', '/api/super/assessment/categories/([A-Za-z0-9_-]+)/statements', ({ user, params, body }) => {
  requireRole(user, SUPER);
  body = body || {};
  const def = assessmentDef();
  const category = assessmentCategoryById(def, params[0]);
  need(category, 'Category not found', 404);
  const text = String(body.text || '').trim();
  need(text.length >= 5, 'Enter the objective question (at least 5 characters)');
  const statement = { id: assessmentStatementId(category), text: text, order: category.statements.length + 1 };
  category.statements.push(statement);
  saveAssessmentDef(def);
  return { ok: true, assessment: assessmentPublicDef(def), statement: statement };
});
route('PUT', '/api/super/assessment/statements/([A-Za-z0-9_-]+)', ({ user, params, body }) => {
  requireRole(user, SUPER);
  body = body || {};
  const def = assessmentDef();
  const found = assessmentStatementById(def, params[0]);
  need(found, 'Objective question not found', 404);
  const text = String(body.text || '').trim();
  need(text.length >= 5, 'Enter the objective question (at least 5 characters)');
  found.statement.text = text;
  saveAssessmentDef(def);
  return { ok: true, assessment: assessmentPublicDef(def), statement: found.statement };
});
route('DELETE', '/api/super/assessment/statements/([A-Za-z0-9_-]+)', ({ user, params }) => {
  requireRole(user, SUPER);
  const def = assessmentDef();
  const found = assessmentStatementById(def, params[0]);
  need(found, 'Objective question not found', 404);
  need(assessmentStatementCount(def) > 1, 'Keep at least one objective question in the self-assessment');
  found.category.statements = found.category.statements.filter(s => s.id !== found.statement.id);
  saveAssessmentDef(def);
  return { ok: true, assessment: assessmentPublicDef(def) };
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

/* The letter that closes a module, with the TWO questions this account has to
   answer. The questions are issued only at the letter stage, so they are not
   readable while the books are still being worked on; the pool of ten never
   leaves the server as a whole. Once submitted the learner sees their own two
   questions again, with the answers they gave. */
route('GET', '/api/module/([a-z0-9_-]+)/letter', ({ user, token, params }) => {
  requireRole(user, PARTICIPANTS);
  const module = dbm.byId('modules', params[0]);
  need(module, 'Module not found', 404);
  const st = moduleStatuses(user).find(m => m.id === module.id);
  need(st, 'Module not found', 404);
  const meta = moduleLetterMeta(module);
  need(meta.enabled && meta.pool > 0, 'This module has no letter questions', 400);
  const done = findSub(user.id, 'module_letter', { moduleId: module.id });

  if (done) {
    return { ok: true, submitted: true, live: false, stage: st.progress.stage,
      letter: moduleLetterDoc(module), mode: meta.mode,
      counts: { pool: meta.pool, pick: meta.pick }, submission: subMeta(done),
      next: moduleLetterNext(user, module),
      questions: (done.answers || []).map(a => ({
        id: a.questionId, question: a.question, options: [],
        yourChoice: a.chosen || null, yourText: a.text || null,
        correct: a.correct === undefined || a.correct === null ? null : !!a.correct,
        answer: a.answer || null
      })) };
  }

  need(st.progress.stage === 'letter',
    'The letter opens once every book of this module is finished', 403);
  const out = moduleLetterFor(user, module, { token });
  return { ok: true, submitted: false, live: true, stage: st.progress.stage,
    letter: out.letter, mode: out.mode, counts: out.counts, questions: out.questions,
    next: moduleLetterNext(user, module) };
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
      pdfTitle: lib ? lib.title : null, media: mediaOut(book) }),
    chapters: progress.chapters, stage: progress.stage, summaries: progress.summaries,
    letter: progress.letter, letterSubmission: progress.letterSubmission };
});

/* The three objectives this learner has to answer, drawn afresh for this login
   (answers hidden until submitted). The rest of the chapter's bank stays on the
   server: it is never sent, and it is never marked. */
route('GET', '/api/chapter/([a-z0-9_-]+)/objectives', ({ user, token, params }) => {
  requireRole(user, PARTICIPANTS);
  const chapter = dbm.byId('chapters', params[0]);
  need(chapter, 'Chapter not found', 404);
  const book = dbm.byId('books', chapter.bookId);
  need(book.scope === 'global' || book.scope === user.tenantId, 'Not available', 403);
  const pool = objectivesOf(chapter.id, user.tenantId);
  const picked = learnerObjectives(user, chapter.id, user.tenantId, token);
  const counts = { pool: pool.length, pick: picked.length };
  const done = findSub(user.id, 'objectives', { chapterId: chapter.id });

  if (done) {
    /* only what this learner was served is shown back — the answers they gave,
       not the questions they were never asked */
    const answers = Array.isArray(done.answers) && done.answers.length
      ? done.answers
      : picked.map(o => ({ objectiveId: o.id }));
    return { ok: true, submitted: true, counts, submission: subMeta(done),
      objectives: answers.map(a => {
        const o = dbm.byId('objectives', a.objectiveId) || null;
        return { id: a.objectiveId,
          question: o ? o.question : 'This question is no longer in the chapter',
          options: o ? o.options : [],
          yourChoice: a.choice == null ? null : a.choice,
          correct: a.correct == null ? null : !!a.correct,
          answerIndex: o ? o.answerIndex : null };
      }) };
  }
  const shuffled = shuffledForLogin(user, token, picked);
  return { ok: true, submitted: false, counts,
    objectives: shuffled.map(o => ({ id: o.id, question: o.question, options: shuffleWithSeed(o.options, o.id + token) })) };
});

/* The reader reports the page it has reached. Reaching the chapter's LAST page
   records that the chapter has been read; that record is what opens the answer
   area. Earlier pages only update the bookmark, so a learner can go back and
   re-read without losing the unlock. */
route('POST', '/api/chapter/([a-z0-9_-]+)/read', ({ user, params, body }) => {
  requireRole(user, PARTICIPANTS);
  const chapter = dbm.byId('chapters', params[0]);
  need(chapter, 'Chapter not found', 404);
  const book = dbm.byId('books', chapter.bookId);
  need(book && (book.scope === 'global' || book.scope === user.tenantId), 'Not available', 403);
  const module = dbm.byId('modules', book.moduleId);
  const st = moduleStatuses(user).find(m => m.id === module.id);
  need(st, 'Module not found', 404);
  need(st.status === 'active', 'This module is not active for you right now', 403);

  body = body || {};
  const range = readingRangeOf(book, chapter);
  const page = Math.max(0, Number(body.page) || 0);
  const existing = findChapterRead(user.id, chapter.id);
  if (!range) {
    /* nothing to read: an answer area that has no pages stays open */
    return { ok: true, required: false, read: true, lastPage: page, pageEnd: null,
      readAt: existing && existing.completedAt ? existing.completedAt : null };
  }
  const reached = Math.min(Math.max(page, range.from), range.to);
  const done = reached >= range.to;
  let row = existing;
  if (!row) {
    row = { id: dbm.uid('crd'), tenantId: user.tenantId, userId: user.id,
      chapterId: chapter.id, bookId: book.id, lastPage: reached, pageEnd: range.to,
      completedAt: done ? dbm.nowISO() : null, createdAt: dbm.nowISO() };
    dbm.collection('chapter_reads').push(row);
    dbm.save();
  } else {
    let touched = false;
    if (reached > (Number(row.lastPage) || 0)) { row.lastPage = reached; touched = true; }
    if (done && !row.completedAt) { row.completedAt = dbm.nowISO(); touched = true; }
    if (Number(row.pageEnd) !== range.to) { row.pageEnd = range.to; touched = true; }
    if (touched) dbm.save();
  }
  return { ok: true, required: true, read: !!row.completedAt,
    lastPage: Number(row.lastPage) || 0, pageEnd: range.to, readAt: row.completedAt || null };
});

/* ------------------------------------------------------- submissions ----- */
route('POST', '/api/submissions', ({ user, token, body }) => {
  requireRole(user, PARTICIPANTS);
  body = body || {};
  const type = String(body.type || '');
  const now = dbm.nowISO();
  const tenantId = user.tenantId;
  let text = body.text != null ? String(body.text).trim() : '';
  let sub = null;
  let warning = null;
  let assessment = null;
  let videoAlert = null;

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
    } else if (base.moduleId) {
      /* a letter answered in typed words is measured against the module's own
         chapters, the same reading the questions were written from */
      const bids = dbm.where('books', b => b.moduleId === base.moduleId).map(b => b.id);
      const chs = dbm.where('chapters', c => bids.indexOf(c.bookId) !== -1);
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
      id: dbm.uid('sub'), userId: user.id, tenantId, createdAt: now, submittedAt: now,
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
    createSubmissionNotification(user, sub);
    videoAlert = maybeSendVideoAlert(user, sub);
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
    requireChapterRead(user, book, chapter);
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
    requireChapterRead(user, book, chapter);
    need(!findSub(user.id, 'objectives', { chapterId: chapter.id }), 'You already submitted this chapter');
    /* only the three questions this login was served are marked */
    const served = learnerObjectives(user, chapter.id, tenantId, token);
    need(served.length, 'No objectives have been set for this chapter yet. Ask your administrator.');
    const answers = Array.isArray(body.answers) ? body.answers : [];
    let score = 0;
    const detail = [];
    served.forEach(o => {
      const a = answers.find(x => x && x.objectiveId === o.id);
      need(a, 'Answer every objective before submitting');
      const choice = Number(a.choice);
      const shuffledOpts = shuffleWithSeed(o.options, o.id + (token || ''));
      const chosenText = (choice >= 0 && choice < shuffledOpts.length) ? shuffledOpts[choice] : null;
      const originalChoice = chosenText != null ? o.options.indexOf(chosenText) : choice;
      const correct = originalChoice === o.answerIndex;
      if (correct) score++;
      detail.push({ objectiveId: o.id, choice: originalChoice, correct });
    });
    store({ type, chapterId: chapter.id, bookId: book.id, moduleId: mod.id,
      answers: detail, score, total: served.length }, {});

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
    /* the letter closes the module before the best book is chosen */
    need(mp.stage !== 'letter', 'Answer the letter that closes this module first', 403);
    need(mp.stage === 'best_book', 'Complete every book in this module before choosing the best book', 403);
    const book = dbm.byId('books', body.bookId);
    need(book && (book.scope === 'global' || book.scope === tenantId), 'Book not found', 404);
    const entry = mp.books.find(b => b.book.id === book.id);
    need(entry && entry.complete, 'That book is not complete yet', 403);
    store({ type, moduleId: mod.id, bookId: book.id }, { moduleId: mod.id });

  } else if (type === 'module_letter') {
    const mod = dbm.byId('modules', body.moduleId);
    need(mod, 'Module not found', 404);
    activeModule(mod);
    const meta = moduleLetterMeta(mod);
    need(meta.enabled && meta.pool > 0, 'This module has no letter questions');
    const mp = moduleProgress(user, mod);
    need(mp.stage === 'letter', 'Finish every book of this module before answering the letter', 403);
    need(!findSub(user.id, 'module_letter', { moduleId: mod.id }), 'You already answered this letter');
    /* only the two questions this account was given may be answered */
    const picked = moduleLetterFor(user, mod, { token });
    const answers = Array.isArray(body.answers) ? body.answers : [];
    need(answers.length === picked.questions.length,
      'Answer exactly ' + picked.questions.length + ' questions');
    const pool = letterQuestions(mod);
    const byId = {};
    answers.forEach(a => { if (a && a.questionId) byId[String(a.questionId)] = a; });
    const detail = [];
    let score = 0;
    let objectiveCount = 0;
    picked.questions.forEach(q => {
      const src = pool.find(x => x.id === q.id) ||
        { id: q.id, question: q.question, options: [], answerIndex: null };
      const a = byId[q.id];
      need(a, 'Answer both questions before submitting');
      if (meta.mode === 'summary') {
        const typed = String(a.text == null ? '' : a.text).trim();
        need(typed.length >= 15, 'Write at least 15 characters in your own words for each question');
        detail.push({ questionId: q.id, question: src.question, text: typed });
      } else {
        need(src.options.length >= 2, 'This question has no options yet — ask your administrator');
        objectiveCount++;
        const shuffled = shuffleWithSeed(src.options, q.id + (token || ''));
        const choice = Number(a.choice);
        const chosenText = (choice >= 0 && choice < shuffled.length) ? shuffled[choice] : null;
        need(chosenText != null, 'Choose an answer for every question');
        const originalChoice = src.options.indexOf(chosenText);
        const correct = originalChoice === src.answerIndex;
        if (correct) score++;
        detail.push({ questionId: q.id, question: src.question, choice: originalChoice,
          chosen: chosenText, answer: src.options[src.answerIndex], correct });
      }
    });
    /* typed answers feed the same key-word / copy checks as a chapter summary */
    if (meta.mode === 'summary') text = detail.map(d => d.question + '\n' + d.text).join('\n\n');
    store({ type, moduleId: mod.id, answers: detail,
      score: objectiveCount ? score : null, total: objectiveCount || null }, { moduleId: mod.id });

  } else if (type === 'general_summary') {
    const statuses = moduleStatuses(user);
    need(statuses.length && statuses.every(s => s.status === 'completed'),
      'Complete every module before the general summary', 403);
    requireText();
    store({ type }, {});

  } else {
    need(false, 'Unknown submission type');
  }

  return { ok: true, submission: subMeta(sub), assessment: assessment, warning: warning, videoAlert: videoAlert };
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
    createCompletionNotification(user);
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
  createCompletionNotification(user);
  return gen;
}

route('POST', '/api/certificates/issue', ({ user, body }) => {
  requireRole(user, PARTICIPANTS);
  body = body || {};
  const mod = dbm.byId('modules', body.moduleId);
  need(mod, 'Module not found', 404);
  const mp = moduleProgress(user, mod);
  /* a certificate is the end of a module, so the letter must be answered first */
  need(mp.stage !== 'letter', 'Answer the letter that closes this module first', 403);
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

/* ============================================================ reading ===== */
/* One row per open, so an account admin can read three things off the
   analytics page: how often a book is opened, which books have been opened at
   least once by a learner, and how often one learner opened one book. A book is
   either a book of a module (the reader inside the programme) or a book kept in
   the library; both are counted, and the title is stored with the open so a
   removed book still shows up in the history. */
function readingKey(row) {
  return row.bookId ? 'book:' + row.bookId : 'library:' + (row.libraryId || '');
}

/* What did the browser open? (module reader -> bookId, library -> libraryId) */
function readingTarget(body, user) {
  body = body || {};
  const bookId = String(body.bookId || '').trim();
  const libraryId = String(body.libraryId || '').trim();
  need(bookId || libraryId, 'Send the book that was opened');
  if (bookId) {
    const book = dbm.byId('books', bookId);
    need(book, 'Book not found', 404);
    need(book.scope === 'global' || book.scope === user.tenantId, 'Not available', 403);
    const lib = book.libraryId ? dbm.byId('library', book.libraryId) : null;
    return { kind: 'module', bookId: book.id, libraryId: lib ? lib.id : null,
      title: book.title || (lib ? lib.title : 'Book') };
  }
  const item = dbm.byId('library', libraryId);
  need(item, 'Library item not found', 404);
  need(item.type === 'book', 'Only books are counted');
  need(item.scope === 'global' || item.scope === user.tenantId, 'Not available', 403);
  return { kind: 'library', bookId: null, libraryId: item.id, title: item.title };
}

/* The reader tells the server every time a learner opens a book. */
route('POST', '/api/reading/open', ({ user, body }) => {
  requireRole(user, PARTICIPANTS);
  const target = readingTarget(body, user);
  const key = readingKey(target);
  dbm.collection('book_opens').push({
    id: dbm.uid('opn'), tenantId: user.tenantId, userId: user.id,
    kind: target.kind, bookId: target.bookId, libraryId: target.libraryId,
    title: target.title, openedAt: dbm.nowISO()
  });
  dbm.save();
  return { ok: true, key, timesOpened: dbm.collection('book_opens').filter(row =>
    row.userId === user.id && readingKey(row) === key).length };
});

/* The aggregates behind the "Reading activity" card. It mirrors
   reading_section() in the PHP build, so both backends answer the same numbers:
   total opens, books opened at least once, who reads what, and the book
   learners come back to most ("liked most" = most opened). */
function readingSection(scope) {
  scope = scope || {};
  const tenantIds = scope.tenantIds || {};
  const onlyUserIds = scope.userIds || null;
  const fModule = scope.moduleId || null;
  const inOnly = id => !onlyUserIds || onlyUserIds.indexOf(id) !== -1;
  const people = new Map((scope.participants || []).map(person => [person.id, person]));

  const opens = dbm.collection('book_opens').filter(row => {
    if (!tenantIds[row.tenantId] || !inOnly(row.userId) || !people.has(row.userId)) return false;
    if (fModule) {
      /* a book kept in the library belongs to no module, so it cannot answer a
         module filter: only that module's own books are counted */
      if (!row.bookId) return false;
      const book = dbm.byId('books', row.bookId);
      if (!book || book.moduleId !== fModule) return false;
    }
    return true;
  });

  const books = new Map();
  const readers = new Map();
  opens.forEach(row => {
    const key = readingKey(row);
    let book = books.get(key);
    if (!book) {
      book = { key, title: row.title || 'Book', kind: row.kind || 'module',
        bookId: row.bookId || null, libraryId: row.libraryId || null,
        opens: 0, readers: new Set(), firstOpenedAt: row.openedAt, lastOpenedAt: row.openedAt };
      books.set(key, book);
    }
    book.opens++;
    book.readers.add(row.userId);
    if (String(row.openedAt) < String(book.firstOpenedAt)) book.firstOpenedAt = row.openedAt;
    if (String(row.openedAt) > String(book.lastOpenedAt)) book.lastOpenedAt = row.openedAt;

    let reader = readers.get(row.userId);
    if (!reader) {
      const person = people.get(row.userId) || {};
      reader = { userId: row.userId, name: person.fullName || 'Learner',
        className: person.className || null, studentNumber: person.studentNumber || null,
        photo: loginPhoto(person.photo), opens: 0, books: new Map(), lastOpenedAt: row.openedAt };
      readers.set(row.userId, reader);
    }
    reader.opens++;
    if (String(row.openedAt) > String(reader.lastOpenedAt)) reader.lastOpenedAt = row.openedAt;
    const mine = reader.books.get(key);
    if (!mine) {
      reader.books.set(key, { key, title: book.title, opens: 1, lastOpenedAt: row.openedAt });
    } else {
      mine.opens++;
      if (String(row.openedAt) > String(mine.lastOpenedAt)) mine.lastOpenedAt = row.openedAt;
    }
  });

  const bookRows = Array.from(books.values()).map(book => ({
    key: book.key, title: book.title, kind: book.kind,
    bookId: book.bookId, libraryId: book.libraryId,
    opens: book.opens, readers: book.readers.size,
    opensPerReader: book.readers.size ? round2(book.opens / book.readers.size) : 0,
    firstOpenedAt: book.firstOpenedAt, lastOpenedAt: book.lastOpenedAt
  })).sort((a, b) => b.opens - a.opens || b.readers - a.readers ||
    String(a.title).localeCompare(String(b.title)));

  const readerRows = Array.from(readers.values()).map(reader => ({
    userId: reader.userId, name: reader.name, className: reader.className,
    studentNumber: reader.studentNumber, photo: reader.photo,
    opens: reader.opens, booksOpened: reader.books.size,
    books: Array.from(reader.books.values()).sort((a, b) => b.opens - a.opens ||
      String(a.title).localeCompare(String(b.title))),
    lastOpenedAt: reader.lastOpenedAt
  })).sort((a, b) => b.opens - a.opens || String(a.name).localeCompare(String(b.name)));

  return {
    totals: {
      opens: opens.length, booksOpened: bookRows.length, readers: readerRows.length,
      moduleBooks: bookRows.filter(book => book.kind === 'module').length,
      libraryBooks: bookRows.filter(book => book.kind === 'library').length,
      averagePerReader: readerRows.length ? round2(opens.length / readerRows.length) : 0
    },
    mostLiked: bookRows.length ? bookRows[0] : null,
    books: bookRows,
    readers: readerRows.slice(0, 300),
    readersTotal: readerRows.length
  };
}

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
  return { id: s.id, type: s.type, text: s.text, createdAt: s.createdAt, submittedAt: s.submittedAt || s.createdAt,
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
    return { createdAt: s.createdAt, submittedAt: s.submittedAt || s.createdAt, score: s.score, total: s.total,
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
      moduleLetters: byType('module_letter'),
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
    const type = l.type === 'mp3' ? 'audio' : l.type;
    const base = Object.assign({}, l, { type }, canConfig ? { canEdit: canEdit(user, l) } : {});
    /* learners may not open the books or letters before they finish every module */
    if (!canConfig && (type === 'book' || type === 'letter') && l.url && !allDone) {
      base.url = null;
      base.locked = true;
      base.lockedReason = 'Finish every module to open the ' + type + 's.';
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
    /* how the account reads: opens, books opened at least once, most liked */
    reading: readingSection({ tenantIds: tenantIds, participants: participants,
      moduleId: fModule, userIds: onlyUserIds }),
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
    completionVideoId: null, letter: normalizeModuleLetterInput(body.letter),
    createdAt: dbm.nowISO()
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
  if (body.letter !== undefined) mod.letter = normalizeModuleLetterInput(body.letter);
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

/* ---------------------------------------------- video alert points ------ */
/* The learner unlocks a library video every third finished chapter. Which video
   is unlocked at each point is the super admin's decision — it used to be drawn
   anonymously — and the console lists the points still left automatic. A point
   is shared by every account, so only a GLOBAL library video can be chosen. */
function videoAlertPoints() {
  const plan = videoAlertPlan();
  const points = [];
  for (let i = 1; i <= VIDEO_ALERT_POINTS; i++) {
    const chapters = i * 3;
    const entry = plan.find(row => Number(row.chapters) === chapters) || null;
    const chosenId = entry && entry.libraryId ? String(entry.libraryId) : '';
    const video = chosenId ? dbm.byId('library', chosenId) : null;
    points.push({
      point: i, chapters,
      libraryId: chosenId || null,
      title: video ? video.title : null,
      /* a chosen video that was deleted (or is no longer playable) is flagged so
         the console can ask for a new one */
      ok: !chosenId || !!(video && video.type === 'video' && video.url && video.scope === 'global'),
      updatedAt: entry ? (entry.updatedAt || null) : null
    });
  }
  return points;
}

route('GET', '/api/super/video-alerts', ({ user }) => {
  requireRole(user, SUPER);
  const videos = dbm.db.library
    .filter(v => v.type === 'video' && v.url && v.scope === 'global')
    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
    .map(v => ({ id: v.id, title: v.title }));
  const recent = dbm.collection('video_alerts').slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20)
    .map(alert => {
      const learner = dbm.byId('users', alert.userId);
      return {
        id: alert.id, learner: (learner && learner.fullName) || 'Learner',
        title: alert.title, point: alert.point || videoAlertPoint(alert.chaptersCompleted || 0),
        chapters: alert.chaptersCompleted || 0, chosenBy: alert.chosenBy || 'auto',
        createdAt: alert.createdAt
      };
    });
  return { ok: true, points: videoAlertPoints(), videos, recent,
    maxPoint: VIDEO_ALERT_POINTS };
});

route('PUT', '/api/super/video-alerts', ({ user, body }) => {
  requireRole(user, SUPER);
  body = body || {};
  const chapters = Number(body.chapters);
  need(Number.isFinite(chapters) && chapters >= 3 && chapters % 3 === 0 &&
    chapters <= VIDEO_ALERT_POINTS * 3, 'Choose one of the programme video points');
  const plan = videoAlertPlan();
  const at = plan.findIndex(row => Number(row.chapters) === chapters);
  const libraryId = body.libraryId ? String(body.libraryId) : '';
  if (!libraryId) {
    /* an empty choice hands the point back to the automatic pick */
    if (at !== -1) plan.splice(at, 1);
  } else {
    const video = dbm.byId('library', libraryId);
    need(video && video.type === 'video', 'Only a library video can appear at a point');
    need(!!video.url, 'That video has no file or link yet');
    need(video.scope === 'global', 'A point is shared by every account: choose a global video');
    const entry = { chapters, libraryId, updatedAt: dbm.nowISO(), updatedBy: user.id };
    if (at === -1) plan.push(entry); else plan[at] = entry;
  }
  plan.sort((a, b) => Number(a.chapters) - Number(b.chapters));
  dbm.save();
  return { ok: true, points: videoAlertPoints() };
});

/* ============================================= content management ======== */
function qp(req, name) {
  return new URL(req.url, 'http://localhost').searchParams.get(name);
}

/* ------------------------------------------------- the Letter of Christ -- */
/* Super admin keeps the program-wide letter (settings.letterId). An account
   admin may set a letter for their own account (tenants.letterId) — their
   learners read that one first, and fall back to the program letter. */
function tenantLetterOf(tenant) {
  if (!tenant || !tenant.letterId) return null;
  const lib = dbm.byId('library', tenant.letterId);
  return lib && lib.type === 'letter' ? lib : null;
}
function setTenantLetter(tenantId, letterId) {
  const tenant = dbm.byId('tenants', tenantId);
  if (!tenant) return null;
  tenant.letterId = letterId || null;
  dbm.save();
  return tenant;
}
/* The letter a learner actually reads. Order: the account's own letter, then the
   program letter — but a pointer can go stale (the linked letter was deleted), so
   when neither resolves, fall back to the newest letter this learner may read
   rather than showing "not configured yet". */
function resolveLetterFor(tenant) {
  const own = tenantLetterOf(tenant);
  if (own) return own;
  const configured = dbm.byId('library', dbm.db.settings.letterId);
  if (configured && configured.type === 'letter') return configured;
  const tid = tenant ? tenant.id : null;
  const letters = dbm.where('library', l => l.type === 'letter' &&
    (l.scope === 'global' || l.scope === tid));
  if (!letters.length) return null;
  return letters.slice().sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
}

route('POST', '/api/library', ({ user, body }) => {
  requireRole(user, ADMINS);
  body = body || {};
  need(body.title && String(body.title).trim(), 'Title is required');
  const rawType = String(body.type || 'book').toLowerCase();
  const type = ['book', 'letter', 'video', 'audio', 'mp3'].indexOf(rawType) !== -1
    ? (rawType === 'mp3' ? 'audio' : rawType) : 'book';
  const scope = user.role === 'super' ? (body.scope || 'global') : user.tenantId;
  const item = { id: dbm.uid('lib'), type, title: String(body.title).trim(), scope,
    text: body.text ? sanitizeRichHtml(body.text) : null, url: body.url || null,
    fileName: null, fileSize: null, createdAt: dbm.nowISO() };
  Object.assign(item, mediaFieldsFrom(body));
  if (body.file) {
    const saved = saveUpload(body.file);
    need(saved, 'File upload failed');
    item.url = saved.url;
    item.fileSize = saved.size;
    item.fileName = body.file.name;
  }
  need(item.url || item.text || type === 'book', 'Provide a file, a link or text');
  dbm.collection('library').push(item);
  dbm.save();
  /* An account admin may point their own learners at this letter straight away */
  if (type === 'letter' && body.useAsAccountLetter && user.role === 'tenant_admin') {
    setTenantLetter(user.tenantId, item.id);
  }
  return { ok: true, item };
});

route('PUT', '/api/library/([a-z0-9_-]+)', ({ user, params, body }) => {
  requireRole(user, ADMINS);
  const item = dbm.byId('library', params[0]);
  need(item, 'Not found', 404);
  need(canEdit(user, item), 'You can only edit your own entries', 403);
  body = body || {};
  if (body.title) item.title = String(body.title).trim();
  if (body.text !== undefined) item.text = body.text ? sanitizeRichHtml(body.text) : null;
  if (body.url !== undefined) item.url = body.url || null;
  if (body.type) {
    const rt = String(body.type).toLowerCase();
    item.type = (rt === 'mp3') ? 'audio' : (['book','letter','video','audio'].indexOf(rt) !== -1 ? rt : item.type);
  }
  if (body.file) {
    const saved = saveUpload(body.file);
    if (saved) { item.url = saved.url; item.fileSize = saved.size; item.fileName = body.file.name; }
  }
  Object.assign(item, mediaFieldsFrom(body));
  if (body.useAsAccountLetter !== undefined && user.role === 'tenant_admin' && item.type === 'letter') {
    setTenantLetter(user.tenantId, body.useAsAccountLetter ? item.id : null);
  }
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
  Object.assign(book, mediaFieldsFrom(body));
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
  Object.assign(book, mediaFieldsFrom(body));
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
  /* a deleted book takes its chapter reading marks with it */
  dbm.db.chapter_reads = dbm.collection('chapter_reads').filter(r =>
    r.bookId !== book.id && chIds.indexOf(r.chapterId) === -1);
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
  dbm.db.chapter_reads = dbm.collection('chapter_reads').filter(r => r.chapterId !== ch.id);
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
const SUPERVISOR_CAPACITY = 100;
function isLearnerRole(role) {
  return role === 'student' || role === 'member';
}
function supervisedLearnerCount(supervisorId) {
  return dbm.db.users.filter(u => u.supervisorId === supervisorId && isLearnerRole(u.role)).length;
}
function assignWaitlistedLearners(tenantId) {
  let changed = false;
  const learners = dbm.db.users.filter(u => u.tenantId === tenantId && isLearnerRole(u.role));
  learners.forEach(u => {
    if (!u.supervisorId && !u.supervisorWaitlisted) {
      u.supervisorWaitlisted = true;
      changed = true;
    } else if (u.supervisorId && u.supervisorWaitlisted) {
      u.supervisorWaitlisted = false;
      changed = true;
    }
  });
  const queue = learners.filter(u => !u.supervisorId && u.supervisorWaitlisted)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
      String(a.id).localeCompare(String(b.id)));
  const supervisors = dbm.db.users.filter(u => u.tenantId === tenantId && u.role === 'supervisor' && !u.suspended)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
      String(a.id).localeCompare(String(b.id)));
  const counts = new Map(supervisors.map(s => [s.id, supervisedLearnerCount(s.id)]));
  queue.forEach(learner => {
    let selected = null;
    let selectedCount = SUPERVISOR_CAPACITY;
    supervisors.forEach(supervisor => {
      const count = counts.get(supervisor.id);
      if (count < selectedCount) {
        selected = supervisor;
        selectedCount = count;
      }
    });
    if (!selected) return;
    learner.supervisorId = selected.id;
    learner.supervisorWaitlisted = false;
    counts.set(selected.id, selectedCount + 1);
    changed = true;
  });
  return changed;
}
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
    const tenantIds = tid ? [tid] : [...new Set(dbm.db.users.map(u => u.tenantId).filter(Boolean))];
    tenantIds.forEach(id => { if (assignWaitlistedLearners(id)) dbm.save(); });
    list = tid ? dbm.db.users.filter(u => u.tenantId === tid) : dbm.db.users;
  } else if (user.role === 'tenant_admin') {
    if (assignWaitlistedLearners(user.tenantId)) dbm.save();
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
    limit: user.role === 'supervisor' ? { max: SUPERVISOR_CAPACITY, used: supervisedLearnerCount(user.id) } : null };
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
    need(supervisedLearnerCount(actingUser.id) < SUPERVISOR_CAPACITY,
      'A supervisor can only add a maximum of 100 students', 403);
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

  const supervisorWasSpecified = !!body.supervisorId;
  let supervisorId = actingUser.role === 'supervisor' ? actingUser.id
    : (role === 'supervisor' ? null : (body.supervisorId || null));
  let supervisorWaitlisted = false;
  if (isLearnerRole(role) && actingUser.role !== 'supervisor') {
    if (!supervisorWasSpecified) {
      assignWaitlistedLearners(tenantId);
      const supervisors = dbm.db.users.filter(s =>
        s.tenantId === tenantId && s.role === 'supervisor' && !s.suspended)
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
          String(a.id).localeCompare(String(b.id)));
      let selected = null;
      let selectedCount = SUPERVISOR_CAPACITY;
      supervisors.forEach(s => {
        const count = supervisedLearnerCount(s.id);
        if (count < selectedCount) {
          selected = s;
          selectedCount = count;
        }
      });
      if (selected) supervisorId = selected.id;
      else supervisorWaitlisted = true;
    } else {
      const selected = dbm.byId('users', supervisorId);
      need(selected && selected.tenantId === tenantId && selected.role === 'supervisor' && !selected.suspended,
        'Choose a supervisor from this account', 400);
      need(supervisedLearnerCount(selected.id) < SUPERVISOR_CAPACITY,
        'That supervisor already has 100 students', 409);
    }
  }

  const h = auth.hashPassword(String(body.password));
  const u = { id: dbm.uid('usr'), tenantId, role,
    supervisorId, supervisorWaitlisted,
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
  if (u.role === 'supervisor') assignWaitlistedLearners(u.tenantId);
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
      if (doc.role === 'supervisor') assignWaitlistedLearners(doc.tenantId);
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
  const tenantIds = tid ? [tid] : [...new Set(dbm.db.users.map(u => u.tenantId).filter(Boolean))];
  tenantIds.forEach(id => { if (assignWaitlistedLearners(id)) dbm.save(); });
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
  if (u.role === 'supervisor') assignWaitlistedLearners(u.tenantId);
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
  if (body.supervisorId !== undefined) {
    need(user.role === 'super' || user.role === 'tenant_admin', 'Not permitted', 403);
    const supervisorId = body.supervisorId || null;
    if (isLearnerRole(t.role) && supervisorId) {
      const selected = dbm.byId('users', supervisorId);
      need(selected && selected.tenantId === t.tenantId && selected.role === 'supervisor' && !selected.suspended,
        'Choose a supervisor from this account', 400);
      need(selected.id === t.supervisorId || supervisedLearnerCount(selected.id) < SUPERVISOR_CAPACITY,
        'That supervisor already has 100 students', 409);
    }
    t.supervisorId = supervisorId;
    t.supervisorWaitlisted = isLearnerRole(t.role) && !supervisorId;
  }
  if (body.password) {
    need(String(body.password).length >= 6, 'Password must be at least 6 characters');
    const h = auth.hashPassword(String(body.password));
    t.salt = h.salt; t.passwordHash = h.hash;
  }
  if (body.role && (user.role === 'super' || user.role === 'tenant_admin') && t.role !== 'super') {
    const wasLearner = isLearnerRole(t.role);
    t.role = body.role;
    if (t.role === 'supervisor') {
      t.supervisorId = null;
      t.supervisorWaitlisted = false;
    } else if (isLearnerRole(t.role)) {
      if (!wasLearner && t.supervisorId &&
          supervisedLearnerCount(t.supervisorId) >= SUPERVISOR_CAPACITY) {
        t.supervisorId = null;
      }
      t.supervisorWaitlisted = !t.supervisorId;
    } else {
      t.supervisorWaitlisted = false;
    }
  }
  if (body.suspended !== undefined && user.role !== 'supervisor') {
    t.suspended = !!body.suspended;
    if (t.suspended) dbm.db.sessions = dbm.db.sessions.filter(s => s.userId !== t.id);
  }
  if (isLearnerRole(t.role) && !t.supervisorId) t.supervisorWaitlisted = true;
  if (assignWaitlistedLearners(t.tenantId)) dbm.save();
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
  dbm.db.users.forEach(x => {
    if (x.supervisorId === t.id) {
      x.supervisorId = null;
      x.supervisorWaitlisted = isLearnerRole(x.role);
    }
  });
  dbm.remove('users', t.id);
  if (assignWaitlistedLearners(t.tenantId)) dbm.save();
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
  let list = dbm.db.users.filter(u => ['student', 'teacher', 'member'].includes(u.role));
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
  const reportDef = assessmentActiveDef(assessmentDef());

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
      supervisorId: u.supervisorId || null, supervisorWaitlisted: !!u.supervisorWaitlisted,
      tenantId: u.tenantId, tenantName: tenant ? tenant.name : null,
      supervisorName: u.supervisorId ? ((dbm.byId('users', u.supervisorId) || {}).fullName || null) : null,
      submissions: subs.length, lastActiveAt: last,
      certificates: perf.certificates, flagged: perf.flagged,
      progress: perf.overall, modulesCompleted: completed, moduleCount: mods.length, level: level,
      keywordScore: meanOf(subs.map(s => { const a = assessOf(s); return a ? a.keywordScore : null; })),
      typedAnswers: subs.filter(s => assessOf(s)).length,
      assessment: assessmentForReport(u, reportDef),
      modules: mods.map(m => ({ id: m.id, title: m.title, percent: m.percent, status: m.status })),
      recent: subs.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 6)
        .map(s => ({ type: s.type, createdAt: s.createdAt, submittedAt: s.submittedAt || s.createdAt, text: String(s.text || '').slice(0, 240),
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
    assessmentCategories: reportDef.categories.map(c => ({ id: c.id, title: c.title, max: c.statements.length * 5 })),
    activityYears: Array.from(activityYears).sort().reverse(),
    average: total ? Math.round(students.reduce((s, x) => s + x.progress, 0) / total) : 0,
    finished: students.filter(s => s.moduleCount > 0 && s.modulesCompleted === s.moduleCount).length,
    started: students.filter(s => s.submissions > 0).length,
    notStarted: students.filter(s => s.submissions === 0).length };
});

route('GET', '/api/reports/student-detail', ({ req, user }) => {
  requireRole(user, ADMINS.concat(['supervisor']));
  const studentId = qp(req, 'studentId');
  need(studentId, 'studentId required');
  const student = dbm.byId('users', studentId);
  need(student && ['student', 'teacher', 'member'].includes(student.role), 'Student not found', 404);
  if (user.role === 'tenant_admin') need(student.tenantId === user.tenantId, 'Not permitted', 403);
  else if (user.role === 'supervisor') need(student.supervisorId === user.id, 'Not permitted', 403);
  else {
    const tenantId = qp(req, 'tenantId');
    if (tenantId) need(student.tenantId === tenantId, 'Not permitted', 403);
  }
  const submissions = dbm.where('submissions', s => s.userId === studentId)
    .slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map(s => {
      const assessment = assessOf(s);
      const chapter = s.chapterId ? dbm.byId('chapters', s.chapterId) : null;
      const book = s.bookId ? dbm.byId('books', s.bookId) : null;
      const module = s.moduleId ? dbm.byId('modules', s.moduleId) : null;
      return {
        id: s.id, type: s.type, createdAt: s.createdAt, submittedAt: s.submittedAt || s.createdAt, text: s.text || '',
        score: s.score == null ? null : s.score, total: s.total == null ? null : s.total,
        flagged: !!s.flagged, similarity: s.similarity || 0,
        keywordScore: assessment ? assessment.keywordScore : null,
        keywordsUsed: assessment ? assessment.keywordsUsed : null,
        keywordsTotal: assessment ? assessment.keywordsTotal : null,
        keywordsMissing: assessment ? assessment.keywordsMissing : [],
        label: s.label || null, chapter: chapter ? chapter.title : null,
        book: book ? book.title : null, module: module ? module.title : null
      };
    });
  return { ok: true, submissions: submissions, count: submissions.length };
});

/* Statement-level self-assessment behind the report popup: exactly what the
   learner chose for every objective question, pre and post, with the category
   totals the supervisor sees in the table. */
route('GET', '/api/reports/student-assessment', ({ req, user }) => {
  requireRole(user, ADMINS.concat(['supervisor']));
  const studentId = qp(req, 'studentId');
  need(studentId, 'studentId required');
  const tenantId = qp(req, 'tenantId');
  const student = assessmentReportScope(user, studentId);
  if (user.role === 'super' && tenantId) need(student.tenantId === tenantId, 'Not permitted', 403);
  const def = assessmentActiveDef(assessmentDef());
  const summary = assessmentForReport(student, def);
  const pre = student.assessmentPre || null;
  const post = student.assessmentPost || null;
  const categories = def.categories.map(c => {
    const statements = c.statements.map(s => ({
      id: s.id, text: s.text,
      pre: pre && pre.answers && pre.answers[s.id] != null ? pre.answers[s.id] : null,
      post: post && post.answers && post.answers[s.id] != null ? post.answers[s.id] : null
    }));
    return {
      id: c.id, title: c.title, statements: statements,
      max: c.statements.length * 5,
      preTotal: pre ? statements.reduce((n, s) => n + (Number(s.pre) || 0), 0) : null,
      postTotal: post ? statements.reduce((n, s) => n + (Number(s.post) || 0), 0) : null
    };
  });
  return {
    ok: true,
    student: {
      id: student.id, fullName: student.fullName, className: student.className || null,
      studentNumber: student.studentNumber || null, tenantId: student.tenantId || null,
      supervisorId: student.supervisorId || null
    },
    scale: def.scale, note: def.note || '', categories: categories,
    pre: summary.pre, post: summary.post, growth: summary.growth
  };
});

route('GET', '/api/reports/student-roster', ({ req, user }) => {
  requireRole(user, ADMINS.concat(['supervisor']));
  const tenantId = qp(req, 'tenantId');
  const supervisorId = qp(req, 'supervisorId');
  let users = dbm.db.users.filter(u => ['student', 'member'].includes(u.role));
  if (user.role === 'tenant_admin') users = users.filter(u => u.tenantId === user.tenantId);
  else if (user.role === 'supervisor') {
    need(!supervisorId || supervisorId === user.id, 'Not permitted', 403);
    users = users.filter(u => u.supervisorId === user.id);
  } else if (tenantId) users = users.filter(u => u.tenantId === tenantId);

  let supervisors = dbm.db.users.filter(u => u.role === 'supervisor');
  if (user.role === 'tenant_admin') supervisors = supervisors.filter(u => u.tenantId === user.tenantId);
  else if (user.role === 'supervisor') supervisors = supervisors.filter(u => u.id === user.id);
  else if (tenantId) supervisors = supervisors.filter(u => u.tenantId === tenantId);

  if (supervisorId) {
    const selected = supervisors.find(u => u.id === supervisorId);
    need(selected, 'Supervisor not found in this account', 404);
    users = users.filter(u => u.supervisorId === supervisorId);
  }
  const tenantName = new Map(dbm.db.tenants.map(t => [t.id, t.name]));
  const counts = new Map(supervisors.map(s => [s.id, 0]));
  users.forEach(u => { if (counts.has(u.supervisorId)) counts.set(u.supervisorId, counts.get(u.supervisorId) + 1); });
  const students = users.slice().sort((a, b) =>
    String(a.fullName || '').localeCompare(String(b.fullName || '')) || String(a.id).localeCompare(String(b.id)))
    .map(u => {
      const supervisor = u.supervisorId ? dbm.byId('users', u.supervisorId) : null;
      return {
        id: u.id, fullName: u.fullName, studentNumber: u.studentNumber || null,
        className: u.className || null, tenantId: u.tenantId || null,
        tenantName: tenantName.get(u.tenantId) || null,
        supervisorId: u.supervisorId || null, supervisorName: supervisor ? supervisor.fullName : null,
        supervisorWaitlisted: !!u.supervisorWaitlisted, suspended: !!u.suspended
      };
    });
  return { ok: true, count: students.length, students,
    supervisors: supervisors.slice().sort((a, b) =>
      String(a.fullName || '').localeCompare(String(b.fullName || '')) || String(a.id).localeCompare(String(b.id)))
      .map(s => ({ id: s.id, fullName: s.fullName, tenantId: s.tenantId || null,
        tenantName: tenantName.get(s.tenantId) || null, studentCount: counts.get(s.id) || 0 })) };
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

/* The ribbon at the top of the students page: the account's best performers by
   the marks they scored and by how much of the programme they covered. Both
   numbers count equally, and marks break a tie before coverage does. */
route('GET', '/api/reports/top-performers', ({ req, user }) => {
  /* The console's students page and the learner's own dashboard both show this
     belt, and both are account pages: a learner reads the same top 50 as the
     admin of that account, never a cross-account feed. */
  requireRole(user, ['tenant_admin', 'supervisor', 'student', 'member']);
  /* the ribbon takes at most 50; a missing or unreadable limit means "all 50",
     which is also how the PHP build reads it */
  const asked = qp(req, 'limit');
  const askedNumber = asked == null || String(asked).trim() === '' ? NaN : Number(asked);
  const limit = Number.isFinite(askedNumber)
    ? Math.max(1, Math.min(50, Math.trunc(askedNumber))) : 50;
  let learners = dbm.db.users.filter(candidate => ['student', 'member'].indexOf(candidate.role) !== -1 &&
    !candidate.suspended);
  if (user.role === 'supervisor') {
    learners = learners.filter(candidate => candidate.supervisorId === user.id);
  } else {
    /* a tenant admin and a learner both read their own account, nothing else */
    learners = learners.filter(candidate => candidate.tenantId === user.tenantId);
  }

  /* marks: the same percentages the reports rank with (objectives + written work) */
  const eligible = new Set(learners.map(learner => learner.id));
  const marks = new Map();
  dbm.db.submissions.forEach(submission => {
    if (!eligible.has(submission.userId)) return;
    let percent = null;
    if (submission.type === 'objectives' && Number(submission.total) > 0) {
      const total = Number(submission.total);
      const earned = Math.max(0, Math.min(total, Number(submission.score) || 0));
      percent = earned * 100 / total;
    } else if (['chapter_summary', 'letter_summary', 'book_summary'].indexOf(submission.type) !== -1) {
      const assessment = assessOf(submission);
      if (assessment && assessment.keywordScore != null && Number.isFinite(Number(assessment.keywordScore))) {
        percent = Math.max(0, Math.min(100, Number(assessment.keywordScore)));
      }
    }
    if (percent == null) return;
    const mark = marks.get(submission.userId) || { sum: 0, count: 0 };
    mark.sum += percent;
    mark.count++;
    marks.set(submission.userId, mark);
  });

  /* every piece of work a learner handed in, scored or not: a learner can be
     working through a chapter whose answers carry no key words yet, and that
     work must not make them vanish from the belt */
  const work = new Map();
  dbm.db.submissions.forEach(submission => {
    if (!eligible.has(submission.userId) || submission.flagged) return;
    work.set(submission.userId, (work.get(submission.userId) || 0) + 1);
  });

  const performers = learners.map(learner => {
    const mark = marks.get(learner.id) || { sum: 0, count: 0 };
    const statuses = moduleStatuses(learner);
    const coverage = meanOf(statuses.map(status => status.progress.percent));
    const scored = mark.count ? Math.round(mark.sum / mark.count) : null;
    const cover = coverage == null ? 0 : coverage;
    return {
      id: learner.id, name: learner.fullName,
      displayName: loginDisplayName(learner.fullName),
      className: learner.className || null, studentNumber: learner.studentNumber || null,
      photo: loginPhoto(learner.photo),
      marks: scored, coverage: cover,
      submissions: mark.count, work: work.get(learner.id) || 0,
      /* Marks and coverage weigh the same. A learner who has moved through the
         programme but whose typed answers carry no score yet (a chapter with no
         key words, for example) is still ranked on their coverage — their marks
         simply show as a dash instead of hiding them from the belt. */
      score: scored == null ? cover : Math.round((scored + cover) / 2)
    };
  }).filter(performer => performer.marks != null || performer.coverage > 0 ||
    performer.work > 0)
    .sort((a, b) => b.score - a.score ||
      (b.marks == null ? -1 : b.marks) - (a.marks == null ? -1 : a.marks) ||
      b.coverage - a.coverage ||
      String(a.name).localeCompare(String(b.name)))
    .slice(0, limit)
    .map((performer, index) => Object.assign(performer, { rank: index + 1 }));

  return { ok: true, performers: performers, count: performers.length, limit: limit,
    basis: 'marks and coverage, equally weighted' };
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
      id: s.id, fullName: s.fullName, email: s.email, code: s.supervisorCode, suspended: !!s.suspended,
        users: supervisedLearnerCount(s.id), limit: SUPERVISOR_CAPACITY }))
    : [];
  return { ok: true,
    branding: tenantBranding(tenant),
    portal: tenant ? (dbm.byId('portals', tenant.portalId) || {}) : {},
    counts: { users: users.length, supervisors: supervisors.length,
      submissions: subs.length, flagged: subs.filter(s => s.flagged).length,
      certificates: dbm.db.certificates.filter(c => ids.indexOf(c.userId) !== -1).length },
    supervisors,
    limit: user.role === 'supervisor'
      ? { max: SUPERVISOR_CAPACITY, used: supervisedLearnerCount(user.id) } : null };
});

/* --------------------------------------------------- reporting views ----- */
function notificationFor(userId, data) {
  const notification = Object.assign({
    id: dbm.uid('ntf'), userId, readAt: null, createdAt: dbm.nowISO()
  }, data);
  dbm.collection('notifications').push(notification);
  dbm.save();
  return notification;
}

function createSubmissionNotification(user, submission) {
  if (!['student', 'member'].includes(user.role) || !user.supervisorId) return;
  const supervisor = dbm.byId('users', user.supervisorId);
  if (!supervisor || supervisor.role !== 'supervisor' || supervisor.tenantId !== user.tenantId) return;
  notificationFor(supervisor.id, {
    type: 'submission', title: 'New student submission',
    body: user.fullName + ' submitted ' + String(submission.type || 'work').replace(/_/g, ' '),
    studentId: user.id, submissionId: submission.id
  });
}

function createCompletionNotification(user) {
  if (!['student', 'member'].includes(user.role) || !user.supervisorId) return;
  const supervisor = dbm.byId('users', user.supervisorId);
  if (!supervisor || supervisor.role !== 'supervisor' || supervisor.tenantId !== user.tenantId) return;
  const exists = dbm.collection('notifications').some(n =>
    n.userId === supervisor.id && n.type === 'completion' && n.studentId === user.id);
  if (exists) return;
  notificationFor(supervisor.id, {
    type: 'completion', title: 'Student completed the programme',
    body: user.fullName + ' has completed every module and earned the general certificate.',
    studentId: user.id
  });
}

/* ------------------------------------------------------- video alerts ---- */
/* Every third completed chapter opens a "point" and earns one library video. The
   SUPER ADMIN chooses the video for each point in the console (point 1 = after
   three chapters, point 2 = after six, and so on), so nothing is handed out
   anonymously. A point without a choice still sends a video this learner has
   never had, so a milestone is never lost. The alert arrives in the messages
   where the learner can play it, and a milestone is rewarded once. */
const VIDEO_ALERT_POINTS = 12;   /* points 1..12 = after 3..36 chapters */

/* the plan the super admin keeps: one { chapters, libraryId } row per point */
function videoAlertPlan() {
  return dbm.collection('video_alert_plan');
}

/* 3 chapters -> point 1, 6 -> point 2 … */
function videoAlertPoint(chapters) {
  return Math.max(1, Math.round(Number(chapters) / 3));
}

/* The video the super admin chose for this point — only when it is still a
   playable GLOBAL video. One plan serves every account, so an account-only
   video would leak into another school. */
function plannedVideo(chapters) {
  const entry = videoAlertPlan().find(row => Number(row.chapters) === Number(chapters));
  if (!entry || !entry.libraryId) return null;
  const video = dbm.byId('library', entry.libraryId);
  if (!video || video.type !== 'video' || !video.url || video.scope !== 'global') return null;
  return video;
}

function completedChapterCount(userId) {
  const chapters = new Set();
  dbm.collection('submissions').forEach(submission => {
    if (submission.userId !== userId || !submission.chapterId) return;
    if (submission.type !== 'chapter_summary' && submission.type !== 'objectives') return;
    chapters.add(submission.chapterId);
  });
  return chapters.size;
}

function maybeSendVideoAlert(user, submission) {
  if (!submission || !submission.chapterId) return null;
  if (['student', 'member'].indexOf(user.role) === -1) return null;
  const chapters = completedChapterCount(user.id);
  if (!chapters || chapters % 3 !== 0) return null;
  const alerts = dbm.collection('video_alerts');
  const milestone = 'chapters:' + chapters;
  const mine = alerts.filter(alert => alert.userId === user.id);
  if (mine.some(alert => alert.milestone === milestone)) return null;
  const sent = new Set(mine.map(alert => alert.libraryId));
  const point = videoAlertPoint(chapters);
  /* the super admin's choice wins; a point left automatic still sends a video
     this learner has never had */
  const chosen = plannedVideo(chapters);
  let video = chosen;
  if (!video) {
    const videos = dbm.db.library.filter(candidate => candidate.type === 'video' && candidate.url &&
      (candidate.scope === 'global' || candidate.scope === user.tenantId) && !sent.has(candidate.id));
    if (!videos.length) return null;
    video = videos[Math.floor(Math.random() * videos.length)];
  }
  const alert = {
    id: dbm.uid('val'), tenantId: user.tenantId, userId: user.id,
    libraryId: video.id, title: video.title, videoUrl: video.url,
    milestone, chaptersCompleted: chapters, point, chosenBy: chosen ? 'super' : 'auto',
    createdAt: dbm.nowISO()
  };
  alerts.push(alert);
  notificationFor(user.id, {
    type: 'video_alert', title: 'Point ' + point + ' unlocked — a video for you',
    body: 'You finished ' + chapters + ' chapters, so point ' + point + ' is open. ' +
      (chosen ? 'The video chosen for this point: "' : 'A video from the library: "') +
      video.title + '". Watch it whenever you like.',
    libraryId: video.id, videoUrl: video.url
  });
  dbm.save();
  return alert;
}

function messagingUsers(user) {
  if (user.role === 'super') {
    return dbm.collection('users').filter(c => c.id !== user.id && !c.suspended)
      .sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || '')))
      .map(c => ({ id: c.id, fullName: c.fullName, role: c.role, tenantId: c.tenantId }));
  }
  const people = dbm.collection('users').filter(candidate => {
    if (candidate.id === user.id || candidate.suspended || candidate.tenantId !== user.tenantId) return false;
    if (user.role === 'tenant_admin') return ['student', 'member', 'teacher', 'supervisor'].includes(candidate.role);
    if (user.role === 'supervisor') return candidate.role === 'tenant_admin' ||
      (['student', 'member', 'teacher'].includes(candidate.role) && candidate.supervisorId === user.id);
    if (['student', 'member', 'teacher'].includes(user.role)) return candidate.role === 'tenant_admin' ||
      (candidate.role === 'supervisor' && candidate.id === user.supervisorId);
    return false;
  });
  return people.sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || '')))
    .map(candidate => ({ id: candidate.id, fullName: candidate.fullName, role: candidate.role }));
}

function canMessage(user, recipient) {
  if (user.role === 'super') return true;
  if (!recipient || recipient.id === user.id || recipient.tenantId !== user.tenantId || recipient.suspended) return false;
  if (user.role === 'tenant_admin') return ['student', 'member', 'teacher', 'supervisor'].includes(recipient.role);
  if (user.role === 'supervisor') return recipient.role === 'tenant_admin' ||
    (['student', 'member', 'teacher'].includes(recipient.role) && recipient.supervisorId === user.id);
  if (['student', 'member', 'teacher'].includes(user.role)) return recipient.role === 'tenant_admin' ||
    (recipient.role === 'supervisor' && recipient.id === user.supervisorId);
  return false;
}

function conversationVisibleTo(user, conversation) {
  if (!conversation || !Array.isArray(conversation.participantIds) ||
    !conversation.participantIds.includes(user.id)) return false;
  if (conversation.tenantId === user.tenantId) return true;
  /* Older super-admin messages were saved with a null tenant. Keep those
     conversations accessible, but never relax isolation for other accounts. */
  if (conversation.tenantId != null) return false;
  return conversation.participantIds.some(id => {
    const person = dbm.byId('users', id);
    return person && person.role === 'super';
  });
}

function conversationFor(user, recipient) {
  const participants = [user.id, recipient.id].sort();
  const tenantId = user.role === 'super' ? recipient.tenantId : user.tenantId;
  let conversation = dbm.collection('conversations').find(c =>
    (c.tenantId === tenantId || c.tenantId == null) && Array.isArray(c.participantIds) &&
    c.participantIds.length === 2 && c.participantIds.slice().sort().join('|') === participants.join('|'));
  if (conversation && conversation.tenantId == null) conversation.tenantId = tenantId;
  if (!conversation) {
    conversation = { id: dbm.uid('cnv'), tenantId: tenantId,
      participantIds: participants, createdAt: dbm.nowISO(), updatedAt: dbm.nowISO() };
    dbm.collection('conversations').push(conversation);
  }
  return conversation;
}

function messageNotification(recipientId, sender, conversationId, body) {
  notificationFor(recipientId, {
    type: 'message', title: 'New message from ' + sender.fullName,
    body: body.length > 160 ? body.slice(0, 157) + '…' : body,
    conversationId
  });
}

/* Files attached to a message. They arrive base64 in the request body (the same
   JSON transport the whole app uses) and are written to /uploads here, so the
   stored message only keeps the finished link. Documents, audio and video all
   fit; kind is read from the file name so the player knows what to render. */
function messageAttachmentsFrom(body) {
  const list = Array.isArray(body && body.attachments) ? body.attachments : [];
  const out = [];
  for (const a of list.slice(0, 20)) {
    const saved = saveUpload(a);
    if (!saved) continue;
    out.push({ url: saved.url, name: a && a.name ? String(a.name) : 'attachment',
      size: saved.size, kind: messageAttachKind(a && a.name) });
  }
  return out;
}
/* What a message attachment is, so the client renders a player for audio/video/
   image and a download link for documents (PDF/text/Word/anything else). */
function messageAttachKind(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  const ext = m ? m[1].toLowerCase() : '';
  if (AUDIO_MEDIA_EXTS.indexOf(ext) !== -1) return 'audio';
  if (['mp4', 'm4v', 'mov', 'webm', 'ogv', 'mkv', 'avi', 'wmv', 'mpeg', 'mpg',
    'm2ts', 'ts', 'vob', '3gp'].indexOf(ext) !== -1) return 'video';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].indexOf(ext) !== -1) return 'image';
  return 'file';   /* pdf, txt, doc, docx, rtf, odt and anything else */
}

function messageInboxFor(user) {
  const sentMessages = [];
  const list = dbm.collection('conversations').filter(c =>
    user.role === 'super' || conversationVisibleTo(user, c));
  const conversations = list.map(c => {
      const messages = dbm.collection('messages').filter(m => m.conversationId === c.id)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const peerId = user.role === 'super' ? null : c.participantIds.find(id => id !== user.id);
      const peer = peerId ? dbm.byId('users', peerId) : null;
      const superLabel = user.role === 'super'
        ? (c.participantIds || []).map(id => { const u = dbm.byId('users', id); return u ? u.fullName : id; }).join(' ↔ ')
        : null;
      const participant = user.role === 'super'
        ? { id: (c.participantIds || [])[0], fullName: superLabel, role: 'conversation' }
        : (peer ? { id: peer.id, fullName: peer.fullName, role: peer.role } : null);
      messages.forEach(m => {
        if (m.senderId === user.id) sentMessages.push({
          id: m.id, conversationId: c.id, recipient: participant, body: m.body,
          attachments: m.attachments || [], createdAt: m.createdAt, readAt: m.readAt || null
        });
      });
      const unread = messages.filter(m => m.senderId !== user.id && !m.readAt).length;
      const latest = messages[messages.length - 1];
      return {
        id: c.id,
        participant,
        latestMessage: latest ? { body: latest.body, attachments: latest.attachments || [],
          createdAt: latest.createdAt, senderId: latest.senderId } : null,
        unread,
        updatedAt: c.updatedAt || (latest && latest.createdAt) || c.createdAt
      };
    })
    .filter(c => c.participant)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  sentMessages.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { conversations, sentMessages };
}

function conversationForUser(user, conversationId) {
  const conversation = dbm.byId('conversations', conversationId);
  if (user.role === 'super') { need(conversation, 'Conversation not found', 404); return conversation; }
  need(conversationVisibleTo(user, conversation), 'Conversation not found', 404);
  return conversation;
}

route('GET', '/api/messages', ({ user }) => {
  requireRole(user, ['super', 'tenant_admin', 'supervisor', 'student', 'member', 'teacher']);
  const inbox = messageInboxFor(user);
  return { ok: true, conversations: inbox.conversations, sentMessages: inbox.sentMessages,
    recipients: messagingUsers(user) };
});

route('POST', '/api/messages', ({ user, body }) => {
  requireRole(user, ['super', 'tenant_admin', 'supervisor', 'student', 'member', 'teacher']);
  const text = String((body || {}).body || '').trim();
  need(text.length <= 5000, 'Message must be at most 5000 characters');
  const recipientIds = Array.isArray(body.recipientIds) ? Array.from(new Set(body.recipientIds.map(String))) : [];
  need(recipientIds.length > 0 && recipientIds.length <= 500, 'Choose between 1 and 500 recipients');
  const recipients = recipientIds.map(id => dbm.byId('users', id));
  need(recipients.every(recipient => canMessage(user, recipient)), 'One or more recipients are not permitted', 403);
  const attachments = messageAttachmentsFrom(body);
  need(text.length > 0 || attachments.length > 0, 'Message must be between 1 and 5000 characters');
  const messageIds = [];
  recipients.forEach(recipient => {
    const conversation = conversationFor(user, recipient);
    const message = { id: dbm.uid('msg'), conversationId: conversation.id,
      senderId: user.id, body: text, attachments, createdAt: dbm.nowISO(), readAt: null };
    dbm.collection('messages').push(message);
    conversation.updatedAt = message.createdAt;
    messageIds.push(message.id);
    messageNotification(recipient.id, user, conversation.id, text);
  });
  dbm.save();
  return { ok: true, sent: messageIds.length };
});

route('GET', '/api/messages/([a-z0-9_-]+)', ({ user, params }) => {
  requireRole(user, ['super', 'tenant_admin', 'supervisor', 'student', 'member', 'teacher']);
  const conversation = conversationForUser(user, params[0]);
  const now = dbm.nowISO();
  const messages = dbm.collection('messages').filter(m => m.conversationId === conversation.id)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  messages.forEach(message => {
    if (message.senderId !== user.id && !message.readAt) message.readAt = now;
  });
  dbm.collection('notifications').forEach(n => {
    if (n.userId === user.id && n.conversationId === conversation.id && !n.readAt) n.readAt = now;
  });
  dbm.save();
  const participants = conversation.participantIds.map(id => {
    const person = dbm.byId('users', id);
    return person ? { id: person.id, fullName: person.fullName, role: person.role } : null;
  }).filter(Boolean);
  return { ok: true, conversation: { id: conversation.id, participants }, messages };
});

route('POST', '/api/messages/([a-z0-9_-]+)', ({ user, params, body }) => {
  requireRole(user, ['super', 'tenant_admin', 'supervisor', 'student', 'member', 'teacher']);
  const conversation = conversationForUser(user, params[0]);
  const peerId = conversation.participantIds.find(id => id !== user.id);
  const recipient = dbm.byId('users', peerId);
  need(canMessage(user, recipient), 'Not permitted to reply in this conversation', 403);
  const text = String((body || {}).body || '').trim();
  need(text.length >= 0 && text.length <= 5000, 'Message must be at most 5000 characters');
  const attachments = messageAttachmentsFrom(body);
  need(text.length > 0 || attachments.length > 0, 'Message must be between 1 and 5000 characters');
  const message = { id: dbm.uid('msg'), conversationId: conversation.id,
    senderId: user.id, body: text, attachments, createdAt: dbm.nowISO(), readAt: null };
  dbm.collection('messages').push(message);
  conversation.updatedAt = message.createdAt;
  messageNotification(recipient.id, user, conversation.id, text);
  dbm.save();
  return { ok: true, message };
});

route('GET', '/api/notifications', ({ user }) => {
  requireRole(user, ['super', 'tenant_admin', 'supervisor', 'student', 'member', 'teacher']);
  const notifications = dbm.collection('notifications').filter(n => n.userId === user.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100);
  return { ok: true, notifications, unread: notifications.filter(n => !n.readAt).length };
});

route('PUT', '/api/notifications/([a-z0-9_-]+)/read', ({ user, params }) => {
  requireRole(user, ['super', 'tenant_admin', 'supervisor', 'student', 'member', 'teacher']);
  const notification = dbm.byId('notifications', params[0]);
  need(notification && notification.userId === user.id, 'Notification not found', 404);
  if (!notification.readAt) notification.readAt = dbm.nowISO();
  dbm.save();
  return { ok: true };
});

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
      return { id: s.id, type: s.type, createdAt: s.createdAt, submittedAt: s.submittedAt || s.createdAt, text: s.text,
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

/* Live lessons. Creators: super (all users), tenant_admin (whole account), supervisor (their students). Students only receive. Meeting link (Zoom) required. */
route('POST', '/api/live-lessons', ({ body, user }) => {
  need(user, 'Sign in required', 401);
  need(user.role === 'tenant_admin' || user.role === 'supervisor' || user.role === 'super', 'Not permitted', 403);
  const title = String((body && body.title) || '').trim();
  need(title, 'Title required');
  need(title.length <= 200, 'Title is too long');
  const scheduledAt = body && body.scheduledAt ? String(body.scheduledAt) : new Date().toISOString();
  const scheduledDate = new Date(scheduledAt);
  need(!isNaN(scheduledDate.getTime()), 'Invalid lesson date and time');
  const providedLink = body && (body.joinUrl || body.link || body.zoomUrl || body.meetingUrl);
  need(providedLink, 'Meeting link required');
  const joinUrl = String(providedLink).trim();
  need(/^https?:\/\/\S+$/i.test(joinUrl), 'Meeting link must start with http:// or https://');
  need(joinUrl.length <= 1000, 'Meeting link is too long');
  let recipients = [];
  if (user.role === 'tenant_admin' || user.role === 'super') {
    if (user.role === 'super') {
      recipients = dbm.collection('users').filter(u => u.id !== user.id).map(u => u.id);
    } else {
      recipients = dbm.collection('users').filter(u => u.tenantId === user.tenantId && u.id !== user.id).map(u => u.id);
    }
  } else {
    recipients = dbm.collection('users').filter(u => u.supervisorId === user.id).map(u => u.id);
  }
  const scheduledIso = scheduledDate.toISOString();
  const notified = scheduledDate <= new Date();
  const lesson = {
    id: dbm.uid('lesson'),
    title,
    scheduledAt: scheduledIso,
    creatorId: user.id,
    tenantId: user.tenantId,
    recipientIds: recipients,
    room: null,
    joinUrl,
    notified,
    createdAt: dbm.nowISO()
  };
  dbm.collection('liveLessons').push(lesson);
  if (notified) {
    recipients.forEach(rid => {
      dbm.collection('notifications').push({
        id: dbm.uid('ntf'),
        userId: rid,
        type: 'live_lesson',
        title: 'Live lesson starting: ' + (title || ''),
        body: 'Join now: ' + joinUrl,
        conversationId: null,
        readAt: null,
        createdAt: dbm.nowISO()
      });
    });
  }
  dbm.save(true);
  return { ok: true, lesson };
});

route('GET', '/api/live-lessons', ({ user }) => {
  need(user, 'Sign in required', 401);
  let list = dbm.collection('liveLessons');
  if (user.role === 'super') { /* all */ }
  else if (user.role === 'tenant_admin') list = list.filter(l => l.tenantId === user.tenantId);
  else if (user.role === 'supervisor') list = list.filter(l => l.creatorId === user.id || (l.recipientIds || []).includes(user.id));
  else list = list.filter(l => (l.recipientIds || []).includes(user.id));
  return { ok: true, lessons: list.slice().sort((a,b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt))) };
});

module.exports = { handle };
