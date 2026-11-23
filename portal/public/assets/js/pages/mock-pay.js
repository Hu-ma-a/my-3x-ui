export const meta = { title: '模拟支付', auth: true, admin: false };

export async function render(root, ctx) {
  const orderNo = (ctx.query && ctx.query.orderNo) || (ctx.params && ctx.params.orderNo) || '';
  root.innerHTML = loadingHtml();
  if (!orderNo) {
    root.innerHTML = messageHtml('缺少订单号', '请从订单列表重新进入模拟支付页面。');
    return;
  }

  let order = null;
  try {
    order = await ctx.api.order(String(orderNo));
  } catch (err) {
    if (err && err.code === 'unauthorized') {
      ctx.navigate('/login');
      return;
    }
    root.innerHTML = messageHtml('订单加载失败', (err && err.message) || '订单不存在或链接已失效。');
    return;
  }
  if (!order) {
    root.innerHTML = messageHtml('订单不存在', '订单不存在或链接已失效。');
    return;
  }
  if (order.provider !== 'mock') {
    root.innerHTML = messageHtml('无法模拟支付', '该订单不是模拟支付订单，请到订单列表查看。');
    return;
  }

  root.innerHTML = pageHtml(order);
  if (order.status === 'pending') bindEvents(order);

  function pageHtml(item) {
    const pending = item.status === 'pending';
    const kindLabel = ctx.ui.escape(ctx.ui.kindText(item.kind));
    return `
      <div class="p-mock">
        <div class="p-mock-inner">
          <div class="page-head center p-mock-head">
            <span class="pill-label">模拟支付</span>
            <h1 class="display p-mock-amount">${ctx.ui.money(item.amountCents || 0)}</h1>
            <p class="page-desc mono">订单号 ${ctx.ui.escape(item.orderNo)}</p>
          </div>
          <section class="card p-mock-card">
            <div class="card-body">
              <div class="alert alert-info">该页面仅用于本地或测试环境验证支付流程，不会产生真实扣款。</div>
              <div class="rows p-mock-rows">
                <div class="row-item">
                  <div class="row-main"><div class="row-title">订单类型</div></div>
                  <div class="row-side">${kindLabel}${item.planName ? ` · ${ctx.ui.escape(item.planName)}` : ''}</div>
                </div>
                <div class="row-item">
                  <div class="row-main"><div class="row-title">当前状态</div></div>
                  <div class="row-side">${ctx.ui.badge(item.status)}</div>
                </div>
                <div class="row-item">
                  <div class="row-main"><div class="row-title">创建时间</div></div>
                  <div class="row-side">${ctx.ui.dateTime(item.createdAt)}</div>
                </div>
              </div>
              <div id="p-mock-result" class="p-mock-result">${pending ? '' : resultNoticeHtml(item.status)}</div>
              <div class="error-text" id="p-mock-error" role="alert"></div>
              <div class="p-mock-actions">
                ${pending ? '<button class="btn btn-accent btn-lg btn-block" type="button" id="p-mock-submit">模拟支付成功</button>' : ''}
                <div class="p-mock-links">
                  <a class="btn btn-secondary" href="#/orders?orderNo=${encodeURIComponent(item.orderNo)}">查看订单</a>
                  <a class="btn btn-ghost" href="#/orders">返回订单列表</a>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>`;
  }

  function bindEvents(item) {
    const submit = root.querySelector('#p-mock-submit');
    const errorEl = root.querySelector('#p-mock-error');
    const resultEl = root.querySelector('#p-mock-result');
    if (!submit) return;

    submit.addEventListener('click', async () => {
      submit.disabled = true;
      submit.classList.add('btn-loading');
      submit.textContent = '支付处理中…';
      errorEl.textContent = '';
      try {
        const finalOrder = await ctx.api.mockComplete(item.orderNo);
        try {
          await ctx.refreshMe();
        } catch {
          /* 订单页会重新拉取最新状态 */
        }
        const status = finalOrder && finalOrder.status;
        const statusLabel = ctx.ui.escape(ctx.ui.statusText(status));
        resultEl.innerHTML = `
          <div class="alert alert-success">
            模拟支付成功，当前状态：${statusLabel}${status === 'sync_pending' ? '，系统正在自动开通套餐' : ''}
          </div>`;
        submit.textContent = '已完成';
        ctx.toast('模拟支付成功', 'success');
        scheduleRedirect(item.orderNo);
      } catch (err) {
        if (err && err.code === 'unauthorized') {
          ctx.navigate('/login');
          return;
        }
        const message = (err && err.message) || '模拟支付失败，请稍后重试';
        errorEl.textContent = message;
        ctx.toast(message, 'error');
        submit.disabled = false;
        submit.classList.remove('btn-loading');
        submit.textContent = '模拟支付成功';
        if (err && (err.code === 'invalid_status' || err.code === 'invalid_provider' || err.code === 'not_found')) {
          resultEl.innerHTML = '<div class="alert alert-info">订单状态已变化，请点击「查看订单」确认最新状态。</div>';
        }
      }
    });
  }

  function resultNoticeHtml(status) {
    const label = ctx.ui.escape(ctx.ui.statusText(status));
    const success = status === 'provisioned' || status === 'credited';
    return `<div class="alert ${success ? 'alert-success' : 'alert-info'}">订单当前状态：${label}</div>`;
  }

  function scheduleRedirect(targetOrderNo) {
    const timer = window.setTimeout(() => {
      if (window.location.hash.indexOf('/pay/mock') === -1) return;
      ctx.navigate(`/orders?orderNo=${encodeURIComponent(targetOrderNo)}`);
    }, 1800);
    if (typeof ctx.onCleanup === 'function') ctx.onCleanup(() => window.clearTimeout(timer));
  }

  function loadingHtml() {
    return `<div class="loading-block">${ctx.ui.spinner()}<span class="text-muted text-sm">正在加载订单信息…</span></div>`;
  }

  function messageHtml(title, message) {
    return `<div class="p-mock">
      <div class="p-mock-inner">
        <div class="page-head center p-mock-head">
          <span class="pill-label">模拟支付</span>
          <h1 class="page-title">${ctx.ui.escape(title)}</h1>
        </div>
        <section class="card p-mock-card">
          <div class="card-body">
            <div class="alert alert-danger">${ctx.ui.escape(message)}</div>
            <div class="row mt-2">
              <a class="btn btn-primary" href="#/orders">查看订单列表</a>
              <a class="btn btn-secondary" href="#/dashboard">返回我的账号</a>
            </div>
          </div>
        </section>
      </div>
    </div>`;
  }
}
