# 门户前端规范（v1）

> 视觉方向以 `docs/design-system.md`（v2：极简、现代、居中、无卡片堆叠）为准；本文件保留功能与模块契约。

前端是**零依赖、零构建**的静态 SPA：纯 ES Module + 原生 DOM + 手写 CSS，由 Node 后端直接托管 `portal/public/`。
不要引入任何 npm 包、不要用 JSX/TS、不要用 Tailwind。目标浏览器：近两年 Chrome/Edge/Safari/Firefox。

## 1. 文件与归属

```
portal/public/
├── index.html                  # 唯一 HTML 壳（Lead 负责）
├── favicon.svg                 # Lead 负责
└── assets/
    ├── css/
    │   ├── base.css            # 设计令牌 + 通用组件（Lead 负责，前端不要改）
    │   ├── portal.css          # 用户侧页面样式（portal-ui 负责）
    │   └── admin.css           # 管理侧页面样式（admin-ui 负责）
    └── js/
        ├── main.js             # 启动/路由/外壳（Lead 负责）
        ├── core/               # api/store/router/ui（Lead 负责，只读引用）
        ├── pages/*.js          # 用户侧页面（portal-ui 负责）
        └── admin/*.js          # 管理侧页面（admin-ui 负责）
```

- `index.html` 已经按顺序引入 `base.css`、`portal.css`、`admin.css` 与 `/assets/js/main.js`。新增页面**不要**改 `index.html`。
- 页面模块之间不要互相 import。只能 import `core/` 下的模块（用相对路径，如 `../core/ui.js`）。
- 所有页面模块只允许写自己归属目录下的 `.js` 和对应的 `.css` 文件。

## 2. 页面模块契约

每个页面文件默认导出两个成员：

```js
export const meta = { title: '我的账号', auth: true, admin: false };

/**
 * @param {HTMLElement} root 页面容器（路由已清空）
 * @param {object} ctx 上下文
 */
export async function render(root, ctx) { /* 渲染并绑定事件 */ }
```

- `meta.auth`：需要登录；`meta.admin`：需要管理员。路由层已做跳转，页面内仍应处理 `401/403`（直接 `ctx.navigate('/login')`）。
- `render` 可以是 async（内部自行 await 接口）。抛错会被路由层捕获并显示错误页，尽量自行 try/catch 显示行内错误。
- 页面销毁：路由切换会替换 `#app-main` 的 innerHTML；若注册了 `window`/`document` 级监听或定时器，必须在 `ctx.onCleanup(fn)` 注册清理函数。
- 不要使用 `alert/confirm/prompt`，用 `ctx.ui.confirm()` / `ctx.ui.toast()`。

`ctx` 提供：

| 成员 | 说明 |
|---|---|
| `ctx.api` | 见 §3，所有接口方法返回已解包 `data`，失败抛 `ApiError` |
| `ctx.me` | 当前 `User`（未登录为 `null`） |
| `ctx.config` | `/api/config` 的结果 |
| `ctx.status` | 最近一次 `refreshMe()` 拿到的 `/api/me` 完整对象（含 `live`）；可能为 null |
| `ctx.refreshMe()` | 重新拉取 `/api/me`，返回最新对象并更新头部余额等信息 |
| `ctx.navigate(path)` | hash 路由跳转，如 `navigate('/orders')` |
| `ctx.params` | 路径参数对象（如 `/orders/:orderNo`） |
| `ctx.query` | `?a=b` 解析后的对象 |
| `ctx.toast(msg, type)` | `type: 'success'|'error'|'info'` |
| `ctx.ui` | 见 §3.3 |
| `ctx.onCleanup(fn)` | 注册页面卸载清理 |

## 3. core 模块 API

### 3.1 `core/api.js`

```js
import { api, ApiError } from '../core/api.js';
```

方法（全部按 `docs/api-contract.md`）：

- `api.config()`
- `api.register({username,email,password})` / `api.login({username,password})` / `api.logout()`
- `api.me()` / `api.subscription()` / `api.changePassword({currentPassword,newPassword})`
- `api.plans()`
- `api.orders({page,pageSize,kind})` / `api.order(orderNo)`
- `api.purchase({planId,method,provider})` / `api.recharge({amountCents,provider})`
- `api.mockComplete(orderNo)`
- `api.admin.overview()` / `api.admin.users(params)` / `api.admin.user(id)` /
  `api.admin.setUserStatus(id,status)` / `api.admin.adjustBalance(id,deltaCents,note)` /
  `api.admin.resetPassword(id,newPassword)`
- `api.admin.plans()` / `api.admin.createPlan(body)` / `api.admin.updatePlan(id,body)` / `api.admin.deletePlan(id)`
- `api.admin.orders(params)` / `api.admin.order(id)` / `api.admin.markPaid(id)` /
  `api.admin.retryProvision(id)` / `api.admin.cancelOrder(id)` / `api.admin.recharges(params)`
