import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { XuiMock } from '../src/integrations/xui-mock.js';
import { startTestApp, createClient, expectOk, expectError } from './helpers.js';

describe('管理后台', () => {
  let app;
  let xui;
  let admin;
  let user;
  let userId;
  let adminId;

  before(async () => {
    xui = new XuiMock();
    app = await startTestApp({ xuiMock: xui });
    admin = createClient(app.baseUrl);
    await admin.adminLogin();
    adminId = expectOk(await admin.get('/api/me'), '管理员会话').user.id;
    user = createClient(app.baseUrl);
    const registered = await user.register('admin-target', 'password123');
    userId = registered.user.id;
  });

  after(async () => {
    await app.close();
  });

  it('普通用户访问管理接口返回 forbidden', async () => {
    expectError(await user.get('/api/admin/overview'), 'forbidden', '概览');
    expectError(await user.get('/api/admin/users'), 'forbidden', '用户列表');
    expectError(await user.post('/api/admin/plans', { name: 'x' }), 'forbidden', '创建套餐');
  });

  it('概览返回用户 / 套餐 / 订单 / 收入统计', async () => {
    const data = expectOk(await admin.get('/api/admin/overview'), '概览');
    assert.equal(data.users.total, 2);
    assert.equal(data.users.active, 2);
    assert.equal(data.plans.total, 1);
    assert.equal(data.plans.enabled, 1);
    assert.equal(data.orders.total, 0);
    assert.equal(data.revenue.totalCents, 0);
    assert.equal(typeof data.recharges.totalCents, 'number');
  });

  it('用户列表支持搜索与详情（含实时 3x-ui 状态）', async () => {
    const list = expectOk(await admin.get('/api/admin/users?query=admin-target'));
    assert.equal(list.total, 1);
    assert.equal(list.items[0].username, 'admin-target');
    assert.equal(list.items[0].password, undefined, '不得返回密码哈希');

    const detail = expectOk(await admin.get(`/api/admin/users/${userId}`));
    assert.equal(detail.user.id, userId);
    assert.equal(detail.live.available, true);
    assert.deepEqual(detail.orders, []);

    expectError(await admin.get('/api/admin/users/999999'), 'user_not_found', '不存在的用户');
  });

  it('调整余额、禁用/启用、重置密码', async () => {
    const updated = expectOk(await admin.post(`/api/admin/users/${userId}/balance`, { deltaCents: 12345 }));
    assert.equal(updated.balanceCents, 12345);

    expectOk(await admin.post(`/api/admin/users/${userId}/status`, { status: 'disabled' }));
    expectError(await user.get('/api/me'), 'unauthorized', '禁用后旧会话失效');
    expectError(await user.post('/api/auth/login', { username: 'admin-target', password: 'password123' }), 'account_disabled');

    expectOk(await admin.post(`/api/admin/users/${userId}/status`, { status: 'active' }));
    expectOk(await admin.post(`/api/admin/users/${userId}/reset-password`, { newPassword: 'newpassword1' }));
    user.clearCookies();
    const loggedIn = await user.login('admin-target', 'newpassword1');
    assert.equal(loggedIn.user.id, userId);

    expectError(await admin.post(`/api/admin/users/${userId}/balance`, { deltaCents: -999999 }), 'validation_error', '余额不能为负');
  });

  it('套餐增删改查与字段校验', async () => {
    const created = expectOk(
      await admin.post('/api/admin/plans', {
        name: '月付套餐',
        description: '测试套餐',
        priceCents: 1000,
        days: 30,
        trafficGb: 100,
        deviceLimit: 2,
        inboundIds: [1],
        enabled: true,
      }),
      '创建套餐',
    );
    assert.equal(created.name, '月付套餐');
    assert.equal(created.trafficBytes, 100 * 1024 * 1024 * 1024);
    assert.deepEqual(created.inboundIds, [1]);

    const updated = expectOk(await admin.put(`/api/admin/plans/${created.id}`, { priceCents: 2000 }));
    assert.equal(updated.priceCents, 2000);
    assert.equal(updated.days, 30, '未提供的字段保持不变');

    expectError(await admin.post('/api/admin/plans', { name: '错误套餐', priceCents: 100, days: 0 }), 'validation_error', '无效天数');

    const listed = expectOk(await admin.get('/api/admin/plans'));
    assert.ok(listed.items.some((plan) => plan.id === created.id));

    const removed = expectOk(await admin.delete(`/api/admin/plans/${created.id}`));
    assert.equal(removed.ok, true);
    const after = expectOk(await admin.get('/api/admin/plans'));
    assert.ok(!after.items.some((plan) => plan.id === created.id));
  });

  it('人工转账订单：管理员确认后自动开通 3x-ui 客户端', async () => {
    const manualUser = createClient(app.baseUrl);
    const registered = await manualUser.register('manual-user', 'password123');
    const created = expectOk(await manualUser.post('/api/me/purchase', { planId: 1, method: 'online', provider: 'manual' }));
    assert.equal(created.payment.type, 'manual');
    assert.ok(created.payment.instructions.length > 0);
    assert.equal(created.order.status, 'pending');

    const orderId = created.order.id;
    const paid = expectOk(await admin.post(`/api/admin/orders/${orderId}/mark-paid`, {}), '标记已支付');
    assert.equal(paid.status, 'provisioned');
    assert.ok(xui.clients.get(`u${registered.user.id}@portal`));

    const detail = expectOk(await admin.get(`/api/admin/orders/${orderId}`));
    assert.equal(detail.status, 'provisioned');
    const clientRecord = xui.clients.get(`u${registered.user.id}@portal`);
    const expiry = clientRecord.expiryTime;
    const repeated = expectOk(await admin.post(`/api/admin/orders/${orderId}/mark-paid`, {}), '重复标记应幂等');
    assert.equal(repeated.status, 'provisioned');
    assert.equal(xui.clients.get(`u${registered.user.id}@portal`).expiryTime, expiry, '重复标记不得重复开通');
  });

  it('取消待支付订单，已取消订单不可支付', async () => {
    const cancelUser = createClient(app.baseUrl);
    await cancelUser.register('cancel-user', 'password123');
    const created = expectOk(await cancelUser.post('/api/me/purchase', { planId: 1, method: 'online', provider: 'mock' }));
    const cancelled = expectOk(await admin.post(`/api/admin/orders/${created.order.id}/cancel`, {}));
    assert.equal(cancelled.status, 'cancelled');
    expectError(await cancelUser.post(`/api/me/payments/${created.order.orderNo}/mock-complete`), 'invalid_status');
  });

  it('被订单引用的套餐删除时只下架', async () => {
    const plan = expectOk(
      await admin.post('/api/admin/plans', { name: '引用的套餐', priceCents: 500, days: 7, trafficGb: 10, deviceLimit: 1 }),
    );
    const planUser = createClient(app.baseUrl);
    await planUser.register('plan-user', 'password123');
    expectOk(await planUser.post('/api/me/purchase', { planId: plan.id, method: 'online', provider: 'manual' }));

    const removed = expectOk(await admin.delete(`/api/admin/plans/${plan.id}`));
    assert.equal(removed.disabled, true);
    const plans = expectOk(await admin.get('/api/admin/plans'));
    const stored = plans.items.find((item) => item.id === plan.id);
    assert.ok(stored, '套餐应保留');
    assert.equal(stored.enabled, false, '套餐应被下架');
  });

  it('系统设置读写、密钥脱敏与未知键校验', async () => {
    const before = expectOk(await admin.get('/api/admin/settings'));
    assert.ok(before.items.some((item) => item.key === 'portal.name'));

    const updated = expectOk(
      await admin.put('/api/admin/settings', { 'portal.name': '我的云用户中心', 'portal.currency': 'USD', 'xui.apiToken': 'super-secret-token' }),
    );
    assert.equal(updated.items.find((item) => item.key === 'portal.name').value, '我的云用户中心');
    assert.equal(updated.items.find((item) => item.key === 'portal.currency').value, 'USD');

    const publicConfig = expectOk(await admin.get('/api/config'));
    assert.equal(publicConfig.currency, 'USD');
    const tokenItem = updated.items.find((item) => item.key === 'xui.apiToken');
    assert.equal(tokenItem.value, '', '密钥不得回传明文');
    assert.equal(tokenItem.hasValue, true);

    const cleared = expectOk(await admin.put('/api/admin/settings', { 'xui.apiToken': '' }));
    assert.equal(cleared.items.find((item) => item.key === 'xui.apiToken').hasValue, false);

    const rechargeLimits = expectOk(
      await admin.put('/api/admin/settings', { 'portal.minRechargeCents': '500', 'portal.maxRechargeCents': '200000' }),
    );
    assert.equal(rechargeLimits.items.find((item) => item.key === 'portal.minRechargeCents').value, '500');
    const rechargeConfig = expectOk(await admin.get('/api/config'));
    assert.equal(rechargeConfig.minRechargeCents, 500);
    assert.equal(rechargeConfig.maxRechargeCents, 200000);

    expectError(await admin.put('/api/admin/settings', { 'unknown.key': 'x' }), 'validation_error');
    expectError(await admin.put('/api/admin/settings', { 'portal.currency': 'x'.repeat(5000) }), 'validation_error', '超长值');
  });

  it('测试 3x-ui 连接返回入站与订阅信息', async () => {
    const data = expectOk(await admin.post('/api/admin/settings/test-xui', {}), '测试连接');
    assert.equal(data.ok, true);
    assert.equal(data.inboundCount, 1);
    assert.equal(data.inbounds[0].id, 1);
    assert.equal(data.inbounds[0].protocol, 'vless');
    assert.equal(data.subscription.subURI, 'https://sub.example.com/sub/');
  });

  it('订单列表支持按类型筛选与关键字搜索', async () => {
    const all = expectOk(await admin.get('/api/admin/orders'));
    assert.ok(all.total >= 3);
    const recharges = expectOk(await admin.get('/api/admin/orders?kind=recharge'));
    assert.ok(recharges.items.every((order) => order.kind === 'recharge'));
    const search = expectOk(await admin.get('/api/admin/orders?query=manual-user'));
    assert.ok(search.items.length >= 1);
    assert.ok(search.items.every((order) => order.username === 'manual-user'));
  });

  it('新增管理员：可登录后台，重复用户名与弱密码被拒绝', async () => {
    const created = expectOk(await admin.post('/api/admin/admins', { username: 'ops-admin', password: 'ops-password1' }));
    assert.equal(created.role, 'admin');
    assert.equal(created.status, 'active');
    assert.equal(created.isSelf, false);

    const ops = createClient(app.baseUrl);
    const logged = await ops.login('ops-admin', 'ops-password1');
    assert.equal(logged.user.role, 'admin');
    expectOk(await ops.get('/api/admin/overview'), '新管理员访问后台');

    expectError(
      await admin.post('/api/admin/admins', { username: 'ops-admin', password: 'ops-password1' }),
      'username_taken',
    );
    expectError(await admin.post('/api/admin/admins', { username: 'weak-admin', password: 'short' }), 'validation_error', '弱密码');

    const list = expectOk(await admin.get('/api/admin/admins'));
    assert.ok(list.items.some((item) => item.username === 'ops-admin'));
    assert.ok(list.items.some((item) => item.id === adminId && item.isSelf === true));
  });

  it('管理员禁用/启用：立即踢下线，不能操作当前登录账号', async () => {
    const list = expectOk(await admin.get('/api/admin/admins'));
    const ops = list.items.find((item) => item.username === 'ops-admin');
    assert.ok(ops);
    const opsClient = createClient(app.baseUrl);
    await opsClient.login('ops-admin', 'ops-password1');
    expectOk(await opsClient.get('/api/admin/overview'));

    expectError(await admin.post(`/api/admin/admins/${adminId}/status`, { status: 'disabled' }), 'validation_error', '不能禁用自己');

    expectOk(await admin.post(`/api/admin/admins/${ops.id}/status`, { status: 'disabled' }));
    expectError(await opsClient.get('/api/admin/overview'), 'unauthorized', '禁用后旧会话失效');
    expectError(await opsClient.post('/api/auth/login', { username: 'ops-admin', password: 'ops-password1' }), 'account_disabled');

    expectOk(await admin.post(`/api/admin/admins/${ops.id}/status`, { status: 'active' }));
    const relogged = await opsClient.login('ops-admin', 'ops-password1');
    assert.equal(relogged.user.role, 'admin');
  });

  it('删除管理员：不能删除自己，删除后无法登录', async () => {
    expectError(await admin.delete(`/api/admin/admins/${adminId}`), 'validation_error', '不能删除自己');

    const list = expectOk(await admin.get('/api/admin/admins'));
    const ops = list.items.find((item) => item.username === 'ops-admin');
    expectOk(await admin.delete(`/api/admin/admins/${ops.id}`));
    expectError(await admin.delete(`/api/admin/admins/${ops.id}`), 'admin_not_found', '重复删除');

    const gone = createClient(app.baseUrl);
    expectError(await gone.post('/api/auth/login', { username: 'ops-admin', password: 'ops-password1' }), 'invalid_credentials');
  });

  it('封禁用户：立即踢下线、无法登录且可解封', async () => {
    const banClient = createClient(app.baseUrl);
    const registered = await banClient.register('ban-target', 'password123');
    expectOk(await banClient.get('/api/me'));

    expectOk(await admin.post(`/api/admin/users/${registered.user.id}/status`, { status: 'banned' }));
    expectError(await banClient.get('/api/me'), 'unauthorized', '封禁后旧会话失效');
    expectError(
      await banClient.post('/api/auth/login', { username: 'ban-target', password: 'password123' }),
      'account_banned',
    );

    const banned = expectOk(await admin.get('/api/admin/users?status=banned'));
    assert.ok(banned.items.some((item) => item.username === 'ban-target'));

    expectError(
      await admin.post('/api/admin/users/999999/status', { status: 'banned' }),
      'user_not_found',
      '用户不存在',
    );

    expectOk(await admin.post(`/api/admin/users/${registered.user.id}/status`, { status: 'active' }));
    const relogged = await banClient.login('ban-target', 'password123');
    assert.equal(relogged.user.id, registered.user.id);
  });

  it('管理员账号不能通过用户接口封禁', async () => {
    expectError(await admin.post(`/api/admin/users/${adminId}/status`, { status: 'banned' }), 'validation_error');
  });

  it('版本更新接口：普通用户不可用，本地部署不提供一键更新', async () => {
    expectError(await user.get('/api/admin/update'), 'forbidden', '普通用户读取更新状态');

    const status = expectOk(await admin.get('/api/admin/update'));
    assert.equal(status.currentVersion, '1.0.0');
    assert.equal(status.canApply, false, '测试环境非 systemd 部署');
    assert.equal(status.pending, false);
    assert.equal(typeof status.deployMode, 'string');

    expectError(await admin.post('/api/admin/update/check', {}), 'update_unavailable');
    expectError(await admin.post('/api/admin/update/apply', {}), 'update_unavailable');
  });
});
