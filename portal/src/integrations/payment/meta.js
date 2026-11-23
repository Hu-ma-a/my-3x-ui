export const PROVIDER_META = {
  balance: { id: 'balance', label: '余额支付', kind: 'balance' },
  mock: { id: 'mock', label: '模拟支付（测试）', kind: 'mock' },
  manual: { id: 'manual', label: '人工转账', kind: 'manual' },
  epay: { id: 'epay', label: '支付宝 / 微信（易支付）', kind: 'redirect' },
};

export function enabledProviderIds(csvValue) {
  return String(csvValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item && item !== 'balance' && PROVIDER_META[item]);
}
