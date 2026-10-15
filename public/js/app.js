/* ============================================ participant application ==== */
const S = {
  me: null, flow: null, videos: [],
  view: 'home', currentModuleId: null, currentBookId: null,
  bookData: null, finalData: null, letterDone: false
};

function $(id) { return document.getElementById(id); }

function show(view) {
  S.view = view;
  ['home', 'modules', 'book', 'library', 'certificates', 'final', 'thoughts'].forEach(function (v) {
    const el = $('view-' + v);
    if (el) el.classList.toggle('hidden', v !== view);
  });
  document.querySelectorAll('.app-side button[data-view]').forEach(function (b) {
    b.classList.toggle('active', b.dataset.view === view);
  });
  window.scrollTo(0, 0);
}

function modal(html, opts) {
  opts = opts || {};
  const root = $('modalRoot');
  root.innerHTML = '<div class="modal-bg"><div class="modal' + (opts.wide ? ' wide' : '') + '">' +
    (opts.noClose ? '' : '<button class="x" data-close>&times;</button>') +
    html + '</div></div>';
  root.classList.remove('hidden');
  const el = root.querySelector('.modal');
  root.querySelectorAll('[data-close]').forEach(function (b) {
    b.onclick = function () { closeModal(); if (opts.onClose) opts.onClose(); };
  });
  if (!opts.noClose) {
    root.querySelector('.modal-bg').addEventListener('click', function (e) {
      if (e.target === e.currentTarget && !opts.sticky) { closeModal(); if (opts.onClose) opts.onClose(); }
    });
  }
  return el;
}
function closeModal() {
  const root = $('modalRoot');
  root.innerHTML = '';
  root.classList.add('hidden');
}

function statCard(n, label, tone) {
  return '<div class="stat' + (tone ? ' tone-' + tone : '') + '"><div class="n">' + esc(n) +
    '</div><div class="l">' + esc(label) + '</div></div>';
}

async function loadFlow() {
  S.flow = await API.get('/flow');
  renderStrip();
  renderModulesNav();
  return S.flow;
}

/* pdfHtml() lives in common.js — it renders the book-style single-page reader. */


function renderStrip() {
  const f = S.flow;
  if (!f) return;
  const perf = f.performance;
  const active = f.modules.find(function (m) { return m.status === 'active'; });
  const done = f.modules.filter(function (m) { return m.status === 'completed'; }).length;
  $('dashStrip').innerHTML =
    statCard(Math.round(perf.overall) + '%', 'Overall performance', 'blue') +
    statCard(done + '/' + f.modules.length, 'Modules completed', 'teal') +
    statCard(f.allDone ? '100%' : (active ? active.percent + '%' : '—'), f.allDone ? 'Program finished' : 'Active module', 'violet') +
    statCard(perf.certificates, 'Certificates', 'green') +
    statCard(perf.flagged, 'Copy flags', 'red');
}

function renderModulesNav() {
  const f = S.flow;
  const homeBtns = document.querySelectorAll('.app-side button[data-view="home"], .app-side button[data-view="modules"]');
  homeBtns.forEach(function (b) { b.classList.remove('hidden'); });
  $('finalBtn').classList.toggle('hidden', !(f && f.allDone));
}

/* --------------------------------------------------------- video menu --- */
async function loadVideos() {
  try {
    const data = await API.get('/videos');
    S.videos = data.videos;
    const box = $('videoMenu');
    if (!data.videos.length) {
      box.innerHTML = '<span class="small" style="color:#8ea2c6">No videos yet</span>';
      return;
    }
    box.innerHTML = data.videos.map(function (v) {
      return '<button class="video-item ' + (v.watched ? 'watched' : '') + '" data-video="' + esc(v.id) + '">' +
        '<span class="dot"></span><span>' + esc(v.title) + '</span></button>';
    }).join('');
    box.querySelectorAll('[data-video]').forEach(function (b) {
      b.onclick = function () { playVideoById(b.dataset.video); };
    });
  } catch (e) { /* menu is non-critical */ }
}

function playVideoById(id, afterClose) {
  const v = S.videos.find(function (x) { return x.id === id; });
  if (!v || !v.url) { if (afterClose) afterClose(); return; }
  const el = modal(
    '<h3>' + esc(v.title) + '</h3>' +
    '<video class="video-frame" controls autoplay playsinline src="' + esc(v.url) + '"></video>' +
    '<p class="muted small">You can close this video at any time.</p>' +
    '<button data-close class="ghost">Close video</button>',
    { onClose: function () { markWatched(v.id); if (afterClose) afterClose(); } });
  const vid = el.querySelector('video');
  vid.addEventListener('ended', function () { markWatched(v.id); });
}
async function markWatched(id) {
  try { await API.post('/videos/' + id + '/watched'); } catch (e) {}
  loadVideos();
}

/* --------------------------------------------------------------- boot --- */
document.querySelectorAll('.app-side button[data-view]').forEach(function (b) {
  b.onclick = function () { openView(b.dataset.view); };
});
$('logoutBtn').onclick = function () { API.logout(); };

async function openView(view) {
  show(view);
  try {
    if (view === 'home') await renderHome();
    else if (view === 'modules') await renderModules();
    else if (view === 'library') await renderLibrary();
    else if (view === 'certificates') await renderCertificates();
    else if (view === 'final') await renderFinal();
    else if (view === 'thoughts') await renderThoughts();
  } catch (e) { toast(e.message, 'err'); }
}

async function boot() {
  try { S.me = await API.get('/me'); }
  catch (e) { location.href = '/'; return; }
  if (S.me.user.role === 'tenant_admin') { location.href = '/admin'; return; }
  if (S.me.user.role === 'super') { location.href = '/super'; return; }
  API.setUser(S.me.user);
  const b = S.me.branding;
  applyThemeColor(b.themeColor);
  $('sideName').textContent = b.tenantName || b.programName;
  if (b.tenantLogo) { $('sideLogo').src = b.tenantLogo; $('sideLogo').classList.remove('hidden'); }
  document.title = (b.tenantName || 'My') + ' — ' + b.programName;

  await loadVideos();
  await loadFlow();
  await renderHome();
  if (!S.flow.letterDone) startLetterFlow();
  else if (!S.me.optionalVideoSeen && S.me.letter && S.me.letter.feedbackAt) showOptionalVideo();
}

