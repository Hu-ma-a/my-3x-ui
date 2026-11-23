# 门户视觉设计规范（v3 · 卡片定价页风格）

> 参考图：极简定价页 —— 居中「Pricing」小胶囊标签 + 超大居中标题，三列价格卡片，
> 中间「Best Deal」卡片蓝色高亮；卡片内含图标、名称、大号价格、描述、整行 CTA、分隔线、勾选特性列表。
> 全站统一为**卡片堆叠**布局：内容放在 `.card` 里，页面由若干卡片纵向/网格排列，留白充足。

本文件是视觉层唯一权威；功能与 API 行为仍以 `docs/api-contract.md` 为准。

## 1. 硬性规则

1. **卡片承载内容**：页面主体用 `.card`（白底、1px 浅灰边框、大圆角、轻阴影）。禁止把整页内容裸露成无边界文字墙。
2. **居中标题**：页面标题区默认居中（`.page-head.center`）：`.pill-label` 小胶囊（如「套餐」「Pricing」）→ 大标题 → 一句灰色副标题。
3. **套餐页严格参考图**：`.price-grid` 三列（移动端单列），`.price-card` 卡片；中间推荐卡 `.price-card.featured`：顶部蓝色条 + 白色「推荐」文字、蓝色描边、蓝色 CTA。其余卡片黑色 CTA。
4. **按钮为胶囊形**（`border-radius: 999px`）：主操作黑底白字 `.btn-primary`，强调/推荐卡用蓝色 `.btn-accent`，次要 `.btn-secondary`（白底细边框），文字操作 `.btn-ghost` / `.link-btn`。
5. **勾选列表**：特性/权益用 `.check-list > .check-item`（内联 SVG 圆形对勾 + 文字），参考图样式。
6. **不用 emoji**；图标用 1.5px 描边内联 SVG（`currentColor`）。
7. 圆角：卡片 20px、按钮/胶囊 999px、输入框 12px；阴影只用 `--shadow-card` / `--shadow-pop`。

## 2. 设计令牌（base.css 已定义）

| 令牌 | 用途 |
|---|---|
| `--bg` `--surface` `--surface-2` | 页面底色（浅灰） / 卡片白 / 次级浅灰 |
| `--ink` `--ink-2` `--muted` | 主文字 / 次文字 / 说明文字 |
| `--line` `--line-strong` | 卡片边框 / 输入框边框 |
| `--accent` `--accent-600` `--accent-soft` | 蓝色（推荐卡、选中态、链接） |
| `--success` `--warning` `--danger`（含 `-soft`） | 状态色 |
| `--radius-card: 20px` `--radius-input: 12px` `--radius-pill: 999px` | 圆角 |
| `--shadow-card` `--shadow-pop` | 卡片阴影 / 弹窗阴影 |
| `--content: 1120px` `--content-wide: 1240px` `--content-narrow: 440px` | 容器宽度 |

蓝色取参考图观感：`--accent: #3b6ef6`、hover `#2f5ce0`、浅底 `#eef3ff`。

## 3. 布局骨架（main.js 提供）

```
.shell
 ├─ .topbar（居中，浅色，底部分隔线）
 ├─ .main > .page（#app-main，默认 1120px 居中；管理页 .page-wide 1240px）
 └─ .footer
```

- 页面**不要**再套 `.container`。
- 页面顶部：`.page-head.center`（居中标题块）或 `.page-head`（左对齐，用于管理页）。
- 卡片纵向间距 20–24px；卡片网格用 `.card-grid`（2/3 列，自动降级单列）。

## 4. 组件速查

### 卡片
```html
<section class="card">
  <div class="card-head">
    <h2 class="card-title">流量使用</h2>
    <span class="badge badge-success">正常</span>
  </div>
  <div class="card-body">…</div>
</section>
```
- `.card` / `.card-head` / `.card-title` / `.card-body` / `.card-foot` / `.card-interactive`（hover 上浮）
- `.card-grid` / `.card-grid.cols-2` / `.cols-3` / `.cols-4`

