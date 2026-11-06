'use strict';
/* Password hashing (PBKDF2), session cookies and role guards. */

const crypto = require('crypto');
const dbm = require('./db');

const SESSION_DAYS = 7;

/* ------------------------------------------------------- leaving the app --- */
/* A STUDENT's sign-in lasts only as long as the program is on screen. The app
   sends a beat every few seconds while it is open and in front of the learner,
   so a session that has shown no sign of life for STUDENT_IDLE_MS belongs to a
   window that was minimised, closed or left for another program or tab: it is
   destroyed and the learner must sign in again. Staff (super admin, account
   admin, supervisor, teacher) keep the ordinary seven-day session.
   The beats live in memory only. A restart therefore never signs a learner out
   by itself, and nothing extra is written to the database on every request. */
const STUDENT_IDLE_MS = Math.max(500, Number(process.env.STUDENT_IDLE_MS) || 45000);
const LEAVE_ROLES = ['student'];
const liveAt = new Map();          /* token -> ms of the last sign of life */

function isLeaveLocked(user) {
  return !!user && LEAVE_ROLES.indexOf(user.role) !== -1;
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  try {
    const h = crypto.pbkdf2Sync(String(password), salt || '', 120000, 64, 'sha512').toString('hex');
    if (!hash || h.length !== hash.length) return false;
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  } catch (e) {
    return false;
  }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers && req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function tokenFromRequest(req) {
  const authz = req.headers && req.headers.authorization;
  if (authz && authz.startsWith('Bearer ')) return authz.slice(7).trim();
  const c = parseCookies(req);
  if (c.cbp_token) return c.cbp_token;
  return null;
}

function createSession(req, res, user) {
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  dbm.collection('sessions').push({
    token,
    userId: user.id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_DAYS * 86400000).toISOString()
  });
  if (isLeaveLocked(user)) liveAt.set(token, now);
  // prune old sessions
  dbm.db.sessions = dbm.db.sessions.filter(s => new Date(s.expiresAt).getTime() > now);
  dbm.save();
  res.setHeader('Set-Cookie', 'cbp_token=' + token + '; HttpOnly; Path=/; Max-Age=' + (SESSION_DAYS * 86400) + '; SameSite=Lax');
  return token;
}

function destroySession(req, res) {
  const token = tokenFromRequest(req);
  if (token) {
    dbm.db.sessions = (dbm.db.sessions || []).filter(s => s.token !== token);
    liveAt.delete(token);
    dbm.save();
  }
  res.setHeader('Set-Cookie', 'cbp_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

/* The app says "still here". Called every few seconds by a student's page, and
   by every student request, so only a window that has really gone quiet dies. */
function beatSession(token) {
  if (token) liveAt.set(token, Date.now());
}

/* A student session that has been silent past the idle limit is over: it is
   removed so the same link cannot be used again from anywhere. */
function endSilentSession(token) {
  liveAt.delete(token);
  dbm.db.sessions = (dbm.db.sessions || []).filter(s => s.token !== token);
  dbm.save();
}

function currentUser(req) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const session = (dbm.db.sessions || []).find(s => s.token === token);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;
  const user = dbm.byId('users', session.userId);
  if (!user) return null;
  if (user.suspended) return null;
  if (isLeaveLocked(user)) {
    const now = Date.now();
    const last = liveAt.get(token) || 0;
    if (!last) beatSession(token);                 /* first sighting after a restart */
    else if (now - last > STUDENT_IDLE_MS) {       /* the app was left: sign out */
      endSilentSession(token);
      return null;
    } else beatSession(token);
  }
  return user;
}

/* Returns the user when they hold one of the allowed roles, otherwise null. */
function requireRole(user, roles) {
  if (!user) return null;
  return roles.includes(user.role) ? user : null;
}

module.exports = {
  hashPassword, verifyPassword, parseCookies, tokenFromRequest,
  createSession, destroySession, currentUser, requireRole,
  beatSession, isLeaveLocked, STUDENT_IDLE_MS
};
