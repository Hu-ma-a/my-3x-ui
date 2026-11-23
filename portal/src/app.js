import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { openStore } from './db.js';
import { SettingsService } from './services/settings-service.js';
import { PlanService } from './services/plan-service.js';
import { AuthService } from './services/auth-service.js';
import { SubscriptionService } from './services/subscription-service.js';
import { OrderService } from './services/order-service.js';
import { AccountService } from './services/account-service.js';
import { AdminService } from './services/admin-service.js';
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
  const plans = new PlanService(store);
  const auth = new AuthService({ store, settings, sessionTtlMs: config.sessionTtlMs });
  const orders = new OrderService({ store, settings, xui, subscription, logger, config });
  const account = new AccountService({ store, subscription });
  const admin = new AdminService({ store, settings, planService: plans, orderService: orders, subscription, authService: auth, xui, logger });

  const services = { store, config, logger, settings, xui, subscription, plans, auth, orders, account, admin };
  const routes = createRoutes(services);
  const server = createHttpServer({ config, store, services, routes, logger });
  const retryJob = startProvisionRetryJob({ orders, logger });

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
    },
    async close() {
      retryJob.stop();
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections?.();
      });
      store.close();
    },
  };
}
