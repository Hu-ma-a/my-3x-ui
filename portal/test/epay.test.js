import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { epaySign, epaySignContent, epayVerify, moneyToCents } from '../src/integrations/payment/epay.js';

describe('易支付签名', () => {
  it('签名格式与固定向量一致', () => {
    const params = {
      pid: '1001',
      out_trade_no: 'P20260101000000TEST01',
      money: '29.90',
      trade_status: 'TRADE_SUCCESS',
    };
    assert.equal(epaySignContent(params), 'money=29.90&out_trade_no=P20260101000000TEST01&pid=1001&trade_status=TRADE_SUCCESS');
    assert.equal(epaySign(params, 'testkey123'), '6491f14af616529e362a6bd90250044f');
  });

  it('签名排除 sign / sign_type 与空值', () => {
    const params = {
      b: '2',
      a: '1',
      sign: 'ignored',
      sign_type: 'MD5',
      empty: '',
      missing: undefined,
    };
    assert.equal(epaySignContent(params), 'a=1&b=2');
  });

  it('验证接受正确签名并拒绝被篡改的参数', () => {
    const params = { pid: '1001', out_trade_no: 'P1', money: '1.00' };
    const signed = { ...params, sign: epaySign(params, 'key') };
    assert.equal(epayVerify(signed, 'key'), true);
    assert.equal(epayVerify({ ...signed, money: '0.01' }, 'key'), false, '金额被篡改必须失败');
    assert.equal(epayVerify({ ...signed, sign: '' }, 'key'), false, '缺少签名必须失败');
    assert.equal(epayVerify(signed, 'other-key'), false, '错误密钥必须失败');
  });

  it('金额转换按分四舍五入', () => {
    assert.equal(moneyToCents('29.90'), 2990);
    assert.equal(moneyToCents('0.01'), 1);
    assert.equal(moneyToCents('100'), 10000);
    assert.equal(moneyToCents('abc'), 0);
    assert.equal(moneyToCents('-1'), 0);
  });
});