/* ------------------------------------- first login: letter + videos ----- */
function startLetterFlow() {
  const letter = S.me.letter || {};
  const video = S.me.letterVideo;
  modal(
    '<h3>' + esc(letter.title || 'The Letter from Christ') + '</h3>' +
    (video && video.url ?
      '<div id="letterVideoBox">' +
        '<video id="letterVideo" class="video-frame" controls playsinline src="' + esc(video.url) + '"></video>' +
        '<p class="muted small">You may close the video at any time — it pins itself to the corner while you read.</p>' +
        '<button id="closeLetterVideo" class="ghost">Close video (pin it to the corner)</button>' +
      '</div>' : '') +
    '<div class="letter-box mt">' + esc(letter.text || 'The letter has not been configured yet.') + '</div>' +
    '<label>Your feedback on the letter <b>(required before continuing)</b></label>' +
    '<textarea id="letterFeedback" placeholder="Write at least 20 characters about what the letter meant to you..."></textarea>' +
    '<div class="mt"><button id="submitLetter">Submit feedback &amp; continue</button></div>',
    { sticky: true, noClose: true });

  const closeVid = document.getElementById('closeLetterVideo');
  if (closeVid) {
    closeVid.onclick = function () {
      document.getElementById('letterVideoBox').classList.add('hidden');
      const src = video.url;
      $('pinnedPlayer').src = src;
      $('pinnedVideo').classList.remove('hidden');
      toast('Video pinned to the corner — read the letter and submit your feedback.');
    };
  }
  document.getElementById('submitLetter').onclick = async function () {
    try {
      await API.post('/flow/letter-feedback', { feedback: document.getElementById('letterFeedback').value });
      S.me = await API.get('/me');
      API.setUser(S.me.user);
      await loadFlow();
      closeModal();
      $('pinnedVideo').classList.add('hidden');
      toast('Feedback submitted — thank you.', 'ok');
      showOptionalVideo();
    } catch (e) { toast(e.message, 'err'); }
  };
}

$('pinClose').onclick = function () { $('pinnedVideo').classList.add('hidden'); };
$('pinExpand').onclick = function () {
  const src = $('pinnedPlayer').src;
  $('pinnedVideo').classList.add('hidden');
  modal('<video class="video-frame" controls autoplay src="' + esc(src) + '"></video>' +
    '<button data-close class="ghost mt">Close</button>',
    { onClose: function () { $('pinnedPlayer').src = src; $('pinnedVideo').classList.remove('hidden'); } });
};

function showOptionalVideo() {
  const letterVideoId = S.me.letterVideo ? S.me.letterVideo.id : null;
  const alt = S.videos.find(function (v) { return v.id !== letterVideoId && v.url; }) ||
              S.videos.find(function (v) { return v.url; });
  if (!alt) {
    API.post('/flow/optional-video-seen').then(function () { S.me.optionalVideoSeen = true; }).catch(function () {});
    return;
  }
  modal('<h3>' + esc(alt.title) + '</h3>' +
    '<p class="muted">This video is <b>optional</b> — you may close it and continue.</p>' +
    '<video class="video-frame" controls playsinline src="' + esc(alt.url) + '"></video>' +
    '<div class="mt"><button data-close class="ghost">Close and continue</button></div>',
    { onClose: function () {
      API.post('/flow/optional-video-seen').then(function () { S.me.optionalVideoSeen = true; }).catch(function () {});
      markWatched(alt.id);
      renderHome();
    } });
}

/* ------------------------------------------------------------ dashboard -- */
const TYPE_LABELS = {
  chapter_summary: 'Chapter summary', objectives: 'Chapter objectives',
  letter_summary: 'Letter summary', book_summary: 'Book summary',
  best_book: 'Best book choice', general_summary: 'General summary'
};

async function renderHome() {
  await loadFlow();
  const f = S.flow;
  const active = f.modules.find(function (m) { return m.status === 'active'; });
  let recentHtml = '<p class="muted">No submissions yet — open your first module to begin.</p>';
  let recentRows = [];
  try {
    const d = await API.get('/dashboard');
    recentRows = d.recent || [];
    if (d.recent.length) {
      recentHtml = '<table><tr><th>Date &amp; time</th><th>Work</th><th>Chapter / Book</th><th>Status</th></tr>' +
        d.recent.map(function (r) {
          const status = r.flagged
            ? '<span class="flag">Copied ' + esc(r.similarity) + '%</span>'
            : (r.total ? '<span class="badge ok">' + r.score + '/' + r.total + '</span>' : '<span class="badge ok">Submitted</span>');
          return '<tr><td class="timestamp">' + fmtDate(r.createdAt) + '</td>' +
            '<td>' + esc(TYPE_LABELS[r.type] || r.type) + '</td>' +
            '<td>' + esc(r.chapter || r.book || r.label || '—') + '</td>' +
            '<td>' + status + '</td></tr>';
        }).join('') + '</table>';
    }
  } catch (e) {}

  $('view-home').innerHTML =
    '<div class="card"><h2 class="home-title"><span class="motto">Be True</span>Welcome, ' + esc(S.me.user.fullName) + '</h2>' +
      (f.allDone
        ? '<p>Every module is complete — your summaries, certificates and library are waiting in the final records.</p>' +
          '<button id="goFinal">Open final records</button>'
        : '<p class="muted">Continue with: <b>' + esc(active ? active.title : 'Getting ready…') + '</b></p>' +
          '<button id="goModules">Continue programme</button>') +
    '</div>' +
    '<div class="card"><h3>My modules</h3><div class="grid cols-3">' +
      f.modules.map(function (m) {
        return '<div class="module-card ' + (m.status === 'locked' ? 'locked' : '') + '">' +
          '<span class="badge ' + (m.status === 'completed' ? 'ok' : m.status === 'active' ? 'info' : 'lock') + '">' +
          m.status.toUpperCase() + '</span>' +
          '<h4 class="mt">' + esc(m.title) + '</h4>' +
          '<div class="progress"><i style="width:' + m.percent + '%"></i></div>' +
          '<div class="small muted">' + m.percent + '% complete</div></div>';
      }).join('') +
    '</div></div>' +
    '<div class="card"><h3>My progress</h3><div class="chart-grid">' +
      '<div class="chart-box"><h4>Module progress</h4>' +
        chartProgress(f.modules.map(function (m) {
          return { label: m.title, percent: m.percent || 0,
            color: m.status === 'completed' ? '#1f7a44' : (m.status === 'active' ? undefined : '#94a3b8') };
        })) + '</div>' +
      '<div class="chart-box"><h4>My submissions per week</h4>' +
        chartWeekly(recentRows, 8, { caption: 'Your activity over the last 8 weeks' }) + '</div>' +
    '</div></div>' +
    '<div class="card"><h3>Recent activity</h3>' + recentHtml + '</div>';

  const gm = $('goModules'); if (gm) gm.onclick = function () { openView('modules'); };
  const gf = $('goFinal'); if (gf) gf.onclick = function () { openView('final'); };
}

