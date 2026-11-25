import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { XuiMock } from '../src/integrations/xui-mock.js';

const once = process.argv.includes('--once');
const demoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-demo-'));
const config = loadConfig({
  dataDir: demoDir,
  dbPath: path.join(demoDir, 'demo.db'),
  host: '127.0.0.1',
  port: once ? 0 : 8090,
  logLevel: 'warn',
});
config.seed.xui.mode = 'mock';
config.seed.adminPassword = 'admin12345';

const xui = new XuiMock();
const app = createApp({ config, xuiMock: xui, logger: createQuietLogger() });
const address = await app.listen(0, '127.0.0.1');
const baseUrl = `http://127.0.0.1:${address.port}`;

function createQuietLogger() {
  const noop = () => {};
  return { level: 'error', debug: noop, info: noop, warn: noop, error: console.error };
}

function createClient() {
  const cookies = new Map();
  let csrf = '';
  async function request(method, apiPath, body, { form } = {}) {
    const headers = { Accept: 'application/json' };
    if (cookies.size) headers.Cookie = [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
    let payload;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(form).toString();
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await fetch(`${baseUrl}${apiPath}`, { method, headers, body: payload, redirect: 'manual' });
    const list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const raw of list) {
      const pair = String(raw).split(';')[0];
      const index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (json?.ok && json.data && typeof json.data.csrfToken === 'string') csrf = json.data.csrfToken;
    if (!json?.ok) throw new Error(`${method} ${apiPath} 失败：${text}`);
    return json.data;
  }
  return {
    get: (p) => request('GET', p),
    post: (p, body) => request('POST', p, body),
    put: (p, body) => request('PUT', p, body),
  };
}

function line(title) {
  console.log(`\n▼ ${title}`);
}

function kv(label, value) {
  console.log(`  ${label.padEnd(14, ' ')} ${value}`);
}

const admin = createClient();
const user = createClient();

try {
  line('1. 公共接口');
  const health = await admin.get('/api/health');
  kv('服务状态', health.status);
  const publicConfig = await admin.get('/api/config');
  kv('门户名称', publicConfig.portalName);
  kv('支付方式', publicConfig.providers.map((provider) => provider.label).join('、'));

  line('2. 管理员登录并配置门户');
  await admin.post('/api/auth/login', { username: 'admin', password: 'admin12345' });
  await admin.put('/api/admin/settings', { 'portal.name': '演示云用户中心' });
  kv('管理员', 'admin / admin12345');

  line('3. 用户注册（带图形验证码）');
  const captcha = await user.get('/api/auth/captcha');
  const parts = String(captcha.question).match(/(\d+)\s*([+-])\s*(\d+)/);
  const captchaAnswer = parts
    ? String(parts[2] === '+' ? Number(parts[1]) + Number(parts[3]) : Number(parts[1]) - Number(parts[3]))
    : '';
  const registered = await user.post('/api/auth/register', {
    username: 'demo',
    password: 'demo12345',
    email: 'demo@example.com',
    captchaId: captcha.captchaId,
    captchaAnswer,
  });
  kv('用户', `${registered.user.username}（ID ${registered.user.id}）`);

  line('4. 管理员给用户充值余额 ¥500');
  const funded = await admin.post(`/api/admin/users/${registered.user.id}/balance`, { deltaCents: 50000 });
  kv('余额', `¥${(funded.balanceCents / 100).toFixed(2)}`);

  line('5. 购买套餐（余额支付）→ 自动调用 3x-ui 新增客户端');
  const plan = (await user.get('/api/plans')).plans[0];
  kv('套餐', `${plan.name}：${plan.days} 天 / ${plan.trafficGb}GB / ${plan.deviceLimit} 设备 / ¥${(plan.priceCents / 100).toFixed(2)}`);
  const first = await user.post('/api/me/purchase', { planId: plan.id, method: 'balance' });
  kv('订单状态', first.order.status);
  const clientEmail = registered.user.email || registered.user.username;
  const created = xui.clients.get(clientEmail);
  kv('3x-ui 客户端', clientEmail);
  kv('到期时间', new Date(created.expiryTime).toISOString().slice(0, 10));
  kv('总流量', `${(created.totalGB / 1024 ** 3).toFixed(0)}GB`);
  kv('设备数上限', String(created.limitHwid));

  line('6. 再次购买套餐（续期）→ 天数和额度累加');
  const second = await user.post('/api/me/purchase', { planId: plan.id, method: 'balance' });
  kv('订单状态', second.order.status);
  const renewed = xui.clients.get(clientEmail);
  kv('续期后到期', new Date(renewed.expiryTime).toISOString().slice(0, 10));
  kv('续期后流量', `${(renewed.totalGB / 1024 ** 3).toFixed(0)}GB`);
  kv('续期后设备数', String(renewed.limitHwid));

  line('7. 在线充值（模拟支付）');
  const recharge = await user.post('/api/me/recharge', { amountCents: 10000, provider: 'mock' });
  await user.post(`/api/me/payments/${recharge.order.orderNo}/mock-complete`);
  const meAfterRecharge = await user.get('/api/me');
  kv('充值后余额', `¥${(meAfterRecharge.user.balanceCents / 100).toFixed(2)}`);

  line('8. 在线购买套餐（模拟支付 → 自动开通）');
  const online = await user.post('/api/me/purchase', { planId: plan.id, method: 'online', provider: 'mock' });
  kv('支付页面', online.payment.payUrl);
  const paid = await user.post(`/api/me/payments/${online.order.orderNo}/mock-complete`);
  kv('订单状态', paid.status);

  line('9. 用户查看账号 / 套餐 / 到期 / 使用情况');
  const me = await user.get('/api/me');
  const live = me.live;
  kv('套餐', me.user.planName || '-');
  kv('到期时间', live.expiresAt ? new Date(live.expiresAt).toISOString().slice(0, 16).replace('T', ' ') : '不限');
  kv('流量已用', `${(live.usedBytes / 1024 ** 3).toFixed(2)}GB / ${live.totalBytes ? `${(live.totalBytes / 1024 ** 3).toFixed(0)}GB` : '不限'}`);
  kv('订阅地址', live.subscriptionUrl || '（未生成）');
  kv('设备数上限', String(live.deviceLimit));

  line('10. 管理员查看统计');
  const overview = await admin.get('/api/admin/overview');
  kv('用户数', `${overview.users.total}（正常 ${overview.users.active}）`);
  kv('订单数', `${overview.orders.total}（待支付 ${overview.orders.pending}）`);
  kv('总收入', `¥${(overview.revenue.totalCents / 100).toFixed(2)}`);
  kv('充值总额', `¥${(overview.recharges.totalCents / 100).toFixed(2)}`);

  console.log('\n✅ 演示流程全部通过。');
  if (once) {
    await app.close();
    fs.rmSync(demoDir, { recursive: true, force: true });
    process.exit(0);
  }
  console.log(`
门户已启动，可在浏览器中体验：
  地址: ${baseUrl}
  管理员: admin / admin12345（登录后可进入「系统设置」）
  演示用户: demo / demo12345（已购买套餐并充值）
  3x-ui 使用内置模拟客户端，不会改动真实面板。按 Ctrl+C 退出。`);
} catch (err) {
  console.error('\n✖ 演示失败：', err);
  await app.close();
  fs.rmSync(demoDir, { recursive: true, force: true });
  process.exit(1);
}

if (!once) {
  process.on('SIGINT', async () => {
    await app.close();
    fs.rmSync(demoDir, { recursive: true, force: true });
    process.exit(0);
  });
}
