# 门户视觉设计规范（v2 · 简约现代居中）

> 目标：像一个**现代产品官网 / SaaSS 控制台**，而不是传统后台管理系统。
> 关键词：极简、留白、居中、克制的单色系 + 一个强调色、排版驱动层次、细线分隔而非卡片。

本文件是视觉层唯一权威。功能与 API 行为仍以 `docs/api-contract.md` 为准。

## 1. 五条硬规则

1. **居中单列**：所有页面内容在 `.page` 居中容器内（默认 `--content: 920px`），不铺满全屏、不做左右分栏仪表盘。
2. **不要卡片**：禁止 `class="card"`、卡片网格、带阴影的统计块。用「留白 + 细线 + 大字」组织信息：
   - 分区用 `.section`（标题下 1px 细线）；
   - 列表用 `.rows` / `.row-item`（行间 1px 细线）；
   - 指标用 `.metrics` / `.metric`（无边框，细竖线分隔）。
3. **一个页面一个主操作**：每屏最多一个 `.btn-primary`，其余用 `.btn-secondary` / `.btn-ghost` / 文本链接 `.link-btn`。
4. **排版承担层次**：标题大、留白足、正文 13–15px；标签用 `.eyebrow`（11px 大写、字距）；数字用 tabular-nums。
5. **不用 emoji 当图标**；需要图标时用 1.5px 描边的小 SVG（可选，能不用就不用）。

## 2. 设计令牌（已定义在 base.css）

| 令牌 | 含义 |
|---|---|
| `--bg` / `--surface` / `--surface-2` | 页面底色 / 内容面 / 次级面 |
| `--ink` / `--ink-2` / `--muted` | 主文字 / 次文字 / 弱化文字 |
| `--line` / `--line-strong` | 细线 / 输入框等强一点的线 |
| `--accent` / `--accent-soft` | 强调色（链接、选中、进度）/ 弱底 |
| `--success` `--warning` `--danger`（含 `-soft`） | 语义色 |
| `--radius` `--radius-sm` `--radius-lg` `--radius-pill` | 圆角 |
| `--shadow-pop` `--shadow-soft` | 仅弹窗/浮层使用，普通内容不要阴影 |
| `--content` / `--content-wide` / `--content-narrow` | 920 / 1080 / 420 |
| `--topbar-h` | 顶栏高度（68px） |

只用这些变量，不写死颜色；深浅色由 `data-theme` 自动切换。

## 3. 布局骨架（main.js 已提供）

```
.shell
 ├─ .topbar > .topbar-inner（居中的 brand / .nav / .actions）
 ├─ .main > .page（#app-main，默认居中 920px）
 └─ .footer > .footer-inner
```

- `.page`：默认 920px 居中；管理页用 `.page-wide`（1080px）；登录/注册用 `.page-narrow`（420px，页面内容垂直居中，见 `.auth`）。
- 页面不要自己再套 `.container` 或额外宽度容器。
- 垂直节奏：页面顶部 `padding-top: 8px`；区块之间 `margin-top: 64px`（`.section`），移动端 40px。

## 4. 组件速查

### 排版
- `.eyebrow` — 小标签：`<p class="eyebrow">套餐状态</p>`
- `.display` — 超大标题（仪表盘套餐名/支付金额）
- `.page-title` / `.page-desc` — 页面标题 + 说明
- `.lede` — 导语（16px，次文字色，最多 60ch）
- `.text-muted` `.text-sm` `.mono` `.text-center` `.text-danger` `.text-success`

### 分区与列表（替代卡片）
```html
<section class="section">
  <div class="section-head">
    <h2 class="section-title">订阅信息</h2>
    <a class="link-btn" href="#">管理</a>
  </div>
  <div class="rows">
    <div class="row-item">
      <div class="row-main">
        <div class="row-title">到期时间</div>
        <div class="row-sub">2027-02-21 · 剩余 90 天</div>
      </div>
      <div class="row-side">生效中</div>
      <button class="row-action">复制</button>
    </div>
  </div>
</section>
```

