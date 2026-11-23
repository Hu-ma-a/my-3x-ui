import * as users from './users.js';

export function create(store, { userId, tokenHash, csrfToken, expiresAt, ip, userAgent }) {
  const now = Date.now();
  store.run(
    'INSERT INTO sessions(token_hash, csrf_token, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    tokenHash,
    csrfToken,
    Number(userId),
    now,
    Number(expiresAt),
    ip || null,
    userAgent || null,
  );
}

export function findValid(store, tokenHash, now = Date.now()) {
  return store.get('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?', tokenHash, now);
}

export function removeByHash(store, tokenHash) {
  store.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
}

export function removeByUser(store, userId, { exceptHash = '' } = {}) {
  if (exceptHash) store.run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', Number(userId), exceptHash);
  else store.run('DELETE FROM sessions WHERE user_id = ?', Number(userId));
}

export function removeExpired(store, now = Date.now()) {
  store.run('DELETE FROM sessions WHERE expires_at <= ?', now);
}

export function loadSessionUser(store, tokenHash, now = Date.now()) {
  const session = findValid(store, tokenHash, now);
  if (!session) return null;
  const row = users.findById(store, session.user_id);
  if (!row || row.status !== 'active') return null;
  return { session, user: users.toUser(row) };
}
