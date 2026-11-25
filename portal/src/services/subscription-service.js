import { DAY_MS } from '../util/time.js';
import { newSubId } from '../util/ids.js';
import { errors } from '../util/errors.js';
import { normalizeClient } from '../integrations/xui-client.js';

const GB = 1024 * 1024 * 1024;
const VERIFY_TOLERANCE_MS = 2 * 60 * 1000;
const SUB_BASE_CACHE_MS = 60 * 1000;

export class SubscriptionService {
  constructor({ store, xui, settings, logger }) {
    this.store = store;
    this.xui = xui;
    this.settings = settings;
    this.logger = logger;
    this.subBaseCache = null;
  }

  clientEmailFor(user) {
    // 已有客户端保持原 email，避免改名导致旧客户端失联、套餐/订阅数据丢失。
    if (user.clientEmail) return user.clientEmail;
    const preferred = String(user.email || user.username || '').trim();
    if (preferred) return preferred;
    return `u${user.id}@portal`;
  }

  async resolveInboundIds(plan) {
    if (plan.inboundIds?.length) return plan.inboundIds;
    const defaults = this.settings.portalConfig().defaultInboundIds;
    if (defaults.length) return defaults;
    const inbounds = (await this.xui.client().listInbounds()) || [];
    const enabled = inbounds.filter((item) => item.enable !== false);
    const usable = enabled.length ? enabled : inbounds;
    if (!usable.length) {
      throw errors.badRequest('no_inbound', '面板中没有任何可用入站，请先在面板创建入站或配置默认入站');
    }
    // 未指定套餐/默认入站时，客户端默认关联全部入站。
    return usable.map((item) => Number(item.id));
  }

  planTrafficBytes(plan) {
    if (Number.isFinite(Number(plan.trafficBytes))) return Math.round(Number(plan.trafficBytes));
    return Math.round(Number(plan.trafficGb || 0) * GB);
  }

  async computeTarget(user, plan, now = Date.now()) {
    const email = this.clientEmailFor(user);
    const current = await this.xui.client().getClient(email);
    const trafficBytes = this.planTrafficBytes(plan);
    if (!current || !current.subId) {
      return {
        mode: 'create',
        clientEmail: email,
        subId: current?.subId || newSubId(),
        expectedExpiry: now + Number(plan.days) * DAY_MS,
        expectedTotal: trafficBytes,
        expectedLimit: Number(plan.deviceLimit) || 0,
        inboundIds: await this.resolveInboundIds(plan),
      };
    }
    const unlimitedExpiry = current.expiryMs === 0;
    const unlimitedTraffic = current.totalBytes === 0;
    return {
      mode: 'extend',
      clientEmail: email,
      subId: current.subId,
      expectedExpiry: unlimitedExpiry ? 0 : Math.max(now, current.expiryMs) + Number(plan.days) * DAY_MS,
      expectedTotal: unlimitedTraffic ? 0 : current.totalBytes + trafficBytes,
      expectedLimit: current.limitHwid === 0 ? 0 : current.limitHwid + (Number(plan.deviceLimit) || 0),
      inboundIds: current.inboundIds,
    };
  }

  async verifyApplied(target) {
    const current = await this.xui.client().getClient(target.clientEmail);
    if (!current) return false;
    if (target.expectedExpiry === 0) {
      if (current.expiryMs !== 0) return false;
    } else if (Math.abs((current.expiryMs || 0) - target.expectedExpiry) > VERIFY_TOLERANCE_MS) {
      return false;
    }
    if (Number(current.totalBytes || 0) !== Number(target.expectedTotal)) return false;
    if (Number(current.limitHwid || 0) !== Number(target.expectedLimit)) return false;
    return true;
  }