/* ------------------------------------------------------------- modules -- */
async function renderModules() {
  const data = await API.get('/modules');
  let certs = [];
  try { certs = (await API.get('/certificates')).certificates; } catch (e) {}
  $('view-modules').innerHTML =
    '<h2>My Modules</h2><p class="muted">Modules unlock one after the other — finish all the content of a module to open the next one.</p>' +
    '<div class="grid cols-2">' + data.modules.map(function (m) {
      const p = m.progress;
      const cert = certs.find(function (c) { return c.moduleId === m.id; });
      const badge = m.status === 'completed' ? '<span class="badge ok">COMPLETED</span>'
        : m.status === 'active' ? '<span class="badge info">ACTIVE</span>'
        : '<span class="badge lock">LOCKED</span>';
      const doneBooks = p.books.filter(function (b) { return b.complete; }).length;
      let action = '<button disabled>Locked</button>';
      if (m.status === 'completed') {
        action = cert ? '<button data-cert="' + esc(cert.id) + '">View certificate</button>'
          : '<button disabled>Completed</button>';
      } else if (m.status === 'active') {
        action = '<button data-open="' + esc(m.id) + '">' +
          (p.stage === 'best_book' ? 'Choose the best book' : p.stage === 'video' ? 'Claim your certificate' : 'Open books') +
          '</button>';
      }
      return '<div class="module-card ' + (m.status === 'locked' ? 'locked' : '') + '">' +
        '<div class="top"><h4>' + esc(m.title) + '</h4>' + badge + '</div>' +
        '<div class="progress mt"><i style="width:' + p.percent + '%"></i></div>' +
        '<div class="small muted">' + p.percent + '% complete — ' + doneBooks + '/' + p.books.length + ' books finished' +
        (p.objectiveScore != null ? ' — objectives ' + p.objectiveScore + '%' : '') + '</div>' +
        '<div class="mt">' + action + '</div></div>';
    }).join('') + '</div>';

  $('view-modules').querySelectorAll('[data-open]').forEach(function (b) {
    b.onclick = function () { openModule(b.dataset.open); };
  });
  $('view-modules').querySelectorAll('[data-cert]').forEach(function (b) {
    b.onclick = function () { showCertificate(b.dataset.cert); };
  });
}

async function openModule(moduleId) {
  S.currentModuleId = moduleId;
  const data = await API.get('/module/' + moduleId);
  if (data.status === 'locked') { toast('This module is still locked.', 'err'); return; }
  const p = data.progress;
  show('modules');

  if (p.stage === 'best_book') { renderBestBookPicker(p); return; }
  if (p.stage === 'video') { renderCertificatePrompt(p); return; }

  const firstOpen = p.books.findIndex(function (b) { return !b.complete; });
  $('view-modules').innerHTML =
    '<button id="backMods" class="ghost small">← All modules</button>' +
    '<h2 class="mt">' + esc(p.module.title) + '</h2>' +
    '<div class="progress" style="max-width:520px"><i style="width:' + p.percent + '%"></i></div>' +
    '<p class="small muted">' + p.percent + '% complete</p>' +
    '<div class="book-grid">' + p.books.map(function (b, i) {
      const cls = b.complete ? 'done' : (i === firstOpen ? 'current' : '');
      const locked = i > firstOpen;
      const stageBadge = b.complete ? '<span class="badge ok">FINISHED</span>'
        : (i === firstOpen ? '<span class="badge info">' +
            (b.stage === 'letter' ? 'LETTER' : b.stage === 'summaries' ? 'SUMMARIES' : 'READING') + '</span>'
          : '<span class="badge lock">LOCKED</span>');
      const steps = b.chapters.map(function (c) {
        return '<span class="step ' + (c.submission ? 'done' : (c.status === 'active' ? 'active' : '')) + '"></span>';
      }).join('');
      return '<div class="book-card ' + cls + '" data-book="' + esc(b.book.id) + '" ' +
        (locked ? 'style="opacity:.55;cursor:not-allowed"' : '') + '>' +
        stageBadge + '<h4 class="mt">' + esc(b.book.title) + '</h4>' +
        '<div class="steps">' + steps + '</div>' +
        '<div class="small muted">' + b.chapters.length + ' chapters — ' +
        b.chapters.filter(function (c) { return c.submission; }).length + ' submitted</div></div>';
    }).join('') + '</div>';

  $('backMods').onclick = renderModules;
  $('view-modules').querySelectorAll('[data-book]').forEach(function (el) {
    el.onclick = function () {
      const idx = p.books.findIndex(function (b) { return b.book.id === el.dataset.book; });
      if (idx > firstOpen) { toast('Finish the previous book first.', 'err'); return; }
      openBook(el.dataset.book);
    };
  });
}

/* -------------------------------------------------------- book reader --- */
async function openBook(bookId) {
  S.currentBookId = bookId;
  try {
    S.bookData = await API.get('/book/' + bookId);
  } catch (e) { toast(e.message, 'err'); return; }
  S.selectedChapterId = null;
  show('book');
  renderBook();
}

function activeChapterOf(d) {
  return d.chapters.find(function (c) { return c.status === 'active'; }) ||
         d.chapters.find(function (c) { return !c.submission; }) || null;
}

function renderBook() {
  const d = S.bookData;
  if (!d) return;
  const cur = S.selectedChapterId
    ? d.chapters.find(function (c) { return c.id === S.selectedChapterId && c.status === 'active'; })
    : null;
  const chapter = cur || activeChapterOf(d) || d.chapters[0];

  const stageSteps = [];
  d.chapters.forEach(function (c, i) {
    stageSteps.push('<div class="module-card" style="padding:8px 10px;margin:0">' +
      '<span class="small"><b>Book step ' + (i + 1) + '</b><br>Chapters: ' +
      (d.chapters.filter(function (x) { return x.submission; }).length) + '/' + d.chapters.length + '</span></div>');
  });
  const listHtml =
    '<div class="chapter-list">' +
      '<button class="ghost" id="backToBooks">← All books</button>' +
      d.chapters.map(function (c, i) {
        /* ONLY the chapter that is open now responds to clicks. A chapter that is
           waiting to be unlocked and one that has already been submitted are both
           inactive: a real disabled button, and no handler is attached below. */
        const locked = c.status === 'locked';
        const inactive = c.status !== 'active';
        const cls = (chapter && c.id === chapter.id ? 'active ' : '') + (inactive ? 'locked' : '');
        const why = locked ? 'Submit the previous chapter to unlock this one'
          : 'You have submitted this chapter — it is closed now';
        return '<button class="' + cls + '" data-ch="' + esc(c.id) + '"' +
          (inactive ? ' disabled aria-disabled="true" title="' + why + '"' : '') +
          '>' + (locked ? '🔒 ' : '') + (c.submission ? '✓ ' : '') + esc(c.title) +
          (c.status === 'active' && !c.submission ? ' ●' : '') + '</button>';
      }).join('') +
      (d.stage === 'letter' ? '<div class="badge info">LETTER UNLOCKED</div>' : '') +
      (d.stage === 'summaries' ? '<div class="badge info">SUMMARIES UNLOCKED</div>' : '') +
      (d.stage === 'complete' ? '<div class="badge ok">BOOK FINISHED</div>' : '') +
    '</div>';

  let body = '';
  if (cur && cur.submission) body = chapterPanel(d, cur);
  else if (d.stage === 'letter') body = letterPanel(d);
  else if (d.stage === 'summaries') body = summariesPanel(d);
  else if (d.stage === 'complete') body =
    '<div class="card"><h3>Book completed 🎉</h3>' +
    '<p class="muted">Every chapter of this book has been submitted. Return to the module to continue with the next book.</p>' +
    '<button id="backToBooks2">Back to the module</button></div>';
  else if (chapter) body = chapterPanel(d, chapter);
  else body = '<div class="card"><p class="muted">This book has no chapters yet.</p></div>';

  $('view-book').innerHTML =
    '<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">' +
      '<div><h3 style="margin:0">' + esc(d.book.title) + '</h3>' +
      '<span class="muted small">' + esc(d.module.title) + '</span></div>' +
      /* no full-book PDF is offered on this page — only the chapter's own pages */
      '<div><button class="ghost small" id="backToBooks3">← Books</button></div>' +
    '</div></div>' +
    '<div class="reader">' + listHtml + '<div id="chapterBody">' + body + '</div></div>';

  $('backToBooks').onclick = backToModule;
  $('backToBooks3').onclick = backToModule;
  const b2 = $('backToBooks2'); if (b2) b2.onclick = backToModule;

  $('view-book').querySelectorAll('[data-ch]').forEach(function (b) {
    const c = d.chapters.find(function (x) { return x.id === b.dataset.ch; });
    if (!c || c.status !== 'active') {      /* inactive chapter: responds to nothing */
      b.disabled = true;
      b.onclick = null;
      return;
    }
    b.onclick = function () { S.selectedChapterId = b.dataset.ch; renderBook(); };
  });
  wireChapterPanel(d, chapter);
  if (d.stage === 'letter') wireLetterPanel(d);
  if (d.stage === 'summaries') wireSummariesPanel(d);
}

