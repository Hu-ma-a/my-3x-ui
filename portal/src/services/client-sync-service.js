import * as usersModel from '../models/users.js';
import * as plansModel from '../models/plans.js';

/**
 * 把门户的账号/套餐状态同步到面板客户端（enable 字段）。
 * 规则：用户 active + 套餐未过期 + 套餐启用 时客户端启用，否则禁用。
 */
export class ClientSyncService {
  constructor({ store, xui, logger }) {
    this.store = store;
    this.xui = xui;
    this.logger = logger;
  }

  shouldEnable(user) {
    if (!user || !user.clientEmail) return false;
    if (user.status !== 'active') return false;
    const expiresAt = Number(user.planExpiresAt || 0);
    if (expiresAt > 0 && expiresAt <= Date.now()) return false;
    if (user.planId) {
      const plan = plansModel.find(this.store, Number(user.planId));
      if (plan && plan.enabled === 0) return false;
    }
    return true;
  }

  async setEnabled(user, enabled, { force = false } = {}) {
    if (!user || !user.clientEmail) return false;
    if (!force && Boolean(user.clientEnabled) === Boolean(enabled)) return true;
    try {
      await this.xui.client().updateClient(user.clientEmail, { enable: Boolean(enabled) });
      usersModel.setClientEnabled(this.store, user.id, enabled);
      this.logger?.info(`面板客户端 ${user.clientEmail} 已${enabled ? '启用' : '禁用'}`);
      return true;
    } catch (err) {
      this.logger?.warn(`同步面板客户端状态失败（${user.clientEmail}）：${err.message || err}`);
      return false;
    }
  }

  async syncUser(userId) {
    const user = usersModel.toUser(usersModel.findById(this.store, userId));
    if (!user) return false;
    return this.setEnabled(user, this.shouldEnable(user), { force: true });
  }

  async syncPlan(planId, enabled) {
    const users = usersModel.listByPlan(this.store, planId).map(usersModel.toUser);
    let changed = 0;
    for (const user of users) {
      const target = enabled && this.shouldEnable(user);
      if (await this.setEnabled(user, target, { force: true })) changed += 1;
    }
    return changed;
  }

  async syncExpired(now = Date.now()) {
    const rows = usersModel.listExpiredActiveClients(this.store, now).map(usersModel.toUser);
    let changed = 0;
    for (const user of rows) {
      if (await this.setEnabled(user, false, { force: true })) changed += 1;
    }
    if (changed) this.logger?.info(`已禁用 ${changed} 个套餐过期的面板客户端`);
    return changed;
  }
}
