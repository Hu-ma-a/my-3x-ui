export const meta = { title: '系统设置', auth: true, admin: true };

const ICON_GLOBE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5S14.4 18.2 12 20.5c-2.4-2.3-3.6-5.2-3.6-8.5S9.6 5.8 12 3.5Z"/></svg>';

const ICON_LINK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 15l6-6"/><path d="M10.5 6.5 12 5a3.5 3.5 0 0 1 5 5l-1.5 1.5"/><path d="M13.5 17.5 12 19a3.5 3.5 0 0 1-5-5l1.5-1.5"/></svg>';

const ICON_CARD =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19"/><path d="M6 14.5h4"/></svg>';

const ICON_REFRESH =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 3.5V9h-5.5"/></svg>';

const DEFAULTS = {
  'portal.name': '用户中心',
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
  'portal.currency': { label: '货币', kind: 'select', required: true, options: [['CNY', '人民币 CNY（¥ 元）'], ['USD', '美元 USD（$）']], hint: '影响门户内所有金额的显示与录入单位；支付网关仍按渠道要求扣款' },
  'portal.registrationEnabled': { label: '开放注册', kind: 'bool', hint: '关闭后新用户无法自助注册，可由管理员在面板侧维护' },
  'portal.manualPayInstructions': { label: '人工转账说明', kind: 'textarea' },
  'portal.minRechargeCents': { label: '最低充值金额', kind: 'money', min: 0.01 },
  'portal.maxRechargeCents': { label: '最高充值金额', kind: 'money', min: 0.01 },
  'portal.defaultInboundIds': { label: '默认入站 ID（逗号分隔）', kind: 'text', hint: '套餐未绑定入站时使用；留空则取面板第一个入站' },
  'portal.subscriptionBaseUrl': { label: '订阅基地址', kind: 'text', hint: '留空时自动从面板设置推导' },
  'xui.url': { label: '面板地址', kind: 'text', required: true, hint: '例如 http://127.0.0.1:2053' },
  'xui.basePath': { label: 'basePath', kind: 'text', hint: '通常为 /' },
  'xui.apiToken': { label: 'API Token', kind: 'secret', hint: '建议使用面板 admin 权限的 API Token，优先于账号密码' },
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
    title: '面板连接',
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

const GROUP_ICONS = { '门户设置': ICON_GLOBE, '面板连接': ICON_LINK, '支付设置': ICON_CARD };

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
        <p class="page-desc">门户、面板连接与支付渠道配置；密钥类字段留空表示不修改</p>
      </div>
      <button type="button" class="btn btn-secondary" data-act="reload">重新加载</button>
    </header>
    <div id="a-settings"><div class="loading-block">${ui.spinner()}<span>正在加载设置…</span></div></div>
    <section class="card" id="a-update-card">
      <div class="card-head">
        <div>
          <h2 class="card-title"><span class="a-title-icon">${ICON_REFRESH}</span>版本更新</h2>
          <p class="card-desc">检查最新版本并一键更新；更新由系统服务执行，完成后门户会自动重启。</p>
        </div>
        <div class="row">
          <button type="button" class="btn btn-secondary btn-sm" data-act="update-check">检查更新</button>
          <button type="button" class="btn btn-primary btn-sm hidden" data-act="update-apply">立即更新</button>
        </div>
      </div>
      <div class="card-body"><div id="a-update-box"><div class="loading-block">${ui.spinner()}<span>正在读取版本信息…</span></div></div></div>
    </section>`;
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
        <label class="a-switch-field">
          <span class="a-switch-control">
            <input type="checkbox" name="${esc(key)}" data-key="${esc(key)}" data-bool="1" ${checked ? 'checked' : ''} aria-label="${esc(def.label)}">
            <span class="a-switch-track" aria-hidden="true"></span>
          </span>
        </label>
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
    if (def.kind === 'money') {
      const cents = Number(value(key));
      const display = Number.isFinite(cents) ? (cents / 100).toFixed(2) : '';
      return `<div class="field${span}">
        <label class="field-label" for="${id}">${esc(def.label)}（${esc(ui.currencyName())}）</label>
        <div class="input-wrap">
          <span class="input-prefix" aria-hidden="true">${esc(ui.currencySymbol())}</span>
          <input id="${id}" class="input" type="number" step="0.01" min="${def.min != null ? def.min : 0.01}"
            name="${esc(key)}" data-key="${esc(key)}" data-money="1" value="${esc(display)}">
        </div>
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
      <div class="a-switch-grid">
        ${all.map(([v, label]) =>
          `<label class="a-switch">
            <span class="a-switch-label">${esc(label)}</span>
            <span class="a-switch-control">
              <input type="checkbox" data-provider="${esc(v)}" ${enabled.includes(v) ? 'checked' : ''} aria-label="${esc(label)}">
              <span class="a-switch-track" aria-hidden="true"></span>
            </span>
          </label>`).join('')}
      </div>
      <p class="hint">用户在线支付时只能选择已启用的方式，余额支付不受影响。</p>
    </div>`;
  }

  function groupSection(group) {
    const fields = group.keys.map((key) => (KEYS[key].kind === 'providers' ? providersHtml() : fieldHtml(key))).join('');
    const isXui = group.title === '面板连接';
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
      if (el.hasAttribute('data-money')) {
        const yuan = Number(el.value);
        payload[key] = el.value === '' || !Number.isFinite(yuan) ? '' : String(Math.round(yuan * 100));
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
    if (!/^[A-Z]{3}$/.test(String(payload['portal.currency'] || '').toUpperCase())) {
      fail('portal.currency', '请选择货币（CNY 或 USD）');
    }
    if (!payload['xui.url']) fail('xui.url', '请输入面板地址');

    INT_KEYS.forEach((key) => {
      const raw = payload[key];
      if (raw === '') {
        fail(key, '请填写该数值');
        return;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) fail(key, '请输入有效金额');
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

  let updateTimer = null;
  let updateApplyRequested = false;
  let updateCheckRequested = false;
  let updateFeedback = null;
  let lastUpdateStatus = null;

  function setUpdateFeedback(message, tone = 'info') {
    updateFeedback = message ? { message, tone } : null;
    if (lastUpdateStatus) renderUpdate(lastUpdateStatus);
  }

  function stopUpdatePoll() {
    if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
    }
  }

  function startUpdatePoll() {
    if (updateTimer) return;
    updateTimer = setInterval(() => loadUpdate(), 1000);
  }

  ctx.onCleanup(stopUpdatePoll);

  function updateHints(status) {
    const installScript = status.installScriptPath || '/opt/portal/scripts/install.sh';
    if (status.canApply) return '';
    if (status.deployMode === 'docker') {
      return 'Docker 部署请在宿主机执行 docker pull 拉取新镜像，然后重启容器。';
    }
    if (status.deployMode !== 'systemd') {
      return `源码/本地部署请在服务器执行：sudo bash ${installScript} --upgrade（脚本不在 PATH 里，必须带路径并用 sudo）。`;
    }
    return '当前未配置更新仓库：请在 /etc/portal/portal.env 设置 PORTAL_UPDATE_REPO=你的用户名/仓库名（可选 PORTAL_UPDATE_MIRROR=镜像前缀）后重启门户。';
  }

  function renderUpdate(status) {
    const updateBox = wrap.querySelector('#a-update-box');
    if (!updateBox) return;
    if (!status) {
      updateBox.innerHTML = '<div class="alert alert-danger">读取版本信息失败</div>';
      return;
    }
    const runner = status.runner || {};
    const installScript = status.installScriptPath || '/opt/portal/scripts/install.sh';
    const rows = [
      `<div class="row-item">
        <div class="row-main">
          <div class="row-title">当前版本</div>
          <div class="row-sub">${esc(status.deployMode)} 部署${status.mirrorConfigured ? ' · 已配置下载镜像' : ''}</div>
        </div>
        <div class="row-side mono">v${esc(status.currentVersion)}</div>
      </div>`,
      `<div class="row-item">
        <div class="row-main">
          <div class="row-title">更新服务</div>
          <div class="row-sub">${runner.lastHeartbeatAt
            ? `最近心跳 ${esc(ui.dateTime(runner.lastHeartbeatAt))}`
            : '尚未收到后台更新服务的心跳（检查更新需要它运行）'}</div>
        </div>
        <div class="row-side">${runner.healthy
          ? '<span class="badge badge-success">运行中</span>'
          : '<span class="badge badge-warning">未运行</span>'}</div>
      </div>`,
    ];

    const pendingSince = Number(status.request?.requestedAt || 0);
    const waitedSeconds = pendingSince ? Math.max(0, Math.round((Date.now() - pendingSince) / 1000)) : 0;
    if (status.pending) {
      rows.push(`<div class="row-item">
        <div class="row-main">
          <div class="row-title">${status.request?.action === 'apply' ? '正在更新…' : '正在检查更新…'}</div>
          <div class="row-sub">已等待 ${waitedSeconds} 秒；后台更新服务通常会在 30 秒内处理，请保持页面打开</div>
        </div>
        <div class="row-side"><span class="spinner"></span></div>
      </div>`);
      if (waitedSeconds > 90) {
        rows.push(`<div class="alert alert-warning mt-2">
          已经等待超过 90 秒仍无结果，可能是后台更新服务未运行或无法访问更新源。请在服务器执行：
          <div class="mono mt-1">systemctl status portal-update.timer</div>
          <div class="mono">journalctl -u portal-update.service -n 50 --no-pager</div>
          <div class="mono">sudo bash ${esc(installScript)} --upgrade</div>
        </div>`);
      }
    } else if (status.latestVersion) {
      rows.push(`<div class="row-item">
        <div class="row-main">
          <div class="row-title">最新版本</div>
          <div class="row-sub">${status.checkedAt ? `检查于 ${esc(ui.dateTime(status.checkedAt))}` : ''}${status.releaseUrl ? ` · <a href="${esc(status.releaseUrl)}" target="_blank" rel="noreferrer">发布说明</a>` : ''}</div>
        </div>
        <div class="row-side">${status.upToDate
          ? '<span class="badge badge-success">已是最新</span>'
          : `<span class="badge badge-warning">可更新 v${esc(status.latestVersion)}</span>`}</div>
      </div>`);
    } else {
      rows.push(`<div class="row-item">
        <div class="row-main">
          <div class="row-title">尚未检查更新</div>
          <div class="row-sub">点击右上角「检查更新」获取最新版本</div>
        </div>
      </div>`);
    }
    if (status.requestStale) {
      rows.push(`<div class="alert alert-warning mt-2">上次检查请求已超时（后台更新服务可能未运行），可以直接重新点击「检查更新」。</div>`);
    }
    if (status.result?.status === 'failed') {
      rows.push(`<div class="alert alert-danger mt-2">更新/检查失败：${esc(status.result.message || '未知错误')}</div>`);
    }
    if (status.result?.status === 'applied') {
      rows.push('<div class="alert alert-success mt-2">更新已应用，门户正在重启，页面稍后会自动刷新。</div>');
    }

    const hint = updateHints(status);
    const runnerWarning = status.canApply && !runner.healthy
      ? `后台更新服务未运行：请确认 portal-update.timer 已启用（sudo systemctl enable --now portal-update.timer），或重新执行 sudo bash ${installScript} --upgrade 安装更新服务。`
      : '';
    const alerts = [];
    if (!status.canApply && hint) alerts.push(`<div class="alert alert-warning mb-2">${esc(hint)}</div>`);
    else if (runnerWarning) alerts.push(`<div class="alert alert-warning mb-2">${esc(runnerWarning)}</div>`);
    const toneClass = updateFeedback ? `alert-${updateFeedback.tone}` : '';
    const feedbackHtml = updateFeedback
      ? `<div class="alert ${toneClass} mb-2" id="a-update-feedback">${esc(updateFeedback.message)}</div>`
      : '';

    updateBox.innerHTML = `${feedbackHtml}${alerts.join('')}<div class="rows">${rows.join('')}</div>`;

    const checkBtn = wrap.querySelector('[data-act="update-check"]');
    const applyBtn = wrap.querySelector('[data-act="update-apply"]');
    if (checkBtn) {
      checkBtn.disabled = status.pending;
      checkBtn.textContent = status.pending ? '检查中…' : '检查更新';
    }
    if (applyBtn) {
      applyBtn.classList.toggle('hidden', !(status.canApply && !status.upToDate && status.latestVersion && !status.pending));
      applyBtn.disabled = status.pending || !runner.healthy;
    }
  }

  async function loadUpdate() {
    try {
      const status = (await ctx.api.admin.updateStatus()) || {};
      lastUpdateStatus = status;
      renderUpdate(status);
      if (status.pending) startUpdatePoll();
      else {
        stopUpdatePoll();
        const resultStatus = status.result?.status;
        if (updateCheckRequested && status.result?.at) {
          updateCheckRequested = false;
          if (resultStatus === 'checked') {
            const message = status.upToDate
              ? `检查完成：当前已是最新版本（v${status.currentVersion}）`
              : `检查完成：发现新版本 v${status.latestVersion}（当前 v${status.currentVersion}），可点击「立即更新」`;
            ctx.toast(status.upToDate ? '当前已是最新版本' : `发现新版本 v${status.latestVersion}`, 'success');
            setUpdateFeedback(message, status.upToDate ? 'success' : 'info');
          } else if (resultStatus === 'failed') {
            ctx.toast(`检查失败：${status.result.message || '未知错误'}`, 'error');
            setUpdateFeedback(`检查失败：${status.result.message || '未知错误'}`, 'danger');
          }
        }
        if (updateApplyRequested && resultStatus === 'applied') {
          updateApplyRequested = false;
          ctx.toast('更新完成，页面即将刷新…', 'success');
          setTimeout(() => window.location.reload(), 2500);
        }
      }
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      const updateBox = wrap.querySelector('#a-update-box');
      if (updateBox) {
        updateBox.innerHTML = `<div class="alert alert-danger">读取版本信息失败：${esc(err && err.message ? err.message : '未知错误')}</div>`;
      }
    }
  }

  async function checkUpdate(btn) {
    const runner = (lastUpdateStatus && lastUpdateStatus.runner) || {};
    if (lastUpdateStatus && lastUpdateStatus.canApply && !runner.healthy) {
      const installScript = lastUpdateStatus.installScriptPath || '/opt/portal/scripts/install.sh';
      setUpdateFeedback(
        `后台更新服务未运行，检查请求未发送。请先执行 sudo systemctl enable --now portal-update.timer；如仍未运行，执行 sudo bash ${installScript} --upgrade 重新安装更新服务。`,
        'danger',
      );
      ctx.toast('后台更新服务未运行，请先启用 portal-update.timer', 'error');
      btn.disabled = false;
      btn.textContent = '检查更新';
      return;
    }
    btn.disabled = true;
    btn.textContent = '提交中…';
    setUpdateFeedback('正在提交检查请求…', 'info');
    try {
      await ctx.api.admin.checkUpdate();
      updateCheckRequested = true;
      ctx.toast('已提交检查请求，等待后台更新服务处理…', 'success');
      setUpdateFeedback('已提交检查请求，正在等待后台更新服务处理（通常 30 秒内完成，最长等待 90 秒）…', 'info');
      await loadUpdate();
      startUpdatePoll();
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      ctx.toast(err && err.message ? err.message : '检查更新失败', 'error');
      setUpdateFeedback(err && err.message ? err.message : '检查更新失败，请稍后重试', 'danger');
      btn.disabled = false;
      btn.textContent = '检查更新';
    }
  }

  async function applyUpdate(btn) {
    const ok = await ctx.ui.confirm({
      title: '立即更新门户',
      content: '将下载并安装最新版本，随后门户会自动重启（约数十秒）。升级前会自动备份数据库，期间用户可能短暂无法访问。',
      okText: '开始更新',
      danger: true,
    });
    if (!ok) return;
    btn.disabled = true;
    updateApplyRequested = true;
    try {
      await ctx.api.admin.applyUpdate();
      ctx.toast('已开始更新，请保持页面打开…', 'success');
      await loadUpdate();
      startUpdatePoll();
    } catch (err) {
      updateApplyRequested = false;
      if (handleAuthError(ctx, err)) return;
      ctx.toast(err && err.message ? err.message : '更新失败', 'error');
      btn.disabled = false;
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
    const previousCurrency = String(value('portal.currency') || 'CNY').toUpperCase();
    const nextCurrency = String(payload['portal.currency'] || 'CNY').toUpperCase();
    const btn = form.querySelector('button[type="submit"]');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      await ctx.api.admin.updateSettings(payload);
      ctx.toast('设置已保存', 'success');
      if (nextCurrency !== previousCurrency) {
        ui.setCurrency(nextCurrency);
        window.location.reload();
        return;
      }
      await load();
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      ctx.toast(err && err.message ? err.message : '保存失败，请稍后重试', 'error');
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function testXui(btn) {
    let resultBox = wrap.querySelector('#a-xui-result');
    if (!resultBox) return;

    // 测试前先把当前表单保存下来，避免“填了但没保存就去测试”仍然用旧配置。
    const form = wrap.querySelector('#a-settings-form');
    if (form) {
      clearErrors(form);
      const payload = collect(form);
      if (!validate(form, payload)) {
        ctx.toast('请先检查表单填写', 'error');
        const first = form.querySelector('.a-invalid');
        if (first) first.focus();
        return;
      }
      const previousCurrency = String(value('portal.currency') || 'CNY').toUpperCase();
      const nextCurrency = String(payload['portal.currency'] || 'CNY').toUpperCase();
      btn.disabled = true;
      btn.textContent = '保存并测试中…';
      try {
        await ctx.api.admin.updateSettings(payload);
        if (nextCurrency !== previousCurrency) ui.setCurrency(nextCurrency);
        await load();
      } catch (err) {
        if (handleAuthError(ctx, err)) return;
        ctx.toast(err && err.message ? `保存设置失败：${err.message}` : '保存设置失败，请稍后重试', 'error');
        btn.disabled = false;
        btn.textContent = '测试连接';
        return;
      }
      resultBox = wrap.querySelector('#a-xui-result');
      btn = wrap.querySelector('[data-act="test-xui"]');
      if (!resultBox || !btn) return;
    }

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
        rows.push(`<div class="row-item"><div class="row-main"><div class="row-sub">未发现入站，请先在面板中创建入站。</div></div></div>`);
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
    else if (act === 'update-check') checkUpdate(btn);
    else if (act === 'update-apply') applyUpdate(btn);
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
  loadUpdate();
}
