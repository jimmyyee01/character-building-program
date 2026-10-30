
/* Shared client helpers: API wrapper, auth state, formatting, uploads. */
const API = {
  token() { return localStorage.getItem('cbp_token'); },
  setToken(t) { t ? localStorage.setItem('cbp_token', t) : localStorage.removeItem('cbp_token'); },
  user() { try { return JSON.parse(localStorage.getItem('cbp_user') || 'null'); } catch (e) { return null; } },
  setUser(u) { u ? localStorage.setItem('cbp_user', JSON.stringify(u)) : localStorage.removeItem('cbp_user'); },

  async call(path, opts) {
    opts = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    const t = API.token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    const init = { method: opts.method || 'GET', headers, credentials: 'same-origin' };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    const res = await fetch('/api' + path, init);
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (res.status === 401 && path.indexOf('/auth/') !== 0 && path !== '/public/portals') {
      API.setToken(null); API.setUser(null);
      if (!/^\/(super|t\/)/.test(location.pathname) && location.pathname !== '/') {
        location.href = '/';
      }
    }
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || ('Request failed (' + res.status + ')'));
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get(p) { return API.call(p); },
  post(p, body) { return API.call(p, { method: 'POST', body: body || {} }); },
  put(p, body) { return API.call(p, { method: 'PUT', body: body || {} }); },
  del(p) { return API.call(p, { method: 'DELETE' }); },
  /* Upload with a real progress percentage. fetch() cannot report upload
     progress, so this uses XMLHttpRequest; onProgress gets 0–100 and the promise
     resolves only once the server confirms the whole file is stored — nothing is
     "uploaded" before that. `method` defaults to POST so callers can PUT too. */
  upload(p, body, onProgress, method) {
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open(method || 'POST', '/api' + p);
      xhr.setRequestHeader('Content-Type', 'application/json');
      const t = API.token();
      if (t) xhr.setRequestHeader('Authorization', 'Bearer ' + t);
      if (xhr.upload && typeof onProgress === 'function') {
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }
      xhr.onload = function () {
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) resolve(data);
        else reject(new Error(data.error || ('Upload failed (' + xhr.status + ')')));
      };
      xhr.onerror = function () { reject(new Error('Network error during upload')); };
      xhr.send(JSON.stringify(body));
    });
  },
  async logout() {
    try { await API.post('/auth/logout'); } catch (e) {}
    API.setToken(null); API.setUser(null);
    location.href = '/';
  }
};

/* Drive the shared upload-progress bar while a file saves, so the admin sees a
   live percentage instead of a frozen form. Returns the API.upload promise;
   `barId` is the id of the .upload-progress container. */
