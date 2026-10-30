/* Login logic for /t/<slug> pages. Self-registration is disabled —
   accounts are created by super admin / tenant admins / supervisors. */
const slug = location.pathname.replace(/^\/t\//, '').split('/')[0];
let tenantInfo = null;

async function init() {
  try {
    tenantInfo = await API.get('/public/tenant/' + encodeURIComponent(slug));
  } catch (e) {
    document.getElementById('tenantName').textContent = 'Portal not found';
    return;
  }
  document.getElementById('tenantName').textContent = tenantInfo.tenant.name;
  document.getElementById('portalTitle').textContent = tenantInfo.portal.name;
  document.title = tenantInfo.tenant.name + ' — Login';
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
    return '<div class="login-performer rank-' + rank + '" title="' + esc(title) + '">' +
      '<span class="lp-avatar-wrap">' +
        '<span class="lp-avatar"><span class="lp-initials">' +
          esc(performerInitials(performer.name)) + '</span>' +
          (performer.photo ? '<img src="' + esc(performer.photo) + '" alt="">' : '') +
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
    location.href = data.user.role === 'tenant_admin' ? '/admin' : '/app';
  } catch (err) { toast(err.message, 'err'); }
});

init();

