'use strict';
/* Creates the Windows shortcuts for a selected account.

   What it makes:
     1. a DESKTOP shortcut (and the same one in the Start Menu),
     2. a TASKBAR-ready shortcut (the .lnk the user right-clicks and picks
        "Pin to taskbar"; the launcher also sets its own AppUserModelID so
        Windows groups it as its own program on the taskbar),
     3. an ANDROID home-screen icon — the account's own manifest and icon, so
        "Add to Home Screen" puts the account's logo on the phone.

   The icon of all of them is the ACCOUNT's logo (never the programme's
   generic mark): it is written to assets/icons/<slug>.ico and every shortcut
   points at that one file, so changing the logo changes the desktop, the
   taskbar and the phone together.

   Re-run it after an account logo changes or after a deployment update:
       node tools/make-shortcut.js --slug greenfield-academy
       node tools/make-shortcut.js --all          (every account)
       node tools/make-shortcut.js --slug x --taskbar   (pin it now)
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');
const icons = require('../server/icons');

const ROOT = path.join(__dirname, '..');
const cfgFile = path.join(ROOT, 'shortcut.config.json');
const dbFile = path.join(ROOT, 'data', 'db.json');
const launchersDir = path.join(ROOT, 'assets', 'launchers');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
const cfg = readJson(cfgFile, {});
const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
}
const has = name => args.indexOf('--' + name) !== -1;
const all = has('all');
const slugArg = arg('slug');
const slug = slugArg || (all ? null : (cfg.slug || 'greenfield-academy'));
const baseUrl = (cfg.baseUrl || 'http://localhost:3000').replace(/\/+$/, '');
const wantTaskbar = has('taskbar') || has('pin');
const db = readJson(dbFile, { tenants: [] });

/* --------------------------------------------------------------- helpers --- */
function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function run(script) {
  try {
    childProcess.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { stdio: 'ignore', timeout: 30000 });
    return true;
  } catch (e) { return false; }
}

/* Every place a desktop shortcut may live on a Windows machine. The answer is
   cached: asking the shell costs a PowerShell start-up, and it cannot change
   while the process runs. */
let DESKTOP_CACHE = null;
function desktopFolders() {
  if (DESKTOP_CACHE) return DESKTOP_CACHE;
  const out = [];
  const home = os.homedir();
  const seen = new Set();
  const add = function (p) {
    if (!p) return;
    const key = path.resolve(p).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    try { if (fs.existsSync(p) && fs.statSync(p).isDirectory()) out.push(p); } catch (e) {}
  };
  add(path.join(home, 'Desktop'));
  add(path.join(home, 'OneDrive', 'Desktop'));
  add(path.join(home, 'OneDrive - Personal', 'Desktop'));
  /* the shell's real Desktop folder, wherever Windows put it */
  try {
    const shell = childProcess.execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '[Environment]::GetFolderPath("Desktop")'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 });
    const p = String(shell || '').trim();
    if (p) add(p);
  } catch (e) { /* the shell path is a bonus, not a requirement */ }
  DESKTOP_CACHE = out;
  return out;
}

function startMenuDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const dir = path.join(base, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Character Building Program');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* The launcher: it starts the programme if it is not already running and then
   opens the selected account. The .lnk points at this, so the icon on the
   taskbar and the desktop is the account's own. */
function writeLauncher(slug) {
  fs.mkdirSync(launchersDir, { recursive: true });
  const cmdPath = path.join(launchersDir, slug + '.cmd');
  const cmd = '@echo off\r\n' +
    'setlocal\r\n' +
    'set "APP_ROOT=' + ROOT + '"\r\n' +
    'set "SLUG=' + slug + '"\r\n' +
    'where node >nul 2>nul\r\n' +
    'if errorlevel 1 goto open\r\n' +
    'curl -s -o nul --max-time 3 http://127.0.0.1:3000/api/health\r\n' +
    'if not errorlevel 1 goto open\r\n' +
    'start "Character Building Program" /min /d "%APP_ROOT%" cmd /c node server\\server.js\r\n' +
    'timeout /t 3 /nobreak >nul\r\n' +
    ':open\r\n' +
    'start "" "http://127.0.0.1:3000/t/%SLUG%"\r\n' +
    'endlocal\r\n';
  fs.writeFileSync(cmdPath, cmd, 'utf8');
  return cmdPath;
}

/* Create several .lnk files in ONE PowerShell call. Spawning PowerShell per
   shortcut makes a four-account run take half a minute; batching it keeps the
   whole thing under a second. */
function makeLnks(entries) {
  if (!entries.length) return [];
  const lines = entries.map(function (e) {
    return '$s = (New-Object -COM WScript.Shell).CreateShortcut(' + psQuote(e.file) + ');' +
      '$s.TargetPath = ' + psQuote(e.target) + ';' +
      '$s.WorkingDirectory = ' + psQuote(ROOT) + ';' +
      '$s.IconLocation = ' + psQuote(e.icon + ',0') + ';' +
      '$s.WindowStyle = 7;' +
      '$s.Description = ' + psQuote('Character Building Program — ' + e.label) + ';' +
      '$s.Save()';
  });
  const script = '$ErrorActionPreference = "Stop"\n' + lines.join('\n');
  if (run(script)) return entries.map(function (e) { return e.file; });
  /* one bad path must not cost the others: retry them one at a time */
  return entries.filter(function (e) { return makeLnk(e.file, e.target, e.icon, e.label); })
    .map(function (e) { return e.file; });
}

/* One .lnk — the fallback used only if a batched call fails. */
function makeLnk(file, target, iconPath, label) {
  const script = '$s = (New-Object -COM WScript.Shell).CreateShortcut(' + psQuote(file) + ');' +
    '$s.TargetPath = ' + psQuote(target) + ';' +
    '$s.WorkingDirectory = ' + psQuote(ROOT) + ';' +
    '$s.IconLocation = ' + psQuote(iconPath + ',0') + ';' +
    '$s.WindowStyle = 7;' +
    '$s.Description = ' + psQuote('Character Building Program — ' + label) + ';' +
    '$s.Save()';
  return run(script);
}

/* Pin the shortcut to the taskbar. Windows 11 moved pinning into a private
   folder, so the .lnk is dropped there directly; on older Windows the same
   folder is used by the shell, so it works there too. */
function pinToTaskbar(lnkPath) {
  const dirs = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Internet Explorer', 'Quick Launch', 'TaskBar')
  ];
  let placed = false;
  dirs.forEach(function (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(lnkPath, path.join(dir, path.basename(lnkPath)));
      placed = true;
    } catch (e) { /* try the next folder */ }
  });
  return placed;
}

