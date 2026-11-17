'use strict';
/* ============================================================================
   Certificate templates and the sheet renderer.
   Shared by the super admin console (to preview and choose), the account admin
   (to open and print a certificate) and the learner app (to view and print).

   The catalogue is generated, so the number of designs is large without a large
   file: 12 LAYOUTS x 10 PALETTES = 120 templates. Each template is only a
   palette plus a layout; the renderer below paints it with CSS variables, so a
   new design never needs new markup.

   Every sheet keeps the same furniture, as asked:
     - the SCHOOL logo on the left and the PROGRAM logo on the right,
     - the overall performance in the body,
     - the date issued at the right of the footer.
   Everything else (title, subtitle, the "presented to" line, the completion
   line, signature labels, a free footer note and any number of extra lines) is
   written by the super admin.
   ============================================================================ */

const CERT_PALETTES = [
  { id: 'navy',     name: 'Navy & Gold',      bg: '#ffffff', ink: '#1b2a4a', accent: '#b99a48', muted: '#6b7794', soft: '#f6f1e2', border: '#b99a48' },
  { id: 'maroon',   name: 'Maroon & Cream',   bg: '#fffdf8', ink: '#4a1420', accent: '#9b2226', muted: '#7c5a5f', soft: '#f7ece8', border: '#9b2226' },
  { id: 'forest',   name: 'Forest Green',     bg: '#fdfffd', ink: '#14321f', accent: '#1f7a44', muted: '#5c7466', soft: '#e8f3ec', border: '#1f7a44' },
  { id: 'royal',    name: 'Royal Blue',       bg: '#ffffff', ink: '#102a54', accent: '#24508c', muted: '#5f6d85', soft: '#e8eef9', border: '#24508c' },
  { id: 'burgundy', name: 'Burgundy',         bg: '#fffdfd', ink: '#3d0f1a', accent: '#7b1e3a', muted: '#77606a', soft: '#f6e9ee', border: '#7b1e3a' },
  { id: 'teal',     name: 'Teal & Silver',    bg: '#fcffff', ink: '#0e3a3a', accent: '#0f766e', muted: '#5b7a78', soft: '#e3f2f0', border: '#0f766e' },
  { id: 'violet',   name: 'Violet',           bg: '#fffeff', ink: '#2c1745', accent: '#6d3fd1', muted: '#6e6285', soft: '#eee8fb', border: '#6d3fd1' },
  { id: 'amber',    name: 'Amber & Brown',    bg: '#fffdf7', ink: '#3f2a12', accent: '#b45309', muted: '#7c6748', soft: '#fbf0df', border: '#b45309' },
  { id: 'slate',    name: 'Slate & Steel',    bg: '#ffffff', ink: '#1f2937', accent: '#475569', muted: '#64748b', soft: '#eef1f5', border: '#475569' },
  { id: 'rose',     name: 'Rose & Ink',       bg: '#fffdfe', ink: '#3a1226', accent: '#b8217a', muted: '#79606b', soft: '#fbe9f3', border: '#b8217a' }
];

/* The twelve layouts differ only in how the sheet is framed and decorated. */
const CERT_LAYOUTS = [
  { id: 'classic',   name: 'Classic double border' },
  { id: 'modern',    name: 'Modern top band' },
  { id: 'ornate',    name: 'Ornate corners' },
  { id: 'minimal',   name: 'Minimal rule' },
  { id: 'band',      name: 'Side band' },
  { id: 'frame',     name: 'Thick frame' },
  { id: 'ribbon',    name: 'Ribbon header' },
  { id: 'corner',    name: 'Corner flourish' },
  { id: 'double',    name: 'Twin lines' },
  { id: 'sidebar',   name: 'Colour sidebar' },
  { id: 'seal',      name: 'Seal & rule' },
  { id: 'geometric', name: 'Geometric' }
];

/* 120 templates: every palette in every layout, named so a person can find one
   ("Navy & Gold — Ornate corners"). */
const CERT_TEMPLATES = (function () {
  const out = [];
  CERT_PALETTES.forEach(function (p) {
    CERT_LAYOUTS.forEach(function (l) {
      out.push({
        id: 'tpl_' + p.id + '_' + l.id,
        palette: p,
        layout: l,
        name: p.name + ' — ' + l.name
      });
    });
  });
  return out;
})();
const CERT_DEFAULT_TEMPLATE = 'tpl_navy_classic';