function backToModule() {
  show('modules');
  openModule(S.bookData ? S.bookData.book.moduleId : S.currentModuleId);
}

/* ------------------------------------------------- chapter panel + form -- */
function chapterPanel(d, ch) {
  /* An inactive (locked) chapter is only a heading and the reason: no text, no
     pages and no form — nothing here can be clicked or opened. */
  if (ch.status === 'locked') {
    return '<div class="chapter-body"><h3>🔒 ' + esc(ch.title) + '</h3>' +
      '<p class="muted mt">Submit the previous chapter to unlock this one.</p></div>';
  }
  const pages = (ch.pageStart && ch.pageEnd) ? ' (pages ' + ch.pageStart + '–' + ch.pageEnd + ')' : '';
  let html = '<div class="chapter-body">' +
    '<h3>' + esc(ch.title) + '</h3>' +
    (pages ? '<p class="muted small">' + pages + '</p>' : '') +
    (ch.content
      ? '<div class="content">' + esc(ch.content) + '</div>'
      : '<p class="muted">No written content for this chapter — read the pages of the PDF book.</p>') +
    /* clicking the chapter opens that chapter's own pages straight away, with a
       Close button; the rest of the book is never offered on this page */
    (d.book.pdf && (ch.pageStart || ch.pageEnd)
      ? '<div class="chapter-book">' + pdfHtml(d.book.pdf, {
          open: true, back: true,
          title: (ch.pageStart && ch.pageEnd)
            ? 'Chapter pages ' + ch.pageStart + '–' + ch.pageEnd : 'Chapter pages',
          from: ch.pageStart, to: ch.pageEnd
        }) + '</div>'
      : (d.book.pdf
          ? '<p class="muted small mt">This chapter has no page range yet — ask your office to set it.</p>'
          : ''));

  if (ch.submission) {
    html += '<hr><p class="timestamp">Submitted: <b>' + fmtDate(ch.submission.createdAt) + '</b></p>' +
      (ch.submission.flagged
        ? '<p class="flag">Copy assessment: ' + ch.submission.similarity + '% similar to another student’s submission.</p>'
        : '<span class="badge ok">Original work</span>') +
      (ch.submission.score != null
        ? ' <span class="badge ' + (ch.submission.score >= ch.submission.total * 0.6 ? 'ok' : 'warn') + '">Score ' +
          ch.submission.score + '/' + ch.submission.total + '</span>' : '') +
      keyWordsFeedback(ch, ch.submission);
  } else if (d.module.mode === 'summary') {
    html += '<hr><h4>Summary of your understanding</h4>' +
      '<p class="muted small">Type in your own words — paste/cut is disabled and your work is compared with other students’ submissions.</p>' +
      keyWordsHint(ch) +
      '<textarea id="chText" class="no-paste" placeholder="At least 30 characters..."></textarea>' +
      '<div class="mt"><button id="chSubmit">Submit chapter summary</button></div>';
  } else {
    html += '<hr><h4>Objectives for this chapter</h4>' +
      '<p class="muted small">Answer every objective. The order reshuffles each time you log in.</p>' +
      '<div id="objBox">Loading objectives…</div>';
  }
  return html + '</div>';
}

/* MODULE 1 is MODE: SUMMARY — the answer is typed, and the chapter's key words
   help the learner (and the assessment) see whether the chapter was understood. */
function keyWordsList(ch) {
  return (ch && Array.isArray(ch.keywords)) ? ch.keywords.filter(Boolean) : [];
}
function keyWordsHint(ch) {
  const list = keyWordsList(ch);
  if (!list.length) return '';
  return '<div class="key-words"><b>Key words to use:</b> ' +
    list.map(function (k) { return '<span class="kw">' + esc(k) + '</span>'; }).join(' ') +
    '<div class="muted small">Explain them in your own words — your answer is checked against these.</div></div>';
}
function keyWordsFeedback(ch, sub) {
  const list = keyWordsList(ch);
  if (!list.length) return '';
  if (sub && sub.keywordScore != null) {
    const missing = (sub.keywordsMissing || []);
    return '<div class="key-words"><b>Key words:</b> ' +
      '<span class="badge ' + (sub.keywordScore >= 60 ? 'ok' : 'warn') + '">' +
        (sub.keywordsUsed == null ? '' : sub.keywordsUsed + ' of ' + sub.keywordsTotal + ' (' + sub.keywordScore + '%)') +
      '</span>' +
      (missing.length
        ? '<div class="muted small">Not used yet: ' + missing.map(esc).join(', ') + '</div>'
        : '<div class="muted small">Every key word of this chapter is covered.</div>') + '</div>';
  }
  return keyWordsHint(ch);
}

