import * as userModel from '../models/users.js';
import * as sessionModel from '../models/sessions.js';
import * as sessionAuth from '../auth/session.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createLimiter } from '../http/security.js';
import { AppError, errors } from '../util/errors.js';
import { email as validateEmail, password as validatePassword, username as validateUsername } from '../util/validate.js';
import { sha256 } from '../util/ids.js';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

export class AuthService {
  constructor({ store, settings, sessionTtlMs }) {
    this.store = store;
    this.settings = settings;
    this.sessionTtlMs = sessionTtlMs;
    this.limiter = createLimiter({ windowMs: LOGIN_WINDOW_MS, max: LOGIN_MAX_ATTEMPTS });
  }

  register({ body, ip, userAgent }) {
    if (!this.settings.portalConfig().registrationEnabled) {
      throw errors.badRequest('registration_closed', '当前未开放注册');
    }
    const username = validateUsername(body);
    const password = validatePassword(body);
    const email = validateEmail(body);
    if (userModel.existsUsername(this.store, username)) {
      throw errors.conflict('username_taken', '该用户名已被占用');
    }
    if (email && userModel.existsEmail(this.store, email)) {
      throw errors.conflict('email_taken', '该邮箱已被注册');
    }
    const id = userModel.create(this.store, {
      username,
      email,
      passwordHash: hashPassword(password),
      role: 'user',
    });
    const user = userModel.toUser(userModel.findById(this.store, id));
    const session = this.createSession(user.id, { ip, userAgent });
    userModel.touchLogin(this.store, user.id);
    return { user, session };
  }

  login({ body, ip, userAgent }) {
    const username = String(body?.username ?? '').trim();
    const password = String(body?.password ?? '');
    if (!username || !password) throw errors.badRequest('invalid_credentials', '请输入用户名和密码');
    const key = `${ip}|${username.toLowerCase()}`;
    if (!this.limiter.allow(key).allowed) {
      throw errors.tooMany('登录尝试过于频繁，请 15 分钟后再试');
    }
    const row = userModel.findByUsername(this.store, username);
    if (!row || !verifyPassword(password, row.password_hash)) {
      this.limiter.fail(key);
      throw new AppError('invalid_credentials', '用户名或密码错误', 401);
    }
    if (row.status !== 'active') {
      throw new AppError('account_disabled', '账号已被禁用，请联系管理员', 403);
    }
    this.limiter.reset(key);
    const session = this.createSession(row.id, { ip, userAgent });
    userModel.touchLogin(this.store, row.id);
    return { user: userModel.toUser(userModel.findById(this.store, row.id)), session };
  }

  logout(token) {
    sessionAuth.destroy(this.store, token);
  }

  changePassword({ user, currentPassword, newPassword, currentToken }) {
    const row = userModel.findWithPassword(this.store, user.id);
    if (!row || !verifyPassword(String(currentPassword ?? ''), row.password_hash)) {
      throw errors.badRequest('invalid_password', '当前密码不正确');
    }
    const next = String(newPassword ?? '');
    if (next.length < 8 || next.length > 72) throw errors.validation('新密码长度需为 8-72 个字符');
    if (next === currentPassword) throw errors.validation('新密码不能与当前密码相同');
    userModel.setPassword(this.store, user.id, hashPassword(next));
    sessionModel.removeByUser(this.store, user.id, currentToken ? { exceptHash: sha256(currentToken) } : {});
  }

  resetPasswordByAdmin(userId, newPassword) {
    if (String(newPassword ?? '').length < 8 || String(newPassword).length > 72) {
      throw errors.validation('新密码长度需为 8-72 个字符');
    }
    userModel.setPassword(this.store, userId, hashPassword(String(newPassword)));
    sessionModel.removeByUser(this.store, userId);
  }

  createSession(userId, { ip, userAgent }) {
    return sessionAuth.issue(this.store, {
      userId,
      ttlMs: this.sessionTtlMs,
      ip,
      userAgent,
    });
  }
}
