export const meta = { title: '我的订单', auth: true, admin: false };

const PROVIDER_TEXT = {
  balance: '余额支付',
  mock: '模拟支付',
  manual: '人工转账',
  epay: '在线支付',
};

function providerText(provider) {
  const key = provider ? String(provider) : '';
  return PROVIDER_TEXT[key] || key || '—';
}

export async function render(root, ctx) {
  const highlightOrderNo = ctx.query && ctx.query.orderNo ? String(ctx.query.orderNo) : '';
  const state = {
    kind: ctx.query && ctx.query.kind === 'recharge' ? 'recharge' : 'plan',
    page: 1,
    pageSize: 20,
    items: [],
    total: 0,
    loading: true,
    error: '',
    busyOrderNo: '',
  };

  root.innerHTML = shellHtml();
  root.addEventListener('click', onClick);
  await load();
  if (highlightOrderNo) await loadHighlight();

  function shellHtml() {
    return `
      <div class="p-orders">
        <div class="page-head">
          <span class="pill-label">订单</span>
          <h1 class="page-title">我的订单</h1>
          <p class="page-desc">查看套餐订单与充值记录。</p>
        </div>
        <section class="card p-orders-tabs-card">
          <div class="card-body p-orders-tabs-body">
            <div class="p-orders-tabs">
              <div class="tabs" role="tablist">
                <button type="button" class="tab ${state.kind === 'plan' ? 'active' : ''}" data-action="tab" data-kind="plan" role="tab">套餐订单</button>
                <button type="button" class="tab ${state.kind === 'recharge' ? 'active' : ''}" data-action="tab" data-kind="recharge" role="tab">充值记录</button>
              </div>
              <span class="text-sm text-muted" id="p-orders-total"></span>
            </div>
          </div>
        </section>
        <div id="p-orders-notice" class="p-orders-notice"></div>
        <div id="p-orders-content" class="p-orders-content"></div>
        <div id="p-orders-pagination" class="p-orders-pagination"></div>
      </div>`;
  }

  async function load() {
    state.loading = true;
    state.error = '';
    renderContent();
    try {
      const data = await ctx.api.orders({ page: state.page, pageSize: state.pageSize, kind: state.kind });
      state.items = Array.isArray(data && data.items) ? data.items : [];
      state.total = Number(data && data.total) || 0;
    } catch (err) {
      if (err && err.code === 'unauthorized') {
        ctx.navigate('/login');
        return;
      }
      state.items = [];
      state.total = 0;
      state.error = (err && err.message) || '订单加载失败，请稍后重试';
    }
    state.loading = false;
    renderContent();
    renderPagination();
  }

  async function onClick(event) {
    const target = event.target;
    if (!target || !target.closest) return;
    const el = target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    if (action === 'tab') {
      const kind = el.getAttribute('data-kind');
      if (kind !== 'plan' && kind !== 'recharge') return;
      if (kind === state.kind) return;
      state.kind = kind;
      state.page = 1;
      setNotice('');
      updateTabs();
      await load();
      return;
    }
    if (action === 'retry' || action === 'refresh') {
      await load();
      return;
    }
    if (action === 'dismiss-notice') {
      setNotice('');
      return;
    }
    if (action === 'mock-complete') {
      await mockComplete(el.getAttribute('data-order-no'), el);
      return;
    }
    if (action === 'continue') {
      const payUrl = el.getAttribute('data-pay-url');
      if (payUrl) window.location.href = payUrl;
      else ctx.toast('暂未获取到支付链接，请稍后重试', 'error');
      return;
    }
    if (action === 'instructions') {
      showInstructions(el.getAttribute('data-order-no'));
    }
  }

  function updateTabs() {
    root.querySelectorAll('[data-action="tab"]').forEach((tab) => {
      tab.classList.toggle('active', tab.getAttribute('data-kind') === state.kind);
    });
  }

  function renderContent() {
    const content = root.querySelector('#p-orders-content');
    if (!content) return;
    const totalEl = root.querySelector('#p-orders-total');
    if (totalEl) totalEl.textContent = state.total > 0 ? `共 ${state.total} 条` : '';

    if (state.loading) {
      content.innerHTML = `<div class="loading-block">${ctx.ui.spinner()}<span class="text-muted text-sm">正在加载订单…</span></div>`;
      return;
    }
    if (state.error) {
      content.innerHTML = `
        <section class="card">
          <div class="card-body">
            <div class="alert alert-danger">${ctx.ui.escape(state.error)}</div>
            <div class="row mt-2">
              <button class="btn btn-primary" type="button" data-action="retry">重试</button>
              <a class="btn btn-secondary" href="#/dashboard">返回我的账号</a>
            </div>
          </div>
        </section>`;
      return;
    }
    if (!state.items.length) {
      content.innerHTML = `
        <section class="card">
          <div class="card-body">
            ${ctx.ui.empty({
              title: state.kind === 'plan' ? '暂无套餐订单' : '暂无充值记录',
              desc: state.kind === 'plan' ? '购买套餐后可在这里查看订单状态。' : '充值后可在这里查看记录。',
              actionHtml: state.kind === 'plan'
                ? '<a class="btn btn-primary" href="#/plans">去购买套餐</a>'
                : '<a class="btn btn-primary" href="#/recharge">去充值</a>',
            })}
          </div>
        </section>`;
      return;
    }

    content.innerHTML = `<div class="stack-gap p-orders-list">${state.items.map(orderCardHtml).join('')}</div>`;
    applyHighlight(content);
  }

  function orderCardHtml(order) {
    const orderNo = order.orderNo ? String(order.orderNo) : '';
    const kindLabel = ctx.ui.escape(ctx.ui.kindText(order.kind));
    const planLabel = order.planName ? ctx.ui.escape(order.planName) : '—';
    return `<article class="card p-order-card" data-order-no="${ctx.ui.escape(orderNo)}">
      <div class="card-head p-order-head">
        <div class="p-order-head-main">
          <div class="p-order-title">${kindLabel}${order.planName ? ` · ${ctx.ui.escape(order.planName)}` : ''}</div>
          <div class="p-order-no mono">${ctx.ui.escape(orderNo)}</div>
        </div>
        ${ctx.ui.badge(order.status)}
      </div>
      <div class="card-body p-order-body">
        <div class="rows">
          <div class="row-item">
            <div class="row-main"><div class="row-title">套餐</div></div>
            <div class="row-side">${planLabel}</div>
          </div>
          <div class="row-item">
            <div class="row-main"><div class="row-title">金额</div></div>
            <div class="row-side p-order-amount">${ctx.ui.money(order.amountCents || 0)}</div>
          </div>
          <div class="row-item">
            <div class="row-main"><div class="row-title">支付方式</div></div>
            <div class="row-side">${ctx.ui.escape(providerText(order.provider))}</div>
          </div>
          <div class="row-item">
            <div class="row-main"><div class="row-title">创建时间</div></div>
            <div class="row-side">${ctx.ui.dateTime(order.createdAt)}</div>
          </div>
        </div>
      </div>
      <div class="card-foot p-order-foot">
        <div class="p-order-actions">${actionsHtml(order)}</div>
      </div>
    </article>`;
  }

  function actionsHtml(order) {
    const actions = [];
    if (order.status === 'pending') {
      if (order.provider === 'mock') {
        const busy = state.busyOrderNo === order.orderNo;
        actions.push(`<button type="button" class="row-action p-tap"
          data-action="mock-complete" data-order-no="${ctx.ui.escape(order.orderNo)}"
          ${busy ? 'disabled' : ''}>${busy ? '处理中…' : '模拟支付'}</button>`);
      } else if (order.provider === 'manual') {
        actions.push('<button type="button" class="row-action p-tap" data-action="instructions">转账说明</button>');
      } else if (order.payUrl) {
        actions.push(`<button type="button" class="row-action p-tap" data-action="continue"
          data-pay-url="${ctx.ui.escape(order.payUrl)}">继续支付</button>`);
      }
      actions.push('<button type="button" class="row-action p-tap" disabled title="暂不支持自助取消，请联系管理员">取消</button>');
    } else if (order.status === 'sync_pending') {
      actions.push('<span class="text-sm text-warning p-order-hint">开通中，系统自动重试</span>');
      actions.push('<button type="button" class="row-action p-tap" data-action="refresh">刷新</button>');
    } else if (order.status === 'paid' || order.status === 'provisioning') {
      actions.push('<span class="text-sm text-muted">处理中…</span>');
    } else {
      actions.push('<span class="text-sm text-muted">—</span>');
    }
    return actions.join('');
  }

  function renderPagination() {
    const wrap = root.querySelector('#p-orders-pagination');
    if (!wrap) return;
    if (state.loading || state.error || state.total <= state.pageSize) {
      wrap.innerHTML = '';
      return;
    }
    wrap.innerHTML = ctx.ui.pagination({
      page: state.page,
      total: state.total,
      pageSize: state.pageSize,
    });
    wrap.querySelectorAll('[data-page]').forEach((node) => {
      node.addEventListener('click', (event) => {
        event.preventDefault();
        goToPage(Number(node.getAttribute('data-page')));
      });
    });
  }

  async function goToPage(page) {
    if (!Number.isInteger(page) || page < 1 || page === state.page) return;
    const maxPage = Math.max(1, Math.ceil(state.total / state.pageSize));
    if (page > maxPage) return;
    state.page = page;
    await load();
  }

  function applyHighlight(content) {
    if (!highlightOrderNo) return;
    content.querySelectorAll('[data-order-no]').forEach((row) => {
      row.classList.toggle('is-highlight', row.getAttribute('data-order-no') === highlightOrderNo);
    });
  }

  function setNotice(html) {
    const notice = root.querySelector('#p-orders-notice');
    if (notice) notice.innerHTML = html;
  }

  function showInstructions(orderNo) {
    const order = state.items.find((item) => item.orderNo === orderNo);
    const instructions = (ctx.config && ctx.config.manualInstructions) || '请完成转账后联系管理员确认订单。';
    setNotice(`
      <div class="alert alert-info">
        <div class="stack-sm">
          <strong>订单 ${ctx.ui.escape(orderNo || '')} 待支付${order ? ` ${ctx.ui.money(order.amountCents)}` : ''}</strong>
          <div class="text-sm">${ctx.ui.escape(instructions)}</div>
          <button type="button" class="link-btn p-tap" data-action="dismiss-notice">关闭</button>
        </div>
      </div>`);
    const notice = root.querySelector('#p-orders-notice');
    if (notice && notice.scrollIntoView) notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function mockComplete(orderNo, button) {
    if (!orderNo || state.busyOrderNo) return;
    state.busyOrderNo = orderNo;
    if (button) {
      button.disabled = true;
      button.textContent = '处理中…';
    }
    try {
      const order = await ctx.api.mockComplete(orderNo);
      const message = order && order.status === 'sync_pending'
        ? '支付成功，套餐开通中，系统将自动重试'
        : '模拟支付成功';
      ctx.toast(message, 'success');
      try {
        await ctx.refreshMe();
      } catch {
        /* 刷新失败不影响订单列表重新加载 */
      }
      state.busyOrderNo = '';
      await load();
    } catch (err) {
      state.busyOrderNo = '';
      if (err && err.code === 'unauthorized') {
        ctx.navigate('/login');
        return;
      }
      ctx.toast((err && err.message) || '模拟支付失败，请稍后重试', 'error');
      if (button) {
        button.disabled = false;
        button.textContent = '模拟支付';
      }
    }
  }

  async function loadHighlight() {
    let order = null;
    try {
      order = await ctx.api.order(highlightOrderNo);
    } catch (err) {
      if (err && err.code === 'unauthorized') ctx.navigate('/login');
      return;
    }
    if (!order) return;
    if (order.kind && order.kind !== state.kind) {
      state.kind = order.kind === 'recharge' ? 'recharge' : 'plan';
      state.page = 1;
      updateTabs();
      await load();
    }
    setNotice(`
      <div class="alert alert-info">
        <div class="row">
          <span>订单 <span class="mono">${ctx.ui.escape(order.orderNo)}</span> 当前状态</span>
          ${ctx.ui.badge(order.status)}
          <span class="text-sm text-muted">${ctx.ui.escape(ctx.ui.statusText(order.status))}</span>
          <a class="link-btn p-tap" href="#/orders">清除筛选</a>
        </div>
      </div>`);
  }
}