function uploadWithProgress(path, body, barId, method) {
  const bar = document.getElementById(barId);
  const span = bar ? bar.querySelector('.upload-progress-bar span') : null;
  const lbl = bar ? bar.querySelector('.upload-progress-label') : null;
  if (bar) bar.classList.remove('hidden');
  return API.upload(path, body, function (pct) {
    if (span) span.style.width = pct + '%';
    if (lbl) lbl.textContent = pct + '%';
  }, method).then(function (res) {
    if (bar) bar.classList.add('hidden');
    return res;
  }, function (err) {
    if (bar) bar.classList.add('hidden');
    throw err;
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
let _toastTimer = null;
function toast(msg, kind) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = kind || '';
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 4200);
}
function fileToDataUrl(file) {
  return new Promise(function (resolve, reject) {
    const r = new FileReader();
    r.onload = function () { resolve(r.result); };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
/* Profile photos are cropped square and shrunk before upload, so lists, the
   login-page portraits and the public ranking stay small and fast. */
function fileToAvatarDataUrl(file, size) {
  size = size || 256;
  return new Promise(function (resolve, reject) {
    if (!file || !/^image\//i.test(file.type || '')) {
      reject(new Error('Choose an image file'));
      return;
    }
    const r = new FileReader();
    r.onload = function () {
      const img = new Image();
      img.onload = function () {
        try {
          const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
          if (!side) throw new Error('Could not read that image');
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2,
            side, side, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error('Could not read that image')); };
      img.src = r.result;
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    const r = new FileReader();
    r.onload = function () { resolve(String(r.result).split(',')[1]); };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
/* ================================================ library media helpers ==== */
/* Every video/audio container the server will serve with a proper MIME type.
   A browser still decides what it can decode — anything else is offered as a
   download instead of a broken player. */
const MEDIA_TYPES = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  ogv: 'video/ogg', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv', mpeg: 'video/mpeg', mpg: 'video/mpeg',
  m2ts: 'video/mp2t', ts: 'video/mp2t', vob: 'video/mpeg', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
  flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus',
  weba: 'audio/webm', amr: 'audio/amr', mid: 'audio/midi',
  aif: 'audio/aiff', aiff: 'audio/aiff', wma: 'audio/x-ms-wma',
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml'
};
/* accept= string so the file dialog opens straight onto the media formats. */
const LIB_ACCEPT = (function () {
  const exts = Object.keys(MEDIA_TYPES);
  return exts.map(function (e) { return '.' + e; }).join(',') + ',video/*,audio/*,application/pdf,image/*';
})();
function fileExt(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}
/* 'video' | 'audio' | 'pdf' | 'image' | 'file' — how a link/upload should open. */
function mediaKindByUrl(url) {
  const ext = fileExt(String(url || '').split(/[?#]/)[0]);
  const mime = MEDIA_TYPES[ext] || '';
  if (mime.indexOf('video/') === 0) return 'video';
  if (mime.indexOf('audio/') === 0) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.indexOf('image/') === 0) return 'image';
  return 'file';
}
function fmtBytes(n) {
  const size = Number(n);
  if (!isFinite(size) || size <= 0) return null;
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
  return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}
/* The upload cap the JSON/base64 transport allows (see filePayload). */
const LIB_MAX_UPLOAD = 40 * 1024 * 1024;
/* Prevents paste/cut/drop into "own words" boxes (server also enforces length). */
function blockPaste(el) {
  ['paste', 'cut', 'drop', 'copy'].forEach(function (evt) {
    el.addEventListener(evt, function (e) { e.preventDefault(); toast('Please type your own words.', 'err'); });
  });
}
/* A chosen file, playable right there in the form: player + name + size.
   Falls back to a plain panel when the browser cannot decode that container. */
function libFilePreviewHtml(file) {
  if (!file) return '';
  const kind = mediaKindByUrl(file.name);
  const size = fmtBytes(file.size);
  const type = MEDIA_TYPES[fileExt(file.name)] || '';
  let body;
  if ((kind === 'video' || kind === 'audio') && typeof URL !== 'undefined' && URL.createObjectURL) {
    body = '<' + (kind === 'video' ? 'video class="lib-preview-media" controls playsinline'
                                   : 'audio class="lib-preview-media" controls') +
      ' preload="metadata" src="' + esc(URL.createObjectURL(file)) + '"></' + (kind === 'video' ? 'video' : 'audio') + '>';
  } else {
    body = '<p class="muted small">No in-browser preview for this file type — it will be stored as-is.</p>';
  }
  return '<div class="lib-preview">' +
    '<div class="lib-preview-meta">' +
      '<span class="badge ' + (kind === 'video' || kind === 'audio' ? 'ok' : 'info') + '">' +
        esc(String(kind).toUpperCase()) + '</span>' +
      (type ? '<span class="mono small"> ' + esc(type) + '</span>' : '') +
      (size ? '<span class="badge info lib-preview-size">' + size + '</span>' : '') +
    '</div>' +
    '<p class="lib-preview-name mono small">' + esc(file.name || 'file') + '</p>' +
    body +
    '</div>';
}
/* Keeps the preview box in step with the file dialog (and revokes old blobs). */
function wireLibFileInput(input, box) {
  if (!input || !box) return;
  let lastUrl = null;
  input.addEventListener('change', function () {
    const f = input.files && input.files[0];
    box.innerHTML = '';
    if (lastUrl) { try { URL.revokeObjectURL(lastUrl); } catch (e) {} lastUrl = null; }
    if (!f) return;
    box.innerHTML = libFilePreviewHtml(f);
    const player = box.querySelector ? box.querySelector('.lib-preview-media') : null;
    if (player && player.addEventListener) {
      player.addEventListener('error', function () {
        toast('This browser cannot play "' + f.name + '" — the file is still saved and can be downloaded.', 'err');
      });
      if (player.src && /^blob:/.test(String(player.src))) lastUrl = player.src;
    }
    if (f.size > LIB_MAX_UPLOAD) {
      box.innerHTML += '<p class="err-text small">This file is ' + fmtBytes(f.size) +
        ' — the limit is 40 MB. Choose a smaller file.</p>';
    }
  });
}

/* ============================================ attach a video or audio ====== */
/* A playable <video>/<audio> tag for an attached media object. */
function mediaTag(media, id) {
  if (!media || !media.url) return '';
  const kind = media.kind === 'audio' ? 'audio' : 'video';
  const cls = kind === 'video' ? 'video-frame' : 'audio-frame';
  return '<' + kind + (id ? ' id="' + esc(id) + '"' : '') + ' class="' + cls +
    '" controls playsinline preload="metadata" src="' + esc(media.url) + '"></' + kind + '>';
}
/* The media currently chosen in a picker, or null when empty/cleared. */
function mediaPickerValue(id) {
  const url = (document.getElementById(id + 'Url') || {}).value || '';
  if (!url) return null;
  return { url: url,
    kind: (document.getElementById(id + 'Kind') || {}).value || 'video',
    name: (document.getElementById(id + 'Name') || {}).value || null,
    size: Number((document.getElementById(id + 'Size') || {}).value) || null };
}
/* The picker markup: browse a file, watch a live percentage, and only see
   "UPLOADED" once the server has the whole file. Read it with mediaPickerValue. */
function mediaPickerHtml(id, media, label) {
  const cur = media || null;
  return '<div class="media-picker" data-media-root="' + esc(id) + '">' +
    '<label>' + esc(label || 'Video or audio (optional)') + '</label>' +
    '<p class="muted small" style="margin:2px 0 8px">Attach a short clip that plays ' +
      'when a learner opens this. Leave empty for none.</p>' +
    '<input type="file" id="' + esc(id) + 'Input" accept="' + esc(LIB_ACCEPT) + '">' +
    '<div class="upload-progress hidden" id="' + esc(id) + 'Progress">' +
      '<div class="upload-progress-bar"><span style="width:0%"></span></div>' +
      '<span class="upload-progress-label">0%</span></div>' +
    '<div id="' + esc(id) + 'Status">' + (cur
      ? '<span class="badge ok">UPLOADED</span> <span class="mono small">' +
        esc(cur.name || cur.url) + (cur.size ? ' (' + fmtBytes(cur.size) + ')' : '') + '</span>' +
        ' <button type="button" class="ghost small" data-media-clear="' + esc(id) + '">Remove</button>'
      : '<span class="muted small">No clip attached.</span>') + '</div>' +
    '<div id="' + esc(id) + 'Preview">' + (cur ? mediaTag(cur, esc(id) + 'Cur') : '') + '</div>' +
    '<input type="hidden" id="' + esc(id) + 'Url" value="' + esc(cur ? cur.url : '') + '">' +
    '<input type="hidden" id="' + esc(id) + 'Kind" value="' + esc(cur ? (cur.kind || 'video') : '') + '">' +
    '<input type="hidden" id="' + esc(id) + 'Name" value="' + esc(cur ? (cur.name || '') : '') + '">' +
    '<input type="hidden" id="' + esc(id) + 'Size" value="' + esc(cur && cur.size ? cur.size : '') + '">' +
    '</div>';
}
/* Wire a picker: browse → upload with a live percentage → preview + "UPLOADED".
   The percentage only reaches 100 and the badge only flips once the server
   responds, so an admin never sees "uploaded" for a half-sent file. */
function wireMediaPicker(id, opts) {
  opts = opts || {};
  const input = document.getElementById(id + 'Input');
  if (!input) return;
  const bar = document.getElementById(id + 'Progress');
  const status = document.getElementById(id + 'Status');
  const preview = document.getElementById(id + 'Preview');
  const set = function (field, value) {
    const el = document.getElementById(id + field);
    if (el) el.value = value == null ? '' : value;
  };
  const root = document.querySelector('[data-media-root="' + id + '"]');
  if (root && root.addEventListener) {
    root.addEventListener('click', function (e) {
      const t = e.target.closest ? e.target.closest('[data-media-clear]') : null;
      if (!t) return;
      set('Url', ''); set('Kind', ''); set('Name', ''); set('Size', '');
      if (status) status.innerHTML = '<span class="muted small">No clip attached.</span>';
      if (preview) preview.innerHTML = '';
      if (input) input.value = '';
    });
  }
  input.addEventListener('change', function () {
    const f = input.files && input.files[0];
    if (!f) return;
    if (f.size > LIB_MAX_UPLOAD) {
      toast('That file is ' + fmtBytes(f.size) + ' — the limit is 40 MB.', 'err');
      input.value = '';
      return;
    }
    const kind = mediaKindByUrl(f.name) === 'audio' ? 'audio' : 'video';
    /* preview straight away from the local file, so the admin sees what they
       picked while the real upload runs */
    if (preview && typeof URL !== 'undefined' && URL.createObjectURL) {
      preview.innerHTML = '<' + kind + ' class="' + (kind === 'video' ? 'video-frame' : 'audio-frame') +
        '" controls playsinline preload="metadata" src="' + esc(URL.createObjectURL(f)) + '"></' + kind + '>';
    }
    if (bar) bar.classList.remove('hidden');
    if (status) status.innerHTML = '<span class="badge warn">UPLOADING… 0%</span>';
    fileToBase64(f).then(function (b64) {
      return API.upload('/upload', { file: { name: f.name, base64: b64, size: f.size }, kind: kind },
        function (pct) {
          if (bar) {
            const span = bar.querySelector('span');
            if (span) span.style.width = pct + '%';
            const lbl = bar.querySelector('.upload-progress-label');
            if (lbl) lbl.textContent = pct + '%';
          }
          if (status) status.innerHTML = '<span class="badge warn">UPLOADING… ' + pct + '%</span>';
        });
    }).then(function (res) {
      if (bar) bar.classList.add('hidden');
      set('Url', res.url); set('Kind', res.kind || kind);
      set('Name', res.name || f.name); set('Size', res.size || f.size);
      if (status) status.innerHTML = '<span class="badge ok">UPLOADED</span> ' +
        '<span class="mono small">' + esc(res.name || f.name) +
        (res.size ? ' (' + fmtBytes(res.size) + ')' : '') + '</span>' +
        ' <button type="button" class="ghost small" data-media-clear="' + esc(id) + '">Remove</button>';
      if (preview) preview.innerHTML = mediaTag({ url: res.url, kind: res.kind || kind }, id + 'Cur');
      toast('Clip uploaded — ' + (res.name || f.name), 'ok');
      if (typeof opts.onUploaded === 'function') opts.onUploaded(res);
    }).catch(function (err) {
      if (bar) bar.classList.add('hidden');
      if (status) status.innerHTML = '<span class="badge bad">UPLOAD FAILED</span> ' +
        '<span class="small">' + esc(err.message) + '</span>';
      toast(err.message, 'err');
    });
  });
}
/* A clip attached to a letter or a book, shown with a close button. Closing hides
   only the clip — the letter or book underneath stays exactly where it was. */
function attachedMediaHtml(media, id) {
  if (!media || !media.url) return '';
  return '<div class="attached-media" data-attached-media="' + esc(id) + '">' +
    '<button type="button" class="attached-media-close" data-attached-close="' + esc(id) +
      '" aria-label="Close the clip" title="Close">&times;</button>' +
    mediaTag(media, id + 'Player') + '</div>';
}
/* Wire the close button so it hides just the clip, never the content. */
function wireAttachedMedia(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('[data-attached-close]').forEach(function (btn) {
    btn.onclick = function () {
      const box = btn.closest ? btn.closest('[data-attached-media]') : null;
      if (box) box.classList.add('hidden');
    };
  });
}

/* ================================================== letters & rich text ==== */
/* Letters are written in a small editor, so the stored text may carry simple
   formatting tags. Only this allow-list ever reaches a learner's screen: every
   other tag is dropped and every attribute is stripped, so no script, link or
   style can ride along. The PHP and Node backends run the same rule on save. */
const RICH_TAGS = ['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
  'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote'];
/* Block-level tags that may carry a text alignment. */
const RICH_ALIGN_TAGS = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote'];
function sanitizeRichHtml(html) {
  let out = String(html == null ? '' : html);
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  ['script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math'].forEach(function (tag) {
    out = out.replace(new RegExp('<' + tag + '[^>]*>[\\s\\S]*?<\\/' + tag + '\\s*>', 'gi'), '');
    out = out.replace(new RegExp('<\\/?' + tag + '[^>]*>', 'gi'), '');
  });
  /* every attribute goes, except a safe text alignment on a block tag */
  out = out.replace(/<([a-z][a-z0-9]*)\b([^>]*)>/gi, function (m, tag, attrs) {
    const t = String(tag).toLowerCase();
    if (RICH_TAGS.indexOf(t) === -1) return '';
    const align = /text-align\s*:\s*(left|center|right|justify)/i.exec(attrs || '');
    if (align && RICH_ALIGN_TAGS.indexOf(t) !== -1) {
      return '<' + t + ' style="text-align:' + align[1].toLowerCase() + '">';
    }
    return '<' + t + '>';
  });
  out = out.replace(/<\s*\/\s*([a-z][a-z0-9]*)\s*>/gi, function (m, tag) {
    return RICH_TAGS.indexOf(String(tag).toLowerCase()) !== -1 ? '</' + tag.toLowerCase() + '>' : '';
  });
  /* a stray angle bracket could open a new tag later — escape it, but never
     disturb the allowed tags (with their optional alignment style) */
  out = out.replace(/<(?!\/?(?:p|div|br|b|strong|i|em|u|s|strike|h1|h2|h3|h4|ul|ol|li|blockquote)(?=[\s/>]))/gi, '&lt;');
  return out;
}
/* The same letter as plain words (for read-aloud and for editors without HTML). */
function plainFromHtml(html) {
  return String(html == null ? '' : html)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|h4|li|blockquote|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+/gm, '').trim();
}
function hasRichText(text) {
  const s = String(text == null ? '' : text);
  return new RegExp('<\\s*/?\\s*(?:' + RICH_TAGS.join('|') + ')[\\s/>]', 'i').test(s);
}
/* Word spans for narration that keep the formatting tags around them. Only the
   sanitizer's (attribute-free) output is passed here, so a tag is never split. */
function narrationRichMarkup(html) {
  let i = 0;
  return String(html).replace(/(<[^>]*>)|(\S+)/g, function (m, tag, word) {
    if (tag) return tag;
    i++;
    return '<span class="narrate-word" data-narrate-word="' + (i - 1) + '">' + word + '</span>';
  });
}
/* The default letter — an admin may change every word of it, title included. */
const CHRIST_LETTER_TITLE = 'The Letter from Christ';
const CHRIST_LETTER_HTML = [
  '<p>My Dear Friend,</p>',
  '<p>I have not come to condemn you, but to find you. Before you read another page of this programme, hear this: you are not a project to be corrected — you are a person to be loved, and love does not give up.</p>',
  '<p>I know the chapters of your story that you would rather nobody ever reads. I have seen them, and I have not looked away. The shame you carry was never meant to be carried alone; bring it to Me and trade it for peace. Where you are weak, I am patient. Where you have failed, I am not finished.</p>',
  '<p>Character is built in the quiet places: in the choice nobody applauds, in the honest word when a lie would be easier, in getting up again after falling. Every small yes to what is right is a stone laid in a foundation that will not shake.</p>',
  '<p>Read, think, argue, question — and then let the truth change you. I am nearer than your next breath, and I will be with you on every page of this journey.</p>',
  '<p>With unending love,<br>Jesus Christ</p>'
].join('');

/* A basic rich-text editor: a toolbar over a contenteditable box. No library,
   nothing to install — the same buttons on both admin consoles. Falls back to
   a plain box where contenteditable/execCommand is unavailable. */
const RTE_BUTTONS = [
  ['bold', 'B', 'Bold'], ['italic', 'I', 'Italic'], ['underline', 'U', 'Underline'],
  ['h3', 'H', 'Heading'], ['quote', '“', 'Quote'],
  ['insertUnorderedList', '•', 'Bulleted list'], ['insertOrderedList', '1.', 'Numbered list'],
  ['alignLeft', '⟸', 'Align left'], ['alignCenter', '↔', 'Align centre'],
  ['alignRight', '⟹', 'Align right'], ['alignFull', '≡', 'Justify'],
  ['removeFormat', 'Tx', 'Clear formatting']
];
function richTextEditorHtml(id, html) {
  const fallback = typeof document === 'undefined' || !document.createElement ||
    typeof document.execCommand !== 'function';
  const tools = RTE_BUTTONS.map(function (b) {
    return '<button type="button" class="rte-btn" data-rte="' + b[0] + '" title="' + esc(b[2]) + '">' +
      esc(b[1]) + '</button>';
  }).join('');
  const body = fallback
    ? '<textarea id="' + esc(id) + '" class="rte-fallback" rows="14">' + esc(plainFromHtml(html)) + '</textarea>'
    : '<div id="' + esc(id) + '" class="rte-body" contenteditable="true" role="textbox" ' +
      'aria-multiline="true" data-rte-body>' + sanitizeRichHtml(html) + '</div>';
  return '<div class="rte" data-rte-root="' + esc(id) + '">' +
    '<div class="rte-bar" role="toolbar" aria-label="Text formatting">' + tools + '</div>' + body + '</div>';
}
function richTextGet(id) {
  const box = document.getElementById(id);
  if (!box) return '';
  return box.classList && box.classList.contains('rte-fallback')
    ? sanitizeRichHtml(plainFromHtml(box.value))
    : sanitizeRichHtml(box.innerHTML);
}
function richTextSet(id, html) {
  const box = document.getElementById(id);
  if (!box) return;
  if (box.classList && box.classList.contains('rte-fallback')) box.value = plainFromHtml(html);
  else box.innerHTML = sanitizeRichHtml(html);
}
/* Wire the toolbar once the editor is on the page. */
function wireRichTextEditor(root) {
  if (!root || !root.querySelectorAll) return;
  const id = root.getAttribute ? root.getAttribute('data-rte-root') : null;
  root.querySelectorAll('[data-rte]').forEach(function (btn) {
    btn.onclick = function (e) {
      e.preventDefault();
      const body = id ? document.getElementById(id) : null;
      if (!body) return;
      if (body.focus) body.focus();
      const cmd = btn.getAttribute('data-rte');
      /* the toolbar names map onto the browser's justify commands */
      const justify = { alignLeft: 'justifyLeft', alignCenter: 'justifyCenter',
        alignRight: 'justifyRight', alignFull: 'justifyFull' };
      try {
        if (cmd === 'h3') document.execCommand('formatBlock', false, 'h3');
        else if (cmd === 'quote') document.execCommand('formatBlock', false, 'blockquote');
        else if (cmd === 'removeFormat') document.execCommand('removeFormat');
        else if (justify[cmd]) document.execCommand(justify[cmd]);
        else document.execCommand(cmd);
      } catch (err) { /* command unavailable in this browser */ }
      if (body.classList && body.classList.contains('rte-fallback')) return;
      body.innerHTML = sanitizeRichHtml(body.innerHTML);
    };
  });
}

/* ==================================================== read-aloud helpers === */
/* A dependency-free narrator built on the browser's own speech synthesis.
   Text is split into one span per word, and the speech "boundary" event moves
   a faint-yellow highlight from word to word as it is spoken. Every controller
   shares the same global channel, so only one thing can ever speak at once. */
const NARRATION_SUPPORTED = (function () {
  try {
    return typeof window !== 'undefined' && !!window.speechSynthesis &&
      typeof window.SpeechSynthesisUtterance !== 'undefined';
  } catch (e) { return false; }
})();
let narratorActive = null;

function narrationWords(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(s))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

/* HTML for a block of text, one span per word (whitespace is kept exactly). */
function narrationMarkup(text) {
  const s = String(text == null ? '' : text);
  let out = '';
  let last = 0;
  let i = 0;
  const re = /\S+/g;
  let m;
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index));
    out += '<span class="narrate-word" data-narrate-word="' + i + '">' + esc(m[0]) + '</span>';
    last = m.index + m[0].length;
    i++;
  }
  out += esc(s.slice(last));
  return out;
}

function narratorControlsHtml(opts) {
  opts = opts || {};
  return '<div class="narrator-bar" data-narrator-controls>' +
    '<button type="button" class="small" data-narrate="play" title="Read this page aloud">▶ Play</button>' +
    '<button type="button" class="small ghost" data-narrate="pause" disabled title="Pause reading">⏸ Pause</button>' +
    '<button type="button" class="small ghost" data-narrate="stop" disabled title="Stop reading">⏹ Stop</button>' +
    '<span class="narrator-status" data-narrate-status role="status" aria-live="polite">' +
      esc(opts.status || 'Press Play to hear this page.') + '</span>' +
  '</div>';
}

/* Text + controls, used for chapter text, letters and library text files.
   A letter written in the rich editor carries formatting tags — those are
   shown as formatting (sanitized first), and read aloud from the plain words. */
function narratedTextHtml(text, opts) {
  opts = opts || {};
  const cls = opts.className ? ' ' + opts.className : '';
  const rich = opts.html !== false && hasRichText(text);
  const shown = rich ? sanitizeRichHtml(text) : esc(text);
  const spoken = rich ? plainFromHtml(shown) : String(text == null ? '' : text);
  return '<div class="narrator" data-narrator>' +
    '<div class="narrator-text' + cls + (rich ? ' letter-rich' : '') + '"' +
      ' data-narrate-text data-narrate-raw="' + esc(spoken) + '">' +
      (rich ? narrationRichMarkup(shown) : narrationMarkup(text)) + '</div>' +
    narratorControlsHtml(opts) +
  '</div>';
}

function narrationVoice() {
  try {
    const voices = window.speechSynthesis.getVoices() || [];
    const english = voices.filter(function (v) {
      return /^en([-_]|$)/i.test(String(v.lang || ''));
    });
    return english.filter(function (v) {
      return /natural|neural|google|microsoft|samantha|daniel/i.test(String(v.name || ''));
    })[0] || english.filter(function (v) { return v.localService; })[0] ||
      english[0] || voices[0] || null;
  } catch (e) { return null; }
}

function createNarrator(opts) {
  opts = opts || {};
  const box = opts.controlsRoot || opts.root || null;
  const textEl = opts.textEl || null;
  const statusEl = box && box.querySelector ? box.querySelector('[data-narrate-status]') : null;
  const wordEls = opts.wordEls
    ? Array.prototype.slice.call(opts.wordEls)
    : (textEl && textEl.querySelectorAll
        ? Array.prototype.slice.call(textEl.querySelectorAll('[data-narrate-word]')) : []);
  let words;
  let utteranceText;
  if (opts.words && opts.words.length) {
    words = opts.words.map(function (w) { return { text: String(w.text || ''), start: w.start, end: w.end }; });
    utteranceText = words.map(function (w) { return w.text; }).join(' ');
    let pos = 0;
    words.forEach(function (w) {
      w.start = pos;
      w.end = pos + w.text.length;
      pos = w.end + 1;
    });
  } else {
    utteranceText = opts.text != null ? String(opts.text) : (textEl ? String(textEl.textContent || '') : '');
    words = narrationWords(utteranceText);
  }

  const scrollWords = opts.scrollWords !== false;
  let state = 'idle';               /* idle | playing | paused | loading */
  let currentUtterance = null;
  let currentWord = -1;
  let token = 0;
  let boundarySeen = false;
  let fallbackTimer = null;
  let fallbackProbe = null;
  let startedAt = 0;
  let pausedFor = 0;
  let destroyed = false;

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }
  function syncButtons() {
    if (!box || !box.querySelector) return;
    const play = box.querySelector('[data-narrate="play"]');
    const pause = box.querySelector('[data-narrate="pause"]');
    const stop = box.querySelector('[data-narrate="stop"]');
    if (play) {
      play.disabled = !NARRATION_SUPPORTED || !words.length || state === 'playing' || state === 'loading';
      play.textContent = state === 'paused' ? '▶ Resume' : '▶ Play';
    }
    if (pause) pause.disabled = state !== 'playing';
    if (stop) stop.disabled = state === 'idle' || state === 'loading';
  }
  function clearHighlight() {
    if (currentWord >= 0 && wordEls[currentWord] && wordEls[currentWord].classList) {
      wordEls[currentWord].classList.remove('narrating');
    }
    currentWord = -1;
  }
  function highlight(index) {
    if (index < 0 || index >= wordEls.length) return;
    if (index === currentWord) return;
    if (currentWord >= 0 && wordEls[currentWord] && wordEls[currentWord].classList) {
      wordEls[currentWord].classList.remove('narrating');
    }
    currentWord = index;
    const el = wordEls[index];
    if (el && el.classList) el.classList.add('narrating');
    if (scrollWords && el && el.scrollIntoView && textEl &&
        textEl.scrollHeight > textEl.clientHeight + 24) {
      try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
    }
  }
  function indexAt(charIndex) {
    const ci = Number(charIndex);
    if (!isFinite(ci)) return currentWord < 0 ? 0 : currentWord;
    for (let i = 0; i < words.length; i++) {
      if (ci < words[i].end) return i;
    }
    return words.length ? words.length - 1 : -1;
  }
  function clearTimers() {
    if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
    if (fallbackProbe) { clearTimeout(fallbackProbe); fallbackProbe = null; }
  }
  /* Not every engine sends word boundaries (Safari can be quiet), so after a
     short wait we keep the page moving with a measured word-by-word estimate. */
  function startTimedHighlight() {
    if (!words.length || fallbackTimer) return;
    const durations = words.map(function (w) { return 100 + w.text.length * 62; });
    const tick = function () {
      if (state !== 'playing' || boundarySeen) { clearTimers(); return; }
      const elapsed = pausedFor + (Date.now() - startedAt);
      let acc = 0;
      let idx = 0;
      for (let i = 0; i < durations.length; i++) {
        acc += durations[i];
        idx = i;
        if (elapsed < acc) break;
      }
      highlight(idx);
    };
    fallbackTimer = setInterval(tick, 120);
    tick();
  }
  function scheduleTimedFallback() {
    if (fallbackProbe) clearTimeout(fallbackProbe);
    fallbackProbe = setTimeout(function () {
      fallbackProbe = null;
      if (state === 'playing' && !boundarySeen) startTimedHighlight();
    }, 900);
  }
  function finished() {
    clearTimers();
    state = 'idle';
    currentUtterance = null;
    boundarySeen = false;
    pausedFor = 0;
    clearHighlight();
    if (narratorActive === api) narratorActive = null;
    setStatus(words.length ? 'Finished' : 'No readable text was found here.');
    syncButtons();
  }
  function stop() {
    if (destroyed) return;
    token++;
    clearTimers();
    if (currentUtterance && narratorActive === api) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    currentUtterance = null;
    boundarySeen = false;
    pausedFor = 0;
    if (narratorActive === api) narratorActive = null;
    state = 'idle';
    clearHighlight();
    setStatus(words.length ? 'Stopped' : 'No readable text was found here.');
    syncButtons();
  }
  function pause() {
    if (state !== 'playing') return;
    try { window.speechSynthesis.pause(); } catch (e) { return; }
    pausedFor += Date.now() - startedAt;
    state = 'paused';
    clearTimers();
    setStatus('Paused');
    syncButtons();
  }
  function resume() {
    if (state !== 'paused') return;
    try { window.speechSynthesis.resume(); } catch (e) { return; }
    state = 'playing';
    startedAt = Date.now();
    boundarySeen = false;
    setStatus('Reading aloud…');
    syncButtons();
    scheduleTimedFallback();
  }
  function play() {
    if (destroyed) return;
    if (!NARRATION_SUPPORTED) {
      setStatus('Read-aloud is not supported by this browser.');
      syncButtons();
      return;
    }
    if (!words.length) {
      setStatus('No readable text was found here.');
      syncButtons();
      return;
    }
    if (state === 'paused') { resume(); return; }
    if (state === 'playing') return;
    if (narratorActive && narratorActive !== api) narratorActive.stop();
    clearTimers();
    clearHighlight();
    boundarySeen = false;
    pausedFor = 0;
    state = 'playing';
    startedAt = Date.now();
    syncButtons();
    setStatus('Reading aloud…');
    const mine = ++token;
    let u;
    try {
      u = new window.SpeechSynthesisUtterance(utteranceText);
    } catch (e) {
      state = 'idle';
      setStatus('Read-aloud could not start in this browser.');
      syncButtons();
      return;
    }
    u.lang = (typeof document !== 'undefined' && document.documentElement &&
      document.documentElement.lang) || 'en-US';
    u.rate = 0.96;
    u.pitch = 1;
    const voice = narrationVoice();
    if (voice) u.voice = voice;
    u.onstart = function () {
      if (mine !== token) return;
      setStatus('Reading aloud…');
    };
    u.onboundary = function (e) {
      if (mine !== token || state !== 'playing') return;
      const at = e && e.charIndex;
      if (!isFinite(Number(at))) return;
      boundarySeen = true;
      clearTimers();
      highlight(indexAt(at));
    };
    u.onend = function () {
      if (mine !== token) return;
      finished();
    };
    u.onerror = function (e) {
      if (mine !== token) return;
      const why = String((e && e.error) || '');
      if (why === 'interrupted' || why === 'canceled' || why === 'cancelled') return;
      finished();
      if (why) setStatus('Read-aloud stopped (' + why + ').');
    };
    currentUtterance = u;
    narratorActive = api;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(u);
      scheduleTimedFallback();
    } catch (e) {
      finished();
      setStatus('Read-aloud could not start in this browser.');
    }
  }
  function destroy() {
    stop();
    destroyed = true;
    if (box) box._narrator = null;
  }

  const api = {
    play: play, pause: pause, stop: stop, destroy: destroy,
    words: words, wordEls: wordEls,
    state: function () { return state; }
  };
  if (box) box._narrator = api;
  if (!NARRATION_SUPPORTED) setStatus('Read-aloud is not supported by this browser.');
  else if (!words.length) setStatus('No readable text was found here.');
  syncButtons();
  return api;
}

/* Turn every narrator block inside a rendered view/modal into a live player. */
function initNarrators(scope) {
  const root = scope || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('[data-narrator]').forEach(function (box) {
    if (box.dataset.narrateReady === '1') return;
    if (box.closest && box.closest('.book-reader')) return;
    const textEl = box.querySelector('[data-narrate-text]');
    if (!textEl) return;
    box.dataset.narrateReady = '1';
    createNarrator({
      controlsRoot: box,
      textEl: textEl,
      text: textEl.getAttribute('data-narrate-raw') || textEl.textContent
    });
    if (box.addEventListener && !box.dataset.narrateWired) {
      box.dataset.narrateWired = '1';
      box.addEventListener('click', function (e) {
        const btn = e.target && e.target.closest ? e.target.closest('[data-narrate]') : null;
        if (!btn || !box._narrator) return;
        const action = btn.getAttribute('data-narrate');
        if (action === 'play') box._narrator.play();
        else if (action === 'pause') box._narrator.pause();
        else if (action === 'stop') box._narrator.stop();
      });
    }
  });
}
function stopNarratorsIn(scope) {
  const root = scope || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('[data-narrator]').forEach(function (box) {
    if (box._narrator) box._narrator.stop();
  });
  root.querySelectorAll('.book-reader').forEach(function (r) { stopBookNarration(r); });
}
function stopAllNarrators() {
  if (narratorActive) narratorActive.stop();
  if (typeof document !== 'undefined' && document.querySelectorAll) {
    document.querySelectorAll('[data-narrator]').forEach(function (box) {
      if (box._narrator) box._narrator.stop();
    });
    document.querySelectorAll('.book-reader').forEach(function (r) { stopBookNarration(r); });
  }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function requireSession(roles) {
  const me = await API.get('/me');
  if (roles && roles.indexOf(me.user.role) === -1) throw new Error('Not permitted');
  API.setUser(me.user);
  return me;
}

/* ============================================================== charts === */
/* Dependency-free chart helpers (inline SVG / CSS) used by every dashboard
   and report. Each one returns an HTML string. */

/* vertical bar chart: items = [{label, value, color?}] */
function chartBars(items, opts) {
  opts = opts || {};
  const list = (items || []).slice(0, opts.max || 12);
  if (!list.length) return '<div class="chart-empty">No data yet.</div>';
  const w = 320, h = 158, gap = 8, baseY = h - 24, topPad = 18;
  const max = Math.max(1, list.reduce(function (m, i) { return Math.max(m, Number(i.value) || 0); }, 0));
  const bw = (w - gap * (list.length - 1)) / list.length;
  let out = '';
  list.forEach(function (it, i) {
    const v = Number(it.value) || 0;
    const bh = Math.max(2, Math.round((baseY - topPad) * (v / max)));
    const x = i * (bw + gap);
    const y = baseY - bh;
    out += '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + bw.toFixed(1) + '" height="' + bh +
      '" rx="3" fill="' + (it.color || 'var(--brand)') + '"><title>' + esc(it.label + ': ' + v) + '</title></rect>' +
      '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 4) + '" text-anchor="middle" font-size="9" fill="#475569">' + esc(String(v)) + '</text>' +
      '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle" font-size="8.5" fill="#64748b">' +
        esc(String(it.label).slice(0, 12)) + '</text>';
  });
  return '<div class="chart"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img">' + out + '</svg></div>' +
    (opts.caption ? '<p class="chart-sub">' + esc(opts.caption) + '</p>' : '');
}

/* horizontal comparison bars: items = [{label, value, color?}] */
function chartBarsH(items, opts) {
  opts = opts || {};
  const list = (items || []).filter(function (x) { return Number(x.value) > 0; }).slice(0, opts.max || 10);
  if (!list.length) return '<div class="chart-empty">No data yet.</div>';
  const max = Math.max.apply(null, list.map(function (i) { return Number(i.value) || 0; }));
  return '<div class="bars">' + list.map(function (it) {
    const v = Number(it.value) || 0;
    const pct = Math.max(3, Math.round(v / max * 100));
    return '<div class="bar-row"><span class="label" title="' + esc(it.label) + '">' + esc(it.label) + '</span>' +
      '<span class="track"><i style="width:' + pct + '%;background:' + (it.color || 'var(--brand)') + '"></i></span>' +
      '<b>' + esc(String(v)) + '</b></div>';
  }).join('') + '</div>' + (opts.caption ? '<p class="chart-sub">' + esc(opts.caption) + '</p>' : '');
}

/* donut: segments = [{label, value, color?}] */
function chartDonut(segments, opts) {
  opts = opts || {};
  const segs = (segments || []).filter(function (s) { return Number(s.value) > 0; });
  const total = segs.reduce(function (a, s) { return a + (Number(s.value) || 0); }, 0);
  if (!total) return '<div class="chart-empty">No data yet.</div>';
  const r = 54, c = 2 * Math.PI * r;
  let off = 0, arcs = '';
  segs.forEach(function (s) {
    const len = c * ((Number(s.value) || 0) / total);
    arcs += '<circle r="' + r + '" cx="70" cy="70" fill="none" stroke="' + (s.color || 'var(--brand)') +
      '" stroke-width="20" stroke-dasharray="' + len.toFixed(2) + ' ' + (c - len).toFixed(2) +
      '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 70 70)"></circle>';
    off += len;
  });
  const legend = segs.map(function (s) {
    return '<span><i style="background:' + (s.color || 'var(--brand)') + '"></i>' + esc(s.label) +
      ' — <b>' + (Number(s.value) || 0) + '</b></span>';
  }).join('');
  const center = opts.center != null ? opts.center : total;
  return '<div class="donut-wrap"><svg viewBox="0 0 140 140" class="donut" role="img">' + arcs +
    '<text x="70" y="68" text-anchor="middle" font-size="22" font-weight="700" fill="#17203a">' + esc(String(center)) + '</text>' +
    '<text x="70" y="86" text-anchor="middle" font-size="9" fill="#64748b">' + esc(opts.centerLabel || 'total') + '</text>' +
    '</svg><div class="legend">' + legend + '</div></div>';
}

/* line chart for trends: items = [{label, value}] (optionally a second series) */
function chartLine(items, opts) {
  opts = opts || {};
  const list = items || [];
  if (!list.length) return '<div class="chart-empty">No data yet.</div>';
  const w = 320, h = 150, padL = 26, padR = 8, padT = 14, padB = 24;
  const max = Math.max(1, list.reduce(function (m, i) {
    return Math.max(m, Number(i.value) || 0, Number(i.value2) || 0);
  }, 0));
  const stepX = list.length > 1 ? (w - padL - padR) / (list.length - 1) : 0;
  const yOf = v => (h - padB) - ((h - padB - padT) * ((Number(v) || 0) / max));
  const pts = list.map(function (it, i) {
    return (padL + i * stepX).toFixed(1) + ',' + yOf(it.value).toFixed(1);
  });
  const pts2 = list.map(function (it, i) {
    return (padL + i * stepX).toFixed(1) + ',' + yOf(it.value2).toFixed(1);
  });
  const area = 'M' + (padL) + ',' + (h - padB) + ' L' + pts.join(' L') + ' L' +
    (padL + stepX * (list.length - 1)) + ',' + (h - padB) + ' Z';
  let grid = '';
  for (let g = 0; g <= 3; g++) {
    const y = padT + ((h - padB - padT) * g / 3);
    grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + y.toFixed(1) +
      '" stroke="#e6ecf5" stroke-width="1"></line>' +
      '<text x="' + (padL - 4) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="8" fill="#94a3b8">' +
      Math.round(max * (1 - g / 3)) + '</text>';
  }
  let labels = '';
  list.forEach(function (it, i) {
    if (list.length > 8 && i % 2 === 1) return;
    labels += '<text x="' + (padL + i * stepX).toFixed(1) + '" y="' + (h - 8) +
      '" text-anchor="middle" font-size="8" fill="#64748b">' + esc(String(it.label).slice(0, 6)) + '</text>';
  });
  const dot = (p, colour) => '<circle cx="' + p.split(',')[0] + '" cy="' + p.split(',')[1] +
    '" r="2.6" fill="' + colour + '"><title></title></circle>';
  return '<div class="chart"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img">' + grid +
    '<path d="' + area + '" fill="' + (opts.fill || 'rgba(47,111,208,.14)') + '"></path>' +
    '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + (opts.color || 'var(--brand)') +
      '" stroke-width="2" stroke-linejoin="round"></polyline>' +
    (opts.second ? '<polyline points="' + pts2.join(' ') + '" fill="none" stroke="#b45309" stroke-width="2"' +
      ' stroke-dasharray="4 3"></polyline>' : '') +
    list.map(function (it, i) {
      return dot(pts[i], opts.color || 'var(--brand)') +
        (opts.second ? dot(pts2[i], '#b45309') : '');
    }).join('') +
    labels +
    '</svg></div>' + (opts.caption ? '<p class="chart-sub">' + esc(opts.caption) + '</p>' : '');
}

/* simple progress rows: items = [{label, percent, note?}] */
function chartProgress(items) {
  const list = items || [];
  if (!list.length) return '<div class="chart-empty">No data yet.</div>';
  return '<div class="bars">' + list.map(function (it) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(it.percent) || 0)));
    return '<div class="bar-row"><span class="label" title="' + esc(it.label) + '">' + esc(it.label) + '</span>' +
      '<span class="track"><i style="width:' + Math.max(2, pct) + '%;background:' + (it.color || 'var(--brand)') + '"></i></span>' +
      '<b>' + pct + '%</b></div>';
  }).join('') + '</div>';
}

