export const meta = { title: '管理员', auth: true, admin: true };

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

const ICON_SHIELD =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5.2c0 4.3-2.9 7.8-7 9.8-4.1-2-7-5.5-7-9.8V6l7-3z"/><path d="M9.2 12.2l2 2 3.6-3.8"/></svg>';

const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const ROLE_LABEL = { active: '正常', disabled: '已禁用' };

export async function render(root, ctx) {
  const ui = ctx.ui;
  const esc = (v) => ui.escape(v == null ? '' : String(v));
  const dateTime = (ms) => (ms ? ui.dateTime(ms) : '—');

  let items = [];
  let canManageAdmins = false;

  const wrap = document.createElement('div');
  wrap.innerHTML = `<header class="page-head row-between">
      <div>
        <h1 class="page-title">管理员</h1>
        <p class="page-desc">新增管理员账号、启用或禁用管理员、重置密码；管理员可登录后台管理整个门户。</p>
      </div>
      <button type="button" class="btn btn-primary" data-act="create" id="a-admins-create">新增管理员</button>
    </header>
    <section class="card">
      <div class="card-head">
        <div>
          <h2 class="card-title"><span class="a-title-icon">${ICON_SHIELD}</span>管理员列表</h2>
          <p class="card-desc" id="a-admins-meta"></p>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-act="refresh">刷新列表</button>
      </div>
      <div class="card-body">
        <div id="a-admins-table"><div class="loading-block">${ui.spinner()}<span>正在加载管理员…</span></div></div>
      </div>
    </section>`;
  root.replaceChildren(wrap);

  const tableBox = wrap.querySelector('#a-admins-table');
  const metaBox = wrap.querySelector('#a-admins-meta');

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

  function adminRow(admin) {
    const active = admin.status === 'active';
    const self = Boolean(admin.isSelf);
    const isSuper = Boolean(admin.isSuper);
    const statusBadge = `<span class="badge ${active ? 'badge-success' : 'badge-danger'}">${ROLE_LABEL[admin.status] || esc(admin.status)}</span>`;
    const selfBadge = self ? '<span class="badge badge-info">当前登录</span>' : '';
    const superBadge = isSuper ? ' <span class="badge badge-warning">最高权限</span>' : '';
    let actions = '';
    if (isSuper) {
      actions = self
        ? `<button type="button" class="link-btn" data-act="reset-password" data-id="${esc(admin.id)}" data-username="${esc(admin.username)}">修改密码</button>
           <span class="text-sm text-muted">最高权限账号不可删除或禁用</span>`
        : '<span class="text-sm text-muted">最高权限账号，不可修改或删除</span>';
    } else if (!canManageAdmins) {
      actions = '<span class="text-sm text-muted">只有最高权限管理员可操作</span>';
    } else if (self) {
      actions = `<button type="button" class="link-btn" data-act="reset-password" data-id="${esc(admin.id)}" data-username="${esc(admin.username)}">修改密码</button>
         <span class="text-sm text-muted">当前账号不可禁用或删除</span>`;
    } else {
      actions = `<button type="button" class="link-btn${active ? ' danger' : ''}"
           data-act="toggle-status" data-id="${esc(admin.id)}" data-status="${esc(admin.status)}" data-username="${esc(admin.username)}">${active ? '禁用' : '启用'}</button>
         <button type="button" class="link-btn" data-act="reset-password" data-id="${esc(admin.id)}" data-username="${esc(admin.username)}">重置密码</button>
         <button type="button" class="link-btn danger" data-act="delete" data-id="${esc(admin.id)}" data-username="${esc(admin.username)}">删除</button>`;
    }
    return `<tr>
      <td class="mono">${esc(admin.id)}</td>
      <td>
        <div class="a-cell-title">${esc(admin.username)} ${selfBadge}${superBadge}</div>
        ${admin.email ? `<div class="a-cell-sub">${esc(admin.email)}</div>` : ''}
      </td>
      <td>${statusBadge}</td>
      <td>${esc(dateTime(admin.createdAt))}</td>
      <td>${esc(dateTime(admin.lastLoginAt))}</td>
      <td><div class="actions">${actions}</div></td>
    </tr>`;
  }

  function findAdmin(btn) {
    const id = btn.getAttribute('data-id');
    return items.find((admin) => String(admin.id) === String(id)) || null;
  }

  async function load() {
    tableBox.innerHTML = `<div class="loading-block">${ui.spinner()}<span>正在加载管理员…</span></div>`;
    metaBox.textContent = '';
    try {
      const data = (await ctx.api.admin.admins()) || {};
      items = Array.isArray(data.items) ? data.items : [];
      canManageAdmins = Boolean(data.canManageAdmins);
      const createBtn = wrap.querySelector('#a-admins-create');
      if (createBtn) createBtn.classList.toggle('hidden', !canManageAdmins);
      const activeCount = items.filter((admin) => admin.status === 'active').length;
      const superAdmin = items.find((admin) => admin.isSuper);
      metaBox.textContent = `共 ${items.length} 个管理员，其中 ${activeCount} 个可用${superAdmin ? ` · 最高权限：${superAdmin.username}` : ''}${canManageAdmins ? '' : ' · 你当前是普通管理员，仅可查看'}`;
      if (!items.length) {
        tableBox.innerHTML = ui.empty({
          title: '还没有管理员',
          desc: canManageAdmins ? '点击右上角「新增管理员」创建管理员账号。' : '只有最高权限管理员可以新增管理员。',
          actionHtml: canManageAdmins ? '<button type="button" class="btn btn-primary btn-sm" data-act="create">新增管理员</button>' : '',
        });
        return;
      }
      tableBox.innerHTML = `<div class="table-wrap">
        <table class="table">
          <thead><tr><th>ID</th><th>管理员</th><th>状态</th><th>创建时间</th><th>最近登录</th><th>操作</th></tr></thead>
          <tbody>${items.map(adminRow).join('')}</tbody>
        </table>
      </div>`;
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

  function openCreateModal() {
    showModal({
      title: '新增管理员',
      okText: '创建管理员',
      bodyHtml: `<div class="grid grid-2 a-modal-grid">
          <div class="field">
            <label class="field-label" for="a-admin-username">用户名</label>
            <input id="a-admin-username" class="input" name="username" autocomplete="off" maxlength="32" placeholder="3–32 位字母、数字或 _ . -">
          </div>
          <div class="field">
            <label class="field-label" for="a-admin-email">邮箱 <span class="optional">（可选）</span></label>
            <input id="a-admin-email" class="input" name="email" type="email" autocomplete="off" maxlength="254" placeholder="用于通知，可留空">
          </div>
          <div class="field">
            <label class="field-label" for="a-admin-password">初始密码</label>
            <input id="a-admin-password" class="input" name="password" type="password" autocomplete="new-password" placeholder="8–72 个字符">
          </div>
          <div class="field">
            <label class="field-label" for="a-admin-confirm">确认密码</label>
            <input id="a-admin-confirm" class="input" name="confirmPassword" type="password" autocomplete="new-password" placeholder="再次输入密码">
          </div>
        </div>
        <p class="text-sm text-muted">新管理员拥有完整后台权限，请通过安全渠道发送初始密码，并要求其登录后自行修改。</p>`,
      onSubmit: async (form) => {
        const username = form.querySelector('[name="username"]').value.trim();
        const email = form.querySelector('[name="email"]').value.trim();
        const password = form.querySelector('[name="password"]').value;
        const confirmPassword = form.querySelector('[name="confirmPassword"]').value;
        if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new Error('用户名需为 3–32 位字母、数字或 _ . -');
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('邮箱格式不正确');
        if (password.length < 8 || password.length > 72) throw new Error('密码长度需为 8–72 个字符');
        if (password !== confirmPassword) throw new Error('两次输入的密码不一致');
        await ctx.api.admin.createAdmin({ username, password, email });
        ctx.toast(`已新增管理员「${username}」`, 'success');
        await load();
      },
    });
  }

  function openResetPasswordModal(admin) {
    showModal({
      title: `重置密码 · ${admin.username}`,
      okText: '重置密码',
      danger: true,
      bodyHtml: `<div class="grid grid-2 a-modal-grid">
          <div class="field">
            <label class="field-label" for="a-admin-new-password">新密码</label>
            <input id="a-admin-new-password" class="input" name="newPassword" type="password" autocomplete="new-password" placeholder="8–72 个字符">
          </div>
          <div class="field">
            <label class="field-label" for="a-admin-confirm-password">确认新密码</label>
            <input id="a-admin-confirm-password" class="input" name="confirmPassword" type="password" autocomplete="new-password" placeholder="再次输入新密码">
          </div>
        </div>
        <p class="text-sm text-muted">重置后该管理员现有的登录会话会立即失效。</p>`,
      onSubmit: async (form) => {
        const pwd = form.querySelector('[name="newPassword"]').value;
        const confirmPwd = form.querySelector('[name="confirmPassword"]').value;
        if (pwd.length < 8 || pwd.length > 72) throw new Error('密码长度需为 8–72 个字符');
        if (pwd !== confirmPwd) throw new Error('两次输入的密码不一致');
        await ctx.api.admin.resetAdminPassword(admin.id, pwd);
        ctx.toast(`已重置「${admin.username}」的密码`, 'success');
      },
    });
  }

  async function toggleStatus(btn) {
    const admin = findAdmin(btn);
    if (!admin) return;
    const active = admin.status === 'active';
    if (active) {
      const ok = await ctx.ui.confirm({
        title: '禁用管理员',
        content: `确定禁用管理员「${admin.username}」吗？禁用后该管理员会被立即踢下线且无法登录后台。`,
        okText: '禁用',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(btn, '处理中…');
    try {
      await ctx.api.admin.setAdminStatus(admin.id, active ? 'disabled' : 'active');
      ctx.toast(active ? '管理员已禁用' : '管理员已启用', 'success');
      await load();
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      ctx.toast(err && err.message ? err.message : '操作失败', 'error');
      setBusy(btn, null);
    }
  }

  async function deleteAdmin(btn) {
    const admin = findAdmin(btn);
    if (!admin) return;
    const ok = await ctx.ui.confirm({
      title: '删除管理员',
      content: `确定删除管理员「${admin.username}」吗？删除后该账号将无法登录，且不可恢复。`,
      okText: '删除',
      danger: true,
    });
    if (!ok) return;
    setBusy(btn, '删除中…');
    try {
      await ctx.api.admin.deleteAdmin(admin.id);
      ctx.toast('管理员已删除', 'success');
      await load();
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      ctx.toast(err && err.message ? err.message : '操作失败', 'error');
      setBusy(btn, null);
    }
  }

  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'refresh' || act === 'reload') load();
    else if (act === 'create') openCreateModal();
    else if (act === 'toggle-status') toggleStatus(btn);
    else if (act === 'reset-password') {
      const admin = findAdmin(btn);
      if (admin) openResetPasswordModal(admin);
    } else if (act === 'delete') deleteAdmin(btn);
  });

  load();
}
