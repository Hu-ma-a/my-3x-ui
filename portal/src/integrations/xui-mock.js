import { XuiError, normalizeClient } from './xui-client.js';
import { newSubId } from '../util/ids.js';

export class XuiMock {
  constructor() {
    this.mode = 'mock';
    this.inbounds = [{ id: 1, remark: '演示入站', protocol: 'vless', port: 443, enable: true }];
    this.clients = new Map();
    this.usedTraffic = new Map();
    this.subLinksBySubId = new Map();
    this.settings = { subEnable: true, subPath: '/sub/', subURI: 'https://sub.example.com/sub/' };
    this.calls = [];
    this.offline = false;
    this.failures = [];
    this.nextId = 1;
  }

  setOffline(value) {
    this.offline = value;
  }

  failNext(operation, message = '模拟 3x-ui 失败') {
    this.failures.push({ operation, message });
  }

  setUsedBytes(email, bytes) {
    this.usedTraffic.set(email, Number(bytes) || 0);
  }

  reset() {
    this.clients.clear();
    this.usedTraffic.clear();
    this.calls = [];
    this.failures = [];
    this.offline = false;
    this.nextId = 1;
  }

  check(operation) {
    this.calls.push(operation);
    if (this.offline) throw new XuiError('模拟 3x-ui 离线');
    const index = this.failures.findIndex((item) => item.operation === operation);
    if (index >= 0) {
      const [failure] = this.failures.splice(index, 1);
      throw new XuiError(failure.message);
    }
  }

  async health() {
    this.check('health');
    return { xrayState: 'running' };
  }

  async listInbounds() {
    this.check('listInbounds');
    return this.inbounds.map((item) => ({ ...item }));
  }

  async panelSettings() {
    this.check('panelSettings');
    return { ...this.settings };
  }

  async listClients() {
    this.check('listClients');
    return [...this.clients.values()].map((record) => ({ ...record, inboundIds: [...record.inboundIds] }));
  }

  async getClientRaw(email) {
    this.check('getClient');
    const record = this.clients.get(String(email));
    if (!record) throw new XuiError('record not found');
    return {
      client: { ...record },
      inboundIds: [...record.inboundIds],
      usedTraffic: this.usedTraffic.get(record.email) || 0,
    };
  }

  async getClientTraffic(email) {
    this.check('getClientTraffic');
    const record = this.clients.get(String(email));
    if (!record) throw new XuiError('record not found');
    return { up: this.usedTraffic.get(record.email) || 0, down: 0, total: record.totalGB, expiryTime: record.expiryTime, enable: record.enable };
  }

  async getClient(email) {
    const record = this.clients.get(String(email));
    if (!record) return null;
    return normalizeClient(record, record.inboundIds, this.usedTraffic.get(record.email) || 0);
  }

  async createClient({ client, inboundIds }) {
    this.check('createClient');
    const email = String(client?.email || '').trim();
    if (!email) throw new XuiError('client email is required');
    if (this.clients.has(email)) throw new XuiError('client already exists');
    const ids = Array.isArray(inboundIds) && inboundIds.length ? inboundIds.map(Number) : [this.inbounds[0].id];
    const missing = ids.filter((id) => !this.inbounds.some((inbound) => inbound.id === id));
    if (missing.length) throw new XuiError(`inbound not found: ${missing.join(',')}`);
    const record = {
      id: this.nextId++,
      email,
      subId: client.subId || newSubId(),
      totalGB: Number(client.totalGB) || 0,
      expiryTime: Number(client.expiryTime) || 0,
      enable: client.enable !== false,
      limitIp: Number(client.limitIp) || 0,
      limitHwid: Number(client.limitHwid) || 0,
      comment: client.comment || '',
      reset: 0,
      inboundIds: ids,
    };
    this.clients.set(email, record);
    this.subLinksBySubId.set(record.subId, [`vless://mock-${record.subId}@mock.example.com:443?type=tcp#${encodeURIComponent(email)}`]);
    return { ...record };
  }

  async updateClient(email, patch) {
    this.check('updateClient');
    const record = this.clients.get(String(email));
    if (!record) throw new XuiError('record not found');
    if (patch.totalGB !== undefined) record.totalGB = Number(patch.totalGB) || 0;
    if (patch.expiryTime !== undefined) record.expiryTime = Number(patch.expiryTime) || 0;
    if (patch.limitHwid !== undefined) record.limitHwid = Number(patch.limitHwid) || 0;
    if (patch.limitIp !== undefined) record.limitIp = Number(patch.limitIp) || 0;
    if (patch.subId !== undefined) record.subId = String(patch.subId);
    if (patch.enable !== undefined) record.enable = Boolean(patch.enable);
    if (patch.comment !== undefined) record.comment = String(patch.comment);
    return { ...record };
  }

  async subLinks(subId) {
    this.check('subLinks');
    return this.subLinksBySubId.get(String(subId)) || [`vless://mock-${subId}@mock.example.com:443?type=tcp#mock`];
  }
}
