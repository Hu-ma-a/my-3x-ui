import crypto from 'node:crypto';

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();
  }
  return req.socket?.remoteAddress || '';
}

export function requestOrigin(req, trustProxy) {
  const proto = trustProxy && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0].trim() : req.socket?.encrypted ? 'https' : 'http';
  const host = trustProxy && req.headers['x-forwarded-host'] ? String(req.headers['x-forwarded-host']).split(',')[0].trim() : req.headers.host;
  return { proto, host, origin: `${proto}://${host}` };
}

export function sameOrigin(req, trustProxy) {
  const { host } = requestOrigin(req, trustProxy);
  const originHeader = req.headers.origin;
  if (originHeader) {
    try {
      const parsed = new URL(originHeader);
      return parsed.host === host;
    } catch {
      return false;
    }
  }
  const referer = req.headers.referer;
  if (referer) {
    try {
      const parsed = new URL(referer);
      return parsed.host === host;
    } catch {
      return false;
    }
  }
  return true;
}

export function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

export function createLimiter({ windowMs = 15 * 60 * 1000, max = 5 } = {}) {
  const buckets = new Map();
  const cleanup = () => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  };
  return {
    allow(key) {
      cleanup();
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket) return { allowed: true };
      if (bucket.resetAt <= now) {
        buckets.delete(key);
        return { allowed: true };
      }
      return { allowed: bucket.count < max, retryAfterMs: bucket.resetAt - now };
    },
    fail(key) {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return;
      }
      bucket.count += 1;
    },
    reset(key) {
      buckets.delete(key);
    },
    clear() {
      buckets.clear();
    },
  };
}

export function securityHeaders(res, { secure = false } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
