import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT_DIR = path.resolve(import.meta.dirname, '..');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

function envStr(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function envInt(name, fallback, min, max) {
  const raw = envStr(name, '');
  if (raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function loadDotEnv(file = path.join(ROOT_DIR, '.env')) {
  if (!fs.existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch (err) {
    console.warn(`[portal] 无法读取 .env：${err.message}`);
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveSecret(dataDir) {
  const fromEnv = envStr('PORTAL_SECRET');
  if (fromEnv.length >= 16) return fromEnv;
  if (fromEnv !== '') throw new Error('PORTAL_SECRET 太短，至少需要 16 个字符');
  const secretFile = path.join(dataDir, '.secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 16) return existing;
  } catch {
    // 首次启动：下面生成并落盘，保证重启后会话不失效。
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  console.warn(`[portal] 未设置 PORTAL_SECRET，已生成随机密钥并保存到 ${secretFile}`);
  return generated;
}

function normalizeBasePath(raw) {
  let value = (raw || '/').trim();
  if (!value.startsWith('/')) value = `/${value}`;
  if (!value.endsWith('/')) value = `${value}/`;
  return value;
}

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

export function loadConfig(overrides = {}) {
  // 先应用 overrides 再创建目录，避免调用方指定临时数据目录时仍在仓库里留下 ./data。
  const dataDir = ensureDir(path.resolve(ROOT_DIR, overrides.dataDir || envStr('PORTAL_DATA_DIR', 'data')));
  const dbPath = path.resolve(ROOT_DIR, overrides.dbPath || envStr('PORTAL_DB_PATH', path.join(dataDir, 'portal.db')));
  ensureDir(path.dirname(dbPath));

  const config = {
    rootDir: ROOT_DIR,
    publicDir: PUBLIC_DIR,
    dataDir,
    dbPath,
    host: overrides.host || envStr('PORTAL_HOST', '0.0.0.0'),
    port: overrides.port ?? envInt('PORTAL_PORT', 8090, 1, 65535),
    secret: overrides.secret || resolveSecret(dataDir),
    publicUrl: stripTrailingSlash(envStr('PORTAL_PUBLIC_URL')),
    trustProxy: envBool('PORTAL_TRUST_PROXY', false),
    logLevel: envStr('PORTAL_LOG_LEVEL', 'info'),
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    seed: {
      adminUsername: envStr('PORTAL_ADMIN_USERNAME', 'admin'),
      adminPassword: envStr('PORTAL_ADMIN_PASSWORD'),
      xui: {
        mode: envStr('PORTAL_XUI_MODE', 'real') === 'mock' ? 'mock' : 'real',
        url: stripTrailingSlash(envStr('XUI_URL', 'http://127.0.0.1:2053')),
        basePath: normalizeBasePath(envStr('XUI_BASE_PATH', '/')),
        apiToken: envStr('XUI_API_TOKEN'),
        username: envStr('XUI_USERNAME'),
        password: envStr('XUI_PASSWORD'),
        timeoutMs: envInt('XUI_TIMEOUT_MS', 15000, 1000, 120000),
      },
      payment: {
        providers: envStr('PAY_PROVIDERS', 'mock,manual,epay'),
        mockAutoComplete: envBool('PAY_MOCK_AUTO_COMPLETE', false),
        epay: {
          url: stripTrailingSlash(envStr('EPAY_URL')),
          pid: envStr('EPAY_PID'),
          key: envStr('EPAY_KEY'),
          type: envStr('EPAY_TYPE', 'alipay'),
        },
      },
    },
    ...overrides,
  };
  if (overrides.seed) {
    config.seed = { ...config.seed, ...overrides.seed, xui: { ...config.seed.xui, ...(overrides.seed.xui || {}) }, payment: { ...config.seed.payment, ...(overrides.seed.payment || {}) } };
  }
  return config;
}
