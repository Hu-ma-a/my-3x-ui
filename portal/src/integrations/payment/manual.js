export function createManualProvider({ portal }) {
  return {
    id: 'manual',
    kind: 'manual',
    createPayment() {
      return {
        type: 'manual',
        instructions: portal.manualPayInstructions || '请完成转账后联系管理员确认订单。',
      };
    },
    verifyNotify() {
      return { ok: false, error: '人工转账由管理员确认，不支持异步回调' };
    },
  };
}
