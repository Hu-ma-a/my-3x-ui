export function compileRoutes(routes) {
  return routes.map((route) => {
    const keys = [];
    const pattern = route.path
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          keys.push(segment.slice(1));
          return '([^/]+)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    return { ...route, regex: new RegExp(`^${pattern}/?$`), keys };
  });
}

export function matchRoute(compiled, method, pathname) {
  const wanted = method === 'HEAD' ? 'GET' : method;
  for (const route of compiled) {
    if (route.method !== wanted) continue;
    const match = route.regex.exec(pathname);
    if (!match) continue;
    const params = {};
    route.keys.forEach((key, index) => {
      try {
        params[key] = decodeURIComponent(match[index + 1]);
      } catch {
        params[key] = match[index + 1];
      }
    });
    return { route, params };
  }
  return null;
}
