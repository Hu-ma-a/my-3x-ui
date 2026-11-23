import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

import { XuiClient, XuiError } from '../src/integrations/xui-client.js';

function startFakePanel(options = {}) {
  const state = {
    requests: [],
    loginCalls: 0,
    rejectedOnce: false,
    csrf: 'csrf-initial',
    authenticated: false,
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = '';
    for await (const chunk of req) body += chunk;
    state.requests.push({ method: req.method, path: url.pathname, headers: req.headers, body });

    const send = (status, payload, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(payload));
    };

    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));

    // 模拟新版 3x-ui：CSRF 保护的登录 + 会话 API（POST 必须带 X-CSRF-Token）
    if (options.csrfAuth) {
      if (url.pathname === '/csrf-token') {
        const headers = {};
        if (!req.headers.cookie) headers['Set-Cookie'] = '3x-ui=anon; Path=/; HttpOnly';
        send(200, { success: true, obj: state.csrf }, headers);
        return;
      }
      if (url.pathname === '/login') {
        state.loginCalls += 1;
        if (req.headers['x-csrf-token'] !== state.csrf) {
          res.writeHead(403);
          res.end('{}');
          return;
        }
        state.csrf = 'csrf-after-login';
        state.authenticated = true;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': '3x-ui=session-ok; Path=/; HttpOnly' });
        res.end(JSON.stringify({ success: true }));
        return;
      }
      if (url.pathname.startsWith('/panel/api/')) {
        const cookie = req.headers.cookie || '';
        if (!cookie.includes('3x-ui=session-ok')) {
          res.writeHead(401);
          res.end('{}');
          return;
        }
        if (req.method !== 'GET' && req.headers['x-csrf-token'] !== state.csrf) {
          res.writeHead(403);
          res.end('{}');
          return;
        }
      }
    }

    if (url.pathname === '/login') {
      state.loginCalls += 1;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': '3x-ui=session-ok; Path=/; HttpOnly' });
      res.end(JSON.stringify({ success: true }));
      return;
    }
    if (options.always401) {
      res.writeHead(401);
      res.end('unauthorized');
      return;
    }
    if (options.cookieAuth) {
      if (options.rejectFirstApi && !state.rejectedOnce && url.pathname.startsWith('/panel/api/')) {
        state.rejectedOnce = true;
        res.writeHead(302, { Location: '/login' });
        res.end();
        return;
      }
      const cookie = req.headers.cookie || '';
      if (!cookie.includes('3x-ui=session-ok')) {
        res.writeHead(302, { Location: '/login' });
        res.end();
        return;
      }
    }

    if (url.pathname === '/panel/api/inbounds/list') {
      send(200, {
        success: true,
        obj: [
          { id: 1, remark: 'fake-inbound', protocol: 'vless', enable: true },
          { id: 2, remark: 'disabled-inbound', protocol: 'trojan', enable: false },
        ],
      });
      return;
    }
    if (url.pathname === '/panel/api/setting/all' && req.method === 'POST') {
      send(200, { success: true, obj: { subURI: 'https://sub.test/sub/', subPath: '/sub/', subEnable: true } });
      return;
    }
    if (url.pathname.startsWith('/panel/api/clients/get/')) {
      const email = decodeURIComponent(url.pathname.slice('/panel/api/clients/get/'.length));
      if (email === 'exists@x') {
        send(200, {
          success: true,
          obj: {
            client: { email, totalGB: 1024 ** 3, expiryTime: 1800000000000, limitHwid: 2, subId: 'sub-1', enable: true },
            inboundIds: [1],
            usedTraffic: 1024,
          },
        });
        return;
      }
      send(200, { success: false, msg: 'record not found' });
      return;
    }
    if (url.pathname === '/panel/api/clients/list') {
      send(200, {
        success: true,
        obj: [
          {
            email: 'exists@x',
            totalGB: 1024 ** 3,
            expiryTime: 1800000000000,
            limitHwid: 2,
            subId: 'sub-1',
            enable: true,
            inboundIds: [1],
            traffic: { up: 600, down: 400 },
          },
        ],
      });
      return;
    }
    if (url.pathname === '/panel/api/clients/add') {
      const payload = JSON.parse(body || '{}');
      if (payload.client?.email === 'dup@x') {
        send(200, { success: false, msg: 'client already exists' });
        return;
      }
      send(200, { success: true, obj: { email: payload.client?.email } });
      return;
    }
    if (url.pathname.startsWith('/panel/api/clients/update/')) {
      send(200, { success: true, obj: { updated: true } });
      return;
    }
    if (url.pathname.startsWith('/panel/api/clients/subLinks/')) {
      send(200, { success: true, obj: ['vless://sub'] });
      return;
    }
    send(404, { success: false, msg: 'no route' });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        state,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

