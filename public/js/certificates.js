// Certificate templates and the sheet renderer.
// Shared by the super admin console (to preview and choose), the account admin
// (to open and print a certificate) and the learner app (to view and print).

// The catalogue is generated, so the number of designs is large without a large
// file: 12 LAYOUTS x 10 PALETTES = 120 templates. Each template is only a
// palette plus a layout; the renderer below paints it with CSS variables, so a
// new design never needs new markup.

// Every sheet keeps the same furniture, as asked:
// - the SCHOOL logo on the left and the PROGRAM logo on the right,
// - the overall performance in the body,
// - the date issued at the right of the footer.
// Everything else (title, subtitle, the "presented to" line, the completion
// line, signature labels, a free footer note and any number of extra lines) is
// written by the super admin.

// 12 PALETTES
const CERT_PALETTES = [
  { id: 'navy', name: 'Navy & Gold', bg: '#ffffff', ink: '#1b2a4a', accent: '#b99a48', muted: '#6b7794', soft: '#f6f1e2', border: '#b99a48' },
  { id: 'maroon', name: 'Maroon & Cream', bg: '#fffdf8', ink: '#4a1420', accent: '#9b2226', muted: '#7c5a5f', soft: '#f7ece8', border: '#9b2226' },
  { id: 'forest', name: 'Forest Green', bg: '#fdfffd', ink: '#14321f', accent: '#1f7a44', muted: '#5c7466', soft: '#e8f3ec', border: '#1f7a44' },
  { id: 'royal', name: 'Royal Blue', bg: '#ffffff', ink: '#102a54', accent: '#24508c', muted: '#5f6d85', soft: '#e8eef9', border: '#24508c' },
  { id: 'burgundy', name: 'Burgundy', bg: '#fffdfd', ink: '#3d0f1a', accent: '#7b1e3a', muted: '#77606a', soft: '#f6e9ee', border: '#7b1e3a' },
  { id: 'teal', name: 'Teal & Silver', bg: '#fcffff', ink: '#0e3a3a', accent: '#0f766e', muted: '#5b7a78', soft: '#e3f2f0', border: '#0f766e' },
  { id: 'violet', name: 'Violet', bg: '#fffeff', ink: '#2c1745', accent: '#6d3fd1', muted: '#6e6285', soft: '#eee8fb', border: '#6d3fd1' },
  { id: 'amber', name: 'Amber & Brown', bg: '#fffdf7', ink: '#3f2a12', accent: '#b45309', muted: '#7c6748', soft: '#fbf0df', border: '#b45309' },
  { id: 'slate', name: 'Slate & Steel', bg: '#ffffff', ink: '#1f2937', accent: '#475569', muted: '#64748b', soft: '#eef1f5', border: '#475569' },
  { id: 'rose', name: 'Rose & Ink', bg: '#fffdfe', ink: '#3a1226', accent: '#b8217a', muted: '#79606b', soft: '#fbe9f3', border: '#b8217a' },
];

// 12 LAYOUTS
const CERT_LAYOUTS = [
  { id: 'classic', name: 'Classic double border' },
  { id: 'modern', name: 'Modern top band' },
  { id: 'ornate', name: 'Ornate corners' },
  { id: 'minimal', name: 'Minimal rule' },
  { id: 'band', name: 'Side band' },
  { id: 'frame', name: 'Thick frame' },
  { id: 'ribbon', name: 'Ribbon header' },
  { id: 'corner', name: 'Corner flourish' },
  { id: 'double', name: 'Twin lines' },
  { id: 'sidebar', name: 'Colour sidebar' },
  { id: 'seal', name: 'Seal & rule' },
  { id: 'geometric', name: 'Geometric' },
];

// 120 templates: every palette in every layout, named so a person can find one
// ("Navy & Gold — Ornate corners").
const CERT_TEMPLATES = (function () {
  const out = [];
  CERT_PALETTES.forEach(function (p) {
    CERT_LAYOUTS.forEach(function (l) {
      out.push({
        id: 'tpl_' + p.id + '_' + l.id,
        palette: p,
        layout: l,
      });
    });
  });
  return out;
})();

