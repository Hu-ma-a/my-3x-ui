import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { XuiMock } from '../src/integrations/xui-mock.js';
import { startTestApp, createClient, expectOk, expectError, DAY_MS, GB } from './helpers.js';

describe('套餐购买与 3x-ui 自动开通', () => {
  let app;
  let xui;
  let admin;
  let user;
  let userId;

  before(async () => {
    xui = new XuiMock();
    app = await startTestApp({ xuiMock: xui });
    admin = createClient(app.baseUrl);
    await admin.adminLogin();
    user = createClient(app.baseUrl);
    const registered = await user.register('purchase-user', 'password123');
    userId = registered.user.id;
    expectOk(await admin.post(`/api/admin/users/${userId}/balance`, { deltaCents: 500000 }), '充值用户余额');
  });

  after(async () => {
    await app.close();
  });

  const clientEmail = () => 'purchase-user';

  it('首次购买：在 3x-ui 新增客户端，默认 30 天 / 500GB / 3 设备', async () => {
    const startedAt = Date.now();
    const result = expectOk(await user.post('/api/me/purchase', { planId: 1, method: 'balance' }), '余额购买套餐');
    assert.equal(result.payment.type, 'balance');
    assert.equal(result.order.status, 'provisioned');
    assert.equal(result.order.kind, 'plan');
    assert.equal(result.order.amountCents, 2990);

    const record = xui.clients.get(clientEmail());
    assert.ok(record, '3x-ui 中应新增客户端');
    assert.ok(Math.abs(record.expiryTime - (startedAt + 30 * DAY_MS)) < 5000, `到期时间应约为 30 天后，实际 ${record.expiryTime}`);
    assert.equal(record.totalGB, 500 * GB);
    assert.equal(record.limitHwid, 3);
    assert.ok(record.subId.length >= 16, '应生成订阅 ID');
    assert.deepEqual(record.inboundIds, [1]);
    assert.equal(record.comment, `portal:${'purchase-user'}`);

    const me = expectOk(await user.get('/api/me'), '/api/me');
    assert.equal(me.user.planName, '标准套餐');
    assert.equal(me.user.planExpiresAt, record.expiryTime);
    assert.equal(me.user.totalBytes, 500 * GB);
    assert.equal(me.live.available, true);
    assert.equal(me.live.enabled, true);
    assert.equal(me.live.totalBytes, 500 * GB);
    assert.equal(me.live.subId, record.subId);
    assert.equal(me.live.subscriptionUrl, `https://sub.example.com/sub/${record.subId}`);
    assert.ok(me.live.links.length >= 1);
  });

  it('再次购买：续期而不是重复新增，天数/流量/设备数累加', async () => {
    const before = { ...xui.clients.get(clientEmail()) };
    const result = expectOk(await user.post('/api/me/purchase', { planId: 1, method: 'balance' }), '续费套餐');
    assert.equal(result.order.status, 'provisioned');

    assert.equal(xui.clients.size, 1, '续费不应新增客户端');
    const record = xui.clients.get(clientEmail());
    assert.equal(record.expiryTime, before.expiryTime + 30 * DAY_MS, '应在原到期时间上增加 30 天');
    assert.equal(record.totalGB, 1000 * GB, '流量应累加 500GB');
    assert.equal(record.limitHwid, 6, '设备数应累加 3');
    assert.equal(record.subId, before.subId, '订阅 ID 保持不变');
  });

  it('余额不足时拒绝购买', async () => {
    const poor = createClient(app.baseUrl);
    await poor.register('poor-user', 'password123');
    expectError(await poor.post('/api/me/purchase', { planId: 1, method: 'balance' }), 'insufficient_balance', '余额不足');
  });

  it('3x-ui 不可用时订单进入 sync_pending，恢复后重试成功且幂等', async () => {
    const offlineUser = createClient(app.baseUrl);
    const registered = await offlineUser.register('retry-user', 'password123');
    expectOk(await admin.post(`/api/admin/users/${registered.user.id}/balance`, { deltaCents: 100000 }), '充值余额');

    xui.setOffline(true);
    const failed = expectOk(await offlineUser.post('/api/me/purchase', { planId: 1, method: 'balance' }), '离线购买');
    assert.equal(failed.order.status, 'sync_pending');
    assert.ok(failed.order.provisionError.includes('模拟面板离线'));

    xui.setOffline(false);
    const retried = expectOk(await admin.post(`/api/admin/orders/${failed.order.id}/retry-provision`, {}), '重试开通');
    assert.equal(retried.status, 'provisioned');
    const record = xui.clients.get('retry-user');
    assert.ok(record);
    assert.ok(Math.abs(record.expiryTime - (Date.now() + 30 * DAY_MS)) < 10000);
    assert.equal(record.totalGB, 500 * GB);

    // 模拟「调用已成功但订单状态没落库」的崩溃场景：重试不得重复累加。
    app.store.run("UPDATE orders SET status = 'sync_pending', provisioned_at = NULL WHERE id = ?", failed.order.id);
    const again = expectOk(await admin.post(`/api/admin/orders/${failed.order.id}/retry-provision`, {}), '再次重试');
    assert.equal(again.status, 'provisioned');
    const afterRecord = xui.clients.get('retry-user');
    assert.equal(afterRecord.expiryTime, record.expiryTime, '重试不得重复增加天数');
    assert.equal(afterRecord.totalGB, record.totalGB, '重试不得重复累加流量');
    assert.equal(afterRecord.limitHwid, record.limitHwid, '重试不得重复累加设备数');

    expectError(await admin.post(`/api/admin/orders/${failed.order.id}/retry-provision`, {}), 'invalid_status', '已开通订单不可重试');
  });

  it('新客户端名称优先使用用户邮箱，其次用户名', async () => {
    const namedUser = createClient(app.baseUrl);
    const registered = await namedUser.register('named-user', 'password123', 'named-user@example.com');
    expectOk(await admin.post(`/api/admin/users/${registered.user.id}/balance`, { deltaCents: 100000 }), '充值余额');
    expectOk(await namedUser.post('/api/me/purchase', { planId: 1, method: 'balance' }), '购买套餐');
    assert.ok(xui.clients.get('named-user@example.com'), '有邮箱时客户端名称使用邮箱');

    const plainUser = createClient(app.baseUrl);
    const plain = await plainUser.register('plain-user', 'password123');
    expectOk(await admin.post(`/api/admin/users/${plain.user.id}/balance`, { deltaCents: 100000 }), '充值余额');
    expectOk(await plainUser.post('/api/me/purchase', { planId: 1, method: 'balance' }), '购买套餐');
    assert.ok(xui.clients.get('plain-user'), '无邮箱时客户端名称使用用户名');
  });

  it('套餐未绑定入站且未配置默认入站时，默认关联全部入站', async () => {
    const originalInbounds = xui.inbounds;
    xui.inbounds = [
      { id: 11, remark: '入站A', protocol: 'vless', port: 443, enable: true },
      { id: 12, remark: '入站B', protocol: 'vless', port: 8443, enable: true },
      { id: 13, remark: '已禁用', protocol: 'vless', port: 9443, enable: false },
    ];
    try {
      const allUser = createClient(app.baseUrl);
      const registered = await allUser.register('all-inbound-user', 'password123');
      expectOk(await admin.post(`/api/admin/users/${registered.user.id}/balance`, { deltaCents: 100000 }), '充值余额');
      expectOk(await allUser.post('/api/me/purchase', { planId: 1, method: 'balance' }), '购买套餐');
      const record = xui.clients.get('all-inbound-user');
      assert.ok(record);
      assert.deepEqual([...record.inboundIds].sort((a, b) => a - b), [11, 12], '应关联全部启用的入站');
    } finally {
      xui.inbounds = originalInbounds;
    }
  });

  it('订单列表包含购买记录', async () => {
    const page = expectOk(await user.get('/api/me/orders?kind=plan'), '订单列表');
    assert.equal(page.total, 2);
    assert.equal(page.items.length, 2);
    assert.ok(page.items.every((item) => item.kind === 'plan'));
    assert.equal(page.items[0].status, 'provisioned');

    const single = expectOk(await user.get(`/api/me/orders/${page.items[0].orderNo}`), '订单详情');
    assert.equal(single.orderNo, page.items[0].orderNo);
  });
});
