import * as publicHandlers from './handlers-public.js';
import * as userHandlers from './handlers-user.js';
import * as adminHandlers from './handlers-admin.js';
import * as paymentHandlers from './handlers-payment.js';

export function createRoutes(services) {
  const wrap = (fn) => (ctx) => fn(ctx, services);
  return [
    { method: 'GET', path: '/api/health', auth: 'public', handler: wrap(publicHandlers.health) },
    { method: 'GET', path: '/api/config', auth: 'public', handler: wrap(publicHandlers.config) },
    { method: 'GET', path: '/api/plans', auth: 'public', handler: wrap(publicHandlers.plans) },

    { method: 'GET', path: '/api/auth/captcha', auth: 'public', csrf: false, handler: wrap(publicHandlers.captcha) },
    { method: 'POST', path: '/api/auth/register', auth: 'public', csrf: false, handler: wrap(publicHandlers.register) },
    { method: 'POST', path: '/api/auth/login', auth: 'public', csrf: false, handler: wrap(publicHandlers.login) },
    { method: 'POST', path: '/api/auth/logout', auth: 'public', csrf: false, handler: wrap(publicHandlers.logout) },

    { method: 'GET', path: '/api/me', auth: 'user', handler: wrap(userHandlers.me) },
    { method: 'GET', path: '/api/me/subscription', auth: 'user', handler: wrap(userHandlers.subscription) },
    { method: 'GET', path: '/api/me/orders', auth: 'user', handler: wrap(userHandlers.listOrders) },
    { method: 'GET', path: '/api/me/orders/:orderNo', auth: 'user', handler: wrap(userHandlers.getOrder) },
    { method: 'POST', path: '/api/me/purchase', auth: 'user', handler: wrap(userHandlers.purchase) },
    { method: 'POST', path: '/api/me/recharge', auth: 'user', handler: wrap(userHandlers.recharge) },
    { method: 'POST', path: '/api/me/redeem', auth: 'user', handler: wrap(userHandlers.redeemKey) },
    { method: 'POST', path: '/api/me/payments/:orderNo/mock-complete', auth: 'user', handler: wrap(userHandlers.mockComplete) },
    { method: 'POST', path: '/api/me/password', auth: 'user', handler: wrap(userHandlers.changePassword) },

    { method: 'POST', path: '/api/payment/notify/:provider', auth: 'public', csrf: false, handler: wrap(paymentHandlers.notify) },
    { method: 'GET', path: '/api/payment/return/:provider', auth: 'public', handler: wrap(paymentHandlers.paymentReturn) },

    { method: 'GET', path: '/api/admin/overview', auth: 'admin', handler: wrap(adminHandlers.overview) },
    { method: 'GET', path: '/api/admin/users', auth: 'admin', handler: wrap(adminHandlers.listUsers) },
    { method: 'POST', path: '/api/admin/users', auth: 'admin', handler: wrap(adminHandlers.createUser) },
    { method: 'GET', path: '/api/admin/users/:id', auth: 'admin', handler: wrap(adminHandlers.getUser) },
    { method: 'POST', path: '/api/admin/users/:id/status', auth: 'admin', handler: wrap(adminHandlers.setUserStatus) },
    { method: 'POST', path: '/api/admin/users/:id/balance', auth: 'admin', handler: wrap(adminHandlers.adjustBalance) },
    { method: 'POST', path: '/api/admin/users/:id/reset-password', auth: 'admin', handler: wrap(adminHandlers.resetUserPassword) },
    { method: 'DELETE', path: '/api/admin/users/:id', auth: 'admin', handler: wrap(adminHandlers.deleteUser) },
    { method: 'GET', path: '/api/admin/admins', auth: 'admin', handler: wrap(adminHandlers.listAdmins) },
    { method: 'POST', path: '/api/admin/admins', auth: 'admin', handler: wrap(adminHandlers.createAdmin) },
    { method: 'POST', path: '/api/admin/admins/:id/status', auth: 'admin', handler: wrap(adminHandlers.setAdminStatus) },
    { method: 'POST', path: '/api/admin/admins/:id/password', auth: 'admin', handler: wrap(adminHandlers.resetAdminPassword) },
    { method: 'DELETE', path: '/api/admin/admins/:id', auth: 'admin', handler: wrap(adminHandlers.deleteAdmin) },
    { method: 'GET', path: '/api/admin/plans', auth: 'admin', handler: wrap(adminHandlers.listPlans) },
    { method: 'POST', path: '/api/admin/plans', auth: 'admin', handler: wrap(adminHandlers.createPlan) },
    { method: 'PUT', path: '/api/admin/plans/:id', auth: 'admin', handler: wrap(adminHandlers.updatePlan) },
    { method: 'DELETE', path: '/api/admin/plans/:id', auth: 'admin', handler: wrap(adminHandlers.deletePlan) },
    { method: 'GET', path: '/api/admin/orders', auth: 'admin', handler: wrap(adminHandlers.listOrders) },
    { method: 'GET', path: '/api/admin/orders/:id', auth: 'admin', handler: wrap(adminHandlers.getOrder) },
    { method: 'POST', path: '/api/admin/orders/:id/mark-paid', auth: 'admin', handler: wrap(adminHandlers.markPaid) },
    { method: 'POST', path: '/api/admin/orders/:id/retry-provision', auth: 'admin', handler: wrap(adminHandlers.retryProvision) },
    { method: 'POST', path: '/api/admin/orders/:id/cancel', auth: 'admin', handler: wrap(adminHandlers.cancelOrder) },
    { method: 'GET', path: '/api/admin/recharges', auth: 'admin', handler: wrap(adminHandlers.listRecharges) },
    { method: 'GET', path: '/api/admin/redeem-keys', auth: 'admin', handler: wrap(adminHandlers.listRedeemKeys) },
    { method: 'POST', path: '/api/admin/redeem-keys', auth: 'admin', handler: wrap(adminHandlers.createRedeemKeys) },
    { method: 'POST', path: '/api/admin/redeem-keys/:id/revoke', auth: 'admin', handler: wrap(adminHandlers.revokeRedeemKey) },
    { method: 'GET', path: '/api/admin/settings', auth: 'admin', handler: wrap(adminHandlers.settings) },
    { method: 'PUT', path: '/api/admin/settings', auth: 'admin', handler: wrap(adminHandlers.updateSettings) },
    { method: 'POST', path: '/api/admin/settings/test-xui', auth: 'admin', handler: wrap(adminHandlers.testXui) },
    { method: 'GET', path: '/api/admin/update', auth: 'admin', handler: wrap(adminHandlers.updateStatus) },
    { method: 'POST', path: '/api/admin/update/check', auth: 'admin', handler: wrap(adminHandlers.checkUpdate) },
    { method: 'POST', path: '/api/admin/update/apply', auth: 'admin', handler: wrap(adminHandlers.applyUpdate) },
  ];
}
