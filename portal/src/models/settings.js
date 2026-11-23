export function get(store, key) {
  const row = store.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : '';
}

export function getMany(store, keys) {
  const out = {};
  for (const key of keys) out[key] = get(store, key);
  return out;
}

export function all(store) {
  const rows = store.all('SELECT key, value FROM settings');
  const out = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export function set(store, key, value) {
  store.run('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', key, String(value ?? ''), Date.now());
}
