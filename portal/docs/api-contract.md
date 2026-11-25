# Portal HTTP API 契约（v1）

本文件是门户前端与后端之间的唯一约定。后端实现若与本文件冲突，以本文件为准改后端（或同步更新本文件）。

## 1. 通用约定

- Base path：`/api`。前端页面由同一服务提供（SPA）。
- 请求/响应均为 JSON（支付回调除外，见 §5）。请求头：`Content-Type: application/json`。
- 响应信封：
  - 成功：`{"ok": true, "data": <任意>}`
  - 失败：`{"ok": false, "error": {"code": "<稳定错误码>", "message": "<中文可读信息>"}}`
- 金额接口字段统一为整数「分」（`amountCents` 等，便于计算与支付网关对接）；前端按门户货币设置换算展示：CNY 显示 `¥ 元`、USD 显示 `$ 美元`。管理后台的「充值额度」「套餐价格」「调整余额」输入框都以元/美元为单位，保存时自动换算成分。
- 货币由设置项 `portal.currency` 控制（`CNY` / `USD`），只影响门户内金额的单位与符号；实际支付渠道支持的币种以对应网关配置为准。
- 流量一律为字节（`totalBytes` / `remainingBytes` / `usedBytes`），展示由前端 `ui.bytes()` 负责。
- 时间一律为 Unix 毫秒整数（`expiresAt`、`createdAt`、`paidAt` 等）。3x-ui 的 `expiryTime` 也是毫秒。
- 鉴权：登录成功后服务端下发 `HttpOnly; SameSite=Lax; Path=/` 的会话 Cookie（`portal_session`）。
- CSRF：`POST` / `PUT` / `PATCH` / `DELETE` 请求必须带 `X-CSRF-Token` 头，值来自登录/注册响应里的 `csrfToken` 或 `GET /api/me` 的 `csrfToken`。
  - 例外：`POST /api/auth/login`、`POST /api/auth/register`、`/api/payment/notify/*`、`/api/payment/return/*` 不需要 CSRF（它们本来就没有会话）。
- 登录失败限流：同一 IP+用户名 5 次/15 分钟，返回 `429` 与 `error.code = "too_many_attempts"`。
- 未登录访问需登录接口：`401`，`error.code = "unauthorized"`。
- 权限不足（非 admin 访问 `/api/admin/*`）：`403`，`error.code = "forbidden"`。
- 参数校验失败：`400`，`error.code = "validation_error"`，`error.message` 直接可展示给用户。

## 2. 数据对象

### 2.1 User

```json
{
  "id": 1,
  "username": "alice",
  "email": "alice@example.com",
  "role": "user",                 // "user" | "admin"
  "status": "active",             // "active" | "disabled"
  "balanceCents": 3000,
  "clientEmail": "u1@portal",     // 映射到 3x-ui 的客户端 email，未购买前为 null
  "subId": "a1b2c3...",           // 3x-ui 订阅 ID，未购买前为 null
  "planName": "标准套餐",          // 最近一次购买的套餐名
  "planStartedAt": 1700000000000,
  "planExpiresAt": 1702592000000,
  "totalBytes": 536870912000,     // 最近一次购买后的总流量额度
  "clientLimit": 3,               // 最近一次购买后的设备数上限，0 = 不限
  "createdAt": 1700000000000,
  "lastLoginAt": 1700000000000
}
```

### 2.2 Plan

```json
{
  "id": 1,
  "name": "标准套餐",
  "description": "30 天有效期，500GB 流量，3 台设备",
  "priceCents": 2990,
  "days": 30,
  "trafficGb": 500,
  "trafficBytes": 536870912000,
  "deviceLimit": 3,
  "inboundIds": [1],
  "enabled": true,
  "featured": false,
  "sort": 0
}
```

### 2.3 Order

```json
{
  "id": 10,
  "orderNo": "P20261123123000AB12",
  "kind": "plan",                    // "plan" | "recharge"
  "userId": 1,
  "username": "alice",
  "planId": 1,
  "planName": "标准套餐",
  "amountCents": 2990,
  "status": "pending",               // 见 §3
  "provider": "epay",                // "balance" | "mock" | "manual" | "epay"
  "payUrl": "https://pay.example.com/submit.php?pid=...",
  "providerTradeNo": null,
  "paidAt": null,
  "provisionedAt": null,
  "provisionError": null,
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000
}
```

订单状态机：

