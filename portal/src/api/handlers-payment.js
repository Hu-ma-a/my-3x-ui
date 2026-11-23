import * as ordersModel from '../models/orders.js';
import { readRaw, redirect, text } from '../http/response.js';
import { createEpayProvider } from '../integrations/payment/epay.js';

export async function notify(ctx, services) {
  if (ctx.params.provider !== 'epay') {
    text(ctx.res, 200, 'fail');
    return;
  }
  const raw = await readRaw(ctx.req);
  const form = Object.fromEntries(new URLSearchParams(raw));
  const params = { ...ctx.query, ...form };
  const impl = createEpayProvider({
    epay: services.settings.paymentConfig().epay,
    portal: services.settings.portalConfig(),
  });
  const verified = impl.verifyNotify(params);
  if (!verified.ok) {
    services.logger.warn(`易支付回调校验失败：${verified.error}`);
    text(ctx.res, 200, 'fail');
    return;
  }
  const order = ordersModel.findByOrderNo(services.store, verified.orderNo);
  if (!order) {
    services.logger.warn(`易支付回调订单不存在：${verified.orderNo}`);
    text(ctx.res, 200, 'fail');
    return;
  }
  if (Number(order.amount_cents) !== Number(verified.amountCents)) {
    services.logger.warn(`易支付回调金额不一致：订单 ${order.order_no}，订单金额 ${order.amount_cents}，回调金额 ${verified.amountCents}`);
    text(ctx.res, 200, 'fail');
    return;
  }
  try {
    await services.orders.handlePaid(order.id, {
      provider: 'epay',
      tradeNo: verified.tradeNo,
      payload: JSON.stringify(verified.raw),
      amountCents: verified.amountCents,
    });
    text(ctx.res, 200, 'success');
  } catch (err) {
    services.logger.warn(`易支付回调入账失败：订单 ${order.order_no}：${err.message}`);
    text(ctx.res, 200, 'fail');
  }
}

export function paymentReturn(ctx) {
  const orderNo = ctx.query.orderNo || ctx.query.out_trade_no || '';
  const suffix = orderNo ? `?orderNo=${encodeURIComponent(orderNo)}` : '';
  redirect(ctx.res, `/#/orders${suffix}`);
}
