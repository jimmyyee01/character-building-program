'use strict';
/* ============================================================ live classes ==
   A live class is a room this program itself starts: the presenter's camera and
   microphone in the browser, the words being said turned into text (captions ->
   transcript), and an alert that carries the join link to the people who are
   meant to be there.

   Who may start one, and who is told:
     super        -> everyone in the system (or one account, when chosen)
     tenant_admin -> everyone in their account
     supervisor   -> only the learners assigned to them
   Learners only receive: an alert with the link, and the room it opens.

   A class is 'scheduled' until its time comes (then it flips to 'live' by
   itself and the "starting now" alert goes out), or it is started on the spot.
   The host ends it when the lesson is over; the transcript stays.
   ------------------------------------------------------------------------- */

const crypto = require('crypto');
const dbm = require('./db');

const CREATORS = ['super', 'tenant_admin', 'supervisor'];
const CAPTION_CAP = 4000;             /* lines kept per class */
const PRESENCE_STALE_MS = 10 * 60000; /* a participant row older than this is gone */
const PRESENCE_LIVE_MS = 90000;       /* "in the room" = heard from in the last 90s */
const DEFAULT_DOMAIN = 'meet.jit.si';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_MAX = 200;

class LiveError extends Error {
  constructor(message, status) { super(message); this.status = status || 400; }
}
function need(cond, message, status) {
  if (!cond) throw new LiveError(message, status || 400);
}

/* ------------------------------------------------------------- helpers --- */
function collection(name) { return dbm.collection(name); }

function newCode() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}
function uniqueCode() {
  let code = newCode();
  while (collection('liveLessons').some(l => l.code === code)) code = newCode();
  return code;
}
/* The meeting room name is NOT the join code: a code is read aloud in class,
   the room name must be impossible to guess your way into. */
function roomName() {
  return 'cbp-' + crypto.randomBytes(8).toString('hex');
}

/* Where the video lives. Default is the public Jitsi Meet; a school that runs
   its own Jitsi server only has to type its domain in Settings. 'off' turns the
   built-in room off (a class is then its meeting link and its transcript). */
function videoDomain() {
  const raw = String((dbm.db.settings || {}).videoDomain || '').trim().toLowerCase();
  if (raw === 'off' || raw === 'none' || raw === '0') return null;
  const host = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\s+/g, '');
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(host) ? host : DEFAULT_DOMAIN;
}
function videoBase(lesson) {
  const domain = videoDomain();
  if (!domain || !lesson.room) return null;
  return 'https://' + domain + '/' + lesson.room;
}

function roomPath(lesson) { return '/live?code=' + lesson.code; }
function who(user) {
  return (user && (user.fullName || user.email || user.username)) || 'Host';
}
/* 2026-11-12 at 14:30, spelled out for an alert. */
function whenText(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'soon';
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return date + ' at ' + time;
}

function find(value) {
  const key = String(value || '').trim();
  if (!key) return null;
  const list = collection('liveLessons');
  return list.find(l => l.id === key) ||
    list.find(l => String(l.code || '').toUpperCase() === key.toUpperCase()) || null;
}

function isHost(user, lesson) {
  if (!user || !lesson) return false;
  return lesson.creatorId === user.id || user.role === 'super';
}
function isInvited(user, lesson) {
  if (!user || !lesson) return false;
  if (lesson.scope === 'all') return true;          /* the whole system */
  return (lesson.recipientIds || []).indexOf(user.id) !== -1;
}
function canWatch(user, lesson) {
  return isHost(user, lesson) || isInvited(user, lesson);
}

/* ------------------------------------------------------------- audience --- */
/* Who is told about this class. The role decides the reach: a supervisor can
   never widen it to a whole account, an account admin can never leave it. */
function audience(user, body) {
  const users = collection('users');
  const alive = u => u && !u.suspended && u.id !== user.id;
  if (user.role === 'supervisor') {
    return {
      scope: 'supervised', tenantId: user.tenantId || null,
      recipientIds: users.filter(u => alive(u) && u.supervisorId === user.id).map(u => u.id)
    };
  }
  if (user.role === 'tenant_admin') {
    return {
      scope: 'account', tenantId: user.tenantId || null,
      recipientIds: users.filter(u => alive(u) && u.tenantId === user.tenantId).map(u => u.id)
    };
  }
  /* super: one account on request, otherwise every user of the system */
  const target = String((body && (body.tenantId || body.accountId)) || '').trim();
  if (target && target !== 'all') {
    const tenant = dbm.byId('tenants', target);
    need(tenant, 'Account not found', 404);
    return {
      scope: 'account', tenantId: tenant.id,
      recipientIds: users.filter(u => alive(u) && u.tenantId === tenant.id).map(u => u.id)
    };
  }
  return {
    scope: 'all', tenantId: null,
    recipientIds: users.filter(alive).map(u => u.id)
  };
}