### 标题区（参考图）
```html
<div class="page-head center">
  <span class="pill-label">套餐</span>
  <h1 class="display">选择适合你的套餐</h1>
  <p class="page-desc">按月续费，自动开通，随时查看流量与到期时间。</p>
</div>
```

### 定价卡片（套餐页）
```html
<div class="price-grid">
  <article class="price-card">
    <div class="price-icon"><!-- 24px 内联 SVG --></div>
    <h3 class="price-name">标准套餐</h3>
    <div class="price-amount">¥29.90<small>/ 期</small></div>
    <p class="price-desc">30 天 · 500GB · 3 台设备</p>
    <button class="btn btn-primary btn-block price-cta">立即购买</button>
    <hr class="price-divider">
    <ul class="check-list">
      <li class="check-item">500 GB 高速流量</li>
      <li class="check-item">30 天有效期</li>
      <li class="check-item">最多 3 台设备</li>
    </ul>
  </article>

  <!-- 推荐卡：顶部蓝条 + 蓝色 CTA -->
  <article class="price-card featured">
    <div class="price-topbar">最受欢迎</div>
    <div class="price-icon">…</div>
    <h3 class="price-name">进阶套餐</h3>
    <div class="price-amount">¥59.90<small>/ 期</small></div>
    <p class="price-desc">…</p>
    <button class="btn btn-accent btn-block price-cta">立即购买</button>
    <hr class="price-divider">
    <ul class="check-list">…</ul>
  </article>
</div>
```
- 支付方式选择放在价格卡片**上方或下方**的 `.card` 里（`.chip-group` 选择余额/在线，`.choice-list` 选择支付渠道）。
- 每张卡片的 CTA 都可用（每卡一个按钮，不算「多个主操作」禁忌）。
- 推荐卡判定：`plan.featured === true`，否则取第一个套餐。

### 按钮
`.btn` + `.btn-primary`（黑）/ `.btn-accent`（蓝）/ `.btn-secondary`（白底细边框）/ `.btn-ghost` / `.btn-block` / `.btn-sm` / `.btn-lg`；胶囊圆角，高度 44px（sm 34 / lg 50）。

### 表单
`.field` > `.field-label` + `.input` / `.select` / `.textarea`；`.hint` / `.error-text`；金额输入 `.input-wrap` + `.input-prefix`。输入框 12px 圆角、白底、浅灰边框，聚焦蓝色描边。

### 选择器
- `.chip-group` > `.chip`（选中 `.selected`：黑底或蓝底）
- `.choice-list` > `.choice`（选中蓝色描边 + 浅蓝底），内部 `.choice-radio` / `.choice-main` / `.choice-title` / `.choice-sub`

### 列表（卡片内）
- `.rows` / `.row-item`（行间细线，卡片内使用）
- `.check-list` / `.check-item`（参考图勾选列表）
- `.metrics` / `.metric`（卡片内的指标行：大数字 + 小标签）

### 其他
`.badge`（胶囊彩色底 + 圆点）、`.alert-*`（浅色圆角块）、`.tabs` / `.tab`（下划线）、`.pagination`、`.empty`、`.spinner`、`.modal-*`、`.toast`、`.kv`、`.track` / `.track-fill`、`.table`（放在 `.card` 内，宽松行距）、`.divider`、`.stack` / `.row` / `.grid` 工具类。

## 5. 页面蓝图

### 用户侧（portal-ui）

- **plans（重点参考图）**：
  居中 `.page-head.center`（`.pill-label`「套餐」+ `.display`「选择适合你的套餐」+ `.page-desc`）→ 支付方式 `.card`（`.chip-group` 余额/在线 + 在线时 `.choice-list` 渠道）→ `.price-grid`（3 列；套餐数不足 3 时也保持卡片等宽排列）→ 每个 `.price-card` 按 §4 结构；CTA 文案「立即购买」/已购套餐显示「续费」；推荐卡蓝色高亮。购买成功按原逻辑四分支跳转。