describe('3x-ui REST 客户端（Bearer Token 模式）', () => {
  let panel;
  let client;

  before(async () => {
    panel = await startFakePanel();
    client = new XuiClient({ url: panel.url, basePath: '/', apiToken: 'tok-123', timeoutMs: 2000 });
  });

  after(async () => {
    await panel.close();
  });

  it('入站列表请求带 Bearer Token', async () => {
    const inbounds = await client.listInbounds();
    assert.equal(inbounds.length, 2);
    const request = panel.state.requests.find((item) => item.path === '/panel/api/inbounds/list');
    assert.equal(request.headers.authorization, 'Bearer tok-123');
    assert.equal(request.method, 'GET');
  });

  it('客户端查询归一化字段与已用流量', async () => {
    const record = await client.getClient('exists@x');
    assert.equal(record.email, 'exists@x');
    assert.equal(record.totalBytes, 1024 ** 3);
    assert.equal(record.expiryMs, 1800000000000);
    assert.equal(record.usedBytes, 1024);
    assert.equal(record.limitHwid, 2);
    assert.equal(record.subId, 'sub-1');
  });

  it('单条查询返回记录不存在时回退列表匹配，真不存在返回 null', async () => {
    const record = await client.getClient('missing@x');
    assert.equal(record, null);
    const listRequest = panel.state.requests.find((item) => item.path === '/panel/api/clients/list');
    assert.ok(listRequest, '应回退到客户端列表');
  });

  it('创建客户端发送 3x-ui 需要的完整 payload', async () => {
    await client.createClient({
      client: {
        email: 'new@x',
        totalGB: 500 * 1024 ** 3,
        expiryTime: 1800000000000,
        limitHwid: 3,
        subId: 'sub-new',
        enable: true,
        comment: 'portal:demo',
        reset: 0,
        limitIp: 0,
      },
      inboundIds: [1, 2],
    });
    const request = panel.state.requests.filter((item) => item.path === '/panel/api/clients/add').pop();
    const payload = JSON.parse(request.body);
    assert.equal(payload.client.email, 'new@x');
    assert.equal(payload.client.totalGB, 500 * 1024 ** 3);
    assert.equal(payload.client.expiryTime, 1800000000000);
    assert.equal(payload.client.limitHwid, 3);
    assert.equal(payload.client.subId, 'sub-new');
    assert.equal(payload.client.comment, 'portal:demo');
    assert.deepEqual(payload.inboundIds, [1, 2]);
  });

  it('更新客户端对 email 做 URL 编码并发送增量字段', async () => {
    await client.updateClient('a b@x', { expiryTime: 123, totalGB: 456, limitHwid: 7, subId: 's-2', enable: true });
    const request = panel.state.requests.filter((item) => item.path.startsWith('/panel/api/clients/update/')).pop();
    assert.equal(request.path, '/panel/api/clients/update/a%20b%40x');
    const payload = JSON.parse(request.body);
    assert.equal(payload.expiryTime, 123);
    assert.equal(payload.totalGB, 456);
    assert.equal(payload.limitHwid, 7);
    assert.equal(payload.subId, 's-2');
    assert.equal(payload.enable, true);
  });

  it('订阅链接与面板设置读取正确', async () => {
    const links = await client.subLinks('sub-1');
    assert.deepEqual(links, ['vless://sub']);
    const settings = await client.panelSettings();
    assert.equal(settings.subURI, 'https://sub.test/sub/');
    const request = panel.state.requests.filter((item) => item.path === '/panel/api/setting/all').pop();
    assert.equal(request.method, 'POST');
  });

  it('面板业务失败（success:false）抛出 XuiError', async () => {
    await assert.rejects(
      () => client.createClient({ client: { email: 'dup@x', totalGB: 1, expiryTime: 1, limitHwid: 1, subId: 's' }, inboundIds: [1] }),
      (err) => err instanceof XuiError && err.message.includes('client already exists'),
    );
  });
});