| status | 含义 |
|---|---|
| `pending` | 已创建，待支付 |
| `paid` | 支付成功，待入账/开通（过渡态） |
| `provisioning` | 正在调用 3x-ui（内部态，前端按「开通中」展示） |
| `provisioned` | 套餐订单：3x-ui 客户端已新增/续期完成 |
| `credited` | 充值订单：余额已到账 |
| `sync_pending` | 已支付但 3x-ui 调用失败，后台会自动重试；管理员也可手动重试 |
| `failed` | 关闭/失败（用户取消或超时未支付） |
| `cancelled` | 管理员取消 |

### 2.4 账号总览（GET /api/me）

```json
{
  "user": { /* User */ },
  "csrfToken": "…",
  "live": {
    "available": true,             // false 表示当前无法从 3x-ui 取到实时数据
    "enabled": true,
    "expiresAt": 1702592000000,
    "totalBytes": 536870912000,
    "usedBytes": 12884901888,
    "remainingBytes": 523986010112,
    "deviceLimit": 3,
    "subId": "a1b2c3...",
    "subscriptionUrl": "https://sub.example.com/sub/a1b2c3...",
    "links": ["vless://..."],
    "error": null                  // available=false 时的可展示原因
  },
  "recentOrders": [ /* Order[] 最多 5 条 */ ]
}
```

## 3. 公开接口

### GET /api/health
→ `{"ok":true,"data":{"status":"ok","version":"1.0.0","time":1700000000000}}`

### GET /api/config
前端启动时调用，用于渲染门户名、开放注册开关、支付方式。
```json
{
  "portalName": "示例云用户中心",
  "registrationEnabled": true,
  "currency": "CNY",
  "providers": [
    {"id":"balance","label":"余额支付","kind":"balance"},
    {"id":"epay","label":"支付宝/微信","kind":"redirect"},
    {"id":"manual","label":"人工转账","kind":"manual"},
    {"id":"mock","label":"模拟支付（测试）","kind":"mock"}
  ],
  "manualInstructions": "请转账到 …，然后联系管理员确认。",
  "minRechargeCents": 100,
  "maxRechargeCents": 1000000
}
```

### GET /api/plans
→ `{"ok":true,"data":{ "plans": [Plan...] }}`，仅 enabled 的套餐，按 `sort,id`。

### GET /api/auth/captcha
→ `data = {"captchaId":"…","question":"3 + 5 = ?","expiresIn":300}`（注册前获取，5 分钟内有效，一次性使用）。

### POST /api/auth/register
请求：`{"username":"alice","email":"a@b.com","password":"********","captchaId":"…","captchaAnswer":"8"}`
- `username`：3–32 字符，仅 `a-zA-Z0-9_.-`
- `email`：可选，合法邮箱，唯一
- `password`：8–72 字符
- `captchaId` / `captchaAnswer`：来自验证码接口，回答正确才能注册
成功：`200`，`data = {"user": User, "csrfToken": "…"}` 并设置会话 Cookie。
失败码：`registration_closed`、`captcha_required`、`captcha_invalid`、`username_taken`、`email_taken`、`validation_error`。

### POST /api/auth/login
请求：`{"username":"alice","password":"********"}`
成功：`data = {"user": User, "csrfToken": "…"}` + 会话 Cookie。
失败：`invalid_credentials`（401）、`account_disabled` / `account_banned`（403）、`too_many_attempts`（429）。

### POST /api/auth/logout
成功：`data = {"ok":true}`，清除 Cookie。

## 4. 用户接口（需登录）

### POST /api/me/password
请求：`{"currentPassword":"…","newPassword":"…"}`
成功：`data={"ok":true}`；改密后服务端使其它会话失效。

### GET /api/me/orders?page=1&pageSize=20&kind=plan|recharge
→ `data = {"items":[Order...],"total":12,"page":1,"pageSize":20}`

### GET /api/me/orders/:orderNo
→ `data = Order`

### GET /api/me/subscription
→ `data = {"subId","subscriptionUrl","links":[string],"expiresAt","remainingBytes","available"}`

### POST /api/me/purchase
请求：`{"planId":1,"method":"balance"|"online","provider":"epay"|"mock"|"manual"}`
- `method=balance`：余额足够时立即扣款并开通。
- `method=online`：必须指定可用 `provider`（`mock` / `manual` / `epay`）。
成功：
```json
{"order": Order, "payment": {
  "type": "balance" | "redirect" | "mock" | "manual",
  "payUrl": "https://…" | null,
  "instructions": "…" | null
}}
```
- `type=balance` 时 `order.status` 已是 `provisioned` 或 `sync_pending`。
- `type=mock` 时 `payUrl = /portal/pay/mock?orderNo=…`，前端跳转该页（路由 `/pay/mock`）。
- `type=redirect` 时前端 `location.href = payUrl`。
- `type=manual` 时展示 `instructions`。
失败码：`plan_not_found`、`plan_disabled`、`insufficient_balance`、`provider_unavailable`、`xui_unavailable`（开通失败但订单会转 `sync_pending`，通常仍返回 200）。

