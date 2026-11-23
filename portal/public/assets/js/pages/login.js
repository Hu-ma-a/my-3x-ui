export const meta = { title: '登录', auth: false, admin: false };

function safeNext(value) {
  if (typeof value !== 'string') return '/dashboard';
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

export async function render(root, ctx) {
  const portalName = (ctx.config && ctx.config.portalName) || '用户中心';
  const next = safeNext(ctx.query && ctx.query.next);

  root.innerHTML = `
    <div class="auth p-login">
      <div class="auth-inner">
        <div class="p-auth-head">
          <span class="brand p-auth-brand">
            <span class="brand-dot" aria-hidden="true"></span>
            <span>${ctx.ui.escape(portalName)}</span>
          </span>
          <h1 class="p-auth-title">登录</h1>
          <p class="p-auth-sub">登录后管理套餐、查看流量与订单。</p>
        </div>
        <form id="p-login-form" novalidate>
          <div class="field">
            <label class="field-label" for="p-login-username">用户名</label>
            <input class="input" id="p-login-username" name="username" autocomplete="username"
              placeholder="请输入用户名" maxlength="32" />
            <div class="error-text" data-error="username"></div>
          </div>
          <div class="field">
            <label class="field-label" for="p-login-password">密码</label>
            <input class="input" id="p-login-password" name="password" type="password"
              autocomplete="current-password" placeholder="请输入密码" maxlength="72" />
            <div class="error-text" data-error="password"></div>
          </div>
          <div class="error-text" id="p-login-error" role="alert"></div>
          <button class="btn btn-primary btn-lg btn-block" id="p-login-submit" type="submit">登录</button>
        </form>
        <div class="p-auth-links">
          <a class="link-btn p-tap" href="#/register">还没有账号？立即注册</a>
          <a class="link-btn p-tap" href="#/">返回首页</a>
        </div>
      </div>
    </div>`;

  const form = root.querySelector('#p-login-form');
  const submit = root.querySelector('#p-login-submit');
  const usernameInput = root.querySelector('#p-login-username');
  const passwordInput = root.querySelector('#p-login-password');
  const formError = root.querySelector('#p-login-error');

  function setFieldError(name, message) {
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
    submit.textContent = loading ? '登录中…' : '登录';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    let valid = true;
    if (!username) {
      setFieldError('username', '请输入用户名');
      valid = false;
    }
    if (!password) {
      setFieldError('password', '请输入密码');
      valid = false;
    }
    if (!valid) return;

    setLoading(true);
    try {
      const data = await ctx.api.login({ username, password });
      try {
        await ctx.refreshMe();
      } catch {
        if (data && data.user && ctx.store && typeof ctx.store.setUser === 'function') ctx.store.setUser(data.user);
      }
      ctx.toast('登录成功', 'success');
      ctx.navigate(next);
    } catch (err) {
      if (err && err.code === 'too_many_attempts') {
        formError.textContent = '登录尝试过于频繁，请 15 分钟后再试';
      } else if (err && err.code === 'account_disabled') {
        formError.textContent = '账号已被禁用，请联系管理员';
      } else if (err && err.code === 'validation_error' && err.message) {
        formError.textContent = err.message;
      } else {
        formError.textContent = (err && err.message) || '登录失败，请检查用户名和密码';
      }
      setLoading(false);
    }
  });
}
