export const SETTING_GROUPS = ['门户', '面板', '支付'];

function def(key, group, label, type, defaultValue) {
  return { key, group, label, type, default: String(defaultValue) };
}

export function buildSettingDefs(config) {
  const xui = config.seed.xui;
  const payment = config.seed.payment;
  const epay = payment.epay;
  return [
    def('portal.name', '门户', '门户名称', 'string', '用户中心'),
    def('portal.registrationEnabled', '门户', '开放注册', 'bool', 'true'),
    def('portal.currency', '门户', '货币代码', 'string', 'CNY'),
    def('portal.manualPayInstructions', '门户', '人工转账说明', 'text', '请完成转账后联系管理员确认订单。'),
    def('portal.defaultInboundIds', '门户', '默认入站 ID（逗号分隔）', 'csv', ''),
    def('portal.subscriptionBaseUrl', '门户', '订阅基地址（如 https://sub.example.com/sub/）', 'string', ''),
    def('portal.minRechargeCents', '门户', '最低充值（分）', 'int', '100'),
    def('portal.maxRechargeCents', '门户', '最高充值（分）', 'int', '1000000'),
    def('xui.url', '面板', '面板地址', 'string', xui.url),
    def('xui.basePath', '面板', '面板基础路径', 'string', xui.basePath),
    def('xui.apiToken', '面板', 'API Token（admin scope）', 'secret', xui.apiToken),
    def('xui.username', '面板', '面板用户名（无 Token 时回退）', 'string', xui.username),
    def('xui.password', '面板', '面板密码（无 Token 时回退）', 'secret', xui.password),
    def('xui.timeoutMs', '面板', '请求超时（毫秒）', 'int', String(xui.timeoutMs)),
    def('pay.providersEnabled', '支付', '启用的支付方式（mock,manual,epay）', 'providerCsv', payment.providers),
    def('pay.epay.url', '支付', '易支付网关地址', 'string', epay.url),
    def('pay.epay.pid', '支付', '易支付商户 PID', 'string', epay.pid),
    def('pay.epay.key', '支付', '易支付密钥', 'secret', epay.key),
    def('pay.epay.type', '支付', '易支付通道（alipay / wxpay）', 'string', epay.type),
    def('pay.epay.notifyUrl', '支付', '异步通知地址（留空自动推断）', 'string', ''),
    def('pay.epay.returnUrl', '支付', '同步跳回地址（留空自动推断）', 'string', ''),
    def('pay.mockAutoComplete', '支付', '模拟支付自动完成（仅测试）', 'bool', payment.mockAutoComplete ? 'true' : 'false'),
  ];
}

export function settingDefinitionMap(config) {
  return new Map(buildSettingDefs(config).map((item) => [item.key, item]));
}
