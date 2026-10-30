'use strict';
/* HTTP server: static files, tenant pages and the JSON API. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const dbm = require('./db');
require('./seed'); // loads the database, creating it on first run
const api = require('./api');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(ROOT, 'uploads');
const PORT = Number(process.env.PORT) || 3000;
const BODY_LIMIT = 400 * 1024 * 1024; // 400 MB (photo/logo/file uploads arrive base64-encoded in JSON)

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.ogv': 'video/ogg',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.wav': 'audio/wav', '.flac': 'audio/flac', '.txt': 'text/plain; charset=utf-8'
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function safeJoin(base, target) {
  const p = path.normalize(path.join(base, target));
  if (p !== base && !p.startsWith(base + path.sep)) return null;
  return p;
}

/* Cache policy. The page a browser is holding is the page that names the
   versioned assets, so a stale page keeps loading stale scripts and a deployed
   update looks like it never arrived. A page is therefore never stored by the
   browser. A versioned asset (?v=NN) may be kept for a year, because the version
   changes with every build. Anything else (uploaded photos, PDFs, videos) is
   kept for an hour and revalidated with an ETag after that. */
function cacheHeaders(file, url) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return { 'Cache-Control': 'no-store, must-revalidate' };
  if (url && /[?&]v=/.test(url)) return { 'Cache-Control': 'public, max-age=31536000, immutable' };
  return { 'Cache-Control': 'public, max-age=3600' };
}

function serveFile(req, res, file) {
  // The Node backend cannot execute PHP, so never hand out PHP sources (the PHP
  // build serves those paths itself when it is the backend in use).
  if (path.extname(file).toLowerCase() === '.php') {
    return sendJSON(res, 404, {
      ok: false,
      error: 'Nothing to clear here: this is the Node backend, which builds its routes at boot — '
        + 'restart the process (pm2/systemctl). /cache-clear.php is for PHP hosts.'
    });
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJSON(res, 404, { ok: false, error: 'Not found' });
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req && req.headers ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '') : null;
    const cache = cacheHeaders(file, req && req.url);
    /* A page is never stored, so it needs no validator; anything a browser may
       keep is tagged, so the next request can be answered with a cheap 304. */
    if (cache['Cache-Control'].indexOf('no-store') === -1) {
      cache.ETag = '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
      cache['Last-Modified'] = st.mtime.toUTCString();
      if (!range && req.headers['if-none-match'] === cache.ETag) {
        return res.writeHead(304, cache).end();
      }
    }
    if (range && st.size > 0) {
      let start = range[1] ? parseInt(range[1], 10) : 0;
      let end = range[2] ? parseInt(range[2], 10) : st.size - 1;
      if (!isFinite(start) || !isFinite(end) || start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + st.size });
        return res.end();
      }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, Object.assign({
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size,
        'Accept-Ranges': 'bytes'
      }, cache));
      return fs.createReadStream(file, { start: start, end: end }).pipe(res);
    }
    res.writeHead(200, Object.assign({
      'Content-Type': type,
      'Content-Length': st.size,
      'Accept-Ranges': 'bytes'
    }, cache));
    fs.createReadStream(file).pipe(res);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve(null);
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > BODY_LIMIT) { reject(new Error('Payload too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(null);
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(raw ? JSON.parse(raw) : null); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/* Friendly page routes — every school/org gets its own login URL: /t/<slug> */
const PAGES = {
  '/': 'index.html',
  '/super': 'super.html',
  '/admin': 'admin.html',
  '/app': 'app.html'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);

    if (p.startsWith('/api/')) {
      const body = await parseBody(req);
      return await api.handle(req, res, p, body);
    }
    if (p.startsWith('/uploads/')) {
      const f = safeJoin(UPLOADS, p.slice('/uploads/'.length));
      if (!f) return sendJSON(res, 403, { ok: false, error: 'Forbidden' });
      return serveFile(req, res, f);
    }
    if (PAGES[p]) return serveFile(req, res, path.join(PUBLIC, PAGES[p]));
    if (p.startsWith('/t/')) return serveFile(req, res, path.join(PUBLIC, 'login.html'));
    if (p === '/favicon.ico') return serveFile(req, res, path.join(PUBLIC, 'favicon.ico'));

    const f = safeJoin(PUBLIC, p);
    if (!f) return sendJSON(res, 403, { ok: false, error: 'Forbidden' });
    return serveFile(req, res, f);
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) {
      const code = e.message === 'Payload too large' ? 413 : 500;
      sendJSON(res, code, { ok: false, error: e.message || 'Server error' });
    }
  }
});

process.on('exit', () => { try { dbm.flush(); } catch (e) {} });
process.on('SIGINT', () => { try { dbm.flush(); } catch (e) {} process.exit(0); });

// Cron: notify students of due live lessons (once) at scheduled time.
setInterval(() => {
  try {
    const now = new Date();
    const lessons = dbm.collection('liveLessons');
    let changed = false;
    lessons.forEach(l => {
      if (l.notified) return;
      if (!l.scheduledAt) return;
      if (new Date(l.scheduledAt) > now) return;
      (l.recipientIds || []).forEach(rid => {
        dbm.collection('notifications').push({
          id: dbm.uid('ntf'),
          userId: rid,
          type: 'live_lesson',
          title: 'Live lesson starting: ' + (l.title || ''),
          body: 'Join now: ' + l.joinUrl,
          conversationId: null,
          readAt: null,
          createdAt: dbm.nowISO()
        });
        try {
          const participants = [l.creatorId, rid].sort();
          let conv = dbm.collection('conversations').find(c =>
            c.tenantId === l.tenantId && Array.isArray(c.participantIds) &&
            c.participantIds.length === 2 && c.participantIds.slice().sort().join('|') === participants.join('|'));
          if (!conv) {
            conv = { id: dbm.uid('cnv'), tenantId: l.tenantId, participantIds: participants, createdAt: dbm.nowISO(), updatedAt: dbm.nowISO() };
            dbm.collection('conversations').push(conv);
          }
          dbm.collection('messages').push({
            id: dbm.uid('msg'),
            conversationId: conv.id,
            senderId: l.creatorId,
            body: 'Live lesson starting: ' + (l.title || '') + ' — Join now: ' + l.joinUrl,
            readAt: null,
            createdAt: dbm.nowISO()
          });
          conv.updatedAt = dbm.nowISO();
        } catch (e) {}
      });
      l.notified = true;
      changed = true;
    });
    if (changed) dbm.save(true);
  } catch (e) { console.error('[live-lessons cron]', e.message); }
}, 60000);


server.listen(PORT, () => {
  console.log('-------------------------------------------------------------');
  console.log(' Character Building Program');
  console.log(' Super admin : http://localhost:' + PORT + '/super');
  console.log(' Landing     : http://localhost:' + PORT + '/');
  console.log(' Demo school : http://localhost:' + PORT + '/t/greenfield-academy');
  console.log('-------------------------------------------------------------');
});