- **dashboard**：`.page-head`（问候 + 充值/购买按钮）→ `.card-grid.cols-2`：套餐状态卡（套餐名、到期、设备数、badge）+ 流量卡（`.metrics` + `.track`）→ 订阅卡（URL 复制 + 客户端说明 `.rows` + 链接折叠）→ 最近订单卡（`.rows`，查看全部）→ 无套餐时卡片内 `.empty` 引导。
- **login / register**：页面居中，`.auth-card`（`.card`，max-width 440，居中 padding 32–36）内含品牌/标题/副标题/表单/胶囊主按钮/底部链接。
- **recharge**：居中窄卡片（`.card` max-width 520）：大号金额输入（¥ 前缀）+ `.chip-group` 快捷金额 + `.choice-list` 渠道 + 摘要行 → `.btn-primary btn-block`。
- **orders**：顶部 tab 卡（`.card` 内含 `.tabs`）→ 订单以**卡片堆叠**（每单一张 `.order-card`，head 显示单号/状态，body 套餐/金额/时间，foot 操作链接）→ `.pagination`。
- **account**：`.card-grid.cols-2`：账号信息卡（`.kv`）+ 修改密码卡（表单）；底部卡片放退出登录。
- **mock-pay**：居中卡片：小标签「模拟支付」→ `.display` 金额 → 订单信息 `.rows` → `.btn-accent btn-block` 模拟支付成功 + 次要按钮。
- **not-found**：居中卡片 `.empty`（404 + 说明）+ 返回按钮。

### 管理侧（admin-ui）

统一 `.page-wide`（1240px），每页：`.page-head`（标题 + 说明 + 主按钮）→ 内容卡片。

- **overview**：`.card-grid.cols-3` 指标卡（每张 `.card`：图标 + 数值 + 标签，参考图卡片质感）→ 最近订单卡（`.rows`）→ 3x-ui 连接卡（状态行 + 入站 `.rows`，失败时 `.alert-danger`）。
- **users**：`.card` 内工具栏（搜索 + 状态筛选）+ `.table` + 分页；禁用/调余额/重置密码用 `.modal-*`。
- **plans**：`.page-head` +「新建套餐」按钮 → `.card` 内筛选 + `.table` + 分页；新建/编辑用弹窗表单（两列字段）。
- **orders**：`.card` 内筛选行 + `.table` + 分页；详情弹窗（`.kv` + `provisionError` 用 `.alert-danger`）。
- **recharges**：与 orders 同布局，仅充值；顶部小计文字。
- **settings**：三个 `.card`（门户 / 3x-ui 连接 / 支付），字段 `.grid-2`，secret 旁「已配置/未配置」；页面底部 `.card` 或按钮区放「保存设置」主按钮；测试连接 `.btn-secondary`，结果 `.rows` / `.alert-*`。

## 6. 移动端

- 900px 以下：`.price-grid` / `.card-grid.cols-3/cols-4` → 单列或两列；760px 以下全部单列。
- 卡片 padding 从 28px 降到 20px；标题 `display` 从 44px 降到 30px。
- 表格横向滚动；工具栏按钮换行；弹窗宽度自适应。

## 7. 自检

- [ ] 页面由 `.card` 组成，卡片间距统一；
- [ ] 套餐页为居中标题 + 三列价格卡片，推荐卡蓝色顶部条 + 蓝色 CTA + 勾选列表；
- [ ] 按钮为胶囊形；每张价格卡都有独立 CTA；
- [ ] 图标全部为内联 SVG，无 emoji；
- [ ] 样式只使用 base.css 组件 + 本页 `p-` / `a-` 前缀；
- [ ] `node --check` 通过，移动端可用。
