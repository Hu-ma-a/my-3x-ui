import * as ordersModel from '../models/orders.js';
import { errors } from '../util/errors.js';
import { int, pagination, str } from '../util/validate.js';

export async function me(ctx, services) {
  return services.account.overview(ctx.user, { csrfToken: ctx.sessionRow?.csrf_token || '' });
}

export async function subscription(ctx, services) {
  return services.account.subscriptionInfo(ctx.user);
}

export function listOrders(ctx, services) {
  const { page, pageSize } = pagination(ctx.query);
  const kind = ctx.query.kind === 'plan' || ctx.query.kind === 'recharge' ? ctx.query.kind : '';
  return services.orders.listForUser(ctx.user.id, { page, pageSize, kind });
}

export function getOrder(ctx, services) {
  const order = services.orders.getForUser(ctx.user.id, ctx.params.orderNo);
  return ordersModel.toOrder(order);
}

export async function purchase(ctx, services) {
  const body = await ctx.body();
  const planId = int(body, 'planId', { label: '套餐', min: 1 });
  const method = body.method === 'balance' ? 'balance' : body.method === 'online' ? 'online' : null;
  if (!method) throw errors.validation('请选择支付方式（余额支付或在线支付）');
  const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
  const plan = services.plans.requireEnabled(planId);
  return services.orders.createPlanOrder({
    user: ctx.user,
    plan,
    method,
    provider,
    origin: ctx.origin,
  });
}

export async function recharge(ctx, services) {
  const body = await ctx.body();
  const amountCents = int(body, 'amountCents', { label: '充值金额', min: 1, max: 100000000 });
  const provider = str(body, 'provider', { label: '支付方式', min: 1, max: 32 });
  return services.orders.createRechargeOrder({
    user: ctx.user,
    amountCents,
    provider,
    origin: ctx.origin,
  });
}

export async function mockComplete(ctx, services) {
  const order = await services.orders.completeMock(ctx.user.id, ctx.params.orderNo);
  return ordersModel.toOrder(order);
}

export async function changePassword(ctx, services) {
  const body = await ctx.body();
  services.auth.changePassword({
    user: ctx.user,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
    currentToken: ctx.token,
  });
  return { ok: true };
}
