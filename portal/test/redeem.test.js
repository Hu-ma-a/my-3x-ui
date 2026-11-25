import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { startTestApp, createClient, expectOk, expectError } from './helpers.js';

describe('充值码', () => {
  let app;
  let admin;
  let user;

  before(async () => {
    app = await startTestApp();
    admin = createClient(app.baseUrl);
    await admin.adminLogin();
    user = createClient(app.baseUrl);
    await user.register('redeem-user', 'password123');
  });

  after(async () => {
    await app.close();
  });

  it('管理员生成充值码：返回完整 key，列表只显示掩码', async () => {
    const generated = expectOk(
      await admin.post('/api/admin/redeem-keys', { amountCents: 1000, count: 2, days: 0, note: '测试批次' }),
    );
    assert.equal(generated.items.length, 2);
    assert.match(generated.items[0].code, /^P-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.equal(generated.items[0].amountCents, 1000);

    const list = expectOk(await admin.get('/api/admin/redeem-keys?status=unused'));
    assert.equal(list.total, 2);
    assert.ok(list.items.every((item) => item.maskedCode.includes('****')));
    assert.ok(list.items.every((item) => item.status === 'unused'));
    app.generatedCodes = generated.items.map((item) => item.code);
  });

  it('用户兑换充值码：余额到账、生成充值订单、不能重复使用', async () => {
    const code = app.generatedCodes[0];
    const redeemed = expectOk(await user.post('/api/me/redeem', { code: code.toLowerCase().replaceAll('-', '') }));
    assert.equal(redeemed.amountCents, 1000);
    assert.equal(redeemed.balanceCents, 1000);

    const me = expectOk(await user.get('/api/me'));
    assert.equal(me.user.balanceCents, 1000);

    const orders = expectOk(await user.get('/api/me/orders?kind=recharge'));
    assert.ok(orders.items.some((order) => order.provider === 'redeem' && order.status === 'credited'));

    expectError(await user.post('/api/me/redeem', { code }), 'redeem_invalid', '重复兑换');
    expectError(await user.post('/api/me/redeem', { code: 'P-AAAA-BBBB-CCCC' }), 'redeem_invalid', '无效充值码');
  });

  it('撤销后不能兑换，过期后返回过期错误', async () => {
    const generated = expectOk(await admin.post('/api/admin/redeem-keys', { amountCents: 500, count: 2 }));
    const [revoked, expired] = generated.items;

    expectOk(await admin.post(`/api/admin/redeem-keys/${revoked.id}/revoke`));
    expectError(await user.post('/api/me/redeem', { code: revoked.code }), 'redeem_invalid', '撤销后兑换');
    expectError(await admin.post(`/api/admin/redeem-keys/${revoked.id}/revoke`), 'redeem_not_revocable', '重复撤销');

    app.store.run('UPDATE redeem_keys SET expires_at = ? WHERE id = ?', Date.now() - 1000, expired.id);
    expectError(await user.post('/api/me/redeem', { code: expired.code }), 'redeem_expired', '过期充值码');
  });

  it('参数校验与权限', async () => {
    expectError(await admin.post('/api/admin/redeem-keys', { amountCents: 0, count: 1 }), 'validation_error');
    expectError(await admin.post('/api/admin/redeem-keys', { amountCents: 100, count: 101 }), 'validation_error');
    expectError(await user.get('/api/admin/redeem-keys'), 'forbidden');
  });
});