### POST /api/me/recharge
请求：`{"amountCents":10000,"provider":"epay"|"mock"|"manual"}`
成功结构同 purchase（`order.kind = "recharge"`）。

### POST /api/me/payments/:orderNo/mock-complete
仅 `provider=mock` 且订单 `pending` 时可用；模拟支付成功并走真实入账/开通流程。
→ `data = Order`（最终态）。失败码：`not_found`、`invalid_provider`、`invalid_status`。

## 5. 支付回调（无会话、无 CSRF）

### POST /api/payment/notify/:provider
- `:provider = "epay"`：`application/x-www-form-urlencoded`（也接受 query）。服务端校验签名、金额、`trade_status=TRADE_SUCCESS`，幂等入账。
- 响应体必须为纯文本：成功 `success`，失败 `fail`（HTTP 200）。

### GET /api/payment/return/:provider?orderNo=…
支付网关同步跳回：302 到 `{basePath}/#/orders?orderNo=…`（前端展示结果），随后前端轮询订单状态。

## 6. 管理接口（role=admin）

### GET /api/admin/overview
```json
{
  "users": {"total": 120, "active": 118},
  "plans": {"total": 4, "enabled": 3},
  "orders": {"total": 500, "pending": 3, "today": 12},
  "revenue": {"totalCents": 1200000, "todayCents": 30000, "monthCents": 200000},
  "recharges": {"totalCents": 500000, "todayCents": 10000}
}
```

### 用户管理
- `GET /api/admin/users?query=&status=&page=1&pageSize=20` → `{"items":[User...],"total":…,"page":…,"pageSize":…}`
- `GET /api/admin/users/:id` → `data={"user":User,"orders":[Order...],"live":{…同 §2.4 live}}`
- `POST /api/admin/users/:id/status` `{"status":"active"|"disabled"}` → `data=User`（禁用同时踢下线）
- `POST /api/admin/users/:id/balance` `{"deltaCents":1000,"note":"补偿"}` → `data=User`
- `POST /api/admin/users/:id/reset-password` `{"newPassword":"…"}` → `data={"ok":true}`

### 套餐管理
- `GET /api/admin/plans` → `{"items":[Plan...]}`（含 disabled）
- `POST /api/admin/plans` 请求体：`{"name","description","priceCents","days","periodLabel","trafficGb","deviceLimit","inboundIds","enabled","featured","sort"}` → `data=Plan`（`periodLabel` 为价格后显示的单位，默认「期」，可改月/年等）
- `PUT /api/admin/plans/:id` 同上（部分字段可省，缺省保持不变）→ `data=Plan`
- `DELETE /api/admin/plans/:id` → `data={"ok":true}`；有订单引用时仅置为 disabled 并返回 `data={"ok":true,"disabled":true}`

### 订单管理
- `GET /api/admin/orders?kind=plan|recharge&status=&query=&page=&pageSize=` → `{"items":[Order...],"total":…}`
  - `query` 匹配 `orderNo` 或 `username`。
- `GET /api/admin/orders/:id` → `data=Order`
- `POST /api/admin/orders/:id/mark-paid` → 未支付订单视为已收款，完成入账/开通 → `data=Order`
- `POST /api/admin/orders/:id/retry-provision` → 仅 `sync_pending`/`paid` 可用，重跑 3x-ui 开通 → `data=Order`
- `POST /api/admin/orders/:id/cancel` → 仅 `pending` 可用 → `data=Order`
- `GET /api/admin/recharges?status=&query=&page=&pageSize=` → 等价 `kind=recharge`。

### 设置
- `GET /api/admin/settings` →
```json
{"items":[
  {"key":"portal.name","value":"示例云用户中心","type":"string","label":"门户名称"},
  {"key":"xui.apiToken","value":"","hasValue":true,"type":"secret","label":"3x-ui API Token"},
  {"key":"pay.epay.key","value":"","hasValue":false,"type":"secret","label":"易支付密钥"}
]}
```
  密钥型字段永远不回传明文（`value` 为空，`hasValue` 表示已配置）。
