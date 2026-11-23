export const meta = { title: '管理概览', auth: true, admin: true };

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
        <p class="page-desc" id="a-overview-desc">门户运营数据与 3x-ui 连接状态，数据实时拉取</p>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" data-act="refresh">刷新数据</button>
    </header>
    <div id="a-stats"><div class="loading-block">${ui.spinner()}<span>正在加载运营数据…</span></div></div>
    <section class="section">
      <div class="section-head">
        <h2 class="section-title">最近订单</h2>
        <a class="link-btn" href="#/admin/orders">全部订单</a>
      </div>
      <div id="a-recent"><div class="loading-block">${ui.spinner()}<span>正在加载最近订单…</span></div></div>
    </section>
    <section class="section">
      <div class="section-head">
        <h2 class="section-title">3x-ui 连接</h2>
        <button type="button" class="btn btn-secondary btn-sm" data-act="test-xui">重新测试</button>
      </div>
      <div id="a-xui"><div class="loading-block">${ui.spinner()}<span>正在测试连接…</span></div></div>
    </section>`;
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
    const inner = `<div class="metric-value${item.warn ? ' text-warning' : ''}">${esc(item.value)}</div>
      <div class="metric-label">${esc(item.label)}</div>
      ${item.hint ? `<div class="metric-hint">${esc(item.hint)}</div>` : ''}`;
    return item.href
      ? `<a class="metric a-metric-link" href="${item.href}">${inner}</a>`
      : `<div class="metric">${inner}</div>`;
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
        { label: '用户数', value: int(users.total), hint: `活跃 ${int(users.active)}`, href: '#/admin/users' },
        { label: '订单数', value: int(orders.total), hint: `今日新增 ${int(orders.today)}`, href: '#/admin/orders' },
        { label: '总收入', value: money(revenue.totalCents), hint: `本月 ${money(revenue.monthCents)}` },
        { label: '今日收入', value: money(revenue.todayCents), hint: '按支付时间统计' },
        { label: '充值总额', value: money(recharges.totalCents), hint: `今日充值 ${money(recharges.todayCents)}`, href: '#/admin/recharges' },
        {
          label: '待处理订单',
          value: int(pending),
          hint: pending > 0 ? '待支付或待开通，建议尽快处理' : '暂无待处理订单',
          href: '#/admin/orders?status=pending',
          warn: pending > 0,
        },
      ];
      const desc = wrap.querySelector('#a-overview-desc');
      if (desc) desc.textContent = `门户运营数据 · 套餐 ${int(plans.total)} 个（启用 ${int(plans.enabled)}）· 数据实时拉取`;
      statsBox.innerHTML = `<div class="metrics">${items.map(metricHtml).join('')}</div>`;
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

  async function loadXui(btn) {
    xuiBox.innerHTML = `<div class="loading-block">${ui.spinner()}<span>正在测试连接…</span></div>`;
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
      xuiBox.innerHTML = `<div class="rows">${rows.join('')}</div>`;
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      xuiBox.innerHTML = `<div class="stack-sm">
        <div class="alert alert-danger">连接失败：${esc(err && err.message ? err.message : '未知错误')}</div>
        <p class="hint">请检查「系统设置 → 3x-ui」中的面板地址、basePath、API Token 与网络连通性，并确认面板允许当前来源访问。</p>
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

  loadStats();
  loadRecent();
  loadXui(wrap.querySelector('[data-act="test-xui"]'));
}
