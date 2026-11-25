import { AUTH_ICONS, bindPasswordToggle } from '../core/auth-ui.js';

export const meta = { title: '账号设置', auth: true, admin: false };

export async function render(root, ctx) {
  root.innerHTML = loadingHtml();
  let me = ctx.me;
  try {
    const latest = await ctx.refreshMe();
    if (latest && latest.user) me = latest.user;
  } catch (err) {
    if (err && err.code === 'unauthorized') {
      ctx.navigate('/login');
      return;
    }
    if (!me) {
      root.innerHTML = errorHtml(err);
      return;
    }
  }
  if (!me) {
    root.innerHTML = errorHtml({ message: '未获取到账号信息，请重新登录' });
    return;
  }

  root.innerHTML = pageHtml(me);
  bindEvents();

  function pageHtml(user) {
    const statusBadge = user.status === 'disabled'
      ? '<span class="badge badge-danger">已禁用</span>'
      : '<span class="badge badge-success">正常</span>';
    return `
      <div class="p-account">
        <div class="page-head">
          <span class="pill-label">账号</span>
          <h1 class="page-title">账号设置</h1>
          <p class="page-desc">查看账号信息、修改密码或退出登录。</p>
        </div>
        <div class="card-grid cols-2 p-account-grid">
          <section class="card p-account-info">
            <div class="card-head">
              <h2 class="card-title">账号信息</h2>
              ${statusBadge}
            </div>
            <div class="card-body">
              <dl class="kv p-account-kv">
                <dt>用户名</dt>
                <dd>${ctx.ui.escape(user.username || '—')}</dd>
                <dt>邮箱</dt>
                <dd>${user.email ? ctx.ui.escape(user.email) : '未设置'}</dd>
                <dt>注册时间</dt>
                <dd>${user.createdAt ? ctx.ui.dateTime(user.createdAt) : '—'}</dd>
                <dt>上次登录</dt>
                <dd>${user.lastLoginAt ? ctx.ui.dateTime(user.lastLoginAt) : '—'}</dd>
                <dt>账户余额</dt>
                <dd class="p-balance-text">${ctx.ui.money(user.balanceCents || 0)}</dd>
              </dl>
            </div>
          </section>
          <section class="card p-account-password">
            <div class="card-head">
              <h2 class="card-title">修改密码</h2>
            </div>
            <div class="card-body">
              <p class="card-desc p-account-hint">修改成功后其他设备会退出登录。</p>
              <form id="p-account-password-form" class="p-account-form" novalidate>
                <div class="field">
                  <label class="field-label" for="p-account-current">当前密码</label>
                  <div class="auth-input">
                    <span class="auth-input-icon">${AUTH_ICONS.lock}</span>
                    <input class="input" id="p-account-current" type="password" autocomplete="current-password"
                      placeholder="请输入当前密码" maxlength="72" />
                    <button type="button" class="auth-eye" data-eye="p-account-current" aria-label="显示密码">
                      ${AUTH_ICONS.eye}${AUTH_ICONS.eyeOff}
                    </button>
                  </div>
                  <div class="error-text" data-error="currentPassword"></div>
                </div>
                <div class="field">
                  <label class="field-label" for="p-account-new">新密码</label>
                  <div class="auth-input">
                    <span class="auth-input-icon">${AUTH_ICONS.lock}</span>
                    <input class="input" id="p-account-new" type="password" autocomplete="new-password"
                      placeholder="8–72 位字符" maxlength="72" />
                    <button type="button" class="auth-eye" data-eye="p-account-new" aria-label="显示密码">
                      ${AUTH_ICONS.eye}${AUTH_ICONS.eyeOff}
                    </button>
                  </div>
                  <div class="error-text" data-error="newPassword"></div>
                </div>
                <div class="field">
                  <label class="field-label" for="p-account-confirm">确认新密码</label>
                  <div class="auth-input">
                    <span class="auth-input-icon">${AUTH_ICONS.lock}</span>
                    <input class="input" id="p-account-confirm" type="password" autocomplete="new-password"
                      placeholder="请再次输入新密码" maxlength="72" />
                    <button type="button" class="auth-eye" data-eye="p-account-confirm" aria-label="显示密码">
                      ${AUTH_ICONS.eye}${AUTH_ICONS.eyeOff}
                    </button>
                  </div>
                  <div class="error-text" data-error="confirmPassword"></div>
                </div>
                <div class="error-text" id="p-account-error" role="alert"></div>
                <button class="btn btn-primary btn-block" id="p-account-submit" type="submit">保存新密码</button>
              </form>
            </div>
          </section>
        </div>
        <section class="card p-account-logout">
          <div class="card-body p-logout-row">
            <div class="p-logout-main">
              <div class="row-title">退出登录</div>
              <div class="row-sub">退出后需要重新输入用户名和密码才能访问门户。</div>
            </div>
            <button class="btn btn-danger-ghost p-tap" type="button" data-action="logout" id="p-logout-btn">退出登录</button>
          </div>
        </section>
      </div>`;
  }

  function bindEvents() {
    const form = root.querySelector('#p-account-password-form');
    const submit = root.querySelector('#p-account-submit');
    const currentInput = root.querySelector('#p-account-current');
    const newInput = root.querySelector('#p-account-new');
    const confirmInput = root.querySelector('#p-account-confirm');
    const formError = root.querySelector('#p-account-error');
    const logoutBtn = root.querySelector('#p-logout-btn');

    bindPasswordToggle(root.querySelector('[data-eye="p-account-current"]'), currentInput);
    bindPasswordToggle(root.querySelector('[data-eye="p-account-new"]'), newInput);
    bindPasswordToggle(root.querySelector('[data-eye="p-account-confirm"]'), confirmInput);

    function setError(name, message) {
      const el = root.querySelector(`[data-error="${name}"]`);
      if (el) el.textContent = message || '';
    }

    function clearErrors() {
      root.querySelectorAll('.error-text').forEach((el) => {
        el.textContent = '';
      });
    }

    function setLoading(loading) {
      submit.disabled = loading;
      submit.classList.toggle('btn-loading', loading);
      submit.textContent = loading ? '保存中…' : '保存新密码';
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors();
      const currentPassword = currentInput.value;
      const newPassword = newInput.value;
      const confirmPassword = confirmInput.value;
      const errors = {};
      if (!currentPassword) errors.currentPassword = '请输入当前密码';
      if (!newPassword) {
        errors.newPassword = '请输入新密码';
      } else if (newPassword.length < 8 || newPassword.length > 72) {
        errors.newPassword = '密码长度需为 8–72 个字符';
      } else if (newPassword === currentPassword) {
        errors.newPassword = '新密码不能与当前密码相同';
      }
      if (confirmPassword !== newPassword) errors.confirmPassword = '两次输入的密码不一致';
      const names = Object.keys(errors);
      if (names.length > 0) {
        names.forEach((name) => setError(name, errors[name]));
        return;
      }

      setLoading(true);
      try {
        await ctx.api.changePassword({ currentPassword, newPassword });
        ctx.toast('密码修改成功，请使用新密码重新登录', 'success');
        form.reset();
        try {
          await ctx.api.logout();
        } catch {
          // 会话已失效时忽略退出请求错误。
        }
        if (ctx.store && typeof ctx.store.clear === 'function') ctx.store.clear();
        ctx.navigate('/login');
      } catch (err) {
        if (err && err.code === 'unauthorized') {
          ctx.navigate('/login');
          return;
        }
        if (err && err.code === 'validation_error' && err.message) {
          if (err.message.includes('当前密码') || err.message.includes('原密码')) setError('currentPassword', err.message);
          else if (err.message.includes('密码')) setError('newPassword', err.message);
          else formError.textContent = err.message;
        } else if (err && err.code === 'invalid_credentials') {
          setError('currentPassword', '当前密码不正确');
        } else {
          formError.textContent = (err && err.message) || '密码修改失败，请稍后重试';
        }
      } finally {
        setLoading(false);
      }
    });

    logoutBtn.addEventListener('click', async () => {
      const confirmed = await ctx.ui.confirm({
        title: '退出登录',
        content: '确定要退出当前账号吗？',
        okText: '退出登录',
        danger: true,
      });
      if (!confirmed) return;
      logoutBtn.disabled = true;
      try {
        await ctx.api.logout();
      } catch (err) {
        if (!err || err.code !== 'unauthorized') {
          logoutBtn.disabled = false;
          ctx.toast((err && err.message) || '退出登录失败，请稍后重试', 'error');
          return;
        }
      }
      if (ctx.store && typeof ctx.store.clear === 'function') ctx.store.clear();
      ctx.toast('已退出登录', 'success');
      ctx.navigate('/login');
    });
  }

  function loadingHtml() {
    return `<div class="loading-block">${ctx.ui.spinner()}<span class="text-muted text-sm">正在加载账号信息…</span></div>`;
  }

  function errorHtml(err) {
    const message = (err && err.message) || '加载失败，请稍后重试';
    return `<div class="p-error">
      <section class="card">
        <div class="card-body">
          <div class="alert alert-danger">${ctx.ui.escape(message)}</div>
          <div class="row mt-2">
            <a class="btn btn-primary" href="#/login">重新登录</a>
            <a class="btn btn-secondary" href="#/dashboard">返回我的账号</a>
          </div>
        </div>
      </section>
    </div>`;
  }
}