### 指标（无卡片）
```html
<div class="metrics">
  <div class="metric"><div class="metric-value">500 GB</div><div class="metric-label">总流量</div></div>
  <div class="metric"><div class="metric-value">12.4 GB</div><div class="metric-label">已使用</div></div>
</div>
```

### 细进度线
`<div class="track"><div class="track-fill" style="width: 32%"></div></div>`（可加 `.warning`/`.danger`）

### 按钮
`.btn .btn-primary`（黑/白反色主按钮）、`.btn-secondary`、`.btn-ghost`、`.btn-danger`、`.btn-sm`、`.btn-lg`、`.btn-block`、`.link-btn`（表格/行内文字操作）、`.btn-icon`。

### 表单
`.field` > `.field-label` + `.input` / `.select` / `.textarea`；`.hint`、`.error-text`；金额输入用 `.input-wrap` + `.input-prefix` + `.input.with-prefix`。

### 选择器
- 金额/时长快捷项：`.chip-group` > `.chip`（选中加 `.selected`）。
- 支付方式（带说明的单选行）：`.choice-list` > `.choice`（选中加 `.selected`），内部用 `.choice-main` / `.choice-title` / `.choice-sub`。

### 套餐列表（替代卡片网格）
```html
<div class="plan-list">
  <div class="plan-row">
    <div class="plan-main">
      <div class="plan-name">标准套餐 <span class="plan-tag">推荐</span></div>
      <p class="plan-desc">30 天 · 500GB · 3 台设备</p>
      <div class="plan-meta"><span><b>500 GB</b> 流量</span><span><b>30 天</b> 有效期</span><span><b>3 台</b> 设备</span></div>
    </div>
    <div class="plan-side">
      <div class="plan-price">¥29.90<small> / 期</small></div>
      <button class="btn btn-secondary btn-sm">选择</button>
    </div>
  </div>
</div>
```
选中态：`.plan-row.selected`。

### 表格（仅管理端/订单类数据，宽松、无背景表头）
`.table-wrap` > `.table`；表头大写小字、行间细线、操作列用 `.link-btn`。用户侧列表优先用 `.rows`，不要用表格。

### 状态
`ui.badge(status)` 输出 `.badge .badge-*` —— 圆点 + 彩色小字，无药丸背景。

### 其他
`.tabs` / `.tab`（下划线式）、`.pagination`、`.empty`（居中留白，无边框）、`.alert`（淡底，无重边框）、`.modal-*`（弹窗）、`.toast`、`.spinner`、`.loading-block`、`.kv`（账号信息用定义列表）、`.divider`、`.hidden`、`.grid`/`.grid-2/3/4`（仅在确实需要并列时使用，且不要每项都套卡片）。

## 5. 页面蓝图

### 用户侧（portal-ui）
- **login / register**：`.page-narrow` + `.auth` 垂直居中；顶部小品牌点 + 30px 标题 + 一句副标题（居中），字段左对齐，主按钮 `.btn-primary btn-block`，底部一行 `.link-btn`（注册/登录互换、返回首页）。不要卡片边框，不要装饰插画。
- **dashboard**：
  1) Hero：`.eyebrow`（套餐状态）→ `.display` 套餐名 → 一行 `.hero-meta`（到期 · 设备数 · 状态）→ 右侧/下方两个操作（充值 `.btn-secondary`、购买套餐 `.btn-primary`）。
  2) 流量：`.section` + `.metrics`（已用/剩余/总量）+ 细进度线 + 一行说明。
  3) 订阅：`.section` + 一行 URL（`.input` readonly + 复制 `.btn-secondary btn-sm`）+ `.rows` 里列 1–2 条说明（v2rayN / Clash / Shadowrocket）。
  4) 最近订单：`.section` + `.rows`（每行：套餐名 + 订单号/时间 + 金额 + 状态 badge + 查看）。
  5) 无套餐：`.empty` 引导购买。
  6) `live.available=false`：`.alert-warning` 一行提示，其余用缓存字段。
