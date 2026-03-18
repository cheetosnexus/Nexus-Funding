/* ============================================================
   NEXUS FUNDING — Core JS
   All /api/* calls go to Netlify Functions automatically.
   No separate backend needed — everything runs on Netlify.
   ============================================================ */

// API base — Netlify routes /api/* to the serverless function
const API_BASE = '/api';

/* ══════════════════════════════════════════════════════════
   API CLIENT
   ══════════════════════════════════════════════════════════ */
const Api = (() => {
  let _refreshing = false;
  let _queue      = [];

  function getToken() {
    try { return JSON.parse(localStorage.getItem('nexus_auth') || '{}').accessToken || null; }
    catch { return null; }
  }
  function getRefreshToken() {
    try { return JSON.parse(localStorage.getItem('nexus_auth') || '{}').refreshToken || null; }
    catch { return null; }
  }
  function setAccessToken(t) {
    try {
      const a = JSON.parse(localStorage.getItem('nexus_auth') || '{}');
      a.accessToken = t;
      localStorage.setItem('nexus_auth', JSON.stringify(a));
    } catch {}
  }

  async function request(method, path, body) {
    const token   = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const opts = { method, headers };
    if (body !== undefined) opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(API_BASE + path, opts);
    } catch {
      throw new Error('Cannot connect to API. Check your network connection.');
    }

    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/refresh') {
      if (_refreshing) {
        await new Promise((res, rej) => _queue.push({ res, rej }));
        return request(method, path, body);
      }
      _refreshing = true;
      try {
        const refresh = getRefreshToken();
        if (!refresh) throw new Error('no refresh token');
        const r = await fetch(API_BASE + '/auth/refresh', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: refresh }),
        });
        if (!r.ok) throw new Error('refresh failed');
        const data = await r.json();
        setAccessToken(data.accessToken);
        _queue.forEach(p => p.res()); _queue = [];
        return request(method, path, body);
      } catch {
        _queue.forEach(p => p.rej()); _queue = [];
        Auth.logout();
        window.location.href = '/pages/login.html';
        throw new Error('Session expired');
      } finally { _refreshing = false; }
    }

    if (!res.ok) {
      let err;
      try { err = await res.json(); } catch { err = { error: res.statusText }; }
      throw Object.assign(new Error(err.error || 'Request failed'), { status: res.status, data: err });
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    get:    (path)       => request('GET',    path),
    post:   (path, body) => request('POST',   path, body),
    put:    (path, body) => request('PUT',    path, body),
    patch:  (path, body) => request('PATCH',  path, body),
    delete: (path)       => request('DELETE', path),
  };
})();

/* ══════════════════════════════════════════════════════════
   AUTH
   ══════════════════════════════════════════════════════════ */
const Auth = {
  save(data) {
    localStorage.setItem('nexus_auth', JSON.stringify({
      accessToken:  data.accessToken,
      refreshToken: data.refreshToken,
      user:         data.user,
    }));
  },
  get() {
    try { return JSON.parse(localStorage.getItem('nexus_auth') || '{}'); } catch { return {}; }
  },
  user()    { return this.get().user || null; },
  token()   { return this.get().accessToken || null; },
  isAuth()  { return !!this.token(); },
  isAdmin() {
    const u = this.user();
    return u && (u.role === 'ADMIN' || u.role === 'SUPER_ADMIN');
  },
  logout() { localStorage.removeItem('nexus_auth'); },
  requireAuth() {
    if (!this.isAuth()) { window.location.href = '/pages/login.html'; return false; }
    return true;
  },
  requireAdmin() {
    if (!this.isAuth())  { window.location.href = '/pages/login.html'; return false; }
    if (!this.isAdmin()) { window.location.href = '/pages/dashboard.html'; return false; }
    return true;
  },
};

/* ══════════════════════════════════════════════════════════
   TOAST
   ══════════════════════════════════════════════════════════ */
const Toast = (() => {
  function init() {
    if (!document.getElementById('toast-container')) {
      const c = document.createElement('div');
      c.id = 'toast-container';
      document.body.appendChild(c);
    }
    return document.getElementById('toast-container');
  }
  function show(msg, type = 'info', duration = 4000) {
    const c = init();
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ'}</span><span class="toast-msg">${msg}</span><button class="toast-close" onclick="this.closest('.toast').remove()">×</button>`;
    c.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateX(16px)';
      t.style.transition = 'all .3s';
      setTimeout(() => t.remove(), 300);
    }, duration);
  }
  return {
    success: (m, d) => show(m, 'success', d),
    error:   (m, d) => show(m, 'error',   d),
    info:    (m, d) => show(m, 'info',    d),
    warning: (m, d) => show(m, 'warning', d),
  };
})();

/* ══════════════════════════════════════════════════════════
   MODAL
   ══════════════════════════════════════════════════════════ */
