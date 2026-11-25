const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const STATUS_MAP = {
  pending: { text: '待支付', tone: 'warning' },
  paid: { text: '待开通', tone: 'warning' },
  provisioning: { text: '开通中', tone: 'warning' },
  provisioned: { text: '已开通', tone: 'success' },
  credited: { text: '已到账', tone: 'success' },
  sync_pending: { text: '待同步', tone: 'warning' },
  failed: { text: '失败', tone: 'danger' },
  cancelled: { text: '已取消', tone: 'muted' },
  active: { text: '正常', tone: 'success' },
  disabled: { text: '已禁用', tone: 'danger' },
  banned: { text: '已封禁', tone: 'danger' },
};

const KIND_MAP = { plan: '套餐', recharge: '充值' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);
}

// 门户品牌名：去掉历史默认里的上游品牌字样，留空时回退为「用户中心」。
function portalName(raw, fallback = '用户中心') {
  const cleaned = String(raw || '')
    .replace(/3x-ui/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

const CURRENCIES = {
  CNY: { symbol: '¥', name: '元' },
  USD: { symbol: '$', name: '美元' },
  EUR: { symbol: '€', name: '欧元' },
  GBP: { symbol: '£', name: '英镑' },
  JPY: { symbol: 'JP¥', name: '日元' },
  HKD: { symbol: 'HK$', name: '港元' },
};

let activeCurrency = 'CNY';

function setCurrency(code) {
  const next = String(code || '').trim().toUpperCase();
  activeCurrency = CURRENCIES[next] ? next : 'CNY';
}

function currencyCode() {
  return activeCurrency;
}

function currencySymbol() {
  return CURRENCIES[activeCurrency].symbol;
}

function currencyName() {
  return CURRENCIES[activeCurrency].name;
}

/** 分 → 金额数值字符串（不带符号，用于输入框/金额展示）。 */
function amount(cents) {
  if (cents === null || cents === undefined) return '';
  return (Number(cents) / 100).toFixed(2);
}

function money(cents) {
  if (cents === null || cents === undefined) return '—';
  return `${currencySymbol()}${amount(cents)}`;
}

function bytes(value) {
  if (value === null || value === undefined) return '不限';
  const number = Number(value);
  if (!Number.isFinite(number)) return '不限';
  if (number <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let index = 0;
  let size = number;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const digits = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${Number(size.toFixed(digits))} ${units[index]}`;
}

function pct(part, total) {
  const numerator = Number(part) || 0;
  const denominator = Number(total) || 0;
  if (denominator <= 0) return '0%';
  return `${Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)))}%`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function date(ms) {
  if (!ms) return '—';
  const value = new Date(Number(ms));
  if (Number.isNaN(value.getTime())) return '—';
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function dateTime(ms) {
  if (!ms) return '—';
  const value = new Date(Number(ms));
  if (Number.isNaN(value.getTime())) return '—';
  return `${date(ms)} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function relative(ms) {
  if (!ms) return '不限';
  const diff = Number(ms) - Date.now();
  if (diff <= 0) return '已过期';
  const hour = 60 * 60 * 1000;
  if (diff <= 24 * hour) return `剩余 ${Math.max(1, Math.ceil(diff / hour))} 小时`;
  return `剩余 ${Math.ceil(diff / (24 * hour))} 天`;
}

function statusText(status) {
  return STATUS_MAP[status]?.text || status || '—';
}

function kindText(kind) {
  return KIND_MAP[kind] || kind || '—';
}

function tone(status) {
  return STATUS_MAP[status]?.tone || 'muted';
}

function badge(status) {
  return `<span class="badge badge-${tone(status)}">${escapeHtml(statusText(status))}</span>`;
}

/** 入站实时延迟徽标：绿色快、黄色一般、红色慢/不可达。 */
function latencyBadge(ms, note = '') {
  if (note === 'udp') return '<span class="badge badge-muted">UDP 协议</span>';
  if (ms == null) return '<span class="badge badge-danger">不可达</span>';
  const value = Number(ms);
  if (!Number.isFinite(value)) return '<span class="badge badge-muted">—</span>';
  const level = value <= 80 ? 'success' : value <= 200 ? 'info' : value <= 400 ? 'warning' : 'danger';
  return `<span class="badge badge-${level}">${Math.round(value)} ms</span>`;
}

function qs(root, selector) {
  return (root || document).querySelector(selector);
}

function qsa(root, selector) {
  return Array.from((root || document).querySelectorAll(selector));
}

function on(root, selector, event, handler) {
  const container = root || document;
  const listener = (rawEvent) => {
    const target = rawEvent.target instanceof Element ? rawEvent.target.closest(selector) : null;
    if (!target || !container.contains(target)) return;
    handler(rawEvent, target);
  };
  container.addEventListener(event, listener);
  return () => container.removeEventListener(event, listener);
}

function toast(message, type = 'info', timeout = 3600) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.innerHTML = `<span class="toast-dot" aria-hidden="true"></span><span>${escapeHtml(message)}</span>`;
  root.appendChild(node);
  window.setTimeout(() => {
    node.style.opacity = '0';
    window.setTimeout(() => node.remove(), 180);
  }, timeout);
}

