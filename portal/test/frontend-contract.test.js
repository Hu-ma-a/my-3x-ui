import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const PAGES_DIR = path.join(PUBLIC, 'assets/js/pages');
const ADMIN_DIR = path.join(PUBLIC, 'assets/js/admin');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

function read(relative) {
  return fs.readFileSync(path.join(PUBLIC, relative), 'utf8');
}

function listJs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(dir, name));
}

function extract(pattern, source) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

describe('前端模块与核心 API 契约一致', () => {
  it('index.html 引用的样式与脚本都存在', () => {
    const html = read('index.html');
    const assets = extract(/(?:href|src)="(\/assets\/[^"]+)"/g, html);
    assert.ok(assets.length >= 4, `应引用 base/portal/admin 样式与 main.js，实际 ${assets.length}`);
    for (const asset of assets) {
      const filePath = path.join(PUBLIC, asset.replace(/^\//, ''));
      assert.ok(fs.existsSync(filePath), `index.html 引用的 ${asset} 不存在`);
    }
    assert.ok(!html.includes('id="app-main"'), '壳容器由 main.js 渲染');
    assert.ok(html.includes('id="app"'));
  });

  it('main.js 的路由表与实际页面文件一一对应', () => {
    const main = read('assets/js/main.js');
    const imports = extract(/import\('\.\/([^']+)'\)/g, main);
    assert.ok(imports.length >= 14, `应注册用户侧与管理侧路由，实际 ${imports.length}`);
    for (const relative of imports) {
      const filePath = path.join(PUBLIC, 'assets/js', relative);
      assert.ok(fs.existsSync(filePath), `路由引用的页面模块 ${relative} 不存在`);
    }
    for (const expected of [
      'pages/login.js',
      'pages/register.js',
      'pages/dashboard.js',
      'pages/plans.js',
      'pages/recharge.js',
      'pages/orders.js',
      'pages/account.js',
      'pages/mock-pay.js',
      'pages/not-found.js',
      'admin/overview.js',
      'admin/users.js',
      'admin/plans.js',
      'admin/orders.js',
      'admin/recharges.js',
      'admin/settings.js',
    ]) {
      assert.ok(imports.includes(expected), `路由表缺少 ${expected}`);
    }
  });

  it('所有页面模块导出 meta 与 render', () => {
    const main = read('assets/js/main.js');
    const imports = extract(/import\('\.\/([^']+)'\)/g, main);
    for (const relative of imports) {
      const source = fs.readFileSync(path.join(PUBLIC, 'assets/js', relative), 'utf8');
      assert.match(source, /export const meta = \{/, `${relative} 缺少 meta 导出`);
      assert.match(source, /export async function render\(root, ctx\)/, `${relative} 缺少 render(root, ctx) 导出`);
    }
  });

  it('页面使用到的 api 方法都存在于 core/api.js', () => {
    const apiSource = read('assets/js/core/api.js');
    const pageFiles = listJs(PAGES_DIR).concat(listJs(ADMIN_DIR));
    const used = new Set();
    for (const file of pageFiles) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/\bapi\.(?:admin\.)?([a-zA-Z]+)/g)) {
        used.add(match[0]);
      }
    }
    assert.ok(used.size > 10, '页面应调用 API');
    for (const usage of used) {
      const method = usage.replace(/^api\.(?:admin\.)?/, '');
      if (usage.startsWith('api.admin.')) {
        assert.match(apiSource, new RegExp(`${method}:`), `core/api.js 缺少方法 admin.${method}`);
      } else {
        assert.match(apiSource, new RegExp(`\\b${method}[:(]`), `core/api.js 缺少方法 ${method}`);
      }
    }
  });

  it('页面使用到的 ui 辅助方法都存在于 core/ui.js', () => {
    const uiSource = read('assets/js/core/ui.js');
    const pageFiles = listJs(PAGES_DIR).concat(listJs(ADMIN_DIR));
    const used = new Set();
    for (const file of pageFiles) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/\b(?:ctx\.ui|ui)\.([a-zA-Z]+)/g)) {
        used.add(match[1]);
      }
    }
    const whitelist = new Set(['escape', 'portalName', 'money', 'amount', 'currencyCode', 'currencySymbol', 'currencyName', 'setCurrency', 'bytes', 'pct', 'date', 'dateTime', 'relative', 'statusText', 'kindText', 'badge', 'qs', 'qsa', 'on', 'toast', 'confirm', 'empty', 'spinner', 'pagination', 'copy', 'tone']);
    for (const method of used) {
      assert.ok(whitelist.has(method), `core/ui.js 缺少方法 ${method}`);
      assert.match(uiSource, new RegExp(`\\b${method}[:(]`), `core/ui.js 未导出 ${method}`);
    }
    // 页面不得使用浏览器原生阻塞式对话框。
    for (const file of pageFiles) {
      const source = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /(?<![.\w])(?:window\.)?(?:alert|confirm|prompt)\s*\(/, `${path.basename(file)} 使用了阻塞式对话框`);
    }
  });

  it('页面没有引入 npm 依赖或 TypeScript/JSX 语法', () => {
    const pageFiles = listJs(path.join(PUBLIC, 'assets/js'));
    for (const file of pageFiles) {
      const source = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /from ['"][^./][^'"]*['"]/, `${path.basename(file)} 引入了非相对路径依赖`);
      assert.doesNotMatch(source, /<\/?[A-Z][a-zA-Z]*\s*\/?>/, `${path.basename(file)} 疑似包含 JSX`);
    }
  });
});

