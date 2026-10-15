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
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8'
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

function serveFile(res, file) {
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
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size
    });
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
      return serveFile(res, f);
    }
    if (PAGES[p]) return serveFile(res, path.join(PUBLIC, PAGES[p]));
    if (p.startsWith('/t/')) return serveFile(res, path.join(PUBLIC, 'login.html'));
    if (p === '/favicon.ico') return serveFile(res, path.join(PUBLIC, 'favicon.ico'));

    const f = safeJoin(PUBLIC, p);
    if (!f) return sendJSON(res, 403, { ok: false, error: 'Forbidden' });
    return serveFile(res, f);
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

server.listen(PORT, () => {
  console.log('-------------------------------------------------------------');
  console.log(' Character Building Program');
  console.log(' Super admin : http://localhost:' + PORT + '/super');
  console.log(' Landing     : http://localhost:' + PORT + '/');
  console.log(' Demo school : http://localhost:' + PORT + '/t/greenfield-academy');
  console.log('-------------------------------------------------------------');
});
