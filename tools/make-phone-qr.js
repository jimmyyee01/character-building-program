'use strict';
/* Phone (Android / iPhone) home-screen helper.

   A phone cannot be given an icon from this computer: the person taps
   "Add to Home Screen" on the phone itself. What this tool does is make that tap
   easy — it prints each account's address on the local network and draws a QR
   code for it, so the phone can open the right page without typing

       node tools/make-phone-qr.js                 (every account)
       node tools/make-phone-qr.js --slug x        (one account)
       node tools/make-phone-qr.js --port 3000     (a different port)
       node tools/make-phone-qr.js --host 10.0.0.5 (force an address)

   The QR images are written to assets/qr/ and to the Desktop. Opening one of
   those addresses on the phone and choosing "Add to Home Screen" puts the
   ACCOUNT's own logo on the home screen (the page's manifest and icon carry it).
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'qr');
const DB_FILE = path.join(ROOT, 'data', 'db.json');

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
}
const slugArg = arg('slug');
const port = arg('port') || '3000';
const forceHost = arg('host');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

/* The address this computer really uses to reach the network. Opening a UDP
   socket towards a public address makes the OS choose the interface with the
   default route — no packet is sent — which is the address a phone on the same
   Wi-Fi can reach. Virtual/hotspot adapters are left behind. */
function primaryAddress() {
  return new Promise(function (resolve) {
    let done = false;
    const sock = require('dgram').createSocket('udp4');
    const finish = function (value) {
      if (done) return;
      done = true;
      try { sock.close(); } catch (e) {}
      resolve(value);
    };
    sock.on('error', function () { finish(null); });
    try {
      sock.connect(53, '8.8.8.8', function () {
        try { finish(sock.address().address); } catch (e) { finish(null); }
      });
    } catch (e) { finish(null); }
    setTimeout(function () { finish(null); }, 2000);
  });
}

/* The address a phone on the same Wi-Fi can reach. Loopback and virtual
   adapters are skipped; a hotspot/USB address is kept but ranked last. */
function lanAddresses() {
  const found = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (net) {
      if (net.family !== 'IPv4' && net.family !== 4) return;
      if (net.internal) return;
      if (/^169\.254\./.test(net.address)) return;      /* link-local */
      found.push({ iface: name, address: net.address });
    });
  });
  const rank = function (a) {
    if (/^192\.168\./.test(a.address)) return 0;        /* ordinary home/office Wi-Fi */
    if (/^10\./.test(a.address)) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) return 2;
    return 3;                                           /* hotspot, VPN, virtual */
  };
  return found.sort(function (a, b) { return rank(a) - rank(b); });
}

function qrPng(text, size) {
  const query = [size + 'x' + size, 'margin=8', 'data=' + encodeURIComponent(text)].join('&');
  return new Promise(function (resolve, reject) {
    https.get('https://api.qrserver.com/v1/create-qr-code/?' + query, function (res) {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('QR service returned ' + res.statusCode)); }
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve(Buffer.concat(chunks)); });
    }).on('error', reject);
  });
}

async function main() {
  const db = readJson(DB_FILE, { tenants: [] });
  const tenants = (db.tenants || []).filter(function (t) { return !slugArg || t.slug === slugArg; });
  if (!tenants.length) {
    console.error('[qr] No account found' + (slugArg ? ' for slug "' + slugArg + '"' : ''));
    process.exit(1);
  }
  const nets = lanAddresses();
  const primary = await primaryAddress();
  /* prefer the address that owns the default route; the ranked list is the
     fallback when there is no network at all */
  const host = forceHost || primary || (nets.length ? nets[0].address : '127.0.0.1');
  console.log('[qr] this computer\'s addresses:');
  if (!nets.length) console.log('  (none found — is this machine on a network?)');
  nets.forEach(function (n) {
    console.log('  ' + n.address + '   (' + n.iface + ')' + (n.address === host ? '  <- using this' : ''));
  });
  console.log('[qr] using : http://' + host + ':' + port);
  if (!forceHost && nets.length > 1) {
    console.log('[qr] if the phone cannot connect, try another address above with --host');
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const desktop = path.join(os.homedir(), 'Desktop');

  for (const t of tenants) {
    const url = 'http://' + host + ':' + port + '/t/' + t.slug;
    const file = path.join(OUT_DIR, t.slug + '.png');
    try {
      const png = await qrPng(url, 420);
      fs.writeFileSync(file, png);
      console.log('[qr] ' + t.name);
      console.log('     url : ' + url);
      console.log('     code: ' + file);
      /* a second copy where the person will look for it */
      try {
        if (fs.existsSync(desktop)) {
          fs.copyFileSync(file, path.join(desktop, 'Open on phone — ' + t.name + '.png'));
        }
      } catch (e) { /* the Desktop copy is a convenience */ }
    } catch (e) {
      console.log('[qr] ' + t.name + ' — could not draw the code (' + (e && e.message ? e.message : e) + ')');
      console.log('     open this address on the phone instead: ' + url);
    }
  }
  console.log('[qr] on the phone: scan the code, open the page, then use the browser menu');
  console.log('     "Add to Home Screen" — the account logo becomes the icon.');
  console.log('[qr] if the phone cannot reach this computer, allow TCP port ' + port + ' through');
  console.log('     Windows Defender Firewall (an administrator must add the rule).');
}

main().catch(function (e) {
  console.error('[qr] ' + (e && e.message ? e.message : e));
  process.exit(1);
});