/* groups dated rows into the last N ISO weeks: rows = [{createdAt}] */
function chartWeekly(rows, weeks, opts) {
  opts = opts || {};
  const n = weeks || 8;
  const now = new Date();
  const buckets = [];
  for (let i = n - 1; i >= 0; i--) {
    const end = new Date(now.getTime() - i * 7 * 24 * 3600 * 1000);
    const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
    buckets.push({ start: start, end: end, label: (i === 0 ? 'now' : '-' + i + 'w'), value: 0 });
  }
  (rows || []).forEach(function (r) {
    const t = new Date(r.createdAt || r.issuedAt || 0);
    if (isNaN(t.getTime())) return;
    for (let i = 0; i < buckets.length; i++) {
      if (t > buckets[i].start && t <= buckets[i].end) { buckets[i].value++; return; }
    }
  });
  return chartBars(buckets, { caption: opts.caption || 'Grouped into the last ' + n + ' weeks' });
}

/* ================================================ self-assessment report === */
/* Compact pre → post category totals for the student-progress tables. The
   definition is supplied by /reports/students so the columns follow whatever
   the super admin has configured. */
function assessmentMiniHtml(assessment, categories) {
  const pre = assessment && assessment.pre ? assessment.pre : null;
  const post = assessment && assessment.post ? assessment.post : null;
  if (!pre && !post) return '<span class="muted small">Not taken</span>';
  let list = Array.isArray(categories) ? categories.filter(Boolean) : [];
  if (!list.length) {
    const source = (post || pre || {}).categories || [];
    list = source.map(function (c) { return { id: c.id, title: c.title, max: c.max }; });
  }
  function total(rec, id) {
    if (!rec) return '—';
    const found = (rec.categories || []).find(function (c) { return String(c.id) === String(id); });
    return found ? found.total + '/' + found.max : '—';
  }
  return '<div class="assess-mini" title="Self-assessment category totals: pre → post">' +
    '<div class="assess-mini-head">Pre <span>→</span> Post</div>' +
    list.map(function (c) {
      return '<div class="assess-mini-row"><span class="assess-mini-name" title="' + esc(c.title) + '">' +
        esc(c.title) + '</span><span class="assess-mini-total"><b>' + esc(total(pre, c.id)) +
        '</b><span>→</span><b>' + esc(total(post, c.id)) + '</b></span></div>';
    }).join('') + '</div>';
}
function assessmentScoreHtml(value, scale) {
  if (value == null) return '<span class="assess-none">—</span>';
  const n = Number(value);
  const label = (scale || []).find(function (s) { return Number(s.value) === n; });
  return '<span class="assess-val">' + esc(String(n)) + '</span>' +
    (label ? '<div class="assess-score-label">' + esc(label.label) + '</div>' : '');
}
/* Full statement-by-statement body used inside the report popup. */
function assessmentAttemptHtml(data) {
  data = data || {};
  const student = data.student || {};
  const pre = data.pre || null;
  const post = data.post || null;
  const growth = data.growth == null ? null : Number(data.growth);
  const scale = data.scale || [];
  const fmtTotal = function (rec) { return rec ? rec.total + ' / ' + rec.max : '—'; };
  let h = '<div class="assess-popup">' +
    '<div class="assess-popup-head"><div><h2>' + esc(student.fullName || 'Self-assessment') + '</h2>' +
      '<p class="muted small">' + esc(student.className || 'No class') +
      (student.studentNumber ? ' · ' + esc(student.studentNumber) : '') +
      '</p></div><div class="assess-popup-totals">' +
      '<div class="stat tone-blue"><div class="n">' + fmtTotal(pre) + '</div><div class="l">Pre-score</div></div>' +
      '<div class="stat tone-green"><div class="n">' + fmtTotal(post) + '</div><div class="l">Post-score</div></div>' +
      '<div class="stat tone-violet"><div class="n">' + (growth == null ? '—' : (growth >= 0 ? '+' : '') + growth) +
        '</div><div class="l">Growth</div></div></div></div>';
  h += '<p class="muted small">How the learner rated every objective question. ' +
    'Each answer is on the 1–5 scale; the category total is the sum of its questions.</p>';
  if (!pre && !post) {
    return h + '<div class="closed-banner">This learner has not taken the self-assessment yet.</div></div>';
  }
  const cats = data.categories || [];
  h += cats.map(function (c) {
    const preTotal = c.preTotal == null ? '—' : c.preTotal + ' / ' + c.max;
    const postTotal = c.postTotal == null ? '—' : c.postTotal + ' / ' + c.max;
    return '<div class="card assess-popup-cat"><div class="assess-cat-head"><h3>' + esc(c.title) + '</h3>' +
      '<span class="badge info">Pre ' + esc(preTotal) + '</span> <span class="badge ok">Post ' + esc(postTotal) + '</span></div>' +
      '<div class="table-wrap"><table class="assess-table"><thead><tr><th>Objective question</th>' +
      '<th>Pre-score</th><th>Post-score</th><th>Change</th></tr></thead><tbody>' +
      (c.statements || []).map(function (s) {
        const change = s.pre != null && s.post != null ? Number(s.post) - Number(s.pre) : null;
        return '<tr><td>' + esc(s.text) + '</td>' +
          '<td>' + assessmentScoreHtml(s.pre, scale) + '</td>' +
          '<td>' + assessmentScoreHtml(s.post, scale) + '</td>' +
          '<td>' + (change == null ? '<span class="assess-none">—</span>'
            : '<b class="' + (change > 0 ? 'assess-up' : change < 0 ? 'assess-down' : 'muted') + '">' +
              (change > 0 ? '+' : '') + change + '</b>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }).join('');
  if (!cats.length) h += '<p class="muted">No self-assessment categories are currently active.</p>';
  return h + '</div>';
}
function closeAssessmentModal() {
  const modal = document.getElementById('studentDetailModal');
  if (modal) modal.classList.add('hidden');
}
/* Shared by the supervisor and super-admin reports. */
async function openAssessmentModal(studentId) {
  const modal = document.getElementById('studentDetailModal');
  if (!modal) return;
  modal.innerHTML = '<div class="student-detail-overlay"><div class="student-detail-card card">' +
    '<p class="muted">Loading self-assessment…</p></div></div>';
  modal.classList.remove('hidden');
  try {
    const data = await API.get('/reports/student-assessment?studentId=' +
      encodeURIComponent(studentId));
    modal.innerHTML = '<div class="student-detail-overlay" onclick="if(event.target===this) closeAssessmentModal()">' +
      '<div class="student-detail-card assessment-detail-card">' +
      '<button type="button" class="sd-close" onclick="closeAssessmentModal()">&times;</button>' +
      assessmentAttemptHtml(data) + '</div></div>';
  } catch (e) {
    modal.innerHTML = '<div class="student-detail-overlay" onclick="if(event.target===this) closeAssessmentModal()">' +
      '<div class="student-detail-card card"><button type="button" class="sd-close" onclick="closeAssessmentModal()">' +
      '&times;</button><h3>Could not load the self-assessment</h3><p class="muted small">' +
      esc(e.message || 'Request failed') + '</p></div></div>';
  }
}

/* ================================================= chapter page picker ==== */
/* Every page of the book is offered — no 99-page cut-off. The chips wrap and
   scroll inside the panel (so they fit under the field), the total can be set
   by hand, and if the book is linked to a PDF the real page count is read from
   it so all of its pages appear. */
function pgChipsHTML(total, selected) {
  const set = new Set((selected || []).map(Number));
  const n = Math.max(1, Math.min(5000, Number(total) || 1));
  let h = '';
  for (let i = 1; i <= n; i++) {
    h += '<label class="chip pg-chip' + (set.has(i) ? ' on' : '') + '">' +
      '<input type="checkbox" class="pg-ck" value="' + i + '"' + (set.has(i) ? ' checked' : '') + '> ' + i +
      '</label>';
  }
  return h;
}
function pagePickerHTML(selected, total, opts) {
  opts = opts || {};
  const sel = (selected || []).map(Number).filter(function (n) { return n >= 1; });
  const maxSel = sel.length ? Math.max.apply(null, sel) : 0;
  const n = Math.max(Number(total) || 0, maxSel, Number(opts.min) || 60);
  return '<div class="page-pick" data-pg data-pg-total="' + n + '"' +
      (opts.pdf ? ' data-pg-pdf="' + esc(opts.pdf) + '"' : '') + '>' +
    '<label>Select pages *</label>' +
    '<div class="pg-tools">' +
      '<label class="pg-count">Pages in this book' +
        '<input type="number" min="1" max="5000" class="pg-total-num" value="' + n + '"></label>' +
      '<label>From<input type="number" min="1" class="pg-from" placeholder="1"></label>' +
      '<label>To<input type="number" min="1" class="pg-to" placeholder="' + n + '"></label>' +
      '<button type="button" class="small" data-act="pg-range">Select range</button>' +
      '<button type="button" class="small ghost" data-act="pg-all">All pages</button>' +
      '<button type="button" class="small ghost" data-act="pg-clear">Clear</button>' +
    '</div>' +
    '<div class="pg-grid" data-pg-grid>' + pgChipsHTML(n, sel) + '</div>' +
    '<p class="muted small pg-hint">Scroll the box to reach every page. "All pages" ticks the whole book.</p>' +
  '</div>';
}
function pgRootOf(el) { return el && el.closest ? el.closest('[data-pg]') : null; }
function pgSelected(root) {
  if (!root) return [];
  return Array.prototype.map.call(root.querySelectorAll('.pg-ck:checked'), function (c) {
    return Number(c.value);
  }).filter(function (n) { return n >= 1; });
}
function pgRebuild(root, total, sel) {
  if (!root) return;
  const grid = root.querySelector('[data-pg-grid]');
  const n = Math.max(1, Math.min(5000, Number(total) || 1));
  root.dataset.pgTotal = n;
  if (grid) grid.innerHTML = pgChipsHTML(n, sel || pgSelected(root));
  const num = root.querySelector('.pg-total-num');
  if (num) num.value = n;
}
/* Sizes the picker from a linked PDF (all pages of the book appear). */
function pgInit(root, pdfUrl) {
  if (!root || root.dataset.pgInit === '1') return;
  root.dataset.pgInit = '1';
  const url = pdfUrl || root.dataset.pgPdf;
  if (!url || typeof pdfPageCount !== 'function') return;
  pdfPageCount(url).then(function (n) {
    if (!n) return;
    const sel = pgSelected(root);
    const maxSel = sel.length ? Math.max.apply(null, sel) : 0;
    if (n > Number(root.dataset.pgTotal || 0)) pgRebuild(root, Math.max(n, maxSel), sel);
  });
}
function pgAllRanges(root, on) {
  root.querySelectorAll('.pg-ck').forEach(function (c) {
    c.checked = on;
    const chip = c.closest('.pg-chip');
    if (chip) chip.classList.toggle('on', on);
  });
}
function pgRange(root, from, to) {
  const a = Math.max(1, Math.min(Number(from) || 1, Number(to) || 1));
  const b = Math.max(Number(from) || 1, Number(to) || 1);
  root.querySelectorAll('.pg-ck').forEach(function (c) {
    const v = Number(c.value);
    if (v >= a && v <= b) {
      c.checked = true;
      const chip = c.closest('.pg-chip');
      if (chip) chip.classList.add('on');
    }
  });
}

/* Delegated so every page picker works, wherever it is rendered. */
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const btn = t.closest('[data-act="pg-range"], [data-act="pg-all"], [data-act="pg-clear"]');
    if (!btn) return;
    const root = pgRootOf(btn);
    if (!root) return;
    e.preventDefault();
    const act = btn.getAttribute('data-act');
    if (act === 'pg-all') pgAllRanges(root, true);
    else if (act === 'pg-clear') pgAllRanges(root, false);
    else {
      const f = root.querySelector('.pg-from');
      const to = root.querySelector('.pg-to');
      pgRange(root, f ? f.value : 1, to ? to.value : 1);
    }
  });
  document.addEventListener('change', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.classList && t.classList.contains('pg-total-num')) {
      pgRebuild(pgRootOf(t), t.value, pgSelected(pgRootOf(t)));
      return;
    }
    if (t.classList && t.classList.contains('pg-ck')) {
      const chip = t.closest('.pg-chip');
      if (chip) chip.classList.toggle('on', !!t.checked);
    }
  });
}

