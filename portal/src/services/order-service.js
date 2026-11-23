import * as ordersModel from '../models/orders.js';
import * as usersModel from '../models/users.js';
import { errors } from '../util/errors.js';
import { newOrderNo } from '../util/ids.js';
import { createPaymentProvider } from '../integrations/payment/index.js';

const GB = 1024 * 1024 * 1024;

function parsePlanSnapshot(order) {
  if (!order.plan_snapshot) return null;
  try {
    const parsed = JSON.parse(order.plan_snapshot);
    if (!Number.isFinite(Number(parsed.trafficBytes))) {
      parsed.trafficBytes = Math.round(Number(parsed.trafficGb || 0) * GB);
    }
    if (!Array.isArray(parsed.inboundIds)) parsed.inboundIds = [];
    return parsed;
  } catch {
    return null;
  }
}

function planSnapshotOf(plan) {
  return {
    id: plan.id,
    name: plan.name,
    priceCents: plan.priceCents,
    days: plan.days,
    trafficGb: plan.trafficGb,
    trafficBytes: plan.trafficBytes,
    deviceLimit: plan.deviceLimit,
    inboundIds: plan.inboundIds,
  };
}

export class OrderService {
  constructor({ store, settings, xui, subscription, logger, config }) {
    this.store = store;
    this.settings = settings;
    this.xui = xui;
    this.subscription = subscription;
    this.logger = logger;
    this.config = config;
  }

  baseUrl(origin) {
    if (this.config.publicUrl) return this.config.publicUrl;
    return String(origin || '').replace(/\/+$/, '');
  }

  getForUser(userId, orderNo) {
    const order = ordersModel.findByOrderNo(this.store, orderNo);
    if (!order || Number(order.user_id) !== Number(userId)) {
      throw errors.notFound('not_found', '订单不存在');
    }
    return order;
  }

  listForUser(userId, { page = 1, pageSize = 20, kind = '' } = {}) {
    const total = ordersModel.countForUser(this.store, userId, { kind });
    const items = ordersModel.listForUser(this.store, userId, { kind, limit: pageSize, offset: (page - 1) * pageSize });
    return { items: items.map(ordersModel.toOrder), total, page, pageSize };
  }

  async createPlanOrder({ user, plan, method, provider, origin }) {
    if (method === 'balance') {
      const orderId = this.store.tx(() => {
        const fresh = usersModel.findById(this.store, user.id);
        if (Number(fresh.balance_cents) < plan.priceCents) {
          throw errors.badRequest('insufficient_balance', '余额不足，请先充值或选择在线支付');
        }
        usersModel.addBalance(this.store, user.id, -plan.priceCents);
        return ordersModel.insert(this.store, {
          orderNo: newOrderNo('P'),
          kind: 'plan',
          userId: user.id,
          planId: plan.id,
          planSnapshot: planSnapshotOf(plan),
          amountCents: plan.priceCents,
          status: 'pending',
          provider: 'balance',
        });
      });
      const finalOrder = await this.handlePaid(orderId, { provider: 'balance', tradeNo: 'BALANCE' });
      return { order: ordersModel.toOrder(finalOrder), payment: { type: 'balance', payUrl: null, instructions: null } };
    }

    if (!provider) throw errors.badRequest('provider_unavailable', '请选择支付方式');
    const providerImpl = createPaymentProvider(provider, { settings: this.settings });
    const snapshot = planSnapshotOf(plan);
    const orderId = ordersModel.insert(this.store, {
      orderNo: newOrderNo('P'),
      kind: 'plan',
      userId: user.id,
      planId: plan.id,
      planSnapshot: snapshot,
      amountCents: plan.priceCents,
      status: 'pending',
      provider,
    });
    const payment = await this.createPaymentFor(orderId, providerImpl, {
      kind: 'plan',
      planSnapshot: snapshot,
      amountCents: plan.priceCents,
      orderNo: ordersModel.findById(this.store, orderId).order_no,
      origin,
    });
    return { order: ordersModel.toOrder(ordersModel.findById(this.store, orderId)), payment };
  }

  async createRechargeOrder({ user, amountCents, provider, origin }) {
    if (!provider || provider === 'balance') {
      throw errors.badRequest('provider_unavailable', '充值请选择在线支付方式');
    }
    const portal = this.settings.portalConfig();
    if (amountCents < portal.minRechargeCents || amountCents > portal.maxRechargeCents) {
      throw errors.validation(`充值金额需在 ${portal.minRechargeCents / 100} 元到 ${portal.maxRechargeCents / 100} 元之间`);
    }
    const providerImpl = createPaymentProvider(provider, { settings: this.settings });
    const orderId = ordersModel.insert(this.store, {
      orderNo: newOrderNo('R'),
      kind: 'recharge',
      userId: user.id,
      planId: null,
      planSnapshot: null,
      amountCents,
      status: 'pending',
      provider,
    });
    const payment = await this.createPaymentFor(orderId, providerImpl, {
      kind: 'recharge',
      planSnapshot: null,
      amountCents,
      orderNo: ordersModel.findById(this.store, orderId).order_no,
      origin,
    });
    return { order: ordersModel.toOrder(ordersModel.findById(this.store, orderId)), payment };
  }

