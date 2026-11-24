import * as settingsModel from '../models/settings.js';
import { settingDefinitionMap } from '../settings-defs.js';
import { errors } from '../util/errors.js';
import { PROVIDER_META, enabledProviderIds } from '../integrations/payment/meta.js';

export class SettingsService {
  constructor(store, config) {
    this.store = store;
    this.config = config;
    this.defs = settingDefinitionMap(config);
  }

  raw(key) {
    return settingsModel.get(this.store, key);
  }

  str(key, fallback = '') {
    const value = this.raw(key);
    return value === '' ? fallback : value;
  }

  int(key, fallback = 0) {
    const value = Number.parseInt(this.raw(key), 10);
    return Number.isFinite(value) ? value : fallback;
  }

  bool(key, fallback = false) {
    const value = this.raw(key);
    if (value === '') return fallback;
    return value === 'true' || value === '1';
  }

  csv(key) {
    return String(this.raw(key) || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  intCsv(key) {
    return this.csv(key)
      .map((item) => Number.parseInt(item, 10))
      .filter((item) => Number.isInteger(item) && item > 0);
  }

  xuiConfig() {
    return {
      url: this.str('xui.url', 'http://127.0.0.1:2053'),
      basePath: this.str('xui.basePath', '/'),
      apiToken: this.raw('xui.apiToken'),
      username: this.raw('xui.username'),
      password: this.raw('xui.password'),
      timeoutMs: this.int('xui.timeoutMs', 15000),
    };
  }

  paymentConfig() {
    return {
      providers: enabledProviderIds(this.raw('pay.providersEnabled')),
      mockAutoComplete: this.bool('pay.mockAutoComplete', false),
      epay: {
        url: this.str('pay.epay.url'),
        pid: this.str('pay.epay.pid'),
        key: this.raw('pay.epay.key'),
        type: this.str('pay.epay.type', 'alipay'),
        notifyUrl: this.str('pay.epay.notifyUrl'),
        returnUrl: this.str('pay.epay.returnUrl'),
      },
    };
  }

  portalConfig() {
    return {
      name: this.str('portal.name', '用户中心'),
      registrationEnabled: this.bool('portal.registrationEnabled', true),
      currency: this.str('portal.currency', 'CNY'),
      manualPayInstructions: this.str('portal.manualPayInstructions'),
      defaultInboundIds: this.intCsv('portal.defaultInboundIds'),
      subscriptionBaseUrl: this.str('portal.subscriptionBaseUrl'),
      minRechargeCents: this.int('portal.minRechargeCents', 100),
      maxRechargeCents: this.int('portal.maxRechargeCents', 1000000),
    };
  }

  publicConfig() {
    const portal = this.portalConfig();
    return {
      portalName: portal.name,
      registrationEnabled: portal.registrationEnabled,
      currency: portal.currency,
      providers: [PROVIDER_META.balance, ...this.enabledProviderMeta()],
      manualInstructions: portal.manualPayInstructions,
      minRechargeCents: portal.minRechargeCents,
      maxRechargeCents: portal.maxRechargeCents,
    };
  }

  enabledProviderMeta() {
    return this.paymentConfig().providers.map((id) => PROVIDER_META[id]).filter(Boolean);
  }

  adminList() {
    return [...this.defs.values()].map((def) => {
      const value = this.raw(def.key);
      if (def.type === 'secret') {
        return { key: def.key, group: def.group, label: def.label, type: def.type, value: '', hasValue: value !== '' };
      }
      return { key: def.key, group: def.group, label: def.label, type: def.type, value };
    });
  }

  updateMany(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw errors.validation('设置内容格式错误');
    }
    const changed = [];
    for (const [key, rawValue] of Object.entries(patch)) {
      const def = this.defs.get(key);
      if (!def) throw errors.validation(`未知设置项：${key}`);
      const value = normalizeValue(def, rawValue);
      settingsModel.set(this.store, key, value);
      changed.push(key);
    }
    this.assertRechargeRange();
    return changed;
  }

  assertRechargeRange() {
    const portal = this.portalConfig();
    if (portal.minRechargeCents < 1 || portal.minRechargeCents > portal.maxRechargeCents) {
      throw errors.validation('充值金额范围设置不正确：最低金额必须大于 0 且不超过最高金额');
    }
  }
}

function normalizeValue(def, rawValue) {
  if (rawValue === null || rawValue === undefined) return '';
  switch (def.type) {
    case 'bool': {
      if (rawValue === true || rawValue === 'true' || rawValue === '1') return 'true';
      if (rawValue === false || rawValue === 'false' || rawValue === '0') return 'false';
      throw errors.validation(`${def.label}必须是布尔值`);
    }
    case 'int': {
      const value = Number(rawValue);
      if (!Number.isInteger(value) || value < 0 || value > 100000000) {
        throw errors.validation(`${def.label}必须是非负整数`);
      }
      return String(value);
    }
    case 'csv': {
      const items = String(rawValue)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      for (const item of items) {
        if (!/^\d+$/.test(item)) throw errors.validation(`${def.label}只能是逗号分隔的数字`);
      }
      return items.join(',');
    }
    case 'secret':
      return String(rawValue ?? '').trim();
    default: {
      const value = String(rawValue ?? '').trim();
      if (value.length > 4096) throw errors.validation(`${def.label}过长`);
      return value;
    }
  }
}
