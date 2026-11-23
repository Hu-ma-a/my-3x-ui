export const meta = { title: '系统设置', auth: true, admin: true };

const ICON_GLOBE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5S14.4 18.2 12 20.5c-2.4-2.3-3.6-5.2-3.6-8.5S9.6 5.8 12 3.5Z"/></svg>';

const ICON_LINK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 15l6-6"/><path d="M10.5 6.5 12 5a3.5 3.5 0 0 1 5 5l-1.5 1.5"/><path d="M13.5 17.5 12 19a3.5 3.5 0 0 1-5-5l1.5-1.5"/></svg>';

const ICON_CARD =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19"/><path d="M6 14.5h4"/></svg>';

const DEFAULTS = {
  'portal.name': '3x-ui 用户中心',
  'portal.registrationEnabled': 'true',
  'portal.currency': 'CNY',
  'portal.manualPayInstructions': '请转账后联系管理员确认',
  'portal.defaultInboundIds': '',
  'portal.subscriptionBaseUrl': '',
  'portal.minRechargeCents': '100',
  'portal.maxRechargeCents': '1000000',
  'xui.url': 'http://127.0.0.1:2053',
  'xui.basePath': '/',
  'xui.timeoutMs': '15000',
  'pay.providersEnabled': 'mock,manual,epay',
  'pay.epay.type': 'alipay',
  'pay.mockAutoComplete': 'false',
};

const KEYS = {
  'portal.name': { label: '门户名称', kind: 'text', required: true, span2: true },
  'portal.currency': { label: '货币', kind: 'text', required: true, hint: '当前仅支持 CNY' },
  'portal.registrationEnabled': { label: '开放注册', kind: 'bool', hint: '关闭后新用户无法自助注册，可由管理员在 3x-ui 侧维护' },
  'portal.manualPayInstructions': { label: '人工转账说明', kind: 'textarea' },
  'portal.minRechargeCents': { label: '最低充值金额（分）', kind: 'int', min: 0 },
  'portal.maxRechargeCents': { label: '最高充值金额（分）', kind: 'int', min: 0 },
  'portal.defaultInboundIds': { label: '默认入站 ID（逗号分隔）', kind: 'text', hint: '套餐未绑定入站时使用；留空则取 3x-ui 第一个入站' },
  'portal.subscriptionBaseUrl': { label: '订阅基地址', kind: 'text', hint: '留空时自动从 3x-ui 设置推导' },
  'xui.url': { label: '面板地址', kind: 'text', required: true, hint: '例如 http://127.0.0.1:2053' },
  'xui.basePath': { label: 'basePath', kind: 'text', hint: '通常为 /' },
  'xui.apiToken': { label: 'API Token', kind: 'secret', hint: '建议使用 3x-ui admin 权限的 API Token，优先于账号密码' },
  'xui.username': { label: '面板用户名', kind: 'text', hint: '未配置 API Token 时回退账号密码登录' },
  'xui.password': { label: '面板密码', kind: 'secret' },
  'xui.timeoutMs': { label: '请求超时（毫秒）', kind: 'int', min: 1000 },
  'pay.providersEnabled': { label: '启用的支付方式', kind: 'providers' },
  'pay.epay.url': { label: '易支付接口地址', kind: 'text', hint: '例如 https://pay.example.com/' },
  'pay.epay.pid': { label: '易支付商户 PID', kind: 'text' },
  'pay.epay.key': { label: '易支付商户密钥', kind: 'secret' },
  'pay.epay.type': { label: '支付类型', kind: 'select', options: [['alipay', '支付宝'], ['wxpay', '微信支付']] },
  'pay.epay.notifyUrl': { label: '异步通知地址', kind: 'text', hint: '留空则由请求 Host 自动推断' },
  'pay.epay.returnUrl': { label: '同步跳转地址', kind: 'text', hint: '留空则由请求 Host 自动推断' },
  'pay.mockAutoComplete': { label: '模拟支付自动完成', kind: 'bool', hint: '开启后模拟支付订单自动标记成功，仅建议测试环境使用' },
};

const GROUPS = [
  {
    title: '门户设置',
    desc: '站点名称、开放注册、充值额度与订阅地址',
    keys: ['portal.name', 'portal.currency', 'portal.registrationEnabled', 'portal.manualPayInstructions',
      'portal.minRechargeCents', 'portal.maxRechargeCents', 'portal.defaultInboundIds', 'portal.subscriptionBaseUrl'],
  },
  {
    title: '3x-ui 连接',
    desc: '门户通过面板 API 开通套餐并同步订阅数据',
    keys: ['xui.url', 'xui.basePath', 'xui.apiToken', 'xui.username', 'xui.password', 'xui.timeoutMs'],
  },
  {
    title: '支付设置',
    desc: '启用的支付渠道与易支付参数',
    keys: ['pay.providersEnabled', 'pay.epay.url', 'pay.epay.pid', 'pay.epay.key', 'pay.epay.type',
      'pay.epay.notifyUrl', 'pay.epay.returnUrl', 'pay.mockAutoComplete'],
  },
];

