import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { hashPassword } from './auth/password.js';
import { buildSettingDefs } from './settings-defs.js';
import { newPassword } from './util/ids.js';

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  balance_cents INTEGER NOT NULL DEFAULT 0,
  client_email TEXT,
  sub_id TEXT,
  plan_id INTEGER,
  plan_name TEXT,
  plan_started_at INTEGER,
  plan_expires_at INTEGER,
  total_bytes INTEGER,
  client_limit INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER,
  login_epoch INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_client_email ON users(client_email) WHERE client_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  days INTEGER NOT NULL,
  traffic_gb REAL NOT NULL DEFAULT 0,
  device_limit INTEGER NOT NULL DEFAULT 0,
  inbound_ids TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_id INTEGER,
  plan_snapshot TEXT,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  pay_url TEXT,
  provider_trade_no TEXT,
  provider_payload TEXT,
  credit_applied INTEGER NOT NULL DEFAULT 0,
  provision_mode TEXT,
  client_email TEXT,
  sub_id TEXT,
  expected_expiry_ms INTEGER,
  expected_total INTEGER,
  expected_limit INTEGER,
  provision_attempts INTEGER NOT NULL DEFAULT 0,
  provision_error TEXT,
  paid_at INTEGER,
  provisioned_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
`;

export class Store {
  constructor(handle, logger) {
    this.handle = handle;
    this.logger = logger;
  }

  get(sql, ...params) {
    return this.handle.prepare(sql).get(...params);
  }

  all(sql, ...params) {
    return this.handle.prepare(sql).all(...params);
  }

  run(sql, ...params) {
    const result = this.handle.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  exec(sql) {
    this.handle.exec(sql);
  }

  tx(fn) {
    this.handle.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.handle.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.handle.exec('ROLLBACK');
      } catch {
        // 事务可能已被 SQLite 自动回滚，忽略二次回滚错误。
      }
      throw err;
    }
  }

  close() {
    try {
      this.handle.close();
    } catch {
      // 已关闭时重复调用不应影响进程退出。
    }
  }
}

export function openStore(config, logger) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const handle = new DatabaseSync(config.dbPath);
  handle.exec('PRAGMA journal_mode=WAL');
  handle.exec('PRAGMA foreign_keys=ON');
  handle.exec('PRAGMA busy_timeout=5000');
  handle.exec(SCHEMA_SQL);
  const store = new Store(handle, logger);
  seedStore(store, config, logger);
  return store;
}

function seedStore(store, config, logger) {
  const now = Date.now();
  let generatedAdminPassword = '';
  store.tx(() => {
    const versionRow = store.get("SELECT value FROM schema_meta WHERE key = 'schema_version'");
    if (!versionRow) {
      store.run("INSERT INTO schema_meta(key, value) VALUES ('schema_version', ?)", String(SCHEMA_VERSION));
    } else if (Number(versionRow.value) < SCHEMA_VERSION) {
      store.run("UPDATE schema_meta SET value = ? WHERE key = 'schema_version'", String(SCHEMA_VERSION));
    }

    for (const item of buildSettingDefs(config)) {
      store.run('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING', item.key, item.default, now);
    }

    // 历史默认品牌名迁移：仅当仍是旧默认值时去掉上游品牌字样。
    store.run(
      "UPDATE settings SET value = '用户中心', updated_at = ? WHERE key = 'portal.name' AND value = '3x-ui 用户中心'",
      now,
    );

    const admin = store.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (!admin) {
      const password = config.seed.adminPassword || newPassword(14);
      if (!config.seed.adminPassword) generatedAdminPassword = password;
      store.run(
        'INSERT INTO users(username, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        config.seed.adminUsername,
        hashPassword(password),
        'admin',
        'active',
        now,
        now,
      );
    }

    const planCount = store.get('SELECT COUNT(*) AS total FROM plans');
    if (Number(planCount.total) === 0) {
      store.run(
        `INSERT INTO plans(name, description, price_cents, days, traffic_gb, device_limit, inbound_ids, enabled, featured, sort, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        '标准套餐',
        '30 天有效期 · 500GB 流量 · 3 台设备',
        2990,
        30,
        500,
        3,
        '',
        1,
        1,
        0,
        now,
        now,
      );
    }
  });

  if (generatedAdminPassword) {
    logger.warn(`已创建管理员账号「${config.seed.adminUsername}」，初始密码：${generatedAdminPassword} （请登录后立即修改，此密码只显示一次）`);
  }
}