- `api.admin.settings()` / `api.admin.updateSettings(obj)` / `api.admin.testXui()`

`ApiError`：`{ status, code, message }`。展示时用 `err.message`；`err.code === 'unauthorized'` 时跳登录。

### 3.2 `core/ui.js`

```js
import { ui } from '../core/ui.js';
```

- 格式化：`ui.escape(str)`、`ui.money(cents)` → `¥29.90`、`ui.bytes(n)` → `12.5 GB`、
  `ui.pct(part,total)` → `23%`、`ui.date(ms)` → `2026-11-23`、`ui.dateTime(ms)`、
  `ui.relative(ms)` → `3 天后到期` / `已过期`、`ui.statusText(status)`、`ui.kindText(kind)`
- DOM：`ui.qs(root, sel)`、`ui.qsa(root, sel)`、`ui.on(root, sel, event, fn)`（事件委托）
- 反馈：`ui.toast(msg, type)`、`ui.confirm({title, content, okText, danger})` → `Promise<boolean>`
- 组件（返回 HTML 字符串）：`ui.badge(status)`、`ui.empty({icon,title,desc,actionHtml})`、
  `ui.spinner()`、`ui.pagination({page,total,pageSize,onChange})`（返回 HTML，需自行绑定事件后调用 `onChange`）
- 复制：`ui.copy(text)` → `Promise<boolean>`

### 3.3 其余

- `core/store.js`：`store.user`、`store.config`、`store.setUser()`、`store.clear()`、`store.subscribe(fn)`（Lead 已在 ctx 中封装，页面一般不需要直接用）。
- `core/router.js`：仅 `main.js` 使用。

## 4. 设计系统（base.css 已提供）

必须复用以下类，不要另起一套按钮/卡片样式；页面专属样式写在 `portal.css` / `admin.css`，类名加 `p-` / `a-` 前缀。

- 布局：`.container`（最大宽 1100px 居中）、`.stack`（纵向 16px 间距）、`.row`（横向 flex）、
  `.grid` + `.grid-2` / `.grid-3` / `.grid-4`、`.card`、`.card-head`、`.card-title`、`.card-body`
- 文本：`.text-muted`、`.text-sm`、`.text-lg`、`.mono`、`.text-center`、`.text-danger`、`.text-success`
- 按钮：`.btn` + `.btn-primary` / `.btn-secondary` / `.btn-danger` / `.btn-ghost` / `.btn-sm` / `.btn-block` / `.btn-loading`
- 表单：`.field`、`.field-label`、`.input`、`.select`、`.textarea`、`.hint`、`.input-group`
- 表格：`.table-wrap`、`.table`
- 徽标：`.badge` + `.badge-success` / `.badge-warning` / `.badge-danger` / `.badge-info` / `.badge-muted`
- 其他：`.stat`、`.stat-label`、`.stat-value`、`.progress`、`.progress-bar`、`.alert` + `.alert-info` / `.alert-success` / `.alert-danger`、
  `.tabs`、`.tab` / `.tab.active`、`.pagination`、`.empty`、`.spinner`、`.pill`、`.kv`、`.kv-row`、`.divider`、`.hidden`
- 深浅色：根节点 `data-theme="light|dark"` 已由 `main.js` 管理，页面不要写死颜色，使用 CSS 变量
  （`--bg`、`--surface`、`--surface-2`、`--text`、`--muted`、`--border`、`--primary`、`--primary-600`、`--danger`、`--success`、`--warning`、`--radius`、`--shadow`）。
- 移动端：宽度 < 760px 时表格需包 `.table-wrap` 横向滚动；按钮组用 `.row` 允许换行。

## 5. 页面需求

### 5.1 用户侧（portal-ui）

1. **login.js** — 用户名+密码；错误行内展示；回车提交；底部「还没有账号？注册」；支持 `?next=` 登录后跳转；页面右上角返回首页。
2. **register.js** — 用户名/邮箱(可选)/密码/确认密码；前端校验（用户名规则、密码≥8、两次一致）；成功后直接进入 `#/dashboard`。
3. **dashboard.js** — 核心页：
   - 顶部问候 + 余额卡片 + 「充值」「购买套餐」按钮；
   - 账号卡：套餐名、状态徽标、到期时间（含 `ui.relative`）、设备数上限；
   - 流量卡：进度条（已用/总量，剩余 GB），`usedBytes` 来自 `GET /api/me`；
   - 订阅卡：`subscriptionUrl` 只读输入框 + 复制按钮 + 一键导入说明（v2rayN/Clash/Shadowrocket 文案）+ 单条 `links` 折叠列表（可复制）；
   - 无套餐时显示引导卡片（去购买套餐）；
   - 最近订单列表（最多 5 条，可点击进订单页）。
   - `live.available === false` 时展示黄色提示条，其它信息用 `ctx.me` 缓存字段兜底。
