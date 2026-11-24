import { api, ApiError } from './core/api.js';
import { store } from './core/store.js';
import { ui } from './core/ui.js';
import { createRouter, navigate, parseLocation } from './core/router.js';

const ROUTES = [
  { path: '/login', load: () => import('./pages/login.js') },
  { path: '/register', load: () => import('./pages/register.js') },
  { path: '/dashboard', load: () => import('./pages/dashboard.js') },
  { path: '/plans', load: () => import('./pages/plans.js') },
  { path: '/recharge', load: () => import('./pages/recharge.js') },
  { path: '/orders', load: () => import('./pages/orders.js') },
  { path: '/account', load: () => import('./pages/account.js') },
  { path: '/pay/mock', load: () => import('./pages/mock-pay.js') },
  { path: '/admin', load: () => import('./admin/overview.js') },
  { path: '/admin/users', load: () => import('./admin/users.js') },
  { path: '/admin/admins', load: () => import('./admin/admins.js') },
  { path: '/admin/plans', load: () => import('./admin/plans.js') },
  { path: '/admin/orders', load: () => import('./admin/orders.js') },
  { path: '/admin/recharges', load: () => import('./admin/recharges.js') },
  { path: '/admin/settings', load: () => import('./admin/settings.js') },
];

const NAV_USER = [
  { path: '/dashboard', label: '我的账号' },
  { path: '/plans', label: '购买套餐' },
  { path: '/recharge', label: '在线充值' },
  { path: '/orders', label: '我的订单' },
  { path: '/account', label: '账号设置' },
];

const NAV_ADMIN = [
  { path: '/admin', label: '概览' },
  { path: '/admin/users', label: '用户管理' },
  { path: '/admin/admins', label: '管理员' },
  { path: '/admin/plans', label: '套餐管理' },
  { path: '/admin/orders', label: '订单管理' },
  { path: '/admin/recharges', label: '充值记录' },
  { path: '/admin/settings', label: '系统设置' },
];

const THEME_KEY = 'portal-theme';
const ICON_SUN =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.3M12 19.2v2.3M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.3M19.2 12h2.3M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z"/></svg>';

const appRoot = document.getElementById('app');
let currentPath = '/';

function readTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // 隐私模式下 localStorage 不可用，退回系统偏好。
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // 忽略存储失败。
  }
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

function portalName() {
  return ui.portalName(store.config?.portalName);
}

