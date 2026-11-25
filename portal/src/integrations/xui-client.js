export class XuiError extends Error {
  constructor(message, { status = 0 } = {}) {
    super(message);
    this.name = 'XuiError';
    this.status = status;
  }
}

function joinBase(url, basePath) {
  const root = String(url || '').replace(/\/+$/, '');
  const path = String(basePath || '/').replace(/^\/+|\/+$/g, '');
  return path ? `${root}/${path}` : root;
}

export class XuiClient {
  constructor(options = {}, logger = null) {
    this.url = options.url || 'http://127.0.0.1:2053';
    this.basePath = options.basePath || '/';
    this.apiToken = options.apiToken || '';
    this.username = options.username || '';
    this.password = options.password || '';
    this.timeoutMs = Number(options.timeoutMs) || 15000;
    this.logger = logger;
    this.cookieJar = new Map();
    this.csrfToken = '';
  }

  cookieHeaderValue() {
    return [...this.cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  absorbCookies(response) {
    const list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const raw of list) {
      const pair = String(raw).split(';')[0];
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '') this.cookieJar.delete(name);
      else this.cookieJar.set(name, value);
    }
  }

  async fetchCsrfToken() {
    const base = joinBase(this.url, this.basePath);
    try {
      const headers = { Accept: 'application/json' };
      if (this.cookieJar.size) headers.Cookie = this.cookieHeaderValue();
      const response = await fetch(`${base}/csrf-token`, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      this.absorbCookies(response);
      if (!response.ok) return '';
      const parsed = JSON.parse(await response.text());
      return typeof parsed?.obj === 'string' ? parsed.obj : '';
    } catch {
      return '';
    }
  }

  get apiRoot() {
    return `${joinBase(this.url, this.basePath)}/panel/`;
  }

  async health() {
    return this.request('GET', 'api/server/status');
  }

  async listInbounds() {
    return this.request('GET', 'api/inbounds/list');
  }

  async panelSettings() {
    return this.request('POST', 'api/setting/all');
  }

  async listClients() {
    return this.request('GET', 'api/clients/list');
  }

  async getClientRaw(email) {
    return this.request('GET', `api/clients/get/${encodeURIComponent(email)}`);
  }

  async getClientTraffic(email) {
    return this.request('GET', `api/clients/traffic/${encodeURIComponent(email)}`);
  }

  async createClient({ client, inboundIds }) {
    return this.request('POST', 'api/clients/add', { body: { client, inboundIds } });
  }

  async updateClient(email, patch) {
    return this.request('POST', `api/clients/update/${encodeURIComponent(email)}`, { body: patch });
  }

  async subLinks(subId) {
    return this.request('GET', `api/clients/subLinks/${encodeURIComponent(subId)}`);
  }

  async getClient(email) {
    try {
      const payload = await this.getClientRaw(email);
      if (!payload || !payload.client) return null;
      return normalizeClient(payload.client, payload.inboundIds, payload.usedTraffic);
    } catch (err) {
      if (!(err instanceof XuiError)) throw err;
      // 面板用 200 + success:false 表示记录不存在，单条查询无法区分，退回列表精确匹配。
      const clients = await this.listClients();
      const found = (clients || []).find((row) => String(row.email).toLowerCase() === String(email).toLowerCase());
      if (!found) return null;
      return normalizeClient(found, found.inboundIds, (found.traffic?.up || 0) + (found.traffic?.down || 0));
    }
  }

  async request(method, path, { body, form, retryAuth = true } = {}) {
    await this.ensureAuth();
    const url = this.apiRoot + path;
    const headers = { Accept: 'application/json' };
    let payload;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(form).toString();
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (this.apiToken) headers.Authorization = `Bearer ${this.apiToken}`;
    else if (this.cookieJar.size) {
      headers.Cookie = this.cookieHeaderValue();
      if (method !== 'GET' && method !== 'HEAD' && this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
    }

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: payload,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new XuiError(`连接面板超时：${url}`);
      }
      throw new XuiError(`无法连接面板（${url}）：${err.message}`);
    }

    if (response.status >= 300 && response.status < 400) {
      if (retryAuth && !this.apiToken) {
        await this.login();
        return this.request(method, path, { body, form, retryAuth: false });
      }
      throw new XuiError(`面板返回重定向（${url}）：请检查面板地址、基础路径与登录状态`, { status: response.status });
    }
    if (response.status === 401 || response.status === 403) {
      if (!this.apiToken && retryAuth) {
        if (response.status === 403) {
          // 会话 CSRF 失效：先刷新 token 重试一次，仍失败再重新登录
          const fresh = await this.fetchCsrfToken();
          if (fresh && fresh !== this.csrfToken) {
            this.csrfToken = fresh;
            return this.request(method, path, { body, form, retryAuth: false });
          }
        }
        await this.login();
        return this.request(method, path, { body, form, retryAuth: false });
      }
      throw new XuiError(
        this.apiToken
          ? '面板认证失败：请检查 API Token 是否有效且为 admin scope'
          : '面板认证失败：请检查面板账号密码及权限（若账号开启了两步验证 2FA，请改用 API Token）',
        { status: response.status },
      );
    }

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      throw new XuiError(`面板返回了非 JSON 响应（HTTP ${response.status}）：${url}`, { status: response.status });
    }
    if (response.status >= 400) {
      const detail = parsed?.msg ? `${parsed.msg} ` : '';
      throw new XuiError(`${detail}面板请求失败（HTTP ${response.status}，地址：${url}）`, { status: response.status });
    }
    if (parsed && parsed.success === false) {
      throw new XuiError(parsed.msg || '面板操作失败');
    }
    return parsed?.obj ?? null;
  }

  async ensureAuth() {
    if (this.apiToken) return;
    if (this.cookieJar.size) {
      // 已有会话：补一次 CSRF（旧版面板没有该接口时返回空，仅用 Cookie 也能工作）
      if (!this.csrfToken) this.csrfToken = await this.fetchCsrfToken();
      return;
    }
    if (!this.username) {
      throw new XuiError('未配置面板 API Token，也无法使用面板账号密码登录');
    }
    await this.login();
  }

  async login() {
    const base = joinBase(this.url, this.basePath);
    this.cookieJar.clear();
    this.csrfToken = await this.fetchCsrfToken();

    const postLogin = async () => {
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
      if (this.cookieJar.size) headers.Cookie = this.cookieHeaderValue();
      let response;
      try {
        response = await fetch(`${base}/login`, {
          method: 'POST',
          headers,
          body: new URLSearchParams({ username: this.username, password: this.password }).toString(),
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        throw new XuiError(`无法连接面板登录接口：${err.message}`);
      }
      this.absorbCookies(response);
      return response;
    };

    let response = await postLogin();
    if (response.status === 403) {
      // 旧 CSRF（或匿名会话）失效：重新取一次再登录
      this.csrfToken = await this.fetchCsrfToken();
      response = await postLogin();
    }

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (parsed && parsed.success === false) {
      const message = String(parsed.msg || '面板登录失败');
      if (/2fa|two.factor/i.test(message)) {
        throw new XuiError('该面板账号启用了两步验证（2FA），无法用账号密码连接；请改用 API Token（面板「设置 → 安全设定 → API 令牌」）。');
      }
      throw new XuiError(message);
    }
    if (response.status === 403) {
      throw new XuiError('面板登录被拒（CSRF 校验失败），请确认面板地址 / basePath 正确');
    }
    if (!this.cookieJar.size) {
      throw new XuiError('面板登录失败：未获得会话 Cookie（账号密码错误，或该账号启用了 2FA；2FA 账号请改用 API Token）');
    }
    // 登录会重置会话（CSRF 一并失效），重新取一次给后续写请求用
    this.csrfToken = await this.fetchCsrfToken();
    this.logger?.debug('面板登录成功（账号密码模式）');
  }
}

export function normalizeClient(record, inboundIds, usedTraffic) {
  if (!record) return null;
  const traffic = record.traffic;
  return {
    email: record.email,
    subId: record.subId || '',
    totalBytes: Number(record.totalGB || 0),
    expiryMs: Number(record.expiryTime || 0),
    enable: record.enable !== false,
    limitIp: Number(record.limitIp || 0),
    limitHwid: Number(record.limitHwid || 0),
    inboundIds: Array.isArray(inboundIds) ? inboundIds : [],
    usedBytes: Number(usedTraffic ?? ((traffic?.up || 0) + (traffic?.down || 0))) || 0,
    comment: record.comment || '',
  };
}
