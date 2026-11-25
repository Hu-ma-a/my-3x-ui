import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { XuiMock } from '../src/integrations/xui-mock.js';
import { epaySign } from '../src/integrations/payment/epay.js';
import { startTestApp, createClient, expectOk, expectError, DAY_MS, GB } from './helpers.js';

describe('在线支付与充值', () => {
  let app;
  let xui;
  let admin;
  let user;

  before(async () => {
    xui = new XuiMock();
    app = await startTestApp({ xuiMock: xui });
    admin = createClient(app.baseUrl);
    await admin.adminLogin();
    user = createClient(app.baseUrl);
    await user.register('pay-user', 'password123');
  });

  after(async () => {
    await app.close();
  });

  async function completeMock(orderNo) {
    return expectOk(await user.post(`/api/me/payments/${orderNo}/mock-complete`), '模拟支付完成');
  }

  it('模拟支付：下单 → 完成 → 自动开通，重复完成不重复开通', async () => {
    const created = expectOk(await user.post('/api/me/purchase', { planId: 1, method: 'online', provider: 'mock' }), '创建模拟支付订单');
    assert.equal(created.order.status, 'pending');
    assert.equal(created.payment.type, 'mock');
    assert.ok(created.payment.payUrl.includes('#/pay/mock?orderNo='));

    const paid = await completeMock(created.order.orderNo);
    assert.equal(paid.status, 'provisioned');
    const clientRecord = xui.clients.get('pay-user');
    assert.ok(clientRecord);
    const expiry = clientRecord.expiryTime;
    const createCalls = xui.calls.filter((call) => call === 'createClient').length;

    const again = await completeMock(created.order.orderNo);
    assert.equal(again.status, 'provisioned');
    assert.equal(xui.clients.get('pay-user').expiryTime, expiry, '重复回调不得重复续期');
    assert.equal(xui.calls.filter((call) => call === 'createClient').length, createCalls);
  });

  it('充值：模拟支付完成后余额到账，重复回调不重复入账', async () => {
    const before = expectOk(await user.get('/api/me')).user.balanceCents;
    const created = expectOk(await user.post('/api/me/recharge', { amountCents: 10000, provider: 'mock' }), '创建充值订单');
    assert.equal(created.order.kind, 'recharge');
    assert.equal(created.order.status, 'pending');

    const credited = await completeMock(created.order.orderNo);
    assert.equal(credited.status, 'credited');

    const after = expectOk(await user.get('/api/me')).user.balanceCents;
    assert.equal(after, before + 10000);

    const again = await completeMock(created.order.orderNo);
    assert.equal(again.status, 'credited');
    const final = expectOk(await user.get('/api/me')).user.balanceCents;
    assert.equal(final, after, '重复回调不得重复加余额');
  });

  it('充值金额超出设置范围时拒绝', async () => {
    expectError(await user.post('/api/me/recharge', { amountCents: 50, provider: 'mock' }), 'validation_error', '低于最低充值');
    expectError(await user.post('/api/me/recharge', { amountCents: 99999999, provider: 'mock' }), 'validation_error', '高于最高充值');
  });

  it('易支付：未配置时下单返回 provider_unavailable', async () => {
    const fresh = createClient(app.baseUrl);
    await fresh.register('epay-unconfigured', 'password123');
    expectError(await fresh.post('/api/me/purchase', { planId: 1, method: 'online', provider: 'epay' }), 'provider_unavailable', '未配置易支付');
  });

  it('易支付：签名回调成功后开通，重复回调幂等', async () => {
    expectOk(
      await admin.put('/api/admin/settings', {
        'pay.epay.url': 'https://pay.example.com',
        'pay.epay.pid': '1001',
        'pay.epay.key': 'testkey123',
        'pay.epay.type': 'alipay',
      }),
      '配置易支付',
    );

    const epayUser = createClient(app.baseUrl);
    const registered = await epayUser.register('epay-user', 'password123');
    const created = expectOk(await epayUser.post('/api/me/purchase', { planId: 1, method: 'online', provider: 'epay' }), '创建易支付订单');
    assert.equal(created.payment.type, 'redirect');
    const payUrl = new URL(created.payment.payUrl);
    assert.equal(payUrl.origin, 'https://pay.example.com');
    assert.equal(payUrl.pathname, '/submit.php');
    assert.equal(payUrl.searchParams.get('out_trade_no'), created.order.orderNo);
    assert.equal(payUrl.searchParams.get('money'), '29.90');
    assert.equal(payUrl.searchParams.get('pid'), '1001');
    const expectedSign = epaySign(Object.fromEntries(payUrl.searchParams.entries()), 'testkey123');
    assert.equal(payUrl.searchParams.get('sign'), expectedSign, '下单签名应可被商户密钥验证');

    const baseParams = {
      pid: '1001',
      trade_status: 'TRADE_SUCCESS',
      out_trade_no: created.order.orderNo,
      money: '29.90',
      trade_no: 'TRADE-001',
      type: 'alipay',
    };
    const notify = { ...baseParams, sign: epaySign(baseParams, 'testkey123'), sign_type: 'MD5' };
    const notifyResponse = await epayUser.request('POST', '/api/payment/notify/epay', { form: notify });
    assert.equal(notifyResponse.text, 'success');
    assert.equal(notifyResponse.status, 200);

    const orders = expectOk(await epayUser.get('/api/me/orders'));
    assert.equal(orders.items[0].status, 'provisioned');
    const clientRecord = xui.clients.get('epay-user');
    assert.ok(clientRecord);
    const expiry = clientRecord.expiryTime;

    const repeated = await epayUser.request('POST', '/api/payment/notify/epay', { form: notify });
    assert.equal(repeated.text, 'success');
    assert.equal(xui.clients.get('epay-user').expiryTime, expiry, '重复通知不得重复续期');

    const returnResponse = await epayUser.get(`/api/payment/return/epay?orderNo=${created.order.orderNo}`);
    assert.equal(returnResponse.status, 302);
    assert.equal(returnResponse.headers.get('location'), `/#/orders?orderNo=${created.order.orderNo}`);
  });

  it('易支付：签名错误与金额不符都拒绝入账', async () => {
    const epayUser = createClient(app.baseUrl);
    await epayUser.register('epay-bad-sign', 'password123');
    const created = expectOk(await epayUser.post('/api/me/purchase', { planId: 1, method: 'online', provider: 'epay' }));
    const baseParams = {
      pid: '1001',
      trade_status: 'TRADE_SUCCESS',
      out_trade_no: created.order.orderNo,
      money: '29.90',
      trade_no: 'TRADE-002',
    };
    const bad = { ...baseParams, sign: 'deadbeefdeadbeefdeadbeefdeadbeef' };
    const badResponse = await epayUser.request('POST', '/api/payment/notify/epay', { form: bad });
    assert.equal(badResponse.text, 'fail');
    const stillPending = expectOk(await epayUser.get(`/api/me/orders/${created.order.orderNo}`));
    assert.equal(stillPending.status, 'pending');

    const cheap = { ...baseParams, money: '0.01' };
    cheap.sign = epaySign(cheap, 'testkey123');
    const cheapResponse = await epayUser.request('POST', '/api/payment/notify/epay', { form: cheap });
    assert.equal(cheapResponse.text, 'fail');
    const unchanged = expectOk(await epayUser.get(`/api/me/orders/${created.order.orderNo}`));
    assert.equal(unchanged.status, 'pending');
  });

  it('模拟支付自动完成开关生效', async () => {
    expectOk(await admin.put('/api/admin/settings', { 'pay.mockAutoComplete': 'true' }), '开启自动完成');
    const autoUser = createClient(app.baseUrl);
    const registered = await autoUser.register('auto-user', 'password123');
    const result = expectOk(await autoUser.post('/api/me/purchase', { planId: 1, method: 'online', provider: 'mock' }));
    assert.equal(result.order.status, 'provisioned');
    assert.equal(result.payment.autoPaid, true);
    assert.ok(xui.clients.get('auto-user'));
    expectOk(await admin.put('/api/admin/settings', { 'pay.mockAutoComplete': 'false' }), '关闭自动完成');
  });
});
