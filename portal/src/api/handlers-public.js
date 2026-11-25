export async function health() {
  return { status: 'ok', version: '1.0.0', time: Date.now() };
}

export async function config(ctx, services) {
  return services.settings.publicConfig();
}

export async function plans(ctx, services) {
  return { plans: services.plans.listEnabled() };
}

export async function register(ctx, services) {
  const body = await ctx.body();
  const { user, session } = services.auth.register({
    body,
    ip: ctx.ip,
    userAgent: String(ctx.req.headers['user-agent'] || ''),
  });
  ctx.setSession(session);
  return { user, csrfToken: session.csrfToken };
}

export function captcha(ctx, services) {
  return services.auth.issueCaptcha();
}

export async function login(ctx, services) {
  const body = await ctx.body();
  const { user, session } = services.auth.login({
    body,
    ip: ctx.ip,
    userAgent: String(ctx.req.headers['user-agent'] || ''),
  });
  ctx.setSession(session);
  return { user, csrfToken: session.csrfToken };
}

export async function logout(ctx, services) {
  services.auth.logout(ctx.token);
  ctx.clearSession();
  return { ok: true };
}
