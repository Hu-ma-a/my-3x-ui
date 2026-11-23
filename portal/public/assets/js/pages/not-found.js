export const meta = { title: '页面不存在', auth: false, admin: false };

export async function render(root, ctx) {
  const secondary = ctx.me
    ? '<a class="btn btn-secondary" href="#/dashboard">我的账号</a>'
    : '<a class="btn btn-secondary" href="#/login">登录</a>';
  root.innerHTML = `
    <div class="p-notfound">
      <p class="eyebrow text-center">404</p>
      <div class="empty">
        <div class="empty-title">页面不存在</div>
        <p>你访问的页面不存在，或链接已经失效。</p>
        <div class="empty-actions p-notfound-actions">
          <a class="btn btn-primary" href="#/">返回首页</a>
          ${secondary}
        </div>
      </div>
    </div>`;
}