function certTemplateById(id) {
  const found = CERT_TEMPLATES.filter(function (t) { return t.id === id; })[0];
  return found || CERT_TEMPLATES.filter(function (t) { return t.id === CERT_DEFAULT_TEMPLATE; })[0];
}

/* What the super admin may write on the sheet. Anything left blank simply does
   not appear, so a school can keep a design as bare or as full as it likes. */
const CERT_DEFAULT_TEXTS = {
  title: 'Certificate of Completion',
  subtitle: '',
  presentedTo: 'This certificate is proudly presented to',
  completion: 'for the successful completion of',
  performanceLabel: 'Overall performance',
  qrCodeData: ''
  signLeftLabel: 'Supervisor',
  signRightLabel: 'Program Director',
  footerNote: ''
};

/* Every rule the sheet needs, kept as a string so the same styling can be
   written into a print window as well as the page. */
const CERT_TEMPLATE_CSS = [
  '.cert-sheet.cert-tpl{position:relative;background:var(--c-bg,#fff);color:var(--c-ink,#1b2a4a);',
  'border:10px double var(--c-border,#b99a48);border-radius:4px;padding:32px 40px 26px;text-align:center;',
  'min-height:480px;overflow:hidden}',
  '.cert-tpl .cert-head{display:flex;align-items:center;gap:14px}',
  '.cert-tpl .cert-logo{height:64px;max-width:150px;object-fit:contain}',
  '.cert-tpl .cert-logo-left{margin-right:auto}',
  '.cert-tpl .cert-logo-right{margin-left:auto}',
  '.cert-tpl .cert-head-mid{flex:1;min-width:0;font-size:10.5px;letter-spacing:.16em;',
  'text-transform:uppercase;color:var(--c-accent,#b99a48);line-height:1.5}',
  '.cert-tpl .cert-ph{width:64px;height:64px;flex:0 0 auto}',
  '.cert-tpl h1{font-size:30px;color:var(--c-ink,#1b2a4a);letter-spacing:.04em;margin:16px 0 4px}',
  '.cert-tpl .cert-sub{margin:0 0 6px;color:var(--c-muted,#6b7794);font-size:14px}',
  '.cert-tpl p{margin:8px 0}',
  '.cert-tpl .name{font:800 27px Georgia,"Times New Roman",serif;color:var(--c-accent,#b99a48);margin:14px 0 4px}',
  '.cert-tpl .cert-org{color:var(--c-muted,#6b7794);font-size:13px;margin-top:0}',
  '.cert-tpl .books{text-align:left;display:inline-block;margin:8px auto;max-width:80%}',
  '.cert-tpl .books ul{margin:4px 0 0 18px;padding:0}',
  '.cert-tpl .cert-extra{margin:10px auto;max-width:92%;font-size:14px}',
  '.cert-tpl .cert-signs{display:flex;justify-content:space-around;gap:24px;margin:26px 0 6px}',
  '.cert-tpl .cert-sign{flex:1;max-width:230px;font-size:12px;color:var(--c-muted,#6b7794)}',
  '.cert-tpl .cert-sign .line{border-top:1px solid var(--c-accent,#b99a48);margin-bottom:4px}',
  '.cert-tpl .foot{display:flex;justify-content:space-between;gap:12px;margin-top:22px;',
  'color:var(--c-muted,#6b7794);font-size:12.5px}',
  /* ---- layouts ---- */
  '.cert-tpl[data-layout="classic"]{}',
  '.cert-tpl[data-layout="modern"]{border:0;border-top:16px solid var(--c-accent);border-radius:0}',
  '.cert-tpl[data-layout="modern"] h1{text-transform:uppercase;letter-spacing:.12em;font-size:26px}',
  '.cert-tpl[data-layout="ornate"]{border:6px solid var(--c-accent)}',
  '.cert-tpl[data-layout="ornate"]:before,.cert-tpl[data-layout="ornate"]:after{content:"";',
  'position:absolute;width:70px;height:70px;border:3px solid var(--c-accent);border-right:0;border-bottom:0}',
  '.cert-tpl[data-layout="ornate"]:before{left:8px;top:8px}',
  '.cert-tpl[data-layout="ornate"]:after{right:8px;bottom:8px;transform:rotate(180deg)}',
  '.cert-tpl[data-layout="minimal"]{border:1px solid #ddd;border-top:4px solid var(--c-accent)}',
  '.cert-tpl[data-layout="band"]{border:0;border-left:22px solid var(--c-accent);text-align:left}',
  '.cert-tpl[data-layout="band"] .cert-head,.cert-tpl[data-layout="band"] .foot{text-align:left}',
  '.cert-tpl[data-layout="frame"]{border:26px solid var(--c-soft);outline:2px solid var(--c-accent)}',
  '.cert-tpl[data-layout="ribbon"]{border:0;border-bottom:10px solid var(--c-accent)}',
  '.cert-tpl[data-layout="ribbon"] h1{background:var(--c-accent);color:#fff;display:inline-block;',
  'padding:8px 26px;border-radius:0 0 14px 14px;margin-top:-40px}',
  '.cert-tpl[data-layout="corner"]{border:4px solid var(--c-soft);border-radius:18px 0 18px 0}',
  '.cert-tpl[data-layout="corner"]:after{content:"";position:absolute;right:-30px;top:-30px;',
  'width:120px;height:120px;background:var(--c-soft);border-radius:50%}',
  '.cert-tpl[data-layout="double"]{border:0;box-shadow:inset 0 0 0 3px var(--c-accent),inset 0 0 0 9px #fff,',
  'inset 0 0 0 11px var(--c-soft)}',
  '.cert-tpl[data-layout="sidebar"]{border:0;border-right:26px solid var(--c-soft);border-left:26px solid var(--c-soft)}',
  '.cert-tpl[data-layout="seal"]{border:1px solid var(--c-soft)}',
  '.cert-tpl[data-layout="seal"] .cert-seal{position:absolute;right:18px;bottom:16px;width:74px;height:74px;',
  'border-radius:50%;border:3px solid var(--c-accent);color:var(--c-accent);display:flex;align-items:center;',
  'justify-content:center;font-size:10px;letter-spacing:.1em;text-transform:uppercase;opacity:.75}',
  '.cert-tpl[data-layout="geometric"]{border:0;background:linear-gradient(135deg,var(--c-soft) 0 18%,',
  'transparent 18% 100%)}',
  '.cert-tpl[data-layout="geometric"] h1{border-bottom:3px solid var(--c-accent);padding-bottom:8px}'
].join('');

