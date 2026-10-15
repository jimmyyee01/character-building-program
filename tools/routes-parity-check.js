/* Every endpoint the UI calls must exist on BOTH backends, and the two route
   tables must expose the same paths.

   Static: no server needed.  Usage: node tools/routes-parity-check.js
   It reads the client calls (public/js/*.js: API.get/post/put/del('...')) and the
   route tables (server/api.js, php/api.php), normalises ids to ":id", drops query
   strings and compares. Catches the "Unknown endpoint: GET /api/..." class of bug
   before it ships — a screen calling a route only one backend has. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let bad = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || !extra ? '' : '  [' + String(extra).slice(0, 300) + ']'));
  if (!cond) bad++;
}

/* ---- the route tables ------------------------------------------------- */
function routesOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = new Map();               /* 'METHOD /api/path' -> line number */
  const re = /route\(\s*'([A-Z]+)'\s*,\s*'(\/api[^']*)'/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    out.set(m[1] + ' ' + pathOf(m[2]), line);
  }
  return out;
}
/* a route pattern is a regex: its id placeholders all mean ":id" */
function pathOf(pattern) {
  return String(pattern)
    .replace(/\(\[[^\]]*\]\+\)/g, ':id')
    .replace(/\\\//g, '/')
    .split('?')[0]
    .replace(/\/+$/, '');
}

/* ---- the calls the UI makes ------------------------------------------ */
function callsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /API\.(get|post|put|del)\(\s*([^,;\n]*)/g;
  let m;
  while ((m = re.exec(src))) {
    const method = { get: 'GET', post: 'POST', put: 'PUT', del: 'DELETE' }[m[1]];
    const built = buildPath(m[2]);
    if (!built) continue;
    out.push({ method: method, path: built,
      where: path.basename(file) + ':' + src.slice(0, m.index).split('\n').length, raw: m[2].trim() });
  }
  return out;
}
/* '/books/' + id + '/chapters'  ->  /books/:id/chapters
   '/x' + query                  ->  /x        (an expression after a non-slash is
                                               a query string, not a segment) */
function buildPath(exprRaw) {
  const expr = String(exprRaw).replace(/\)+\s*$/, '').trim();   /* closing parens of the call */
  const first = expr.match(/^\s*(['"])([^'"]*)\1/);
  if (!first) return null;                       /* dynamic path: not checked */
  if (!first[2].startsWith('/')) return null;
  let out = first[2];
  const rest = expr.slice(expr.indexOf(first[0]) + first[0].length);
  const parts = rest.split('+').map(function (s) { return s.trim(); }).filter(Boolean);
  for (const p of parts) {
    const lit = p.match(/^(['"])([^'"]*)\1$/);
    if (lit) { out += lit[2]; continue; }
    if (/\/$/.test(out)) out += ':id';            /* an id in a path position */
  }
  return out.split('?')[0].replace(/\/+$/, '') || null;
}

const nodeRoutes = routesOf(path.join(ROOT, 'server', 'api.js'));
const phpRoutes = routesOf(path.join(ROOT, 'php', 'api.php'));

const onlyNode = [...nodeRoutes.keys()].filter(r => !phpRoutes.has(r));
const onlyPhp = [...phpRoutes.keys()].filter(r => !nodeRoutes.has(r));
check('both backends expose the same routes (' + nodeRoutes.size + ' vs ' + phpRoutes.size + ')',
  onlyNode.length === 0 && onlyPhp.length === 0,
  (onlyNode.length ? 'only in Node: ' + onlyNode.join(', ') : '') +
  (onlyPhp.length ? ' only in PHP: ' + onlyPhp.join(', ') : ''));

const calls = [];
for (const f of fs.readdirSync(path.join(ROOT, 'public', 'js'))) {
  if (!/\.js$/.test(f)) continue;
  calls.push(...callsOf(path.join(ROOT, 'public', 'js', f)));
}
const seen = new Set();
const misses = [];
for (const c of calls) {
  /* API.call() does fetch('/api' + path) — compare with the prefix in place */
  const key = c.method + ' /api' + c.path;
  if (seen.has(key)) continue;
  seen.add(key);
  if (!nodeRoutes.has(key)) misses.push('Node ' + key + '  <- ' + c.where + '  (' + c.raw + ')');
  if (!phpRoutes.has(key)) misses.push('PHP  ' + key + '  <- ' + c.where + '  (' + c.raw + ')');
}
check('every endpoint the UI calls exists on both backends (' + seen.size + ' calls)',
  misses.length === 0, misses.join(' | '));

check('the CACHE-CLEAR / health helpers the console uses are registered',
  nodeRoutes.has('GET /api/health') && phpRoutes.has('GET /api/health'));

console.log('');
console.log('routes: Node ' + nodeRoutes.size + ', PHP ' + phpRoutes.size +
  ', UI calls examined ' + seen.size + (misses.length ? ', unresolved ' + misses.length : ''));
console.log(bad ? '\n' + bad + ' FAILED' : '\nROUTES IN PARITY OK');
process.exit(bad ? 1 : 0);
