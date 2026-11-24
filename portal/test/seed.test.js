import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
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
});
