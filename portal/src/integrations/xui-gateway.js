import { XuiClient } from './xui-client.js';
import { XuiMock } from './xui-mock.js';

export function createXuiGateway({ config, settings, logger, mock = null }) {
  if (mock) return { mode: 'mock', mock, client: () => mock };
  if (config.seed.xui.mode === 'mock') {
    const instance = new XuiMock();
    return { mode: 'mock', mock: instance, client: () => instance };
  }
  return { mode: 'real', mock: null, client: () => new XuiClient(settings.xuiConfig(), logger) };
}
