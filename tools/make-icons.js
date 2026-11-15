'use strict';
/* Regenerates every account icon file without touching any shortcut.

   The desktop / taskbar / Start Menu shortcuts, the browser tab (favicon) and
   the Android home-screen icon all read the SAME picture: assets/icons/<slug>.ico
   (and <slug>.png for the web). This tool refreshes those files for one account
   or for every account, which is what a deployment update runs so an icon
   changed in the browser is on the desktop the moment the app reloads.

       node tools/make-icons.js                 (every account)
       node tools/make-icons.js --slug x        (one account)
       node tools/make-icons.js --list          (show what exists)
*/
const fs = require('fs');
const path = require('path');
const icons = require('../server/icons');

const ROOT = path.join(__dirname, '..');
const dbFile = path.join(ROOT, 'data', 'db.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

const args = process.argv.slice(2);
const slugArg = args.indexOf('--slug') >= 0 ? args[args.indexOf('--slug') + 1] : null;
const listOnly = args.indexOf('--list') !== -1;
const db = readJson(dbFile, { tenants: [] });
const tenants = db.tenants || [];

if (listOnly) {
  fs.mkdirSync(icons.ICON_DIR, { recursive: true });
  const files = fs.readdirSync(icons.ICON_DIR).filter(function (f) { return /\.(ico|png)$/i.test(f); });
  console.log('[icons] ' + icons.ICON_DIR);
  if (!files.length) console.log('  (no icon files yet — run: npm run icons)');
  files.forEach(function (f) {
    const st = fs.statSync(path.join(icons.ICON_DIR, f));
    console.log('  ' + f + '  ' + st.size + ' bytes');
  });
  process.exit(0);
}

const list = slugArg ? tenants.filter(function (t) { return t.slug === slugArg; }) : tenants;
if (!list.length) {
  console.error('[icons] No account found' + (slugArg ? ' for slug "' + slugArg + '"' : '') +
    ' in data/db.json');
  process.exit(1);
}

list.forEach(function (t) {
  try {
    const out = icons.writeIco(t);
    const st = fs.statSync(out.ico);
    console.log('[icons] ' + t.name + ' (' + t.slug + ')');
    console.log('  ico : ' + out.ico + '  (' + st.size + ' bytes)');
    console.log('  png : ' + out.png);
  } catch (e) {
    console.error('[icons] ' + t.slug + ' failed: ' + (e && e.message ? e.message : e));
  }
});
console.log('[icons] done — ' + list.length + ' account(s)');