- **plans**：标题 + 一句说明 → 支付方式切换（`.chip-group`：「余额支付 / 在线支付」）→ 在线支付时再选渠道（`.choice-list`）→ `.plan-list` 套餐行 → 选中行显示金额与「立即购买」主按钮（或每行右侧按钮）。不要套餐卡片网格。
- **recharge**：`.page-narrow` 风格单列：金额大号输入（¥ 前缀）+ `.chip-group` 快捷金额 + 支付渠道 `.choice-list` + 一行摘要（到账金额）→ 主按钮。
- **orders**：`.tabs`（套餐订单/充值记录）+ 一行 `.rows` 订单列表（不采用密集表格；移动端友好）+ `.pagination`。每行右侧状态与操作（继续支付/模拟支付/查看）。
- **account**：`.kv` 账号信息 + `.section` 修改密码（两列字段可单列）+ 退出登录 `.btn-ghost`（危险确认）。
- **mock-pay**：`.page-narrow` 居中：小标签「模拟支付」→ `.display` 金额 → 订单号小字 → `.btn-primary btn-block`。不要卡片。
- **not-found**：`.empty` 居中 + 两个按钮（返回首页/我的账号）。

### 管理侧（admin-ui）
统一 `.page-wide`（1080px）。
- **overview**：页面标题 + 说明 → `.metrics` 一行（用户数、订单数、总收入、今日收入、充值总额、待处理订单，6 个以内）→ `.section` 最近订单 `.rows` → `.section` 3x-ui 连接：一行状态点 + 文案 + 测试按钮，失败时 `.alert-danger` + 建议。
- **users**：标题 + 说明 → 工具栏（搜索输入 + 状态 `.select` + 查询按钮）一行 → `.table`（ID/用户名/余额/套餐/到期/状态/操作）+ `.pagination`；操作 `.link-btn`；禁用/调余额/重置密码用 `.modal-*` 弹窗。
- **plans**：标题 + 说明 + 「新建套餐」主按钮 → 工具栏（搜索/筛选）→ `.table` 套餐列表 + 操作（编辑/删除）→ 新建/编辑用弹窗表单（字段两列，`.field`/`.input`）。
- **orders**：标题 → 筛选行（类型/状态/关键字）→ `.table` + 分页 → 详情弹窗（`.kv` 展示，`provisionError` 用 `.alert-danger`）。
- **recharges**：同 orders，仅充值；顶部一行小计文字。
- **settings**：标题 + 说明 → 三个 `.section`（门户 / 3x-ui 连接 / 支付）各含 `h2.section-title` 与字段网格（`.grid-2`，不要卡片）；secret 字段旁「已配置/未配置」小字；每个 section 底部或页面底部一个「保存设置」主按钮（不要悬浮条）；「测试连接」为 `.btn-secondary`。

## 6. 移动端

- 760px 以下：`.page` 内边距 16px；`.metrics` 允许 2 列；`.plan-row` 改单列（价格与按钮在下一行）；`.table` 允许横向滚动但列数尽量少（管理端可隐藏次要列，用详情弹窗查看）。
- 顶栏：品牌 + 主题切换 + 退出；导航换行到第二行（横向可滚动）。
- 触控目标最小 40px 高。

## 7. 自检清单

- [ ] 没有 `class="card"`，没有卡片网格/阴影统计块；
- [ ] 内容在 `.page` 居中，桌面端左右留白充足；
- [ ] 每屏只有一个 `.btn-primary`；
- [ ] 用户侧列表用 `.rows`，管理端表格无背景表头、行高宽松；
- [ ] 页面只使用 base.css 组件类 + 自己的 `p-` / `a-` 前缀样式；
- [ ] 不用 emoji 图标，不用重渐变/重阴影；
- [ ] `node --check` 通过，不 import 任何模块；
- [ ] 桌面 + 移动端都可用（CSS 媒体查询）。