/* --------------------------------------------------------------- alerts --- */
/* One alert per invited person. It carries the join code, so the message in the
   alerts panel is itself the way in. */
function notify(lesson, kind) {
  const now = dbm.nowISO();
  const list = collection('notifications');
  const path = roomPath(lesson);
  const title = kind === 'scheduled'
    ? 'Live class scheduled: ' + lesson.title
    : 'Live class starting: ' + lesson.title;
  const body = kind === 'scheduled'
    ? whenText(lesson.scheduledAt) + ' — join here: ' + path
    : 'Join now: ' + path;
  (lesson.recipientIds || []).forEach(userId => {
    list.push({
      id: dbm.uid('ntf'),
      userId,
      type: 'live_class',
      title,
      body,
      liveCode: lesson.code,
      liveUrl: path,
      libraryId: null,
      videoUrl: null,
      conversationId: null,
      readAt: null,
      createdAt: now
    });
  });
  return (lesson.recipientIds || []).length;
}

/* A class that has reached its time becomes live and alerts everybody once. */
function goLive(lesson) {
  lesson.status = 'live';
  lesson.startedAt = lesson.startedAt || dbm.nowISO();
  if (!lesson.startAlertSent) {
    notify(lesson, 'now');
    lesson.startAlertSent = true;
    lesson.notified = true;
  }
}
/* Called on every read of the class list, of a room and of the alerts, so a
   scheduled class opens itself on time (the server's own timer calls it too). */
function dueTick(now) {
  const moment = now || new Date();
  let changed = false;
  collection('liveLessons').forEach(lesson => {
    if (lesson.status !== 'scheduled' || !lesson.scheduledAt) return;
    const at = new Date(lesson.scheduledAt);
    if (isNaN(at.getTime()) || at > moment) return;
    goLive(lesson);
    changed = true;
  });
  if (changed) dbm.save(true);
  return changed;
}

/* ---------------------------------------------------------------- shape --- */
function publicLesson(lesson, user) {
  return {
    id: lesson.id,
    code: lesson.code,
    title: lesson.title,
    scope: lesson.scope || 'account',
    status: lesson.status || 'scheduled',
    scheduledAt: lesson.scheduledAt,
    startedAt: lesson.startedAt || null,
    endedAt: lesson.endedAt || null,
    creatorId: lesson.creatorId,
    creatorName: lesson.creatorName || '',
    creatorRole: lesson.creatorRole || null,
    tenantId: lesson.tenantId || null,
    recipients: (lesson.recipientIds || []).length,
    joinUrl: lesson.joinUrl || null,
    roomPath: roomPath(lesson),
    videoBase: videoBase(lesson),
    captions: Number(lesson.captionCount) || 0,
    canHost: isHost(user, lesson),
    canJoin: canWatch(user, lesson),
    createdAt: lesson.createdAt
  };
}

/* A class, if this person may see it at all: a wrong code must not even say
   whether it exists. */
function readable(user, value) {
  const lesson = find(value);
  need(lesson, 'Live class not found', 404);
  need(canWatch(user, lesson), 'This class is not for your account', 403);
  return lesson;
}
function editable(user, value) {
  const lesson = find(value);
  need(lesson, 'Live class not found', 404);
  need(isHost(user, lesson), 'Only the host can change this class', 403);
  return lesson;
}

/* --------------------------------------------------------------- create --- */
function create(user, body) {
  need(user, 'Sign in required', 401);
  need(CREATORS.indexOf(user.role) !== -1, 'Not permitted for this account', 403);
  body = body || {};
  const title = String(body.title || '').trim();
  need(title, 'Title required');
  need(title.length <= 200, 'Title is too long');

  /* A meeting link is optional now (the room is built in) but still welcome for
     a host who prefers Zoom or Google Meet. */
  const external = String(body.joinUrl || body.link || body.zoomUrl || body.meetingUrl || '').trim();
  if (external) {
    need(/^https?:\/\/\S+$/i.test(external), 'Meeting link must start with http:// or https://');
    need(external.length <= 1000, 'Meeting link is too long');
  }

  /* "Start now" is the default: no date means the class begins immediately. */
  const startNow = body.startNow === true || body.startNow === 'true' || !body.scheduledAt;
  let scheduledAt = dbm.nowISO();
  if (!startNow) {
    const parsed = new Date(String(body.scheduledAt));
    need(!isNaN(parsed.getTime()), 'Invalid lesson date and time');
    scheduledAt = parsed.toISOString();
  }

  const reach = audience(user, body);
  const lesson = {
    id: dbm.uid('lesson'),
    code: uniqueCode(),
    title,
    scope: reach.scope,
    tenantId: reach.tenantId,
    creatorId: user.id,
    creatorName: who(user),
    creatorRole: user.role,
    recipientIds: reach.recipientIds,
    status: 'scheduled',
    scheduledAt,
    startedAt: null,
    endedAt: null,
    joinUrl: external || null,
    room: roomName(),
    captionSeq: 0,
    captionCount: 0,
    scheduledAlertSent: false,
    startAlertSent: false,
    notified: false,
    createdAt: dbm.nowISO()
  };
  collection('liveLessons').push(lesson);

  if (startNow) {
    goLive(lesson);
  } else {
    notify(lesson, 'scheduled');
    lesson.scheduledAlertSent = true;
  }
  dbm.save(true);
  return {
    ok: true,
    lesson: publicLesson(lesson, user),
    invited: lesson.recipientIds.length,
    /* the system log names the class and says whether it began or is waiting */
    logEntry: {
      action: startNow ? 'started' : 'scheduled',
      entity: 'live-class', entityId: lesson.id, label: lesson.title
    }
  };
}

