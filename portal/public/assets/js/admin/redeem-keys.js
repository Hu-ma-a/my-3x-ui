export const meta = { title: '充值码', auth: true, admin: true };

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

const ICON_TICKET =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 9.5V6.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v3a2.5 2.5 0 0 0 0 5v3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-3a2.5 2.5 0 0 0 0-5z"/><path d="M9 8.5v7"/><path d="M12.5 9.5h5"/><path d="M12.5 13.5h3"/></svg>';

const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export async function render(root, ctx) {
  const ui = ctx.ui;
  const esc = (v) => ui.escape(v == null ? '' : String(v));
  const money = (v) => ui.money(Number(v) || 0);
  const dateTime = (ms) => (ms ? ui.dateTime(ms) : '—');
  const STATUS = {
    unused: ['未使用', 'badge-success'],
    used: ['已使用', 'badge-muted'],
    revoked: ['已撤销', 'badge-danger'],
  };

  const state = { status: '', query: '', page: 1, pageSize: 20 };
  let items = [];

  const wrap = document.createElement('div');
  wrap.innerHTML = `<header class="page-head row-between">
      <div>
        <h1 class="page-title">充值码</h1>
        <p class="page-desc">生成一次性充值码供用户兑换余额；可撤销未使用的充值码。</p>
      </div>
      <div class="row">
        <button type="button" class="btn btn-secondary" data-act="refresh">刷新列表</button>
        <button type="button" class="btn btn-primary" data-act="generate">生成充值码</button>
      </div>
    </header>
    <section class="card">
      <div class="card-head">
        <div>
          <h2 class="card-title"><span class="a-title-icon">${ICON_TICKET}</span>充值码列表</h2>
          <p class="card-desc" id="a-redeem-meta"></p>
        </div>
      </div>
      <div class="card-body">
        <form class="a-toolbar" data-role="filter" novalidate>
          <input class="input" type="search" name="query" placeholder="搜索充值码 / 批次 / 备注" aria-label="搜索" autocomplete="off">
          <select class="select" name="status" aria-label="按状态筛选">
            <option value="">全部状态</option>
            <option value="unused">未使用</option>
            <option value="used">已使用</option>
            <option value="revoked">已撤销</option>
          </select>
          <button class="btn btn-secondary" type="submit">搜索</button>
          <button class="btn btn-ghost" type="button" data-act="reset-filter">重置</button>
        </form>
        <div id="a-redeem-table"><div class="loading-block">${ui.spinner()}<span>正在加载充值码…</span></div></div>
        <div id="a-redeem-pager"></div>
      </div>
    </section>`;
  root.replaceChildren(wrap);

  const tableBox = wrap.querySelector('#a-redeem-table');
  const metaBox = wrap.querySelector('#a-redeem-meta');
  const pagerBox = wrap.querySelector('#a-redeem-pager');

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
    return `<div class="alert alert-danger"><div class="stack-sm"><div>${esc(msg)}</div>
      <div><button type="button" class="btn btn-secondary btn-sm" data-act="reload">重试</button></div></div></div>`;
  }

  function statusBadge(status) {
    const [label, cls] = STATUS[status] || [status, 'badge-muted'];
    return `<span class="badge ${cls}">${esc(label)}</span>`;
  }

  function rowHtml(item) {
    const actions = item.status === 'unused'
      ? `<button type="button" class="link-btn danger" data-act="revoke" data-id="${esc(item.id)}">撤销</button>`
      : '—';
    return `<tr>
      <td class="mono">${esc(item.batch || '—')}</td>
      <td class="mono">${esc(item.maskedCode)}</td>
      <td class="num">${esc(money(item.amountCents))}</td>
      <td>${statusBadge(item.status)}</td>
      <td>${esc(dateTime(item.createdAt))}</td>
      <td>${item.expiresAt ? esc(dateTime(item.expiresAt)) : '永久有效'}</td>
      <td>${item.usedByName ? `${esc(item.usedByName)}<div class="a-cell-sub">${esc(dateTime(item.usedAt))}</div>` : '—'}</td>
      <td><div class="actions">${actions}</div></td>
    </tr>`;
  }

  async function load() {
    tableBox.innerHTML = `<div class="loading-block">${ui.spinner()}<span>正在加载充值码…</span></div>`;
    metaBox.textContent = '';
    pagerBox.innerHTML = '';
    try {
      const params = { page: state.page, pageSize: state.pageSize };
      if (state.status) params.status = state.status;
      if (state.query) params.query = state.query;
      const data = (await ctx.api.admin.redeemKeys(params)) || {};
      items = Array.isArray(data.items) ? data.items : [];
      const total = Number(data.total) || 0;
      const pages = Math.max(1, Math.ceil(total / state.pageSize));
      if (state.page > pages) {
        state.page = pages;
        return load();
      }
      metaBox.textContent = `共 ${total.toLocaleString('zh-CN')} 个充值码${state.status || state.query ? '（已筛选）' : ''}`;
      if (!items.length) {
        tableBox.innerHTML = ui.empty({
          title: '没有充值码',
          desc: state.status || state.query ? '换个筛选条件试试。' : '点击右上角「生成充值码」创建。',
          actionHtml: '<button type="button" class="btn btn-primary btn-sm" data-act="generate">生成充值码</button>',
        });
        return;
      }
      tableBox.innerHTML = `<div class="table-wrap"><table class="table">
        <thead><tr><th>批次</th><th>充值码</th><th>金额</th><th>状态</th><th>创建时间</th><th>有效期</th><th>使用人</th><th>操作</th></tr></thead>
        <tbody>${items.map(rowHtml).join('')}</tbody>
      </table></div>`;
      pagerBox.innerHTML = total ? ui.pagination({ page: state.page, total, pageSize: state.pageSize }) : '';
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      items = [];
      tableBox.innerHTML = errorHtml(err);
    }
  }

  function showModal(opts) {
    const layer = document.createElement('div');
    layer.className = 'modal-backdrop';
    layer.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(opts.title)}">
      <form novalidate>
        <div class="modal-head row-between">
          <span>${esc(opts.title)}</span>
          <button type="button" class="btn btn-icon" data-modal-act="close" aria-label="关闭">${CLOSE_ICON}</button>
        </div>
        <div class="modal-body stack">
          ${opts.bodyHtml}
          <p class="error-text hidden" data-role="error"></p>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-modal-act="close">取消</button>
          <button type="submit" class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}">${esc(opts.okText || '确定')}</button>
        </div>
      </form>
    </div>`;
    wrap.appendChild(layer);
    const form = layer.querySelector('form');
    const errorBox = layer.querySelector('[data-role="error"]');
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
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (closed) return;
      const submitBtn = form.querySelector('button[type="submit"]');
      errorBox.classList.add('hidden');
      submitBtn.disabled = true;
      const label = submitBtn.textContent;
      submitBtn.textContent = '处理中…';
      try {
        await opts.onSubmit(form);
        close();
      } catch (err) {
        if (handleAuthError(ctx, err)) {
          close();
          return;
        }
        errorBox.textContent = err && err.message ? err.message : '操作失败，请稍后重试';
        errorBox.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.textContent = label;
      }
    });
    const first = form.querySelector('input, textarea, select');
    if (first) first.focus();
    return { close };
  }

  function openGenerate() {
    showModal({
      title: '生成充值码',
      okText: '生成',
      bodyHtml: `<div class="grid grid-2 a-modal-grid">
          <div class="field">
            <label class="field-label" for="a-redeem-amount">单个金额（${esc(ui.currencyName())}）</label>
            <div class="input-wrap">
              <span class="input-prefix">${esc(ui.currencySymbol())}</span>
              <input id="a-redeem-amount" class="input" name="amount" type="number" step="0.01" min="0.01" placeholder="如：10">
            </div>
          </div>
          <div class="field">
            <label class="field-label" for="a-redeem-count">生成数量</label>
            <input id="a-redeem-count" class="input" name="count" type="number" step="1" min="1" max="100" value="10">
          </div>
          <div class="field">
            <label class="field-label" for="a-redeem-days">有效期（天，0 = 永久）</label>
            <input id="a-redeem-days" class="input" name="days" type="number" step="1" min="0" max="3650" value="0">
          </div>
          <div class="field">
            <label class="field-label" for="a-redeem-note">备注 <span class="optional">（可选）</span></label>
            <input id="a-redeem-note" class="input" name="note" maxlength="120" placeholder="如：双十一活动">
          </div>
        </div>
        <p class="text-sm text-muted">充值码只在生成时完整显示一次，请及时复制保存；用户兑换后余额立即到账。</p>`,
      onSubmit: async (form) => {
        const amountYuan = Number(form.querySelector('[name="amount"]').value);
        const count = Number(form.querySelector('[name="count"]').value);
        const days = Number(form.querySelector('[name="days"]').value || 0);
        if (!Number.isFinite(amountYuan) || amountYuan <= 0) throw new Error('请输入有效的单个金额');
        if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('生成数量需为 1–100');
        if (!Number.isInteger(days) || days < 0 || days > 3650) throw new Error('有效期需为 0–3650 天');
        const note = form.querySelector('[name="note"]').value.trim();
        const result = await ctx.api.admin.createRedeemKeys({
          amountCents: Math.round(amountYuan * 100),
          count,
          days,
          note,
        });
        await load();
        showGeneratedCodes(result);
      },
    });
  }

  function showGeneratedCodes(result) {
    const items = Array.isArray(result.items) ? result.items : [];
    const text = items.map((item) => item.code).join('\n');
    const layer = document.createElement('div');
    layer.className = 'modal-backdrop';
    layer.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="充值码已生成">
      <div class="modal-head row-between">
        <span>充值码已生成（${items.length} 个）</span>
        <button type="button" class="btn btn-icon" data-modal-act="close" aria-label="关闭">${CLOSE_ICON}</button>
      </div>
      <div class="modal-body stack">
        <p class="hint">批次 ${esc(result.batch || '')} · 单个 ${esc(money(result.items?.[0]?.amountCents || 0))} · 只在本次显示，请立即复制保存。</p>
        <textarea class="textarea mono" rows="10" readonly>${esc(text)}</textarea>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-secondary" data-modal-act="copy">复制全部</button>
        <button type="button" class="btn btn-primary" data-modal-act="close">完成</button>
      </div>
    </div>`;
    wrap.appendChild(layer);
    layer.addEventListener('click', async (e) => {
      if (e.target === layer || e.target.closest('[data-modal-act="close"]')) {
        layer.remove();
        return;
      }
      if (e.target.closest('[data-modal-act="copy"]')) {
        const ok = await ui.copy(text);
        ctx.toast(ok ? '已复制全部充值码' : '复制失败，请手动选择复制', ok ? 'success' : 'error');
      }
    });
  }

  async function revoke(btn) {
    const id = btn.getAttribute('data-id');
    const ok = await ctx.ui.confirm({
      title: '撤销充值码',
      content: '确定撤销这个未使用的充值码吗？撤销后用户无法再兑换。',
      okText: '撤销',
      danger: true,
    });
    if (!ok) return;
    setBusy(btn, '撤销中…');
    try {
      await ctx.api.admin.revokeRedeemKey(id);
      ctx.toast('充值码已撤销', 'success');
      await load();
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      ctx.toast(err && err.message ? err.message : '撤销失败', 'error');
      setBusy(btn, null);
    }
  }

  function resetFilter() {
    state.status = '';
    state.query = '';
    state.page = 1;
    const form = wrap.querySelector('form[data-role="filter"]');
    if (form) {
      form.querySelector('[name="query"]').value = '';
      form.querySelector('[name="status"]').value = '';
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
    if (act === 'refresh' || act === 'reload') load();
    else if (act === 'reset-filter') resetFilter();
    else if (act === 'generate') openGenerate();
    else if (act === 'revoke') revoke(btn);
  });

  wrap.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-role="filter"]');
    if (!form) return;
    e.preventDefault();
    const data = new FormData(form);
    state.query = String(data.get('query') || '').trim();
    state.status = String(data.get('status') || '');
    state.page = 1;
    load();
  });

  wrap.addEventListener('change', (e) => {
    const select = e.target.closest('select[name="status"]');
    if (!select) return;
    const form = select.closest('form[data-role="filter"]');
    if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
  });

  load();
}
