export function parseLocation(hash = window.location.hash) {
  const raw = String(hash || '').replace(/^#/, '') || '/';
  const index = raw.indexOf('?');
  const pathPart = index >= 0 ? raw.slice(0, index) : raw;
  const queryPart = index >= 0 ? raw.slice(index + 1) : '';
  let path = pathPart || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return { path, query: Object.fromEntries(new URLSearchParams(queryPart)) };
}

function matchPattern(pattern, path) {
  if (pattern === path) return {};
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    if (patternParts[i].startsWith(':')) {
      try {
        params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
      } catch {
        params[patternParts[i].slice(1)] = pathParts[i];
      }
      continue;
    }
    if (patternParts[i] !== pathParts[i]) return null;
  }
  return params;
}

export function matchRoute(routes, path) {
  for (const route of routes) {
    const params = matchPattern(route.path, path);
    if (params) return { route, params };
  }
  return null;
}

export function createRouter({ routes, onRoute, onError }) {
  let cleanup = null;

  async function run() {
    const location = parseLocation();
    const matched = matchRoute(routes, location.path);
    try {
      if (cleanup) {
        try {
          cleanup();
        } catch (err) {
          console.warn('cleanup failed', err);
        }
        cleanup = null;
      }
      cleanup = await onRoute({ matched, location });
      if (typeof cleanup !== 'function') cleanup = null;
    } catch (err) {
      if (onError) onError(err, location);
      else console.error(err);
    }
  }

  const handler = () => {
    run();
  };
  window.addEventListener('hashchange', handler);
  run();

  return {
    run,
    destroy() {
      window.removeEventListener('hashchange', handler);
      if (cleanup) cleanup();
    },
  };
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${String(path || '/').startsWith('/') ? path : `/${path}`}`;
  if (replace) {
    window.location.replace(target);
    return;
  }
  if (window.location.hash === target) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  window.location.hash = target;
}