  async applyTarget(target, plan, user) {
    const client = this.xui.client();
    const patch = {
      totalGB: target.expectedTotal,
      expiryTime: target.expectedExpiry,
      limitHwid: target.expectedLimit,
      subId: target.subId,
      enable: true,
    };
    if (target.mode === 'create') {
      try {
        await client.createClient({
          client: {
            email: target.clientEmail,
            totalGB: target.expectedTotal,
            expiryTime: target.expectedExpiry,
            limitHwid: target.expectedLimit,
            limitIp: 0,
            subId: target.subId,
            enable: true,
            comment: `portal:${user.username}`,
            reset: 0,
          },
          inboundIds: target.inboundIds,
        });
        return;
      } catch (err) {
        // 客户端已存在（并发/重试）：改为按目标绝对值覆盖，绝不重复累加。
        const existing = await client.getClient(target.clientEmail).catch(() => null);
        if (!existing) throw err;
        this.logger?.warn(`客户端 ${target.clientEmail} 已存在，改为按目标值更新`);
      }
    }
    await client.updateClient(target.clientEmail, patch);
  }

  snapshotFor(user, plan, target, now = Date.now()) {
    return {
      clientEmail: target.clientEmail,
      subId: target.subId,
      planId: plan.id,
      planName: plan.name,
      planStartedAt: now,
      planExpiresAt: target.expectedExpiry || null,
      totalBytes: target.expectedTotal,
      clientLimit: target.expectedLimit,
    };
  }

  async liveForUser(user) {
    const empty = {
      available: true,
      enabled: false,
      expiresAt: null,
      totalBytes: 0,
      usedBytes: 0,
      remainingBytes: 0,
      deviceLimit: 0,
      subId: null,
      subscriptionUrl: null,
      links: [],
      error: null,
    };
    if (!user.clientEmail) return empty;
    try {
      const current = await this.xui.client().getClient(user.clientEmail);
      if (!current) {
        return {
          ...empty,
          available: false,
          error: '面板中未找到该客户端，购买套餐后会自动创建',
          expiresAt: user.planExpiresAt,
          totalBytes: user.totalBytes,
          deviceLimit: user.clientLimit,
          subId: user.subId,
        };
      }
      let links = [];
      if (current.subId) {
        try {
          links = (await this.xui.client().subLinks(current.subId)) || [];
        } catch (err) {
          this.logger?.debug('读取订阅链接失败：', err.message);
        }
      }
      const totalBytes = current.totalBytes || 0;
      const usedBytes = current.usedBytes || 0;
      return {
        available: true,
        enabled: current.enable,
        expiresAt: current.expiryMs || null,
        totalBytes,
        usedBytes,
        remainingBytes: totalBytes > 0 ? Math.max(0, totalBytes - usedBytes) : null,
        deviceLimit: current.limitHwid,
        subId: current.subId,
        subscriptionUrl: current.subId ? await this.subscriptionUrl(current.subId) : null,
        links,
        error: null,
      };
    } catch (err) {
      this.logger?.warn('读取面板客户端失败：', err.message);
      return {
        ...empty,
        available: false,
        error: `无法读取面板数据：${err.message}`,
        expiresAt: user.planExpiresAt,
        totalBytes: user.totalBytes,
        deviceLimit: user.clientLimit,
        subId: user.subId,
      };
    }
  }

  async subscriptionUrl(subId) {
    if (!subId) return null;
    const configured = this.settings.portalConfig().subscriptionBaseUrl;
    if (configured) return `${configured.replace(/\/+$/, '')}/${subId}`;
    const now = Date.now();
    if (this.subBaseCache && this.subBaseCache.expiresAt > now) return `${this.subBaseCache.base}/${subId}`;
    try {
      const panel = await this.xui.client().panelSettings();
      let base = '';
      if (panel?.subURI) base = panel.subURI;
      else if (panel?.subEnable && panel?.subPath) base = `${this.settings.xuiConfig().url.replace(/\/+$/, '')}${String(panel.subPath).startsWith('/') ? '' : '/'}${panel.subPath}`;
      if (!base) return null;
      this.subBaseCache = { base: base.replace(/\/+$/, ''), expiresAt: now + SUB_BASE_CACHE_MS };
      return `${this.subBaseCache.base}/${subId}`;
    } catch (err) {
      this.logger?.debug('推导订阅地址失败：', err.message);
      return null;
    }
  }

  toSnapshotClient(raw) {
    return normalizeClient(raw);
  }
}