function wireChapterPanel(d, ch) {
  if (!ch || ch.submission || ch.status === 'locked') return;
  const t = $('chText');
  if (t) {
    blockPaste(t);
    $('chSubmit').onclick = async function () {
      try {
        const r = await API.post('/submissions',
          { type: 'chapter_summary', chapterId: ch.id, text: t.value });
        const a = r.assessment || {};
        const kw = a.keywordScore == null ? ''
          : ' Key words: ' + a.keywordsUsed + ' of ' + a.keywordsTotal + ' (' + a.keywordScore + '%)' +
            (a.keywordsMissing && a.keywordsMissing.length ? ' — missing: ' + a.keywordsMissing.join(', ') : '');
        toast((r.warning || 'Chapter summary submitted.') + kw, r.warning ? 'err' : 'ok');
        await refreshBook();
      } catch (e) { toast(e.message, 'err'); }
    };
  }
  const box = $('objBox');
  if (box) loadObjectives(ch, box);
}

async function refreshBook() {
  try {
    S.bookData = await API.get('/book/' + S.currentBookId);
    renderBook();
    loadFlow();
  } catch (e) { toast(e.message, 'err'); }
}

async function loadObjectives(ch, box) {
  try {
    const data = await API.get('/chapter/' + ch.id + '/objectives');
    if (!data.objectives.length) {
      box.innerHTML = '<p class="muted">No objectives have been set for this chapter yet — ask your administrator.</p>';
      return;
    }
    if (data.submitted) {
      box.innerHTML = data.objectives.map(function (o, i) {
        return '<div class="obj"><div class="q">' + (i + 1) + '. ' + esc(o.question) + '</div>' +
          o.options.map(function (opt, oi) {
            let cls = '';
            if (oi === o.answerIndex) cls = ' correct';
            else if (oi === o.yourChoice) cls = ' wrong';
            return '<div class="opt' + cls + '"><span>' + esc(opt) + '</span></div>';
          }).join('') +
          (o.correct === false ? '<div class="flag">Your answer was incorrect</div>' : '') +
          '</div>';
      }).join('') +
      '<p class="timestamp">Submitted: ' + fmtDate(data.submission.createdAt) +
      ' — score ' + data.submission.score + '/' + data.submission.total + '</p>';
      return;
    }
    box.innerHTML = data.objectives.map(function (o, i) {
      return '<div class="obj"><div class="q">' + (i + 1) + '. ' + esc(o.question) + '</div>' +
        o.options.map(function (opt, oi) {
          return '<label class="opt"><input type="radio" name="o_' + esc(o.id) + '" value="' + oi + '"> ' +
            '<span>' + esc(opt) + '</span></label>';
        }).join('') + '</div>';
    }).join('') + '<button id="objSubmit">Submit objectives</button>';

    $('objSubmit').onclick = async function () {
      const answers = data.objectives.map(function (o) {
        const sel = document.querySelector('input[name="o_' + o.id + '"]:checked');
        return { objectiveId: o.id, choice: sel ? Number(sel.value) : -1 };
      });
      if (answers.some(function (a) { return a.choice === -1; })) {
        toast('Answer every objective before submitting.', 'err');
        return;
      }
      try {
        const r = await API.post('/submissions',
          { type: 'objectives', chapterId: ch.id, answers: answers });
        toast('Objectives submitted — score ' + r.submission.score + '/' + r.submission.total, 'ok');
        await refreshBook();
      } catch (e) { toast(e.message, 'err'); }
    };
  } catch (e) { box.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; }
}

/* ------------------------------------- letter stage + colour summaries --- */
function letterPanel(d) {
  if (!d.letter) {
    return '<div class="card"><p class="muted">No letter is configured for this book — continue to the next book.</p>' +
      '<button id="backToBooks4">Back to the module</button></div>';
  }
  if (d.letterSubmission) {
    return '<div class="chapter-body"><h3>' + esc(d.letter.title) + '</h3>' +
      '<div class="letter-box">' + esc(d.letter.text) + '</div>' +
      '<p class="timestamp mt">Submitted: ' + fmtDate(d.letterSubmission.createdAt) + '</p></div>';
  }
  return '<div class="chapter-body">' +
    '<h3>' + esc(d.letter.title) + '</h3>' +
    '<p class="muted small">Read the whole letter, then write your summary to unlock the next book.</p>' +
    '<div class="letter-box">' + esc(d.letter.text) + '</div>' +
    '<h4 class="mt">Summary of the letter</h4>' +
    '<textarea id="letterSum" class="no-paste" placeholder="At least 30 characters in your own words..."></textarea>' +
    '<div class="mt"><button id="letterSubmit">Submit letter summary</button></div></div>';
}

function wireLetterPanel(d) {
  const back = $('backToBooks4');
  if (back) { back.onclick = backToModule; return; }
  const t = $('letterSum');
  if (!t) return;
  blockPaste(t);
  $('letterSubmit').onclick = async function () {
    try {
      const r = await API.post('/submissions',
        { type: 'letter_summary', bookId: d.book.id, text: t.value });
      toast(r.warning || 'Letter summary submitted — the next book is now open.', r.warning ? 'err' : 'ok');
      await refreshBook();
    } catch (e) { toast(e.message, 'err'); }
  };
}

function summariesPanel(d) {
  return '<div class="chapter-body"><h3>Book summaries</h3>' +
    '<p class="muted small">All three summaries are mandatory — each one unlocks the next, and each is attached to its own colour.</p>' +
    d.summaries.map(function (s, i) {
      const color = s.color || '#24508c';
      const head = '<div style="display:flex;gap:10px;align-items:center">' +
        '<span style="width:18px;height:18px;border-radius:50%;background:' + esc(color) + ';display:inline-block"></span>' +
        '<b>' + (i + 1) + '. ' + esc(s.label) + '</b></div>';
      if (s.submission) {
        return '<div class="summary-box" style="border-left:8px solid ' + esc(color) + '">' + head +
          '<div class="content mt">' + esc(s.submission.text || '') + '</div>' +
          '<p class="timestamp">Submitted: ' + fmtDate(s.submission.createdAt) + '</p>' +
          (s.submission.flagged ? '<p class="flag">Copy assessment: ' + s.submission.similarity + '% similar to another submission.</p>' : '') +
          '</div>';
      }
      if (s.status === 'active') {
        return '<div class="summary-box active" style="border-left:8px solid ' + esc(color) + '">' + head +
          '<textarea id="sum_' + s.index + '" class="no-paste mt" placeholder="At least 30 characters in your own words..."></textarea>' +
          '<div class="mt"><button data-sum="' + s.index + '">Submit summary ' + s.index + '</button></div></div>';
      }
      return '<div class="summary-box locked" style="border-left:8px solid ' + esc(color) + '">' + head +
        '<p class="muted small">Locked — submit summary ' + (s.index - 1) + ' first.</p></div>';
    }).join('') + '</div>';
}

function wireSummariesPanel(d) {
  const box = $('chapterBody') || $('view-book');
  box.querySelectorAll('[data-sum]').forEach(function (btn) {
    const idx = Number(btn.dataset.sum);
    const item = d.summaries.find(function (s) { return s.index === idx; });
    const ta = $('sum_' + idx);
    if (ta) blockPaste(ta);
    btn.onclick = async function () {
      try {
        const r = await API.post('/submissions',
          { type: 'book_summary', bookId: d.book.id, index: idx, text: ta.value });
        toast(r.warning || 'Summary ' + idx + ' submitted.', r.warning ? 'err' : 'ok');
        await refreshBook();
      } catch (e) { toast(e.message, 'err'); }
    };
  });
}

