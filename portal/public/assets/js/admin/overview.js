export const meta = { title: '管理概览', auth: true, admin: true };

const ICON = {
  users:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20"/><circle cx="9" cy="7" r="3.2"/><path d="M22 20v-1.5a4 4 0 0 0-3-3.9"/><path d="M16.5 4.2a3.2 3.2 0 0 1 0 5.6"/></svg>',
  orders:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></svg>',
  revenue:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5v-9Z"/><path d="M3 9h18"/><path d="M16 14.5h2"/></svg>',
  trend:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h6v6"/></svg>',
  recharge:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19"/><path d="M6 14.5h4"/></svg>',
  pending:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  arrow:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>',
  link:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 15l6-6"/><path d="M10.5 6.5 12 5a3.5 3.5 0 0 1 5 5l-1.5 1.5"/><path d="M13.5 17.5 12 19a3.5 3.5 0 0 1-5-5l1.5-1.5"/></svg>',
};

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
  const int = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString('zh-CN') : '0';
  };
  const money = (v) => ui.money(Number(v) || 0);

  const wrap = document.createElement('div');
  wrap.innerHTML = `<header class="page-head row-between">
      <div>
        <h1 class="page-title">管理概览</h1>
        <p class="page-desc" id="a-overview-desc">门户运营数据与 面板连接状态，数据实时拉取</p>
      </div>
      <button type="button" class="btn btn-secondary" data-act="refresh">刷新数据</button>
    </header>
    <div class="stack-gap">
      <div id="a-stats"><div class="loading-block">${ui.spinner()}<span>正在加载运营数据…</span></div></div>
      <div class="card-grid cols-2">
        <section class="card">
          <div class="card-head">
            <div>
              <h2 class="card-title"><span class="a-title-icon">${ICON.orders}</span>最近订单</h2>
              <p class="card-desc">最新 10 条订单，点击可查看全部</p>
            </div>
            <a class="link-btn" href="#/admin/orders">全部订单</a>
          </div>
          <div class="card-body">
            <div id="a-recent"><div class="loading-block">${ui.spinner()}<span>正在加载最近订单…</span></div></div>
          </div>
        </section>
        <section class="card">
          <div class="card-head">
            <div>
              <h2 class="card-title"><span class="a-title-icon">${ICON.link}</span>面板连接</h2>
              <p class="card-desc">通过面板 API 读取入站与订阅信息</p>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" data-act="test-xui">重新测试</button>
          </div>
          <div class="card-body">
            <div id="a-xui"><div class="loading-block">${ui.spinner()}<span>正在测试连接…</span></div></div>
          </div>
        </section>
      </div>
    </div>`;
  root.replaceChildren(wrap);

  const statsBox = wrap.querySelector('#a-stats');
  const recentBox = wrap.querySelector('#a-recent');
  const xuiBox = wrap.querySelector('#a-xui');

  function errorHtml(err) {
    const msg = err && err.message ? err.message : '请求失败，请稍后重试';
    return `<div class="alert alert-danger">
      <div class="stack-sm">
        <div>${esc(msg)}</div>
        <div><button type="button" class="btn btn-secondary btn-sm" data-act="refresh">重试</button></div>
      </div>
    </div>`;
  }

  function metricHtml(item) {
    const inner = `<div class="a-metric-top">
        <span class="a-metric-icon">${item.icon}</span>
        ${item.href ? `<span class="a-metric-arrow">${ICON.arrow}</span>` : ''}
      </div>
      <div class="metric-value${item.warn ? ' text-warning' : ''}">${esc(item.value)}</div>
      <div class="metric-label">${esc(item.label)}</div>
      ${item.hint ? `<div class="metric-hint">${esc(item.hint)}</div>` : ''}`;
    return item.href
      ? `<a class="card card-interactive a-metric a-metric-link" href="${item.href}">${inner}</a>`
      : `<div class="card a-metric">${inner}</div>`;
  }

  async function loadStats() {
    statsBox.innerHTML = `<div class="loading-block">${ui.spinner()}<span>正在加载运营数据…</span></div>`;
    try {
      const data = (await ctx.api.admin.overview()) || {};
      const users = data.users || {};
      const plans = data.plans || {};
      const orders = data.orders || {};
      const revenue = data.revenue || {};
      const recharges = data.recharges || {};
      const pending = Number(orders.pending) || 0;
      const items = [
        { label: '用户数', value: int(users.total), hint: `活跃 ${int(users.active)}`, href: '#/admin/users', icon: ICON.users },
        { label: '订单数', value: int(orders.total), hint: `今日新增 ${int(orders.today)}`, href: '#/admin/orders', icon: ICON.orders },
        { label: '总收入', value: money(revenue.totalCents), hint: `本月 ${money(revenue.monthCents)}`, icon: ICON.revenue },
        { label: '今日收入', value: money(revenue.todayCents), hint: '按支付时间统计', icon: ICON.trend },
        {
          label: '充值总额',
          value: money(recharges.totalCents),
          hint: `今日充值 ${money(recharges.todayCents)}`,
          href: '#/admin/recharges',
          icon: ICON.recharge,
        },
        {
          label: '待处理订单',
          value: int(pending),
          hint: pending > 0 ? '待支付或待开通，建议尽快处理' : '暂无待处理订单',
          href: '#/admin/orders?status=pending',
          icon: ICON.pending,
          warn: pending > 0,
        },
      ];
      const desc = wrap.querySelector('#a-overview-desc');
      if (desc) desc.textContent = `门户运营数据 · 套餐 ${int(plans.total)} 个（启用 ${int(plans.enabled)}）· 数据实时拉取`;
      statsBox.innerHTML = `<div class="card-grid cols-3">${items.map(metricHtml).join('')}</div>`;
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      statsBox.innerHTML = errorHtml(err);
    }
  }

  function recentRow(order) {
    const title = order.planName || ui.kindText(order.kind);
    return `<div class="row-item">
      <div class="row-main">
        <div class="row-title">${esc(title)}</div>
        <div class="row-sub">${esc(ui.kindText(order.kind))} · ${esc(order.orderNo)} · ${esc(order.username || `#${order.userId}`)} · ${esc(ui.dateTime(order.createdAt))}</div>
      </div>
      <div class="row-side a-row-side">
        <span class="a-amount">${esc(money(order.amountCents))}</span>
        ${ui.badge(order.status)}
      </div>
    </div>`;
  }

  async function loadRecent() {
    recentBox.innerHTML = `<div class="loading-block">${ui.spinner()}<span>正在加载最近订单…</span></div>`;
    try {
      const data = (await ctx.api.admin.orders({ page: 1, pageSize: 10 })) || {};
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        recentBox.innerHTML = ui.empty({
          title: '暂无订单',
          desc: '用户下单后，最近 10 条订单会显示在这里。',
          actionHtml: '<a class="btn btn-secondary btn-sm" href="#/admin/orders">查看全部订单</a>',
        });
        return;
      }
      recentBox.innerHTML = `<div class="rows">${items.map(recentRow).join('')}</div>`;
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      recentBox.innerHTML = errorHtml(err);
    }
  }

  async function loadXui(btn, { silent = false } = {}) {
    if (!silent) xuiBox.innerHTML = `<div class="loading-block">${ui.spinner()}<span>正在测试连接…</span></div>`;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '测试中…';
    }
    try {
      const result = (await ctx.api.admin.testXui()) || {};
      if (result.ok === false) throw new Error('测试接口返回失败');
      const inbounds = Array.isArray(result.inbounds) ? result.inbounds : [];
      const meta = [];
      if (result.panelVersion) meta.push(`面板版本 ${esc(result.panelVersion)}`);
      meta.push(`入站 ${esc(result.inboundCount != null ? result.inboundCount : inbounds.length)} 个`);
      if (result.apiLatencyMs != null) meta.push(`API 延迟 ${esc(result.apiLatencyMs)} ms`);
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
        const endpoint = inbound.endpoint ? ` · ${esc(inbound.endpoint)}` : '';
        rows.push(`<div class="row-item">
          <div class="row-main">
            <div class="row-title">#${esc(inbound.id)} ${esc(inbound.remark || '未命名入站')}</div>
            <div class="row-sub">${esc(inbound.protocol || '未知协议')}${endpoint}</div>
          </div>
          <div class="row-side">${ctx.ui.latencyBadge(inbound.latencyMs, inbound.latencyNote)}</div>
        </div>`);
      }
      if (inbounds.length > 10) {
        rows.push(`<div class="row-item"><div class="row-main"><div class="row-sub">仅展示前 10 个入站，共 ${inbounds.length} 个</div></div></div>`);
      }
      if (!inbounds.length) {
        rows.push(`<div class="row-item"><div class="row-main"><div class="row-sub">未发现入站，请先在面板中创建入站。</div></div></div>`);
      }
      xuiBox.innerHTML = `<div class="rows">${rows.join('')}</div>
        <p class="hint mt-1">入站延迟每 20 秒自动刷新；UDP 协议（hysteria/tuic 等）无法用 TCP 探测，显示「UDP 协议」。</p>`;
    } catch (err) {
      if (silent) return;
      if (handleAuthError(ctx, err)) return;
      xuiBox.innerHTML = `<div class="stack-sm">
        <div class="alert alert-danger">连接失败：${esc(err && err.message ? err.message : '未知错误')}</div>
        <p class="hint">请检查「系统设置 → 面板连接」中的面板地址、basePath、API Token 与网络连通性，并确认面板允许当前来源访问。</p>
        <a class="link-btn" href="#/admin/settings">去修改设置</a>
      </div>`;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '重新测试';
      }
    }
  }

  wrap.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    if (act === 'refresh') {
      loadStats();
      loadRecent();
    } else if (act === 'test-xui') {
      loadXui(el);
    }
  });

  let xuiTimer = null;

  function startXuiAutoRefresh() {
    if (xuiTimer) return;
    xuiTimer = setInterval(() => loadXui(null, { silent: true }), 20000);
  }

  ctx.onCleanup(() => {
    if (xuiTimer) {
      clearInterval(xuiTimer);
      xuiTimer = null;
    }
  });

  loadStats();
  loadRecent();
  loadXui(wrap.querySelector('[data-act="test-xui"]'));
  startXuiAutoRefresh();
}
