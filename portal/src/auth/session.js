import { randomToken, sha256 } from '../util/ids.js';
import * as sessionModel from '../models/sessions.js';

export const SESSION_COOKIE = 'portal_session';

export function issue(store, { userId, ttlMs, ip = '', userAgent = '' }) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = Date.now() + ttlMs;
  sessionModel.create(store, {
    userId,
    tokenHash: sha256(token),
    csrfToken,
    expiresAt,
    ip,
    userAgent,
  });
  return { token, csrfToken, expiresAt, ttlMs };
}

export function load(store, token) {
  if (!token) return null;
  return sessionModel.loadSessionUser(store, sha256(token));
}

export function destroy(store, token) {
  if (!token) return;
  sessionModel.removeByHash(store, sha256(token));
}

export function destroyForUser(store, userId, token = '') {
  sessionModel.removeByUser(store, userId, { exceptHash: token ? sha256(token) : '' });
}

export function cookie(token, { ttlMs, secure = false }) {
  return {
    value: token,
    options: {
      maxAge: Math.floor(ttlMs / 1000),
      path: '/',
      httpOnly: true,
      secure,
      sameSite: 'Lax',
    },
  };
}
