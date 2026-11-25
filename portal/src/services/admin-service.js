import * as usersModel from '../models/users.js';
import * as ordersModel from '../models/orders.js';
import * as sessionModel from '../models/sessions.js';
import net from 'node:net';
import { hashPassword } from '../auth/password.js';
import { AppError, errors } from '../util/errors.js';
import { dayStartMs, monthStartMs } from '../util/time.js';
import { int } from '../util/validate.js';

const UDP_PROTOCOLS = new Set(['hysteria', 'hysteria2', 'tuic', 'wireguard', 'mtproto']);

export function measureTcpLatency(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (!host || !Number.isInteger(port) || port <= 0) {
      resolve(null);
      return;
    }
    const startedAt = performance.now();
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(Math.max(1, Math.round(performance.now() - startedAt))));
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
  });
}

function panelHostFromUrl(rawUrl) {
  try {
    return new URL(String(rawUrl || '')).hostname;
  } catch {
    return '';
  }
}

export class AdminService {
  constructor({ store, settings, planService, orderService, subscription, authService, xui, logger }) {
    this.store = store;
    this.settings = settings;
    this.planService = planService;
    this.orderService = orderService;
    this.subscription = subscription;
    this.authService = authService;
    this.xui = xui;
    this.logger = logger;
  }

  overview() {
    const now = Date.now();
    const todayStart = dayStartMs(now);
    const monthStart = monthStartMs(now);
    const money = (sql, ...params) => Number(this.store.get(sql, ...params)?.value || 0);
    const count = (sql, ...params) => Number(this.store.get(sql, ...params)?.value || 0);
    const plans = this.planService.listAll();
    return {
      users: {
        total: count('SELECT COUNT(*) AS value FROM users'),
        active: count("SELECT COUNT(*) AS value FROM users WHERE status = 'active'"),
      },
      plans: {
        total: plans.length,
        enabled: plans.filter((plan) => plan.enabled).length,
      },
      orders: {
        total: count('SELECT COUNT(*) AS value FROM orders'),
        pending: count("SELECT COUNT(*) AS value FROM orders WHERE status = 'pending'"),
        today: count('SELECT COUNT(*) AS value FROM orders WHERE created_at >= ?', todayStart),
      },
      revenue: {
        totalCents: money("SELECT COALESCE(SUM(amount_cents), 0) AS value FROM orders WHERE status IN ('provisioned', 'credited')"),
        todayCents: money("SELECT COALESCE(SUM(amount_cents), 0) AS value FROM orders WHERE status IN ('provisioned', 'credited') AND paid_at >= ?", todayStart),
        monthCents: money("SELECT COALESCE(SUM(amount_cents), 0) AS value FROM orders WHERE status IN ('provisioned', 'credited') AND paid_at >= ?", monthStart),
      },
      recharges: {
        totalCents: money("SELECT COALESCE(SUM(amount_cents), 0) AS value FROM orders WHERE kind = 'recharge' AND status = 'credited'"),
        todayCents: money("SELECT COALESCE(SUM(amount_cents), 0) AS value FROM orders WHERE kind = 'recharge' AND status = 'credited' AND paid_at >= ?", todayStart),
      },
    };
  }

  listUsers({ query = '', status = '', page = 1, pageSize = 20 } = {}) {
    const total = usersModel.count(this.store, { query, status });
    const rows = usersModel.list(this.store, { query, status, limit: pageSize, offset: (page - 1) * pageSize });
    return { items: rows.map(usersModel.toUser), total, page, pageSize };
  }

  async getUser(id) {
    const row = usersModel.findById(this.store, id);
    if (!row) throw errors.notFound('user_not_found', '用户不存在');
    const user = usersModel.toUser(row);
    const live = await this.subscription.liveForUser(user);
    const orders = ordersModel.listForUser(this.store, id, { limit: 20 }).map(ordersModel.toOrder);
    return { user, orders, live };
  }

  setUserStatus(id, status) {
    if (!['active', 'disabled', 'banned'].includes(status)) {
      throw errors.validation('用户状态只能是 active、disabled 或 banned');
    }
    const row = usersModel.findById(this.store, id);
    if (!row) throw errors.notFound('user_not_found', '用户不存在');
    if (row.role === 'admin') throw errors.validation('管理员账号请到「管理员」页面操作');
    usersModel.setStatus(this.store, id, status);
    if (status !== 'active') sessionModel.removeByUser(this.store, id);
    return usersModel.toUser(usersModel.findById(this.store, id));
  }

