#!/usr/bin/env node
/**
 * 门户命令行工具：在 SSH / 服务器上修改账号密码、查看管理员列表。
 * 用法：portal set-password [用户名] [--generate]
 *       portal list-admins
 *       portal list-users
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import readline from 'node:readline/promises';

import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { openStore } from '../src/db.js';
import { listAccounts, resetPasswordByUsername } from '../src/services/password-reset.js';

const ROLE_LABEL = { admin: '管理员', user: '用户' };
const STATUS_LABEL = { active: '正常', disabled: '已禁用', banned: '已封禁' };

function usage() {
  console.log(`用户门户命令行工具

用法：
  portal set-password [用户名] [--generate]   修改密码（不填用户名默认第一个管理员）
  portal list-admins                          列出管理员
  portal list-users                           列出全部账号
  portal --help                               显示本帮助

选项：
  --generate           生成随机密码并打印一次（推荐，避免密码出现在历史记录）
  --password VALUE     直接指定密码（会留在 shell 历史里，谨慎使用）
  --env-file PATH      门户配置文件，默认自动尝试 /etc/portal/portal.env
  --db PATH            直接指定 SQLite 数据库路径

示例：
  sudo portal set-password
  sudo portal set-password admin
  sudo portal set-password --generate admin
`);
}

function parseArgs(argv) {
  const options = { envFile: '', dbPath: '', generate: false, password: '', positional: [], help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env-file') {
      options.envFile = argv[++index] || '';
    } else if (arg === '--db') {
      options.dbPath = argv[++index] || '';
    } else if (arg === '--generate') {
      options.generate = true;
    } else if (arg === '--password') {
      options.password = argv[++index] || '';
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`未知参数：${arg}`);
    } else {
      options.positional.push(arg);
    }
  }
  return options;
}

function formatTime(ms) {
  if (!ms) return '—';
  const date = new Date(Number(ms));
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function printAccounts(items) {
  if (!items.length) {
    console.log('（没有账号）');
    return;
  }
  const rows = items.map((item) => [
    String(item.id),
    item.username,
    ROLE_LABEL[item.role] || item.role,
    STATUS_LABEL[item.status] || item.status,
    formatTime(item.lastLoginAt),
  ]);
  const header = ['ID', '用户名', '角色', '状态', '最近登录'];
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => [...row[column]].length)),
  );
  const line = (cells) => cells.map((cell, column) => cell + ' '.repeat(widths[column] - [...cell].length)).join('  ');
  console.log(line(header));
  console.log(widths.map((width) => '─'.repeat(width)).join('  '));
  for (const row of rows) console.log(line(row));
}

async function promptHidden(label) {
  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const value = await rl.question(label);
    rl.close();
    return value;
  }
  return new Promise((resolve, reject) => {
    process.stdout.write(label);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const finish = (result, error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(result);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish(value);
        if (char === '\u0003') return finish('', new Error('已取消'));
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= ' ') value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function readNewPassword(options) {
  if (options.password) return options.password;
  if (options.generate) return crypto.randomBytes(12).toString('base64url');
  const first = await promptHidden('新密码（8–72 个字符）：');
  if (first.length < 8 || first.length > 72) throw new Error('密码长度需为 8–72 个字符');
  const second = await promptHidden('再次输入新密码：');
  if (first !== second) throw new Error('两次输入的密码不一致');
  return first;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  const command = options.positional[0] || '';
  if (!command) {
    usage();
    process.exitCode = 1;
    return;
  }

  let envFile = options.envFile;
  if (!envFile && fs.existsSync('/etc/portal/portal.env')) envFile = '/etc/portal/portal.env';
  if (!envFile && fs.existsSync('.env')) envFile = '.env';
  if (envFile) {
    if (!fs.existsSync(envFile)) throw new Error(`配置文件不存在：${envFile}`);
    try {
      process.loadEnvFile(envFile);
    } catch (err) {
      throw new Error(`读取配置文件失败（请用 sudo 运行）：${envFile}（${err.message}）`);
    }
  }

  const config = loadConfig(options.dbPath ? { dbPath: options.dbPath } : {});
  if (!fs.existsSync(config.dbPath)) {
    throw new Error(
      `找不到数据库：${config.dbPath}\n请用 sudo 运行，或通过 --db / --env-file 指定实际路径（systemd 部署默认 /opt/portal/data/portal.db）。`,
    );
  }

  const store = openStore(config, createLogger('error'));
  try {
    if (command === 'list-admins') {
      printAccounts(listAccounts(store, { role: 'admin' }));
      return;
    }
    if (command === 'list-users') {
      printAccounts(listAccounts(store));
      return;
    }
    if (command === 'set-password' || command === 'passwd') {
      let username = options.positional[1] || '';
      if (!username) {
        const admins = listAccounts(store, { role: 'admin' });
        if (!admins.length) throw new Error('没有找到管理员账号，请用 portal list-users 查看所有账号');
        username = admins[0].username;
        console.log(`未指定用户名，默认修改第一个管理员：${username}`);
      }
      const password = await readNewPassword(options);
      const account = resetPasswordByUsername(store, username, password);
      console.log(`已修改「${account.username}」（${ROLE_LABEL[account.role] || account.role}）的密码，相关登录会话已失效。`);
      if (options.generate) {
        console.log(`新密码：${password}`);
      }
      return;
    }
    throw new Error(`未知命令：${command}（portal --help 查看用法）`);
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error(`错误：${err && err.message ? err.message : String(err)}`);
  process.exitCode = 1;
});