/* -------------------- best book → completion video → certificate -------- */
function renderBestBookPicker(p) {
  show('modules');
  $('view-modules').innerHTML =
    '<button id="backMods2" class="ghost small">← All modules</button>' +
    '<div class="card mt"><h3>' + esc(p.module.title) + ' — every book finished 🎉</h3>' +
    '<p class="muted">A prompt to pick the best book is now open. Which book impacted you the most? ' +
    'Your choice is shown on your certificate.</p>' +
    '<div class="book-grid">' + p.books.filter(function (b) { return b.complete; }).map(function (b) {
      return '<div class="book-card" data-best="' + esc(b.book.id) + '"><h4>' + esc(b.book.title) + '</h4>' +
        '<div class="small muted">' + b.chapters.length + ' chapters completed</div></div>';
    }).join('') + '</div></div>';
  $('backMods2').onclick = renderModules;
  $('view-modules').querySelectorAll('[data-best]').forEach(function (el) {
    el.onclick = async function () {
      const title = el.querySelector('h4').textContent;
      if (!confirm('Choose “' + title + '” as your best book?')) return;
      try {
        await API.post('/submissions',
          { type: 'best_book', moduleId: p.module.id, bookId: el.dataset.best });
        toast('Best book recorded.', 'ok');
        await loadFlow();
        openModule(p.module.id);
      } catch (e) { toast(e.message, 'err'); }
    };
  });
}

function renderCertificatePrompt(p) {
  show('modules');
  $('view-modules').innerHTML =
    '<button id="backMods3" class="ghost small">← All modules</button>' +
    '<div class="card mt center"><h3>' + esc(p.module.certificateName) + '</h3>' +
    '<p class="muted">You completed every book of this module. Watch (or close) the completion video ' +
    'to receive your certificate and unlock the next module. The video then moves to your video menu on the left.</p>' +
    '<button id="claimCert">Watch the video &amp; receive my certificate</button></div>';
  $('backMods3').onclick = renderModules;
  $('claimCert').onclick = function () { claimCertificate(p); };
}

async function claimCertificate(p) {
  const wanted = p.module.completionVideoId;
  const video = (wanted && S.videos.find(function (v) { return v.id === wanted && v.url; })) ||
                S.videos.find(function (v) { return v.url; });
  if (!video) { await issueCertificate(p.module.id, null); return; }
  modal('<h3>' + esc(video.title) + '</h3>' +
    '<video class="video-frame" controls autoplay playsinline src="' + esc(video.url) + '"></video>' +
    '<p class="muted small">Watch it or close it — your certificate is issued either way.</p>' +
    '<div class="mt"><button data-close>Close &amp; claim certificate</button></div>',
    { onClose: function () { issueCertificate(p.module.id, video.id); } });
}

async function issueCertificate(moduleId, videoId) {
  try {
    const r = await API.post('/certificates/issue', { moduleId: moduleId, videoId: videoId || undefined });
    if (videoId) loadVideos();
    await loadFlow();
    toast('Certificate issued — well done!', 'ok');
    showCertificate(r.certificate.id);
    renderModules();
  } catch (e) { toast(e.message, 'err'); }
}

function learnerCertSheet(c, b) {
  b = b || {};
  const booksHtml = (c.books && c.books.length)
    ? '<b>Books attended:</b><ul>' + c.books.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>'
    : '';
  return '<div class="cert-sheet">' +
    '<h1>' + esc(c.title) + '</h1>' +
    '<p>This certificate is proudly presented to</p>' +
    '<div class="name">' + esc(c.userName) + '</div>' +
    '<p class="muted">' + esc(c.tenantName || '') + '</p>' +
    '<div class="books">' + booksHtml +
      (c.bestBook ? '<div><b>Best book:</b> ' + esc(c.bestBook) + '</div>' : '') +
      '<div class="mt"><b>Performance:</b> ' + esc(String(c.performance)) + '%' +
      (c.objectiveScore != null ? ' — objectives ' + esc(String(c.objectiveScore)) + '%' : '') + '</div>' +
    '</div>' +
    '<div class="foot"><span>Certificate code: <b>' + esc(c.code) + '</b></span>' +
    '<span>Issued: ' + fmtDate(c.issuedAt) + '</span></div>' +
  '</div>';
}
async function showCertificate(id) {
  try {
    const data = await API.get('/certificate/' + id);
    modal(learnerCertSheet(data.certificate, data.branding) +
      '<div class="mt center no-print">' +
        '<div class="row export-buttons"><button type="button" class="ghost" data-export="cert-print">Print</button><button type="button" class="ghost" data-export="cert-pdf">PDF</button><button type="button" class="ghost" data-export="cert-word">Word</button></div>' +
        '<button data-close class="ghost">Close</button></div>',
      { wide: true });
  } catch (e) { toast(e.message, 'err'); }
}
/* Bulk download / print of every certificate the learner has earned. */
async function exportAllCertificates(type) {
  try {
    const list = (await API.get('/certificates')).certificates || [];
    if (!list.length) { toast('No certificates yet', 'err'); return; }
    let sheets = '';
    for (let i = 0; i < list.length; i++) {
      try {
        const d = await API.get('/certificate/' + encodeURIComponent(list[i].id));
        sheets += '<div class="cert-page">' + learnerCertSheet(d.certificate, d.branding) + '</div>';
      } catch (e) { /* skip anything that cannot be loaded */ }
    }
    if (!sheets) { toast('Could not load the certificates', 'err'); return; }
    exportReport(type, 'My certificates (' + list.length + ')', sheets);
  } catch (e) { toast(e.message, 'err'); }
}

async function renderCertificates() {
  const data = await API.get('/certificates');
  const certs = data.certificates || [];
  $('view-certificates').innerHTML =
    '<h2>My Certificates</h2>' +
    (certs.length
      ? '<div class="row export-buttons"><span class="muted small" style="align-self:center">All my certificates:</span>' +
        '<button type="button" class="ghost" id="ctAllPrint">Print all</button>' +
        '<button type="button" class="ghost" id="ctAllPdf">Download all as PDF</button>' +
        '<button type="button" class="ghost" id="ctAllWord">Download all as Word</button></div>' +
        '<div class="grid cols-2">' + certs.map(function (c) {
          return '<div class="module-card"><span class="badge ' + (c.type === 'general' ? 'warn' : 'info') + '">' +
            (c.type === 'general' ? 'GENERAL' : 'MODULE') + '</span>' +
            '<h4 class="mt">' + esc(c.title) + '</h4>' +
            '<div class="small muted">Code ' + esc(c.code) + ' — ' + fmtDate(c.issuedAt) + '</div>' +
            '<div class="small">Performance ' + esc(String(c.performance)) + '%</div>' +
            '<div class="mt"><button data-cert="' + esc(c.id) + '">View certificate</button></div></div>';
        }).join('') + '</div>'
      : '<div class="card"><p class="muted">No certificates yet — complete a module to earn one.</p></div>');
  $('view-certificates').querySelectorAll('[data-cert]').forEach(function (b) {
    b.onclick = function () { showCertificate(b.dataset.cert); };
  });
  const ap = $('ctAllPrint'); if (ap) ap.onclick = function () { exportAllCertificates('print'); };
  const ad = $('ctAllPdf'); if (ad) ad.onclick = function () { exportAllCertificates('pdf'); };
  const aw = $('ctAllWord'); if (aw) aw.onclick = function () { exportAllCertificates('word'); };
}