/* ----------------------------------------------------------------- list --- */
function list(user) {
  need(user, 'Sign in required', 401);
  dueTick();
  let rows = collection('liveLessons');
  if (user.role === 'super') {
    /* everything */
  } else if (user.role === 'tenant_admin') {
    rows = rows.filter(l => l.scope === 'all' || (l.tenantId && l.tenantId === user.tenantId));
  } else {
    rows = rows.filter(l => l.creatorId === user.id || canWatch(user, l));
  }
  const rank = { live: 0, scheduled: 1, ended: 2, cancelled: 3 };
  const sorted = rows.slice().sort((a, b) =>
    (rank[a.status] === undefined ? 1 : rank[a.status]) - (rank[b.status] === undefined ? 1 : rank[b.status]) ||
    String(a.scheduledAt || '').localeCompare(String(b.scheduledAt || '')));

  return {
    ok: true,
    lessons: sorted.slice(0, ROOM_MAX).map(l => publicLesson(l, user)),
    live: sorted.filter(l => l.status === 'live').length,
    total: sorted.length
  };
}

/* --------------------------------------------------------- start / end ---- */
function start(user, id) {
  need(user, 'Sign in required', 401);
  const lesson = editable(user, id);
  need(lesson.status !== 'ended' && lesson.status !== 'cancelled', 'This class has already finished');
  goLive(lesson);
  dbm.save(true);
  return {
    ok: true,
    lesson: publicLesson(lesson, user),
    logEntry: { action: 'started', entity: 'live-class', entityId: lesson.id, label: lesson.title }
  };
}

function end(user, id) {
  need(user, 'Sign in required', 401);
  const lesson = editable(user, id);
  need(lesson.status === 'live' || lesson.status === 'scheduled', 'This class is already over');
  lesson.status = 'ended';
  lesson.endedAt = dbm.nowISO();
  collection('livePresence').slice().forEach(row => {
    if (row.lessonId === lesson.id) dbm.remove('livePresence', row.id);
  });
  dbm.save(true);
  return {
    ok: true,
    lesson: publicLesson(lesson, user),
    logEntry: { action: 'ended', entity: 'live-class', entityId: lesson.id, label: lesson.title }
  };
}

function cancel(user, id) {
  need(user, 'Sign in required', 401);
  const lesson = editable(user, id);
  need(lesson.status !== 'ended', 'This class has already ended');
  lesson.status = 'cancelled';
  lesson.endedAt = dbm.nowISO();
  collection('livePresence').slice().forEach(row => {
    if (row.lessonId === lesson.id) dbm.remove('livePresence', row.id);
  });
  dbm.save(true);
  return {
    ok: true,
    lesson: publicLesson(lesson, user),
    logEntry: { action: 'cancelled', entity: 'live-class', entityId: lesson.id, label: lesson.title }
  };
}

/* ------------------------------------------------------------- the room --- */
function roster(lesson) {
  const since = Date.now() - PRESENCE_LIVE_MS;
  return collection('livePresence')
    .filter(row => row.lessonId === lesson.id &&
      new Date(row.lastSeenAt || row.joinedAt || 0).getTime() >= since)
    .sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)))
    .map(row => ({ userId: row.userId, name: row.name, role: row.role,
      host: row.userId === lesson.creatorId }));
}

function room(user, code) {
  need(user, 'Sign in required', 401);
  dueTick();
  const lesson = readable(user, code);
  return {
    ok: true,
    lesson: publicLesson(lesson, user),
    me: { id: user.id, name: who(user), role: user.role, host: isHost(user, lesson) },
    roster: roster(lesson),
    captions: captionLines(lesson, 0, 60),
    seq: Number(lesson.captionSeq) || 0
  };
}