describe('3x-ui REST 客户端（账号密码 + CSRF 模式）', () => {
  it('自动获取 CSRF、登录后写请求携带 X-CSRF-Token', async () => {
    const panel = await startFakePanel({ csrfAuth: true });
    try {
      const client = new XuiClient({ url: panel.url, apiToken: '', username: 'admin', password: 'secret', timeoutMs: 2000 });
      const inbounds = await client.listInbounds();
      assert.equal(inbounds.length, 2);
      assert.equal(panel.state.loginCalls, 1, '只登录一次');

      await client.createClient({
        client: { email: 'csrf-new@x', totalGB: 1, expiryTime: 1, limitHwid: 1, subId: 's' },
        inboundIds: [1],
      });
      const addRequest = panel.state.requests.filter((item) => item.path === '/panel/api/clients/add').pop();
      assert.equal(addRequest.headers['x-csrf-token'], 'csrf-after-login', '写请求应带登录后新的 CSRF token');
      assert.ok((addRequest.headers.cookie || '').includes('3x-ui=session-ok'));

      const loginRequest = panel.state.requests.find((item) => item.path === '/login');
      assert.equal(loginRequest.headers['x-csrf-token'], 'csrf-initial', '登录请求应带首次获取的 CSRF token');
    } finally {
      await panel.close();
    }
  });
});

describe('3x-ui REST 客户端（用户名密码模式与错误路径）', () => {
  it('自动登录，302 后重新登录并重试', async () => {
    const panel = await startFakePanel({ cookieAuth: true, rejectFirstApi: true });
    try {
      const client = new XuiClient({ url: panel.url, apiToken: '', username: 'admin', password: 'secret', timeoutMs: 2000 });
      const inbounds = await client.listInbounds();
      assert.equal(inbounds.length, 2);
      assert.equal(panel.state.loginCalls, 2, '首次登录 + 302 失效后重试登录');
      const loginRequest = panel.state.requests.find((item) => item.path === '/login');
      assert.equal(loginRequest.body, 'username=admin&password=secret');
    } finally {
      await panel.close();
    }
  });

  it('未配置凭据时给出明确错误', async () => {
    const client = new XuiClient({ url: 'http://127.0.0.1:9', apiToken: '', username: '', timeoutMs: 500 });
    await assert.rejects(() => client.listInbounds(), (err) => err instanceof XuiError && err.message.includes('未配置 3x-ui API Token'));
  });

  it('认证失败时报 token 权限问题', async () => {
    const panel = await startFakePanel({ always401: true });
    try {
      const client = new XuiClient({ url: panel.url, apiToken: 'bad-token', timeoutMs: 2000 });
      await assert.rejects(() => client.listInbounds(), (err) => err instanceof XuiError && err.message.includes('认证失败'));
    } finally {
      await panel.close();
    }
  });

  it('请求超时给出超时错误', async () => {
    const panel = await startFakePanel({ delayMs: 400 });
    try {
      const client = new XuiClient({ url: panel.url, apiToken: 'tok', timeoutMs: 100 });
      await assert.rejects(() => client.listInbounds(), (err) => err instanceof XuiError && err.message.includes('超时'));
    } finally {
      await panel.close();
    }
  });
});