/* ------------------------------------------------------------ library --- */
function openLibraryItem(item) {
  /* books only open once every module is complete */
  if (item.type === 'book' && (item.locked || !(S.flow && S.flow.allDone))) {
    modal('<h3>' + esc(item.title) + '</h3>' +
      bookLockedHtml(item.title, 'Finish every module to open the books in the programme.') +
      '<div class="mt"><button data-close class="ghost">Close</button></div>');
    return;
  }
  if (item.type === 'video' && item.url) {
    modal('<h3>' + esc(item.title) + '</h3>' +
      '<video class="video-frame" controls autoplay src="' + esc(item.url) + '"></video>' +
      '<div class="mt"><button data-close class="ghost">Close</button></div>',
      { onClose: function () {} });
    return;
  }
  modal('<h3>' + esc(item.title) + '</h3>' +
    (item.url ? '<p>' + pdfHtml(item.url) + '</p>' : '') +
    (item.text ? '<div class="letter-box">' + esc(item.text) + '</div>'
               : '<p class="muted">No text content for this entry.</p>') +
    '<div class="mt"><button data-close class="ghost">Close</button></div>', { wide: true });
}

async function renderLibrary() {
  const data = await API.get('/library');
  const groups = { book: [], letter: [], video: [] };
  data.library.forEach(function (i) { (groups[i.type] || groups.book).push(i); });
  function list(type, title) {
    const items = groups[type];
    return '<div class="card"><h3>' + title + ' <span class="badge info">' + items.length + '</span></h3>' +
      (items.length
        ? items.map(function (i) {
            return '<div class="tenant-chip" style="cursor:pointer" data-lib="' + esc(i.id) + '">' +
              '<b>' + esc(i.title) + '</b> ' +
              (i.fileName ? '<span class="badge info">file</span>' : '') +
              (i.text ? '<span class="badge lock">text</span>' : '') +
              (i.type === 'book' && i.locked ? '<span class="badge off">locked until you finish every module</span>' : '') +
              '</div>';
          }).join('')
        : '<p class="muted">Nothing here yet.</p>') + '</div>';
  }
  $('view-library').innerHTML = '<h2>Library</h2>' +
    '<p class="muted">Every book, letter and video of the programme. The books and letters used in your modules are picked from here.</p>' +
    '<div class="grid cols-3">' + list('book', 'Books') + list('letter', 'Letters') + list('video', 'Videos') + '</div>';
  $('view-library').querySelectorAll('[data-lib]').forEach(function (el) {
    el.onclick = function () {
      const item = data.library.find(function (i) { return i.id === el.dataset.lib; });
      if (item) openLibraryItem(item);
    };
  });
}

/* ------------------------------------------------------------ thoughts -- */
async function renderThoughts() {
  const data = await API.get('/thoughts');
  $('view-thoughts').innerHTML =
    '<div class="card"><h3>My thoughts</h3>' +
    '<div class="thought-entry"><textarea id="thtText" placeholder="Write a thought..."></textarea>' +
    '<button id="thtAdd" class="fixed">Add</button></div></div>' +
    '<div class="card">' + (data.thoughts.length
      ? data.thoughts.map(function (t) {
          return '<div class="summary-box"><div class="content">' + esc(t.text) + '</div>' +
            '<div class="timestamp">' + fmtDate(t.createdAt) + '</div></div>';
        }).join('')
      : '<p class="muted">No thoughts recorded yet.</p>') + '</div>';
  $('thtAdd').onclick = async function () {
    try {
      await API.post('/thoughts', { text: $('thtText').value });
      toast('Thought saved.', 'ok');
      renderThoughts();
    } catch (e) { toast(e.message, 'err'); }
  };
}

/* ------------------------------------------------------ final records --- */
let FINAL_TAB = 'summaries';

function finalSubHtml(s, colorBar) {
  const flag = s.flagged
    ? '<span class="flag">Copy assessment: ' + s.similarity + '% similar</span>' : '';
  const score = (s.total != null && s.total) ? '<span class="badge info">' + s.score + '/' + s.total + '</span>' : '';
  return '<div class="summary-box"' + (colorBar ? ' style="border-left:8px solid ' + esc(colorBar) + '"' : '') + '>' +
    '<b>' + esc(s.chapter || s.book || s.label || TYPE_LABELS[s.type] || s.type) + '</b> ' + score + ' ' + flag +
    (s.text ? '<div class="content">' + esc(s.text) + '</div>' : '') +
    '<div class="timestamp">' + fmtDate(s.createdAt) + '</div></div>';
}

function sectionBlock(title, list, mapper) {
  if (!list || !list.length) return '';
  return '<div class="card"><h3>' + title + ' <span class="badge info">' + list.length + '</span></h3>' +
    list.map(mapper || finalSubHtml).join('') + '</div>';
}

async function renderFinal() {
  if (!S.flow || !S.flow.allDone) { try { await loadFlow(); } catch (e) {} }
  try {
    S.finalData = await API.get('/final');
  } catch (e) {
    $('view-final').innerHTML = '<div class="card"><p class="muted">' + esc(e.message) + '</p></div>';
    return;
  }
  const tabs = [
    ['summaries', 'All summaries'], ['thoughts', 'Thoughts'], ['general', 'General summaries'],
    ['questions', 'Book questions'], ['library', 'Library'], ['other', 'Other books'],
    ['videos', 'All videos'], ['certificates', 'Certificates']
  ];
  $('view-final').innerHTML =
    '<h2>Final records</h2>' +
    '<p class="muted">Every module is complete — all modules are now closed and everything below is unlocked.</p>' +
    '<div class="final-tabs">' + tabs.map(function (t) {
      return '<button data-tab="' + t[0] + '" class="' + (FINAL_TAB === t[0] ? 'active' : '') + '">' + t[1] + '</button>';
    }).join('') + '</div><div id="finalBody"></div>';
  $('view-final').querySelectorAll('[data-tab]').forEach(function (b) {
    b.onclick = function () { FINAL_TAB = b.dataset.tab; renderFinal(); };
  });
  renderFinalTab();
}

