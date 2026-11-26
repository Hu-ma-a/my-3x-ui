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

  it('管理员新增用户，并自动分配唯一 UID', async () => {
    const created = expectOk(
      await admin.post('/api/admin/users', { username: 'created-user', password: 'password123', email: 'created@example.com' }),
      '新增用户',
    );
    assert.match(created.uid, /^U[A-Z0-9]{8}$/);
    assert.equal(created.role, 'user');
    assert.equal(created.status, 'active');

    const createdClient = createClient(app.baseUrl);
    const logged = await createdClient.login('created-user', 'password123');
    assert.equal(logged.user.uid, created.uid, '登录后返回同一 UID');

    const list = expectOk(await admin.get('/api/admin/users?query=created-user'));
    assert.equal(list.items[0].uid, created.uid);
    assert.equal(typeof list.items[0].uid, 'string');

    expectError(
      await admin.post('/api/admin/users', { username: 'created-user', password: 'password123' }),
      'username_taken',
      '重复用户名',
    );
    expectError(await admin.post('/api/admin/users', { username: 'weak-user', password: '123' }), 'validation_error', '弱密码');

    // 注册用户同样有 UID
    const registered = expectOk(await user.get('/api/me'));
    assert.match(registered.user.uid, /^U[A-Z0-9]{8}$/);
  });

  it('用户列表支持搜索与详情（含实时 3x-ui 状态）', async () => {
    const list = expectOk(await admin.get('/api/admin/users?query=admin-target'));
    assert.equal(list.total, 1);
    assert.equal(list.items[0].username, 'admin-target');
    assert.equal(list.items[0].password, undefined, '不得返回密码哈希');
    assert.equal(typeof list.items[0].lastLoginAt, 'number', '返回上次登录时间供状态提示使用');

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
        features: ['500 GB 流量额度', '30 天有效期'],
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
    assert.deepEqual(created.features, ['500 GB 流量额度', '30 天有效期']);
    assert.equal(created.periodLabel, '期', '未指定计费单位时默认为「期」');

    const updated = expectOk(
      await admin.put(`/api/admin/plans/${created.id}`, { priceCents: 2000, periodLabel: '月', features: ['自定义权益'] }),
    );
    assert.equal(updated.priceCents, 2000);
    assert.equal(updated.periodLabel, '月');
    assert.deepEqual(updated.features, ['自定义权益']);
    assert.equal(updated.days, 30, '未提供的字段保持不变');

    const publicPlans = expectOk(await admin.get('/api/plans'));
    assert.equal(publicPlans.plans.find((plan) => plan.id === created.id).periodLabel, '月');

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
    assert.ok(xui.clients.get('manual-user'));

    const detail = expectOk(await admin.get(`/api/admin/orders/${orderId}`));
    assert.equal(detail.status, 'provisioned');
    const clientRecord = xui.clients.get('manual-user');
    const expiry = clientRecord.expiryTime;
    const repeated = expectOk(await admin.post(`/api/admin/orders/${orderId}/mark-paid`, {}), '重复标记应幂等');
    assert.equal(repeated.status, 'provisioned');
    assert.equal(xui.clients.get('manual-user').expiryTime, expiry, '重复标记不得重复开通');
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

    const providers = expectOk(
      await admin.put('/api/admin/settings', { 'pay.providersEnabled': 'mock,manual' }),
    );
    assert.equal(providers.items.find((item) => item.key === 'pay.providersEnabled').value, 'mock,manual');
    const providerConfig = expectOk(await admin.get('/api/config'));
    assert.deepEqual(
      providerConfig.providers.map((provider) => provider.id),
      ['balance', 'mock', 'manual'],
    );
    expectError(
      await admin.put('/api/admin/settings', { 'pay.providersEnabled': 'mock,unknown' }),
      'validation_error',
      '未知支付方式',
    );

    expectError(await admin.put('/api/admin/settings', { 'unknown.key': 'x' }), 'validation_error');
    expectError(await admin.put('/api/admin/settings', { 'portal.currency': 'x'.repeat(5000) }), 'validation_error', '超长值');
  });

  it('测试面板连接返回入站与订阅信息', async () => {
    const data = expectOk(await admin.post('/api/admin/settings/test-xui', {}), '测试连接');
    assert.equal(data.ok, true);
    assert.equal(data.inboundCount, 1);
    assert.equal(data.inbounds[0].id, 1);
    assert.equal(data.inbounds[0].protocol, 'vless');
    assert.equal(data.subscription.subURI, 'https://sub.example.com/sub/');
    assert.equal(typeof data.apiLatencyMs, 'number');
    assert.ok('latencyMs' in data.inbounds[0], '入站应返回实时 TCP 延迟');
    assert.ok(['tcp', 'udp', 'unreachable'].includes(data.inbounds[0].latencyNote));
  });

  it('面板连接失败时返回具体原因，而不是笼统的内部错误', async () => {
    xui.setOffline(true);
    try {
      const error = expectError(await admin.post('/api/admin/settings/test-xui', {}), 'xui_connection_failed', '测试连接失败');
      assert.match(error.message, /连接面板失败/);
      assert.match(error.message, /模拟面板离线/);
    } finally {
      xui.setOffline(false);
    }
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

  it('删除用户：清理订单与会话，管理员账号不可删除', async () => {
    const target = createClient(app.baseUrl);
    const registered = await target.register('delete-target', 'password123');
    expectOk(await admin.post(`/api/admin/users/${registered.user.id}/balance`, { deltaCents: 50000 }), '充值余额');
    expectOk(await target.post('/api/me/purchase', { planId: 1, method: 'balance' }), '购买套餐');
    const ordersBefore = Number(app.store.get('SELECT COUNT(*) AS total FROM orders WHERE user_id = ?', registered.user.id).total);
    assert.ok(ordersBefore > 0);

    expectOk(await admin.delete(`/api/admin/users/${registered.user.id}`), '删除用户');
    expectError(await target.get('/api/me'), 'unauthorized', '删除后当前会话失效');
    expectError(await target.post('/api/auth/login', { username: 'delete-target', password: 'password123' }), 'invalid_credentials', '删除后不能登录');
    const listed = expectOk(await admin.get('/api/admin/users?query=delete-target'));
    assert.equal(listed.total, 0, '用户列表不再出现');
    const ordersAfter = Number(app.store.get('SELECT COUNT(*) AS total FROM orders WHERE user_id = ?', registered.user.id).total);
    assert.equal(ordersAfter, 0, '关联订单一并删除');

    expectError(await admin.delete(`/api/admin/users/${adminId}`), 'validation_error', '管理员账号不可删除');
    expectError(await admin.delete('/api/admin/users/999999'), 'user_not_found', '不存在的用户');
  });

  it('门户封禁 / 套餐停用 / 套餐过期时同步禁用面板客户端', async () => {
    const record = () => xui.clients.get('manual-user');
    assert.ok(record());
    assert.equal(record().enable, true);

    const list = expectOk(await admin.get('/api/admin/users?query=manual-user'));
    const targetId = list.items[0].id;

    expectOk(await admin.post(`/api/admin/users/${targetId}/status`, { status: 'banned' }), '封禁用户');
    assert.equal(record().enable, false, '封禁后面板客户端应禁用');
    expectOk(await admin.post(`/api/admin/users/${targetId}/status`, { status: 'active' }), '解封用户');
    assert.equal(record().enable, true, '解封后面板客户端应恢复');

    expectOk(await admin.put('/api/admin/plans/1', { enabled: false }), '停用套餐');
    assert.equal(record().enable, false, '套餐停用后面板客户端应禁用');
    expectOk(await admin.put('/api/admin/plans/1', { enabled: true }), '启用套餐');
    assert.equal(record().enable, true, '套餐启用后面板客户端应恢复');

    const clientSync = app.app.services.clientSync;
    app.store.run('UPDATE users SET plan_expires_at = ? WHERE id = ?', Date.now() - 1000, targetId);
    const changed = await clientSync.syncExpired();
    assert.ok(changed >= 1);
    assert.equal(record().enable, false, '套餐过期后面板客户端应禁用');

    app.store.run('UPDATE users SET plan_expires_at = ? WHERE id = ?', Date.now() + 24 * 60 * 60 * 1000, targetId);
    await clientSync.syncUser(targetId);
    assert.equal(record().enable, true, '套餐续期后面板客户端应恢复');
  });

  it('第一个管理员为最高权限，普通管理员不能管理其他管理员', async () => {
    const list = expectOk(await admin.get('/api/admin/admins'));
    const superAdmin = list.items.find((item) => item.isSuper);
    assert.ok(superAdmin);
    assert.equal(superAdmin.id, adminId);
    assert.equal(list.canManageAdmins, true);

    const created = expectOk(
      await admin.post('/api/admin/admins', { username: 'limited-admin', password: 'password123' }),
      '新增普通管理员',
    );
    const limited = createClient(app.baseUrl);
    await limited.login('limited-admin', 'password123');

    expectError(await limited.post('/api/admin/admins', { username: 'other-admin', password: 'password123' }), 'forbidden', '普通管理员不能新增');
    expectError(await limited.post(`/api/admin/admins/${adminId}/status`, { status: 'disabled' }), 'forbidden', '不能禁用最高权限');
    expectError(await limited.delete(`/api/admin/admins/${adminId}`), 'forbidden', '不能删除最高权限');
    expectError(
      await limited.post(`/api/admin/admins/${created.id}/password`, { newPassword: 'newpassword123' }),
      'forbidden',
      '不能修改其他管理员',
    );

    expectError(await admin.post(`/api/admin/admins/${adminId}/status`, { status: 'disabled' }), 'validation_error', '最高权限不可禁用');
    expectError(await admin.delete(`/api/admin/admins/${adminId}`), 'validation_error', '最高权限不可删除');
    expectOk(await admin.post(`/api/admin/admins/${created.id}/status`, { status: 'disabled' }), '最高权限可禁用其他管理员');
    expectOk(await admin.delete(`/api/admin/admins/${created.id}`), '最高权限可删除其他管理员');
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