function confirmDialog({ title = '确认操作', content = '', okText = '确定', cancelText = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    if (!root) {
      resolve(false);
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'modal-backdrop';
    wrapper.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">${escapeHtml(title)}</div>
        <div class="modal-body"><p class="text-muted">${escapeHtml(content)}</p></div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-act="cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${escapeHtml(okText)}</button>
        </div>
      </div>`;
    const close = (result) => {
      wrapper.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') close(false);
    };
    wrapper.addEventListener('click', (event) => {
      const action = event.target instanceof Element ? event.target.getAttribute('data-act') : null;
      if (action) close(action === 'ok');
      else if (event.target === wrapper) close(false);
    });
    document.addEventListener('keydown', onKey);
    root.appendChild(wrapper);
  });
}

function empty({ title = '暂无数据', desc = '', actionHtml = '' } = {}) {
  return `<div class="empty">
    <div class="empty-title">${escapeHtml(title)}</div>
    ${desc ? `<div>${escapeHtml(desc)}</div>` : ''}
    ${actionHtml ? `<div class="empty-actions">${actionHtml}</div>` : ''}
  </div>`;
}

function spinner(size = '') {
  return `<span class="spinner ${size === 'lg' ? 'spinner-lg' : ''}" role="status" aria-label="加载中"></span>`;
}

function pagination({ page = 1, total = 0, pageSize = 20 } = {}) {
  const pages = Math.max(1, Math.ceil(Number(total) / Number(pageSize)));
  const current = Math.min(Math.max(1, Number(page)), pages);
  const windowSize = 5;
  let start = Math.max(1, current - Math.floor(windowSize / 2));
  const end = Math.min(pages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const buttons = [];
  for (let index = start; index <= end; index += 1) {
    buttons.push(
      `<button type="button" class="pagination-page ${index === current ? 'active' : ''}" data-page="${index}">${index}</button>`,
    );
  }
  return `<div class="pagination">
    <span>共 ${Number(total) || 0} 条 · 第 ${current}/${pages} 页</span>
    <div class="pagination-pages">
      <button type="button" class="pagination-page" data-page="${current - 1}" ${current <= 1 ? 'disabled' : ''}>上一页</button>
      ${buttons.join('')}
      <button type="button" class="pagination-page" data-page="${current + 1}" ${current >= pages ? 'disabled' : ''}>下一页</button>
    </div>
  </div>`;
}

async function copy(text) {
  const value = String(text ?? '');
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // 剪贴板权限被拒时走下面的兜底方案。
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export const ui = {
  escape: escapeHtml,
  portalName,
  setCurrency,
  currencyCode,
  currencySymbol,
  currencyName,
  amount,
  money,
  bytes,
  pct,
  date,
  dateTime,
  relative,
  statusText,
  kindText,
  tone,
  badge,
  latencyBadge,
  qs,
  qsa,
  on,
  toast,
  confirm: confirmDialog,
  empty,
  spinner,
  pagination,
  copy,
};