/* ================================================ book-style sheet fitting === */
/* The SHEET is a viewport the size of the space it has; the PAGE LAYER inside
   it is the whole page at the sheet's width (so the print is as large as the
   width allows — the readability goal). A page taller than the sheet is not
   cropped: the page layer scrolls inside the sheet (bookScrollTo), and the
   next flick at its end turns the leaf. bookFitBox() is the maths on its own
   so it can be tested: it reports the viewport (w, h) AND the full page
   height (pageH) at that width. */
function bookFitBox(availW, availH, ratio) {
  const r = Number(ratio) > 0 ? Number(ratio) : 1 / 1.414;
  const maxW = Math.max(80, Number(availW) || 0);
  const maxH = Math.max(80, Number(availH) || 0);
  const w = maxW;                       /* fit by WIDTH: largest readable print */
  const pageH = Math.round(w / r);      /* the whole page at that width */
  const h = Math.min(pageH, maxH);      /* the viewport never exceeds the space */
  return { w: Math.round(w), h: Math.round(h), pageH: pageH };
}
/* Move the page layer inside the sheet, clamped to the page's own ends. */
function bookScrollTo(root, y) {
  if (!root || !root.querySelector) return 0;
  const max = Math.max(0, Number(root.dataset.bookScrollMax || 0) || 0);
  const v = Math.max(0, Math.min(Number(y) || 0, max));
  root.dataset.bookScroll = String(v);
  const wrap = root.querySelector('.book-frame-wrap');
  if (wrap && wrap.style) wrap.style.transform = v ? 'translateY(-' + v + 'px)' : '';
  return v;
}
function bookFit(root) {
  if (!root || !root.querySelector || !root.dataset || !root.querySelectorAll) return false;
  const sheet = root.querySelector('.book-page');
  const stage = root.querySelector('.book-stage');
  if (!sheet || !stage || !sheet.style) return false;
  const ratio = Number(root.dataset.bookRatio || 0) || (1 / 1.414);
  /* the turn arrows sit either side of the sheet and keep their own width */
  const arrows = root.querySelectorAll('.page-turn') || [];
  let reserved = 0;
  for (let i = 0; i < arrows.length; i++) reserved += Number(arrows[i].offsetWidth || 0) + 10;
  const winH = (typeof window !== 'undefined' && window.innerHeight) ? Number(window.innerHeight) : 800;
  const docW = (typeof document !== 'undefined' && document.documentElement &&
    document.documentElement.clientWidth) ? Number(document.documentElement.clientWidth) : 960;
  const full = !!(root.classList && root.classList.contains && root.classList.contains('book-full'));
  const stageW = Number(stage.clientWidth || 0) || docW;
  /* use the reader's own bounding box when available so the page fits the
     actual space instead of guessing from the whole window */
  const availH = full
    ? (Number(stage.clientHeight || 0) || Math.round(winH * 0.9))
    : Math.round(winH * 0.9);
  const box = bookFitBox(stageW - reserved - 4, availH, ratio);
  sheet.style.width = box.w + 'px';
  sheet.style.height = box.h + 'px';
  sheet.style.maxHeight = 'none';
  /* the page layer is the WHOLE page: as wide as the sheet, its own tall shape */
  const wrap = root.querySelector('.book-frame-wrap');
  if (wrap && wrap.style) wrap.style.height = box.pageH + 'px';
  root.dataset.bookScrollMax = String(Math.max(0, box.pageH - box.h));
  bookScrollTo(root, Number(root.dataset.bookScroll || 0) || 0);
  root.dataset.bookFitted = '1';
  return true;
}
/* Fit now, and again as soon as the page's real shape is known. */
function bookEnsureFit(root) {
  if (!root) return;
  bookFit(root);
  if (!root.dataset.bookRatio && root.dataset.book && typeof pdfPageRatio === 'function') {
    pdfPageRatio(root.dataset.book).then(function (ratio) {
      if (!ratio) return;
      root.dataset.bookRatio = String(ratio);
      bookFit(root);
    });
  }
}
function bookFitAll() {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  document.querySelectorAll('.book-reader').forEach(function (r) { bookFit(r); });
}

