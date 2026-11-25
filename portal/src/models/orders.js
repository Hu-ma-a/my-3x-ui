export function toOrder(row) {
  if (!row) return null;
  let planName = null;
  if (row.plan_snapshot) {
    try {
      planName = JSON.parse(row.plan_snapshot).name ?? null;
    } catch {
      planName = null;
    }
  }
  return {
    id: Number(row.id),
    orderNo: row.order_no,
    kind: row.kind,
    userId: Number(row.user_id),
    username: row.username ?? null,
    planId: row.plan_id ?? null,
    planName: planName ?? row.plan_name ?? null,
    amountCents: Number(row.amount_cents),
    status: row.status,
    provider: row.provider,
    payUrl: row.pay_url ?? null,
    providerTradeNo: row.provider_trade_no ?? null,
    paidAt: row.paid_at ?? null,
    provisionedAt: row.provisioned_at ?? null,
    provisionError: row.provision_error ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

const ORDER_SELECT = `SELECT o.*, u.username AS username FROM orders o LEFT JOIN users u ON u.id = o.user_id`;

export function insert(store, order) {
  const now = Date.now();
  const result = store.run(
    `INSERT INTO orders(order_no, kind, user_id, plan_id, plan_snapshot, amount_cents, status, provider, pay_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    order.orderNo,
    order.kind,
    order.userId,
    order.planId ?? null,
    order.planSnapshot ? JSON.stringify(order.planSnapshot) : null,
    order.amountCents,
    order.status,
    order.provider,
    order.payUrl ?? null,
    now,
    now,
  );
  return Number(result.lastInsertRowid);
}

export function findByOrderNo(store, orderNo) {
  return store.get(`${ORDER_SELECT} WHERE o.order_no = ?`, orderNo);
}

export function findById(store, id) {
  return store.get(`${ORDER_SELECT} WHERE o.id = ?`, Number(id));
}

export function removeForUser(store, userId) {
  store.run('DELETE FROM orders WHERE user_id = ?', Number(userId));
}

export function listForUser(store, userId, { kind = '', limit = 20, offset = 0 } = {}) {
  const params = [Number(userId)];
  let clause = 'WHERE o.user_id = ?';
  if (kind) {
    clause += ' AND o.kind = ?';
    params.push(kind);
  }
  return store.all(`${ORDER_SELECT} ${clause} ORDER BY o.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
}

export function countForUser(store, userId, { kind = '' } = {}) {
  const params = [Number(userId)];
  let clause = 'WHERE user_id = ?';
  if (kind) {
    clause += ' AND kind = ?';
    params.push(kind);
  }
  const row = store.get(`SELECT COUNT(*) AS total FROM orders ${clause}`, ...params);
  return Number(row.total);
}

function adminFilter({ kind, status, query }) {
  const where = [];
  const params = [];
  if (kind) {
    where.push('o.kind = ?');
    params.push(kind);
  }
  if (status) {
    where.push('o.status = ?');
    params.push(status);
  }
  if (query) {
    where.push('(o.order_no LIKE ? OR u.username LIKE ?)');
    params.push(`%${query}%`, `%${query}%`);
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function listAdmin(store, { kind = '', status = '', query = '', limit = 20, offset = 0 } = {}) {
  const { clause, params } = adminFilter({ kind, status, query });
  return store.all(`${ORDER_SELECT} ${clause} ORDER BY o.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
}

export function countAdmin(store, { kind = '', status = '', query = '' } = {}) {
  const { clause, params } = adminFilter({ kind, status, query });
  const row = store.get(`SELECT COUNT(*) AS total FROM orders o LEFT JOIN users u ON u.id = o.user_id ${clause}`, ...params);
  return Number(row.total);
}

export function setStatus(store, id, status, extra = {}) {
  const now = Date.now();
  store.run(
    'UPDATE orders SET status = ?, provision_error = ?, provisioned_at = ?, paid_at = ?, provider_trade_no = ?, provider_payload = ?, updated_at = ? WHERE id = ?',
    status,
    extra.provisionError ?? null,
    extra.provisionedAt ?? null,
    extra.paidAt ?? null,
    extra.providerTradeNo ?? null,
    extra.providerPayload ?? null,
    now,
    Number(id),
  );
}

export function markPaid(store, id, { providerTradeNo = '', providerPayload = '' } = {}) {
  const now = Date.now();
  const result = store.run(
    "UPDATE orders SET status = 'paid', paid_at = ?, provider_trade_no = ?, provider_payload = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
    now,
    providerTradeNo || null,
    providerPayload || null,
    now,
    Number(id),
  );
  return result.changes === 1;
}

export function markPaidByAdmin(store, id) {
  const now = Date.now();
  const result = store.run(
    "UPDATE orders SET status = 'paid', paid_at = ?, provider_trade_no = COALESCE(provider_trade_no, 'manual'), updated_at = ? WHERE id = ? AND status = 'pending'",
    now,
    now,
    Number(id),
  );
  return result.changes === 1;
}

export function claimProvisioning(store, id, plan) {
  const now = Date.now();
  const result = store.run(
    `UPDATE orders SET status = 'provisioning', provision_mode = ?, client_email = ?, sub_id = ?,
       expected_expiry_ms = ?, expected_total = ?, expected_limit = ?, provision_error = NULL, updated_at = ?
     WHERE id = ? AND status IN ('paid', 'sync_pending')`,
    plan.mode,
    plan.clientEmail,
    plan.subId,
    plan.expectedExpiry,
    plan.expectedTotal,
    plan.expectedLimit,
    now,
    Number(id),
  );
  return result.changes === 1;
}

export function finishProvisioning(store, id) {
  const now = Date.now();
  store.run("UPDATE orders SET status = 'provisioned', provisioned_at = ?, provision_error = NULL, updated_at = ? WHERE id = ?", now, now, Number(id));
}

export function failProvisioning(store, id, errorMessage) {
  const now = Date.now();
  store.run(
    "UPDATE orders SET status = 'sync_pending', provision_error = ?, provision_attempts = provision_attempts + 1, updated_at = ? WHERE id = ?",
    String(errorMessage).slice(0, 500),
    now,
    Number(id),
  );
}

export function creditApplied(store, id) {
  const now = Date.now();
  const result = store.run("UPDATE orders SET credit_applied = 1, status = 'credited', provisioned_at = ?, updated_at = ? WHERE id = ? AND credit_applied = 0", now, now, Number(id));
  return result.changes === 1;
}

export function cancel(store, id, reason = '') {
  const now = Date.now();
  const result = store.run(
    "UPDATE orders SET status = 'cancelled', provision_error = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
    reason || null,
    now,
    Number(id),
  );
  return result.changes === 1;
}

export function pendingProvisioning(store, { maxAttempts = 10, limit = 20 } = {}) {
  return store.all(
    "SELECT * FROM orders WHERE kind = 'plan' AND status IN ('paid', 'sync_pending') AND provision_attempts < ? ORDER BY id ASC LIMIT ?",
    maxAttempts,
    limit,
  );
}

export function stats(store) {
  const total = store.get('SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status IN (\'provisioned\',\'credited\') THEN amount_cents ELSE 0 END), 0) AS revenue FROM orders');
  void total;
  const byStatus = store.get("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'");
  const today = store.get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM orders WHERE status IN ('provisioned','credited') AND paid_at >= ?");
  return { byStatus, today };
}