describe('视觉规范 v3（卡片定价页风格）', () => {
  it('base.css 提供卡片与定价卡片设计系统', () => {
    const base = read('assets/css/base.css');
    for (const token of ['--ink:', '--line:', '--accent:', '--surface:', '--radius-card:', '--shadow-card:', '--content:', '--content-wide:', '--topbar-h:']) {
      assert.ok(base.includes(token), `base.css 缺少设计令牌 ${token}`);
    }
    for (const component of [
      '.card',
      '.card-grid',
      '.card-head',
      '.card-body',
      '.price-grid',
      '.price-card',
      '.price-topbar',
      '.price-icon',
      '.price-amount',
      '.price-divider',
      '.check-list',
      '.check-item',
      '.pill-label',
      '.display',
      '.btn-accent',
      '.table',
      '.modal',
      '.toast',
      '.track',
      '.badge',
    ]) {
      assert.ok(base.includes(component), `base.css 缺少组件 ${component}`);
    }
    assert.ok(base.includes('.price-card.featured'), 'base.css 缺少推荐卡 .price-card.featured');
    assert.ok(base.includes('.page-wide'), 'base.css 缺少 .page-wide');
    assert.ok(base.includes('.page-narrow'), 'base.css 缺少 .page-narrow');
  });

  it('所有页面用卡片组织内容，且不再套自带宽度容器', () => {
    const pageFiles = listJs(PAGES_DIR).concat(listJs(ADMIN_DIR));
    for (const file of pageFiles) {
      const source = fs.readFileSync(file, 'utf8');
      assert.match(source, /class="[^"]*\bcard\b/, `${path.basename(file)} 应使用 .card 卡片布局`);
      assert.doesNotMatch(source, /class="[^"]*\bcontainer\b/, `${path.basename(file)} 不应再套 .container（#app-main 已居中）`);
      assert.doesNotMatch(source, /class="[^"]*\bstat\b/, `${path.basename(file)} 不应使用已删除的 .stat 类`);
    }
  });

  it('套餐页使用参考图的定价卡片结构', () => {
    const source = fs.readFileSync(path.join(PAGES_DIR, 'plans.js'), 'utf8');
    for (const marker of [
      'price-grid',
      'price-card',
      'featured',
      'price-topbar',
      'price-icon',
      'price-amount',
      'price-divider',
      'check-list',
      'check-item',
      'btn-accent',
    ]) {
      assert.ok(source.includes(marker), `plans.js 缺少定价卡片元素 ${marker}`);
    }
    assert.match(source, /plan\.featured|plan\?\.featured/, 'plans.js 应根据 plan.featured 标记推荐卡');
  });

  it('页面不使用 emoji 作为图标（图标应为内联 SVG）', () => {
    const pageFiles = listJs(PAGES_DIR).concat(listJs(ADMIN_DIR));
    for (const file of pageFiles) {
      const source = fs.readFileSync(file, 'utf8');
      assert.ok(!EMOJI.test(source), `${path.basename(file)} 包含 emoji 图标，请改用内联 SVG`);
    }
  });

  it('界面不出现上游品牌字样（含管理后台，品牌清洗函数除外）', () => {
    const coreDir = path.join(PUBLIC, 'assets/js/core');
    const files = [
      path.join(PUBLIC, 'index.html'),
      path.join(PUBLIC, 'assets/js/main.js'),
      ...listJs(PAGES_DIR),
      ...listJs(ADMIN_DIR),
      ...listJs(coreDir).filter((file) => !file.endsWith('ui.js')),
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /3x-ui/i, `${path.basename(file)} 仍包含 3x-ui 品牌字样，请使用中性的「面板 / 用户中心」`);
    }
  });

  it('样式文件包含设计令牌且页面样式使用私有前缀', () => {
    const portal = read('assets/css/portal.css');
    assert.ok(/\.p-[a-z]/.test(portal), 'portal.css 应使用 p- 前缀的页面专属类');
    const admin = read('assets/css/admin.css');
    assert.ok(/\.a-[a-z]/.test(admin), 'admin.css 应使用 a- 前缀的页面专属类');
  });
});