  listAdmins(actorId) {
    return {
      items: usersModel.listAdmins(this.store).map((row) => ({
        ...usersModel.toUser(row),
        isSelf: Number(row.id) === Number(actorId),
      })),
    };
  }

  createAdmin({ username, password, email = '' }) {
    if (usersModel.existsUsername(this.store, username)) {
      throw errors.conflict('username_taken', '该用户名已被占用');
    }
    if (email && usersModel.existsEmail(this.store, email)) {
      throw errors.conflict('email_taken', '该邮箱已被占用');
    }
    const id = usersModel.create(this.store, {
      username,
      email,
      passwordHash: hashPassword(password),
      role: 'admin',
    });
    return { ...usersModel.toUser(usersModel.findById(this.store, id)), isSelf: false };
  }

  setAdminStatus(actorId, id, status) {
    if (!['active', 'disabled'].includes(status)) {
      throw errors.validation('管理员状态只能是 active 或 disabled');
    }
    const row = usersModel.findById(this.store, id);
    if (!row || row.role !== 'admin') throw errors.notFound('admin_not_found', '管理员不存在');
    if (Number(id) === Number(actorId) && status !== 'active') {
      throw errors.validation('不能禁用当前登录的管理员');
    }
    if (status !== 'active' && row.status === 'active' && usersModel.countActiveAdmins(this.store) <= 1) {
      throw errors.validation('至少需要保留一个可用的管理员');
    }
    usersModel.setStatus(this.store, id, status);
    if (status !== 'active') sessionModel.removeByUser(this.store, id);
    return { ...usersModel.toUser(usersModel.findById(this.store, id)), isSelf: Number(id) === Number(actorId) };
  }

  resetAdminPassword(id, newPassword) {
    const row = usersModel.findById(this.store, id);
    if (!row || row.role !== 'admin') throw errors.notFound('admin_not_found', '管理员不存在');
    this.authService.resetPasswordByAdmin(id, newPassword);
    return { ok: true };
  }

  deleteAdmin(actorId, id) {
    const row = usersModel.findById(this.store, id);
    if (!row || row.role !== 'admin') throw errors.notFound('admin_not_found', '管理员不存在');
    if (Number(id) === Number(actorId)) throw errors.validation('不能删除当前登录的管理员');
    if (row.status === 'active' && usersModel.countActiveAdmins(this.store) <= 1) {
      throw errors.validation('至少需要保留一个可用的管理员');
    }
    sessionModel.removeByUser(this.store, id);
    usersModel.remove(this.store, id);
    return { ok: true };
  }

  adjustBalance(id, deltaCents, note = '') {
    const delta = int({ deltaCents }, 'deltaCents', { label: '调整金额(分)', min: -100000000, max: 100000000 });
    if (delta === 0) throw errors.validation('调整金额不能为 0');
    return this.store.tx(() => {
      const row = usersModel.findById(this.store, id);
      if (!row) throw errors.notFound('user_not_found', '用户不存在');
      if (Number(row.balance_cents) + delta < 0) throw errors.validation('调整后余额不能为负数');
      usersModel.addBalance(this.store, id, delta);
      if (note) this.logger?.info(`管理员调整用户 ${row.username} 余额 ${delta} 分，备注：${String(note).slice(0, 200)}`);
      return usersModel.toUser(usersModel.findById(this.store, id));
    });
  }

  resetPassword(id, newPassword) {
    const row = usersModel.findById(this.store, id);
    if (!row) throw errors.notFound('user_not_found', '用户不存在');
    this.authService.resetPasswordByAdmin(id, newPassword);
    return { ok: true };
  }

  deleteUser(actorId, id) {
    const row = usersModel.findById(this.store, id);
    if (!row) throw errors.notFound('user_not_found', '用户不存在');
    if (row.role === 'admin') throw errors.validation('管理员账号请到「管理员」页面操作');
    if (Number(id) === Number(actorId)) throw errors.validation('不能删除当前登录账号');
    this.store.tx(() => {
      sessionModel.removeByUser(this.store, id);
      ordersModel.removeForUser(this.store, id);
      usersModel.remove(this.store, id);
    });
    this.logger?.info(`管理员删除用户 ${row.username}（ID ${id}）`);
    return { ok: true };
  }

