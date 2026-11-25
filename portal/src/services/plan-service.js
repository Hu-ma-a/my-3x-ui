import * as planModel from '../models/plans.js';
import { errors } from '../util/errors.js';
import { bool, int, number, intList, str, optionalStr } from '../util/validate.js';

function assertPlan(data) {
  if (!data.name) throw errors.validation('套餐名称不能为空');
  if (data.days < 1) throw errors.validation('有效期天数必须大于 0');
  if (data.priceCents < 0) throw errors.validation('价格不能为负数');
  if (data.trafficGb < 0) throw errors.validation('流量不能为负数');
  if (data.deviceLimit < 0) throw errors.validation('设备数不能为负数');
}

export class PlanService {
  constructor(store) {
    this.store = store;
  }

  listEnabled() {
    return planModel.list(this.store, { enabledOnly: true }).map(planModel.toPlan);
  }

  listAll() {
    return planModel.list(this.store).map(planModel.toPlan);
  }

  find(id) {
    return planModel.toPlan(planModel.find(this.store, id));
  }

  requireEnabled(id) {
    const plan = this.find(id);
    if (!plan) throw errors.notFound('plan_not_found', '套餐不存在');
    if (!plan.enabled) throw errors.badRequest('plan_disabled', '该套餐已下架');
    return plan;
  }

  create(body) {
    const data = parsePlanBody(body, null);
    assertPlan(data);
    const id = planModel.create(this.store, data);
    return this.find(id);
  }

  update(id, body) {
    const current = this.find(id);
    if (!current) throw errors.notFound('plan_not_found', '套餐不存在');
    const data = parsePlanBody(body, current);
    assertPlan(data);
    planModel.update(this.store, id, data);
    return this.find(id);
  }

  remove(id) {
    const current = this.find(id);
    if (!current) throw errors.notFound('plan_not_found', '套餐不存在');
    if (planModel.countOrders(this.store, id) > 0) {
      planModel.disable(this.store, id);
      return { ok: true, disabled: true };
    }
    planModel.remove(this.store, id);
    return { ok: true, disabled: false };
  }
}

function normalizeFeatures(source, current) {
  if (source.features === undefined) return current ? current.features || [] : [];
  const raw = Array.isArray(source.features) ? source.features : String(source.features).split(/\r?\n/);
  const list = raw.map((item) => String(item).trim()).filter(Boolean);
  if (list.length > 12) throw errors.validation('套餐特性最多 12 条');
  for (const item of list) {
    if ([...item].length > 80) throw errors.validation('每条套餐特性不能超过 80 个字符');
  }
  return list;
}

function parsePlanBody(body, current) {
  const source = body || {};
  const name = str(source, 'name', { label: '套餐名称', min: 1, max: 64, required: !current }).trim();
  const description = optionalStr(source, 'description', { label: '套餐描述', max: 255 });
  const priceCents = source.priceCents === undefined && current ? current.priceCents : int(source, 'priceCents', { label: '价格(分)', min: 0, max: 100000000 });
  const days = source.days === undefined && current ? current.days : int(source, 'days', { label: '有效期天数', min: 1, max: 3650 });
  const periodLabel = source.periodLabel === undefined && current
    ? current.periodLabel
    : (optionalStr(source, 'periodLabel', { label: '计费单位', max: 8 }) || (current ? current.periodLabel : '期'));
  const features = normalizeFeatures(source, current);
  const trafficGb = source.trafficGb === undefined && current ? current.trafficGb : number(source, 'trafficGb', { label: '流量(GB)', min: 0, max: 1024 * 1024 });
  const deviceLimit = source.deviceLimit === undefined && current ? current.deviceLimit : int(source, 'deviceLimit', { label: '设备数', min: 0, max: 1000 });
  const inboundIds = source.inboundIds === undefined && current ? current.inboundIds : intList(source, 'inboundIds', { label: '绑定入站' });
  const enabled = source.enabled === undefined ? (current ? current.enabled : true) : bool(source, 'enabled');
  const featured = source.featured === undefined ? (current ? current.featured : false) : bool(source, 'featured');
  const sort = source.sort === undefined ? (current ? current.sort : 0) : int(source, 'sort', { label: '排序', min: 0, max: 1000000 });
  return {
    name: name || current?.name,
    description: source.description === undefined && current ? current.description : description,
    priceCents,
    days,
    periodLabel,
    features,
    trafficGb,
    deviceLimit,
    inboundIds,
    enabled,
    featured,
    sort,
  };
}