function renderShell() {
  appRoot.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="topbar-inner">
          <a class="brand" href="#/dashboard">
            <span class="brand-dot" aria-hidden="true"></span>
            <span class="brand-name" id="brand-name"></span>
          </a>
          <nav class="nav" id="main-nav" aria-label="主导航"></nav>
          <div class="actions" id="header-actions"></div>
        </div>
      </header>
      <main class="main">
        <div class="page" id="app-main"></div>
      </main>
      <footer class="footer">
        <div class="footer-inner">
          <span id="footer-brand"></span>
          <span class="row text-sm" style="gap: 10px">
            <a href="#/dashboard">用户中心</a>
            <span aria-hidden="true">·</span>
            <span>安全稳定的节点服务</span>
          </span>
        </div>
      </footer>
    </div>`;
}

function isNavActive(path, itemPath) {
  if (path === itemPath) return true;
  if (itemPath === '/admin' || itemPath === '/dashboard') return false;
  return path.startsWith(`${itemPath}/`);
}

function renderChrome(path) {
  const nav = document.getElementById('main-nav');
  const actions = document.getElementById('header-actions');
  const brandName = document.getElementById('brand-name');
  const footerBrand = document.getElementById('footer-brand');
  if (!nav || !actions || !brandName) return;
  brandName.textContent = portalName();
  if (footerBrand) footerBrand.textContent = `© ${new Date().getFullYear()} ${portalName()}`;

  const inAdmin = path.startsWith('/admin');
  let items = [];
  if (store.user) {
    items = inAdmin ? [...NAV_ADMIN] : [...NAV_USER];
    if (store.user.role === 'admin') {
      items.push(inAdmin ? { path: '/dashboard', label: '用户中心' } : { path: '/admin', label: '管理后台' });
    }
  }
  nav.innerHTML = items
    .map((item) => `<a class="nav-link ${isNavActive(path, item.path) ? 'active' : ''}" href="#${item.path}">${ui.escape(item.label)}</a>`)
    .join('');

  const dark = document.documentElement.dataset.theme === 'dark';
  const themeButton = `<button class="btn btn-icon" id="theme-toggle" type="button" title="${dark ? '切换到浅色' : '切换到深色'}" aria-label="切换主题">${dark ? ICON_SUN : ICON_MOON}</button>`;

  if (store.user) {
    actions.innerHTML = `
      <span class="balance"><span>余额</span><span class="balance-value">${ui.money(store.user.balanceCents)}</span></span>
      ${store.user.role === 'admin' ? '<span class="badge badge-info">管理员</span>' : ''}
      ${themeButton}
      <button class="btn btn-ghost btn-sm" id="logout-btn" type="button">退出</button>`;
  } else {
    const authPage = path === '/login' || path === '/register';
    actions.innerHTML = authPage
      ? themeButton
      : `${themeButton}
      <a class="btn btn-ghost btn-sm" href="#/login">登录</a>
      <a class="btn btn-primary btn-sm" href="#/register">注册</a>`;
  }
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    toggleTheme();
    renderChrome(currentPath);
  });
  document.getElementById('logout-btn')?.addEventListener('click', doLogout);
}

async function doLogout() {
  try {
    await api.logout();
  } catch (err) {
    console.warn('退出登录请求失败', err);
  }
  store.clear();
  ui.toast('已退出登录', 'success');
  navigate('/login');
}

function createContext(params, query) {
  const cleanups = [];
  return {
    api,
    ui,
    store,
    me: store.user,
    config: store.config,
    status: store.status,
    params,
    query,
    navigate,
    toast: ui.toast,
    onCleanup(fn) {
      if (typeof fn === 'function') cleanups.push(fn);
    },
    async refreshMe() {
      const data = await api.me();
      store.setStatus(data);
      return data;
    },
    __cleanup() {
      for (const fn of cleanups.splice(0)) {
        try {
          fn();
        } catch (err) {
          console.warn('页面清理失败', err);
        }
      }
    },
  };
}

function renderRouteError(container, err) {
  if (!container) return;
  const message = err instanceof ApiError ? err.message : String(err?.message || err);
  container.innerHTML = `
    <div class="alert alert-danger mb-2">${ui.escape(message || '页面加载失败')}</div>
    <button type="button" class="btn btn-secondary btn-sm" id="route-retry">重新加载</button>`;
  document.getElementById('route-retry')?.addEventListener('click', () => window.location.reload());
}

function showFatal(message) {
  appRoot.innerHTML = `<div class="shell"><main class="main"><div class="page" style="text-align: center">
    <p class="eyebrow">服务暂不可用</p>
    <h1 class="display" style="margin-top: 12px">门户暂时无法连接</h1>
    <p class="lede" style="margin: 14px auto 26px">${ui.escape(message || '请稍后重试，或检查后端服务是否已启动。')}</p>
    <button class="btn btn-primary" type="button" onclick="window.location.reload()">重新加载</button>
  </div></main></div>`;
}

async function handleRoute({ matched, location }) {
  currentPath = location.path;

  if (location.path === '/') {
    navigate(store.user ? '/dashboard' : '/login', { replace: true });
    return;
  }

  let mod;
  let meta = {};
  let params = {};
  if (matched) {
    params = matched.params;
    try {
      mod = await matched.route.load();
    } catch (err) {
      renderRouteError(document.getElementById('app-main'), err);
      return;
    }
    meta = mod.meta || {};
  } else {
    try {
      mod = await import('./pages/not-found.js');
      meta = mod.meta || {};
    } catch {
      renderRouteError(document.getElementById('app-main'), new Error('页面不存在'));
      return;
    }
  }

  if (location.path === '/login' && store.user && !meta.admin) {
    navigate(location.query.next || '/dashboard', { replace: true });
    return;
  }
  if (meta.admin) {
    if (!store.user) {
      navigate(`/login?next=${encodeURIComponent(location.path)}`);
      return;
    }
    if (store.user.role !== 'admin') {
      ui.toast('需要管理员权限', 'error');
      navigate('/dashboard');
      return;
    }
  } else if (meta.auth && !store.user) {
    navigate(`/login?next=${encodeURIComponent(location.path)}`);
    return;
  }

  currentPath = location.path;
  renderChrome(location.path);
  document.body.dataset.area = location.path.startsWith('/admin') ? 'admin' : 'user';
  // 每次路由换一个全新容器，页面在 root 上绑定的事件监听随旧节点一起丢弃。
  const previousMain = document.getElementById('app-main');
  if (!previousMain) return;
  const main = previousMain.cloneNode(false);
  main.className = location.path.startsWith('/admin') ? 'page page-wide' : 'page';
  previousMain.replaceWith(main);
  main.classList.remove('fade-in');
  void main.offsetWidth;
  main.classList.add('fade-in');

  const ctx = createContext(params, location.query);
  document.title = `${meta.title || '页面'} · ${portalName()}`;

  let dispose = null;
  try {
    dispose = await mod.render(main, ctx);
  } catch (err) {
    ctx.__cleanup();
    if (err instanceof ApiError && err.status === 401) {
      store.clear();
      navigate('/login');
      return;
    }
    renderRouteError(main, err);
    return;
  }

  if (meta.auth) {
    api
      .me()
      .then((data) => store.setStatus(data))
      .catch(() => {});
  }

  return () => {
    ctx.__cleanup();
    if (typeof dispose === 'function') dispose();
  };
}

async function boot() {
  applyTheme(readTheme());
  document.body.dataset.area = 'user';
  renderShell();

  try {
    const config = await api.config();
    store.setConfig(config);
  } catch (err) {
    showFatal(err.message);
    return;
  }

  try {
    const me = await api.me();
    store.setStatus(me);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) {
      console.warn('初始化登录状态失败', err);
    }
  }

  renderChrome(parseLocation().path);
  store.subscribe(() => {
    if (document.getElementById('app-main')) renderChrome(currentPath);
  });

  createRouter({
    routes: ROUTES,
    onRoute: handleRoute,
    onError: (err) => renderRouteError(document.getElementById('app-main'), err),
  });
}

boot();
