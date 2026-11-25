export function maskCode(code) {
  const value = String(code || '');
  if (value.length <= 8) return value;
  return `${value.slice(0, 2)}-****-****-${value.slice(-4)}`;
}

export function toRedeemKey(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    code: row.code,
    maskedCode: maskCode(row.code),
    amountCents: Number(row.amount_cents),
    status: row.status,
    note: row.note || '',
    batch: row.batch || '',
    createdAt: Number(row.created_at),
    expiresAt: row.expires_at ?? null,
    usedBy: row.used_by ?? null,
    usedByName: row.used_by_name || '',
    usedAt: row.used_at ?? null,
  };
}

export function create(store, { code, amountCents, note = '', batch = '', createdBy = null, expiresAt = null }) {
  const now = Date.now();
  const result = store.run(
    `INSERT INTO redeem_keys(code, amount_cents, status, note, batch, created_by, created_at, expires_at)
     VALUES (?, ?, 'unused', ?, ?, ?, ?, ?)`,
    code,
    Number(amountCents),
    note,
    batch,
    createdBy,
    now,
    expiresAt,
  );
  return Number(result.lastInsertRowid);
}

export function findByCode(store, code) {
  return store.get('SELECT * FROM redeem_keys WHERE code = ? COLLATE NOCASE', String(code || ''));
}

export function findById(store, id) {
  return store.get('SELECT * FROM redeem_keys WHERE id = ?', Number(id));
}

function listWhere({ status = '', batch = '', query = '' }) {
  const where = [];
  const params = [];
  if (status) {
    where.push('k.status = ?');
    params.push(status);
  }
  if (batch) {
    where.push('k.batch = ?');
    params.push(batch);
  }
  if (query) {
    where.push('(k.code LIKE ? OR k.batch LIKE ? OR k.note LIKE ?)');
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function list(store, { status = '', batch = '', query = '', page = 1, pageSize = 20 } = {}) {
  const { clause, params } = listWhere({ status, batch, query });
  return store.all(
    `SELECT k.*, u.username AS used_by_name FROM redeem_keys k
       LEFT JOIN users u ON u.id = k.used_by
       ${clause}
       ORDER BY k.id DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    (page - 1) * pageSize,
  );
}

export function count(store, { status = '', batch = '', query = '' } = {}) {
  const { clause, params } = listWhere({ status, batch, query });
  return Number(store.get(`SELECT COUNT(*) AS total FROM redeem_keys k ${clause}`, ...params).total);
}

export function markUsed(store, id, userId) {
  const now = Date.now();
  const result = store.run(
    "UPDATE redeem_keys SET status = 'used', used_by = ?, used_at = ? WHERE id = ? AND status = 'unused'",
    Number(userId),
    now,
    Number(id),
  );
  return Number(result.changes) === 1;
}

export function revoke(store, id) {
  const result = store.run("UPDATE redeem_keys SET status = 'revoked' WHERE id = ? AND status = 'unused'", Number(id));
  return Number(result.changes) === 1;
}
