import * as usersModel from '../models/users.js';
import * as ordersModel from '../models/orders.js';

export class AccountService {
  constructor({ store, subscription }) {
    this.store = store;
    this.subscription = subscription;
  }

  async overview(user, { csrfToken } = {}) {
    const live = await this.subscription.liveForUser(user);
    const recentOrders = ordersModel
      .listForUser(this.store, user.id, { limit: 5 })
      .map(ordersModel.toOrder);
    const fresh = usersModel.toUser(usersModel.findById(this.store, user.id));
    return { user: fresh, csrfToken: csrfToken || '', live, recentOrders };
  }

  async subscriptionInfo(user) {
    const live = await this.subscription.liveForUser(user);
    return {
      subId: live.subId,
      subscriptionUrl: live.subscriptionUrl,
      links: live.links,
      expiresAt: live.expiresAt,
      remainingBytes: live.remainingBytes,
      available: live.available,
      enabled: live.enabled,
      error: live.error,
    };
  }
}