function renderFinalTab() {
  const d = S.finalData;
  const body = $('finalBody');
  if (!d || !body) return;
  let html = '';
  const sums = d.summaries;

  if (FINAL_TAB === 'summaries') {
    html = sectionBlock('Chapter summaries', sums.chapterSummaries) +
      sectionBlock('Letter summaries', sums.letterSummaries) +
      sectionBlock('Book summaries (coloured)', sums.bookSummaries, function (s) {
        return finalSubHtml(s, s.color);
      }) +
      sectionBlock('Objective submissions', sums.objectiveSubmissions, function (s) {
        return finalSubHtml(s, null);
      }) +
      sectionBlock('Best book choices', sums.bestPicks);
    if (!html) html = '<div class="card"><p class="muted">No summaries recorded.</p></div>';
  } else if (FINAL_TAB === 'thoughts') {
    html = '<div class="card"><h3>Add a thought</h3>' +
      '<div class="thought-entry"><textarea id="finalTht" placeholder="Write a thought..."></textarea>' +
      '<button id="finalThtAdd" class="fixed">Add</button></div></div>' +
      '<div class="card"><h3>My thoughts</h3>' +
      (d.thoughts.length ? d.thoughts.map(function (t) {
        return '<div class="summary-box"><div class="content">' + esc(t.text) + '</div>' +
          '<div class="timestamp">' + fmtDate(t.createdAt) + '</div></div>';
      }).join('') : '<p class="muted">No thoughts yet.</p>') + '</div>';
  } else if (FINAL_TAB === 'general') {
    html = '<div class="card"><h3>General summary</h3>' +
      '<p class="muted">Write your overall reflection of the whole programme.</p>' +
      '<textarea id="genSum" class="no-paste" placeholder="At least 30 characters..."></textarea>' +
      '<div class="mt"><button id="genSubmit">Submit general summary</button></div></div>' +
      sectionBlock('Submitted general summaries', sums.generalSummaries);
  } else if (FINAL_TAB === 'questions') {
    html = d.bookQuestions.length ? d.bookQuestions.map(function (q) {
      return '<div class="card"><h4>' + esc(q.chapter || 'Questions') + '</h4>' +
        '<div class="small muted">' + esc(q.book || '') + ' — ' + fmtDate(q.createdAt) +
        ' — score ' + q.score + '/' + q.total + '</div><ol>' +
        q.answers.map(function (a) {
          return '<li>' + esc(a.question) + '<br><span class="badge ' + (a.correct ? 'ok' : 'off') + '">' +
            (a.correct ? 'Correct' : 'Incorrect') + '</span></li>';
        }).join('') + '</ol></div>';
    }).join('') : '<div class="card"><p class="muted">No book questions answered yet.</p></div>';
  } else if (FINAL_TAB === 'library') {
    const items = d.library.books.concat(d.library.letters);
    html = items.length ? items.map(function (i) {
      return '<div class="tenant-chip" data-final-lib="' + esc(i.id) + '"><b>' + esc(i.title) + '</b> ' +
        '<span class="badge ' + (i.type === 'video' ? 'warn' : 'info') + '">' + i.type + '</span></div>';
    }).join('') : '<div class="card"><p class="muted">Library is empty.</p></div>';
    html = '<div class="card"><h3>Library</h3>' + html + '</div>';
  } else if (FINAL_TAB === 'other') {
    html = '<div class="card"><h3>Other books</h3>' +
      (d.library.otherBooks.length ? d.library.otherBooks.map(function (i) {
        return '<div class="tenant-chip" data-final-lib="' + esc(i.id) + '"><b>' + esc(i.title) + '</b></div>';
      }).join('') : '<p class="muted">No other books in the library.</p>') + '</div>';
  } else if (FINAL_TAB === 'videos') {
    html = '<div class="card"><h3>All videos</h3>' +
      (d.library.videos.length ? d.library.videos.map(function (v) {
        return '<div class="tenant-chip"><b>' + esc(v.title) + '</b> ' +
          (v.watched ? '<span class="badge ok">WATCHED</span>' : '<span class="badge warn">NEW</span>') +
          ' <button class="small ghost" data-final-video="' + esc(v.id) + '">Watch</button></div>';
      }).join('') : '<p class="muted">No videos yet.</p>') + '</div>';
  } else if (FINAL_TAB === 'certificates') {
    html = '<div class="card"><h3>My certificates</h3>' +
      d.certificates.map(function (c) {
        return '<div class="tenant-chip"><b>' + esc(c.title) + '</b> ' +
          '<span class="badge ' + (c.type === 'general' ? 'warn' : 'info') + '">' +
          (c.type === 'general' ? 'GENERAL' : 'MODULE') + '</span>' +
          '<span class="small muted">' + esc(c.code) + ' — ' + esc(String(c.performance)) + '%</span>' +
          ' <button class="small" data-cert="' + esc(c.id) + '">View / Print</button></div>';
      }).join('') + '</div>';
  }
  body.innerHTML = html;

  const flatLib = d.library.books.concat(d.library.letters, d.library.videos);
  body.querySelectorAll('[data-final-lib]').forEach(function (el) {
    el.onclick = function () {
      const item = flatLib.find(function (i) { return i.id === el.dataset.finalLib; });
      if (item) openLibraryItem(item);
    };
  });
  body.querySelectorAll('[data-final-video]').forEach(function (el) {
    el.onclick = function () {
      const v = d.library.videos.find(function (x) { return x.id === el.dataset.finalVideo; });
      if (v && v.url) modal('<h3>' + esc(v.title) + '</h3>' +
        '<video class="video-frame" controls autoplay src="' + esc(v.url) + '"></video>' +
        '<div class="mt"><button data-close class="ghost">Close</button></div>');
    };
  });
  body.querySelectorAll('[data-cert]').forEach(function (el) {
    el.onclick = function () { showCertificate(el.dataset.cert); };
  });

  if (FINAL_TAB === 'thoughts') {
    blockPaste($('finalTht') || document.createElement('textarea'));
    $('finalThtAdd').onclick = async function () {
      try { await API.post('/thoughts', { text: $('finalTht').value }); toast('Thought saved.', 'ok'); renderFinal(); }
      catch (e) { toast(e.message, 'err'); }
    };
  }
  if (FINAL_TAB === 'general') {
    blockPaste($('genSum'));
    $('genSubmit').onclick = async function () {
      try {
        const r = await API.post('/submissions', { type: 'general_summary', text: $('genSum').value });
        toast(r.warning || 'General summary submitted.', r.warning ? 'err' : 'ok');
        renderFinal();
      } catch (e) { toast(e.message, 'err'); }
    };
  }
}

/* --------------------------------------------------------------- start -- */
boot().catch(function (e) {
  console.error(e);
  toast(e.message || 'Failed to start', 'err');
});