4. **plans.js** — 套餐卡片网格（名称、价格/月、流量、天数、设备数、已购则显示「续费」）；余额支付/在线支付切换；在线支付时选择支付方式（来自 `ctx.config.providers`）；购买成功：
   - `type=redirect` → `location.href = payUrl`
   - `type=mock` → `ctx.navigate('/pay/mock?orderNo=…')`
   - `type=manual` → 展示转账说明 + 跳订单页
   - `type=balance` → toast 成功并跳 `#/dashboard`。
5. **recharge.js** — 金额快捷选项（10/30/50/100/200/500 元）+ 自定义（限制 min/max）；支付方式选择；流程同上；右侧说明余额用途。
6. **orders.js** — 标签页「套餐订单 / 充值记录」；表格列：订单号、类型/套餐、金额、状态、支付方式、创建时间、操作（待支付可「继续支付」/「取消」不可用时置灰；mock 订单可「模拟支付」→ 调 `mockComplete` 后刷新；`sync_pending` 显示「开通中/处理中」提示）。支持分页、状态筛选徽标点击不必须。
7. **account.js** — 账号信息（用户名/邮箱/注册时间/余额）、修改密码表单、退出登录。
8. **mock-pay.js** — 模拟支付页：读取 `orderNo`，展示订单金额与「模拟支付成功」按钮；调用 `api.mockComplete` 后展示结果并跳订单页；仅用于本地/测试环境。
9. **not-found.js** — 404 + 返回首页。

### 5.2 管理侧（admin-ui）

管理页共用左侧或顶部二级导航（在 `admin.css` 里定义 `.a-admin-nav`），路由守卫由 `main.js` 负责。所有列表页都要有：加载态、空态、错误提示、分页。

1. **admin/overview.js** — 统计卡片（用户数/订单数/总收入/今日收入/充值总额/待处理订单）；最近 10 条订单表；3x-ui 连接状态（调用 `testXui`，失败显示红色提示与排查提示）。
2. **admin/users.js** — 搜索（用户名/邮箱）、状态筛选、分页表格：ID、用户名、邮箱、余额、套餐、到期、状态、注册时间；行操作：禁用/启用、调整余额（弹窗输入金额与备注，正负均可）、重置密码（弹窗）。
3. **admin/plans.js** — 套餐表格 + 「新建套餐」；表单字段：名称、描述、价格(元)、天数、流量(GB)、设备数、绑定入站 ID（逗号分隔）、启用、推荐、排序；编辑/删除（删除确认；被订单引用时提示已停用）。
4. **admin/orders.js** — 筛选：类型（全部/套餐/充值）、状态、关键字（订单号/用户名）；表格：订单号、用户、类型、套餐、金额、状态、支付方式、时间；操作：待支付→「标记已支付」/「取消」；`sync_pending`→「重试开通」；详情弹窗展示 `provisionError`。
5. **admin/recharges.js** — 充值记录（`api.admin.recharges`），表格与筛选，总额小计。
6. **admin/settings.js** — 分组表单：
   - 门户：名称、开放注册、货币、人工转账说明、充值上下限、默认入站 ID、订阅基地址；
   - 3x-ui：URL、basePath、API Token（密码框，留空=不修改）、用户名/密码（回退登录）、超时；「测试连接」按钮；
   - 支付：启用的支付方式（多选：mock/manual/epay）、易支付 URL/PID/密钥/类型(alipay|wxpay)/notifyUrl/returnUrl、模拟支付自动完成开关；
   - 保存后 toast；密钥字段旁显示「已配置/未配置」。

## 6. 交互与文案

- 全部中文文案，专业简洁；金额统一 `ui.money`，流量统一 `ui.bytes`，时间统一 `ui.dateTime`。
- 表单提交按钮在请求中设置 `disabled` 并显示加载态，防重复提交。
- 错误优先行内展示（表单字段下方 `.error-text`），全局错误用 `ui.toast(err.message,'error')`。
- 空态必须给出下一步动作按钮（如「去购买套餐」）。
- 所有用户输入渲染到 HTML 前必须 `ui.escape()`（后端也会校验，但 XSS 防线在前端）。

## 7. 自检（提交前）

在自己机器/当前环境执行（不需要安装任何依赖）：

```powershell
node --check portal/public/assets/js/pages/dashboard.js     # 每个改动的 js 文件
node -e "1"                                                # 确认 node 可用
```

- 不能有语法错误；不能有 `console.log` 残留（调试可留 `console.warn` 处理非致命错误）。
- 不能 import 不存在的模块；页面路由文件必须被 `main.js` 的 ROUTES 表引用（Lead 负责接线，但请按 §2 的文件名放好）。
- 不要修改归属范围之外的任何文件。