// ============================================================================
// RENDERER
// Renders a certificate sheet given a template and data.
// - school logo on the left and the PROGRAM logo on the right,
// - the overall performance in the body,
// - the date issued at the right of the footer.
// ============================================================================

function esc(s) {
  if (s === null || s === undefined) return '';
  s = String(s);
  return s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
}

// Certificate sheet renderer
function certRenderSheet(t, d, opts) {
  const { palette, layout } = t;

  // School logo on the left
  const schoolLogo = opts.schoolLogo
    ? '<img class="cert-logo cert-logo-left" src="' + esc(opts.schoolLogo) + '" alt="School logo">'
    : '<span class="cert-logo cert-ph"></span>';

  // Program logo on the right
  const programLogo = opts.programLogo
    ? '<img class="cert-logo cert-logo-right" src="' + esc(opts.programLogo) + '" alt="Program logo">'
    : '<span class="cert-logo cert-ph"></span>';

  // Signature labels - with default
  const signLeft = opts.signedBy ? opts.signedBy : 'Supervisor';
  const signLeftHtml = signLeft
    ? '<div class="cert-sign"><div class="line"></div>' + esc(signLeft) + '</div>'
    : '';

  const signRight = opts.signedBy ? opts.signedBy : 'Co-Signatory';
  const signRightHtml = signRight
    ? '<div class="cert-sign"><div class="line"></div>' + esc(signRight) + '</div>'
    : '';

  const signs = (signLeftHtml || signRightHtml)
    ? '<div class="cert-signs">' + signLeftHtml + signRightHtml + '</div>'
    : '';

  // Performance display
  const performanceHtml = d.performance != null
    ? '<p>' + (d.performanceLabel ? d.performanceLabel + ': ' : '') +
      '<b>' + String(d.performance) + '%</b></p>'
    : '';

  // Date issued at the right of footer
  const issuedHtml = d.issuedAt != null
    ? '<p>Issued: ' + new Date(d.issuedAt).toLocaleDateString() + '</p>'
    : '';

  return '<div class="cert-sheet cert-tpl" data-layout="' + esc(t.layout.id) + '"' +
    ' style="--c-bg:' + palette.bg + ';--c-ink:' + palette.ink + ';--c-accent:' + palette.accent +
    ';--c-muted:' + palette.muted + ';--c-soft:' + palette.soft + ';--c-border:' + palette.border + '\">' +
    '<div class="cert-head">' +
      schoolLogo +
      '<div class="cert-head-mid">' + esc(d.tenantName || '') + '</div>' +
      programLogo + '</div>' +
    (d.title ? '<h1>' + esc(d.title) + '</h1>' : '') +
    (d.subtitle ? '<p class="cert-sub">' + esc(d.subtitle) + '</p>' : '') +
    '<p>Presented to: ' + esc(d.userName || '—') + '</p>' +
    (d.tenantName ? '<p class="cert-org">' + esc(d.tenantName) + '</p>' : '') +
    '<div class="books"></div>' +
    performanceHtml +
    signs +
    '<div class="foot">' +
      '<div class="qr-above-code" style="position:absolute;left:12px;bottom:12px;width:80px;height:80px;background:#fff;border:2px solid var(--c-accent);z-index:10">' +
        '<img src="' + (typeof generateQRCode === 'function' ? generateQRCode('code:' + d.code + '\nperformance:' + d.performance + '%\nissued:' + d.issuedAt) : '') + '" style="width:100%%; height:100%%; object-fit:contain">' +
      '</div>' +
      '<span>Code: <b class="mono">' + esc(d.code || '—') + '</b></span>' +
      '<span>Issued: ' + esc(new Date(d.issuedAt).toLocaleDateString()) + '</span>' +
    '</div>' +
    (t.layout.id === 'seal' ? '<div class="cert-seal">Certified</div>' : '') +
  '</div>';
}

// Initialize certificate system on page load
document.addEventListener('DOMContentLoaded', function () {
  // Certificate initialization code
});
// Test write