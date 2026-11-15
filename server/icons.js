'use strict';
/* Icon engine for the Character Building Program.
   One account logo has to serve four places at once:
     1. the Windows desktop shortcut (.lnk + .ico),
     2. the Windows taskbar button,
     3. the browser tab / PWA title (favicon + manifest),
     4. the Android home-screen icon (manifest).
   All four read the SAME picture — the account's own logo — so a school never
   sees the programme's generic mark on its own machine.
   Nothing here needs a native dependency: a logo that was uploaded through the
   browser is already a PNG data URL (the browser normalises it), and a PNG can
   be embedded in an .ico as-is. A logo that arrives some other way (a JPEG, an
   SVG) is converted with the Windows image tools when they are available and
   falls back to the account's colour tile otherwise, so the shortcut always
   has a valid icon. */

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ICON_DIR = path.join(ROOT, 'assets', 'icons');

/* ======================================================= PNG writer ========= */
/* A minimal PNG encoder — enough to paint a solid tile for the fallback icon.
   It is only used when no real logo can be decoded. */
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}
function crc32(buf) {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function solidPng(size, hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) {
    row[1 + x * 4] = r; row[2 + x * 4] = g; row[3 + x * 4] = b; row[4 + x * 4] = 255;
  }
  const raw = Buffer.concat(Array.from({ length: size }, function () { return row; }));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}
/* The real width/height of a PNG, read from its IHDR chunk. */
function pngSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] !== 137 || buf[1] !== 80 || buf[2] !== 78 || buf[3] !== 71) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/* ======================================================= ICO writer ========= */
/* A Windows .ico may embed a PNG directly (Vista and later). One 256 px entry
   is enough: Windows scales it for every size it needs. */
function icoFromPng(png) {
  const dims = pngSize(png) || { width: 256, height: 256 };
  const side = Math.max(1, Math.min(256, dims.width, dims.height));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = side >= 256 ? 0 : side;   /* 0 means 256 */
  entry[1] = side >= 256 ? 0 : side;
  entry[2] = 0; entry[3] = 0;          /* 0 = no palette */
  entry.writeUInt16LE(1, 4);           /* colour planes */
  entry.writeUInt16LE(32, 6);          /* bits per pixel */
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);         /* offset of the image data */
  return Buffer.concat([header, entry, png]);
}

/* ================================================= logo → PNG ============ */
/* The logo is stored as a data URL. A PNG data URL is used as it is; anything
   else (JPEG, WebP, SVG) is converted with the Windows image tools when they
   are available. A logo that cannot be decoded falls back to the account's
   colour tile, so an icon is always produced. */
function dataUrlBuffer(value) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/i.exec(String(value || ''));
  if (!m) return null;
  try {
    return m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  } catch (e) { return null; }
}
function dataUrlType(value) {
  const m = /^data:([^;,]*)/i.exec(String(value || ''));
  return m ? m[1].toLowerCase() : '';
}

/* Run a small PowerShell script with named parameters. The script is written to
   a temporary .ps1 file and invoked with -File, which is the only reliable way
   to pass arguments (with -Command the extra tokens are not bound to $args). */
function runPs(scriptBody, params) {
  if (process.platform !== 'win32') return false;
  const ps1 = path.join(os.tmpdir(), 'cbp_' + crypto.randomBytes(6).toString('hex') + '.ps1');
  const names = Object.keys(params || {});
  const header = 'param(' + names.map(function (n) { return '$' + n; }).join(', ') + ')\n' +
    '$ErrorActionPreference = "Stop"\n' +
    'Add-Type -AssemblyName System.Drawing\n';
  try {
    fs.writeFileSync(ps1, header + scriptBody, 'utf8');
    const cmdArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1];
    names.forEach(function (n) { cmdArgs.push(String(params[n])); });
    execFileSync('powershell.exe', cmdArgs, { stdio: 'ignore', timeout: 30000 });
    return true;
  } catch (e) {
    return false;
  } finally {
    try { if (fs.existsSync(ps1)) fs.unlinkSync(ps1); } catch (e) { /* temp file */ }
  }
}

/* A PNG that fits the icon box: the picture centred on a square canvas, so a
   wide logo is not squashed and the icon keeps the account's proportions. */
