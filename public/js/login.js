/* Login logic for /t/<slug> pages. Self-registration is disabled —
   accounts are created by super admin / tenant admins / supervisors. */
const slug = location.pathname.replace(/^\/t\//, '').split('/')[0];
let tenantInfo = null;

/* Where a learner lands again after being signed out: the app sends them back
   here when the program is minimised, closed or left (see startStudentLock). */
try { localStorage.setItem('cbp_login', location.pathname); } catch (e) {}

/* Say why the sign-in page appeared again, so a learner never wonders whether
   something broke. `left` is set by the app when it signs a student out. */
/* Request browser permissions for location, microphone, and camera */
try {
  /* Microphone - for dictation/recognizer feature */
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    /* Stop the stream immediately - we just want to check permission */
    micStream.getTracks().forEach(t => t.stop());
  }
  /* Camera - for potential video features */
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
    /* Stop the stream immediately - we just want to check permission */
    camStream.getTracks().forEach(t => t.stop());
  }
  /* Location - for geolocation features */
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      /* success */ () => { /* permission granted */ },
      /* error */ () => { /* permission denied or unavailable */ }
    );
  }
} catch (e) {
  /* Permissions may be blocked or unavailable - continue anyway */
}

/* Show account install prompt for students, accounts admin, and supervisors */
const userRole = user ? user.role : '';
const allowedRoles = ['student', 'tenant_admin', 'supervisor'];
const isAllowedRole = allowedRoles.includes(userRole);
const installPrompt = isAllowedRole && tenantInfo && tenantInfo.tenant.logo;
if (installPrompt) {
  const promptHtml = '<div id="accountInstallPrompt" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.8);z-index:9999;color:#fff;padding:20px;text-align:center;">' +
    '<div style="background:#fff;color:#000;max-width:300px;margin:20px auto;padding:20px;border-radius:8px;">' +
    '<img src="' + esc(tenantInfo.tenant.logo) + '" alt="Account logo" style="width:64px;height:64px;border-radius:50%;margin-bottom:10px;"></div>' +
    '<h3>Add to Home Screen</h3>' +
    '<p>Would you like to add this account\'s portal to your home screen?</p>' +
    '<div style="margin-top:20px;display:flex;gap:10px;justify-content:center;">' +
    '<button id="installYes" style="background:#24508c;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:yes;">Yes, Add</button>' +
    '<button id="installNo" style="background:#666;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:no;">No</button>' +
    '</div>' +
    '</div>';
  document.body.insertAdjacentHTML('afterbegin', promptHtml);
  document.getElementById('installYes').addEventListener('click', function() {
    /* Install the web app for this account */
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(function(registration) {
        registration.showNotification('Portal Added', {
          body: 'The ' + esc(tenantInfo.tenant.name) + ' portal has been added to your home screen.',
          icon: '/api/public/tenant/' + encodeURIComponent(slug) + '/icon'
        });
      });
    }
    window.location.href = '/';
  });
  document.getElementById('installNo').addEventListener('click', function() {
    document.getElementById('accountInstallPrompt').remove();
  });
}
function showLeftNote() {
  const box = document.getElementById('leftBanner');
  if (!box) return;
  const why = (/[?&]left=([a-z]+)/.exec(location.search) || [])[1] || '';
  if (!why) return;
  box.textContent = why === 'tab'
    ? 'The program was opened in another tab, so you were signed out. Sign in again to continue.'
    : why === 'expired'
      ? 'Your session is no longer active. Sign in again to continue.'
      : 'You left the program screen, so you were signed out. Sign in again to continue.';
  box.classList.remove('hidden');
}

async function init() {
  showLeftNote();
  try {
    tenantInfo = await API.get('/public/tenant/' + encodeURIComponent(slug));
  } catch (e) {
    document.getElementById('tenantName').textContent = 'Portal not found';
    return;
  }
  document.getElementById('tenantName').textContent = tenantInfo.tenant.name;
  document.getElementById('portalTitle').textContent = tenantInfo.portal.name;
  document.title = tenantInfo.tenant.name + ' — Login';
  /* The account's own logo becomes the tab, desktop, taskbar and Android
     home-screen icon for this portal. The URL carries the logo's fingerprint, so
     a logo change (or a deployment update) asks the browser and the launcher to
     refresh the icon straight away. */
  const iconBase = '/api/public/tenant/' + encodeURIComponent(slug);
  let iconVersion = '2026-11-08-live-room-fixes';
  try {
    const iconRes = await fetch(iconBase + '/icon', { cache: 'no-store' });
    const fp = iconRes.headers.get('X-CBP-Icon');
    if (fp) iconVersion = fp;
  } catch (e) { /* the build marker is a fine fallback */ }
  function addLink(rel, href) {
    const link = document.createElement('link');
    link.rel = rel;
    link.href = href;
    document.head.appendChild(link);
  }
  addLink('icon', iconBase + '/icon?v=' + encodeURIComponent(iconVersion));
  addLink('apple-touch-icon', iconBase + '/icon.png?v=' + encodeURIComponent(iconVersion));
  addLink('manifest', iconBase + '/manifest.webmanifest');


  if (tenantInfo.tenant.logo) {
    const i = document.getElementById('logoTenant');
    i.src = tenantInfo.tenant.logo; i.classList.remove('hidden');
  }
  applyThemeColor(tenantInfo.branding && tenantInfo.branding.themeColor);

  /* faint account logo on the right of the login card: the account's own logo,
     or a monogram of the account name when no logo has been uploaded */
  const mark = document.getElementById('loginMark');
  if (mark) {
    const colour = themeIsHex(tenantInfo.branding.themeColor) ? tenantInfo.branding.themeColor : '#24508c';
    mark.src = tenantInfo.tenant.logo || portalMarkSrc(tenantInfo.tenant.name, colour);
    mark.alt = tenantInfo.tenant.name + ' logo';
    mark.classList.remove('hidden');
  }
  const closed = !tenantInfo.portal.active;
  document.getElementById('closedBanner').classList.toggle('hidden', !closed);
  loadTopPerformers();
}

