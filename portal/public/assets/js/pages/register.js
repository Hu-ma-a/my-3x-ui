export const meta = { title: '注册', auth: false, admin: false };

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function render(root, ctx) {
  const portalName = (ctx.config && ctx.config.portalName) || '用户中心';

  if (ctx.config && ctx.config.registrationEnabled === false) {
    root.innerHTML = `
      <div class="auth p-register">
        <div class="auth-inner">
          <div class="p-auth-head">
            <span class="brand p-auth-brand">
              <span class="brand-dot" aria-hidden="true"></span>
              <span>${ctx.ui.escape(portalName)}</span>
            </span>
            <h1 class="p-auth-title">注册已关闭</h1>
            <p class="p-auth-sub">当前门户暂未开放注册，请联系管理员开通账号。</p>
          </div>
          <div class="alert alert-info">注册通道关闭期间，已有账号仍可正常登录。</div>
          <div class="p-auth-actions">
            <a class="btn btn-primary btn-lg btn-block" href="#/login">返回登录</a>
            <a class="link-btn p-tap" href="#/">返回首页</a>
          </div>
        </div>
      </div>`;
    return;
  }

  root.innerHTML = `
    <div class="auth p-register">
      <div class="auth-inner">
        <div class="p-auth-head">
          <span class="brand p-auth-brand">
            <span class="brand-dot" aria-hidden="true"></span>
            <span>${ctx.ui.escape(portalName)}</span>
          </span>
          <h1 class="p-auth-title">创建账号</h1>
          <p class="p-auth-sub">注册后即可购买套餐、查看订阅。</p>
        </div>
        <form id="p-register-form" novalidate>
          <div class="field">
            <label class="field-label" for="p-register-username">用户名</label>
            <input class="input" id="p-register-username" name="username" autocomplete="username"
              placeholder="3–32 位字母、数字或 _ . -" maxlength="32" />
            <div class="error-text" data-error="username"></div>
          </div>
          <div class="field">
            <label class="field-label" for="p-register-email">邮箱 <span class="optional">（选填）</span></label>
            <input class="input" id="p-register-email" name="email" type="email" autocomplete="email"
              placeholder="用于找回账号，可留空" maxlength="254" />
            <div class="error-text" data-error="email"></div>
          </div>
          <div class="field">
            <label class="field-label" for="p-register-password">密码</label>
            <input class="input" id="p-register-password" name="password" type="password"
              autocomplete="new-password" placeholder="至少 8 位字符" maxlength="72" />
            <div class="error-text" data-error="password"></div>
          </div>
          <div class="field">
            <label class="field-label" for="p-register-confirm">确认密码</label>
            <input class="input" id="p-register-confirm" name="confirmPassword" type="password"
              autocomplete="new-password" placeholder="请再次输入密码" maxlength="72" />
            <div class="error-text" data-error="confirmPassword"></div>
          </div>
          <div class="error-text" id="p-register-error" role="alert"></div>
          <button class="btn btn-primary btn-lg btn-block" id="p-register-submit" type="submit">注册</button>
        </form>
        <div class="p-auth-links">
          <a class="link-btn p-tap" href="#/login">已有账号？直接登录</a>
          <a class="link-btn p-tap" href="#/">返回首页</a>
        </div>
      </div>
    </div>`;

  const form = root.querySelector('#p-register-form');
  const submit = root.querySelector('#p-register-submit');
  const usernameInput = root.querySelector('#p-register-username');
  const emailInput = root.querySelector('#p-register-email');
  const passwordInput = root.querySelector('#p-register-password');
  const confirmInput = root.querySelector('#p-register-confirm');
  const formError = root.querySelector('#p-register-error');

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
    submit.textContent = loading ? '注册中…' : '注册';
  }

  function validate(values) {
    const errors = {};
    if (!values.username) {
      errors.username = '请输入用户名';
    } else if (values.username.length < 3 || values.username.length > 32) {
      errors.username = '用户名长度需为 3–32 个字符';
    } else if (!USERNAME_PATTERN.test(values.username)) {
      errors.username = '用户名只能包含字母、数字、下划线、点和短横线';
    }
    if (values.email && !EMAIL_PATTERN.test(values.email)) {
      errors.email = '邮箱格式不正确';
    }
    if (!values.password) {
      errors.password = '请输入密码';
    } else if (values.password.length < 8 || values.password.length > 72) {
      errors.password = '密码长度需为 8–72 个字符';
    }
    if (values.confirmPassword !== values.password) {
      errors.confirmPassword = '两次输入的密码不一致';
    }
    return errors;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    const values = {
      username: usernameInput.value.trim(),
      email: emailInput.value.trim(),
      password: passwordInput.value,
      confirmPassword: confirmInput.value,
    };
    const errors = validate(values);
    const errorNames = Object.keys(errors);
    if (errorNames.length > 0) {
      errorNames.forEach((name) => setFieldError(name, errors[name]));
      return;
    }

    setLoading(true);
    try {
      const payload = { username: values.username, password: values.password };
      if (values.email) payload.email = values.email;
      const data = await ctx.api.register(payload);
      try {
        await ctx.refreshMe();
      } catch {
        if (data && data.user && ctx.store && typeof ctx.store.setUser === 'function') ctx.store.setUser(data.user);
      }
      ctx.toast('注册成功，欢迎加入', 'success');
      ctx.navigate('/dashboard');
    } catch (err) {
      if (err && err.code === 'username_taken') {
        setFieldError('username', '该用户名已被占用，请换一个');
      } else if (err && err.code === 'email_taken') {
        setFieldError('email', '该邮箱已被注册');
      } else if (err && err.code === 'registration_closed') {
        formError.textContent = '当前门户暂未开放注册';
      } else if (err && err.code === 'validation_error' && err.message) {
        if (err.message.includes('用户名')) setFieldError('username', err.message);
        else if (err.message.includes('邮箱')) setFieldError('email', err.message);
        else if (err.message.includes('密码')) setFieldError('password', err.message);
        else formError.textContent = err.message;
      } else {
        formError.textContent = (err && err.message) || '注册失败，请稍后重试';
      }
      setLoading(false);
    }
  });
}
