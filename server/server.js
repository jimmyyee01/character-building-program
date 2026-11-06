'use strict';
/* HTTP server: static files, tenant pages and the JSON API. When TLS certs are
   present it also serves HTTPS so browsers allow microphone access (voice
   typing needs a secure context). */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const dbm = require('./db');
require('./seed'); // loads the database, creating it on first run
const api = require('./api');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(ROOT, 'uploads');
const PORT = Number(process.env.PORT) || 3000;
/* 400 MB by default (photo/logo/file uploads arrive base64-encoded in JSON).
   Overridable so a check can prove the 413 answer without moving 400 MB. */
const BODY_LIMIT = Number(process.env.BODY_LIMIT) || 400 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  /* video — every container a school is likely to hand us, served with the
     MIME type that lets a browser attempt playback (seeking needs it) */
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.ogv': 'video/ogg', '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo', '.wmv': 'video/x-ms-wmv', '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg', '.m2ts': 'video/mp2t', '.ts': 'video/mp2t',
  '.vob': 'video/mpeg', '.3gp': 'video/3gpp',
  /* audio */
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/opus',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.wav': 'audio/wav', '.flac': 'audio/flac', '.weba': 'audio/webm',
  '.amr': 'audio/amr', '.mid': 'audio/midi', '.midi': 'audio/midi',
  '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.wma': 'audio/x-ms-wma'
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/* A caller's mistake is not a server fault: carry the status the answer earns,
   so one catch-all can tell a bad request (400) from a real crash (500). */
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
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
    let stopped = false;
    const chunks = [];
    req.on('data', c => {
      if (stopped) return;
      size += c.length;
      if (size > BODY_LIMIT) {
        /* Stop buffering, but keep the socket alive until the 413 has been
           written: destroying it here would reset the connection and the caller
           would never learn why the upload failed. */
        stopped = true;
        req.pause();
        reject(httpError(413, 'Payload too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (stopped || !chunks.length) return resolve(null);
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(raw ? JSON.parse(raw) : null); }
      catch (e) { reject(httpError(400, 'Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/* Friendly page routes — every school/org gets its own login URL: /t/<slug> */
const PAGES = {
  '/': 'index.html',
  '/super': 'super.html',
  '/admin': 'admin.html',
  '/app': 'app.html',
  /* the room a live-class alert opens: /live?code=ABC123 */
  '/live': 'live.html'
};

/* TLS is decided once, at boot, because two things depend on it: whether a
   plain-http page is moved to the secure address, and whether the room may
   promise a camera (browsers give one only to a secure address). */
const TLS_CERT = process.env.TLS_CERT || path.join(ROOT, 'certs', 'server.crt');
const TLS_KEY = process.env.TLS_KEY || path.join(ROOT, 'certs', 'server.key');
const HTTPS_PORT = process.env.HTTPS_PORT === 'off' ? 0 : (Number(process.env.HTTPS_PORT) || 443);
const HAS_TLS = HTTPS_PORT > 0 && fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY);
/* The live-class engine reads these to tell a room which address is the
   camera-safe one (and on which port, when it is not 443). */
process.env.APP_TLS = HAS_TLS ? '1' : '';
process.env.APP_HTTPS_PORT = HAS_TLS ? String(HTTPS_PORT) : '';

function loopbackHost(host) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(host || ''));
}

/* Move a browser (not an API client) from http://host:3000/live to the https
   address: an insecure page is the one place a camera can never work, and a
   host who typed the short address should land in the room that works. */
function secureRedirect(req, p) {
  if (!HAS_TLS) return null;
  if (req.socket && req.socket.encrypted) return null;
  if ((req.headers['x-forwarded-proto'] || '') === 'https') return null;
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  if (p.startsWith('/api/')) return null;
  if (!/\btext\/html\b/i.test(String(req.headers.accept || ''))) return null;
  const host = String(req.headers.host || '');
  if (!host || loopbackHost(host)) return null;
  const name = host.replace(/:\d+$/, '');
  const port = HTTPS_PORT === 443 ? '' : ':' + HTTPS_PORT;
  return 'https://' + name + port + req.url;
}

const handler = async (req, res) => {
  try {
    /* A path Node refuses to parse ("//%2e%2e%2f%2eenv") or a broken escape
       ("/%zz", "/%E0%A4%A") is the caller's mistake, not a crash: those used to
       raise URIError/ERR_INVALID_URL and answer 500. */
    let url, p;
    try {
      url = new URL(req.url, 'http://localhost');
      p = decodeURIComponent(url.pathname);
    } catch (e) {
      throw httpError(400, 'Malformed request path');
    }

    const toSecure = secureRedirect(req, p);
    if (toSecure) {
      res.writeHead(302, { Location: toSecure, 'Cache-Control': 'no-store' });
      return res.end();
    }

    /* The live room embeds a video server in a frame that needs the camera and
       the microphone: say so, instead of leaving it to the browser's default. */
    res.setHeader('Permissions-Policy',
      'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self)');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

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
    const code = e.status || 500;
    /* A caller's mistake is answered, not logged: a scanner probing "/%zz" used
       to fill the journal with stack traces for a request that was simply bad.
       Only a genuine fault (5xx) is worth a log line. */
    if (code >= 500) console.error('[server]', e);
    if (!res.headersSent) {
      sendJSON(res, code, { ok: false, error: e.message || 'Server error' });
    }
    /* An oversized upload was stopped mid-stream: answer first, then hang up. */
    if (code === 413) res.once('finish', () => { try { req.destroy(); } catch (err) { /* gone */ } });
  }
};

process.on('exit', () => { try { dbm.flush(); } catch (e) {} });
process.on('SIGINT', () => { try { dbm.flush(); } catch (e) {} process.exit(0); });

// Cron: a scheduled live class opens itself (and alerts its audience) when its
// time comes - the same tick runs whenever anybody reads the class list, so a
// server that was just restarted still catches up on the next request.
setInterval(() => {
  try {
    require('./live').dueTick();
  } catch (e) { console.error('[live-class cron]', e.message); }
}, 60000);

// Always serve plain HTTP (the existing live URL on :3000).
const httpServer = http.createServer(handler);
httpServer.listen(PORT, () => {
  console.log('-------------------------------------------------------------');
  console.log(' Character Building Program');
  console.log(' Super admin : http://localhost:' + PORT + '/super');
  console.log(' Landing     : http://localhost:' + PORT + '/');
  console.log(' Demo school : http://localhost:' + PORT + '/t/greenfield-academy');
  console.log('-------------------------------------------------------------');
});

// When TLS certs are present, also serve HTTPS so browsers allow microphone
// access (voice typing and the live classroom need a secure context). Without
// them, HTTP only. The certificate paths and the port are resolved at the top.
if (HAS_TLS) {
  try {
    const tls = { cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) };
    const httpsServer = https.createServer(tls, handler);
    httpsServer.listen(HTTPS_PORT, () => {
      console.log(' HTTPS       : https://localhost:' + HTTPS_PORT + '/ (microphone and camera enabled)');
    });
    httpsServer.on('error', (e) => console.error('[https]', e.message));
  } catch (e) {
    console.error('[https] failed to start:', e.message);
  }

  /* Port 80 is the address someone types from memory. With a certificate in
     place it only ever says one thing: go to https. Without it, someone who
     typed the short address would get a browser error (or, worse, an insecure
     page where the camera can never work). A port that is already taken is not
     an error: it is somebody else's web server, and this one carries on. */
  const REDIRECT_PORT = String(process.env.HTTP_REDIRECT_PORT || '80').trim().toLowerCase();
  if (REDIRECT_PORT !== 'off' && REDIRECT_PORT !== '0') {
    const port = Number(REDIRECT_PORT) || 80;
    const securePort = HTTPS_PORT === 443 ? '' : ':' + HTTPS_PORT;
    const redirectServer = http.createServer((req, res) => {
      const host = String(req.headers.host || '').replace(/:\d+$/, '') || 'localhost';
      res.writeHead(302, { Location: 'https://' + host + securePort + (req.url || '/'), 'Cache-Control': 'no-store' });
      res.end();
    });
    redirectServer.on('error', (e) => {
      console.log(' HTTP :' + port + '   : not used (' + (e.code || e.message) + ') — the https address still works');
    });
    redirectServer.listen(port, () => {
      console.log(' HTTP        : port ' + port + ' → https (the camera needs a secure address)');
    });
  }
} else {
  console.log(' HTTPS       : disabled (no TLS certs at ' + TLS_CERT + ') — the camera and the microphone need HTTPS');
}