  async createPaymentFor(orderId, providerImpl, paymentOrder) {
    let payment;
    try {
      payment = await providerImpl.createPayment({
        order: paymentOrder,
        publicBaseUrl: this.baseUrl(paymentOrder.origin),
      });
    } catch (err) {
      ordersModel.setStatus(this.store, orderId, 'failed', { provisionError: err.message });
      throw err;
    }
    if (payment.payUrl) {
      this.store.run('UPDATE orders SET pay_url = ?, updated_at = ? WHERE id = ?', payment.payUrl, Date.now(), orderId);
    }
    if (providerImpl.kind === 'mock' && this.settings.paymentConfig().mockAutoComplete) {
      const finalOrder = await this.handlePaid(orderId, { provider: 'mock', tradeNo: `MOCK${paymentOrder.orderNo}`, payload: 'auto' });
      return { ...payment, autoPaid: true, order: ordersModel.toOrder(finalOrder) };
    }
    return payment;
  }

  async handlePaid(orderId, { provider = '', tradeNo = '', payload = '', amountCents = null } = {}) {
    let order = ordersModel.findById(this.store, orderId);
    if (!order) throw errors.notFound('not_found', '订单不存在');
    if (order.status === 'provisioned' || order.status === 'credited') return order;
    if (order.status === 'failed' || order.status === 'cancelled') {
      throw errors.badRequest('invalid_status', '订单已关闭，无法入账');
    }
    if (amountCents !== null && Number(amountCents) !== Number(order.amount_cents)) {
      throw errors.badRequest('amount_mismatch', '支付金额与订单金额不一致');
    }
    if (order.kind === 'recharge') {
      this.creditRecharge(order, { provider, tradeNo, payload });
      return ordersModel.findById(this.store, orderId);
    }
    ordersModel.markPaid(this.store, orderId, { providerTradeNo: tradeNo || provider, providerPayload: payload });
    return this.provisionById(orderId);
  }

  creditRecharge(order, { provider = '', tradeNo = '', payload = '' } = {}) {
    this.store.tx(() => {
      const current = ordersModel.findById(this.store, order.id);
      if (!current) throw errors.notFound('not_found', '订单不存在');
      if (current.credit_applied) return;
      if (current.status === 'pending') {
        ordersModel.markPaid(this.store, current.id, { providerTradeNo: tradeNo || provider, providerPayload: payload });
      }
      const fresh = ordersModel.findById(this.store, order.id);
      if (fresh.credit_applied) return;
      if (fresh.status !== 'paid') {
        throw errors.badRequest('invalid_status', '订单状态异常，无法入账');
      }
      usersModel.addBalance(this.store, fresh.user_id, Number(fresh.amount_cents));
      ordersModel.creditApplied(this.store, fresh.id);
    });
  }

  async provisionById(orderId) {
    let order = ordersModel.findById(this.store, orderId);
    if (!order) throw errors.notFound('not_found', '订单不存在');
    if (!['paid', 'sync_pending', 'provisioning'].includes(order.status)) return order;

    const plan = parsePlanSnapshot(order);
    if (!plan) {
      ordersModel.failProvisioning(this.store, order.id, '订单缺少套餐快照');
      return ordersModel.findById(this.store, orderId);
    }
    const userRow = usersModel.findById(this.store, order.user_id);
    if (!userRow) {
      ordersModel.failProvisioning(this.store, order.id, '订单用户不存在');
      return ordersModel.findById(this.store, orderId);
    }
    const user = usersModel.toUser(userRow);

    let target;
    try {
      target = await this.targetFor(order, plan, user);
    } catch (err) {
      ordersModel.failProvisioning(this.store, order.id, err.message);
      return ordersModel.findById(this.store, orderId);
    }

    if (order.status !== 'provisioning') {
      const claimed = ordersModel.claimProvisioning(this.store, order.id, target);
      if (!claimed) return ordersModel.findById(this.store, orderId);
    }

    try {
      const applied = await this.subscription.verifyApplied(target);
      if (!applied) await this.subscription.applyTarget(target, plan, user);
      ordersModel.finishProvisioning(this.store, order.id);
      usersModel.updateSnapshot(this.store, user.id, this.subscription.snapshotFor(user, plan, target));
    } catch (err) {
      this.logger?.warn(`订单 ${order.order_no} 开通失败：${err.message}`);
      ordersModel.failProvisioning(this.store, order.id, err.message);
    }
    return ordersModel.findById(this.store, orderId);
  }

  async targetFor(order, plan, user) {
    const hasExpectedTarget = order.provision_mode && order.expected_expiry_ms !== null && order.expected_expiry_ms !== undefined;
    if (hasExpectedTarget) {
      return {
        mode: order.provision_mode,
        clientEmail: order.client_email,
        subId: order.sub_id,
        expectedExpiry: Number(order.expected_expiry_ms),
        expectedTotal: Number(order.expected_total),
        expectedLimit: Number(order.expected_limit),
        inboundIds: await this.subscription.resolveInboundIds(plan),
      };
    }
    return this.subscription.computeTarget(user, plan, Date.now());
  }

  async completeMock(userId, orderNo) {
    const order = this.getForUser(userId, orderNo);
    if (order.provider !== 'mock') throw errors.badRequest('invalid_provider', '该订单不是模拟支付订单');
    if (order.status === 'provisioned' || order.status === 'credited') return order;
    if (order.status !== 'pending') throw errors.badRequest('invalid_status', '订单状态不允许模拟支付');
    return this.handlePaid(order.id, { provider: 'mock', tradeNo: `MOCK${order.order_no}`, payload: 'mock-complete' });
  }

  async retryPending() {
    const rows = ordersModel.pendingProvisioning(this.store, { maxAttempts: 20, limit: 20 });
    for (const row of rows) {
      try {
        await this.provisionById(row.id);
      } catch (err) {
        this.logger?.warn(`重试订单 ${row.order_no} 开通失败：${err.message}`);
      }
    }
    return rows.length;
  }
}
