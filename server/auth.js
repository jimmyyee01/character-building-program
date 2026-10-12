'use strict';
/* Password hashing (PBKDF2), session cookies and role guards. */

const crypto = require('crypto');
const dbm = require('./db');

const SESSION_DAYS = 7;

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
    dbm.save();
  }
  res.setHeader('Set-Cookie', 'cbp_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
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
  return user;
}

/* Returns the user when they hold one of the allowed roles, otherwise null. */
function requireRole(user, roles) {
  if (!user) return null;
  return roles.includes(user.role) ? user : null;
}

module.exports = {
  hashPassword, verifyPassword, parseCookies, tokenFromRequest,
  createSession, destroySession, currentUser, requireRole
};
