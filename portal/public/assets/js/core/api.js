export class ApiError extends Error {
  constructor(message, { status = 0, code = 'http_error' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let csrfToken = '';

export function setCsrfToken(token) {
  csrfToken = String(token || '');
}

export function getCsrfToken() {
  return csrfToken;
}

async function request(method, path, { body, query } = {}) {
  const url = new URL(path, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, value);
    }
  }
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('网络连接失败，请检查网络后重试', { status: 0, code: 'network_error' });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload || payload.ok !== true) {
    const code = payload?.error?.code || 'http_error';
    const message = payload?.error?.message || `请求失败（HTTP ${response.status}）`;
    throw new ApiError(message, { status: response.status, code });
  }
  return payload.data;
}

export const api = {
  setCsrfToken,
  getCsrfToken,
  config: () => request('GET', '/api/config'),
  captcha: () => request('GET', '/api/auth/captcha'),
  async register(body) {
    const data = await request('POST', '/api/auth/register', { body });
    setCsrfToken(data.csrfToken);
    return data;
  },
  async login(body) {
    const data = await request('POST', '/api/auth/login', { body });
    setCsrfToken(data.csrfToken);
    return data;
  },
  async logout() {
    try {
      await request('POST', '/api/auth/logout');
    } finally {
      setCsrfToken('');
    }
  },
  async me() {
    const data = await request('GET', '/api/me');
    if (data?.csrfToken) setCsrfToken(data.csrfToken);
    return data;
  },
  subscription: () => request('GET', '/api/me/subscription'),
  changePassword: (body) => request('POST', '/api/me/password', { body }),
  plans: () => request('GET', '/api/plans'),
  orders: (query) => request('GET', '/api/me/orders', { query }),
  order: (orderNo) => request('GET', `/api/me/orders/${encodeURIComponent(orderNo)}`),
  purchase: (body) => request('POST', '/api/me/purchase', { body }),
  recharge: (body) => request('POST', '/api/me/recharge', { body }),
  mockComplete: (orderNo) => request('POST', `/api/me/payments/${encodeURIComponent(orderNo)}/mock-complete`),
  admin: {
    overview: () => request('GET', '/api/admin/overview'),
    users: (query) => request('GET', '/api/admin/users', { query }),
    user: (id) => request('GET', `/api/admin/users/${id}`),
    setUserStatus: (id, status) => request('POST', `/api/admin/users/${id}/status`, { body: { status } }),
    adjustBalance: (id, deltaCents, note) => request('POST', `/api/admin/users/${id}/balance`, { body: { deltaCents, note } }),
    resetPassword: (id, newPassword) => request('POST', `/api/admin/users/${id}/reset-password`, { body: { newPassword } }),
    admins: () => request('GET', '/api/admin/admins'),
    createAdmin: (body) => request('POST', '/api/admin/admins', { body }),
    setAdminStatus: (id, status) => request('POST', `/api/admin/admins/${id}/status`, { body: { status } }),
    resetAdminPassword: (id, newPassword) => request('POST', `/api/admin/admins/${id}/password`, { body: { newPassword } }),
    deleteAdmin: (id) => request('DELETE', `/api/admin/admins/${id}`),
    plans: () => request('GET', '/api/admin/plans'),
    createPlan: (body) => request('POST', '/api/admin/plans', { body }),
    updatePlan: (id, body) => request('PUT', `/api/admin/plans/${id}`, { body }),
    deletePlan: (id) => request('DELETE', `/api/admin/plans/${id}`),
    orders: (query) => request('GET', '/api/admin/orders', { query }),
    order: (id) => request('GET', `/api/admin/orders/${id}`),
    markPaid: (id) => request('POST', `/api/admin/orders/${id}/mark-paid`),
    retryProvision: (id) => request('POST', `/api/admin/orders/${id}/retry-provision`),
    cancelOrder: (id) => request('POST', `/api/admin/orders/${id}/cancel`),
    recharges: (query) => request('GET', '/api/admin/recharges', { query }),
    settings: () => request('GET', '/api/admin/settings'),
    updateSettings: (body) => request('PUT', '/api/admin/settings', { body }),
    testXui: () => request('POST', '/api/admin/settings/test-xui'),
    updateStatus: () => request('GET', '/api/admin/update'),
    checkUpdate: () => request('POST', '/api/admin/update/check'),
    applyUpdate: () => request('POST', '/api/admin/update/apply'),
  },
};
