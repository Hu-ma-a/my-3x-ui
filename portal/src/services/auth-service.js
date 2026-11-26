import * as userModel from '../models/users.js';
import * as sessionModel from '../models/sessions.js';
import * as sessionAuth from '../auth/session.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createLimiter } from '../http/security.js';
import { AppError, errors } from '../util/errors.js';
import { email as validateEmail, password as validatePassword, username as validateUsername } from '../util/validate.js';
import { randomToken } from '../util/ids.js';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const CAPTCHA_MAX_ATTEMPTS = 5;

export class AuthService {
  constructor({ store, settings, sessionTtlMs }) {
    this.store = store;
    this.settings = settings;
    this.sessionTtlMs = sessionTtlMs;
    this.limiter = createLimiter({ windowMs: LOGIN_WINDOW_MS, max: LOGIN_MAX_ATTEMPTS });
    this.captchas = new Map();
  }

  issueCaptcha() {
    const now = Date.now();
    for (const [id, item] of this.captchas) {
      if (item.expiresAt <= now) this.captchas.delete(id);
    }
    const left = 1 + Math.floor(Math.random() * 9);
    const right = 1 + Math.floor(Math.random() * 9);
    const plus = Math.random() < 0.5;
    const big = Math.max(left, right);
    const small = Math.min(left, right);
    const question = plus ? `${left} + ${right} = ?` : `${big} - ${small} = ?`;
    const answer = plus ? String(left + right) : String(big - small);
    const captchaId = randomToken(12);
    this.captchas.set(captchaId, { answer, expiresAt: now + CAPTCHA_TTL_MS, attempts: 0 });
    return { captchaId, question, expiresIn: Math.floor(CAPTCHA_TTL_MS / 1000) };
  }

  verifyCaptcha(captchaId, captchaAnswer) {
    if (!captchaId || captchaAnswer === undefined || captchaAnswer === null || String(captchaAnswer).trim() === '') {
      throw new AppError('captcha_required', '请输入验证码', 400);
    }
    const item = this.captchas.get(String(captchaId));
    if (!item || item.expiresAt <= Date.now()) {
      this.captchas.delete(String(captchaId));
      throw new AppError('captcha_invalid', '验证码已过期，请刷新后重试', 400);
    }
    item.attempts += 1;
    if (item.attempts > CAPTCHA_MAX_ATTEMPTS) {
      this.captchas.delete(String(captchaId));
      throw new AppError('captcha_invalid', '验证码错误次数过多，请刷新后重试', 400);
    }
    if (String(captchaAnswer).trim() !== item.answer) {
      throw new AppError('captcha_invalid', '验证码错误，请重试', 400);
    }
    this.captchas.delete(String(captchaId));
  }

  register({ body, ip, userAgent }) {
    if (!this.settings.portalConfig().registrationEnabled) {
      throw errors.badRequest('registration_closed', '当前未开放注册');
    }
    this.verifyCaptcha(body?.captchaId, body?.captchaAnswer);
    const username = validateUsername(body);
    const password = validatePassword(body);
    const email = validateEmail(body);
    if (userModel.existsUsername(this.store, username)) {
      throw errors.conflict('username_taken', '该用户名已被占用');
    }
    if (email && userModel.existsEmail(this.store, email)) {
      throw errors.conflict('email_taken', '该邮箱已被注册');
    }
    let invitedBy = null;
    const inviteCode = String(body?.inviteCode ?? '').trim();
    if (inviteCode) {
      const inviter = userModel.findByInviteCode(this.store, inviteCode);
      if (!inviter) throw errors.validation('邀请码无效，请检查后重试');
      invitedBy = inviter.id;
    }
    const id = userModel.create(this.store, {
      username,
      email,
      passwordHash: hashPassword(password),
      role: 'user',
      invitedBy,
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
      const banned = row.status === 'banned';
      throw new AppError(
        banned ? 'account_banned' : 'account_disabled',
        banned ? '账号已被封禁，请联系管理员' : '账号已被禁用，请联系管理员',
        403,
      );
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
    // 修改密码后所有会话（包括当前设备）立即失效，需用新密码重新登录。
    sessionModel.removeByUser(this.store, user.id);
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
