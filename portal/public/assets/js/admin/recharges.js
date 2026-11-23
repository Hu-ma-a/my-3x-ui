export const meta = { title: '充值记录', auth: true, admin: true };

const STATUSES = ['pending', 'paid', 'credited', 'failed', 'cancelled'];

const PROVIDER_LABELS = {
  balance: '余额支付',
  mock: '模拟支付',
  manual: '人工转账',
  epay: '易支付',
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
  const money = (v) => ui.money(Number(v) || 0);
  const statusText = (s) => ui.statusText(s);
  const providerText = (p) => PROVIDER_LABELS[p] || p || '—';
  const options = (list, selected) => list.map((v) =>
    `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(statusText(v))}</option>`).join('');

  const state = { status: '', query: '', page: 1, pageSize: 20 };
  let items = [];

  const wrap = document.createElement('div');
  wrap.innerHTML = `<header class="page-head">
      <h1 class="page-title">充值记录</h1>
      <p class="page-desc">用户全部充值订单与到账情况</p>
    </header>
    <div id="a-recharge-summary" class="a-subtotal"></div>
    <form class="a-toolbar" data-role="filter" novalidate>
      <select class="select" name="status" aria-label="按状态筛选">
        <option value="">全部状态</option>
        ${options(STATUSES, state.status)}
      </select>
      <input class="input" type="search" name="query" placeholder="搜索订单号或用户名" aria-label="搜索订单号或用户名" autocomplete="off">
      <button class="btn btn-secondary" type="submit">搜索</button>
      <button class="btn btn-ghost" type="button" data-act="reset-filter">重置</button>
    </form>
    <div id="a-recharges-meta" class="a-list-meta"></div>
    <div id="a-recharges-table"><div class="loading-block">${ui.spinner()}<span>正在加载充值记录…</span></div></div>
    <div id="a-recharges-pager"></div>`;
  root.replaceChildren(wrap);

  const summaryBox = wrap.querySelector('#a-recharge-summary');
  const tableBox = wrap.querySelector('#a-recharges-table');
  const metaBox = wrap.querySelector('#a-recharges-meta');
  const pagerBox = wrap.querySelector('#a-recharges-pager');

  function errorHtml(err) {
    const msg = err && err.message ? err.message : '加载失败，请稍后重试';
    return `<div class="alert alert-danger">
      <div class="stack-sm">
        <div>${esc(msg)}</div>
        <div><button type="button" class="btn btn-secondary btn-sm" data-act="reload">重试</button></div>
      </div>
    </div>`;
  }

  function rechargeRow(order) {
    const sub = `${providerText(order.provider)} · ${ui.dateTime(order.createdAt)}`;
    return `<tr>
      <td>
        <div class="a-cell-title mono">${esc(order.orderNo)}</div>
        <div class="a-cell-sub">${esc(sub)}</div>
      </td>
      <td>${esc(order.username || `#${order.userId}`)}</td>
      <td class="num">${esc(money(order.amountCents))}</td>
      <td>${ui.badge(order.status)}</td>
      <td class="text-muted">${order.paidAt ? esc(ui.dateTime(order.paidAt)) : '—'}</td>
    </tr>`;
  }

  function renderPager(total) {
    pagerBox.innerHTML = total
      ? ui.pagination({ page: state.page, total, pageSize: state.pageSize })
      : '';
  }

  function renderSummary() {
    const pageTotal = items.reduce((sum, order) => sum + (Number(order.amountCents) || 0), 0);
    const credited = items.filter((order) => order.status === 'credited')
      .reduce((sum, order) => sum + (Number(order.amountCents) || 0), 0);
    if (!items.length) {
      summaryBox.innerHTML = '';
      return;
    }
    summaryBox.innerHTML = `<span>本页合计 <b class="a-strong">${esc(money(pageTotal))}</b></span>
      <span>本页已到账 <b class="a-strong a-strong-success">${esc(money(credited))}</b></span>
      <span class="text-sm">统计范围仅当前页</span>`;
  }

  async function load() {
    tableBox.innerHTML = `<div class="loading-block">${ui.spinner()}<span>正在加载充值记录…</span></div>`;
    metaBox.textContent = '';
    pagerBox.innerHTML = '';
    summaryBox.innerHTML = '';
    try {
      const params = { page: state.page, pageSize: state.pageSize };
      if (state.status) params.status = state.status;
      if (state.query) params.query = state.query;
      const data = (await ctx.api.admin.recharges(params)) || {};
      items = Array.isArray(data.items) ? data.items : [];
      const total = Number(data.total) || 0;
      const pages = Math.max(1, Math.ceil(total / state.pageSize));
      if (state.page > pages) {
        state.page = pages;
        return load();
      }
      metaBox.textContent = `共 ${total.toLocaleString('zh-CN')} 条充值记录${state.query || state.status ? '（已筛选）' : ''}`;
      renderSummary();
      if (!items.length) {
        tableBox.innerHTML = ui.empty({
          title: '没有充值记录',
          desc: state.query || state.status ? '换个筛选条件后再试。' : '用户在线充值后，记录会显示在这里。',
          actionHtml: state.query || state.status
            ? '<button type="button" class="btn btn-secondary btn-sm" data-act="reset-filter">清除筛选</button>'
            : '<button type="button" class="btn btn-secondary btn-sm" data-act="reload">刷新列表</button>',
        });
        renderPager(total);
        return;
      }
      tableBox.innerHTML = `<div class="table-wrap">
        <table class="table">
          <thead><tr><th>订单</th><th>用户</th><th>金额</th><th>状态</th><th>到账时间</th></tr></thead>
          <tbody>${items.map(rechargeRow).join('')}</tbody>
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

  function resetFilter() {
    state.status = '';
    state.query = '';
    state.page = 1;
    const form = wrap.querySelector('form[data-role="filter"]');
    if (form) {
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
  });

  wrap.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-role="filter"]');
    if (!form) return;
    e.preventDefault();
    const data = new FormData(form);
    state.status = String(data.get('status') || '');
    state.query = String(data.get('query') || '').trim();
    state.page = 1;
    load();
  });

  wrap.addEventListener('change', (e) => {
    const sel = e.target.closest('select[name="status"]');
    if (!sel) return;
    const form = sel.closest('form[data-role="filter"]');
    if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
  });

  load();
}