/* Small live ranking on the left of the account login card. Profile photos
   are used when the server exposes one; otherwise we paint initials. */
function performerInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
function renderTopPerformers(rows) {
  const box = document.getElementById('loginPerformers');
  const grid = document.getElementById('loginPerformersGrid');
  if (!box || !grid) return;
  if (!Array.isArray(rows) || !rows.length) {
    box.classList.add('hidden');
    return;
  }
  grid.innerHTML = rows.slice(0, 10).map(function (performer, index) {
    const rank = Number(performer.rank) || index + 1;
    /* the chip carries the number the ranking uses; the tooltip spells out the
       marks and the coverage behind it (a mark is a dash until written work is
       scored, so coverage alone can earn a place on this list) */
    const marks = performer.marks == null ? '—' : performer.marks + '%';
    const coverage = performer.coverage == null ? '—' : performer.coverage + '%';
    const score = performer.score == null ? '' : performer.score + '%';
    const title = (performer.name || 'Learner') +
      ' — marks ' + marks + ' · coverage ' + coverage +
      (performer.className ? ' — ' + performer.className : '');
    // Show school logo instead of student photo for best performers
    const schoolLogo = tenantInfo.tenant.logo || '/images/default-school-logo.png';
    return '<div class="login-performer rank-' + rank + '" title="' + esc(title) + '">' +
      '<span class="lp-avatar-wrap">' +
        '<span class="lp-avatar"><span class="lp-initials">' +
          esc(performerInitials(performer.name)) +
          '<img src="' + esc(schoolLogo) + '" alt="School logo" class="lp-school-logo">' +
        '</span>' +
        '<span class="lp-rank">' + rank + '</span>' +
      '</span>' +
      '<span class="lp-name">' + esc(performer.displayName || performer.name || 'Learner') + '</span>' +
      (score ? '<span class="lp-score">' + esc(score) + '</span>' : '') +
    '</div>';
  }).join('');
  grid.querySelectorAll('img').forEach(function (img) {
    img.onerror = function () { img.remove(); };
  });
  box.classList.remove('hidden');
}
async function loadTopPerformers() {
  try {
    const data = await API.get('/public/top-performers?slug=' + encodeURIComponent(slug) +
      '&_=' + Date.now());
    renderTopPerformers(data.performers || []);
  } catch (e) {
    /* The login form must stay usable even if the ranking cannot load. */
  }
}

const pwToggle = document.getElementById('pwToggle');
if (pwToggle) {
  pwToggle.addEventListener('click', function () {
    const pw = document.getElementById('liPw');
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    pwToggle.textContent = show ? 'Hide' : 'Show';
  });
}


/* Set account favicon - called from init */
function setAccountFavicon() {
  const favicon = document.getElementById('page-favicon');
  if (!favicon) {
    const link = document.createElement('link');
    link.id = 'page-favicon';
    link.rel = 'icon';
    link.href = '/images/default-favicon.png';
    link.sizes = '32x32';
    document.head.appendChild(link);
    return;
  }
  if (tenantInfo && tenantInfo.tenant.logo) {
    favicon.href = tenantInfo.tenant.logo + '?v=' + new Date().getTime();
    favicon.sizes = '32x32';
  } else {
    favicon.href = '/images/default-favicon.png';
  }
}

/* Set account favicon on login page load */
setAccountFavicon();

document.getElementById('loginForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  try {
    const data = await API.post('/auth/login', {
      slug: slug,
      identifier: document.getElementById('liId').value,
      password: document.getElementById('liPw').value
    });
    API.setToken(data.token);
    API.setUser(data.user);
    /* Somebody who arrived from a live-class alert goes straight back into that
       room; only that one safe shape is honoured. */
    const next = takeNextClassLink();
    location.href = next || (data.user.role === 'tenant_admin' ? '/admin' : '/app');
  } catch (err) { toast(err.message, 'err'); }
});

/* The join link a person was sent (written by /live when their session expired,
   or by the alert that opened the class). Read once, then forgotten. */
function takeNextClassLink() {
  let next = '';
  try {
    next = localStorage.getItem('cbp_next') || '';
    localStorage.removeItem('cbp_next');
  } catch (e) { return ''; }
  return /^\/live\?code=[A-Za-z0-9_-]{4,12}$/.test(next) ? next : '';
}

init();

