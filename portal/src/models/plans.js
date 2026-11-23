const GB = 1024 * 1024 * 1024;

export function toPlan(row) {
  if (!row) return null;
  const trafficGb = Number(row.traffic_gb);
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    priceCents: Number(row.price_cents),
    days: Number(row.days),
    trafficGb,
    trafficBytes: Math.round(trafficGb * GB),
    deviceLimit: Number(row.device_limit),
    inboundIds: parseInboundIds(row.inbound_ids),
    enabled: Boolean(row.enabled),
    featured: Boolean(row.featured),
    sort: Number(row.sort),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function parseInboundIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isInteger(item) && item > 0);
}

export function list(store, { enabledOnly = false } = {}) {
  const clause = enabledOnly ? 'WHERE enabled = 1' : '';
  return store.all(`SELECT * FROM plans ${clause} ORDER BY sort ASC, id ASC`);
}

export function find(store, id) {
  return store.get('SELECT * FROM plans WHERE id = ?', Number(id));
}

export function create(store, data) {
  const now = Date.now();
  const result = store.run(
    `INSERT INTO plans(name, description, price_cents, days, traffic_gb, device_limit, inbound_ids, enabled, featured, sort, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    data.name,
    data.description,
    data.priceCents,
    data.days,
    data.trafficGb,
    data.deviceLimit,
    data.inboundIds.join(','),
    data.enabled ? 1 : 0,
    data.featured ? 1 : 0,
    data.sort,
    now,
    now,
  );
  return Number(result.lastInsertRowid);
}

export function update(store, id, data) {
  store.run(
    `UPDATE plans SET name = ?, description = ?, price_cents = ?, days = ?, traffic_gb = ?, device_limit = ?,
       inbound_ids = ?, enabled = ?, featured = ?, sort = ?, updated_at = ?
     WHERE id = ?`,
    data.name,
    data.description,
    data.priceCents,
    data.days,
    data.trafficGb,
    data.deviceLimit,
    data.inboundIds.join(','),
    data.enabled ? 1 : 0,
    data.featured ? 1 : 0,
    data.sort,
    Date.now(),
    Number(id),
  );
}

export function disable(store, id) {
  store.run('UPDATE plans SET enabled = 0, updated_at = ? WHERE id = ?', Date.now(), Number(id));
}

export function remove(store, id) {
  store.run('DELETE FROM plans WHERE id = ?', Number(id));
}

export function countOrders(store, planId) {
  const row = store.get('SELECT COUNT(*) AS total FROM orders WHERE plan_id = ?', Number(planId));
  return Number(row.total);
}
