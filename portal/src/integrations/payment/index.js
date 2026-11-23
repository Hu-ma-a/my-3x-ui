import { errors } from '../../util/errors.js';
import { createMockProvider } from './mock.js';
import { createManualProvider } from './manual.js';
import { createEpayProvider } from './epay.js';
import { PROVIDER_META, enabledProviderIds } from './meta.js';

export { PROVIDER_META, enabledProviderIds };

export function createPaymentProvider(id, { settings }) {
  const payment = settings.paymentConfig();
  if (!payment.providers.includes(id)) {
    throw errors.badRequest('provider_unavailable', '该支付方式未启用');
  }
  switch (id) {
    case 'mock':
      return createMockProvider();
    case 'manual':
      return createManualProvider({ portal: settings.portalConfig() });
    case 'epay':
      return createEpayProvider({ epay: payment.epay, portal: settings.portalConfig() });
    default:
      throw errors.badRequest('provider_unavailable', '不支持的支付方式');
  }
}

export function findPaymentProvider(id, { settings }) {
  for (const providerId of ['mock', 'manual', 'epay']) {
    if (providerId === id) return createPaymentProvider(id, { settings });
  }
  return null;
}
