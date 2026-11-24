export function toUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email ?? null,
    role: row.role,
    status: row.status,
    balanceCents: Number(row.balance_cents ?? 0),
    clientEmail: row.client_email ?? null,
    subId: row.sub_id ?? null,
    planId: row.plan_id ?? null,
    planName: row.plan_name ?? null,
    planStartedAt: row.plan_started_at ?? null,
    planExpiresAt: row.plan_expires_at ?? null,
    totalBytes: row.total_bytes ?? null,
    clientLimit: row.client_limit ?? null,
    createdAt: Number(row.created_at),
    lastLoginAt: row.last_login_at ?? null,
  };
}

const USER_COLUMNS = `id, username, email, role, status, balance_cents, client_email, sub_id, plan_id, plan_name,
  plan_started_at, plan_expires_at, total_bytes, client_limit, created_at, updated_at, last_login_at`;

export function findById(store, id) {
  return store.get(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, Number(id));
}

export function findByUsername(store, username) {
  return store.get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', username);
}

export function findWithPassword(store, id) {
  return store.get('SELECT * FROM users WHERE id = ?', Number(id));
}

export function existsUsername(store, username) {
  return Boolean(store.get('SELECT id FROM users WHERE username = ? COLLATE NOCASE', username));
}

export function existsEmail(store, email, exceptId = 0) {
  if (!email) return false;
  return Boolean(store.get('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id <> ?', email, Number(exceptId)));
}

export function create(store, { username, email, passwordHash, role = 'user' }) {
  const now = Date.now();
  const result = store.run(
    `INSERT INTO users(username, email, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    username,
    email || null,
    passwordHash,
    role,
    now,
    now,
  );
  return Number(result.lastInsertRowid);
}

export function touchLogin(store, id) {
  const now = Date.now();
  store.run('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', now, now, Number(id));
}

export function bumpLoginEpoch(store, id) {
  store.run('UPDATE users SET login_epoch = login_epoch + 1, updated_at = ? WHERE id = ?', Date.now(), Number(id));
}

export function setPassword(store, id, passwordHash) {
  store.run('UPDATE users SET password_hash = ?, login_epoch = login_epoch + 1, updated_at = ? WHERE id = ?', passwordHash, Date.now(), Number(id));
}

export function setStatus(store, id, status) {
  store.run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', status, Date.now(), Number(id));
}

export function addBalance(store, id, deltaCents) {
  store.run('UPDATE users SET balance_cents = balance_cents + ?, updated_at = ? WHERE id = ?', Number(deltaCents), Date.now(), Number(id));
}

export function updateSnapshot(store, id, snapshot) {
  store.run(
    `UPDATE users SET client_email = ?, sub_id = ?, plan_id = ?, plan_name = ?, plan_started_at = ?,
       plan_expires_at = ?, total_bytes = ?, client_limit = ?, updated_at = ?
     WHERE id = ?`,
    snapshot.clientEmail ?? null,
    snapshot.subId ?? null,
    snapshot.planId ?? null,
    snapshot.planName ?? null,
    snapshot.planStartedAt ?? null,
    snapshot.planExpiresAt ?? null,
    snapshot.totalBytes ?? null,
    snapshot.clientLimit ?? null,
    Date.now(),
    Number(id),
  );
}

function listFilter({ query, status }) {
  const where = [];
  const params = [];
  if (query) {
    where.push('(username LIKE ? OR email LIKE ?)');
    params.push(`%${query}%`, `%${query}%`);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function list(store, { query = '', status = '', limit = 20, offset = 0 } = {}) {
  const { clause, params } = listFilter({ query, status });
  return store.all(`SELECT ${USER_COLUMNS} FROM users ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
}

export function count(store, { query = '', status = '' } = {}) {
  const { clause, params } = listFilter({ query, status });
  const row = store.get(`SELECT COUNT(*) AS total FROM users ${clause}`, ...params);
  return Number(row.total);
}

export function countByStatus(store, status) {
  const row = store.get('SELECT COUNT(*) AS total FROM users WHERE status = ?', status);
  return Number(row.total);
}

export function listAdmins(store) {
  return store.all(`SELECT ${USER_COLUMNS} FROM users WHERE role = 'admin' ORDER BY id ASC`);
}

export function listAll(store, { role = '' } = {}) {
  if (role) {
    return store.all(`SELECT ${USER_COLUMNS} FROM users WHERE role = ? ORDER BY id ASC`, role);
  }
  return store.all(`SELECT ${USER_COLUMNS} FROM users ORDER BY id ASC`);
}

export function countActiveAdmins(store) {
  const row = store.get("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'active'");
  return Number(row.total);
}

export function remove(store, id) {
  store.run('DELETE FROM users WHERE id = ?', Number(id));
}
