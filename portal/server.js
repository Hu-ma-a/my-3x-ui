import { loadDotEnv } from './src/config.js';
import { createApp } from './src/app.js';

loadDotEnv();

const app = createApp();
const { config, logger } = app;

let address;
try {
  address = await app.listen();
} catch (err) {
  logger.error(`启动失败：${err.message}`);
  process.exit(1);
}

app.startMaintenance(30000);

const localHost = address.address === '::' || address.address === '0.0.0.0' ? '127.0.0.1' : address.address;
const lines = [
  '============================================================',
  ' 3x-ui 用户门户已启动',
  ` 访问地址:  http://${localHost}:${address.port}`,
  ` 数据文件:  ${config.dbPath}`,
  ` 3x-ui:    ${config.seed.xui.mode === 'mock' ? '内置模拟模式（仅演示/测试）' : `${config.seed.xui.url}${config.seed.xui.basePath}`}`,
  ' 首次部署请用管理员账号登录，到「系统设置」测试 3x-ui 连接并配置支付。',
  '============================================================',
];
console.log(lines.join('\n'));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`收到 ${signal}，正在关闭…`);
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
