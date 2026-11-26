import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';

const ROOT = path.resolve(import.meta.dirname, '..');

export function buildConfig(overrides = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'portal-test-'));
  const config = {
    rootDir: ROOT,
    publicDir: path.join(ROOT, 'public'),
    dataDir: dir,
    dbPath: path.join(dir, 'portal.db'),
    host: '127.0.0.1',
    port: 0,
    secret: 'test-secret-0123456789abcdef',
    publicUrl: 'https://portal.test',
    trustProxy: false,
    logLevel: 'error',
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    seed: {
      adminUsername: 'admin',
      adminPassword: 'admin12345',
      xui: {
        mode: 'real',
        url: 'http://127.0.0.1:9',
        basePath: '/',
        apiToken: '',
        username: '',
        password: '',
        timeoutMs: 1500,
      },
      payment: {
        providers: 'mock,manual,epay',
        mockAutoComplete: false,
        epay: { url: '', pid: '', key: '', type: 'alipay' },
      },
    },
  };
  if (overrides.seed) config.seed = { ...config.seed, ...overrides.seed };
  return { config, dir };
}

export async function startTestApp({ xuiMock = null, seed = {} } = {}) {
  const { config, dir } = buildConfig({ seed });
  const app = createApp({ config, logger: createLogger('error'), xuiMock });
  const address = await app.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    app,
    baseUrl,
    config,
    dir,
    store: app.store,
    client: createClient(baseUrl),
    async close() {
      await app.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows 上 WAL 句柄可能延迟释放，测试目录残留不影响结果。
      }
    },
  };
}

export function createClient(baseUrl) {
  const cookies = new Map();
  let csrf = '';

  function cookieHeader() {
    return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  function absorbCookies(response) {
    const list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const raw of list) {
      const pair = String(raw).split(';')[0];
      const index = pair.indexOf('=');
      if (index < 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '') cookies.delete(name);
      else cookies.set(name, value);
    }
  }

  async function request(method, apiPath, { body, form, headers = {}, skipCsrf = false } = {}) {
    const options = { method, headers: { ...headers }, redirect: 'manual' };
    if (cookies.size) options.headers.Cookie = cookieHeader();
    if (method !== 'GET' && method !== 'HEAD' && options.headers.Origin === undefined) options.headers.Origin = baseUrl;
    if (!skipCsrf && csrf && method !== 'GET' && method !== 'HEAD') options.headers['X-CSRF-Token'] = csrf;
    if (form) {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.body = new URLSearchParams(form).toString();
    } else if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`${baseUrl}${apiPath}`, options);
    absorbCookies(response);
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (json?.ok && json.data && typeof json.data === 'object' && typeof json.data.csrfToken === 'string') {
      csrf = json.data.csrfToken;
    } else if (json?.ok && json.data && typeof json.data === 'object' && typeof json.data.user?.csrfToken === 'string') {
      csrf = json.data.user.csrfToken;
    }
    return { status: response.status, json, text, headers: response.headers };
  }

  return {
    request,
    get: (apiPath, options) => request('GET', apiPath, options),
    post: (apiPath, body, options) => request('POST', apiPath, { body, ...options }),
    put: (apiPath, body, options) => request('PUT', apiPath, { body, ...options }),
    delete: (apiPath, options) => request('DELETE', apiPath, options),
    get csrfToken() {
      return csrf;
    },
    setCsrfToken(value) {
      csrf = value;
    },
    clearCookies() {
      cookies.clear();
      csrf = '';
    },
    async login(username, password) {
      const response = await request('POST', '/api/auth/login', { body: { username, password } });
      if (!response.json?.ok) throw new Error(`登录失败：${response.text}`);
      return response.json.data;
    },
    async captcha() {
      const response = await request('GET', '/api/auth/captcha');
      if (!response.json?.ok) throw new Error(`获取验证码失败：${response.text}`);
      const { captchaId, question } = response.json.data;
      const match = String(question).match(/(\d+)\s*([+-])\s*(\d+)/);
      if (!match) throw new Error(`无法解析验证码题目：${question}`);
      const captchaAnswer = String(match[2] === '+' ? Number(match[1]) + Number(match[3]) : Number(match[1]) - Number(match[3]));
      return { captchaId, question, captchaAnswer };
    },
    async register(username, password, email = '', inviteCode = '') {
      const captcha = await this.captcha();
      const body = { username, password, email, captchaId: captcha.captchaId, captchaAnswer: captcha.captchaAnswer };
      if (inviteCode) body.inviteCode = inviteCode;
      const response = await request('POST', '/api/auth/register', { body });
      if (!response.json?.ok) throw new Error(`注册失败：${response.text}`);
      return response.json.data;
    },
    async adminLogin() {
      return this.login('admin', 'admin12345');
    },
  };
}

export function expectOk(response, label = '') {
  if (!response.json?.ok) {
    throw new Error(`${label} 期望成功，实际：HTTP ${response.status} ${response.text}`);
  }
  return response.json.data;
}

export function expectError(response, code, label = '') {
  if (response.json?.ok) {
    throw new Error(`${label} 期望失败（${code}），实际成功：${response.text}`);
  }
  if (response.json?.error?.code !== code) {
    throw new Error(`${label} 期望错误码 ${code}，实际 ${response.json?.error?.code}：${response.text}`);
  }
  return response.json.error;
}

export function isoNow() {
  return Date.now();
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const GB = 1024 * 1024 * 1024;
