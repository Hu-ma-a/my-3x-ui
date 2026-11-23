export const meta = { title: '订单管理', auth: true, admin: true };

const STATUSES = ['pending', 'paid', 'provisioning', 'provisioned', 'credited', 'sync_pending', 'failed', 'cancelled'];

const PROVIDER_LABELS = {
  balance: '余额支付',
  mock: '模拟支付',
  manual: '人工转账',
  epay: '易支付',
};

const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

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
  const money = (v) => ui.money(Number(v) || 0);
  const kindText = (k) => ui.kindText(k);
  const statusText = (s) => ui.statusText(s);
  const providerText = (p) => PROVIDER_LABELS[p] || p || '—';
  const options = (list, selected, render) => list.map((v) =>
    `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(render(v))}</option>`).join('');

  const query = ctx.query || {};
  const state = {
    kind: query.kind === 'plan' || query.kind === 'recharge' ? query.kind : '',
    status: STATUSES.includes(query.status) ? query.status : '',
    query: typeof query.query === 'string' ? query.query : '',
    page: 1,
    pageSize: 20,
  };
  let items = [];

  const wrap = document.createElement('div');
  wrap.innerHTML = `<header class="page-head">
      <h1 class="page-title">订单管理</h1>
      <p class="page-desc">查看全部订单，处理待支付、标记收款与重试 3x-ui 开通</p>
    </header>
    <form class="a-toolbar" data-role="filter" novalidate>
      <select class="select" name="kind" aria-label="按订单类型筛选">
        <option value="">全部类型</option>
        ${options(['plan', 'recharge'], state.kind, kindText)}
      </select>
      <select class="select" name="status" aria-label="按订单状态筛选">
        <option value="">全部状态</option>
        ${options(STATUSES, state.status, statusText)}
      </select>
      <input class="input" type="search" name="query" placeholder="搜索订单号或用户名" aria-label="搜索订单号或用户名" value="${esc(state.query)}" autocomplete="off">
      <button class="btn btn-secondary" type="submit">搜索</button>
      <button class="btn btn-ghost" type="button" data-act="reset-filter">重置</button>
    </form>
    <div id="a-orders-meta" class="a-list-meta"></div>
    <div id="a-orders-table"><div class="loading-block">${ui.spinner()}<span>正在加载订单…</span></div></div>
    <div id="a-orders-pager"></div>`;
  root.replaceChildren(wrap);

  const tableBox = wrap.querySelector('#a-orders-table');
  const metaBox = wrap.querySelector('#a-orders-meta');
  const pagerBox = wrap.querySelector('#a-orders-pager');

  function setBusy(btn, text) {
    if (!btn) return;
    if (text) {
      btn.dataset.label = btn.textContent;
      btn.textContent = text;
      btn.disabled = true;
    } else {
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
      btn.disabled = false;
    }
  }

  function errorHtml(err) {
    const msg = err && err.message ? err.message : '加载失败，请稍后重试';
    return `<div class="alert alert-danger">
      <div class="stack-sm">
        <div>${esc(msg)}</div>
        <div><button type="button" class="btn btn-secondary btn-sm" data-act="reload">重试</button></div>
      </div>
    </div>`;
  }

  function findOrder(id) {
    return items.find((order) => String(order.id) === String(id)) || null;
  }

  function actionsHtml(order) {
    const buttons = [`<button type="button" class="link-btn" data-act="detail" data-id="${esc(order.id)}">详情</button>`];
    if (order.status === 'pending') {
      buttons.push(`<button type="button" class="link-btn" data-act="mark-paid" data-id="${esc(order.id)}">标记已支付</button>`);
      buttons.push(`<button type="button" class="link-btn danger" data-act="cancel" data-id="${esc(order.id)}">取消</button>`);
    }
    if (order.status === 'sync_pending' || order.status === 'paid') {
      buttons.push(`<button type="button" class="link-btn" data-act="retry" data-id="${esc(order.id)}">重试开通</button>`);
    }
    return buttons.join('');
  }

  function orderRow(order) {
    const sub = `${kindText(order.kind)} · ${providerText(order.provider)} · ${ui.dateTime(order.createdAt)}`;
    return `<tr>
      <td>
        <div class="a-cell-title mono">${esc(order.orderNo)}</div>
        <div class="a-cell-sub">${esc(sub)}</div>
      </td>
      <td>
        <div class="a-cell-title">${esc(order.username || `#${order.userId}`)}</div>
        ${order.planName ? `<div class="a-cell-sub">${esc(order.planName)}</div>` : ''}
      </td>
      <td class="num">${esc(money(order.amountCents))}</td>
      <td>${ui.badge(order.status)}</td>
      <td><div class="actions">${actionsHtml(order)}</div></td>
    </tr>`;
  }

  function renderPager(total) {
    pagerBox.innerHTML = total
      ? ui.pagination({ page: state.page, total, pageSize: state.pageSize })
      : '';
  }

  async function load() {
    tableBox.innerHTML = `<div class="loading-block">${ui.spinner()}<span>正在加载订单…</span></div>`;
    metaBox.textContent = '';
    pagerBox.innerHTML = '';
    try {
      const params = { page: state.page, pageSize: state.pageSize };
      if (state.kind) params.kind = state.kind;
      if (state.status) params.status = state.status;
      if (state.query) params.query = state.query;
      const data = (await ctx.api.admin.orders(params)) || {};
      items = Array.isArray(data.items) ? data.items : [];
      const total = Number(data.total) || 0;
      const pages = Math.max(1, Math.ceil(total / state.pageSize));
      if (state.page > pages) {
        state.page = pages;
        return load();
      }
      metaBox.textContent = `共 ${total.toLocaleString('zh-CN')} 条订单${state.query || state.status || state.kind ? '（已筛选）' : ''}`;
      if (!items.length) {
        tableBox.innerHTML = ui.empty({
          title: '没有找到订单',
          desc: state.query || state.status || state.kind ? '换个筛选条件后再试。' : '还没有用户下单。',
          actionHtml: state.query || state.status || state.kind
            ? '<button type="button" class="btn btn-secondary btn-sm" data-act="reset-filter">清除筛选</button>'
            : '<button type="button" class="btn btn-secondary btn-sm" data-act="reload">刷新列表</button>',
        });
        renderPager(total);
        return;
      }
      tableBox.innerHTML = `<div class="table-wrap">
        <table class="table">
          <thead><tr><th>订单</th><th>用户</th><th>金额</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>${items.map(orderRow).join('')}</tbody>
        </table>
      </div>`;
      renderPager(total);
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      items = [];
      metaBox.textContent = '';
      tableBox.innerHTML = errorHtml(err);
    }
  }

  function openDetail(order) {
    const layer = document.createElement('div');
    layer.className = 'modal-backdrop';
    const kv = (label, value, mono) => `<dt>${label}</dt><dd class="${mono ? 'mono' : ''}">${value}</dd>`;
    const rows = [
      kv('订单号', esc(order.orderNo), true),
      kv('类型', esc(kindText(order.kind))),
      kv('用户', esc(order.username || `#${order.userId}`)),
      kv('套餐', esc(order.planName || '—')),
      kv('金额', esc(money(order.amountCents))),
      kv('状态', ui.badge(order.status)),
      kv('支付方式', esc(providerText(order.provider))),
      kv('创建时间', esc(ui.dateTime(order.createdAt))),
    ];
    if (order.providerTradeNo) rows.push(kv('支付流水号', esc(order.providerTradeNo), true));
    if (order.paidAt) rows.push(kv('支付时间', esc(ui.dateTime(order.paidAt))));
    if (order.provisionedAt) rows.push(kv('开通时间', esc(ui.dateTime(order.provisionedAt))));
    if (order.updatedAt) rows.push(kv('更新时间', esc(ui.dateTime(order.updatedAt))));
    layer.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="订单详情">
      <div class="modal-head row-between">
        <span>订单详情</span>
        <button type="button" class="btn btn-icon" data-modal-act="close" aria-label="关闭">${CLOSE_ICON}</button>
      </div>
      <div class="modal-body stack">
        <dl class="kv">${rows.join('')}</dl>
        ${order.status === 'sync_pending'
          ? '<p class="text-sm text-muted">订单已支付但 3x-ui 开通失败：后台每 30 秒自动重试，也可点击「重试开通」立即处理。</p>'
          : ''}
        ${order.provisionError
          ? `<div class="alert alert-danger"><div class="text-sm"><strong>开通错误：</strong>${esc(order.provisionError)}</div></div>`
          : ''}
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-secondary" data-modal-act="close">关闭</button>
      </div>
    </div>`;
    wrap.appendChild(layer);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      layer.remove();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    if (typeof ctx.onCleanup === 'function') ctx.onCleanup(close);
    layer.addEventListener('click', (e) => {
      if (e.target === layer || e.target.closest('[data-modal-act="close"]')) close();
    });
  }

  async function markPaid(btn) {
    const order = findOrder(btn.getAttribute('data-id'));
    if (!order) return;
    const ok = await ctx.ui.confirm({
      title: '标记已支付',
      content: `确认订单 ${order.orderNo}（${money(order.amountCents)}）已收到款项？确认后将立即为用户入账或开通套餐。`,
      okText: '确认收款',
    });
    if (!ok) return;
    setBusy(btn, '处理中…');
    try {
      const updated = (await ctx.api.admin.markPaid(order.id)) || {};
      if (updated.status === 'sync_pending') {
        ctx.toast(`已收款，但 3x-ui 开通失败：${updated.provisionError || '已转入自动重试'}`, 'error');
      } else {
        ctx.toast('已标记支付并完成入账/开通', 'success');
      }
      await load();
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      ctx.toast(err && err.message ? err.message : '操作失败', 'error');
      setBusy(btn, null);
    }
  }

  async function retryProvision(btn) {
    const order = findOrder(btn.getAttribute('data-id'));
    if (!order) return;
    setBusy(btn, '重试中…');
    try {
      const updated = (await ctx.api.admin.retryProvision(order.id)) || {};
      if (updated.status === 'sync_pending') {
        ctx.toast(`重试仍未成功：${updated.provisionError || '3x-ui 暂不可用'}`, 'error');
      } else {
        ctx.toast('已重新发起开通并成功', 'success');
      }
      await load();
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      ctx.toast(err && err.message ? err.message : '重试失败', 'error');
      setBusy(btn, null);
    }
  }

  async function cancelOrder(btn) {
    const order = findOrder(btn.getAttribute('data-id'));
    if (!order) return;
    const ok = await ctx.ui.confirm({
      title: '取消订单',
      content: `确定取消订单 ${order.orderNo} 吗？取消后订单关闭且不可恢复。`,
      okText: '取消订单',
      danger: true,
    });
    if (!ok) return;
    setBusy(btn, '处理中…');
    try {
      await ctx.api.admin.cancelOrder(order.id);
      ctx.toast('订单已取消', 'success');
      await load();
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      ctx.toast(err && err.message ? err.message : '操作失败', 'error');
      setBusy(btn, null);
    }
  }

  function resetFilter() {
    state.kind = '';
    state.status = '';
    state.query = '';
    state.page = 1;
    const form = wrap.querySelector('form[data-role="filter"]');
    if (form) {
      form.querySelector('[name="kind"]').value = '';
      form.querySelector('[name="status"]').value = '';
      form.querySelector('[name="query"]').value = '';
    }
    load();
  }

  wrap.addEventListener('click', (e) => {
    const pageBtn = e.target.closest('[data-page]');
    if (pageBtn && !pageBtn.disabled) {
      const next = Number(pageBtn.getAttribute('data-page'));
      if (Number.isFinite(next) && next > 0 && next !== state.page) {
        state.page = next;
        load();
      }
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'reset-filter') resetFilter();
    else if (act === 'reload') load();
    else if (act === 'detail') {
      const order = findOrder(btn.getAttribute('data-id'));
      if (order) openDetail(order);
    } else if (act === 'mark-paid') markPaid(btn);
    else if (act === 'retry') retryProvision(btn);
    else if (act === 'cancel') cancelOrder(btn);
  });

  wrap.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-role="filter"]');
    if (!form) return;
    e.preventDefault();
    const data = new FormData(form);
    state.kind = String(data.get('kind') || '');
    state.status = String(data.get('status') || '');
    state.query = String(data.get('query') || '').trim();
    state.page = 1;
    load();
  });

  wrap.addEventListener('change', (e) => {
    const sel = e.target.closest('select[name="kind"], select[name="status"]');
    if (!sel) return;
    const form = sel.closest('form[data-role="filter"]');
    if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
  });

  load();
}
