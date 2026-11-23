export function createMockProvider() {
  return {
    id: 'mock',
    kind: 'mock',
    createPayment({ order, publicBaseUrl }) {
      return {
        type: 'mock',
        payUrl: `${publicBaseUrl}/#/pay/mock?orderNo=${encodeURIComponent(order.orderNo)}`,
      };
    },
    verifyNotify() {
      return { ok: false, error: '模拟支付不支持异步回调' };
    },
  };
}