/* Put the sheet styling on a page once (the console and the learner app both
   call this; a print window can write the same string itself). */
function certEnsureStyles(doc) {
  doc = doc || document;
  if (!doc || doc.getElementById('certTplStyles')) return;
  const style = doc.createElement('style');
  style.id = 'certTplStyles';
  style.textContent = CERT_TEMPLATE_CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

/* Missing settings keep their defaults. Once the super admin saves a field,
   its value is explicit: an empty field removes that wording from the sheet. */
function certTexts(texts) {
  const out = {};
  Object.keys(CERT_DEFAULT_TEXTS).forEach(function (k) {
    const supplied = texts && Object.prototype.hasOwnProperty.call(texts, k);
    out[k] = supplied ? String(texts[k] == null ? '' : texts[k]).trim() : CERT_DEFAULT_TEXTS[k];
  });
  return out;
}

/* ---------------------------------------------------------------------------
   The sheet itself.
     opts.templateId   which of the 120 designs
     opts.texts        the super admin's words
     opts.extraBlocks  [{ id, text }] free lines, in order
     opts.data         the certificate (title, userName, books, performance,
                       objectiveScore, code, issuedAt, tenantName)
     opts.schoolLogo   LEFT   (the account's own logo)
     opts.programLogo  RIGHT  (the programme logo)
   The overall performance stays in the body and the date issued stays at the
   right of the footer, wherever the rest of the design moves.
--------------------------------------------------------------------------- */
function certificateSheetHtml(opts) {
  opts = opts || {};
  const t = certTemplateById(opts.templateId);
  const p = t.palette;
  const x = certTexts(opts.texts);
  const d = opts.data || {};
  const esc = (typeof window !== 'undefined' && window.esc) ? window.esc : function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  };
  const fmtDate = (typeof window !== 'undefined' && typeof window.fmtDate === 'function')
    ? window.fmtDate
    : function (v) { return v ? String(v).slice(0, 10) : '—'; };

  const logoLeft = opts.schoolLogo
    ? '<img class="cert-logo cert-logo-left" src="' + esc(opts.schoolLogo) + '" alt="School logo">'
    : '<span class="cert-logo cert-ph"></span>';
  const logoRight = opts.programLogo
    ? '<img class="cert-logo cert-logo-right" src="' + esc(opts.programLogo) + '" alt="Program logo">'
    : '<span class="cert-logo cert-ph"></span>';

  const books = Array.isArray(d.books) && d.books.length ? d.books
    : (d.bestBook ? [d.bestBook] : []);
  const booksHtml = books.length
    ? (x.completion ? '<p>' + esc(x.completion) + '</p>' : '') +
      '<div class="books"><ul>' +
      books.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul></div>'
    : '';
  const bestBookHtml = d.bestBook && !books.length
    ? '<p class="cert-org">Best book: ' + esc(d.bestBook) + '</p>' : '';
  const extra = (opts.extraBlocks || []).filter(function (b) { return b && String(b.text || '').trim(); })
    .map(function (b) { return '<div class="cert-extra">' + esc(b.text) + '</div>'; }).join('');
  const signLeft = x.signLeftLabel
    ? '<div class="cert-sign"><div class="line"></div>' + esc(x.signLeftLabel) + '</div>' : '';
  const signRight = x.signRightLabel
    ? '<div class="cert-sign"><div class="line"></div>' + esc(x.signRightLabel) + '</div>' : '';
  const signs = (signLeft || signRight)
    ? '<div class="cert-signs">' + signLeft + signRight + '</div>' : '';
  /* Existing certificates keep their own title until the admin explicitly saves
     a heading. After that, the custom heading wins; an empty heading is hidden. */
  const hasCustomTitle = opts.texts && Object.prototype.hasOwnProperty.call(opts.texts, 'title');
  const title = hasCustomTitle ? x.title : (d.title || x.title);

  return '<div class="cert-sheet cert-tpl" data-layout="' + esc(t.layout.id) + '"' +
    ' style="--c-bg:' + esc(p.bg) + ';--c-ink:' + esc(p.ink) + ';--c-accent:' + esc(p.accent) +
    ';--c-muted:' + esc(p.muted) + ';--c-soft:' + esc(p.soft) + ';--c-border:' + esc(p.border) + '">' +
    '<div class="cert-head">' + logoLeft +
      '<div class="cert-head-mid">' + esc(d.tenantName || '') + '</div>' +
      logoRight + '</div>' +
    (title ? '<h1>' + esc(title) + '</h1>' : '') +
    (x.subtitle ? '<p class="cert-sub">' + esc(x.subtitle) + '</p>' : '') +
    (x.presentedTo ? '<p>' + esc(x.presentedTo) + '</p>' : '') +
    '<div class="name">' + esc(d.userName || '—') + '</div>' +
    (d.tenantName ? '<p class="cert-org">' + esc(d.tenantName) + '</p>' : '') +
    booksHtml + bestBookHtml +
    (d.performance != null
      ? '<p>' + (x.performanceLabel ? esc(x.performanceLabel) + ': ' : '') +
        '<b>' + esc(String(d.performance)) + '%</b></p>' : '') +
    (d.objectiveScore != null
      ? '<p class="small muted">Objective score: ' + esc(String(d.objectiveScore)) + '%</p>' : '') +
    extra + signs +
    (x.footerNote ? '<p class="cert-extra">' + esc(x.footerNote) + '</p>' : '') +
    '<div class="foot">' +
      '<span>Code: <b class="mono">' + esc(d.code || '—') + '</b></span>' +
      '<span>Issued: ' + esc(fmtDate(d.issuedAt)) + '</span>' +
    '</div>' +
    (t.layout.id === 'seal' ? '<div class="cert-seal">Certified</div>' : '') +
  '</div>';
}
