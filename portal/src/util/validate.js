import { errors } from './errors.js';

function invalid(label, message) {
  return errors.validation(`${label}${message}`);
}

export function readObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw errors.validation('请求体格式错误');
  }
  return value;
}

export function str(obj, key, { label = key, min = 0, max = 255, required = true, pattern = null } = {}) {
  const raw = obj?.[key];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw invalid(label, '不能为空');
    return '';
  }
  if (typeof raw !== 'string') throw invalid(label, '必须是字符串');
  const value = raw.trim();
  if (value.length < min) throw invalid(label, `长度不能少于 ${min} 个字符`);
  if (value.length > max) throw invalid(label, `长度不能超过 ${max} 个字符`);
  if (pattern && !pattern.test(value)) throw invalid(label, '格式不正确');
  return value;
}

export function optionalStr(obj, key, options = {}) {
  return str(obj, key, { ...options, required: false });
}

export function int(obj, key, { label = key, min = 0, max = Number.MAX_SAFE_INTEGER, required = true, defaultValue = 0 } = {}) {
  const raw = obj?.[key];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw invalid(label, '不能为空');
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) throw invalid(label, '必须是整数');
  if (value < min || value > max) throw invalid(label, `必须在 ${min} 到 ${max} 之间`);
  return value;
}

export function optionalInt(obj, key, options = {}) {
  return int(obj, key, { ...options, required: false });
}

export function number(obj, key, { label = key, min = 0, max = Number.MAX_SAFE_INTEGER, required = true, defaultValue = 0 } = {}) {
  const raw = obj?.[key];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw invalid(label, '不能为空');
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw invalid(label, '必须是数字');
  if (value < min || value > max) throw invalid(label, `必须在 ${min} 到 ${max} 之间`);
  return value;
}

export function bool(obj, key, { defaultValue = false } = {}) {
  const raw = obj?.[key];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === '1' || raw === 1) return true;
  if (raw === 'false' || raw === '0' || raw === 0) return false;
  throw errors.validation(`${key} 必须是布尔值`);
}

export function email(obj, key = 'email', { required = false, label = '邮箱' } = {}) {
  const value = str(obj, key, { label, required, max: 254 });
  if (value === '') return '';
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  if (!ok) throw invalid(label, '格式不正确');
  return value.toLowerCase();
}

export function username(obj, key = 'username', { label = '用户名' } = {}) {
  const value = str(obj, key, { label, min: 3, max: 32, pattern: /^[a-zA-Z0-9_.-]+$/ });
  return value.toLowerCase();
}

export function password(obj, key = 'password', { label = '密码' } = {}) {
  return str(obj, key, { label, min: 8, max: 72 });
}

export function money(obj, key, { label = '金额', min = 0, max = 100000000 } = {}) {
  return int(obj, key, { label, min, max });
}

export function intList(obj, key, { label = key, maxItems = 100, max = 1000000 } = {}) {
  const raw = obj?.[key];
  if (raw === undefined || raw === null || raw === '') return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  if (list.length > maxItems) throw invalid(label, `最多 ${maxItems} 项`);
  const out = [];
  for (const item of list) {
    if (item === '' || item === null) continue;
    const value = Number(item);
    if (!Number.isInteger(value) || value <= 0 || value > max) throw invalid(label, '包含非法 ID');
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

export function pagination(query = {}, { defaultSize = 20, maxSize = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  let pageSize = Number.parseInt(query.pageSize ?? String(defaultSize), 10) || defaultSize;
  pageSize = Math.min(maxSize, Math.max(1, pageSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function boolString(value) {
  return value ? 'true' : 'false';
}