/* ================================================ book-style PDF reader === */
/* PDFs open one page at a time, like turning the pages of a book: no long
   scroll and no viewer chrome. Prev/Next buttons (or the arrow keys, or the
   arrows either side of the page) flip from page to page. */
function pdfSrc(url, page) {
  /* The frame is the page's OWN shape and full height (bookFit sizes it from
     the page ratio), so view=Fit + zoom=page-fit fills the frame with the WHOLE
     page: the print is as large as the sheet's width allows and nothing is
     cropped — the sheet scrolls a taller page instead of cutting it. */
  return url + '#page=' + page + '&view=Fit&zoom=page-fit&toolbar=0&navpanes=0&pagemode=none';
}
/* One sheet of the book. A fresh element per page is what actually moves the
   browser's PDF viewer: changing only the #page= fragment of a frame that is
   already loaded is ignored, so every turn re-creates the frame. */
function bookFrameHtml(url, page, title) {
  return '<iframe class="pdf-frame" src="' + esc(pdfSrc(url, page)) + '" title="' +
    esc(title || 'Book') + '" loading="eager" scrolling="no"></iframe>';
}
/* The reader itself — only injected when a book is actually opened. */
function bookReaderHtml(url, opts) {
  opts = opts || {};
  const label = opts.title || 'Book';
  const from = Math.max(1, Number(opts.from) || 1);
  const to = Number(opts.to) > from ? Number(opts.to) : 0;   /* 0 = no upper limit */
  const rangeNote = to ? 'Chapter pages ' + from + '–' + to + ' only'
    : 'Turn the pages — the sheet never scrolls; scroll to read a tall page';
  return '<div class="book-reader" data-book="' + esc(url) + '" data-page="' + from + '"' +
      ' data-book-title="' + esc(label) + '"' +
      (opts.back ? ' data-book-back="1"' : '') +
      ' data-book-rendered="' + from + '"' +
      ' data-book-min="' + from + '"' + (to ? ' data-book-max="' + to + '"' : '') + '>' +
    '<div class="book-stage">' +
      '<button type="button" class="page-turn prev" data-book-turn="-1" aria-label="Previous page"' +
        ' title="Previous page">‹</button>' +
      '<div class="book-page">' +
        /* the sheet is clipped and covered by a shield, so the viewer inside can
           only be moved a page at a time (wheel / swipe / arrows), never scrolled.
           Its shape is fitted to the page itself (bookFit), so nothing is cut. */
        '<div class="book-frame-wrap">' + bookFrameHtml(url, from, label) + '</div>' +
        '<div class="book-shield" data-book-shield aria-hidden="true"' +
          ' title="Scroll to read a tall page — flick at its end to turn"></div>' +
      '</div>' +
      '<button type="button" class="page-turn next" data-book-turn="1" aria-label="Next page"' +
        ' title="Next page">›</button>' +
    '</div>' +
    '<div class="book-narrator" data-book-narrator>' +
      narratorControlsHtml({ status: 'Press Play to hear this page.' }) +
    '</div>' +
    '<div class="book-bar">' +
      '<button type="button" class="ghost small" data-book-turn="-1">‹ Previous</button>' +
      '<span class="book-page-no">Page <b data-book-page>' + from + '</b>' +
        '<span data-book-total>' + (to ? ' of ' + to : '') + '</span></span>' +
      '<button type="button" class="ghost small" data-book-turn="1">Next ›</button>' +
      '<span class="book-spacer"></span>' +
      '<span class="muted small book-hint">' + esc(rangeNote) + '</span>' +
      (to ? '' : '<a class="ghost small" href="' + esc(url) + '" target="_blank" rel="noopener">Open ↗</a>') +
      '<button type="button" class="ghost small" data-book-full>Full page</button>' +
      '<button type="button" class="ghost small danger" data-book-close>Close</button>' +
    '</div></div>';
}
/* A book stays shut until someone clicks it, and can be limited to a page range
   (a chapter's own pages) so the rest of the book is never reachable. */
function bookCoverHtml(url, opts) {
  opts = opts || {};
  const label = opts.title || 'Book';
  const note = opts.note || (opts.from && opts.to
    ? 'Pages ' + opts.from + '–' + opts.to + ' of the book only.'
    : 'PDF book — it only opens when you click it.');
  return '<div class="book-open-card" data-book-url="' + esc(url) + '" data-book-title="' + esc(label) + '"' +
    (opts.from ? ' data-book-from="' + esc(String(opts.from)) + '"' : '') +
    (opts.to ? ' data-book-to="' + esc(String(opts.to)) + '"' : '') + '>' +
    '<span class="book-open-icon" aria-hidden="true">📖</span>' +
    '<span class="book-open-text"><b>' + esc(label) + '</b>' +
      '<span class="muted small">' + esc(note) + '</span></span>' +
    '<button type="button" class="small" data-book-load>' + esc(opts.button || 'Open book') + '</button>' +
  '</div>';
}
/* a book the learner may not open yet (e.g. before finishing every module) */
function bookLockedHtml(title, note) {
  return '<div class="book-open-card locked">' +
    '<span class="book-open-icon" aria-hidden="true">🔒</span>' +
    '<span class="book-open-text"><b>' + esc(title || 'Book') + '</b>' +
      '<span class="muted small">' + esc(note || 'This book opens once you have completed every module.') + '</span></span>' +
  '</div>';
}
/* pdfHtml(): pass { open: true } to show the reader straight away, or
   { from, to } to limit it to a page range (a chapter). */
function pdfHtml(url, opts) {
  opts = opts || {};
  const isPdf = typeof url === 'string' && /\.pdf($|[?#])/i.test(url);
  if (!isPdf) {
    return '<a class="btn ghost small" href="' + esc(url) + '" target="_blank" rel="noopener">Open ↗</a>';
  }
  return opts.open ? bookReaderHtml(url, opts) : bookCoverHtml(url, opts);
}

/* Page count and page shape, found by scanning the PDF (no libraries, no server
   round-trip). The shape matters: a sheet that matches the page shows the WHOLE
   page in every viewer, even one that ignores the #zoom fragment and simply fits
   the width. */
const pdfInfoCache = {};
const pdfPageCache = {};
function pdfBytesText(buf) {
  const bytes = new Uint8Array(buf);
  let text = '';
  const step = 1 << 16;
  for (let i = 0; i < bytes.length; i += step) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + step, bytes.length)));
  }
  return text;
}
/* The displayed page box, read from the FIRST page object: CropBox is what a
   viewer shows, so it wins there; /Rotate 90 or 270 swaps the sides (scans are
   often stored sideways). */
function parsePdfPageSize(text) {
  const s = String(text || '');
  /* keep to the first page's own dictionary so another page's box cannot win */
  const start = s.search(/\/Type\s*\/Page(?![s])/);
  let scope = s;
  if (start >= 0) {
    const end = s.indexOf('endobj', start);
    scope = s.slice(start, end > start ? end : Math.min(s.length, start + 3000));
  }
  const box = function (name) {
    const m = new RegExp('/' + name +
      '\\s*\\[\\s*(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)').exec(scope);
    if (!m) return null;
    const w = Math.abs(Number(m[3]) - Number(m[1]));
    const h = Math.abs(Number(m[4]) - Number(m[2]));
    return (w > 0 && h > 0) ? { w: w, h: h } : null;
  };
  const b = box('CropBox') || box('MediaBox');
  if (!b) return null;
  const rot = Number((/\/Rotate\s+(-?\d+)/.exec(scope) || [])[1] || 0);
  const swap = Math.abs(rot) % 180 === 90;
  return swap ? { w: b.h, h: b.w } : { w: b.w, h: b.h };
}
function pdfInfo(url) {
  const key = String(url || '');
  if (pdfInfoCache[key]) return Promise.resolve(pdfInfoCache[key]);
  const done = function (info) { pdfInfoCache[key] = info; return info; };
  if (typeof fetch !== 'function') return Promise.resolve(done({ pages: 0, w: 0, h: 0 }));
  return fetch(url, { credentials: 'same-origin' }).then(function (r) {
    return r && r.ok ? r.arrayBuffer() : null;
  }).then(function (buf) {
    if (!buf || !buf.byteLength || buf.byteLength > 40 * 1024 * 1024) return done({ pages: 0, w: 0, h: 0 });
    const text = pdfBytesText(buf);
    const direct = text.match(/\/Type\s*\/Page(?![s])/g);
    let pages = 0;
    if (direct && direct.length) pages = direct.length;
    else {
      const counts = text.match(/\/Count\s+(\d+)/g) || [];
      const nums = counts.map(function (s2) { return Number(String(s2).replace(/[^0-9]/g, '')) || 0; });
      pages = nums.length ? Math.max.apply(null, nums) : 0;
    }
    const size = parsePdfPageSize(text) || { w: 0, h: 0 };
    return done({ pages: pages, w: size.w, h: size.h });
  }).catch(function () { return done({ pages: 0, w: 0, h: 0 }); });
}
function pdfPageCount(url) {
  if (pdfPageCache[url] != null) return Promise.resolve(pdfPageCache[url]);
  return pdfInfo(url).then(function (i) {
    pdfPageCache[url] = i.pages;
    return i.pages;
  });
}
/* width / height of the page, so the sheet can be the page's own shape.
   0 when it could not be read (the sheet then keeps the A4-ish fallback). */
function pdfFirstPageSize(url) {
  return pdfInfo(url).then(function (i) { return (i && i.w && i.h) ? { w: i.w, h: i.h } : null; });
}
function pdfPageRatio(url) {
  return pdfFirstPageSize(url).then(function (s) { return s ? s.w / s.h : 0; });
}

/* ============================================ PDF page text + highlighting == */
/* The browser's own PDF viewer cannot be told which word it is drawing, so when
   someone presses Play we render that one page with PDF.js (canvas + a text
   layer) and highlight the actual words on the page. The native iframe stays
   underneath as the fallback for browsers where PDF.js cannot load. */
