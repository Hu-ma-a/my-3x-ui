import { hashPassword } from '../auth/password.js';
import * as userModel from '../models/users.js';
import * as sessionModel from '../models/sessions.js';
import { errors } from '../util/errors.js';

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;

export function listAccounts(store, { role = '' } = {}) {
  return userModel.listAll(store, { role }).map((row) => ({
    id: Number(row.id),
    username: row.username,
    role: row.role,
    status: row.status,
    email: row.email || '',
    createdAt: Number(row.created_at),
    lastLoginAt: row.last_login_at || null,
  }));
}

export function resetPasswordByUsername(store, username, newPassword) {
  const password = String(newPassword ?? '');
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw errors.validation('密码长度需为 8–72 个字符');
  }
  const target = String(username ?? '').trim();
  if (!target) throw errors.validation('请指定要修改密码的账号用户名');
  const row = userModel.findByUsername(store, target);
  if (!row) throw errors.notFound('user_not_found', `账号「${target}」不存在`);
  userModel.setPassword(store, row.id, hashPassword(password));
  sessionModel.removeByUser(store, row.id);
  return { id: Number(row.id), username: row.username, role: row.role };
}