const Modal = {
  open(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
  },
  close(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('open');
    document.body.style.overflow = '';
  },
};

/* ══════════════════════════════════════════════════════════
   FORMAT HELPERS
   ══════════════════════════════════════════════════════════ */
const Fmt = {
  money: (v, dec = 2) => v == null ? '—'
    : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`,
  pct: (v, dec = 2) => v == null ? '—'
    : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(dec)}%`,
  price: (v, symbol = '') => {
    if (v == null) return '—';
    const s = symbol || '';
    const dp = s.includes('JPY') ? 3
      : ['BTCUSD','US30','US500','US100','DE40','UK100','XAUUSD','USOIL'].includes(s) ? 2 : 5;
    return Number(v).toFixed(dp);
  },
  date:     (v) => v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—',
  dateTime: (v) => v ? new Date(v).toLocaleString() : '—',
  lots:     (v) => Number(v).toFixed(2),
  initials: (u) => u ? `${(u.firstName||'')[0]||''}${(u.lastName||'')[0]||''}`.toUpperCase() : '?',
};

function pnlClass(v) { return Number(v) > 0 ? 'pnl-pos' : Number(v) < 0 ? 'pnl-neg' : 'text-muted'; }
function pnlSign(v)  { return Number(v) >= 0 ? '+' : ''; }

