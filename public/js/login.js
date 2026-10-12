/* Login + registration logic for /t/<slug> pages. */
const slug = location.pathname.replace(/^\/t\//, '').split('/')[0];
let tenantInfo = null;

function setTab(name) {
  const login = name === 'login';
  document.getElementById('tabLogin').classList.toggle('active', login);
  document.getElementById('tabRegister').classList.toggle('active', !login);
  document.getElementById('loginForm').classList.toggle('hidden', !login);
  document.getElementById('registerForm').classList.toggle('hidden', login);
}
document.getElementById('tabLogin').onclick = function () { setTab('login'); };
document.getElementById('tabRegister').onclick = function () { setTab('register'); };

function syncRoleFields() {
  const role = document.getElementById('rgRole').value;
  const isStudent = role === 'student';
  document.getElementById('studentRow').classList.toggle('hidden', !isStudent);
  document.getElementById('emailRow').classList.toggle('hidden', isStudent);
  document.getElementById('supRow').classList.toggle('hidden',
    !(tenantInfo && tenantInfo.portal.type === 'organization'));
}

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
  if (closed) document.getElementById('registerForm').classList.add('hidden');

  const sel = document.getElementById('rgRole');
  const type = tenantInfo.portal.type;
  if (type === 'schools') sel.innerHTML = '<option value="student">Student</option><option value="teacher">Teacher</option>';
  else if (type === 'organization') sel.innerHTML = '<option value="member">Member / User</option>';
  else sel.innerHTML = '<option value="member">Member</option>';
  syncRoleFields();
  sel.onchange = syncRoleFields;
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

document.getElementById('registerForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const payload = {
    slug: slug,
    role: document.getElementById('rgRole').value,
    fullName: document.getElementById('rgName').value,
    email: document.getElementById('rgEmail').value || undefined,
    studentNumber: document.getElementById('rgNumber').value || undefined,
    className: document.getElementById('rgClass').value || undefined,
    supervisorCode: document.getElementById('rgSup').value || undefined,
    password: document.getElementById('rgPw').value
  };
  const photo = document.getElementById('rgPhoto').files[0];
  try {
    if (photo) {
      if (photo.size > 1500000) throw new Error('Please choose a picture under 1.5 MB');
      payload.photo = await fileToDataUrl(photo);
    }
    const data = await API.post('/auth/register', payload);
    API.setToken(data.token);
    API.setUser(data.user);
    toast('Account created — welcome!', 'ok');
    location.href = '/app';
  } catch (err) { toast(err.message, 'err'); }
});

init();