/* A heartbeat that doubles as "I am in the room": presence is what fills the
   participant list, and it fades on its own when a browser disappears. */
function join(user, code) {
  need(user, 'Sign in required', 401);
  dueTick();
  const lesson = readable(user, code);
  need(lesson.status !== 'cancelled', 'This class was cancelled');
  const now = dbm.nowISO();
  const id = lesson.id + ':' + user.id;
  const present = dbm.byId('livePresence', id);
  if (present) {
    present.lastSeenAt = now;
    present.name = who(user);
    present.role = user.role;
  } else {
    collection('livePresence').push({
      id, lessonId: lesson.id, userId: user.id, name: who(user), role: user.role,
      joinedAt: now, lastSeenAt: now
    });
  }
  /* tidy: nobody keeps a seat for ever */
  const stale = Date.now() - PRESENCE_STALE_MS;
  collection('livePresence').slice().forEach(row => {
    const seen = new Date(row.lastSeenAt || row.joinedAt || 0).getTime();
    if (!isFinite(seen) || seen < stale) dbm.remove('livePresence', row.id);
  });
  dbm.save();
  return {
    ok: true,
    status: lesson.status,
    seq: Number(lesson.captionSeq) || 0,
    roster: roster(lesson)
  };
}

/* -------------------------------------------------------------- captions --- */
/* What is being said, in order. seq only grows, so a viewer asks for
   "everything after 40" and never misses or repeats a line. */
function captionLines(lesson, after, limit) {
  const from = Math.max(0, Number(after) || 0);
  const max = Math.max(1, Math.min(400, Number(limit) || 200));
  return collection('liveCaptions')
    .filter(line => line.lessonId === lesson.id && line.seq > from)
    .sort((a, b) => a.seq - b.seq)
    .slice(0, max)
    .map(line => ({ seq: line.seq, at: line.at, speaker: line.speakerName, text: line.text }));
}

function captions(user, code, after) {
  need(user, 'Sign in required', 401);
  const lesson = readable(user, code);
  return {
    ok: true,
    status: lesson.status,
    seq: Number(lesson.captionSeq) || 0,
    lines: captionLines(lesson, after, 300)
  };
}

/* Only the host's browser speaks into the transcript: the words come from the
   room it is running (the microphone being used for the class). */
function addCaptions(user, code, body) {
  need(user, 'Sign in required', 401);
  const lesson = editable(user, code);
  need(lesson.status === 'live', 'The class is not live', 409);
  body = body || {};
  const incoming = Array.isArray(body.lines) ? body.lines : [body];
  need(incoming.length, 'Nothing to save');
  need(incoming.length <= 60, 'Too many lines at once');

  const stored = [];
  incoming.forEach(entry => {
    const text = String((entry && (entry.text || entry.body)) || '')
      .replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!text) return;
    lesson.captionSeq = (Number(lesson.captionSeq) || 0) + 1;
    const line = {
      id: dbm.uid('cap'),
      lessonId: lesson.id,
      seq: lesson.captionSeq,
      at: dbm.nowISO(),
      speakerId: user.id,
      speakerName: who(user),
      text
    };
    collection('liveCaptions').push(line);
    stored.push(line);
    lesson.captionCount = (Number(lesson.captionCount) || 0) + 1;
  });
  need(stored.length, 'Nothing to save');

  /* the oldest lines fall away, so a very long class cannot grow without end */
  const mine = collection('liveCaptions').filter(l => l.lessonId === lesson.id);
  if (mine.length > CAPTION_CAP) {
    mine.sort((a, b) => a.seq - b.seq).slice(0, mine.length - CAPTION_CAP)
      .forEach(old => dbm.remove('liveCaptions', old.id));
    lesson.captionCount = Math.min(Number(lesson.captionCount) || 0, CAPTION_CAP);
  }
  dbm.save();
  return { ok: true, seq: lesson.captionSeq, saved: stored.length };
}

/* The whole transcript: for the host while the class runs, and for everybody
   who was invited once it is over. */
function transcript(user, id) {
  need(user, 'Sign in required', 401);
  const lesson = readable(user, id);
  const lines = captionLines(lesson, 0, 4000);
  const text = lines.map(line =>
    '[' + new Date(line.at).toLocaleTimeString('en-GB',
      { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '] ' +
    line.speaker + ': ' + line.text).join('\n');
  return {
    ok: true,
    lesson: publicLesson(lesson, user),
    lines,
    text,
    words: text ? text.split(/\s+/).filter(Boolean).length : 0
  };
}

module.exports = {
  CREATORS, CAPTION_CAP, DEFAULT_DOMAIN,
  create, list, start, end, cancel,
  room, join, captions, addCaptions, transcript,
  dueTick, find, publicLesson, videoDomain, videoBase, roomPath, whenText
};