function statusBadge(status) {
  const map = {
    ACTIVE:'badge-green',  PASSED:'badge-cyan',   FUNDED:'badge-gold',
    FAILED:'badge-red',    SUSPENDED:'badge-gray', PENDING:'badge-gold',
    BANNED:'badge-red',    APPROVED:'badge-green', REJECTED:'badge-red',
    PROCESSING:'badge-purple', COMPLETED:'badge-green',
    CHALLENGE_1:'badge-cyan',  CHALLENGE_2:'badge-purple',
    BUY:'badge-green',     SELL:'badge-red',
    OPEN:'badge-cyan',     CLOSED:'badge-gray',
  };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status || '—'}</span>`;
}

function skeleton(h = 80) {
  return `<div class="skeleton" style="height:${h}px;border-radius:10px"></div>`;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ══════════════════════════════════════════════════════════
   LIVE PRICE POLLING
   (No WebSocket needed — polls /api/trading/market/prices)
   ══════════════════════════════════════════════════════════ */
const PriceFeed = (() => {
  let _prices   = {};
  let _handlers = {};
  let _interval = null;

  async function poll() {
    try {
      const data = await Api.get('/trading/market/prices');
      Object.entries(data).forEach(([symbol, tick]) => {
        _prices[symbol] = tick;
        (_handlers[symbol] || []).forEach(fn => fn({ symbol, ...tick }));
        (_handlers['*']    || []).forEach(fn => fn({ symbol, ...tick }));
      });
    } catch {}
  }

  return {
    connect() {
      if (!Auth.isAuth() || _interval) return;
      poll();
      _interval = setInterval(poll, 2000);
    },
    subscribe(symbols) {
      // symbols are subscribed globally in polling
    },
    subscribeAccount(id) {},
    price(sym) { return _prices[sym] || null; },
    on(sym, fn) {
      if (!_handlers[sym]) _handlers[sym] = [];
      _handlers[sym].push(fn);
    },
    off(sym, fn) {
      if (_handlers[sym]) _handlers[sym] = _handlers[sym].filter(h => h !== fn);
    },
    connected() { return !!_interval; },
    stop() { clearInterval(_interval); _interval = null; },
  };
})();

/* ══════════════════════════════════════════════════════════
   SIDEBAR
   ══════════════════════════════════════════════════════════ */
function buildSidebar(activeHref) {
  const el = document.getElementById('sidebar');
  if (!el) return;
  const user = Auth.user();
  const NAV = [
    { href: '/pages/dashboard.html',   label: 'Overview',    icon: '⬡' },
    { href: '/pages/accounts.html',    label: 'Accounts',    icon: '◈' },
    { href: '/pages/trading.html',     label: 'Trading',     icon: '◲' },
    { href: '/pages/payouts.html',     label: 'Payouts',     icon: '⬙' },
    { href: '/pages/leaderboard.html', label: 'Leaderboard', icon: '⬦' },
    { href: '/pages/affiliate.html',   label: 'Affiliate',   icon: '◉' },
    { href: '/pages/settings.html',    label: 'Settings',    icon: '◱' },
  ];
  const adminLink = Auth.isAdmin()
    ? `<a href="/admin/index.html" class="nav-item admin-link" style="margin-top:10px"><span class="nav-icon">⬟</span><span class="nav-label">Admin Panel</span></a>`
    : '';

  el.innerHTML = `
    <div class="sidebar-logo">
      <div class="sidebar-logo-icon">N</div>
      <div class="sidebar-logo-text">NEXUS FUNDING</div>
    </div>
    <nav class="sidebar-nav">
      ${NAV.map(n => `
        <a href="${n.href}" class="nav-item ${activeHref === n.href ? 'active' : ''}">
          <span class="nav-icon">${n.icon}</span>
          <span class="nav-label">${n.label}</span>
        </a>`).join('')}
      ${adminLink}
    </nav>
    <div class="sidebar-user">
      <div class="user-card">
        <div class="user-avatar">${Fmt.initials(user)}</div>
        <div style="flex:1;min-width:0">
          <div class="user-name">${user?.firstName || ''} ${user?.lastName || ''}</div>
          <div class="user-email">${user?.email || ''}</div>
        </div>
      </div>
      <button class="btn-signout" onclick="handleLogout()">Sign Out</button>
    </div>`;
}

function buildTopbar() {
  const el = document.getElementById('topbar');
  if (!el) return;
  el.innerHTML = `
    <button onclick="toggleSidebar()" style="background:transparent;border:none;color:var(--fg2);font-size:20px;cursor:pointer;padding:4px;border-radius:5px;line-height:1">☰</button>
    <div style="flex:1"></div>
    <div class="flex" style="gap:6px;align-items:center;font-size:12px">
      <div class="live-dot" id="conn-dot" style="display:none"></div>
      <span id="conn-label" style="color:var(--green);font-size:11px"></span>
    </div>
    <a href="/pages/notifications.html" style="position:relative;font-size:19px;line-height:1;color:var(--fg2)">
      🔔<span id="notif-badge" class="hidden" style="position:absolute;top:-3px;right:-4px;background:var(--red);color:#fff;border-radius:50%;width:15px;height:15px;font-size:9px;display:flex;align-items:center;justify-content:center;font-weight:700"></span>
    </a>
    <a href="/pages/challenges.html" style="text-decoration:none">
      <button class="btn btn-primary btn-sm">+ New Challenge</button>
    </a>`;
}

function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('collapsed');
  document.getElementById('main-wrap')?.classList.toggle('collapsed');
}

async function handleLogout() {
  try { await Api.post('/auth/logout'); } catch {}
  Auth.logout();
  PriceFeed.stop();
  window.location.href = '/pages/login.html';
}

async function updateNotifBadge() {
  if (!Auth.isAuth()) return;
  try {
    const { count } = await Api.get('/notifications/unread-count');
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    if (count > 0) { badge.textContent = count > 9 ? '9+' : count; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  } catch {}
}

function initPage(activeHref, opts = {}) {
  if (!Auth.requireAuth()) return;
  buildSidebar(activeHref);
  buildTopbar();
  PriceFeed.connect();
  updateNotifBadge();
  setInterval(updateNotifBadge, 30000);
  if (opts.onReady) opts.onReady();
}

/* ══════════════════════════════════════════════════════════
   ADMIN SIDEBAR
   ══════════════════════════════════════════════════════════ */
function buildAdminSidebar(activeTab) {
  const el = document.getElementById('admin-sidebar');
  if (!el) return;
  const user = Auth.user();
  const TABS = [
    { id: 'overview',   label: 'Overview',   icon: '⬡' },
    { id: 'users',      label: 'Users',      icon: '◈' },
    { id: 'accounts',   label: 'Accounts',   icon: '◲' },
    { id: 'trades',     label: 'Trades',     icon: '◎' },
    { id: 'payouts',    label: 'Payouts',    icon: '⬙' },
    { id: 'challenges', label: 'Challenges', icon: '⬦' },
    { id: 'kyc',        label: 'KYC',        icon: '◉' },
    { id: 'audit',      label: 'Audit Log',  icon: '◱' },
  ];
  el.innerHTML = `
    <div style="padding:16px;border-bottom:1px solid var(--border)">
      <div style="font-family:var(--display);font-weight:700;font-size:15px;letter-spacing:.5px;margin-bottom:2px">
        <span style="color:var(--gold)">⬟</span> Admin Panel
      </div>
      <div style="font-size:11px;color:var(--fg3)">${user?.firstName || ''} · ${user?.role || ''}</div>
    </div>
    <nav style="flex:1;padding:10px 8px;overflow-y:auto">
      ${TABS.map(t => `
        <button onclick="loadAdminTab('${t.id}')" class="nav-item ${activeTab === t.id ? 'active' : ''}" id="admin-tab-${t.id}" style="width:100%;text-align:left">
          <span class="nav-icon">${t.icon}</span>
          <span class="nav-label">${t.label}</span>
        </button>`).join('')}
    </nav>
    <div style="padding:10px;border-top:1px solid var(--border)">
      <a href="/pages/dashboard.html">
        <button class="btn btn-ghost btn-sm btn-block">← Back to App</button>
      </a>
    </div>`;
}

function initAdminPage(activeTab) {
  if (!Auth.requireAdmin()) return;
  buildAdminSidebar(activeTab);
}
