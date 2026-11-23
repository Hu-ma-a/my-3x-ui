export const meta = { title: '用户管理', auth: true, admin: true };

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

const ICON_USER =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></svg>';

const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export async function render(root, ctx) {
  const ui = ctx.ui;
  const esc = (v) => ui.escape(v == null ? '' : String(v));
  const money = (v) => ui.money(Number(v) || 0);
  const dateTime = (ms) => (ms ? ui.dateTime(ms) : '—');

  const state = { query: '', status: '', page: 1, pageSize: 20 };
  let items = [];

  const wrap = document.createElement('div');
  wrap.innerHTML = `<header class="page-head row-between">
      <div>
        <h1 class="page-title">用户管理</h1>
        <p class="page-desc">搜索用户、启用或禁用账号、调整余额与重置密码</p>
      </div>
      <button type="button" class="btn btn-secondary" data-act="refresh">刷新列表</button>
    </header>
    <section class="card">
      <div class="card-head">
        <div>
          <h2 class="card-title"><span class="a-title-icon">${ICON_USER}</span>用户列表</h2>
          <p class="card-desc" id="a-users-meta"></p>
        </div>
      </div>
      <div class="card-body">
        <form class="a-toolbar" data-role="filter" novalidate>
          <input class="input" type="search" name="query" placeholder="搜索用户名或邮箱" aria-label="搜索用户名或邮箱" autocomplete="off">
          <select class="select" name="status" aria-label="按状态筛选">
            <option value="">全部状态</option>
            <option value="active">正常</option>
            <option value="disabled">已禁用</option>
          </select>
          <button class="btn btn-secondary" type="submit">搜索</button>
          <button class="btn btn-ghost" type="button" data-act="reset-filter">重置</button>
        </form>
        <div id="a-users-table"><div class="loading-block">${ui.spinner()}<span>正在加载用户…</span></div></div>
        <div id="a-users-pager"></div>
      </div>
    </section>`;
  root.replaceChildren(wrap);

  const tableBox = wrap.querySelector('#a-users-table');
  const metaBox = wrap.querySelector('#a-users-meta');
  const pagerBox = wrap.querySelector('#a-users-pager');

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

  function renderPager(total) {
    pagerBox.innerHTML = total
      ? ui.pagination({ page: state.page, total, pageSize: state.pageSize })
      : '';
  }

  function userRow(user) {
    const active = user.status === 'active';
    const expired = user.planExpiresAt && Number(user.planExpiresAt) < Date.now();
    const account = user.email || user.clientEmail || '';
    return `<tr>
      <td class="mono">${esc(user.id)}</td>
      <td>
        <div class="a-cell-title">${esc(user.username)}</div>
        ${account ? `<div class="a-cell-sub">${esc(account)}</div>` : ''}
      </td>
      <td class="num">${esc(money(user.balanceCents))}</td>
      <td>${esc(user.planName || '—')}</td>
      <td class="${expired ? 'text-danger' : ''}">
        ${user.planExpiresAt ? `${esc(dateTime(user.planExpiresAt))}<div class="a-cell-sub">${esc(ui.relative(user.planExpiresAt))}</div>` : '—'}
      </td>
      <td>${ui.badge(user.status)}</td>
      <td>
        <div class="actions">
          <button type="button" class="link-btn${active ? ' danger' : ''}"
            data-act="toggle-status" data-id="${esc(user.id)}" data-status="${esc(user.status)}" data-username="${esc(user.username)}">${active ? '禁用' : '启用'}</button>
          <button type="button" class="link-btn" data-act="adjust-balance" data-id="${esc(user.id)}">调整余额</button>
          <button type="button" class="link-btn" data-act="reset-password" data-id="${esc(user.id)}" data-username="${esc(user.username)}">重置密码</button>
        </div>
      </td>
    </tr>`;
  }

  function findUser(btn) {
    const id = btn.getAttribute('data-id');
    return items.find((user) => String(user.id) === String(id)) || null;
  }

  async function load() {
    tableBox.innerHTML = `<div class="loading-block">${ui.spinner()}<span>正在加载用户…</span></div>`;
    metaBox.textContent = '';
    pagerBox.innerHTML = '';
    try {
      const params = { page: state.page, pageSize: state.pageSize };
      if (state.query) params.query = state.query;
      if (state.status) params.status = state.status;
      const data = (await ctx.api.admin.users(params)) || {};
      items = Array.isArray(data.items) ? data.items : [];
      const total = Number(data.total) || 0;
      const pages = Math.max(1, Math.ceil(total / state.pageSize));
      if (state.page > pages) {
        state.page = pages;
        return load();
      }
      const filtered = state.query || state.status ? '（已筛选）' : '';
      metaBox.textContent = `共 ${total.toLocaleString('zh-CN')} 个用户${filtered}`;
      if (!items.length) {
        tableBox.innerHTML = ui.empty({
          title: '没有找到用户',
          desc: state.query || state.status ? '换个关键字或清除筛选后再试。' : '门户暂时还没有注册用户。',
          actionHtml: state.query || state.status
            ? '<button type="button" class="btn btn-secondary btn-sm" data-act="reset-filter">清除筛选</button>'
            : '<button type="button" class="btn btn-secondary btn-sm" data-act="reload">刷新列表</button>',
        });
        renderPager(total);
        return;
      }
      tableBox.innerHTML = `<div class="table-wrap">
        <table class="table">
          <thead><tr><th>ID</th><th>用户</th><th>余额</th><th>套餐</th><th>到期</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>${items.map(userRow).join('')}</tbody>
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
      const defaultLabel = submitBtn.textContent;
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
        submitBtn.textContent = defaultLabel;
      }
    });
    const first = form.querySelector('input, textarea, select');
    if (first) first.focus();
    return { close };
  }

  async function toggleStatus(btn) {
    const id = btn.getAttribute('data-id');
    const username = btn.getAttribute('data-username') || '';
    const next = btn.getAttribute('data-status') === 'active' ? 'disabled' : 'active';
    if (next === 'disabled') {
      const ok = await ctx.ui.confirm({
        title: '禁用用户',
        content: `确定禁用用户「${username}」吗？禁用后该用户会被立即踢下线且无法登录。`,
        okText: '禁用',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(btn, '处理中…');
    try {
      await ctx.api.admin.setUserStatus(id, next);
      ctx.toast(next === 'active' ? '用户已启用' : '用户已禁用', 'success');
      await load();
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      ctx.toast(err && err.message ? err.message : '操作失败', 'error');
      setBusy(btn, null);
    }
  }

  function openBalanceModal(user) {
    showModal({
      title: `调整余额 · ${user.username}`,
      okText: '确认调整',
      danger: true,
      bodyHtml: `<p class="text-sm text-muted">当前余额 <span class="a-amount">${esc(money(user.balanceCents))}</span>。正数为增加，负数为扣减，单位元。</p>
        <div class="grid grid-2 a-modal-grid">
          <div class="field">
            <label class="field-label" for="a-balance-amount">调整金额（元）</label>
            <input id="a-balance-amount" class="input" name="amount" type="number" step="0.01" placeholder="例如 10 或 -5" autocomplete="off">
          </div>
          <div class="field">
            <label class="field-label" for="a-balance-note">备注</label>
            <input id="a-balance-note" class="input" name="note" maxlength="120" placeholder="如：活动补偿（可选）" autocomplete="off">
          </div>
        </div>`,
      onSubmit: async (form) => {
        const raw = form.querySelector('[name="amount"]').value.trim();
        const amount = Number(raw);
        if (!raw || !Number.isFinite(amount) || amount === 0) throw new Error('请输入非零的调整金额');
        const deltaCents = Math.round(amount * 100);
        if (!deltaCents) throw new Error('金额过小，请精确到分');
        const note = form.querySelector('[name="note"]').value.trim();
        await ctx.api.admin.adjustBalance(user.id, deltaCents, note);
        const sign = deltaCents > 0 ? '+' : '-';
        ctx.toast(`已调整「${user.username}」余额 ${sign}${ui.money(Math.abs(deltaCents))}`, 'success');
        await load();
      },
    });
  }

  function openPasswordModal(user) {
    showModal({
      title: `重置密码 · ${user.username}`,
      okText: '重置密码',
      danger: true,
      bodyHtml: `<div class="grid grid-2 a-modal-grid">
          <div class="field">
            <label class="field-label" for="a-new-password">新密码</label>
            <input id="a-new-password" class="input" name="newPassword" type="password" autocomplete="new-password" placeholder="8–72 个字符">
          </div>
          <div class="field">
            <label class="field-label" for="a-confirm-password">确认新密码</label>
            <input id="a-confirm-password" class="input" name="confirmPassword" type="password" autocomplete="new-password" placeholder="再次输入新密码">
          </div>
        </div>
        <p class="text-sm text-muted">重置后该用户的其它登录会话将失效，请通过安全渠道告知用户新密码。</p>`,
      onSubmit: async (form) => {
        const pwd = form.querySelector('[name="newPassword"]').value;
        const confirmPwd = form.querySelector('[name="confirmPassword"]').value;
        if (pwd.length < 8 || pwd.length > 72) throw new Error('密码长度需为 8–72 个字符');
        if (pwd !== confirmPwd) throw new Error('两次输入的密码不一致');
        await ctx.api.admin.resetPassword(user.id, pwd);
        ctx.toast(`已重置「${user.username}」的密码`, 'success');
      },
    });
  }

  function resetFilter() {
    state.query = '';
    state.status = '';
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
    if (act === 'refresh') load();
    else if (act === 'reset-filter') resetFilter();
    else if (act === 'reload') load();
    else if (act === 'toggle-status') toggleStatus(btn);
    else if (act === 'adjust-balance') {
      const user = findUser(btn);
      if (user) openBalanceModal(user);
    } else if (act === 'reset-password') {
      const user = findUser(btn);
      if (user) openPasswordModal(user);
    }
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
    const sel = e.target.closest('select[name="status"]');
    if (!sel) return;
    const form = sel.closest('form[data-role="filter"]');
    if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
  });

  load();
}
