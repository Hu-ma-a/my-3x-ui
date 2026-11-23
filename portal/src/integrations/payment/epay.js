import crypto from 'node:crypto';

import { errors } from '../../util/errors.js';

export function epaySignContent(params) {
  return Object.keys(params)
    .filter((key) => key !== 'sign' && key !== 'sign_type' && params[key] !== '' && params[key] !== null && params[key] !== undefined)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
}

export function epaySign(params, key) {
  return crypto.createHash('md5').update(`${epaySignContent(params)}${key}`).digest('hex');
}

export function epayVerify(params, key) {
  const sign = String(params.sign || '').toLowerCase();
  if (!sign) return false;
  const expected = epaySign(params, key);
  if (expected.length !== sign.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sign));
}

export function moneyToCents(value) {
  const amount = Number.parseFloat(String(value));
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100);
}

export function createEpayProvider({ epay, portal }) {
  const missing = ['url', 'pid', 'key'].filter((field) => !epay[field]);
  return {
    id: 'epay',
    kind: 'redirect',
    createPayment({ order, publicBaseUrl }) {
      if (missing.length) {
        throw errors.badRequest('provider_unavailable', `易支付未配置（缺少 ${missing.join(', ')}）`);
      }
      const notifyUrl = epay.notifyUrl || `${publicBaseUrl}/api/payment/notify/epay`;
      const returnUrl = epay.returnUrl || `${publicBaseUrl}/api/payment/return/epay?orderNo=${encodeURIComponent(order.orderNo)}`;
      const name = order.planSnapshot?.name
        ? `${order.planSnapshot.name}`
        : order.kind === 'recharge'
          ? `${portal.name} 余额充值`
          : `订单 ${order.orderNo}`;
      const params = {
        pid: epay.pid,
        type: epay.type || 'alipay',
        out_trade_no: order.orderNo,
        notify_url: notifyUrl,
        return_url: returnUrl,
        name,
        money: (order.amountCents / 100).toFixed(2),
        sign_type: 'MD5',
      };
      params.sign = epaySign(params, epay.key);
      const query = new URLSearchParams(params).toString();
      return { type: 'redirect', payUrl: `${epay.url.replace(/\/+$/, '')}/submit.php?${query}` };
    },
    verifyNotify(params) {
      if (missing.length) return { ok: false, error: '易支付未配置' };
      if (String(params.pid || '') !== String(epay.pid)) return { ok: false, error: 'PID 不匹配' };
      if (!epayVerify(params, epay.key)) return { ok: false, error: '签名校验失败' };
      if (String(params.trade_status || '') !== 'TRADE_SUCCESS') return { ok: false, error: '交易未成功' };
      const orderNo = String(params.out_trade_no || '');
      if (!orderNo) return { ok: false, error: '缺少订单号' };
      const amountCents = moneyToCents(params.money);
      if (amountCents <= 0) return { ok: false, error: '金额无效' };
      return { ok: true, orderNo, tradeNo: String(params.trade_no || ''), amountCents, raw: params };
    },
  };
}