function squarePng(png, size, bg) {
  const dims = pngSize(png);
  if (!dims || !dims.width || !dims.height) return null;
  if (dims.width === size && dims.height === size) return png;
  if (process.platform !== 'win32') return png;  /* Windows scales it itself */
  const src = path.join(os.tmpdir(), 'cbp_src_' + crypto.randomBytes(6).toString('hex') + '.png');
  const dst = path.join(os.tmpdir(), 'cbp_dst_' + crypto.randomBytes(6).toString('hex') + '.png');
  try {
    fs.writeFileSync(src, png);
    const body = [
      '$img = [System.Drawing.Image]::FromFile($Src)',
      '$bmp = New-Object System.Drawing.Bitmap([int]$Size, [int]$Size)',
      '$g = [System.Drawing.Graphics]::FromImage($bmp)',
      '$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
      '$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality',
      '$g.Clear([System.Drawing.ColorTranslator]::FromHtml($Bg))',
      '$scale = [Math]::Min([double]$Size / $img.Width, [double]$Size / $img.Height)',
      '$w = [int]($img.Width * $scale)',
      '$h = [int]($img.Height * $scale)',
      '$g.DrawImage($img, [int](([double]$Size - $w) / 2), [int](([double]$Size - $h) / 2), $w, $h)',
      '$g.Dispose()',
      '$img.Dispose()',
      '$bmp.Save($Dst, [System.Drawing.Imaging.ImageFormat]::Png)',
      '$bmp.Dispose()'
    ].join('\n');
    if (!runPs(body, { Src: src, Dst: dst, Size: size, Bg: bg })) return png;
    const out = fs.readFileSync(dst);
    fs.unlinkSync(src); fs.unlinkSync(dst);
    return out;
  } catch (e) {
    try { if (fs.existsSync(src)) fs.unlinkSync(src); } catch (e2) {}
    try { if (fs.existsSync(dst)) fs.unlinkSync(dst); } catch (e2) {}
    return png;
  }
}
/* Convert an image file to PNG with Windows' own imaging tools. This is the
   escape hatch for a logo that is not a PNG (a JPEG or a WebP). */
function convertToPng(filePath) {
  if (process.platform !== 'win32') return null;
  const out = filePath + '.conv.png';
  const body = [
    '$img = [System.Drawing.Image]::FromFile($Src)',
    '$bmp = New-Object System.Drawing.Bitmap($img.Width, $img.Height)',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.Clear([System.Drawing.Color]::White)',
    '$g.DrawImage($img, 0, 0, $img.Width, $img.Height)',
    '$g.Dispose()',
    '$img.Dispose()',
    '$bmp.Save($Dst, [System.Drawing.Imaging.ImageFormat]::Png)',
    '$bmp.Dispose()'
  ].join('\n');
  if (!runPs(body, { Src: filePath, Dst: out })) {
    try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch (e) {}
    return null;
  }
  try {
    const png = fs.readFileSync(out);
    fs.unlinkSync(out);
    return png;
  } catch (e) {
    try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch (e2) {}
    return null;
  }
}

/* The PNG that represents an account everywhere: its own logo, centred on the
   account colour. */
function logoPng(tenant, size) {
  size = size || 256;
  const colour = /^#[0-9a-f]{6}$/i.test((tenant && tenant.themeColor) || '')
    ? tenant.themeColor : '#24508c';
  const logo = tenant && tenant.logo;
  if (logo) {
    const type = dataUrlType(logo);
    const buf = dataUrlBuffer(logo);
    if (buf && buf.length) {
      if (type.indexOf('png') !== -1) {
        const sq = squarePng(buf, size, colour);
        if (sq) return sq;
      } else {
        const tmp = path.join(os.tmpdir(), 'cbp_logo_' + crypto.randomBytes(6).toString('hex') +
          (type.indexOf('svg') !== -1 ? '.svg' : '.img'));
        try {
          fs.writeFileSync(tmp, buf);
          const png = convertToPng(tmp);
          if (png) {
            const sq = squarePng(png, size, colour);
            if (sq) return sq;
          }
        } catch (e) { /* fall through to the colour tile */ }
        finally { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e2) {} }
      }
    }
  }
  return solidPng(size, colour);
}

/* The .ico file for an account. Written to assets/icons/<slug>.ico and reused
   by every shortcut, so the desktop, the taskbar and the Start Menu always
   show the very same picture. */
function writeIco(tenant) {
  const slug = (tenant && tenant.slug) || 'program';
  fs.mkdirSync(ICON_DIR, { recursive: true });
  const icoPath = path.join(ICON_DIR, slug + '.ico');
  const pngPath = path.join(ICON_DIR, slug + '.png');
  const png = logoPng(tenant, 256);
  fs.writeFileSync(pngPath, png);
  fs.writeFileSync(icoPath, icoFromPng(png));
  return { ico: icoPath, png: pngPath };
}

/* A short hash of the picture, so a changed logo produces a changed URL and
   the browser and Windows both pick the new one up straight away. */
function logoFingerprint(tenant) {
  const logo = (tenant && tenant.logo) || '';
  return crypto.createHash('sha1').update(String(logo)).digest('hex').slice(0, 12);
}

module.exports = { logoPng, writeIco, icoFromPng, solidPng, logoFingerprint, ICON_DIR, ROOT };
