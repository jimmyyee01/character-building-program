/* ============================================================== live class ==
   The room a live-class alert opens:  /live?code=ABC123

   It shows the class (camera and microphone live in the room), and it writes
   down what is being said: the host's browser listens and every finished
   sentence is sent to the server, so learners read it as captions and the
   class keeps a transcript afterwards.

   Anyone invited may open it; only the host can speak into the transcript or
   end the class. A class that is over closes the camera and shows the text.
   ------------------------------------------------------------------------- */

const ROOM = {
  code: '', lesson: null, me: null, status: 'scheduled',
  seq: 0, seen: {},
  heartbeat: null, poll: null, flushTimer: null,
  queue: [], recogniser: null, listening: false, ended: false
};

function roomEl(id) { return document.getElementById(id); }

function roomCode() {
  try {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('code') || '').trim().toUpperCase();
  } catch (e) { return ''; }
}

/* the link a signed-out visitor came for, so signing in returns them here */
function rememberRoom() {
  try { localStorage.setItem('cbp_next', '/live?code=' + encodeURIComponent(ROOM.code)); } catch (e) {}
}

function homeOf(role) {
  if (role === 'super') return '/super';
  if (role === 'tenant_admin') return '/admin';
  return '/app';
}

function roomStatusText(lesson) {
  if (!lesson) return '';
  if (lesson.status === 'live') return 'Live now' + (lesson.startedAt ? ' — started ' + fmtDate(lesson.startedAt) : '');
  if (lesson.status === 'scheduled') return 'Scheduled for ' + fmtDate(lesson.scheduledAt);
  if (lesson.status === 'ended') return 'Ended' + (lesson.endedAt ? ' ' + fmtDate(lesson.endedAt) : '');
  if (lesson.status === 'cancelled') return 'Cancelled';
  return '';
}

/* --------------------------------------------------------------- drawing --- */
function liveProblem(title, hint, extra) {
  const stage = roomEl('liveStage');
  const meta = roomEl('liveMeta');
  if (meta) meta.textContent = hint || '';
  if (stage) {
    stage.innerHTML = '<div class="live-placeholder"><b>' + esc(title) + '</b>' +
      (hint ? '<span class="small muted">' + esc(hint) + '</span>' : '') +
      (extra || '') + '</div>';
  }
}

function paintRoster(roster) {
  const box = roomEl('liveRoster');
  if (!box) return;
  const list = roster || [];
  box.textContent = list.length ? list.length + ' in the room' : 'no one else here yet';
}

function renderHead(lesson) {
  const title = roomEl('liveTitle');
  const meta = roomEl('liveMeta');
  const dot = roomEl('liveDot');
  const endBtn = roomEl('liveEndBtn');
  const linkBtn = roomEl('liveLinkBtn');
  if (title) title.textContent = lesson.title || 'Live class';
  if (meta) {
    meta.textContent = roomStatusText(lesson) +
      (lesson.creatorName ? ' · ' + lesson.creatorName : '') +
      (lesson.code ? ' · code ' + lesson.code : '');
  }
  if (dot) dot.className = 'live-dot ' + (lesson.status === 'live' ? 'on' : 'off');
  if (endBtn) endBtn.classList.toggle('hidden', !(ROOM.me && ROOM.me.host) || lesson.status !== 'live');
  if (linkBtn) linkBtn.classList.toggle('hidden', !lesson.joinUrl);
}

/* ------------------------------------------------------------- the camera ---
   A video room can only work when the browser will hand over the camera, and
   the third-party video server answers "WebRTC is not available in your
   browser" whenever it cannot — a sentence that tells nobody what to do next.
   So ask first, and answer with the actual reason and the actual way out:
     insecure  the page is on http (or an untrusted address), and no browser
               gives a camera to an address it cannot trust;
     inapp     the link was opened inside WhatsApp / Facebook / Instagram and
               those apps keep the camera for themselves;
     webrtc    the browser is too old or has WebRTC switched off;
     devices   the browser has WebRTC but exposes no camera or microphone.
   None of these stop the class: the captions and the transcript keep working,
   and the host's meeting link is still one tap away. */
const IN_APP_BROWSER = /(FBAN|FBAV|FB_IAB|Instagram|Line\/|LinkedInApp|WhatsApp|Twitter|MicroMessenger|; wv\)|GSA\/)/i;

