import { errors } from '../util/errors.js';

const MAX_BODY_BYTES = 1024 * 1024;

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function ok(res, data = null) {
  sendJson(res, 200, { ok: true, data });
}

export function fail(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } });
}

export function text(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

export function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

export function readRaw(req, { limit = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(errors.badRequest('payload_too_large', '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function readJson(req) {
  const raw = await readRaw(req);
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw errors.validation('请求体必须是 JSON 对象');
    }
    return parsed;
  } catch (err) {
    if (err && err.code === 'validation_error') throw err;
    throw errors.validation('请求体不是合法的 JSON');
  }
}

export async function readForm(req) {
  const raw = await readRaw(req);
  return new URLSearchParams(raw);
}
