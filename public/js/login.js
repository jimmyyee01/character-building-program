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
  if (tenantInfo.branding.programLogo) {
    const i = document.getElementById('logoProgram');
    i.src = tenantInfo.branding.programLogo; i.classList.remove('hidden');
  }
  const closed = !tenantInfo.portal.active;
  document.getElementById('closedBanner').classList.toggle('hidden', !closed);
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