let pdfJsPromise = null;
const pdfScripts = {};
function loadScriptOnce(src) {
  if (pdfScripts[src]) return pdfScripts[src];
  pdfScripts[src] = new Promise(function (resolve, reject) {
    if (typeof document === 'undefined' || !document.head) {
      reject(new Error('PDF.js cannot load here'));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = function () { resolve(); };
    s.onerror = function () { reject(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  }).catch(function (e) {
    delete pdfScripts[src];
    throw e;
  });
  return pdfScripts[src];
}
function loadPdfJs() {
  if (typeof window === 'undefined') return Promise.reject(new Error('PDF.js needs a browser'));
  if (window.pdfjsLib) {
    return loadScriptOnce('/js/pdfjs/pdf.worker.min.js?v=38').catch(function () {}).then(function () {
      try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/js/pdfjs/pdf.worker.min.js?v=38'; } catch (e) {}
      return window.pdfjsLib;
    });
  }
  if (pdfJsPromise) return pdfJsPromise;
  pdfJsPromise = Promise.all([
    loadScriptOnce('/js/pdfjs/pdf.min.js?v=38'),
    /* Running the worker code on the main thread as well keeps read-aloud
       reliable on locked-down browsers and inside in-app webviews, where a
       separate worker can be blocked. PDF.js picks it up automatically. */
    loadScriptOnce('/js/pdfjs/pdf.worker.min.js?v=38').catch(function () {})
  ]).then(function () {
    const lib = window.pdfjsLib;
    if (!lib || !lib.getDocument) throw new Error('PDF.js did not initialise');
    try { lib.GlobalWorkerOptions.workerSrc = '/js/pdfjs/pdf.worker.min.js?v=38'; } catch (e) {}
    return lib;
  }).catch(function (e) {
    pdfJsPromise = null;
    throw e;
  });
  return pdfJsPromise;
}

const pdfDocCache = {};
function pdfDocFor(url) {
  const key = String(url || '');
  if (!key) return Promise.reject(new Error('No PDF address'));
  if (!pdfDocCache[key]) {
    pdfDocCache[key] = loadPdfJs().then(function (lib) {
      return lib.getDocument({ url: key, isEvalSupported: false }).promise;
    }).catch(function (e) {
      delete pdfDocCache[key];
      throw e;
    });
  }
  return pdfDocCache[key];
}

function bookNarratorState(root) {
  if (!root) return null;
  if (!root._bookNarrator) {
    root._bookNarrator = { controller: null, page: 0, seq: 0, loading: false, mode: false };
  }
  return root._bookNarrator;
}
function bookNarratorStatus(root, msg) {
  const el = root && root.querySelector ? root.querySelector('[data-book-narrator] [data-narrate-status]') : null;
  if (el) el.textContent = msg;
}
function bookNarratorSync(root) {
  const st = bookNarratorState(root);
  const bar = root && root.querySelector ? root.querySelector('[data-book-narrator]') : null;
  if (!bar) return;
  const play = bar.querySelector('[data-narrate="play"]');
  const pause = bar.querySelector('[data-narrate="pause"]');
  const stop = bar.querySelector('[data-narrate="stop"]');
  const state = st && st.controller ? st.controller.state() : 'idle';
  const noWords = !!(st && st.controller && st.controller.words && !st.controller.words.length);
  if (play) play.disabled = !NARRATION_SUPPORTED || st.loading || noWords ||
    state === 'playing' || state === 'loading';
  if (pause) pause.disabled = state !== 'playing';
  if (stop) stop.disabled = st.loading || (!st.controller && state === 'idle');
}
function pdfRenderNarratedPage(root, pageNo, token) {
  const current = function () {
    return !token || !root._bookNarrator ||
      (root._bookNarrator.seq === token && Number(root.dataset.page) === Number(pageNo));
  };
  return loadPdfJs().then(function (lib) {
    return pdfDocFor(root.dataset.book).then(function (doc) {
      return doc.getPage(Number(pageNo) || 1);
    }).then(function (page) {
      if (!current()) throw new Error('Page changed before it could be read');
      const first = page.getViewport({ scale: 1 });
      const ratio = first.width / first.height;
      root.dataset.bookRatio = String(ratio);
      try { bookFit(root); } catch (e) {}
      const sheet = root.querySelector('.book-page');
      const wrap = root.querySelector('.book-frame-wrap');
      if (!sheet || !wrap) throw new Error('The book page is not on screen');
      let width = Math.floor(Number(sheet.clientWidth || 0));
      if (!width) width = Math.floor(Number(wrap.clientWidth || 0)) || 640;
      const cssScale = width / first.width;
      const viewport = page.getViewport({ scale: cssScale });
      const dpr = Math.max(1, Math.min(2, Number(window.devicePixelRatio || 1)));
      let render = wrap.querySelector('.pdf-render');
      if (!render) {
        wrap.insertAdjacentHTML('beforeend',
          '<div class="pdf-render"><canvas class="pdf-canvas"></canvas>' +
          '<div class="pdf-text-layer" aria-hidden="true"></div></div>');
        render = wrap.querySelector('.pdf-render');
      }
      const canvas = render.querySelector('.pdf-canvas');
      const layer = render.querySelector('.pdf-text-layer');
      if (!canvas || !layer) throw new Error('The page renderer is missing');
      const ctx = canvas.getContext('2d');
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      render.style.width = viewport.width + 'px';
      render.style.height = viewport.height + 'px';
      layer.style.width = viewport.width + 'px';
      layer.style.height = viewport.height + 'px';
      layer.innerHTML = '';
      const scaled = page.getViewport({ scale: cssScale * dpr });
      return page.render({ canvasContext: ctx, viewport: scaled }).promise.then(function () {
        if (!current()) throw new Error('Page changed while it was being read');
        return page.getTextContent();
      }).then(function (content) {
        if (!current()) throw new Error('Page changed while its words were read');
        const words = [];
        const wordEls = [];
        (content.items || []).forEach(function (item) {
          const str = String(item.str == null ? '' : item.str);
          if (!str || !str.replace(/\s+/g, '')) return;
          if (!item.transform) return;
          const tx = lib.Util.transform(viewport.transform, item.transform);
          const fontHeight = Math.max(1, Math.hypot(tx[2], tx[3]));
          const angle = Math.atan2(tx[1], tx[0]);
          const span = document.createElement('span');
          span.className = 'pdf-text-item';
          span.style.left = tx[4] + 'px';
          span.style.top = (tx[5] - fontHeight) + 'px';
          span.style.fontSize = fontHeight + 'px';
          span.style.lineHeight = '1';
          span.style.fontFamily = 'sans-serif';
          const parts = str.split(/(\s+)/);
          parts.forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) {
              span.appendChild(document.createTextNode(part));
              return;
            }
            const word = document.createElement('span');
            word.className = 'narrate-word pdf-word';
            word.textContent = part;
            span.appendChild(word);
            words.push({ text: part });
            wordEls.push(word);
          });
          layer.appendChild(span);
          const natural = span.offsetWidth || span.getBoundingClientRect().width || 0;
          const target = Math.abs(Number(item.width || 0) * viewport.scale) || natural;
          const scaleX = (natural && target) ? target / natural : 1;
          span.style.transformOrigin = '0 0';
          span.style.transform = 'rotate(' + angle + 'rad)' +
            (Math.abs(scaleX - 1) > 0.001 ? ' scaleX(' + scaleX + ')' : '');
        });
        wrap.classList.add('pdf-rendered');
        try { page.cleanup(); } catch (e) {}
        return { words: words, wordEls: wordEls, ratio: ratio };
      });
    });
  });
}

function stopBookNarration(root, keepMode) {
  const st = root && root._bookNarrator;
  if (!root) return;
  if (st) {
    st.seq++;
    st.loading = false;
    if (st.controller) {
      try { st.controller.stop(); } catch (e) {}
      st.controller = null;
    }
    if (!keepMode) {
      st.page = 0;
      st.mode = false;
      try { delete root.dataset.bookNarrate; } catch (e) { root.dataset.bookNarrate = ''; }
    }
  }
  bookNarratorSync(root);
}

function bookPrepareNarration(root, opts) {
  opts = opts || {};
  const st = bookNarratorState(root);
  const page = Number(root.dataset.page || 1);
  if (!st) return Promise.resolve(null);
  if (st.controller && st.page === page && !opts.force) return Promise.resolve(st.controller);
  if (st.controller) {
    try { st.controller.destroy(); } catch (e) {}
    st.controller = null;
  }
  st.seq++;
  const seq = st.seq;
  st.loading = true;
  st.mode = true;
  root.dataset.bookNarrate = '1';
  bookNarratorStatus(root, 'Preparing this page…');
  bookNarratorSync(root);
  return pdfRenderNarratedPage(root, page, seq).then(function (data) {
    if (seq !== st.seq || Number(root.dataset.page) !== page) return null;
    st.loading = false;
    const bar = root.querySelector('[data-book-narrator]');
    const controller = createNarrator({
      controlsRoot: bar,
      words: data.words,
      wordEls: data.wordEls,
      scrollWords: false,
      status: data.words.length ? 'Press Play to hear this page.' : 'No readable text was found on this page.'
    });
    st.page = page;
    st.controller = controller;
    bookNarratorSync(root);
    if (opts.autoPlay && data.words.length) controller.play();
    return controller;
  }).catch(function (e) {
    if (seq !== st.seq) return null;
    st.loading = false;
    st.controller = null;
    bookNarratorStatus(root, 'Read-aloud could not load this page: ' + (e.message || 'unknown error'));
    bookNarratorSync(root);
    return null;
  });
}

function bookNarrateAction(root, action) {
  if (!root) return null;
  const st = bookNarratorState(root);
  const page = Number(root.dataset.page || 1);
  if (action === 'play') {
    if (st.controller && st.page === page && !st.loading) {
      st.controller.play();
      bookNarratorSync(root);
      return st.controller;
    }
    /* Keep the click's permission to speak while the page is prepared. Some
       browsers only allow speech that begins while the user gesture is fresh. */
    if (NARRATION_SUPPORTED) {
      try {
        const prime = new window.SpeechSynthesisUtterance(' ');
        prime.volume = 0;
        window.speechSynthesis.speak(prime);
      } catch (e) {}
    }
    return bookPrepareNarration(root, { autoPlay: true });
  }
  if (action === 'pause') {
    if (st.controller) st.controller.pause();
    bookNarratorSync(root);
    return st.controller;
  }
  if (action === 'stop') {
    if (st.controller) st.controller.stop();
    bookNarratorStatus(root, 'Stopped');
    bookNarratorSync(root);
    return st.controller;
  }
  return null;
}

function bookRootOf(el) { return el && el.closest ? el.closest('.book-reader') : null; }
function bookGo(root, delta) {
  if (!root) return 1;
  const min = Math.max(1, Number(root.dataset.bookMin || 1));
  const hardMax = Number(root.dataset.bookMax || 0);
  const total = hardMax || Number(root.dataset.total || 0);
  let page = Number(root.dataset.page || min) + Number(delta || 0);
  if (page < min) page = min;
  if (total && page > total) page = total;
  const changed = String(root.dataset.bookRendered || '') !== String(page);
  root.dataset.page = page;
  const no = root.querySelector('[data-book-page]');
  if (no) no.textContent = String(page);
  /* A fresh frame per page is the only reliable way to move the browser's PDF
     viewer: editing just the #page= fragment of a loaded frame is ignored. */
  if (changed) {
    root.dataset.bookRendered = String(page);
    bookScrollTo(root, 0);                 /* every leaf opens at its head */
    const frame = bookFrameHtml(root.dataset.book, page, root.dataset.bookTitle);
    const wrap = root.querySelector('.book-frame-wrap');
    if (wrap && 'innerHTML' in wrap) {
      wrap.innerHTML = frame;
    } else {
      const old = root.querySelector('iframe');
      if (old && old.parentNode && old.parentNode.insertAdjacentHTML) {
        old.parentNode.insertAdjacentHTML('beforebegin', frame);
        if (old.remove) old.remove();
      } else if (old) {
        old.setAttribute('src', pdfSrc(root.dataset.book, page));
      }
    }
  }
  /* a rebuilt frame is a new sheet: keep it fitted to the space */
  bookFit(root);
  /* Narration belongs to the page that is open now: a turn stops the old page
     and prepares the new one, never reading pages the learner cannot see. */
  if (changed && root.dataset.bookNarrate === '1') {
    stopBookNarration(root, true);
    bookPrepareNarration(root);
  }
  /* a small page-turn flick so it reads like a book */
  const sheet = root.querySelector('.book-page');
  if (sheet && sheet.classList && delta) {
    sheet.classList.remove('turning');
    void (sheet.offsetWidth || 0);
    sheet.classList.add('turning');
  }
  root.querySelectorAll('[data-book-turn="-1"]').forEach(function (b) { b.disabled = page <= min; });
  root.querySelectorAll('[data-book-turn="1"]').forEach(function (b) {
    b.disabled = !!total && page >= total;
  });
  return page;
}
function bookCount(root) {
  if (!root || root.dataset.counted === '1') return;
  root.dataset.counted = '1';
  /* a chapter-scoped reader is already limited to its own pages */
  if (root.dataset.bookMax) return;
  pdfPageCount(root.dataset.book).then(function (n) {
    if (!n) return;
    root.dataset.total = n;
    const t = root.querySelector('[data-book-total]');
    if (t) t.textContent = ' of ' + n;
    bookGo(root, 0);
  });
}
function bookActivate(root) {
  if (!root) return;
  document.querySelectorAll('.book-reader.book-active').forEach(function (r) {
    if (r !== root) r.classList.remove('book-active');
  });
  root.classList.add('book-active');
}
/* Delegated, so readers rendered later (library, books, chapters) all work. */
let wheelAcc = 0, wheelLock = 0, touchX = null, touchY = null;
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    /* a closed book opens only here — on the click */
    const cover = t.closest('.book-open-card');
    if (cover && !t.closest('a')) {
      e.preventDefault();
      const url = cover.getAttribute('data-book-url') || cover.dataset.bookUrl;
      const title = cover.getAttribute('data-book-title') || cover.dataset.bookTitle || 'Book';
      const from = cover.getAttribute('data-book-from') || '';
      const to = cover.getAttribute('data-book-to') || '';
      const holder = cover.parentNode;
      if (url && holder && cover.insertAdjacentHTML) {
        cover.insertAdjacentHTML('beforebegin', bookReaderHtml(url, { title: title, from: from, to: to }));
        if (cover.remove) cover.remove(); else if (holder.removeChild) holder.removeChild(cover);
        bookFitAll();
        const fresh = holder ? holder.querySelector('.book-reader') : null;
        if (fresh) bookEnsureFit(fresh);
      }
      return;
    }
    /* Read-aloud buttons under the PDF: play/pause/stop the open page only */
    const narrateBtn = t.closest('[data-book-narrator] [data-narrate]');
    if (narrateBtn) {
      const root = bookRootOf(narrateBtn);
      if (root) {
        e.preventDefault();
        bookActivate(root);
        bookNarrateAction(root, narrateBtn.getAttribute('data-narrate'));
      }
      return;
    }
    const turn = t.closest('[data-book-turn]');
    if (turn) {
      const root = bookRootOf(turn);
      if (root) {
        e.preventDefault();
        bookActivate(root);
        bookGo(root, turn.getAttribute('data-book-turn'));
      }
      return;
    }
    const full = t.closest('[data-book-full]');
    if (full) {
      const root = bookRootOf(full);
      if (root) {
        const on = root.classList.toggle('book-full');
        full.textContent = on ? 'Close full page' : 'Full page';
        bookEnsureFit(root);          /* full page: the whole sheet may grow */
        if (root.dataset.bookNarrate === '1') {
          stopBookNarration(root, true);
          bookPrepareNarration(root);
        }
      }
      return;
    }
    /* Close: shut the book (and leave a cover the learner can reopen) */
    const closer = t.closest('[data-book-close]');
    if (closer) {
      const root = bookRootOf(closer);
      if (root) {
        e.preventDefault();
        stopBookNarration(root);
        root.classList.remove('book-full');
        const holder = root.parentNode;
        if (root.dataset.bookBack === '1' && holder && root.insertAdjacentHTML) {
          root.insertAdjacentHTML('beforebegin', bookCoverHtml(root.dataset.book, {
            title: root.dataset.bookTitle || 'Book',
            from: root.dataset.bookMin,
            to: root.dataset.bookMax || '',
            button: 'Open chapter pages',
            note: 'Reopen this chapter’s pages.'
          }));
        }
        if (root.remove) root.remove();
        else if (holder && holder.removeChild) holder.removeChild(root);
      }
      return;
    }
  });
  document.addEventListener('load', function (e) {
    const f = e.target;
    if (f && f.tagName === 'IFRAME' && String(f.className || '').indexOf('pdf-frame') !== -1) {
      const root = bookRootOf(f);
      bookCount(root);
      bookEnsureFit(root);            /* the page's own shape as soon as it loads */
    }
  }, true);
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('resize', bookFitAll);
  }
  document.addEventListener('wheel', function (e) {
    const shield = e.target && e.target.closest ? e.target.closest('[data-book-shield]') : null;
    if (!shield) return;
    const root = bookRootOf(shield);
    if (!root) return;
    e.preventDefault();                      /* the page never scrolls away */
    const step = (e.deltaY || 0) + (e.deltaX || 0);
    if (!step) return;
    const max = Number(root.dataset.bookScrollMax || 0) || 0;
    const here = Number(root.dataset.bookScroll || 0) || 0;
    /* inside a tall page the wheel reads down (or back up) the page itself … */
    if (max > 0 && ((step > 0 && here < max) || (step < 0 && here > 0))) {
      wheelAcc = 0;                          /* reading the page, not turning */
      bookScrollTo(root, here + step);
      return;
    }
    /* … and only at the page's own end does a deliberate flick turn the leaf */
    const now = Date.now();
    const cool = Number(root.dataset.bookCooldown || 220);
    if (now - wheelLock < cool) return;
    wheelAcc += step;
    if (Math.abs(wheelAcc) > 40) {
      wheelAcc = 0;
      wheelLock = now;
      bookActivate(root);
      bookGo(root, step > 0 ? 1 : -1);
    }
  }, { passive: false });
  document.addEventListener('touchstart', function (e) {
    const shield = e.target && e.target.closest ? e.target.closest('[data-book-shield]') : null;
    if (!shield) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    touchX = t.clientX; touchY = t.clientY;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (touchX == null) return;
    const t = e.changedTouches && e.changedTouches[0];
    const dx = t ? t.clientX - touchX : 0;
    const dy = t ? t.clientY - touchY : 0;
    touchX = null; touchY = null;
    if (Math.abs(dy) >= 40 && Math.abs(dy) > Math.abs(dx)) {
      /* a vertical drag reads down (or back up) a tall page … */
      const rootV = bookRootOf(document.querySelector('[data-book-shield]'));
      if (rootV) {
        const max = Number(rootV.dataset.bookScrollMax || 0) || 0;
        if (max > 0) bookScrollTo(rootV, (Number(rootV.dataset.bookScroll || 0) || 0) - dy);
      }
      return;
    }
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    /* … while a horizontal swipe turns the leaf */
    const root = bookRootOf(document.querySelector('[data-book-shield]'));
    if (!root) return;
    bookActivate(root);
    bookGo(root, dx < 0 ? 1 : -1);
  }, { passive: true });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const tag = String((e.target && e.target.tagName) || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const root = document.querySelector('.book-reader.book-active') ||
      document.querySelector('.book-reader');
    if (!root) return;
    e.preventDefault();
    bookGo(root, e.key === 'ArrowRight' ? 1 : -1);
  });
}