- `PUT /api/admin/settings` 请求：`{"portal.name":"…","portal.registrationEnabled":"true", …}`（只允许已知键；空字符串表示清除密钥；未出现的键不变）
- `POST /api/admin/settings/test-xui` → `data={"ok":true,"panelVersion":"…","inbounds":[{"id":1,"remark":"…","protocol":"vless"}],"clientCount":3}`；失败 `{"ok":false,"error":{...}}` 由信封表达。

设置键清单（后端允许的键）：

| key | 类型 | 默认 |
|---|---|---|
| `portal.name` | string | 3x-ui 用户中心 |
| `portal.registrationEnabled` | bool("true"/"false") | true |
| `portal.currency` | string | CNY |
| `portal.manualPayInstructions` | string | 请转账后联系管理员确认 |
| `portal.defaultInboundIds` | string(逗号分隔) | "" |
| `portal.subscriptionBaseUrl` | string | ""（空则自动从 3x-ui 设置推导） |
| `portal.minRechargeCents` | int | 100 |
| `portal.maxRechargeCents` | int | 1000000 |
| `xui.url` | string | http://127.0.0.1:2053 |
| `xui.basePath` | string | / |
| `xui.apiToken` | secret | "" |
| `xui.username` | string | ""（无 token 时回退登录） |
| `xui.password` | secret | "" |
| `xui.timeoutMs` | int | 15000 |
| `pay.providersEnabled` | string(逗号分隔) | mock,manual,epay |
| `pay.epay.url` | string | "" |
| `pay.epay.pid` | string | "" |
| `pay.epay.key` | secret | "" |
| `pay.epay.type` | string | alipay |
| `pay.epay.notifyUrl` | string | ""（空则由请求 Host 推断） |
| `pay.epay.returnUrl` | string | ""（同上） |
| `pay.mockAutoComplete` | bool | false |

## 7. 开通规则（支付成功后的 3x-ui 调用）

1. 用户没有 `clientEmail`，或 3x-ui 中查不到该客户端，或 `subId` 为空 → **新增客户端**：
   - `email = u{userId}@portal`
   - `expiryTime = 支付时间 + plan.days * 86400000`（毫秒）
   - `totalGB = plan.trafficGb * 1024^3`（字节；默认套餐 30 天 / 500GB）
   - `limitHwid = plan.deviceLimit`（可用客户端/设备数量）
   - `subId`：自动生成并写入
   - `inboundIds`：套餐绑定的入站；为空则用设置 `portal.defaultInboundIds`；再为空则取 3x-ui 第一个入站
2. 已有客户端 → **续期**：
   - `expiryTime = max(now, 当前到期) + plan.days * 86400000`
   - `totalGB = 当前额度 + plan.trafficGb * 1024^3`（当前为 0 表示不限，保持 0）
   - `limitHwid = 当前上限 == 0 ? 0 : 当前上限 + plan.deviceLimit`（当前不限则保持不限）
3. 开通是**幂等**的：订单在调用前落库目标绝对值（`expected_expiry_ms`/`expected_total`/`expected_limit`），
   调用成功但进程崩溃后重试时，先比对 3x-ui 实际值，已达标即视为成功，否则用绝对值覆盖（绝不重复累加）。
4. 3x-ui 调用失败：订单置 `sync_pending` 并记录 `provisionError`；后台每 30s 重试，管理员也可手动重试。
5. 余额支付/充值走的入账在同一数据库事务内完成，`credit_applied` 保证只入账一次。

## 8. 前端路由（SPA，hash 路由：`#/path`）

| 路由 | 页面 | 需要登录 |
|---|---|---|
| `#/` | 首页（未登录→登录页，已登录→仪表盘） | - |
| `#/login` | 登录（支持 `?next=/admin`） | 否 |
| `#/register` | 注册 | 否 |
| `#/dashboard` | 我的账号（套餐/到期/流量/设备/订阅链接） | 是 |
| `#/plans` | 套餐购买 | 是 |
| `#/recharge` | 在线充值 | 是 |
| `#/orders` | 我的订单/充值记录 | 是 |
| `#/account` | 账号设置（改密） | 是 |
| `#/pay/mock?orderNo=` | 模拟支付确认页 | 是 |
| `#/admin` | 管理概览 | 管理员 |
| `#/admin/users` | 用户管理 | 管理员 |
| `#/admin/plans` | 套餐管理 | 管理员 |
| `#/admin/orders` | 订单管理 | 管理员 |
| `#/admin/recharges` | 充值记录 | 管理员 |
| `#/admin/settings` | 系统设置（3x-ui/支付） | 管理员 |

> 使用 hash 路由是为了让静态文件服务无需任何 SPA fallback 配置，任何静态服务器/反向代理都能直接托管。