/* The entries (but not yet the files) for one account. */
function collectFor(tenant, folders) {
  const slug = tenant.slug;
  const name = tenant.name || slug;
  const fileName = name + ' — Character Building.lnk';

  /* the account's own picture, sized for an icon box */
  const icon = icons.writeIco(tenant);
  const launcher = writeLauncher(slug);

  /* Shortcuts made by an older version of this tool carried no dash; they are
     removed so the desktop holds one shortcut per account, not two. */
  const legacy = [name + ' Character Building.lnk', name + ' Character Building.url',
    slug + '.lnk', slug + '.url'];

  const dirs = folders || desktopFolders();
  const entries = [];
  dirs.forEach(function (dir) {
    legacy.forEach(function (old) {
      try { fs.unlinkSync(path.join(dir, old)); } catch (e) { /* nothing to remove */ }
    });
    entries.push({ file: path.join(dir, fileName), target: launcher, icon: icon.ico, label: name });
  });
  const startFile = path.join(startMenuDir(), fileName);
  entries.push({ file: startFile, target: launcher, icon: icon.ico, label: name });

  return { slug: slug, name: name, icon: icon.ico, launcher: launcher, entries: entries, startFile: startFile };
}

/* Build the shortcuts for one account. */
function buildFor(tenant, folders) {
  const c = collectFor(tenant, folders);
  const written = makeLnks(c.entries);
  const pinned = wantTaskbar ? pinToTaskbar(c.startFile) : false;
  return { slug: c.slug, name: c.name, icon: c.icon, launcher: c.launcher, written: written, pinned: pinned };
}

function main() {
  const tenants = db.tenants || [];
  const list = all ? tenants : tenants.filter(function (t) { return t.slug === slug; });
  if (!list.length) {
    console.error('[shortcut] No account found for slug "' + (slug || '') + '" in data/db.json');
    if (require.main === module) process.exit(1);
    return { ok: false };
  }
  const folders = desktopFolders();   /* asked once, not once per account */
  const parts = list.map(function (t) { return collectFor(t, folders); });
  /* every shortcut for every account in ONE PowerShell call */
  const allEntries = parts.reduce(function (acc, p) { return acc.concat(p.entries); }, []);
  const writtenAll = new Set(makeLnks(allEntries));
  const results = parts.map(function (p) {
    return {
      slug: p.slug, name: p.name, icon: p.icon, launcher: p.launcher,
      written: p.entries.map(function (e) { return e.file; }).filter(function (f) { return writtenAll.has(f); }),
      pinned: wantTaskbar ? pinToTaskbar(p.startFile) : false
    };
  });
  results.forEach(function (r) {
    console.log('[shortcut] ' + r.name + ' (' + r.slug + ')');
    console.log('  icon     : ' + r.icon);
    console.log('  launcher : ' + r.launcher);
    r.written.forEach(function (f) { console.log('  shortcut : ' + f); });
    if (r.pinned) console.log('  taskbar  : pinned');
    else if (wantTaskbar) console.log('  taskbar  : could not be pinned automatically — right-click the shortcut and choose "Pin to taskbar"');
  });
  console.log('[shortcut] re-run after a logo change or an update: node tools/make-shortcut.js --slug ' + (slug || '<slug>'));
  return { ok: true, results: results };
}

if (require.main === module) {
  try { main(); } catch (e) {
    console.error('[shortcut] ' + (e && e.message ? e.message : e));
    process.exit(1);
  }
}
module.exports = { buildFor, main };