function videoCapability() {
  const host = String(location.hostname || '');
  const localHost = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i.test(host);
  const secure = window.isSecureContext === true || localHost;
  const webrtc = typeof window.RTCPeerConnection === 'function' ||
    typeof window.webkitRTCPeerConnection === 'function';
  const devices = !!(navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function');
  const inApp = IN_APP_BROWSER.test(String(navigator.userAgent || ''));
  let why = '';
  if (!secure) why = 'insecure';
  else if (!webrtc) why = inApp ? 'inapp' : 'webrtc';
  else if (!devices) why = 'devices';
  return { ok: !why, why: why, secure: secure, webrtc: webrtc, devices: devices, inApp: inApp };
}

/* The same room at its secure address: https on the standard port unless the
   server says it publishes one somewhere else. */
function secureRoomLink(lesson) {
  const host = String(location.hostname || '').replace(/:\d+$/, '');
  if (!host) return '';
  const port = lesson && lesson.securePort ? ':' + lesson.securePort : '';
  return 'https://' + host + port + '/live?code=' + encodeURIComponent(ROOM.code);
}

/* Where to send someone whose link opened inside an app that has no camera. */
function openInBrowserLink(lesson) {
  const target = (lesson && lesson.secure ? secureRoomLink(lesson) : '') ||
    (location.href || '').replace(/^http:/i, 'https:');
  if (/Android/i.test(String(navigator.userAgent || ''))) {
    return 'intent://' + target.replace(/^https?:\/\//i, '') +
      '#Intent;scheme=https;package=com.android.chrome;end';
  }
  return target;
}

function cameraProblem(kind, lesson) {
  const secureUrl = secureRoomLink(lesson);
  const canGoSecure = !!secureUrl && !/^https:/i.test(location.href) && !!(lesson && lesson.secure);
  const secureButton = canGoSecure
    ? '<a class="btn small" href="' + esc(secureUrl) + '">Open the secure address</a>'
    : '';
  if (kind === 'insecure') {
    return {
      title: 'The camera needs a secure (https) address.',
      hint: 'This room was opened at ' + (location.origin || 'a plain http address') +
        ', and browsers never give a camera or a microphone to an address they cannot trust. ' +
        'The class still reads here as text; for the video, open the secure address.',
      extra: secureButton ||
        '<span class="small muted">Ask the host for the https address of this room.</span>'
    };
  }
  if (kind === 'inapp') {
    return {
      title: 'This app’s built-in browser has no camera.',
      hint: 'WhatsApp, Facebook, Instagram and the like open links in their own browser, ' +
        'which keeps the camera for the app. Open this room in Chrome, Safari, Edge or Firefox ' +
        'and the video starts there.',
      extra: '<a class="btn small" href="' + esc(openInBrowserLink(lesson)) + '" target="_blank" rel="noopener">Open in browser</a>'
    };
  }
  return {
    title: 'This browser cannot show a video call.',
    hint: 'Use a recent Chrome, Edge, Safari or Firefox. Everything said is still written down ' +
      'here as captions, and kept as the class transcript.',
    extra: ''
  };
}

/* A browser that has already decided against the camera says so before the video
   server ever asks (this is also what a page with a certificate the browser does
   not trust looks like in Chrome: the camera is refused and 'WebRTC is not
   available' is all the visitor would otherwise be told). */
function cameraRefused() {
  return new Promise(function (resolve) {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return resolve(false);
      navigator.permissions.query({ name: 'camera' }).then(function (status) {
        resolve(!!status && status.state === 'denied');
      }).catch(function () { resolve(false); });
    } catch (e) { resolve(false); }
  });
}

function mountVideo(lesson) {
  const stage = roomEl('liveStage');
  if (!stage) return;
  if (!lesson.videoBase) {
    liveProblem('The video room is not available.',
      lesson.joinUrl ? 'Use “Meeting link” above to join where the class meets.'
        : 'The class can still be followed as text in the panel beside this.');
    return;
  }
  /* Ask before we hand the stage over: a room that cannot work must say why. */
  const can = videoCapability();
  if (!can.ok) {
    const problem = cameraProblem(can.why, lesson);
    liveProblem(problem.title, problem.hint, problem.extra);
    return;
  }
  const name = (ROOM.me && ROOM.me.name) || 'Guest';
  const src = lesson.videoBase +
    '#userInfo.displayName=' + encodeURIComponent('"' + name + '"') +
    '&config.prejoinPageEnabled=false&config.disableDeepLinking=true' +
    '&config.startWithAudioMuted=false&config.startWithVideoMuted=false';
  stage.innerHTML = '<iframe class="live-frame" id="liveFrame" title="Live class" ' +
    'allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write" ' +
    'allowfullscreen></iframe>';
  const frame = roomEl('liveFrame');
  if (!frame) return;
  let arrived = false;
  frame.onload = function () { arrived = true; };
  frame.setAttribute('src', src);
  frame.src = src;
  cameraRefused().then(function (blocked) {
    if (!blocked || ROOM.ended) return;
    liveProblem('The browser has blocked the camera for this address.',
      'Allow the camera for this site (the camera or sliders icon beside the address, ' +
      'then reload), or use the host’s meeting link. A page whose certificate the browser ' +
      'does not trust — a self-signed certificate, or one issued for an IP address — ' +
      'blocks the camera whatever you press: ask for the trusted https address. ' +
      'The captions and the transcript keep working here.');
  });
  /* A video server that never answers must not look like a frozen class. */
  setTimeout(function () {
    if (arrived || ROOM.ended || !roomEl('liveFrame')) return;
    liveProblem('The video server did not answer.',
      'Check the internet connection, or use “Meeting link” above. ' +
      'The captions and the transcript keep working.');
  }, 20000);
}

/* --------------------------------------------------------------- captions --- */
function addCaptionLine(line) {
  if (!line || !line.text) return;
  const list = roomEl('captionList');
  if (!list) return;
  if (line.seq && ROOM.seen[line.seq]) return;
  if (line.seq) ROOM.seen[line.seq] = true;
  if (Number(line.seq) > ROOM.seq) ROOM.seq = Number(line.seq);
  const when = line.at
    ? new Date(line.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '';
  const row = document.createElement('div');
  row.className = 'live-line';
  row.innerHTML = '<span class="live-time">' + esc(when) + '</span>' +
    '<span class="live-who">' + esc(line.speaker || 'Host') + '</span>' +
    '<span class="live-text">' + esc(line.text) + '</span>';
  list.appendChild(row);
  while (list.childNodes && list.childNodes.length > 300 && list.firstChild) {
    list.removeChild(list.firstChild);
  }
  list.scrollTop = list.scrollHeight;
}

function showInterim(text) {
  let box = roomEl('captionInterim');
  if (!box && text) {
    const list = roomEl('captionList');
    if (!list) return;
    box = document.createElement('div');
    box.id = 'captionInterim';
    box.className = 'live-line interim';
    list.appendChild(box);
  }
  if (box) box.textContent = text || '';
}

/* ------------------------------------------------------- speaking to text --- */
async function flushCaptions() {
  if (ROOM.ended || !ROOM.queue.length) return;
  const batch = ROOM.queue.splice(0, 40);
  try {
    await API.post('/live-class/' + encodeURIComponent(ROOM.code) + '/captions',
      { lines: batch.map(function (text) { return { text: text }; }) });
    showInterim('');
    await pollCaptions();          /* read them back with the server's numbers */
  } catch (e) {
    ROOM.queue = batch.concat(ROOM.queue);
    if (e.status === 409) finishClass('ended');
  }
}

function startListening() {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const button = roomEl('captionMicBtn');
  if (ROOM.listening) { stopListening(); return; }
  if (!Rec) {
    toast('This browser cannot listen. Type what is said instead — it is saved the same way.', 'err');
    return;
  }
  const recogniser = new Rec();
  recogniser.continuous = true;
  recogniser.interimResults = true;
  recogniser.lang = 'en-GB';
  recogniser.onresult = function (event) {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = String((result[0] && result[0].transcript) || '').trim();
      if (!text) continue;
      if (result.isFinal) ROOM.queue.push(text);
      else interim += text + ' ';
    }
    showInterim(interim.trim());
    if (ROOM.queue.length) flushCaptions();
  };
  recogniser.onerror = function (event) {
    if (event && event.error === 'not-allowed') {
      toast('The microphone is blocked. Allow it, then start listening again.', 'err');
      stopListening();
    }
  };
  recogniser.onend = function () {
    /* browsers stop on a long silence: keep the class listening */
    if (!ROOM.listening || ROOM.ended) return;
    try { recogniser.start(); } catch (e) { /* already restarting */ }
  };
  ROOM.recogniser = recogniser;
  ROOM.listening = true;
  try { recogniser.start(); } catch (e) {
    ROOM.listening = false;
    toast('Could not start listening on this device.', 'err');
    return;
  }
  if (button) button.textContent = 'Stop listening';
  toast('Listening — what is said becomes the transcript.', 'ok');
}

function stopListening() {
  ROOM.listening = false;
  const button = roomEl('captionMicBtn');
  if (button) button.textContent = 'Start listening';
  const recogniser = ROOM.recogniser;
  ROOM.recogniser = null;
  if (recogniser) { try { recogniser.stop(); } catch (e) { /* already stopped */ } }
  showInterim('');
}

/* ------------------------------------------------------------- the class --- */
async function pollCaptions() {
  if (ROOM.ended || !ROOM.code) return;
  try {
    const result = await API.get('/live-class/' + encodeURIComponent(ROOM.code) +
      '/captions?after=' + ROOM.seq);
    const lines = (result && result.lines) || [];
    lines.forEach(addCaptionLine);
    if (result && Number(result.seq) > ROOM.seq && !lines.length) ROOM.seq = Number(result.seq);
    if (result && result.status) {
      ROOM.status = result.status;
      if (result.status === 'ended' || result.status === 'cancelled') finishClass(result.status);
    }
  } catch (e) { /* the next poll tries again */ }
}

async function beat() {
  if (ROOM.ended || !ROOM.code) return;
  try {
    const result = await API.post('/live-class/' + encodeURIComponent(ROOM.code) + '/join');
    if (result && result.status) {
      ROOM.status = result.status;
      if (result.status === 'ended' || result.status === 'cancelled') {
        finishClass(result.status);
        return;
      }
    }
    paintRoster(result && result.roster);
  } catch (e) { /* the room keeps trying */ }
}

async function loadTranscript() {
  if (!ROOM.lesson) return;
  try {
    const result = await API.get('/live-lessons/' + encodeURIComponent(ROOM.lesson.id) + '/transcript');
    const list = roomEl('captionList');
    const lines = (result && result.lines) || [];
    if (list) {
      list.innerHTML = '';
      ROOM.seen = {};
      ROOM.seq = 0;
      lines.forEach(addCaptionLine);
      if (!lines.length) {
        list.innerHTML = '<p class="small muted">Nothing was said in writing in this class.</p>';
      }
    }
    ROOM.transcript = (result && result.text) || '';
  } catch (e) { /* the panel simply stays as it is */ }
}

function finishClass(status, lesson) {
  if (ROOM.ended) return;
  ROOM.ended = true;
  stopListening();
  if (ROOM.heartbeat) { clearInterval(ROOM.heartbeat); ROOM.heartbeat = null; }
  if (ROOM.poll) { clearInterval(ROOM.poll); ROOM.poll = null; }
  if (ROOM.flushTimer) { clearInterval(ROOM.flushTimer); ROOM.flushTimer = null; }
  if (lesson) ROOM.lesson = lesson;
  const stage = roomEl('liveStage');
  if (stage) {
    stage.innerHTML = '<div class="live-placeholder"><b>' +
      (status === 'cancelled' ? 'This class was cancelled.' : 'This class has ended.') + '</b>' +
      '<span class="small muted">The transcript is kept beside this.</span></div>';
  }
  const endButton = roomEl('liveEndBtn');
  if (endButton) endButton.classList.add('hidden');
  const tools = roomEl('captionTools');
  if (tools) tools.classList.add('hidden');
  const state = roomEl('captionState');
  if (state) state.textContent = 'transcript';
  loadTranscript();
}

async function endClass() {
  if (!ROOM.lesson || ROOM.ended) return;
  if (!window.confirm('End this class for everyone? The transcript is kept.')) return;
  try {
    const result = await API.post('/live-lessons/' + encodeURIComponent(ROOM.lesson.id) + '/end');
    finishClass('ended', result && result.lesson);
    toast('Class ended — the transcript is kept.', 'ok');
  } catch (e) { toast(e.message || 'The class could not be ended', 'err'); }
}

function leaveRoom() {
  ROOM.ended = true;
  stopListening();
  ['heartbeat', 'poll', 'flushTimer'].forEach(function (key) {
    if (ROOM[key]) { clearInterval(ROOM[key]); ROOM[key] = null; }
  });
  const role = (API.user() || {}).role;
  if (window.history && window.history.length > 1) window.history.back();
  else location.href = homeOf(role);
}

async function downloadTranscript() {
  if (!ROOM.lesson) return;
  try {
    const result = await API.get('/live-lessons/' + encodeURIComponent(ROOM.lesson.id) + '/transcript');
    downloadText('live-class-' + ROOM.code + '.txt',
      (result.lesson ? (result.lesson.title || 'Live class') + '\n' +
        roomStatusText(result.lesson) + '\n\n' : '') + (result.text || ''));
  } catch (e) { toast(e.message || 'The transcript could not be read', 'err'); }
}

/* ------------------------------------------------------------------ boot --- */
async function openRoom() {
  ROOM.code = roomCode();
  if (!ROOM.code) {
    liveProblem('This link has no class code.',
      'Open the link from the alert you received, or ask the host for it.');
    return;
  }
  if (!API.token()) { rememberRoom(); location.href = '/'; return; }

  let data;
  try {
    data = await API.get('/live-class/' + encodeURIComponent(ROOM.code));
  } catch (e) {
    if (e.status === 401) { rememberRoom(); location.href = '/'; return; }
    if (e.status === 404) {
      liveProblem('That class was not found.', 'The link may be old — ask for a fresh alert.');
      return;
    }
    if (e.status === 403) {
      liveProblem('This class is not for your account.', 'Ask the host to invite you to it.');
      return;
    }
    liveProblem('The room could not be opened.', e.message || '');
    return;
  }

  ROOM.lesson = data.lesson;
  ROOM.me = data.me;
  ROOM.status = (data.lesson && data.lesson.status) || 'scheduled';
  ((data && data.captions) || []).forEach(addCaptionLine);

  renderHead(ROOM.lesson);
  paintRoster((data && data.roster) || []);
  mountVideo(ROOM.lesson);

  /* the host's tools: listen, type, end the class */
  const host = !!(ROOM.me && ROOM.me.host);
  const tools = roomEl('captionTools');
  if (tools) tools.classList.toggle('hidden', !host);
  const state = roomEl('captionState');
  if (state) state.textContent = host ? 'you are the host' : 'live captions';
  if (host && ROOM.status === 'live' && ROOM.queue.length === 0) {
    ROOM.flushTimer = setInterval(flushCaptions, 4000);
  }

  if (ROOM.status === 'ended' || ROOM.status === 'cancelled') {
    finishClass(ROOM.status);
    return;
  }

  beat();
  ROOM.heartbeat = setInterval(beat, 20000);
  ROOM.poll = setInterval(pollCaptions, 2500);
}

function wireRoom() {
  const endButton = roomEl('liveEndBtn');
  if (endButton) endButton.onclick = endClass;
  const leaveButton = roomEl('liveLeaveBtn');
  if (leaveButton) leaveButton.onclick = leaveRoom;
  const micButton = roomEl('captionMicBtn');
  if (micButton) micButton.onclick = startListening;
  const transcriptButton = roomEl('captionDownload');
  if (transcriptButton) transcriptButton.onclick = downloadTranscript;
  const linkButton = roomEl('liveLinkBtn');
  if (linkButton) linkButton.onclick = function () {
    const url = ROOM.lesson && ROOM.lesson.joinUrl;
    if (!url) return;
    const win = window.open(url, '_blank');
    if (win) { try { win.opener = null; } catch (e) {} }
    else toast('Allow pop-ups to open the meeting link.', 'err');
  };
  const form = roomEl('captionForm');
  if (form) form.addEventListener('submit', function (event) {
    event.preventDefault();
    const input = roomEl('captionType');
    const text = String((input && input.value) || '').trim();
    if (!text) return;
    ROOM.queue.push(text);
    if (input) input.value = '';
    flushCaptions();
  });
  /* leaving the tab / closing it should not leave a ghost in the room */
  window.addEventListener('beforeunload', function () {
    if (ROOM.heartbeat) clearInterval(ROOM.heartbeat);
  });
  openRoom();
}

if (document && document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireRoom);
} else {
  wireRoom();
}