  listOrders({ kind = '', status = '', query = '', page = 1, pageSize = 20 } = {}) {
    const total = ordersModel.countAdmin(this.store, { kind, status, query });
    const rows = ordersModel.listAdmin(this.store, { kind, status, query, limit: pageSize, offset: (page - 1) * pageSize });
    return { items: rows.map(ordersModel.toOrder), total, page, pageSize };
  }

  getOrder(id) {
    const order = ordersModel.findById(this.store, id);
    if (!order) throw errors.notFound('not_found', '订单不存在');
    return ordersModel.toOrder(order);
  }

  async markPaid(id) {
    const order = ordersModel.findById(this.store, id);
    if (!order) throw errors.notFound('not_found', '订单不存在');
    if (['provisioned', 'credited'].includes(order.status)) return ordersModel.toOrder(order);
    if (order.status === 'pending') {
      ordersModel.markPaidByAdmin(this.store, id);
    } else if (!['paid', 'sync_pending'].includes(order.status)) {
      throw errors.badRequest('invalid_status', '当前订单状态不允许标记为已支付');
    }
    const finalOrder = await this.orderService.handlePaid(id, { provider: 'manual', tradeNo: 'ADMIN', payload: 'admin-confirm' });
    return ordersModel.toOrder(finalOrder);
  }

  async retryProvision(id) {
    const order = ordersModel.findById(this.store, id);
    if (!order) throw errors.notFound('not_found', '订单不存在');
    if (!['paid', 'sync_pending'].includes(order.status)) {
      throw errors.badRequest('invalid_status', '只有待开通或同步失败的订单可以重试');
    }
    const finalOrder = await this.orderService.provisionById(id);
    return ordersModel.toOrder(finalOrder);
  }

  cancelOrder(id) {
    const order = ordersModel.findById(this.store, id);
    if (!order) throw errors.notFound('not_found', '订单不存在');
    const changed = ordersModel.cancel(this.store, id, '管理员取消');
    if (!changed) throw errors.badRequest('invalid_status', '只有待支付订单可以取消');
    return ordersModel.toOrder(ordersModel.findById(this.store, id));
  }

  async testXui() {
    try {
      const client = this.xui.client();
      const startedAt = performance.now();
      const inbounds = (await client.listInbounds()) || [];
      const apiLatencyMs = Math.max(1, Math.round(performance.now() - startedAt));
      const panel = await client.panelSettings().catch(() => ({}));
      const panelHost = panelHostFromUrl(this.settings.xuiConfig().url);
      const items = await Promise.all(
        inbounds.map(async (inbound) => {
          const protocol = String(inbound.protocol || '').toLowerCase();
          const listen = String(inbound.listen || '').trim();
          const port = Number(inbound.port);
          const host = listen && !['0.0.0.0', '::', '::0'].includes(listen) && listen !== '127.0.0.1'
            ? listen
            : panelHost;
          const udp = UDP_PROTOCOLS.has(protocol);
          const latencyMs = udp ? null : await measureTcpLatency(host, port);
          return {
            id: Number(inbound.id),
            remark: inbound.remark || '',
            protocol: inbound.protocol || '',
            enable: inbound.enable !== false,
            endpoint: host && port > 0 ? `${host}:${port}` : '',
            latencyMs,
            latencyNote: udp ? 'udp' : latencyMs == null ? 'unreachable' : 'tcp',
          };
        }),
      );
      return {
        ok: true,
        apiLatencyMs,
        inboundCount: inbounds.length,
        inbounds: items,
        subscription: {
          subEnable: Boolean(panel?.subEnable),
          subPath: panel?.subPath || '',
          subURI: panel?.subURI || '',
        },
      };
    } catch (err) {
      throw new AppError('xui_connection_failed', `连接面板失败：${err && err.message ? err.message : '未知错误'}`, 502);
    }
  }

  settingsList() {
    return this.settings.adminList();
  }

  updateSettings(patch) {
    this.settings.updateMany(patch);
    return this.settings.adminList();
  }
}