/* ================================================ stale server notice ===== */
/* When the page is newer than the running server ("Unknown endpoint" …), say so
   clearly instead of a grey error: the backend needs a restart to load the new
   routes (PHP keeps compiled files until PHP-FPM/Apache restarts). */
function isStaleServerError(err) {
  const t = typeof err === 'string' ? err : (err && err.message) || '';
  return /Unknown endpoint/i.test(t);
}
function staleServerHtml(build, missing) {
  return '<div class="card" style="border-left:5px solid #c62828;background:#fdeeee">' +
    '<b>This page is newer than the server that answered it.</b>' +
    '<p class="muted small" style="margin:6px 0 0">Running build: <b>' + esc(build || 'unknown') + '</b>' +
    (missing && missing.length ? ' — missing: <b>' + esc(missing.join(', ')) + '</b>' : '') +
    '. Restart the backend so the new routes load (Apache/PHP-FPM, or the Node process), then reload this page. ' +
    'See <a href="/api/health" target="_blank" rel="noopener">/api/health</a> for the live build.</p></div>';
}
/* What build is the server running? (null when there is no /api/health yet) */
async function serverBuild() {
  try { return await API.get('/health'); } catch (e) { return null; }
}
/* Raw look at /api/health, so the notice can tell "an older copy of the app is
   answering" (its own JSON "Unknown endpoint", routes built earlier) apart from
   "the request never reached the app" (the web server answered an HTML page —
   that is .htaccess / document root, not a stale process). */
async function probeHealth() {
  const out = { status: 0, json: false, html: false, body: '', payload: null };
  try {
    const res = await fetch('/api/health?t=' + Date.now(), { cache: 'no-store' });
    out.status = res.status;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const text = await res.text();
    out.body = text.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (/text\/html/.test(ct) || /^<(!doctype|html|head|body)/i.test(out.body)) {
      out.html = true;
    } else {
      try { const j = JSON.parse(text); out.json = true; out.payload = j; } catch (e) { /* not JSON */ }
    }
  } catch (e) { out.body = String((e && e.message) || e); }
  return out;
}
/* Compare the deployed FILES with the running BACKEND — they are updated by
   different steps (a pull updates the files; a restart loads the backend), so a
   mismatch points at the missing step. */
