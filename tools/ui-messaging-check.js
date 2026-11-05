/* Sent messages and attachment download popup checks for the shared widget. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const pub = path.join(__dirname, '..', 'public') + path.sep;
const nodes = {};
const listeners = {};

function el(tag) {
  const e = {
    tagName: (tag || 'div').toUpperCase(), id: '', className: '', innerHTML: '', textContent: '',
    dataset: {}, style: { setProperty() {}, removeProperty() {} }, removed: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, addEventListener() {}, focus() { e.focused = true; },
    appendChild(c) { nodes[c.id] = c; },
    remove() { e.removed = true; if (e.id) delete nodes[e.id]; },
    querySelector(selector) { return selector === '[data-message-modal-close]' ? el('button') : null; },
    querySelectorAll() { return []; }, closest() { return null; }
  };
  return e;
}
const doc = {
  activeElement: el('button'),
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  removeEventListener() {}, createElement: el,
  getElementById(id) { return nodes[id] || null; },
  querySelector() { return null; }, querySelectorAll() { return []; },
  body: el('body'), documentElement: el('html'), head: el('head'), readyState: 'complete', title: ''
};
const ctx = vm.createContext({
  document: doc, console, navigator: { userAgent: 'node' },
  window: { location: { href: 'http://x/', pathname: '/', search: '', hash: '' },
    addEventListener() {}, print() {}, document: doc },
  location: { href: 'http://x/', pathname: '/', search: '', hash: '' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  FileReader: function () { this.readAsDataURL = function () {}; },
  fetch: () => Promise.resolve({ ok: false }), setTimeout, clearTimeout,
  alert() {}, confirm: () => false, prompt: () => ''
});
ctx.self = ctx;
vm.runInContext(fs.readFileSync(pub + 'js/common.js', 'utf8'), ctx, { filename: 'common.js' });
const F = (expr, args) => vm.runInContext(expr, ctx).apply(null, args || []);
let bad = 0;
function check(name, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + name);
  if (!condition) bad++;
}

const preview = F('messagePreview', [{ body: '', attachments: [{ name: 'guide.pdf' }] }]);
check('attachment-only conversation has a useful preview', preview === '1 attachment: guide.pdf');
const multiple = F('messagePreview', [{ body: 'Read these', attachments: [{ name: 'a.pdf' }, { name: 'b.pdf' }] }]);
check('preview includes message text and attachment count', multiple === 'Read these · 2 attachments: a.pdf');
const attachment = F('messageAttachmentHtml', [{ url: '/uploads/guide.pdf', name: 'guide.pdf', kind: 'file', size: 12 }]);
check('attachment is a popup trigger with its metadata',
  attachment.includes('data-comms-attachment="/uploads/guide.pdf"') &&
    attachment.includes('data-attachment-name="guide.pdf"') && attachment.includes('<button'));

F('openMessageAttachment', [{ url: '/uploads/guide.pdf', name: 'guide.pdf', kind: 'file', size: 12 }]);
const modal = nodes.cbpMessageAttachmentModal;
check('attachment opens an accessible download popup', !!modal &&
  modal.innerHTML.includes('download="guide.pdf"') && modal.innerHTML.includes('Open in new tab') &&
  modal.innerHTML.includes('id="cbpMessageAttachmentTitle"'));
F('closeMessageAttachment');
check('closing removes the popup and restores focus', !!modal && modal.removed && doc.activeElement.focused);

F('openMessageAttachment', [{ url: '/uploads/photo.png', name: 'photo.png', kind: 'image' }]);
check('image attachment includes a popup preview',
  nodes.cbpMessageAttachmentModal.innerHTML.includes('<img src="/uploads/photo.png"'));
F('closeMessageAttachment');

const common = fs.readFileSync(pub + 'js/common.js', 'utf8');
check('widget has Sent navigation and renders API sentMessages',
  common.includes('data-comms-screen="sent"') && common.includes('function renderSentMessages()') &&
    common.includes('state.sentMessages = messages.sentMessages || []'));
check('recipient widget opens directly on Inbox and messages load independently of alerts',
  common.includes("const state = { screen: 'inbox'") &&
    common.includes("state.screen = 'inbox'; state.activeId = null; draw();") &&
    common.includes("const messages = await API.get('/messages')") &&
    !common.includes("state.screen = 'alerts'; state.activeId = null"));
check('successful compose opens Sent and sent attachments use the popup',
  common.includes("state.screen = 'sent'; state.activeId = null") &&
    common.includes('(m.attachments || []).map(messageAttachmentHtml)') &&
    common.includes('if (target.dataset.commsAttachment)'));
console.log(bad ? bad + ' FAILED' : 'MESSAGING UI OK');
process.exit(bad ? 1 : 0);
