export const meta = { title: '购买套餐', auth: true, admin: false };

export async function render(root, ctx) {
  const state = {
    plans: [],
    method: 'balance',
    provider: '',
    busy: false,
    manual: null,
  };
  const me = (ctx.status && ctx.status.user) || ctx.me || {};
  const providers = onlineProviders();
  if (providers.length > 0) state.provider = providers[0].id;

  root.innerHTML = loadingHtml();
  root.addEventListener('click', onClick);
  await load();

  async function load() {
    root.innerHTML = loadingHtml();
    try {
      const data = await ctx.api.plans();
      state.plans = Array.isArray(data) ? data : Array.isArray(data && data.plans) ? data.plans : [];
    } catch (err) {
      if (err && err.code === 'unauthorized') {
        ctx.navigate('/login');
        return;
      }
      root.innerHTML = errorHtml(err);
      return;
    }
    renderPage();
  }

  function onlineProviders() {
    const list = ctx.config && Array.isArray(ctx.config.providers) ? ctx.config.providers : [];
    return list.filter((item) => item && item.id && item.kind !== 'balance' && item.id !== 'balance');
  }

  async function onClick(event) {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    if (action === 'retry') {
      await load();
      return;
    }
    if (state.busy) return;
    if (action === 'method') {
      state.method = el.getAttribute('data-method') === 'online' ? 'online' : 'balance';
      renderPage();
      return;
    }
    if (action === 'provider') {
      state.provider = el.getAttribute('data-provider') || '';
      renderPage();
      return;
    }
    if (action === 'dismiss-manual') {
      state.manual = null;
      renderPage();
      return;
    }
    if (action === 'buy') {
      const planId = Number(el.getAttribute('data-plan-id'));
      if (Number.isInteger(planId)) await purchase(planId);
    }
  }

  async function purchase(planId) {
    const plan = state.plans.find((item) => item.id === planId);
    if (!plan) return;
    if (state.method === 'balance' && (me.balanceCents || 0) < plan.priceCents) {
      ctx.toast('余额不足，请先充值或切换为在线支付', 'error');
      return;
    }
    if (state.method === 'online' && !state.provider) {
      ctx.toast('请先选择支付方式', 'error');
      return;
    }

    state.busy = true;
    renderPage();
    try {
      const result = await ctx.api.purchase({
        planId,
        method: state.method,
        provider: state.method === 'online' ? state.provider : undefined,
      });
      state.busy = false;
      await handlePayment(result);
    } catch (err) {
      state.busy = false;
      const reload = handlePurchaseError(err);
      if (reload) await load();
      else renderPage();
    }
  }

  async function handlePayment(result) {
    const order = result && result.order ? result.order : null;
    const payment = result && result.payment ? result.payment : { type: 'balance' };
    if (!order) {
      ctx.toast('购买成功，请到订单页查看', 'success');
      ctx.navigate('/orders');
      return;
    }
    if (payment.type === 'redirect') {
      if (payment.payUrl) {
        window.location.href = payment.payUrl;
      } else {
        ctx.toast('支付链接获取失败，请到订单页重新支付', 'error');
        ctx.navigate('/orders');
      }
      return;
    }
    if (payment.type === 'mock') {
      ctx.navigate(`/pay/mock?orderNo=${encodeURIComponent(order.orderNo)}`);
      return;
    }
    if (payment.type === 'manual') {
      state.manual = {
        orderNo: order.orderNo,
        amountCents: order.amountCents,
        instructions: payment.instructions
          || (ctx.config && ctx.config.manualInstructions)
          || '请按管理员提供的说明完成转账。',
      };
      ctx.toast('订单已创建，请按转账说明完成支付', 'info');
      renderPage();
      const box = root.querySelector('#p-manual-box');
      if (box && box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (order.status === 'sync_pending') {
      ctx.toast('支付成功，套餐正在开通中', 'info');
    } else {
      ctx.toast('购买成功，套餐已开通', 'success');
    }
    try {
      await ctx.refreshMe();
    } catch {
      /* 仪表盘会再次拉取最新状态 */
    }
    ctx.navigate('/dashboard');
  }

  function handlePurchaseError(err) {
    if (err && err.code === 'unauthorized') {
      ctx.navigate('/login');
      return false;
    }
    if (err && err.code === 'insufficient_balance') {
      ctx.toast('余额不足，请先充值或切换为在线支付', 'error');
      return false;
    }
    if (err && (err.code === 'plan_disabled' || err.code === 'plan_not_found')) {
      ctx.toast('该套餐已下架，正在刷新套餐列表', 'error');
      return true;
    }
    if (err && err.code === 'provider_unavailable') {
      ctx.toast('该支付方式暂不可用，请更换后再试', 'error');
      return false;
    }
    ctx.toast((err && err.message) || '购买失败，请稍后重试', 'error');
    return false;
  }

  function providerSubtitle(item) {
    if (item.kind === 'redirect') return '跳转到第三方支付页面完成付款';
    if (item.kind === 'mock') return '测试环境模拟支付，不会真实扣款';
    if (item.kind === 'manual') return '转账后由管理员确认到账';
    return '在线支付';
  }

  function renderPage() {
    const featuredIndex = state.plans.findIndex((item) => item && item.featured);
    const primaryIndex = featuredIndex >= 0 ? featuredIndex : 0;
    root.innerHTML = `
      <div class="p-plans">
        <div class="page-head">
          <h1 class="page-title">购买套餐</h1>
          <p class="page-desc">选择适合的套餐，支付成功后自动开通并生成订阅链接。</p>
        </div>
        ${state.manual ? manualHtml() : ''}
        <section class="section">
          <div class="section-head">
            <h2 class="section-title">支付方式</h2>
            <span class="text-sm text-muted">当前余额 ${ctx.ui.money(me.balanceCents || 0)}</span>
          </div>
          <div class="p-pay-body">
            <div class="chip-group p-pay-switch" role="group" aria-label="支付方式">
              <button type="button" class="chip ${state.method === 'balance' ? 'selected' : ''}"
                data-action="method" data-method="balance" ${state.busy ? 'disabled' : ''}>余额支付</button>
              <button type="button" class="chip ${state.method === 'online' ? 'selected' : ''}"
                data-action="method" data-method="online" ${state.busy ? 'disabled' : ''}>在线支付</button>
            </div>
            ${state.method === 'balance' ? balanceHintHtml() : providerHtml()}
          </div>
        </section>
        <section class="section">
          <div class="section-head">
            <h2 class="section-title">套餐</h2>
            <span class="text-sm text-muted">${state.plans.length ? `共 ${state.plans.length} 个可选套餐` : ''}</span>
          </div>
          ${state.plans.length
            ? `<div class="plan-list">${state.plans.map((plan, index) => planRowHtml(plan, index === primaryIndex)).join('')}</div>`
            : ctx.ui.empty({
              title: '暂无可购买套餐',
              desc: '管理员还未上架套餐，请稍后再来看看。',
              actionHtml: '<a class="btn btn-secondary" href="#/dashboard">返回我的账号</a>',
            })}
        </section>
      </div>`;
  }

  function balanceHintHtml() {
    return `<p class="hint p-pay-hint">余额支付会立即扣款并开通套餐；余额不足时可切换为在线支付，或
      <a href="#/recharge">前往充值</a>。</p>`;
  }

  function providerHtml() {
    if (providers.length === 0) {
      return '<div class="alert alert-danger p-pay-hint">暂未配置可用的在线支付方式，请先充值余额或联系管理员。</div>';
    }
    return `
      <div class="choice-list p-pay-choices">
        ${providers.map((item) => `
          <button type="button" class="choice ${state.provider === item.id ? 'selected' : ''}"
            data-action="provider" data-provider="${ctx.ui.escape(item.id)}" ${state.busy ? 'disabled' : ''}>
            <span class="choice-radio" aria-hidden="true"></span>
            <span class="choice-main p-choice-stack">
              <span class="choice-title">${ctx.ui.escape(item.label || item.id)}</span>
              <span class="choice-sub">${ctx.ui.escape(providerSubtitle(item))}</span>
            </span>
          </button>`).join('')}
      </div>
      <p class="hint p-pay-hint">在线支付完成后套餐自动开通；若长时间未到账，请联系管理员。</p>`;
  }

  function planRowHtml(plan, primary) {
    const owned = Boolean(
      (me.planId && me.planId === plan.id) || (me.planName && me.planName === plan.name),
    );
    const trafficText = plan.trafficBytes > 0
      ? ctx.ui.bytes(plan.trafficBytes)
      : plan.trafficGb > 0 ? `${plan.trafficGb} GB` : '不限流量';
    const deviceText = plan.deviceLimit ? `${plan.deviceLimit} 台` : '不限';
    return `<div class="plan-row p-plan-row">
      <div class="plan-main">
        <div class="plan-name">${ctx.ui.escape(plan.name)}${plan.featured ? '<span class="plan-tag">推荐</span>' : ''}</div>
        <p class="plan-desc">${plan.description ? ctx.ui.escape(plan.description) : '暂无套餐描述'}</p>
        <div class="plan-meta">
          <span><b>${trafficText}</b> 流量</span>
          <span><b>${plan.days} 天</b> 有效期</span>
          <span><b>${deviceText}</b> 设备</span>
        </div>
      </div>
      <div class="plan-side">
        <div class="plan-price">${ctx.ui.money(plan.priceCents)}<small> / ${plan.days} 天</small></div>
        <button type="button" class="btn ${primary ? 'btn-primary' : 'btn-secondary'}"
          data-action="buy" data-plan-id="${ctx.ui.escape(String(plan.id))}" ${state.busy ? 'disabled' : ''}>
          ${owned ? '续费' : '立即购买'}
        </button>
      </div>
    </div>`;
  }

  function manualHtml() {
    return `<div class="p-manual" id="p-manual-box">
      <div class="alert alert-info">
        <div class="stack-sm">
          <strong>订单 ${ctx.ui.escape(state.manual.orderNo)} 待支付 ${ctx.ui.money(state.manual.amountCents)}</strong>
          <div class="text-sm">${ctx.ui.escape(state.manual.instructions)}</div>
          <div class="row p-manual-actions">
            <a class="btn btn-secondary" href="#/orders?orderNo=${encodeURIComponent(state.manual.orderNo)}">查看订单</a>
            <button class="btn btn-ghost" type="button" data-action="dismiss-manual">关闭提示</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  function loadingHtml() {
    return `<div class="loading-block">${ctx.ui.spinner()}<span class="text-muted text-sm">正在加载套餐…</span></div>`;
  }

  function errorHtml(err) {
    const message = (err && err.message) || '套餐加载失败，请稍后重试';
    return `<div class="p-error">
      <div class="alert alert-danger">${ctx.ui.escape(message)}</div>
      <div class="row mt-2">
        <button class="btn btn-primary" type="button" data-action="retry">重试</button>
        <a class="btn btn-secondary" href="#/dashboard">返回我的账号</a>
      </div>
    </div>`;
  }
}
