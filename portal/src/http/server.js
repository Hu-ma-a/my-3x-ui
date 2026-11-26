import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { compileRoutes, matchRoute } from './router.js';
import { appendCookie, parseCookies, serializeCookie } from './cookies.js';
import { fail, ok, readJson } from './response.js';
import { clientIp, requestOrigin, sameOrigin, securityHeaders, tokensEqual } from './security.js';
import { SESSION_COOKIE, load as loadSession } from '../auth/session.js';
import { AppError } from '../util/errors.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isSecureRequest(req, config) {
  if (req.socket?.encrypted) return true;
  if (!config.trustProxy) return false;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

export function createHttpServer({ config, store, services, routes, logger }) {
  const compiled = compileRoutes(routes);

  return http.createServer(async (req, res) => {
    const startedAt = Date.now();
    securityHeaders(res, { secure: isSecureRequest(req, config) });

    let pathname = '/';
    const query = {};
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      pathname = url.pathname;
      for (const [key, value] of url.searchParams) query[key] = value;
    } catch {
      fail(res, 400, 'bad_request', '请求地址无效');
      return;
    }

    try {
      if (!pathname.startsWith('/api/')) {
        serveStatic(req, res, pathname, config);
        return;
      }
      await handleApi(req, res, pathname, query, { config, store, services, compiled, logger });
    } catch (err) {
      if (res.writableEnded) return;
      if (err instanceof AppError) {
        fail(res, err.status, err.code, err.message);
        return;
      }
      logger.error(`未处理异常 ${req.method} ${pathname}:`, err);
      fail(res, 500, 'internal_error', '服务器内部错误');
    } finally {
      logger.debug(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - startedAt}ms`);
    }
  });
}

async function handleApi(req, res, pathname, query, { config, store, services, compiled, logger }) {
  const matched = matchRoute(compiled, req.method, pathname);
  if (!matched) {
    fail(res, 404, 'not_found', '接口不存在');
    return;
  }
  const { route, params } = matched;

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE] || '';
  const sessionData = loadSession(store, token);
  const user = sessionData?.user || null;
  const sessionRow = sessionData?.session || null;

  const secure = isSecureRequest(req, config);
  const ctx = {
    req,
    res,
    params,
    query,
    method: req.method,
    ip: clientIp(req, config.trustProxy),
    origin: requestOrigin(req, config.trustProxy).origin,
    token,
    user,
    sessionRow,
    store,
    services,
    config,
    logger,
    async body() {
      if (this.parsedBody !== undefined) return this.parsedBody;
      this.parsedBody = await readJson(req);
      return this.parsedBody;
    },
    setSession(session) {
      appendCookie(
        res,
        serializeCookie(SESSION_COOKIE, session.token, {
          maxAge: Math.floor(session.ttlMs / 1000),
          path: '/',
          httpOnly: true,
          secure,
          sameSite: 'Lax',
        }),
      );
    },
    clearSession() {
      appendCookie(res, serializeCookie(SESSION_COOKIE, '', { maxAge: 0, path: '/', httpOnly: true, secure, sameSite: 'Lax' }));
    },
  };

  if (route.auth === 'user' || route.auth === 'admin') {
    if (!user) throw new AppError('unauthorized', '请先登录', 401);
    if (route.auth === 'admin' && user.role !== 'admin') throw new AppError('forbidden', '没有管理员权限', 403);
  }

  if (STATE_CHANGING.has(req.method) && route.csrf !== false) {
    if (!sameOrigin(req, config.trustProxy)) throw new AppError('forbidden', '请求来源校验失败', 403);
    const headerToken = String(req.headers['x-csrf-token'] || '');
    if (!sessionRow || !tokensEqual(headerToken, sessionRow.csrf_token)) {
      throw new AppError('csrf_invalid', 'CSRF 校验失败，请刷新页面后重试', 403);
    }
  }

  const result = await route.handler(ctx);
  if (!res.writableEnded) ok(res, result ?? null);
}

function serveStatic(req, res, pathname, config) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  const publicDir = config.publicDir;
  let relative = decodeURIComponent(pathname);
  if (relative === '/' || relative === '') relative = '/index.html';
  const filePath = path.resolve(publicDir, `.${relative}`);
  if (!filePath.startsWith(path.resolve(publicDir))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    const fallback = path.join(publicDir, 'index.html');
    let fallbackStat = null;
    try {
      fallbackStat = fs.statSync(fallback);
    } catch {
      fallbackStat = null;
    }
    if (!path.extname(relative) && fallbackStat && fallbackStat.isFile()) {
      sendFile(req, res, fallback, fallbackStat);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  sendFile(req, res, filePath, stat);
}

function sendFile(req, res, filePath, stat = fs.statSync(filePath)) {
  const ext = path.extname(filePath).toLowerCase();
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const lastModified = new Date(stat.mtimeMs).toUTCString();
  const headers = {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    // HTML 不缓存；静态资源走协商缓存（304），避免每次刷新重复下载。
    'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
    ETag: etag,
    'Last-Modified': lastModified,
  };
  const ifNoneMatch = req.headers['if-none-match'];
  const ifModifiedSince = req.headers['if-modified-since'];
  const notModified = ifNoneMatch
    ? String(ifNoneMatch).split(',').map((item) => item.trim()).includes(etag)
    : Boolean(ifModifiedSince && Date.parse(ifModifiedSince) >= Math.floor(stat.mtimeMs / 1000) * 1000);
  if (notModified) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}
