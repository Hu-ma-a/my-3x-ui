export const meta = { title: '套餐管理', auth: true, admin: true };

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

const ICON_TAG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3.4 13.4a2 2 0 0 1-.6-1.4V4.5A1.5 1.5 0 0 1 4.3 3h7.5a2 2 0 0 1 1.4.6l7.4 7.4a2 2 0 0 1 0 2.8Z"/><circle cx="7.6" cy="7.6" r="1.3"/></svg>';

const ERROR_INPUT = {
  name: 'name',
  price: 'priceCents',
  days: 'days',
  traffic: 'trafficGb',
  deviceLimit: 'deviceLimit',
  sort: 'sort',
  inbounds: 'inboundIds',
};

const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export async function render(root, ctx) {
  const ui = ctx.ui;
  const esc = (v) => ui.escape(v == null ? '' : String(v));
  const money = (v) => ui.money(Number(v) || 0);
  const state = { items: [], page: 1, pageSize: 10, editingId: null, q: '', filter: '' };
  let formLayer = null;

  const wrap = document.createElement('div');
  wrap.innerHTML = `<header class="page-head row-between">
      <div>
        <h1 class="page-title">套餐管理</h1>
        <p class="page-desc">创建与维护对外销售的套餐，价格单位${esc(ctx.ui.currencyName())}，流量单位 GB</p>
      </div>
      <button type="button" class="btn btn-primary" data-act="new-plan">新建套餐</button>
    </header>
    <section class="card">
      <div class="card-head">
        <div>
          <h2 class="card-title"><span class="a-title-icon">${ICON_TAG}</span>套餐列表</h2>
          <p class="card-desc" id="a-plan-meta"></p>
        </div>
      </div>
      <div class="card-body">
        <form class="a-toolbar" data-role="filter" novalidate>
          <input class="input" type="search" name="q" placeholder="搜索套餐名称或描述" aria-label="搜索套餐名称或描述" autocomplete="off">
          <select class="select" name="filter" aria-label="按状态筛选">
            <option value="">全部状态</option>
            <option value="enabled">已启用</option>
            <option value="disabled">已停用</option>
          </select>
          <button class="btn btn-secondary" type="submit">搜索</button>
          <button class="btn btn-ghost" type="button" data-act="reset-filter">重置</button>
        </form>
        <div id="a-plan-table"><div class="loading-block">${ui.spinner()}<span>正在加载套餐…</span></div></div>
        <div id="a-plan-pager"></div>
      </div>
    </section>`;
  root.replaceChildren(wrap);

  const tableBox = wrap.querySelector('#a-plan-table');
  const metaBox = wrap.querySelector('#a-plan-meta');
  const pagerBox = wrap.querySelector('#a-plan-pager');

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

  function findPlan(btn) {
    const id = btn.getAttribute('data-id');
    return state.items.find((plan) => String(plan.id) === String(id)) || null;
  }

  function specText(plan) {
    const gb = Number(plan.trafficGb) || 0;
    const traffic = gb ? ui.bytes(Number(plan.trafficBytes) || gb * 1073741824) : '不限流量';
    const devices = Number(plan.deviceLimit) ? `${Number(plan.deviceLimit)} 台设备` : '设备不限';
    return `${Number(plan.days) || 0} 天 · ${traffic} · ${devices}`;
  }

  function planRow(plan) {
    return `<tr>
      <td>
        <div class="a-cell-title">${esc(plan.name)}${plan.featured ? ' <span class="pill">推荐</span>' : ''}</div>
        ${plan.description ? `<div class="a-cell-sub">${esc(plan.description)}</div>` : ''}
      </td>
      <td class="a-cell-sub">${esc(specText(plan))}</td>
      <td class="num">${esc(money(plan.priceCents))}</td>
      <td><span class="badge ${plan.enabled ? 'badge-success' : 'badge-muted'}">${plan.enabled ? '已启用' : '已停用'}</span></td>
      <td>
        <div class="actions">
          <button type="button" class="link-btn" data-act="edit-plan" data-id="${esc(plan.id)}">编辑</button>
          <button type="button" class="link-btn danger" data-act="delete-plan" data-id="${esc(plan.id)}">删除</button>
        </div>
      </td>
    </tr>`;
  }

  function renderPager(total) {
    pagerBox.innerHTML = total
      ? ui.pagination({ page: state.page, total, pageSize: state.pageSize })
      : '';
  }

  function visibleItems() {
    const q = state.q.toLowerCase();
    return state.items.filter((plan) => {
      if (state.filter === 'enabled' && !plan.enabled) return false;
      if (state.filter === 'disabled' && plan.enabled) return false;
      if (!q) return true;
      return `${plan.name || ''} ${plan.description || ''}`.toLowerCase().includes(q);
    });
  }

  function render() {
    const total = state.items.length;
    const enabled = state.items.filter((plan) => plan.enabled).length;
    const list = visibleItems();
    const filtering = !!(state.q || state.filter);
    metaBox.textContent = filtering
      ? `共 ${total} 个套餐 · 启用 ${enabled} 个 · 筛选出 ${list.length} 个`
      : `共 ${total} 个套餐 · 启用 ${enabled} 个`;
    const pages = Math.max(1, Math.ceil(list.length / state.pageSize));
    if (state.page > pages) state.page = pages;
    if (!total) {
      tableBox.innerHTML = ui.empty({
        title: '还没有套餐',
        desc: '创建套餐后，用户即可在门户购买或续费。',
        actionHtml: '<button type="button" class="btn btn-secondary btn-sm" data-act="new-plan">新建套餐</button>',
      });
      renderPager(0);
      return;
    }
    if (!list.length) {
      tableBox.innerHTML = ui.empty({
        title: '没有匹配的套餐',
        desc: '换个关键字或清除筛选后再试。',
        actionHtml: '<button type="button" class="btn btn-secondary btn-sm" data-act="reset-filter">清除筛选</button>',
      });
      renderPager(0);
      return;
    }
    const start = (state.page - 1) * state.pageSize;
    const rows = list.slice(start, start + state.pageSize);
    tableBox.innerHTML = `<div class="table-wrap">
      <table class="table">
        <thead><tr><th>套餐</th><th>规格</th><th>价格</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${rows.map(planRow).join('')}</tbody>
      </table>
    </div>`;
    renderPager(list.length);
  }

  async function load() {
    tableBox.innerHTML = `<div class="loading-block">${ui.spinner()}<span>正在加载套餐…</span></div>`;
    metaBox.textContent = '';
    try {
      const data = (await ctx.api.admin.plans()) || {};
      state.items = Array.isArray(data.items) ? data.items : [];
      render();
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      state.items = [];
      tableBox.innerHTML = errorHtml(err);
      pagerBox.innerHTML = '';
    }
  }

  function formHtml(plan) {
    const p = plan || {};
    const priceYuan = p.priceCents != null ? String(Number(p.priceCents) / 100) : '';
    const inboundIds = Array.isArray(p.inboundIds) ? p.inboundIds.join(',') : '';
    return `<div class="modal" role="dialog" aria-modal="true" aria-label="${plan ? '编辑套餐' : '新建套餐'}">
      <form data-plan-form novalidate>
        <div class="modal-head row-between">
          <span>${plan ? `编辑套餐 · ${esc(p.name || '')}` : '新建套餐'}</span>
          <button type="button" class="btn btn-icon" data-act="close-form" aria-label="关闭">${CLOSE_ICON}</button>
        </div>
        <div class="modal-body">
          <div class="grid grid-2 a-modal-grid">
            <div class="field">
              <label class="field-label" for="a-plan-name">名称</label>
              <input id="a-plan-name" class="input" name="name" type="text" maxlength="60" placeholder="如：标准套餐" value="${esc(p.name || '')}">
              <p class="error-text hidden" data-error-for="name"></p>
            </div>
            <div class="field">
              <label class="field-label" for="a-plan-price">价格（${esc(ctx.ui.currencyName())}）</label>
              <input id="a-plan-price" class="input" name="priceCents" type="number" step="0.01" min="0" placeholder="如：29.90" value="${esc(priceYuan)}">
              <p class="error-text hidden" data-error-for="price"></p>
            </div>
            <div class="field">
              <label class="field-label" for="a-plan-days">有效期（天）</label>
              <input id="a-plan-days" class="input" name="days" type="number" step="1" min="1" placeholder="如：30" value="${esc(p.days != null ? p.days : '')}">
              <p class="error-text hidden" data-error-for="days"></p>
            </div>
            <div class="field">
              <label class="field-label" for="a-plan-traffic">流量（GB）</label>
              <input id="a-plan-traffic" class="input" name="trafficGb" type="number" step="1" min="0" placeholder="如：500，0 表示不限" value="${esc(p.trafficGb != null ? p.trafficGb : '')}">
              <p class="error-text hidden" data-error-for="traffic"></p>
            </div>
            <div class="field">
              <label class="field-label" for="a-plan-devices">设备数上限</label>
              <input id="a-plan-devices" class="input" name="deviceLimit" type="number" step="1" min="0" placeholder="0 表示不限" value="${esc(p.deviceLimit != null ? p.deviceLimit : 0)}">
              <p class="error-text hidden" data-error-for="deviceLimit"></p>
            </div>
            <div class="field">
              <label class="field-label" for="a-plan-sort">排序（越小越靠前）</label>
              <input id="a-plan-sort" class="input" name="sort" type="number" step="1" min="0" placeholder="0" value="${esc(p.sort != null ? p.sort : 0)}">
              <p class="error-text hidden" data-error-for="sort"></p>
            </div>
            <div class="field a-span-2">
              <label class="field-label" for="a-plan-inbounds">绑定入站 ID（逗号分隔）</label>
              <input id="a-plan-inbounds" class="input" name="inboundIds" type="text" placeholder="如：1,2" value="${esc(inboundIds)}">
              <p class="hint">留空则使用「系统设置 → 默认入站 ID」；仍未配置时使用面板第一个入站。</p>
              <p class="error-text hidden" data-error-for="inbounds"></p>
            </div>
            <div class="field a-span-2">
              <label class="field-label" for="a-plan-desc">描述</label>
              <textarea id="a-plan-desc" class="textarea" name="description" rows="2" maxlength="200" placeholder="展示给用户的套餐说明，可选">${esc(p.description || '')}</textarea>
            </div>
            <div class="field a-span-2">
              <div class="a-check-row">
                <label class="checkbox-row"><input type="checkbox" name="enabled" ${p.enabled === false ? '' : 'checked'}> 启用（用户可见可购买）</label>
                <label class="checkbox-row"><input type="checkbox" name="featured" ${p.featured ? 'checked' : ''}> 推荐</label>
              </div>
            </div>
          </div>
          <p class="error-text hidden" data-role="form-error"></p>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-act="close-form">取消</button>
          <button type="submit" class="btn btn-primary">${plan ? '保存修改' : '创建套餐'}</button>
        </div>
      </form>
    </div>`;
  }

  function hideForm() {
    state.editingId = null;
    if (formLayer) {
      formLayer.remove();
      formLayer = null;
    }
  }

  function onFormKey(e) {
    if (e.key === 'Escape') hideForm();
  }

  function openForm(plan) {
    hideForm();
    state.editingId = plan ? plan.id : null;
    formLayer = document.createElement('div');
    formLayer.className = 'modal-backdrop';
    formLayer.innerHTML = formHtml(plan);
    wrap.appendChild(formLayer);
    document.addEventListener('keydown', onFormKey);
    formLayer.addEventListener('click', (e) => {
      if (e.target === formLayer || e.target.closest('[data-act="close-form"]')) hideForm();
    });
    const nameInput = formLayer.querySelector('input[name="name"]');
    if (nameInput) nameInput.focus();
  }

  if (typeof ctx.onCleanup === 'function') {
    ctx.onCleanup(() => {
      document.removeEventListener('keydown', onFormKey);
      if (formLayer) formLayer.remove();
    });
  }

  function setFieldError(form, key, msg) {
    const inputName = ERROR_INPUT[key];
    const input = inputName ? form.querySelector(`[name="${inputName}"]`) : null;
    const box = form.querySelector(`[data-error-for="${key}"]`);
    if (input) input.classList.toggle('a-invalid', !!msg);
    if (box) {
      box.textContent = msg || '';
      box.classList.toggle('hidden', !msg);
    }
  }

  async function savePlan(form) {
    const get = (name) => {
      const el = form.querySelector(`[name="${name}"]`);
      return el ? el.value.trim() : '';
    };
    const checked = (name) => {
      const el = form.querySelector(`[name="${name}"]`);
      return !!(el && el.checked);
    };
    const setFormError = (msg) => {
      const box = form.querySelector('[data-role="form-error"]');
      if (box) {
        box.textContent = msg || '';
        box.classList.toggle('hidden', !msg);
      }
    };
    setFormError('');
    form.querySelectorAll('[data-error-for]').forEach((box) => {
      box.textContent = '';
      box.classList.add('hidden');
    });
    form.querySelectorAll('.a-invalid').forEach((el) => el.classList.remove('a-invalid'));

    const errors = {};
    const name = get('name');
    if (!name) errors.name = '请输入套餐名称';

    const priceRaw = get('priceCents');
    const priceYuan = Number(priceRaw);
    if (!priceRaw || !Number.isFinite(priceYuan) || priceYuan < 0) errors.price = '价格需为不小于 0 的数字';
    const priceCents = Math.round(priceYuan * 100);

    const days = Number(get('days'));
    if (!Number.isInteger(days) || days < 1) errors.days = '有效期至少 1 天';

    const trafficRaw = get('trafficGb');
    const trafficGb = Number(trafficRaw);
    if (!trafficRaw || !Number.isFinite(trafficGb) || trafficGb < 0) errors.traffic = '流量需为不小于 0 的数字';

    const deviceLimit = Number(get('deviceLimit') || 0);
    if (!Number.isInteger(deviceLimit) || deviceLimit < 0) errors.deviceLimit = '设备数需为不小于 0 的整数';

    const sort = Number(get('sort') || 0);
    if (!Number.isInteger(sort) || sort < 0) errors.sort = '排序需为不小于 0 的整数';

    const inboundIds = [];
    const inboundRaw = get('inboundIds');
    if (inboundRaw) {
      const parts = inboundRaw.split(/[,，\s]+/).filter(Boolean);
      for (const part of parts) {
        const n = Number(part);
        if (!Number.isInteger(n) || n <= 0) {
          errors.inbounds = '入站 ID 需为正整数，使用英文逗号分隔';
          break;
        }
        inboundIds.push(n);
      }
    }

    const keys = Object.keys(errors);
    keys.forEach((key) => setFieldError(form, key, errors[key]));
    if (keys.length) {
      const first = form.querySelector('.a-invalid');
      if (first) first.focus();
      return;
    }

    const body = {
      name,
      description: get('description'),
      priceCents,
      days,
      trafficGb,
      deviceLimit,
      inboundIds,
      enabled: checked('enabled'),
      featured: checked('featured'),
      sort,
    };
    const submitBtn = form.querySelector('button[type="submit"]');
    const label = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = '保存中…';
    try {
      if (state.editingId != null) {
        await ctx.api.admin.updatePlan(state.editingId, body);
        ctx.toast('套餐已更新', 'success');
      } else {
        await ctx.api.admin.createPlan(body);
        ctx.toast('套餐已创建', 'success');
      }
      hideForm();
      await load();
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      setFormError(err && err.message ? err.message : '保存失败，请稍后重试');
      submitBtn.disabled = false;
      submitBtn.textContent = label;
    }
  }

  async function deletePlan(btn) {
    const plan = findPlan(btn);
    if (!plan) return;
    const ok = await ctx.ui.confirm({
      title: '删除套餐',
      content: `确定删除套餐「${plan.name}」吗？若已有订单引用该套餐，将只停用而不删除。`,
      okText: '删除',
      danger: true,
    });
    if (!ok) return;
    setBusy(btn, '删除中…');
    try {
      const result = await ctx.api.admin.deletePlan(plan.id);
      if (result && result.disabled) ctx.toast(`套餐「${plan.name}」已被订单引用，已改为停用`, 'info');
      else ctx.toast('套餐已删除', 'success');
      if (state.editingId != null && String(state.editingId) === String(plan.id)) hideForm();
      await load();
    } catch (err) {
      if (handleAuthError(ctx, err)) return;
      ctx.toast(err && err.message ? err.message : '删除失败', 'error');
      setBusy(btn, null);
    }
  }

  function resetFilter() {
    state.q = '';
    state.filter = '';
    state.page = 1;
    const form = wrap.querySelector('form[data-role="filter"]');
    if (form) {
      form.querySelector('[name="q"]').value = '';
      form.querySelector('[name="filter"]').value = '';
    }
    render();
  }

  wrap.addEventListener('click', (e) => {
    const pageBtn = e.target.closest('[data-page]');
    if (pageBtn && !pageBtn.disabled) {
      const next = Number(pageBtn.getAttribute('data-page'));
      if (Number.isFinite(next) && next > 0 && next !== state.page) {
        state.page = next;
        render();
      }
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'new-plan') openForm(null);
    else if (act === 'edit-plan') {
      const plan = findPlan(btn);
      if (plan) openForm(plan);
    } else if (act === 'delete-plan') deletePlan(btn);
    else if (act === 'close-form') hideForm();
    else if (act === 'reset-filter') resetFilter();
    else if (act === 'reload') load();
  });

  wrap.addEventListener('submit', (e) => {
    const planForm = e.target.closest('form[data-plan-form]');
    if (planForm) {
      e.preventDefault();
      savePlan(planForm);
      return;
    }
    const filterForm = e.target.closest('form[data-role="filter"]');
    if (!filterForm) return;
    e.preventDefault();
    const data = new FormData(filterForm);
    state.q = String(data.get('q') || '').trim();
    state.filter = String(data.get('filter') || '');
    state.page = 1;
    render();
  });

  wrap.addEventListener('change', (e) => {
    const sel = e.target.closest('select[name="filter"]');
    if (!sel) return;
    const form = sel.closest('form[data-role="filter"]');
    if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
  });

  wrap.addEventListener('input', (e) => {
    const input = e.target.closest('[name]');
    if (!input) return;
    const form = input.closest('form[data-plan-form]');
    if (!form) return;
    input.classList.remove('a-invalid');
    const field = input.closest('.field');
    const box = field ? field.querySelector('[data-error-for]') : null;
    if (box) {
      box.textContent = '';
      box.classList.add('hidden');
    }
    const formError = form.querySelector('[data-role="form-error"]');
    if (formError) {
      formError.textContent = '';
      formError.classList.add('hidden');
    }
  });

  load();
}
