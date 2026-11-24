import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

import { startTestApp, createClient, expectError } from './helpers.js';
import { listAccounts, resetPasswordByUsername } from '../src/services/password-reset.js';

describe('命令行重置密码', () => {
  let app;

  before(async () => {
    app = await startTestApp();
  });

  after(async () => {
    await app.close();
  });

  it('按用户名重置密码：旧密码失效、旧会话下线、新密码可登录', async () => {
    const client = createClient(app.baseUrl);
    await client.register('cli-user', 'password123');
    await client.get('/api/me');

    const account = resetPasswordByUsername(app.store, 'cli-user', 'newpassword1');
    assert.equal(account.username, 'cli-user');
    assert.equal(account.role, 'user');

    expectError(await client.get('/api/me'), 'unauthorized', '旧会话应失效');
    expectError(
      await client.post('/api/auth/login', { username: 'cli-user', password: 'password123' }),
      'invalid_credentials',
      '旧密码应失效',
    );
    const relogged = await client.login('cli-user', 'newpassword1');
    assert.equal(relogged.user.username, 'cli-user');
  });

  it('支持重置管理员密码并列出账号', async () => {
    const admins = listAccounts(app.store, { role: 'admin' });
    assert.ok(admins.length >= 1);
    const admin = admins[0];

    const result = resetPasswordByUsername(app.store, admin.username, 'admin-newpass1');
    assert.equal(result.role, 'admin');

    const adminClient = createClient(app.baseUrl);
    const logged = await adminClient.login(admin.username, 'admin-newpass1');
    assert.equal(logged.user.role, 'admin');

    const all = listAccounts(app.store);
    assert.ok(all.some((item) => item.username === 'cli-user'));
  });

  it('未知账号、空用户名与不合规密码都会被拒绝', () => {
    assert.throws(
      () => resetPasswordByUsername(app.store, 'nobody', 'password123'),
      (err) => err.code === 'user_not_found',
    );
    assert.throws(
      () => resetPasswordByUsername(app.store, '', 'password123'),
      (err) => err.code === 'validation_error',
    );
    assert.throws(
      () => resetPasswordByUsername(app.store, 'cli-user', 'short'),
      (err) => err.code === 'validation_error',
    );
  });
});
