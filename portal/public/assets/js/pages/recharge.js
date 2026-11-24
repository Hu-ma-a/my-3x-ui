export const meta = { title: '在线充值', auth: true, admin: false };

const QUICK_AMOUNTS = [1000, 3000, 5000, 10000, 20000, 50000];
const DEFAULT_AMOUNT = 10000;

export async function render(root, ctx) {
  const config = ctx.config || {};
  const minCents = Number.isFinite(config.minRechargeCents) ? config.minRechargeCents : 100;
  const maxCents = Number.isFinite(config.maxRechargeCents) ? config.maxRechargeCents : 1000000;
  const me = (ctx.status && ctx.status.user) || ctx.me || {};
  const allProviders = Array.isArray(config.providers) ? config.providers : [];
  const providers = allProviders.filter((item) => item && item.id && item.kind !== 'balance' && item.id !== 'balance');
  const state = {
    amountCents: DEFAULT_AMOUNT,
    provider: providers.length > 0 ? providers[0].id : '',
    busy: false,
  };

  root.innerHTML = pageHtml();
  bindEvents();

  function providerSubtitle(item) {
    if (item.kind === 'redirect') return '跳转到第三方支付页面完成付款';
    if (item.kind === 'mock') return '测试环境模拟支付，不会真实扣款';
    if (item.kind === 'manual') return '转账后由管理员确认到账';
    return '在线支付';
  }

  function pageHtml() {
    return `
      <div class="p-recharge">
        <div class="page-head center">
          <span class="pill-label">充值</span>
          <h1 class="display">充值到账户余额</h1>
          <p class="page-desc">充值金额进入账户余额，可直接用于购买套餐。</p>
        </div>
        <div class="p-recharge-inner">
          <section class="card p-recharge-card">
            <div class="card-body">
              <div class="field">
                <label class="field-label" for="p-recharge-custom">充值金额（${ctx.ui.currencyName()}）</label>
                <div class="input-wrap p-amount-wrap">
                  <span class="input-prefix" aria-hidden="true">${ctx.ui.currencySymbol()}</span>
                  <input class="input p-amount-input" id="p-recharge-custom" type="number" inputmode="decimal"
                    min="${minCents / 100}" max="${maxCents / 100}" step="0.01" placeholder="请输入充值金额" />
                </div>
                <div class="chip-group p-recharge-chips">
                  ${QUICK_AMOUNTS.map((cents) => `
                    <button type="button" class="chip ${state.amountCents === cents ? 'selected' : ''}" data-amount="${cents}">
                      ${ctx.ui.money(cents)}
                    </button>`).join('')}
                </div>
                <div class="hint">单次充值范围 ${ctx.ui.money(minCents)} – ${ctx.ui.money(maxCents)}</div>
                <div class="error-text" data-error="amount"></div>
              </div>
              <hr class="divider">
              <div class="p-recharge-method">
                <h2 class="card-title p-section-label">支付方式</h2>
                ${providers.length > 0
                  ? `<div class="choice-list">
                      ${providers.map((item) => `
                        <button type="button" class="choice ${state.provider === item.id ? 'selected' : ''}"
                          data-provider="${ctx.ui.escape(item.id)}">
                          <span class="choice-radio" aria-hidden="true"></span>
                          <span class="choice-main p-choice-stack">
                            <span class="choice-title">${ctx.ui.escape(item.label || item.id)}</span>
                            <span class="choice-sub">${ctx.ui.escape(providerSubtitle(item))}</span>
                          </span>
                        </button>`).join('')}
                    </div>`
                  : '<div class="alert alert-danger">暂未配置可用的在线支付方式，请联系管理员。</div>'}
                <div class="error-text" data-error="provider"></div>
              </div>
              <hr class="divider">
              <div class="row-between p-recharge-total">
                <span class="text-muted">应付金额</span>
                <strong id="p-recharge-total">${ctx.ui.money(state.amountCents)}</strong>
              </div>
              <div class="error-text" id="p-recharge-error" role="alert"></div>
              <button class="btn btn-primary btn-lg btn-block" id="p-recharge-submit" type="button" ${providers.length > 0 ? '' : 'disabled'}>立即充值</button>
              <p class="hint text-center p-recharge-secure">支付成功后余额自动到账，无需人工确认。</p>
            </div>
          </section>
          <section class="card p-recharge-note">
            <div class="card-head">
              <h2 class="card-title">余额说明</h2>
              <span class="badge badge-muted">当前余额 ${ctx.ui.money(me.balanceCents || 0)}</span>
            </div>
            <div class="card-body">
              <ul class="check-list p-tip-list">
                <li class="check-item">充值金额实时进入账户余额，可直接用于购买套餐</li>
                <li class="check-item">余额支付套餐会立即开通，无需等待</li>
                <li class="check-item">在线支付成功后自动到账，人工转账需管理员确认</li>
              </ul>
              <div id="p-recharge-notice" class="p-recharge-notice"></div>
              <a class="link-btn p-tap p-recharge-records" href="#/orders">查看充值记录</a>
            </div>
          </section>
        </div>
      </div>`;
  }

  function bindEvents() {
    const customInput = root.querySelector('#p-recharge-custom');
    const quickButtons = Array.from(root.querySelectorAll('[data-amount]'));
    const providerButtons = Array.from(root.querySelectorAll('[data-provider]'));
    const submit = root.querySelector('#p-recharge-submit');
    const totalEl = root.querySelector('#p-recharge-total');
    const formError = root.querySelector('#p-recharge-error');

    function setError(name, message) {
      const el = root.querySelector(`[data-error="${name}"]`);
      if (el) el.textContent = message || '';
    }

    function clearErrors() {
      root.querySelectorAll('.error-text').forEach((el) => {
        el.textContent = '';
      });
    }

    function updateTotal() {
      totalEl.textContent = ctx.ui.money(state.amountCents || 0);
    }

    function markQuick(cents) {
      quickButtons.forEach((button) => {
        button.classList.toggle('selected', Number(button.getAttribute('data-amount')) === cents);
      });
    }

    function setBusy(busy) {
      state.busy = busy;
      submit.disabled = busy || providers.length === 0;
      submit.classList.toggle('btn-loading', busy);
      submit.textContent = busy ? '正在创建订单…' : '立即充值';
      customInput.disabled = busy;
      quickButtons.forEach((button) => {
        button.disabled = busy;
      });
      providerButtons.forEach((button) => {
        button.disabled = busy;
      });
    }

    function validate() {
      const errors = {};
      if (!state.amountCents || state.amountCents <= 0) {
        errors.amount = '请输入有效的充值金额';
      } else if (state.amountCents < minCents) {
        errors.amount = `单次充值不能低于 ${ctx.ui.money(minCents)}`;
      } else if (state.amountCents > maxCents) {
        errors.amount = `单次充值不能高于 ${ctx.ui.money(maxCents)}`;
      }
      if (!state.provider) errors.provider = '请选择支付方式';
      return errors;
    }

    function showManual(order, payment) {
      const notice = root.querySelector('#p-recharge-notice');
      if (!notice) return;
      const instructions = payment.instructions
        || (ctx.config && ctx.config.manualInstructions)
        || '请按管理员提供的说明完成转账。';
      notice.innerHTML = `
        <div class="alert alert-info">
          <div class="stack-sm">
            <strong>订单 ${ctx.ui.escape(order.orderNo)} 待支付 ${ctx.ui.money(order.amountCents)}</strong>
            <div class="text-sm">${ctx.ui.escape(instructions)}</div>
            <a class="btn btn-secondary" href="#/orders?orderNo=${encodeURIComponent(order.orderNo)}">查看订单</a>
          </div>
        </div>`;
      ctx.toast('订单已创建，请按转账说明完成支付', 'info');
      if (notice.scrollIntoView) notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function handlePayment(result) {
      const order = result && result.order ? result.order : null;
      const payment = result && result.payment ? result.payment : null;
      if (!order || !payment) {
        ctx.toast('充值成功，请到订单页查看', 'success');
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
        showManual(order, payment);
        return;
      }
      if (payment.type === 'balance') {
        ctx.toast('充值成功，余额已到账', 'success');
        try {
          await ctx.refreshMe();
        } catch {
          /* 仪表盘会再次拉取最新余额 */
        }
        ctx.navigate('/dashboard');
        return;
      }
      ctx.toast('充值成功，请到订单页查看', 'success');
      ctx.navigate(`/orders?orderNo=${encodeURIComponent(order.orderNo)}`);
    }

    function handleError(err) {
      if (err && err.code === 'unauthorized') {
        ctx.navigate('/login');
        return;
      }
      if (err && err.code === 'provider_unavailable') {
        setError('provider', '该支付方式暂不可用，请更换后再试');
        return;
      }
      if (err && err.code === 'validation_error' && err.message) {
        if (err.message.includes('支付')) setError('provider', err.message);
        else setError('amount', err.message);
        return;
      }
      const message = (err && err.message) || '充值失败，请稍后重试';
      formError.textContent = message;
      ctx.toast(message, 'error');
    }

    async function onSubmit() {
      if (state.busy) return;
      clearErrors();
      const errors = validate();
      const names = Object.keys(errors);
      if (names.length > 0) {
        names.forEach((name) => setError(name, errors[name]));
        return;
      }
      setBusy(true);
      try {
        const result = await ctx.api.recharge({ amountCents: state.amountCents, provider: state.provider });
        setBusy(false);
        await handlePayment(result);
      } catch (err) {
        setBusy(false);
        handleError(err);
      }
    }

    quickButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (state.busy) return;
        customInput.value = '';
        const cents = Number(button.getAttribute('data-amount'));
        state.amountCents = Number.isFinite(cents) ? cents : 0;
        markQuick(state.amountCents);
        updateTotal();
        setError('amount', '');
      });
    });

    customInput.addEventListener('input', () => {
      if (state.busy) return;
      const raw = customInput.value.trim();
      const yuan = Number(raw);
      state.amountCents = raw && Number.isFinite(yuan) && yuan > 0 ? Math.round(yuan * 100) : 0;
      markQuick(null);
      updateTotal();
      setError('amount', '');
    });

    providerButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (state.busy) return;
        state.provider = button.getAttribute('data-provider') || '';
        providerButtons.forEach((item) => item.classList.toggle('selected', item === button));
        setError('provider', '');
      });
    });

    submit.addEventListener('click', onSubmit);
  }
}
