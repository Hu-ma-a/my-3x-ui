import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { openStore } from './db.js';
import { SettingsService } from './services/settings-service.js';
import { PlanService } from './services/plan-service.js';
import { AuthService } from './services/auth-service.js';
import { SubscriptionService } from './services/subscription-service.js';
import { ClientSyncService } from './services/client-sync-service.js';
import { OrderService } from './services/order-service.js';
import { AccountService } from './services/account-service.js';
import { AdminService } from './services/admin-service.js';
import { UpdateService } from './services/update-service.js';
import { RedeemService } from './services/redeem-service.js';
import { createXuiGateway } from './integrations/xui-gateway.js';
import { createRoutes } from './api/routes.js';
import { createHttpServer } from './http/server.js';
import { startProvisionRetryJob } from './jobs/provision-retry.js';

export function createApp(options = {}) {
  const config = options.config || loadConfig(options.configOverrides || {});
  const logger = options.logger || createLogger(config.logLevel);
  const store = openStore(config, logger);

  const settings = new SettingsService(store, config);
  const xui = createXuiGateway({ config, settings, logger, mock: options.xuiMock || null });
  const subscription = new SubscriptionService({ store, xui, settings, logger });
  const clientSync = new ClientSyncService({ store, xui, logger });
  const plans = new PlanService(store, clientSync);
  const auth = new AuthService({ store, settings, sessionTtlMs: config.sessionTtlMs });
  const orders = new OrderService({ store, settings, xui, subscription, logger, config });
  const account = new AccountService({ store, subscription });
  const admin = new AdminService({ store, settings, planService: plans, orderService: orders, subscription, authService: auth, xui, logger, clientSync });
  const update = new UpdateService({ config });
  const redeem = new RedeemService({ store, logger });

  const services = { store, config, logger, settings, xui, subscription, plans, auth, orders, account, admin, update, redeem, clientSync };
  const routes = createRoutes(services);
  const server = createHttpServer({ config, store, services, routes, logger });
  const retryJob = startProvisionRetryJob({ orders, logger });
  let expiryJob = null;

  return {
    config,
    logger,
    store,
    services,
    server,
    listen(port = config.port, host = config.host) {
      return new Promise((resolve, reject) => {
        const onError = (err) => reject(err);
        server.once('error', onError);
        server.listen(port, host, () => {
          server.removeListener('error', onError);
          resolve(server.address());
        });
      });
    },
    startMaintenance(intervalMs = 30000) {
      retryJob.start(intervalMs);
      if (expiryJob) return;
      // 每 5 分钟把套餐已过期的客户端在面板里禁用；unref 不阻止进程退出。
      const run = () => {
        clientSync.syncExpired().catch((err) => logger.warn(`同步过期客户端失败：${err.message || err}`));
      };
      run();
      expiryJob = setInterval(run, 5 * 60 * 1000);
      expiryJob.unref?.();
    },
    async close() {
      retryJob.stop();
      if (expiryJob) {
        clearInterval(expiryJob);
        expiryJob = null;
      }
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections?.();
      });
      store.close();
    },
  };
}
