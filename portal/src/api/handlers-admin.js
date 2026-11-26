import { email as validateEmail, int, pagination, password as validatePassword, str, username as validateUsername } from '../util/validate.js';

function idParam(ctx) {
  return int(ctx.params, 'id', { label: 'ID', min: 1 });
}

function parseListQuery(ctx) {
  const { page, pageSize } = pagination(ctx.query);
  return {
    page,
    pageSize,
    query: String(ctx.query.query || '').trim().slice(0, 100),
    status: String(ctx.query.status || '').trim(),
  };
}

export function overview(ctx, services) {
  return services.admin.overview();
}

export function listUsers(ctx, services) {
  return services.admin.listUsers(parseListQuery(ctx));
}

export async function createUser(ctx, services) {
  const body = await ctx.body();
  const username = validateUsername(body);
  const password = validatePassword(body);
  const email = validateEmail(body);
  return services.admin.createUser({ username, password, email });
}

export async function getUser(ctx, services) {
  return services.admin.getUser(idParam(ctx));
}

export async function setUserStatus(ctx, services) {
  const body = await ctx.body();
  const status = str(body, 'status', { label: '状态', min: 1, max: 16 });
  return services.admin.setUserStatus(idParam(ctx), status);
}

export async function adjustBalance(ctx, services) {
  const body = await ctx.body();
  return services.admin.adjustBalance(idParam(ctx), body.deltaCents, typeof body.note === 'string' ? body.note : '');
}

export async function resetUserPassword(ctx, services) {
  const body = await ctx.body();
  const newPassword = validatePassword(body, 'newPassword', { label: '新密码' });
  return services.admin.resetPassword(idParam(ctx), newPassword);
}

export function deleteUser(ctx, services) {
  return services.admin.deleteUser(ctx.user.id, idParam(ctx));
}

export function listAdmins(ctx, services) {
  return services.admin.listAdmins(ctx.user.id);
}

export async function createAdmin(ctx, services) {
  const body = await ctx.body();
  const username = validateUsername(body);
  const password = validatePassword(body);
  const email = validateEmail(body);
  return services.admin.createAdmin(ctx.user.id, { username, password, email });
}

export async function setAdminStatus(ctx, services) {
  const body = await ctx.body();
  const status = str(body, 'status', { label: '状态', min: 1, max: 16 });
  return services.admin.setAdminStatus(ctx.user.id, idParam(ctx), status);
}

export async function resetAdminPassword(ctx, services) {
  const body = await ctx.body();
  const newPassword = validatePassword(body, 'newPassword', { label: '新密码' });
  return services.admin.resetAdminPassword(ctx.user.id, idParam(ctx), newPassword);
}

export function deleteAdmin(ctx, services) {
  return services.admin.deleteAdmin(ctx.user.id, idParam(ctx));
}

export function listPlans(ctx, services) {
  return { items: services.plans.listAll() };
}

export async function createPlan(ctx, services) {
  const body = await ctx.body();
  return services.plans.create(body);
}

export async function updatePlan(ctx, services) {
  const body = await ctx.body();
  return services.plans.update(idParam(ctx), body);
}

export function deletePlan(ctx, services) {
  return services.plans.remove(idParam(ctx));
}

export function listOrders(ctx, services) {
  const { page, pageSize } = pagination(ctx.query);
  const kind = ctx.query.kind === 'plan' || ctx.query.kind === 'recharge' ? ctx.query.kind : '';
  return services.admin.listOrders({
    kind,
    status: String(ctx.query.status || '').trim(),
    query: String(ctx.query.query || '').trim().slice(0, 100),
    page,
    pageSize,
  });
}

export function getOrder(ctx, services) {
  return services.admin.getOrder(idParam(ctx));
}

export async function markPaid(ctx, services) {
  return services.admin.markPaid(idParam(ctx));
}

export async function retryProvision(ctx, services) {
  return services.admin.retryProvision(idParam(ctx));
}

export function cancelOrder(ctx, services) {
  return services.admin.cancelOrder(idParam(ctx));
}

export function listRecharges(ctx, services) {
  const { page, pageSize } = pagination(ctx.query);
  return services.admin.listOrders({
    kind: 'recharge',
    status: String(ctx.query.status || '').trim(),
    query: String(ctx.query.query || '').trim().slice(0, 100),
    page,
    pageSize,
  });
}

export function settings(ctx, services) {
  return { items: services.admin.settingsList() };
}

export async function updateSettings(ctx, services) {
  const body = await ctx.body();
  return { items: services.admin.updateSettings(body) };
}

export async function testXui(ctx, services) {
  return services.admin.testXui();
}

export function updateStatus(ctx, services) {
  return services.update.status();
}

export function checkUpdate(ctx, services) {
  return services.update.enqueue('check');
}

export function applyUpdate(ctx, services) {
  return services.update.enqueue('apply');
}

export function listRedeemKeys(ctx, services) {
  const { page, pageSize } = pagination(ctx.query);
  return services.redeem.list({
    page,
    pageSize,
    status: String(ctx.query.status || '').trim(),
    batch: String(ctx.query.batch || '').trim(),
    query: String(ctx.query.query || '').trim().slice(0, 100),
  });
}

export async function createRedeemKeys(ctx, services) {
  const body = await ctx.body();
  const amountCents = int(body, 'amountCents', { label: '充值金额', min: 1, max: 100000000 });
  const count = int(body, 'count', { label: '生成数量', min: 1, max: 100 });
  const days = body.days === undefined || body.days === null || body.days === ''
    ? 0
    : int(body, 'days', { label: '有效期天数', min: 0, max: 3650 });
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 120) : '';
  return services.redeem.generate({ amountCents, count, days, note, createdBy: ctx.user.id });
}

export function revokeRedeemKey(ctx, services) {
  return services.redeem.revoke(idParam(ctx));
}
