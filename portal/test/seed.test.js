import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { XuiMock } from '../src/integrations/xui-mock.js';
import { createClient, expectOk, buildConfig } from './helpers.js';

describe('数据库初始化与重启持久化', () => {
  it('重启不重复种子数据，设置修改保留', async () => {
    const { config, dir } = buildConfig();
    let app = null;
    try {
      app = createApp({ config, logger: createLogger('error'), xuiMock: new XuiMock() });
      let address = await app.listen(0, '127.0.0.1');
      let admin = createClient(`http://127.0.0.1:${address.port}`);
      await admin.adminLogin();

      const plans = expectOk(await admin.get('/api/admin/plans'));
      assert.equal(plans.items.length, 1, '首次启动只种子一个默认套餐');
      assert.equal(plans.items[0].name, '标准套餐');
      assert.equal(plans.items[0].days, 30);
      assert.equal(plans.items[0].trafficGb, 500);
      assert.equal(plans.items[0].deviceLimit, 3);
      assert.equal(plans.items[0].periodLabel, '期');

      const users = expectOk(await admin.get('/api/admin/users'));
      assert.equal(users.total, 1, '首次启动只创建一个管理员');
      assert.equal(users.items[0].role, 'admin');

      expectOk(await admin.put('/api/admin/settings', { 'portal.name': '重启后仍然存在' }));
      await app.close();
      app = null;

      app = createApp({ config, logger: createLogger('error'), xuiMock: new XuiMock() });
      address = await app.listen(0, '127.0.0.1');
      admin = createClient(`http://127.0.0.1:${address.port}`);
      const login = await admin.adminLogin();
      assert.equal(login.user.role, 'admin', '重启后管理员密码仍然有效');

      const publicConfig = expectOk(await admin.get('/api/config'));
      assert.equal(publicConfig.portalName, '重启后仍然存在', '修改后的设置应持久化');

      const plansAfter = expectOk(await admin.get('/api/admin/plans'));
      assert.equal(plansAfter.items.length, 1, '重启不得重复种子套餐');
      const usersAfter = expectOk(await admin.get('/api/admin/users'));
      assert.equal(usersAfter.total, 1, '重启不得重复创建管理员');
    } finally {
      if (app) await app.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // 忽略 Windows 上的延迟句柄释放。
      }
    }
  });

  it('默认门户名不含上游品牌，旧默认值重启后自动迁移', async () => {
    const { config, dir } = buildConfig();
    let app = null;
    try {
      app = createApp({ config, logger: createLogger('error'), xuiMock: new XuiMock() });
      let address = await app.listen(0, '127.0.0.1');
      let client = createClient(`http://127.0.0.1:${address.port}`);
      const fresh = expectOk(await client.get('/api/config'), '首次启动配置');
      assert.equal(fresh.portalName, '用户中心', '默认门户名不应包含上游品牌字样');

      app.store.run("UPDATE settings SET value = '3x-ui 用户中心' WHERE key = 'portal.name'");
      await app.close();
      app = null;

      app = createApp({ config, logger: createLogger('error'), xuiMock: new XuiMock() });
      address = await app.listen(0, '127.0.0.1');
      client = createClient(`http://127.0.0.1:${address.port}`);
      const migrated = expectOk(await client.get('/api/config'), '迁移后的配置');
      assert.equal(migrated.portalName, '用户中心', '旧默认品牌名应自动迁移');
    } finally {
      if (app) await app.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // 忽略清理失败。
      }
    }
  });

  it('不同数据库实例互相隔离', async () => {
    const first = buildConfig();
    const second = buildConfig();
    const appFirst = createApp({ config: first.config, logger: createLogger('error'), xuiMock: new XuiMock() });
    const appSecond = createApp({ config: second.config, logger: createLogger('error'), xuiMock: new XuiMock() });
    try {
      const addressFirst = await appFirst.listen(0, '127.0.0.1');
      const addressSecond = await appSecond.listen(0, '127.0.0.1');
      const clientFirst = createClient(`http://127.0.0.1:${addressFirst.port}`);
      const clientSecond = createClient(`http://127.0.0.1:${addressSecond.port}`);
      await clientFirst.register('only-in-first', 'password123');
      expectOk(await clientSecond.get('/api/config'), '第二个实例');
      const failed = await clientSecond.post('/api/auth/login', { username: 'only-in-first', password: 'password123' });
      assert.equal(failed.status, 401, '另一个实例不应看到本实例的用户');
    } finally {
      await appFirst.close();
      await appSecond.close();
      try {
        rmSync(first.dir, { recursive: true, force: true });
        rmSync(second.dir, { recursive: true, force: true });
      } catch {
        // 忽略清理失败。
      }
    }
  });

  it('旧数据库启动时自动补上套餐 period_label 列', async () => {
    const { config, dir } = buildConfig();
    const legacy = new DatabaseSync(config.dbPath);
    legacy.exec(`CREATE TABLE plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL,
      days INTEGER NOT NULL,
      traffic_gb REAL NOT NULL DEFAULT 0,
      device_limit INTEGER NOT NULL DEFAULT 0,
      inbound_ids TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      featured INTEGER NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    legacy.exec(`INSERT INTO plans(name, description, price_cents, days, traffic_gb, device_limit, inbound_ids,
      enabled, featured, sort, created_at, updated_at) VALUES ('旧套餐', '', 1000, 30, 10, 1, '', 1, 0, 0, 1, 1)`);
    legacy.close();

    const app = createApp({ config, logger: createLogger('error'), xuiMock: new XuiMock() });
    try {
      const address = await app.listen(0, '127.0.0.1');
      const admin = createClient(`http://127.0.0.1:${address.port}`);
      await admin.adminLogin();
      const plans = expectOk(await admin.get('/api/admin/plans'));
      const legacyPlan = plans.items.find((plan) => plan.name === '旧套餐');
      assert.ok(legacyPlan, '旧套餐应保留');
      assert.equal(legacyPlan.periodLabel, '期', '迁移后默认计费单位为「期」');
    } finally {
      await app.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // 忽略清理失败。
      }
    }
  });
});
