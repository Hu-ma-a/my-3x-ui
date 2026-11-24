export const meta = { title: '我的账号', auth: true, admin: false };

export async function render(root, ctx) {
  const state = { status: null, error: '' };
  let subscriptionUrl = '';
  let links = [];

  root.innerHTML = loadingHtml();
  root.addEventListener('click', onClick);
  await load();

  async function load() {
    root.innerHTML = loadingHtml();
    try {
      state.status = await ctx.refreshMe();
    } catch (err) {
      if (err && err.code === 'unauthorized') {
        ctx.navigate('/login');
        return;
      }
      if (ctx.status && ctx.status.user) {
        state.status = ctx.status;
        state.error = (err && err.message) || '刷新实时数据失败';
      } else {
        root.innerHTML = errorHtml(err);
        return;
      }
    }
    renderDashboard();
  }

  async function onClick(event) {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    if (action === 'go-plans') {
      ctx.navigate('/plans');
      return;
    }
    if (action === 'go-recharge') {
      ctx.navigate('/recharge');
      return;
    }
    if (action === 'retry') {
      state.error = '';
      await load();
      return;
    }
    if (action === 'copy-sub-url') {
      await copyText(subscriptionUrl);
      return;
    }
    if (action === 'copy-link') {
      const index = Number(el.getAttribute('data-index'));
      await copyText(links[index]);
    }
  }

  async function copyText(text) {
    if (!text) {
      ctx.toast('暂无可复制的内容', 'error');
      return;
    }
    const ok = await ctx.ui.copy(text);
    ctx.toast(ok ? '已复制到剪贴板' : '复制失败，请手动复制', ok ? 'success' : 'error');
  }

  function renderDashboard() {
    const status = state.status || {};
    const user = status.user || ctx.me;
    if (!user) {
      root.innerHTML = errorHtml({ message: '未获取到账号信息，请重新登录' });
      return;
    }

    const live = status.live || { available: false, error: '实时数据不可用' };
    const liveAvailable = live.available === true;
    const recentOrders = Array.isArray(status.recentOrders) ? status.recentOrders : [];
    const planName = user.planName || null;
    const expiresAt = (liveAvailable && live.expiresAt) || user.planExpiresAt || null;
    const deviceLimit = liveAvailable && live.deviceLimit != null ? live.deviceLimit : user.clientLimit;
    const totalBytes = liveAvailable ? live.totalBytes : user.totalBytes;
    const usedBytes = liveAvailable && typeof live.usedBytes === 'number' ? live.usedBytes : null;
    const remainingBytes = liveAvailable && typeof live.remainingBytes === 'number' ? live.remainingBytes : null;
    const hasPlan = Boolean(planName || expiresAt);
    subscriptionUrl = liveAvailable && live.subscriptionUrl ? live.subscriptionUrl : '';
    links = liveAvailable && Array.isArray(live.links) ? live.links : [];

    const expired = Boolean(expiresAt) && expiresAt <= Date.now();
    const planBadge = !expiresAt
      ? '<span class="badge badge-muted">未开通</span>'
      : expired
        ? '<span class="badge badge-danger">已过期</span>'
        : '<span class="badge badge-success">生效中</span>';
    const accountBadge = user.status === 'disabled'
      ? '<span class="badge badge-danger">已禁用</span>'
      : '<span class="badge badge-success">正常</span>';
    const deviceText = deviceLimit == null ? '设备数未知' : deviceLimit === 0 ? '设备不限' : `${deviceLimit} 台设备`;

    const usedText = usedBytes == null ? '—' : ctx.ui.bytes(usedBytes);
    const totalText = ctx.ui.bytes(totalBytes);
    const remainingText = ctx.ui.bytes(
      remainingBytes != null ? remainingBytes : Math.max(0, (Number(totalBytes) || 0) - (usedBytes || 0)),
    );

    let trafficHtml = '';
    if (totalBytes === 0) {
      trafficHtml = `
        <div class="metrics">
          <div class="metric">
            <div class="metric-value">${usedText}</div>
            <div class="metric-label">已使用</div>
          </div>
          <div class="metric">
            <div class="metric-value">不限</div>
            <div class="metric-label">总流量</div>
          </div>
          <div class="metric">
            <div class="metric-value">不限</div>
            <div class="metric-label">剩余</div>
          </div>
        </div>
        <p class="hint p-traffic-hint">当前套餐不限流量。</p>`;
    } else if (totalBytes > 0) {
      const percentText = usedBytes == null ? '' : ctx.ui.pct(usedBytes, totalBytes);
      const ratio = usedBytes == null ? 0 : Math.min(1, usedBytes / totalBytes);
      const barClass = ratio >= 0.9 ? 'danger' : ratio >= 0.7 ? 'warning' : 'accent';
      trafficHtml = `
        <div class="metrics">
          <div class="metric">
            <div class="metric-value">${usedText}</div>
            <div class="metric-label">已使用</div>
          </div>
          <div class="metric">
            <div class="metric-value">${remainingText}</div>
            <div class="metric-label">剩余</div>
          </div>
          <div class="metric">
            <div class="metric-value">${totalText}</div>
            <div class="metric-label">总流量</div>
          </div>
        </div>
        <div class="track p-track"><div class="track-fill ${barClass}" style="width: ${percentText || '0%'}"></div></div>
        <div class="row-between p-track-foot text-sm text-muted">
          <span>${percentText ? `${percentText} 已使用` : '已用流量统计中'}</span>
          <span>剩余 ${remainingText}</span>
        </div>`;
    } else {
      trafficHtml = '<p class="text-muted text-sm">暂无流量额度信息，购买套餐后可查看。</p>';
    }

    const warnings = [];
    if (state.error) warnings.push(`实时数据刷新失败：${ctx.ui.escape(state.error)}`);
    if (!liveAvailable) {
      const reason = live && live.error ? `：${ctx.ui.escape(live.error)}` : '';
      warnings.push(`实时数据暂不可用${reason}，以下展示最近一次购买的缓存信息。`);
    }
    const warningHtml = warnings.length
      ? `<section class="card p-notice-card">
          <div class="card-body p-notice-body">
            <div class="alert alert-warning">
              <div class="stack-sm">${warnings.map((item) => `<div>${item}</div>`).join('')}</div>
            </div>
          </div>
        </section>`
      : '';

    const headHtml = `
      <header class="page-head p-dash-head">
        <div class="p-dash-head-main">
          <span class="pill-label">我的账号</span>
          <h1 class="page-title p-dash-title">你好，${ctx.ui.escape(user.username || '用户')}</h1>
          <p class="page-desc p-dash-summary">${hasPlan
            ? `${ctx.ui.escape(planName || '已开通套餐')} · ${expiresAt ? `${ctx.ui.dateTime(expiresAt)} 到期` : '到期时间未知'}`
            : '还没有开通套餐'} · ${deviceText} · 余额 <b class="p-balance-value">${ctx.ui.money(user.balanceCents || 0)}</b></p>
          <div class="p-dash-note">
            <span>${user.email ? ctx.ui.escape(user.email) : '未绑定邮箱'}</span>
            ${user.lastLoginAt ? `<span>上次登录 ${ctx.ui.dateTime(user.lastLoginAt)}</span>` : ''}
            <span>账号状态 ${accountBadge}</span>
          </div>
        </div>
        <div class="hero-actions p-dash-actions">
          <button class="btn btn-primary" type="button" data-action="go-plans">购买套餐</button>
          <button class="btn btn-secondary" type="button" data-action="go-recharge">充值</button>
        </div>
      </header>`;

    const planCardHtml = `
      <section class="card p-plan-card">
        <div class="card-head">
          <h2 class="card-title">套餐状态</h2>
          ${planBadge}
        </div>
        <div class="card-body">
          ${hasPlan
            ? `<div class="p-plan-name">${ctx.ui.escape(planName || '未命名套餐')}</div>
              <dl class="kv p-plan-kv">
                <dt>到期时间</dt>
                <dd>${expiresAt ? `${ctx.ui.dateTime(expiresAt)} · ${ctx.ui.relative(expiresAt)}` : '—'}</dd>
                <dt>设备数</dt>
                <dd>${deviceText}</dd>
                <dt>账户余额</dt>
                <dd class="p-balance-text">${ctx.ui.money(user.balanceCents || 0)}</dd>
              </dl>`
            : `<div class="empty p-empty-sm">
                <div class="empty-title">还没有开通套餐</div>
                <p>选择一个套餐即可开始使用，支付成功后订阅链接会自动生成。</p>
                <div class="empty-actions">
                  <button class="btn btn-primary btn-sm" type="button" data-action="go-plans">去购买套餐</button>
                  <button class="btn btn-secondary btn-sm" type="button" data-action="go-recharge">先充值余额</button>
                </div>
              </div>`}
        </div>
        ${hasPlan
          ? `<div class="card-foot p-plan-card-foot">
              <span class="text-sm text-muted">套餐到期前续费会自动延长有效期。</span>
              <button class="btn btn-primary btn-sm" type="button" data-action="go-plans">续费套餐</button>
            </div>`
          : ''}
      </section>`;

    const trafficCardHtml = `
      <section class="card p-traffic-card">
        <div class="card-head">
          <h2 class="card-title">流量使用</h2>
          <span class="badge ${liveAvailable ? 'badge-success' : 'badge-muted'}">${liveAvailable ? '实时数据' : '缓存数据'}</span>
        </div>
        <div class="card-body">${trafficHtml}</div>
      </section>`;

    const subscriptionCardHtml = `
      <section class="card p-sub-card">
        <div class="card-head">
          <h2 class="card-title">订阅</h2>
          ${subscriptionUrl ? '<span class="badge badge-success">链接可用</span>' : '<span class="badge badge-muted">未生成</span>'}
        </div>
        <div class="card-body p-sub-body">
          ${subscriptionUrl
            ? `<div class="p-sub-url">
                <input class="input mono" readonly value="${ctx.ui.escape(subscriptionUrl)}" aria-label="订阅链接" />
                <button class="btn btn-secondary" type="button" data-action="copy-sub-url">复制链接</button>
              </div>`
            : '<p class="text-muted text-sm">购买套餐后会自动生成订阅链接，可在客户端一键导入。</p>'}
          <div class="rows p-client-rows">
            <div class="row-item">
              <div class="row-main">
                <div class="row-title">客户端一键导入</div>
                <div class="row-sub">v2rayN：订阅 → 订阅设置 → 添加；Clash Verge：配置 → 订阅；Shadowrocket：添加 → 订阅。</div>
              </div>
            </div>
          </div>
          ${links.length
            ? `<details class="p-links">
                <summary>查看全部节点链接（${links.length} 条）</summary>
                <div class="rows p-link-list">
                  ${links.map((link, index) => `
                    <div class="row-item">
                      <div class="row-main"><div class="row-sub mono p-link-text">${ctx.ui.escape(link)}</div></div>
                      <button class="row-action p-tap" type="button" data-action="copy-link" data-index="${index}">复制</button>
                    </div>`).join('')}
                </div>
              </details>`
            : ''}
          ${!subscriptionUrl && !links.length
            ? '<div class="p-sub-fallback"><a class="btn btn-secondary" href="#/plans">去购买套餐</a></div>'
            : ''}
        </div>
      </section>`;

    const recentOrdersHtml = recentOrders.length
      ? `<div class="rows">${recentOrders.map(orderItemHtml).join('')}</div>`
      : ctx.ui.empty({
        title: '暂无订单',
        desc: '购买套餐或充值后会在这里显示记录',
        actionHtml: '<a class="btn btn-secondary" href="#/plans">去购买套餐</a>',
      });

    const ordersCardHtml = `
      <section class="card p-orders-card">
        <div class="card-head">
          <h2 class="card-title">最近订单</h2>
          <a class="link-btn p-tap" href="#/orders">查看全部订单</a>
        </div>
        <div class="card-body p-orders-body">${recentOrdersHtml}</div>
      </section>`;

    root.innerHTML = `
      <div class="p-dashboard">
        ${headHtml}
        ${warningHtml}
        <div class="card-grid cols-2 p-dash-grid">
          ${planCardHtml}
          ${trafficCardHtml}
        </div>
        ${hasPlan ? subscriptionCardHtml : ''}
        ${ordersCardHtml}
      </div>`;
  }

  function orderItemHtml(order) {
    const orderNo = order && order.orderNo ? String(order.orderNo) : '';
    const kindLabel = ctx.ui.escape(ctx.ui.kindText(order && order.kind));
    const planLabel = order && order.planName ? ` · ${ctx.ui.escape(order.planName)}` : '';
    return `<a class="row-item is-link p-order-item" href="#/orders?orderNo=${encodeURIComponent(orderNo)}">
      <div class="row-main">
        <div class="row-title">${kindLabel}${planLabel}</div>
        <div class="row-sub"><span class="mono">${ctx.ui.escape(orderNo)}</span> · ${order ? ctx.ui.dateTime(order.createdAt) : '—'}</div>
      </div>
      <div class="row-side p-order-side">
        <span class="p-order-amount">${ctx.ui.money((order && order.amountCents) || 0)}</span>
        ${ctx.ui.badge(order && order.status)}
      </div>
    </a>`;
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
            <button class="btn btn-primary" type="button" data-action="retry">重试</button>
            <a class="btn btn-secondary" href="#/login">重新登录</a>
          </div>
        </div>
      </section>
    </div>`;
  }
}
