(function () {
  const STORAGE_KEY = 'medinexus_auth_session';
  const ROLE_HOME = {
    admin: 'dashboard.html',
    doctor: 'patients.html',
    nurse: 'patients.html',
    operations: 'dashboard.html',
  };

  const ROLE_ACCESS = {
    admin: ['index.html', 'dashboard.html', 'patients.html', 'companion.html'],
    doctor: ['index.html', 'dashboard.html', 'patients.html', 'companion.html'],
    nurse: ['index.html', 'dashboard.html', 'patients.html', 'companion.html'],
    operations: ['index.html', 'dashboard.html'],
  };

  function apiBase() {
    return window.MEDINEXUS_API_BASE || (
      ['localhost', '127.0.0.1'].includes(window.location.hostname)
        ? 'http://localhost:8000'
        : window.location.origin
    );
  }

  function currentPage() {
    const raw = (window.location.pathname.split('/').pop() || 'index.html').trim();
    return raw || 'index.html';
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.access_token || !parsed.role) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function saveSession(session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function roleHome(role) {
    return ROLE_HOME[role] || 'index.html';
  }

  function isAllowed(role, page) {
    const allowed = ROLE_ACCESS[role] || [];
    return allowed.includes(page);
  }

  function redirectToLogin() {
    const next = encodeURIComponent(currentPage());
    window.location.href = `login.html?next=${next}`;
  }

  function requirePageAccess(allowedRoles) {
    const session = getSession();
    if (!session) {
      redirectToLogin();
      return null;
    }

    const page = currentPage();
    if (Array.isArray(allowedRoles) && allowedRoles.length && !allowedRoles.includes(session.role)) {
      window.location.href = roleHome(session.role);
      return null;
    }

    if (!isAllowed(session.role, page)) {
      window.location.href = roleHome(session.role);
      return null;
    }

    return session;
  }

  function withAuthHeaders(init) {
    const nextInit = init ? { ...init } : {};
    const headers = new Headers(nextInit.headers || {});
    const session = getSession();
    if (session && session.access_token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${session.access_token}`);
    }
    nextInit.headers = headers;
    return nextInit;
  }

  function isApiUrl(input) {
    const url = String(input || '');
    if (!url) return false;
    if (url.startsWith('/api/')) return true;
    return url.startsWith(`${apiBase()}/api/`);
  }

  if (!window.__medinexusFetchPatched) {
    window.__medinexusFetchPatched = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      const requestUrl = typeof input === 'string' ? input : (input && input.url) || '';
      if (isApiUrl(requestUrl)) {
        return originalFetch(input, withAuthHeaders(init));
      }
      return originalFetch(input, init);
    };
  }

  function addNavControls(session) {
    const navRight = document.querySelector('.nav-right');
    if (!navRight || navRight.querySelector('[data-auth-chip]')) return;

    const roleChip = document.createElement('div');
    roleChip.setAttribute('data-auth-chip', 'role');
    roleChip.className = 'status-chip';
    roleChip.textContent = `${session.role.toUpperCase()} · ${session.display_name || session.username}`;

    const logoutBtn = document.createElement('button');
    logoutBtn.setAttribute('data-auth-chip', 'logout');
    logoutBtn.className = 'demo-toggle';
    logoutBtn.style.marginLeft = '0.35rem';
    logoutBtn.textContent = 'Logout';
    logoutBtn.onclick = function () {
      clearSession();
      window.location.href = 'login.html';
    };

    navRight.appendChild(roleChip);
    navRight.appendChild(logoutBtn);
  }

  function applyNavPermissions(session) {
    document.querySelectorAll('.nav-links a').forEach((a) => {
      const href = (a.getAttribute('href') || '').trim();
      if (!href || href.startsWith('http')) return;
      const target = href.split('?')[0];
      if (!isAllowed(session.role, target)) {
        a.parentElement.style.display = 'none';
      }
    });
  }

  function bootstrapPage(options) {
    const cfg = options || {};
    const session = requirePageAccess(cfg.allowedRoles || null);
    if (!session) return null;
    addNavControls(session);
    applyNavPermissions(session);
    return session;
  }

  async function login(username, password) {
    const res = await fetch(`${apiBase()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `Login failed (${res.status})`);
    }
    const session = await res.json();
    saveSession(session);
    return session;
  }

  window.mnxAuth = {
    apiBase,
    login,
    getSession,
    saveSession,
    clearSession,
    roleHome,
    bootstrapPage,
    requirePageAccess,
    applyNavPermissions,
    addNavControls,
  };
})();