async function deploymentInfo() {
  const info = { files: null, server: null, health: null };
  try {
    const res = await fetch('/build.json?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) info.files = await res.json();
  } catch (e) { /* no build.json: very old deployment */ }
  info.health = await probeHealth();
  info.server = info.health.payload && info.health.payload.build ? info.health.payload : null;
  return info;
}
function deploymentNoticeHtml(info) {
  const files = (info && info.files) || null;
  const server = (info && info.server) || null;
  const health = (info && info.health) || {};
  const fileBuild = files && files.build ? files.build : null;
  const serverBuild = server && server.build ? server.build : null;
  let verdict;
  if (!serverBuild && health.html) {
    verdict = 'The request never reached the app — the web server itself answered with an HTML page ' +
      '(status ' + esc(String(health.status || '?')) + '), so no restart will help. The <b>document root</b> ' +
      'must be the project folder (not <code>public/</code>) and its <code>.htaccess</code> must be allowed: ' +
      '<code>AllowOverride All</code> + <code>mod_rewrite</code>. Test ' +
      '<a href="/php/api.php?r=/health" target="_blank" rel="noopener">/php/api.php?r=/health</a> — if THAT ' +
      'answers JSON, only the rewrite is missing.';
  } else if (!serverBuild && health.json) {
    verdict = 'An older copy of the app answered from its own route table (' + esc(health.body) + '), so ' +
      'the <b>backend process</b> is still old while the files are current. It must be restarted — a Node ' +
      'process builds its routes at boot, PHP keeps them in OPcache. PHP hosts can flush that without ' +
      'finding the service: open <a href="/cache-clear.php" target="_blank" rel="noopener">/cache-clear.php</a>.';
  } else if (!serverBuild && fileBuild) {
    verdict = 'The <b>files</b> on the server are current (' + esc(fileBuild) + ') but the <b>backend process</b> ' +
      'is still old (even /api/health is missing). <b>Restart the backend</b> — Apache/PHP-FPM, or the Node process — ' +
      'then reload. PHP hosts: <a href="/cache-clear.php" target="_blank" rel="noopener">/cache-clear.php</a> ' +
      'flushes OPcache without a restart.';
  } else if (!serverBuild && !fileBuild) {
    verdict = 'Neither /api/health nor /build.json answered, so the folder being served is not the one you ' +
      'pulled. Check the <b>document root</b>, then <code>git pull</code> there and restart the backend.';
  } else if (serverBuild && fileBuild && serverBuild !== fileBuild) {
    verdict = 'The backend runs <b>' + esc(serverBuild) + '</b> while the files are <b>' + esc(fileBuild) +
      '</b> — restart the backend so it loads the same build.';
  } else {
    verdict = 'The backend runs <b>' + esc(serverBuild || 'unknown') + '</b> but is missing a feature this page ' +
      'uses. Restart the backend, then reload.';
  }
  return '<div class="card" style="border-left:5px solid #c62828;background:#fdeeee">' +
    '<b>This page is newer than the server that answered it.</b>' +
    '<p class="small" style="margin:6px 0 0">' +
      'Files on the server: <b>' + esc(fileBuild || 'not found (/build.json)') + '</b> · ' +
      'backend build: <b>' + esc(serverBuild || 'not found (/api/health)') + '</b></p>' +
    (health.status || health.body
      ? '<p class="small" style="margin:6px 0 0">/api/health replied <b>' +
        esc(String(health.status || 'no answer')) + '</b>' +
        (health.body ? ' — <code>' + esc(health.body) + '</code>' : '') + '</p>'
      : '') +
    '<p class="small" style="margin:6px 0 0">' + verdict + '</p>' +
    '<p class="small" style="margin:8px 0 0">On the server, in the folder the domain serves:</p>' +
    '<pre class="small" style="background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px;' +
      'overflow:auto">bash tools/which-backend.sh          # which process answers, and how to restart it\n' +
      'sudo bash tools/restart-backend.sh --yes  # restarts just that process\n' +
      'git pull && git log --oneline -1\n' +
      'grep -n "api/health" php/api.php          # present in the new build\n' +
      'curl -s localhost/api/health              # JSON? then only the process is old\n' +
      '# manual: node (pm2 restart) | php-X.Y-fpm | apache2 | httpd | nginx\n' +
      '#   php -S dev server: kill the pid and start the same command again</pre>' +
    '<p class="small" style="margin:6px 0 0">Then check ' +
      '<a href="/api/health" target="_blank" rel="noopener">/api/health</a> and ' +
      '<a href="/build.json" target="_blank" rel="noopener">/build.json</a> — both should show the same build.</p>' +
  '</div>';
}
/* Warn (once) when the server build lacks a feature this page needs. */
async function warnIfStaleServer(feature, label) {
  const info = await deploymentInfo();
  const server = info.server;
  const feats = (server && server.features) || [];
  const stale = !server || !server.build || (feature && feats.indexOf(feature) === -1);
  if (stale) {
    const el = document.getElementById('staleBuild');
    if (el) {
      el.classList.remove('hidden');
      el.innerHTML = deploymentNoticeHtml(info);
    } else if (typeof toast === 'function') {
      toast('Server build ' + ((server && server.build) || 'unknown') +
        ' is older than this page — restart the backend (' + label + ')', 'err');
    }
  }
  return info;
}

function blobDownload(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
function tableToCsv(table) {
  const rows = [];
  table.querySelectorAll('tbody tr').forEach(function (tr) {
    const cells = [];
    tr.querySelectorAll('th, td').forEach(function (td) {
      let v = td.textContent.replace(/\r\n/g, ' ').replace(/\n/g, ' ');
      v = v.replace(/"/g, '""');
      cells.push('"' + v + '"');
    });
    rows.push(cells.join(','));
  });
  return rows.join('\r\n');
}
const reportPrintCss = [
  '.no-print, .export-buttons { display: none !important; }',
  '@media print {',
  '  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #222; margin: 1.2cm; }',
  '  .no-print, .export-buttons { display: none !important; }',
  '  .card { border: 1px solid #d0d7de; border-radius: 8px; padding: 14px 16px; margin: 10px 0; background: #fff; }',
  '  table { border-collapse: collapse; width: 100%; margin: 6px 0; }',
  '  th, td { border: 1px solid #c8d6e5; padding: 6px 8px; font-size: 13px; color: #333; }',
  '  th { background: #eef2f7; color: #1f3a5f; font-weight: 600; text-align: left; }',
  '  tr:nth-child(even) td { background: #fafafa; }',
  '  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }',
  '  .badge.ok { background: #e6f4ea; color: #1a7f37; }',
  '  .badge.warn { background: #fef3c7; color: #92400e; }',
  '  .badge.info { background: #dbeafe; color: #1d4ed8; }',
  '  .badge.off { background: #fee2e2; color: #b91c1c; }',
  '  .badge.lock { background: #e5e7eb; color: #6b7280; }',
  '  .muted { color: #6b7280; }',
  '  .small { font-size: 12px; }',
  '  .exp { display: none; }',
  '  .exp[open] { display: block; }',
  '  .mono { font-family: ui-monospace, SFMono-Regular, monospace; }',
  '  .cert-sheet { border: 1px solid #d0d7de; border-radius: 8px; padding: 24px; text-align: center; }',
  '  .cert-logos { display: flex; justify-content: center; gap: 12px; margin-bottom: 12px; }',
  '  .cert-logos img { max-width: 120px; height: auto; }',
  '  .name { font-size: 22px; font-weight: 700; }',
  '  .books { margin: 10px 0; text-align: left; }',
  '  .books ul { margin: 6px 0 0 22px; padding: 0; }',
  '  .books li { margin: 2px 0; }',
  '  .foot { margin-top: 14px; font-size: 12px; color: #6b7280; }',
  '  .module-card { border: 1px solid #d0d7de; border-radius: 10px; padding: 16px; text-align: center; background: #fff; }',
  '  .module-card .badge { margin-top: 6px; }',
  '  .cert-page { page-break-after: always; }',
  '  .cert-page:last-child { page-break-after: auto; }',
  '  .export-buttons { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }',
  '  .export-buttons button { padding: 5px 10px; font-size: 12px; border-radius: 6px; border: 1px solid #d0d7de; background: #fff; cursor: pointer; }',
  '  .export-buttons button.ghost { border-color: #24508c; color: #24508c; }',
  '  .export-buttons button.ghost:hover { background: #f6f8fb; }',
  '  .report-hint { font-size: 11px; color: #6b7280; margin-top: 4px; }',
  '}',
  'body { font-family: "Helvetica Neue", Arial, sans-serif; color: #222; }',
  'h1, h2, h3, h4 { margin: 0 0 6px 0; }',
  'p { margin: 4px 0; }',
  '.exp summary { cursor: pointer; }',
  '.exp { display: none; }',
  '.exp[open] { display: block; }',
  'input, select, textarea, button { font: inherit; }',
  '',
].join('\n');
function exportReport(type, title, source) {
  const isPrint = type === 'print';
  const isPdf = type === 'pdf';
  const isWord = type === 'word';
  const isExcel = type === 'excel';
  if (isPrint || isPdf) {
    const win = window.open('', '_blank', 'scrollbars=yes,width=800,height=600');
    if (!win) { toast('Allow pop-ups so you can print/export reports.', 'err'); return; }
    const d = win.document;
    d.open();
    d.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>');
    d.write('<style>' + reportPrintCss + '</style></head><body>');
    d.write(escapeHtml(source.nodeType === 1 ? (source.outerHTML || source.innerHTML) : source));
    d.write('<p class="muted small">Generated ' + esc(fmtDate(new Date().toISOString())) + '</p>');
    d.write('</body></html>');
    d.close();
    win.focus();
    win.print();
    return;
  }
  let html = '';
  let csv = '';
  if (source.nodeType === 1) {
    const table = source.tagName === 'TABLE' ? source : source.querySelector('table');
    if (table) csv = tableToCsv(table);
    html = source.outerHTML || source.innerHTML;
  } else {
    html = source;
  }
  const base = (title || 'report').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  if (isExcel) {
    blobDownload(base + '.csv', csv, 'text/csv;charset=utf-8');
    toast('Exported as Excel (.csv)', 'ok');
  } else if (isWord) {
    const doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<style>' + reportPrintCss + '</style></head><body>' + escapeHtml(html) +
      '<p class="muted small">Generated ' + esc(fmtDate(new Date().toISOString())) + '</p></body></html>';
    blobDownload(base + '.doc', doc, 'application/msword');
    toast('Exported as Word (.doc)', 'ok');
  }
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
/* click handler for report export buttons (data-export / data-target) */
document.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-export]');
  if (!btn) return;
  const t = btn.dataset.export;
  let source = null;
  let title = btn.dataset.title || '';
  const row = btn.closest('[data-target]');
  if (row && row.dataset.target) {
    try { source = document.querySelector(row.dataset.target); } catch (err) { source = null; }
  }
  if (!source) {
    const card = btn.closest('.card');
    if (card) source = card.querySelector('.table-wrap') || card.querySelector('table') || card;
  }
  if (!source) source = document.querySelector('.modal .cert-sheet') || document.querySelector('.cert-sheet');
  if (!source) return;
  if (!title) {
    const head = source.querySelector ? (source.querySelector('h3') || null) : null;
    const card = source.closest ? source.closest('.card') : null;
    const cardHead = card ? card.querySelector('h3') : null;
    title = (head || cardHead) ? (head || cardHead).textContent.trim() : 'Report';
  }
  exportReport(t, title, source);
});


/* =================================================== tenant account theme == */
function themeIsHex(color) {
  return /^#[0-9a-f]{6}$/i.test(String(color == null ? '' : color).trim());
}
function themeShade(hex, amt) {
  if (!themeIsHex(hex)) return hex;
  const n = parseInt(String(hex).replace('#', ''), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = function (v) {
    return amt < 0 ? Math.round(v * (1 + amt)) : Math.round(v + (255 - v) * amt);
  };
  r = Math.max(0, Math.min(255, f(r)));
  g = Math.max(0, Math.min(255, f(g)));
  b = Math.max(0, Math.min(255, f(b)));
  return '#' + [r, g, b].map(function (v) {
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}
/* Repaint the whole account layout with the tenant's colour (buttons, nav,
   headers, links...). Called on boot by the admin console, login page and
   participant app so a school account always matches its own colour. */
/* Inline-SVG monogram used as an account's faint mark when it has no logo yet
   (first letters of the account name, drawn in the account colour). */
function portalMarkSrc(name, colour) {
  const initials = String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
  const fill = themeIsHex(colour) ? colour : '#24508c';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
    '<text x="100" y="142" font-family="Segoe UI, Arial, sans-serif" font-size="120" font-weight="700"' +
    ' text-anchor="middle" fill="' + fill + '">' + initials + '</text></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function applyThemeColor(color) {
  const root = document.documentElement;
  if (!themeIsHex(color)) {
    root.style.removeProperty('--brand');
    root.style.removeProperty('--brand-2');
    root.style.removeProperty('--brand-soft');
    root.style.removeProperty('--brand-tint');
    return false;
  }
  const c = String(color).trim();
  root.style.setProperty('--brand', c);
  root.style.setProperty('--brand-2', themeShade(c, -0.3));
  root.style.setProperty('--brand-soft', themeShade(c, 0.84));
  root.style.setProperty('--brand-tint', themeShade(c, 0.94));
  return true;
}

function initCommunicationWidget() {
  if (!API.token() || document.getElementById('cbpCommsToggle')) return;
  const root = document.createElement('div');
  root.id = 'cbpComms';
  root.innerHTML = '<button type="button" id="cbpCommsToggle" class="cbp-comms-toggle" aria-expanded="false" aria-controls="cbpCommsPanel">' +
      'Messages <span id="cbpCommsCount" class="cbp-comms-count hidden"></span></button>' +
    '<section id="cbpCommsPanel" class="cbp-comms-panel hidden" aria-label="Messages and alerts"></section>';
  document.body.appendChild(root);
  const toggle = document.getElementById('cbpCommsToggle');
  const panel = document.getElementById('cbpCommsPanel');
  const count = document.getElementById('cbpCommsCount');
  const state = { screen: 'alerts', conversations: [], recipients: [], notifications: [], activeId: null };

  async function load() {
    const result = await Promise.all([API.get('/messages'), API.get('/notifications')]);
    state.conversations = result[0].conversations || [];
    state.recipients = result[0].recipients || [];
    state.notifications = result[1].notifications || [];
    const unread = state.notifications.filter(function (n) {
      return !n.readAt && n.type !== 'message';
    }).length + state.conversations.reduce(function (n, c) { return n + Number(c.unread || 0); }, 0);
    count.textContent = unread > 99 ? '99+' : String(unread);
    count.classList.toggle('hidden', unread === 0);
    return unread;
  }

  function header(title) {
    return '<div class="cbp-comms-head"><b>' + esc(title) + '</b>' +
      '<button type="button" class="ghost small" data-comms-close aria-label="Close messages">Close</button></div>';
  }

  function tabs() {
    return '<nav class="cbp-comms-tabs">' +
      '<button type="button" data-comms-screen="alerts">Alerts</button>' +
      '<button type="button" data-comms-screen="inbox">Inbox</button>' +
      '<button type="button" data-comms-screen="compose">New message</button></nav>';
  }

  function draw() {
    const active = state.activeId && state.conversations.find(function (c) { return c.id === state.activeId; });
    if (state.screen === 'thread' && active) {
      panel.innerHTML = header(active.participant.fullName) +
        '<div class="cbp-comms-toolbar"><button type="button" class="ghost small" data-comms-screen="inbox">Back to inbox</button></div>' +
        '<div id="cbpCommsMessages" class="cbp-comms-messages"><p class="muted">Loading conversation…</p></div>' +
        '<form id="cbpCommsReply" class="cbp-comms-form"><textarea name="body" maxlength="5000" required placeholder="Write a reply…"></textarea>' +
        '<button type="submit">Send reply</button></form>';
      loadThread(active.id);
      return;
    }
    if (state.screen === 'compose') {
      panel.innerHTML = header('New message') + tabs() +
        '<form id="cbpCommsCompose" class="cbp-comms-form"><label for="cbpCommsRecipients">To (select more than one to send in bulk)</label>' +
        '<select id="cbpCommsRecipients" name="recipientIds" multiple size="5" required>' +
        state.recipients.map(function (r) {
          return '<option value="' + esc(r.id) + '">' + esc(r.fullName) + ' (' + esc(r.role.replace(/_/g, ' ')) + ')</option>';
        }).join('') + '</select><textarea name="body" maxlength="5000" required placeholder="Write a message…"></textarea>' +
        '<button type="submit">Send message</button></form>';
      return;
    }
    const isInbox = state.screen === 'inbox';
    panel.innerHTML = header(isInbox ? 'Inbox' : 'Alerts') + tabs() +
      (isInbox ? renderConversations() : renderNotifications());
  }

  function renderConversations() {
    if (!state.conversations.length) return '<p class="muted cbp-comms-empty">No conversations yet.</p>';
    return '<div class="cbp-comms-list">' + state.conversations.map(function (c) {
      const latest = c.latestMessage;
      return '<button type="button" class="cbp-comms-item" data-comms-thread="' + esc(c.id) + '">' +
        '<b>' + esc(c.participant.fullName) + '</b><span>' + esc(latest ? latest.body : 'No messages yet') + '</span>' +
        '<small>' + esc(latest ? fmtDate(latest.createdAt) : '') + '</small>' +
        (c.unread ? '<i>' + esc(c.unread) + ' unread</i>' : '') + '</button>';
    }).join('') + '</div>';
  }

  function renderNotifications() {
    if (!state.notifications.length) return '<p class="muted cbp-comms-empty">No alerts yet.</p>';
    return '<div class="cbp-comms-list">' + state.notifications.map(function (n) {
      return '<button type="button" class="cbp-comms-item' + (n.readAt ? '' : ' unread') +
        '" data-comms-notification="' + esc(n.id) + '">' +
        '<b>' + esc(n.title) + '</b><span>' + esc(n.body) + '</span>' +
        '<small>' + esc(fmtDate(n.createdAt)) + '</small>' +
        /* a video alert carries a library video the learner can play from here */
        (n.libraryId ? '<i class="cbp-comms-play">\u25B6 Play video</i>' : '') +
        '</button>';
    }).join('') + '</div>';
  }

  async function loadThread(id) {
    try {
      const result = await API.get('/messages/' + encodeURIComponent(id));
      const box = document.getElementById('cbpCommsMessages');
      if (!box || state.activeId !== id) return;
      box.innerHTML = (result.messages || []).map(function (m) {
        const mine = m.senderId === (API.user() || {}).id;
        return '<div class="cbp-comms-message' + (mine ? ' mine' : '') + '">' +
          '<p>' + esc(m.body) + '</p><small>' + esc(fmtDate(m.createdAt)) + '</small></div>';
      }).join('') || '<p class="muted">No messages yet.</p>';
      box.scrollTop = box.scrollHeight;
      await load();
    } catch (e) {
      const box = document.getElementById('cbpCommsMessages');
      if (box) box.innerHTML = '<p class="err-text">' + esc(e.message) + '</p>';
    }
  }

  toggle.addEventListener('click', async function () {
    const open = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      try { await load(); state.screen = 'alerts'; state.activeId = null; draw(); }
      catch (e) { panel.innerHTML = header('Messages') + '<p class="err-text">' + esc(e.message) + '</p>'; }
    }
  });
  panel.addEventListener('click', async function (event) {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.hasAttribute('data-comms-close')) {
      panel.classList.add('hidden'); toggle.setAttribute('aria-expanded', 'false'); return;
    }
    if (target.dataset.commsScreen) {
      state.screen = target.dataset.commsScreen; state.activeId = null; draw(); return;
    }
    if (target.dataset.commsThread) {
      state.activeId = target.dataset.commsThread; state.screen = 'thread'; draw(); return;
    }
    if (target.dataset.commsNotification) {
      const notification = state.notifications.find(function (n) { return n.id === target.dataset.commsNotification; });
      if (!notification) return;
      try {
        await API.put('/notifications/' + encodeURIComponent(notification.id) + '/read');
        if (notification.libraryId) {
          /* a video alert: play it here when this page can, otherwise open it in
             a new tab so the link always works */
          const played = typeof window.cbpOpenVideoAlert === 'function' &&
            window.cbpOpenVideoAlert(notification.libraryId, notification.videoUrl || null);
          if (!played && notification.videoUrl) window.open(notification.videoUrl, '_blank', 'noopener');
          await load(); draw();
        } else if (notification.conversationId) {
          await load();
          state.activeId = notification.conversationId; state.screen = 'thread'; draw();
        } else if (notification.studentId) {
          panel.classList.add('hidden'); toggle.setAttribute('aria-expanded', 'false');
          window.dispatchEvent(new CustomEvent('cbp:open-student', { detail: { studentId: notification.studentId } }));
        } else {
          await load(); draw();
        }
      } catch (e) { toast(e.message, 'err'); }
    }
  });
  panel.addEventListener('submit', async function (event) {
    event.preventDefault();
    const form = event.target;
    const text = String(new FormData(form).get('body') || '').trim();
    if (!text) return;
    try {
      if (form.id === 'cbpCommsCompose') {
        const select = form.querySelector('[name="recipientIds"]');
        const recipientIds = Array.from(select.selectedOptions).map(function (option) { return option.value; });
        await API.post('/messages', { recipientIds, body: text });
        toast('Message sent.', 'ok');
        state.screen = 'inbox'; state.activeId = null;
      } else if (form.id === 'cbpCommsReply' && state.activeId) {
        await API.post('/messages/' + encodeURIComponent(state.activeId), { body: text });
      }
      await load();
      draw();
    } catch (e) { toast(e.message, 'err'); }
  });
  load().catch(function (e) { console.error('[messages] Failed to load unread counts:', e); });
  window.setInterval(function () {
    if (!document.hidden) load().catch(function (e) { console.error('[messages] Failed to refresh unread counts:', e); });
  }, 30000);
}

/* ================================================ best-performer ribbon ==== */
/* One belt for every page that shows it: the students page, the student progress
   page and the learner's own dashboard. It carries the best 50 learners of the
   account — faces, names, marks and coverage — drifting from left to right.
   Profile photos are used when the server exposes one, otherwise initials are
   painted behind it. */
function performerInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
function ribbonChipHtml(p) {
  const rank = Number(p.rank) || 0;
  const marks = p.marks == null ? '—' : p.marks + '%';
  const coverage = p.coverage == null ? '—' : p.coverage + '%';
  const title = (p.name || 'Learner') + ' — marks ' + marks + ' · coverage ' + coverage +
    (p.className ? ' · ' + p.className : '');
  return '<div class="pp-chip rank-' + rank + '" title="' + esc(title) + '">' +
    '<span class="pp-face">' +
      '<span class="pp-initials">' + esc(performerInitials(p.name)) + '</span>' +
      (p.photo ? '<img src="' + esc(p.photo) + '" alt="">' : '') +
      '<span class="pp-rank">' + rank + '</span>' +
    '</span>' +
    '<span class="pp-who"><b>' + esc(p.displayName || p.name || 'Learner') + '</b>' +
      '<span class="pp-marks">Marks ' + esc(marks) + '</span>' +
      '<span class="pp-cover">Coverage ' + esc(coverage) + '</span></span>' +
  '</div>';
}
/* The belt shows this account's best 50 learners, so it asks the ranking for 50
   and never more. A role that may not read the ranking gets nothing back — that
   returns null, which draws no belt at all instead of an empty one. */
async function ribbonPerformers() {
  try {
    const res = await API.get('/reports/top-performers?limit=50');
    return Array.isArray(res.performers) ? res.performers : [];
  } catch (e) {
    return null;
  }
}
/* a profile photo that cannot load must never leave a broken image in a chip */
function wireRibbonPhotos(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('.pp-chip img').forEach(function (img) {
    img.onerror = function () { img.remove(); };
  });
}
function ribbonHtml(rows) {
  /* null means "this role may not read the ranking": draw nothing at all */
  if (rows == null) return '';
  rows = (rows || []).slice(0, 50).filter(function (p) { return p && p.name; });
  /* An account whose learners have no marks yet still keeps the belt on the page,
     so it can never silently disappear again: the belt says what it waits for. */
  if (!rows.length) {
    return '<div class="pp-ribbon is-empty">' +
      '<div class="pp-ribbon-head"><h3>Best performers</h3>' +
        '<span class="pp-ribbon-note">top 50 · marks + coverage</span></div>' +
      '<p class="pp-ribbon-empty">Nothing to rank yet. The best 50 learners of this account ' +
        'appear here, drifting from left to right, as soon as they score marks or cover part of ' +
        'the programme.</p></div>';
  }
  /* A long list drifts from left to right: repeat it until it fills a wide screen,
     then duplicate that block so the loop never shows a gap between the last and
     the first learner. A short list would only repeat the same few faces, so it
     stands still and wraps instead. */
  const quiet = rows.length < 4;
  const reps = quiet ? 1 : Math.min(4, Math.max(1, Math.ceil(16 / rows.length)));
  let block = '';
  for (let r = 0; r < reps; r++) block += rows.map(ribbonChipHtml).join('');
  const seconds = Math.max(18, Math.round(rows.length * reps * 2.2));
  return '<div class="pp-ribbon">' +
    '<div class="pp-ribbon-head"><h3>Best performers</h3>' +
      '<span class="pp-ribbon-note">top ' + rows.length + ' · marks + coverage</span></div>' +
    '<div class="pp-ribbon-view">' +
      '<div class="pp-ribbon-track' + (quiet ? ' is-static' : '') +
        '" style="--pp-duration:' + seconds + 's">' +
        '<div class="pp-ribbon-group">' + block + '</div>' +
        '<div class="pp-ribbon-group" aria-hidden="true">' + block + '</div>' +
      '</div></div>' +
    '<p class="pp-ribbon-foot">' + (quiet ? '' : 'Hover to pause. ') +
      'Ranked by marks scored and programme coverage, ' +
      'learners of this account only.</p></div>';
}
