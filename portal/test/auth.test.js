import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { startTestApp, expectOk, expectError } from './helpers.js';

describe('认证', () => {
  let app;
  let admin;

  before(async () => {
    app = await startTestApp();
    admin = app.client;
  });

  after(async () => {
    await app.close();
  });

  it('注册后自动登录并能访问 /api/me', async () => {
    const client = app.client;
    const data = expectOk(await client.post('/api/auth/register', { username: 'alice', password: 'password123', email: 'alice@example.com' }));
    assert.equal(data.user.username, 'alice');
    assert.equal(data.user.role, 'user');
    assert.equal(data.user.balanceCents, 0);
    assert.ok(data.csrfToken.length > 10);

    const me = expectOk(await client.get('/api/me'), '/api/me');
    assert.equal(me.user.username, 'alice');
    assert.equal(me.user.email, 'alice@example.com');
    assert.equal(me.csrfToken, data.csrfToken);
    assert.equal(me.live.available, true);
    assert.equal(me.live.enabled, false);
    assert.deepEqual(me.recentOrders, []);
  });

  it('用户名重复返回 username_taken', async () => {
    const client = app.client;
    client.clearCookies();
    expectError(await client.post('/api/auth/register', { username: 'Alice', password: 'password123' }), 'username_taken', '重复用户名');
  });

  it('弱密码返回 validation_error', async () => {
    const client = app.client;
    client.clearCookies();
    expectError(await client.post('/api/auth/register', { username: 'bobby', password: 'short' }), 'validation_error', '弱密码');
  });

  it('错误密码返回 invalid_credentials，登录成功后可访问', async () => {
    const client = app.client;
    client.clearCookies();
    expectError(await client.post('/api/auth/login', { username: 'alice', password: 'wrong-password' }), 'invalid_credentials', '错误密码');
    const data = await client.login('alice', 'password123');
    assert.equal(data.user.username, 'alice');
    expectOk(await client.get('/api/me'), '登录后 /api/me');
  });

  it('缺少 CSRF 头的写请求被拒绝', async () => {
    const client = app.client;
    client.clearCookies();
    await client.login('alice', 'password123');
    const token = client.csrfToken;
    client.setCsrfToken('');
    expectError(await client.post('/api/me/password', { currentPassword: 'password123', newPassword: 'password456' }), 'csrf_invalid', '缺 CSRF');
    client.setCsrfToken(token);
  });

  it('跨站 Origin 的写请求被拒绝，同站 Origin 放行', async () => {
    const client = app.client;
    client.clearCookies();
    await client.login('alice', 'password123');
    const crossed = await client.request('POST', '/api/me/password', {
      body: { currentPassword: 'password123', newPassword: 'password456' },
      headers: { Origin: 'https://evil.example.com' },
    });
    expectError(crossed, 'forbidden', '跨站 Origin');
    const sameSite = await client.request('POST', '/api/me/password', {
      body: { currentPassword: 'password123', newPassword: 'password789' },
      headers: { Origin: app.baseUrl },
    });
    expectOk(sameSite, '同站 Origin');
    client.clearCookies();
    await client.login('alice', 'password789');
    expectOk(await client.post('/api/me/password', { currentPassword: 'password789', newPassword: 'password123' }), '还原密码');
  });

  it('修改密码后旧密码失效、新密码可登录', async () => {
    const client = app.client;
    client.clearCookies();
    await client.login('alice', 'password123');
    expectOk(await client.post('/api/me/password', { currentPassword: 'password123', newPassword: 'password456' }));
    client.clearCookies();
    expectError(await client.post('/api/auth/login', { username: 'alice', password: 'password123' }), 'invalid_credentials', '旧密码');
    const data = await client.login('alice', 'password456');
    assert.equal(data.user.username, 'alice');
  });

  it('管理员禁用账号后无法登录', async () => {
    const userClient = app.client;
    userClient.clearCookies();
    const registered = await userClient.register('carol', 'password123');
    const userId = registered.user.id;
    await userClient.post('/api/auth/logout');

    const adminData = await admin.adminLogin();
    expectOk(await admin.post(`/api/admin/users/${userId}/status`, { status: 'disabled' }), '禁用用户');
    expectError(await userClient.post('/api/auth/login', { username: 'carol', password: 'password123' }), 'account_disabled', '禁用后登录');

    expectOk(await admin.post(`/api/admin/users/${userId}/status`, { status: 'active' }), '恢复用户');
    const back = await userClient.login('carol', 'password123');
    assert.equal(back.user.status, 'active');
    assert.ok(adminData.user.role === 'admin' || adminData.user.username === 'admin');
  });

  it('登出后会话失效', async () => {
    const client = app.client;
    client.clearCookies();
    await client.login('alice', 'password456');
    expectOk(await client.post('/api/auth/logout'));
    expectError(await client.get('/api/me'), 'unauthorized', '登出后访问');
  });
});