const GROUP_ICONS = { '门户设置': ICON_GLOBE, '3x-ui 连接': ICON_LINK, '支付设置': ICON_CARD };

const INT_KEYS = ['portal.minRechargeCents', 'portal.maxRechargeCents', 'xui.timeoutMs'];

/** 处理 401/403：跳登录或提示无权限。 */
function handleAuthError(ctx, err) {
  if (!err) return false;
  if (err.code === 'unauthorized' || err.status === 401) {
    ctx.navigate('/login');
    return true;
  }
  if (err.code === 'forbidden' || err.status === 403) {
    ctx.toast('需要管理员权限', 'error');
    ctx.navigate('/dashboard');
    return true;
  }
  return false;
}

export async function render(root, ctx) {
  const ui = ctx.ui;
  const esc = (v) => ui.escape(v == null ? '' : String(v));
  let settings = new Map();

  const wrap = document.createElement('div');
  wrap.innerHTML = `<header class="page-head row-between">
      <div>
        <h1 class="page-title">系统设置</h1>
        <p class="page-desc">门户、3x-ui 连接与支付渠道配置；密钥类字段留空表示不修改</p>
      </div>
      <button type="button" class="btn btn-secondary" data-act="reload">重新加载</button>
    </header>
    <div id="a-settings"><div class="loading-block">${ui.spinner()}<span>正在加载设置…</span></div></div>`;
  root.replaceChildren(wrap);

  const box = wrap.querySelector('#a-settings');

  const value = (key) => {
    const item = settings.get(key);
    if (item && item.value != null) return String(item.value);
    return DEFAULTS[key] != null ? DEFAULTS[key] : '';
  };
  const isConfigured = (key) => {
    const item = settings.get(key);
    return !!(item && item.hasValue);
  };
  const domId = (key) => `a-set-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  function fieldHtml(key) {
    const def = KEYS[key];
    if (!def) return '';
    const id = domId(key);
    const hint = def.hint ? `<p class="hint">${esc(def.hint)}</p>` : '';
    const errorBox = `<p class="error-text hidden" data-error-for="${esc(key)}"></p>`;
    const span = def.span2 || def.kind === 'textarea' ? ' a-span-2' : '';

    if (def.kind === 'secret') {
      const configured = isConfigured(key);
      return `<div class="field">
        <div class="field-label a-secret-label">
          <span>${esc(def.label)}</span>
          <span class="badge ${configured ? 'badge-success' : 'badge-muted'}">${configured ? '已配置' : '未配置'}</span>
        </div>
        <input id="${id}" class="input" type="password" name="${esc(key)}" data-key="${esc(key)}" data-secret="1"
          autocomplete="new-password" placeholder="${configured ? '已配置，留空则不修改' : '未配置，请输入'}">
        ${hint}
      </div>`;
    }
    if (def.kind === 'bool') {
      const checked = String(value(key)).toLowerCase() === 'true';
      return `<div class="field${span}">
        <div class="field-label">${esc(def.label)}</div>
        <label class="checkbox-row"><input type="checkbox" name="${esc(key)}" data-key="${esc(key)}" data-bool="1" ${checked ? 'checked' : ''}> 开启</label>
        ${hint}
      </div>`;
    }
    if (def.kind === 'select') {
      const opts = def.options.map(([v, label]) =>
        `<option value="${esc(v)}" ${String(value(key)) === v ? 'selected' : ''}>${esc(label)}</option>`).join('');
      return `<div class="field${span}">
        <label class="field-label" for="${id}">${esc(def.label)}</label>
        <select id="${id}" class="select" name="${esc(key)}" data-key="${esc(key)}">${opts}</select>
        ${hint}
      </div>`;
    }
    if (def.kind === 'textarea') {
      return `<div class="field${span}">
        <label class="field-label" for="${id}">${esc(def.label)}</label>
        <textarea id="${id}" class="textarea" rows="2" name="${esc(key)}" data-key="${esc(key)}">${esc(value(key))}</textarea>
        ${errorBox}${hint}
      </div>`;
    }
    if (def.kind === 'int') {
      return `<div class="field${span}">
        <label class="field-label" for="${id}">${esc(def.label)}</label>
        <input id="${id}" class="input" type="number" step="1" min="${def.min != null ? def.min : 0}"
          name="${esc(key)}" data-key="${esc(key)}" value="${esc(value(key))}">
        ${errorBox}${hint}
      </div>`;
    }
    return `<div class="field${span}">
      <label class="field-label" for="${id}">${esc(def.label)}</label>
      <input id="${id}" class="input" type="text" name="${esc(key)}" data-key="${esc(key)}" value="${esc(value(key))}">
      ${errorBox}${hint}
    </div>`;
  }

  function providersHtml() {
    const enabled = String(value('pay.providersEnabled')).split(',').map((item) => item.trim()).filter(Boolean);
    const all = [['mock', '模拟支付'], ['manual', '人工转账'], ['epay', '易支付']];
    return `<div class="field a-span-2">
      <div class="field-label">启用的支付方式</div>
      <div class="a-check-row">
        ${all.map(([v, label]) =>
          `<label class="checkbox-row"><input type="checkbox" data-provider="${esc(v)}" ${enabled.includes(v) ? 'checked' : ''}> ${esc(label)}</label>`).join('')}
      </div>
      <p class="hint">用户在线支付时只能选择已启用的方式，余额支付不受影响。</p>
    </div>`;
  }

  function groupSection(group) {
    const fields = group.keys.map((key) => (KEYS[key].kind === 'providers' ? providersHtml() : fieldHtml(key))).join('');
    const isXui = group.title === '3x-ui 连接';
    return `<section class="card">
      <div class="card-head">
        <div>
          <h2 class="card-title"><span class="a-title-icon">${GROUP_ICONS[group.title] || ICON_GLOBE}</span>${esc(group.title)}</h2>
          <p class="card-desc">${esc(group.desc)}</p>
        </div>
        ${isXui ? '<button type="button" class="btn btn-secondary btn-sm" data-act="test-xui">测试连接</button>' : ''}
      </div>
      <div class="card-body">
        <div class="grid grid-2 a-settings-grid">${fields}</div>
        ${isXui
          ? `<p class="hint mt-2">测试使用已保存的配置，修改后请先保存再测试。</p><div id="a-xui-result" class="a-xui-result"></div>`
          : ''}
      </div>
    </section>`;
  }

  function formHtml() {
    return `<form id="a-settings-form" novalidate>
      <div class="stack-gap">
        ${GROUPS.map(groupSection).join('')}
      </div>
      <div class="a-form-actions">
        <button type="button" class="btn btn-ghost" data-act="reload">放弃修改</button>
        <button type="submit" class="btn btn-primary">保存设置</button>
      </div>
    </form>`;
  }

  function clearErrors(form) {
    form.querySelectorAll('[data-error-for]').forEach((el) => {
      el.textContent = '';
      el.classList.add('hidden');
    });
    form.querySelectorAll('.a-invalid').forEach((el) => el.classList.remove('a-invalid'));
  }

  function setError(form, key, msg) {
    const input = form.querySelector(`[data-key="${key}"]`);
    const errorBox = form.querySelector(`[data-error-for="${key}"]`);
    if (input) input.classList.add('a-invalid');
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.classList.remove('hidden');
    }
  }

  function collect(form) {
    const payload = {};
    form.querySelectorAll('[data-key]').forEach((el) => {
      const key = el.getAttribute('data-key');
      if (el.hasAttribute('data-bool')) {
        payload[key] = el.checked ? 'true' : 'false';
        return;
      }
      if (el.hasAttribute('data-secret')) {
        if (el.value !== '') payload[key] = el.value;
        return;
      }
      payload[key] = el.value.trim();
    });
    const providers = [...form.querySelectorAll('[data-provider]')]
      .filter((el) => el.checked)
      .map((el) => el.getAttribute('data-provider'));
    payload['pay.providersEnabled'] = providers.join(',');
    return payload;
  }

  function validate(form, payload) {
    let ok = true;
    const fail = (key, msg) => {
      ok = false;
      setError(form, key, msg);
    };
    if (!payload['portal.name']) fail('portal.name', '请输入门户名称');
    if (!payload['portal.currency']) fail('portal.currency', '请输入货币代码，如 CNY');
    if (!payload['xui.url']) fail('xui.url', '请输入 3x-ui 面板地址');

    INT_KEYS.forEach((key) => {
      const raw = payload[key];
      if (raw === '') {
        fail(key, '请填写该数值');
        return;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) fail(key, '请输入不小于 0 的整数');
      else if (key === 'xui.timeoutMs' && (n < 1000 || n > 120000)) fail(key, '超时需在 1000–120000 毫秒之间');
      else if (key === 'portal.minRechargeCents' && n < 1) fail(key, '最低充值金额需大于 0');
    });

    const min = Number(payload['portal.minRechargeCents']);
    const max = Number(payload['portal.maxRechargeCents']);
    if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
      fail('portal.maxRechargeCents', '最高充值金额需不小于最低金额');
    }

    const inboundRaw = payload['portal.defaultInboundIds'];
    if (inboundRaw) {
      const parts = inboundRaw.split(/[,，\s]+/).filter(Boolean);
      const invalid = parts.some((part) => !Number.isInteger(Number(part)) || Number(part) <= 0);
      if (invalid) fail('portal.defaultInboundIds', '入站 ID 需为正整数，使用英文逗号分隔');
    }
    return ok;
  }

  async function load() {
    box.innerHTML = `<div class="loading-block">${ui.spinner()}<span>正在加载设置…</span></div>`;
    try {
      const data = (await ctx.api.admin.settings()) || {};
      const items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
      settings = new Map(items.map((item) => [item.key, item]));
      box.innerHTML = formHtml();
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      const msg = err && err.message ? err.message : '加载设置失败，请稍后重试';
      box.innerHTML = `<div class="alert alert-danger">
        <div class="stack-sm">
          <div>${esc(msg)}</div>
          <div><button type="button" class="btn btn-secondary btn-sm" data-act="reload">重试</button></div>
        </div>
      </div>`;
    }
  }

  async function save(form) {
    clearErrors(form);
    const payload = collect(form);
    if (!validate(form, payload)) {
      ctx.toast('请检查表单填写', 'error');
      const first = form.querySelector('.a-invalid');
      if (first) first.focus();
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      await ctx.api.admin.updateSettings(payload);
      ctx.toast('设置已保存', 'success');
      await load();
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      ctx.toast(err && err.message ? err.message : '保存失败，请稍后重试', 'error');
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function testXui(btn) {
    const resultBox = wrap.querySelector('#a-xui-result');
    if (!resultBox) return;
    resultBox.innerHTML = `<div class="loading-block">${ui.spinner()}<span>正在测试连接…</span></div>`;
    btn.disabled = true;
    btn.textContent = '测试中…';
    try {
      const result = (await ctx.api.admin.testXui()) || {};
      if (result.ok === false) throw new Error('连接测试失败');
      const inbounds = Array.isArray(result.inbounds) ? result.inbounds : [];
      const meta = [];
      if (result.panelVersion) meta.push(`面板版本 ${esc(result.panelVersion)}`);
      meta.push(`入站 ${esc(result.inboundCount != null ? result.inboundCount : inbounds.length)} 个`);
      if (result.clientCount != null) meta.push(`客户端 ${esc(result.clientCount)} 个`);
      const sub = result.subscription || {};
      if (sub.subEnable !== undefined) meta.push(`订阅功能${sub.subEnable ? '已启用' : '未启用'}`);
      const rows = [`<div class="row-item">
        <div class="row-main">
          <div class="row-title">连接正常</div>
          <div class="row-sub">${meta.join(' · ')}</div>
        </div>
        <div class="row-side"><span class="badge badge-success">已连接</span></div>
      </div>`];
      for (const inbound of inbounds.slice(0, 10)) {
        rows.push(`<div class="row-item">
          <div class="row-main">
            <div class="row-title">#${esc(inbound.id)} ${esc(inbound.remark || '未命名入站')}</div>
            <div class="row-sub">${esc(inbound.protocol || '未知协议')}</div>
          </div>
        </div>`);
      }
      if (inbounds.length > 10) {
        rows.push(`<div class="row-item"><div class="row-main"><div class="row-sub">仅展示前 10 个入站，共 ${inbounds.length} 个</div></div></div>`);
      }
      if (!inbounds.length) {
        rows.push(`<div class="row-item"><div class="row-main"><div class="row-sub">未发现入站，请先在 3x-ui 中创建入站。</div></div></div>`);
      }
      resultBox.innerHTML = `<div class="rows">${rows.join('')}</div>`;
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      resultBox.innerHTML = `<div class="stack-sm">
        <div class="alert alert-danger">连接失败：${esc(err && err.message ? err.message : '未知错误')}</div>
        <p class="hint">请确认面板地址、basePath、API Token（或账号密码）正确，且面板可从门户服务器访问。</p>
      </div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '测试连接';
    }
  }

  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'reload') load();
    else if (act === 'test-xui') testXui(btn);
  });

  wrap.addEventListener('submit', (e) => {
    const form = e.target.closest('#a-settings-form');
    if (!form) return;
    e.preventDefault();
    save(form);
  });

  wrap.addEventListener('input', (e) => {
    const input = e.target.closest('[data-key]');
    if (!input) return;
    const form = input.closest('#a-settings-form');
    if (!form) return;
    input.classList.remove('a-invalid');
    const field = input.closest('.field');
    const errorBox = field ? field.querySelector('[data-error-for]') : null;
    if (errorBox) {
      errorBox.textContent = '';
      errorBox.classList.add('hidden');
    }
  });

  load();
}
