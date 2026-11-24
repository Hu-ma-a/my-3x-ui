# 独立用户门户（portal）

面向终端用户的独立自助门户：注册 / 登录、购买套餐、在线充值、查看流量与到期时间、复制订阅链接；管理员在门户后台管理用户（含封禁 / 解封）、管理员账号、套餐、订单与支付配置。

门户通过 **3x-ui 面板的 REST API** 管理节点与客户端，**不修改 3x-ui 核心（Go 面板）代码**：你可以把它装在任意已有的 3x-ui 部署旁边，3x-ui 本身照常升级、照常使用官方面板。

- **零 npm 依赖**：后端只用 Node.js 内置模块（`node:http` / `node:sqlite` / `node:crypto` 等），不需要 `npm install`。
- **零构建前端**：原生 ES Module + 手写 CSS，由 Node 后端直接托管 `portal/public/`，没有打包步骤。
- **数据自持**：门户只有自己的一个 SQLite 文件（默认 `./data/portal.db`），不写 3x-ui 的数据库。
- **hash 路由 SPA**：`#/dashboard`、`#/admin/orders` …… 静态托管不需要 SPA fallback 配置。

## 架构

```
          浏览器（门户 SPA）
                 │  HTTPS
                 ▼
 ┌────────────────────────────────┐      REST API       ┌──────────────────────────┐
 │ 门户后端（Node.js >= 22.5）    │ ──────────────────▶ │ 3x-ui 面板（Go，不改动） │
 │  · HTTP 服务 / 路由 / 会话+CSRF │  admin scope Token  │  · 节点 / 入站           │
 │  · SQLite：用户/套餐/订单/设置  │ ◀────────────────── │  · 客户端（新增/续期）   │
 │  · 支付（易支付回调）/ 开通逻辑 │                     │  · 订阅链接（subId）     │
 └────────────────────────────────┘                     └──────────────────────────┘
                 │
                 ▼
        data/portal.db（门户自己的 SQLite，与 3x-ui 数据库无关）
```

- 门户前端 → 门户后端 → 3x-ui REST API：页面、登录态、订单都在门户侧；真正决定「节点能否用、客户端是否开通」的是 3x-ui。
- 3x-ui 负责节点与客户端；门户只通过 API 调用它，不改其代码，也不需要和它共用数据库。
- 门户数据库是独立的 SQLite 文件，备份 / 迁移主要处理这个文件（含 WAL 文件，必要时还有自动生成的 `.secret`），详见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 功能

### 用户侧

| 路由 | 页面 | 能力 |
|---|---|---|
| `#/login`、`#/register` | 登录 / 注册 | 用户名密码登录、开放注册（可关）、登录后跳转 `?next=` |
| `#/dashboard` | 我的账号 | 套餐名、状态、到期时间、流量进度、设备上限、订阅地址与单条节点链接、最近订单 |
| `#/plans` | 套餐购买 | 套餐卡片；余额支付 / 在线支付；购买后新增或续期客户端 |
| `#/recharge` | 在线充值 | 快捷金额 + 自定义金额（受上下限约束），余额用于购买套餐 |
| `#/orders` | 我的订单 | 套餐订单 / 充值记录、继续支付、模拟支付、开通中状态 |
| `#/account` | 账号设置 | 修改密码、退出登录 |
| `#/pay/mock?orderNo=` | 模拟支付页 | 测试用：点「模拟支付成功」走真实入账/开通流程 |

### 管理侧（`role = admin`）

| 路由 | 页面 | 能力 |
|---|---|---|
| `#/admin` | 管理概览 | 用户 / 订单 / 收入 / 充值统计，3x-ui 连接状态 |
| `#/admin/users` | 用户管理 | 搜索、封禁/解封、调整余额、重置密码 |
| `#/admin/admins` | 管理员 | 新增管理员、启用/禁用、重置密码、删除（保护当前账号与最后一个可用管理员） |
| `#/admin/plans` | 套餐管理 | 新建 / 编辑 / 删除（被订单引用时仅停用）、绑定入站 |
| `#/admin/orders` | 订单管理 | 标记已支付、重试开通、取消、查看 `provisionError` |
| `#/admin/recharges` | 充值记录 | 充值订单与总额小计 |
| `#/admin/settings` | 系统设置 | 门户参数、3x-ui 连接（含「测试连接」）、支付参数 |

### 支付与开通

- 支付方式：**余额支付**、**模拟支付（测试）**、**人工转账**、**彩虹易支付**（支付宝 / 微信）。
- **支付成功后才调用 3x-ui**：新用户首次购买新增客户端；已有客户端按套餐续期（增加天数 / 流量 / 设备数上限）。
- 失败订单进入 `sync_pending`，后台每 30 秒自动重试，管理员也可在「订单管理 → 重试开通」手动重试。
- 开通是幂等的：按订单落库的目标绝对值覆盖，不会重复累加。

## 目录结构

```
portal/
├── package.json              # 脚本与元信息（无第三方依赖）
├── server.js                 # HTTP 服务入口：托管 public/ 静态资源 + /api 路由
├── .env.example              # 环境变量模板（复制为 .env 后修改）
├── src/                      # 后端源码
│   ├── config.js             # 读取环境变量与默认值
│   ├── db.js                 # SQLite（node:sqlite）初始化与数据访问
│   ├── logger.js             # 日志（级别由 PORTAL_LOG_LEVEL 控制）
│   ├── settings-defs.js      # 设置键清单与默认值
│   ├── app.js                # 应用装配
│   ├── api/                  # HTTP 路由处理（公开 / 用户 / 管理 / 支付回调）
│   ├── auth/                 # 会话、CSRF、密码哈希
│   ├── http/                 # 请求/响应、静态资源、工具中间件
│   ├── integrations/         # 3x-ui REST API 客户端、支付网关（epay 等）
│   ├── models/               # 数据模型与查询
│   ├── services/             # 业务逻辑（订单、开通、套餐、用户）
│   ├── util/                 # 通用工具
│   └── jobs/                 # 后台任务（sync_pending 开通重试等）
├── public/                   # 零构建前端（由后端直接托管）
│   ├── index.html            # 唯一 HTML 壳
│   ├── favicon.svg
│   └── assets/
│       ├── css/              # base.css / portal.css / admin.css
│       └── js/               # main.js、core/、pages/（用户侧）、admin/（管理侧）
├── test/                     # node:test 测试（npm test）
├── scripts/
│   ├── install.sh            # 一键安装/升级脚本（systemd 或 Docker，自动装 Node）
│   └── demo.js               # 内置模拟 3x-ui，演示完整流程（npm run demo）
├── data/                     # 运行时生成：SQLite 数据库与自动生成的 .secret（不要提交；备份必须包含）
├── deploy/
│   ├── portal.service        # systemd 单元（含安全加固）
│   └── nginx.conf.example    # nginx 反代 + HTTPS + 安全响应头
├── docs/
│   ├── api-contract.md       # 前后端 API 契约（唯一约定）
│   ├── frontend-spec.md      # 前端页面规范
│   └── DEPLOY.md             # 部署与运维手册
├── docker-compose.yml        # Docker Compose 一键启动（数据卷 portal-data）
├── Dockerfile                # 生产镜像（node:24-alpine、非 root、/data 数据卷）
├── .dockerignore
└── README.md
```

## 环境要求

- **Node.js >= 22.5**（内置 `node:sqlite` 的最低版本），推荐 **Node 24**（LTS）。
- 不需要安装任何 npm 依赖，不需要构建前端。
- 需要一个可访问的 **3x-ui 面板**，以及一个 **admin scope 的 API Token**（见下文「3x-ui 侧准备」）。

检查版本：

```bash
node --version    # 需要 >= v22.5.0
```

`node:sqlite` 在部分 Node 版本仍标记为实验特性，首次打开数据库时可能打印 `ExperimentalWarning`。`npm start` 等脚本已带 `--no-warnings` 抑制；若直接 `node server.js` 看到该警告属正常现象。

## 懒人安装（一键 / Docker）

不想手动装 Node、建目录、写 systemd？三种方式任选，都只需要一两条命令。

### 方式 A：脚本一键安装（推荐，systemd）

**和 3x-ui 装在同一台机器时，零配置一条命令**（脚本会自动识别 3x-ui 的端口 / basePath，并创建一个名为 `portal` 的专用 API Token，无需你手动准备任何参数）：

```bash
sudo bash portal/scripts/install.sh
```

想让它**跟着 3x-ui 升级自动同步**，加 `--watch`（安装 6 小时自检：3x-ui 改端口、升版本、Token 失效时自动更新门户配置并重启）：

```bash
sudo bash portal/scripts/install.sh --watch
```

已经上传 GitHub 后，也可以一条 curl 命令零交互安装：

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/portal/scripts/install.sh \
  | sudo bash -s -- --repo OWNER/REPO
```

脚本会自动：检测/安装 Node 24 → 识别本机 3x-ui（或使用你传入的参数）→ 创建 `portal` 系统用户与 `/opt/portal`、`/etc/portal/portal.env` → 写入 systemd 单元并启动 → 健康检查 → 打印访问地址和初始管理员密码（没传 `--admin-pass` 时随机生成，只打印一次）。

手动指定面板参数（3x-ui 在另一台机器 / 在 Docker 里时）：

```bash
sudo bash portal/scripts/install.sh --xui-url http://10.0.0.5:2053 --xui-token '你的 Token'
```

> 说明：脚本只能读取**本机安装的 3x-ui CLI**。如果 3x-ui 跑在 Docker 容器里，请手动传 `--xui-url`（容器映射到宿主机的端口）和 `--xui-token`；Docker 方式部署门户时，自动模式会使用 `host.docker.internal`，要求面板监听 `0.0.0.0` 而不是只监听 `127.0.0.1`。

升级（保留数据与配置）：

```bash
sudo bash portal/scripts/install.sh --upgrade
```

更多参数：`bash portal/scripts/install.sh --help`；不确定会做什么时先加 `--dry-run`。

### 方式 B：Docker Compose（一条命令）

```bash
cd portal
cp .env.example .env      # 填 PORTAL_SECRET / PORTAL_ADMIN_PASSWORD / XUI_API_TOKEN
docker compose up -d --build
```

数据在命名卷 `portal-data`；升级：拉新代码后重新 `docker compose up -d --build`。

### 方式 C：Docker 一条命令（已发布 GHCR 镜像时）

```bash
docker run -d --name portal --restart unless-stopped \
  -p 127.0.0.1:8090:8090 -v portal-data:/data \
  -e PORTAL_SECRET='至少32位随机串' \
  -e PORTAL_ADMIN_USERNAME=admin -e PORTAL_ADMIN_PASSWORD='你的管理员密码' \
  -e XUI_URL=http://127.0.0.1:2053 -e XUI_API_TOKEN='你的3x-ui Token' \
  ghcr.io/OWNER/REPO-portal:latest
```

只想先看效果、不接 3x-ui：`cd portal && npm run demo`。

### 上传 GitHub 后要做的事（让一键命令可用）

1. 把仓库（至少包含 `portal/` 与 `.github/`）推到 GitHub；
2. 仓库 Settings → Actions → General，确认允许 Actions 运行（默认开启）；
3. 打标签发布：`git tag portal-v1.0.0 && git push origin portal-v1.0.0`。
   `.github/workflows/portal-release.yml` 会自动：
   - 在 Release 里生成 `portal.tar.gz`（一键脚本从这里下载）；
   - 构建并推送镜像 `ghcr.io/<owner>/<repo>-portal:latest`（首次发布后到 Packages 把镜像可见性设为 public，`docker run` 才不需要登录）；
4. 把上面命令里的 `OWNER/REPO` 换成你的 GitHub 用户名/仓库名即可。
   注意：GHCR 镜像名是 `<仓库名>-portal`，不是 `<仓库名>`。

## 快速开始（本地）

```bash
cd portal
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
```

编辑 `.env`，至少设置这些项：

```dotenv
PORTAL_SECRET=<32 位以上随机字符串>
PORTAL_ADMIN_PASSWORD=<管理员密码>
XUI_API_TOKEN=<3x-ui admin scope API Token>
XUI_URL=http://127.0.0.1:2053
```

生成随机密钥：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

启动：

```bash
npm start
```

1. 浏览器打开 <http://127.0.0.1:8090>，用 `PORTAL_ADMIN_USERNAME`（默认 `admin`）和 `PORTAL_ADMIN_PASSWORD` 登录。
2. 进入「管理 → 系统设置」，先点「测试连接」确认 3x-ui 可访问，再校对「默认入站」「订阅基地址」。
3. 进入「管理 → 套餐管理」确认套餐：首次启动（套餐表为空时）会种子一个**「标准套餐」：30 天 / 500GB 流量 / 3 台设备 / ¥29.90，已上架并推荐**；价格、天数、流量、设备数、绑定入站都可以改。
4. 普通用户即可注册、购买、查看订阅。

> **注意**：首次启动时如果数据库里还没有管理员，会用 `PORTAL_ADMIN_USERNAME` / `PORTAL_ADMIN_PASSWORD` 创建；**没有提供 `PORTAL_ADMIN_PASSWORD` 时会随机生成密码并在启动日志里打印一次**，请立即保存并登录后修改。日志只打印一次，重启不会重复打印。

更多部署方式（Docker / systemd / nginx + HTTPS / 运维与故障排查）见 **[docs/DEPLOY.md](docs/DEPLOY.md)**。

## 3x-ui 侧准备

### 1）准备一种认证方式（二选一）

门户支持两种连接 3x-ui 的方式，按你的面板版本选：

**方式 A：API Token（推荐，新版 3x-ui）**

入口在面板里：**设置 → 安全设定 → API 令牌 → 新建令牌**，权限选「管理员（admin）」。创建后令牌只显示一次，请立刻复制。
也可以用命令行生成（二进制名可能是 `x-ui` 或 `3x-ui`）：

```bash
x-ui setting -getApiToken true -tokenName portal -tokenScope admin
```

3x-ui 跑在 Docker 里时：

```bash
docker exec -it <3x-ui容器名> x-ui setting -getApiToken true -tokenName portal -tokenScope admin
```

输出里的 `apiToken:` 就是令牌。建议**为门户单独创建**（名字用 `portal`，便于单独吊销），填到 `.env` 的 `XUI_API_TOKEN`，或部署后在「系统设置 → 3x-ui → API Token」中填写。

> 一键安装脚本（`scripts/install.sh`）在 3x-ui 同机时会自动完成这一步；如果面板里**找不到「API 令牌」入口**，说明你的 3x-ui 版本可能不含该功能，用下面的方式 B。

**方式 B：面板账号密码（旧版 3x-ui / 临时方案）**

```dotenv
XUI_USERNAME=你的面板用户名
XUI_PASSWORD=你的面板密码
```

安装时也可以直接传：`--xui-user 用户名 --xui-pass 密码`。
注意：面板账号若开启了**两步验证（2FA）**，账号密码模式无法登录（登录需要动态码），请改用方式 A，或给门户单独建一个关闭 2FA 的面板账号。

### 2）确认面板地址与入站

- `XUI_URL` 填**门户进程能访问到**的面板地址。门户与面板同机时用 `http://127.0.0.1:2053`（这是面板默认端口）。
- 面板配置了 webBasePath（URL 基础路径）时，`XUI_BASE_PATH` 填同一个值；否则保持 `/`。
- 准备一个可用**入站**（inbound）。开通时绑定入站的优先级：套餐里绑定的入站 → 设置 `portal.defaultInboundIds`（「系统设置 → 默认入站」）→ 3x-ui 的第一个入站。
- 在门户的「系统设置 → 默认入站」里填 inbound ID（多个用英文逗号分隔），或用套餐管理里的「绑定入站 ID」按套餐区分。

### 3）订阅地址

门户用 3x-ui 中客户端的 `subId` 拼接订阅链接。可在「系统设置 → 订阅基地址」（设置键 `portal.subscriptionBaseUrl`）显式配置，例如：

```text
https://sub.example.com/sub/
```

留空时自动从 3x-ui 的 `subURI` / `subPath` 设置推导。配置完成后在用户「我的账号」页确认 「订阅地址」可正常打开。

## 环境变量

门户读取 `portal/.env`（systemd 部署为 `/etc/portal/portal.env`，见 [docs/DEPLOY.md](docs/DEPLOY.md)）。完整清单：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORTAL_HOST` | `0.0.0.0` | 监听地址（反代后建议 `127.0.0.1`） |
| `PORTAL_PORT` | `8090` | 监听端口 |
| `PORTAL_DB_PATH` | `./data/portal.db` | SQLite 路径，目录自动创建 |
| `PORTAL_SECRET` | 无 | 会话/CSRF/签名密钥，生产必填（≥32 字符，低于 16 字符启动会报错） |
| `PORTAL_ADMIN_USERNAME` | `admin` | 首个管理员用户名 |
| `PORTAL_ADMIN_PASSWORD` | 无 | 首个管理员密码；未提供时首次启动随机生成并打印一次 |
| `PORTAL_PUBLIC_URL` | 按请求推断 | 门户对外地址，如 `https://portal.example.com`，用于支付回调 URL |
| `PORTAL_TRUST_PROXY` | `false` | 反向代理后设 `true`（信任 `X-Forwarded-For` / `X-Forwarded-Proto`） |
| `PORTAL_LOG_LEVEL` | `info` | `info` / `debug` |
| `PORTAL_DEPLOY_MODE` | `local` | `systemd` / `docker` / `local`；决定后台是否提供一键更新 |
| `PORTAL_UPDATE_REPO` | 无 | 更新源仓库 `owner/repo`（systemd 安装/升级时自动写入） |
| `PORTAL_UPDATE_MIRROR` | 无 | 下载更新包用的 GitHub 镜像前缀，如 `https://ghproxy.net/` |
| `XUI_URL` | `http://127.0.0.1:2053` | 3x-ui 面板地址 |
| `XUI_BASE_PATH` | `/` | 面板 webBasePath |
| `XUI_API_TOKEN` | 无 | admin scope API Token（推荐） |
| `XUI_USERNAME` / `XUI_PASSWORD` | 无 | 无 token 时回退用户名密码登录 |
| `XUI_TIMEOUT_MS` | `15000` | 调用面板超时 |
| `PAY_PROVIDERS` | `mock,manual,epay` | 启用的支付方式 |
| `EPAY_URL` / `EPAY_PID` / `EPAY_KEY` | 无 | 易支付网关地址 / 商户 PID / 密钥 |
| `EPAY_TYPE` | `alipay` | `alipay` 或 `wxpay` |
| `PAY_MOCK_AUTO_COMPLETE` | `false` | 模拟支付是否自动完成（仅测试环境） |

运行期还可以在「管理 → 系统设置」中调整门户名称、开放注册、默认入站、订阅基地址、3x-ui 连接、支付参数等（设置键与默认值见 [docs/api-contract.md](docs/api-contract.md) §6）。密钥型字段（`xui.apiToken`、`xui.password`、`pay.epay.key`）只写不回显，留空表示不修改。

> **注意：环境变量只在首次启动生效。** 环境变量与「系统设置」页存在同名配置项（如 `XUI_URL` ↔ `xui.url`、`EPAY_URL` ↔ `pay.epay.url`）：只有在 settings 表中还没有该键时，才用环境变量写入数据库作为初始值；之后一律以数据库 / 「系统设置」页为准，**改环境变量不会覆盖已有设置**。如需把某项重置为环境变量的值，删除对应设置键后重启即可。

> **`PORTAL_SECRET` 说明**：生产环境务必显式设置（随机串，建议 ≥32 字符）。未设置时门户会在数据目录自动生成 `.secret`（权限 600）并复用，所以重启不会让会话失效；但请把 `.secret` 和环境文件一起纳入备份，否则换机/恢复后所有会话失效（用户重新登录即可，不影响账号）。

npm 脚本（不需要 `npm install`）：

| 命令 | 实际执行 | 用途 |
|---|---|---|
| `npm start` | `node --no-warnings server.js` | 启动服务 |
| `npm run dev` | `node --no-warnings --watch server.js` | 监听模式，改文件自动重启 |
| `npm test` | `node --no-warnings --test test/` | 运行测试 |
| `npm run demo` | `node --no-warnings scripts/demo.js` | 内置模拟 3x-ui 的完整流程演示 |

## 支付配置

支付方式由 `PAY_PROVIDERS` 控制（默认 `mock,manual,epay`；首次启动作为默认值写入设置，之后以「系统设置 → 支付」为准）。**余额支付**是「扣账户余额」的下单方式，不受该变量影响。

### 模拟支付 mock（仅测试环境）

- 下单后跳转 `#/pay/mock?orderNo=…`，点「模拟支付成功」即走真实的入账 / 开通流程。
- `PAY_MOCK_AUTO_COMPLETE=true` 可让模拟支付自动完成，仅用于本地或测试环境，**不要在生产开启**。
- 生产部署请把 `mock` 从 `PAY_PROVIDERS` 中移除。

### 人工转账 manual

下单后前端展示人工转账说明（设置项 `portal.manualPayInstructions`）。用户转账后联系管理员，管理员在「管理 → 订单管理」对订单点「标记已支付」，订单按已收款完成入账 / 开通。

### 彩虹易支付 epay

采用彩虹易支付协议，支持支付宝 / 微信：

```dotenv
PAY_PROVIDERS=mock,manual,epay
EPAY_URL=https://pay.example.com
EPAY_PID=1000
EPAY_KEY=<商户密钥>
EPAY_TYPE=alipay          # alipay 或 wxpay
PORTAL_PUBLIC_URL=https://portal.example.com
```

| 项目 | 地址 / 说明 |
|---|---|
| 发起支付 | `{EPAY_URL}/submit.php`（由门户后端跳转） |
| 异步通知（回调） | `{PORTAL_PUBLIC_URL}/api/payment/notify/epay` |
| 同步跳回 | `{PORTAL_PUBLIC_URL}/api/payment/return/epay` |
| 签名 | MD5（商户密钥 `EPAY_KEY`） |
| 通知响应 | 纯文本 `success` / `fail` |
| 支持渠道 | 支付宝（`alipay`）/ 微信（`wxpay`） |

> **注意**：异步通知地址必须**公网可达且为 HTTPS**。反向代理必须放行 `/api/payment/notify/`（该路径无会话、无 CSRF，也不应加 Basic Auth 之类的访问控制），否则支付成功也永远不会到账。也可以在「系统设置 → 支付」里配置 epay 参数及自定义 `notifyUrl` / `returnUrl`。

## 订单、开通与重试

1. 支付成功后才调用 3x-ui。新用户首次购买 → 新增客户端（`email = u{userId}@portal`、按套餐写入到期时间 / 流量额度 / 设备数上限，并自动生成 `subId`）。首次启动会种子一个「标准套餐」：**30 天 / 500GB / 3 台设备 / ¥29.90**，用户首次购买即按该套餐在 3x-ui 新建客户端；套餐可在「套餐管理」修改或删除。
2. 已有客户端 → 续期：到期时间从 max(当前, 现在) 起加天数；流量累加；设备上限累加（`0` 表示不限，保持不限）。
3. 3x-ui 调用失败 → 订单进入 `sync_pending` 并记录 `provisionError`；后台每 30 秒自动重试，管理员也可手动「重试开通」。
4. 开通幂等：订单落库目标绝对值，重试时先比对 3x-ui 实际值，已达标视为成功，绝不重复累加。

订单状态含义：

| status | 含义 |
|---|---|
| `pending` | 已创建，待支付 |
| `paid` | 支付成功，待入账 / 开通（过渡态） |
| `provisioning` | 正在调用 3x-ui（前端显示「开通中」） |
| `provisioned` | 套餐订单：客户端已新增 / 续期完成 |
| `credited` | 充值订单：余额已到账 |
| `sync_pending` | 已支付但 3x-ui 调用失败，后台自动重试中 |
| `failed` / `cancelled` | 支付失败 / 超时未支付 / 管理员取消 |

## 部署（生产）

推荐组合：**systemd 托管 Node 进程 + nginx 反向代理 + HTTPS**；也支持 Docker（`node:24-alpine`，非 root，`/data` 数据卷）。完整步骤、安全加固、备份恢复与排障见 **[docs/DEPLOY.md](docs/DEPLOY.md)**。

systemd 摘要（详细步骤见 DEPLOY.md）：

```bash
sudo useradd --system --home /opt/portal --shell /usr/sbin/nologin portal
sudo mkdir -p /opt/portal /etc/portal /opt/portal/data
# 把 portal/ 内容（package.json、server.js、src/、public/、scripts/）放到 /opt/portal
sudo chown -R portal:portal /opt/portal
sudo install -m 600 -o root -g root .env /etc/portal/portal.env
sudo cp deploy/portal.service /etc/systemd/system/portal.service
sudo systemctl daemon-reload && sudo systemctl enable --now portal
```

nginx 摘要：

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/conf.d/portal.conf
sudo vi /etc/nginx/conf.d/portal.conf      # 改 server_name 与证书路径
sudo nginx -t && sudo systemctl reload nginx
```

Docker 摘要（在仓库根目录执行）：

```bash
docker build -t 3x-ui-portal:1.0.0 portal/
docker run -d --name portal --restart unless-stopped \
  -p 127.0.0.1:8090:8090 \
  -v portal-data:/data \
  -e PORTAL_HOST=0.0.0.0 \
  -e PORTAL_DB_PATH=/data/portal.db \
  --env-file portal/.env \
  3x-ui-portal:1.0.0
```

> **注意**：`--env-file` 会覆盖镜像默认值；若 `.env` 里是 systemd 用的 `PORTAL_HOST=127.0.0.1` / `PORTAL_DB_PATH=./data/portal.db`，必须像上面那样用 `-e` 显式覆盖，否则容器监听错地址、数据库写到非持久化路径。

## 版本更新（后台一键更新）

systemd 安装/升级时，脚本会额外安装 `portal-update.timer`（每 30 秒检查更新请求）和以 root 运行的更新执行器 `/usr/local/lib/portal/update-runner.mjs`。管理员可在 **管理 → 系统设置 → 版本更新**：

- **检查更新**：读取 GitHub 最新 Release（`portal-v*`）版本，与当前 `VERSION` 比较；
- **立即更新**：下载 `portal.tar.gz`（发布包附带 `.sha256` 时会校验），调用 `install.sh --upgrade` 自动替换程序文件、备份数据库并重启门户，完成后页面自动刷新。

更新源配置（systemd 一键安装时已自动写入 `/etc/portal/portal.env`）：

```dotenv
PORTAL_UPDATE_REPO=你的用户名/my-3x-ui
# 服务器访问 GitHub 困难时可加镜像前缀
PORTAL_UPDATE_MIRROR=https://ghproxy.net/
```

命令行也可以只检查不安装：

```bash
sudo bash /opt/portal/scripts/install.sh --check-update --repo 你的用户名/my-3x-ui
```

> 后台一键更新仅适用于 **systemd 部署**（服务以 `portal` 用户运行、代码目录只读，实际更新由 root 定时任务完成）。Docker 部署请在宿主机 `docker pull` 新镜像后重启容器；源码/本地部署请执行 `install.sh --upgrade`。数据库与 `/etc/portal/portal.env` 会保留，升级前数据库自动备份到 `/var/backups/portal/`。

## 安全建议

- **必须上 HTTPS**：会话 Cookie、登录密码、支付回调都在公网上跑，nginx 示例已含 TLS 与安全响应头。
- **`PORTAL_SECRET` 必须足够强**（≥32 字符随机串），它用于会话 / CSRF / 签名；生产环境不要随意更换，更换后已登录用户需要重新登录。
- **认证信息只放在环境文件里**：`.env` / `/etc/portal/portal.env` 权限 `600`、属主 root；不要提交仓库。
- **为门户单独创建 3x-ui API Token**（admin scope），怀疑泄露时随时单独吊销。
- **数据库文件权限**：`data/portal.db`（及 `-wal` / `-shm`）权限 `600`，属主为运行门户的用户。
- **定期备份** `data/portal.db`（含 WAL 文件）。若未显式设置 `PORTAL_SECRET`，还要备份数据目录下的 `.secret`；备份本身也要限制访问权限。
- **门户端口不要直接暴露公网**：只监听 `127.0.0.1`，对外只开放 nginx 的 443。
- **日志里不要打印密钥**：应用默认不打印密钥；排障时注意 `PORTAL_LOG_LEVEL=debug` 的输出也可能被导出。
- 生产环境从 `PAY_PROVIDERS` 中移除 `mock`，并保持 `PAY_MOCK_AUTO_COMPLETE=false`。
- 收紧「开放注册」（`portal.registrationEnabled`）并定期检查管理员账号。

## 测试与演示

```bash
npm test        # node --no-warnings --test test/
npm run demo    # node --no-warnings scripts/demo.js：内置模拟 3x-ui，演示完整流程
```

`npm run demo` 会启动内置的模拟 3x-ui 与示例数据，按脚本输出的地址访问即可走完 **注册 → 购买套餐 → 模拟支付 → 开通 → 查看订阅** 的完整流程，适合在没有真实 3x-ui 的机器上验证门户。

健康检查（部署后验证）：

```bash
curl -fsS http://127.0.0.1:8090/api/health
# {"ok":true,"data":{"status":"ok","version":"1.0.0","time":...}}
```

## 常见问题

**启动报 `node:sqlite` 相关错误 / `Cannot find module 'node:sqlite'`**
Node 版本过低。`node:sqlite` 需要 **Node >= 22.5**，请升级到 Node 24；用 `node --version` 确认正在运行的是升级后的 node（多版本共存时注意 PATH）。

**启动出现 `ExperimentalWarning: SQLite is an experimental feature`**
正常现象。npm 脚本已用 `--no-warnings` 抑制；直接 `node server.js` 时会出现，不影响功能。

**3x-ui 接口返回 401 / 403**
Token 无效或 scope 不足：用 `x-ui setting -getApiToken true -tokenScope admin` 重新生成 admin scope Token；检查 `.env` 与「系统设置」里填的是同一个值、没有多余空格；面板是否限制了来源 IP。「系统设置 → 测试连接」可以直接验证。

**无法连接 3x-ui（`ECONNREFUSED` / 超时）**
`XUI_URL` 是否是**门户所在主机**能访问到的地址；面板端口是否放行；面板有 webBasePath 时 `XUI_BASE_PATH` 是否一致；Docker 部署时 `127.0.0.1` 指向的是容器自身而不是宿主机（见 DEPLOY.md 的 Docker 章节）。

**3x-ui 调用超时**
默认 `XUI_TIMEOUT_MS=15000`。面板响应慢（如刚重启、机器负载高）时可调大；否则检查面板是否健康。

**支付成功但订单一直「开通中 / sync_pending」**
查看订单详情的 `provisionError`（如 token 失效、入站不存在、客户端参数非法）。修复后在「订单管理 → 重试开通」手动重试；后台每 30 秒也会自动重试。

**支付回调没到账**
检查三件事：回调地址是否**公网可达**、是否为 **HTTPS**、`EPAY_KEY` 是否与商户后台一致。到 nginx 访问日志确认请求是否到达 `/api/payment/notify/epay`；若整站有 Basic Auth / IP 白名单，需对该路径放行。易支付 notify 返回 `fail` 时，商户后台通常会重试。

**订阅地址不正确 / 打不开**
在「系统设置 → 订阅基地址」显式配置订阅地址（如 `https://sub.example.com/sub/`）；留空时门户从 3x-ui 的 `subURI` / `subPath` 推导，配置不完整就会不对。确认 3x-ui 的订阅服务已启动、端口 / 域名可达。

**注册提示用户名/邮箱已存在**
用户名与邮箱都是唯一的；管理员可在「用户管理」里搜索确认，或在「系统设置」里关闭开放注册后由管理员开号。

**3x-ui 里找不到「API 令牌」入口？**
API Token 是较新 3x-ui 才有的功能，入口在「设置 → 安全设定 → API 令牌 → 新建令牌」（命令行：`x-ui setting -getApiToken true -tokenName portal -tokenScope admin`）。如果你的面板没有这个入口（旧版），门户可以直接用**面板账号密码**：`.env` 填 `XUI_USERNAME` / `XUI_PASSWORD`，或安装时加 `--xui-user 用户名 --xui-pass 密码`；面板账号开了两步验证（2FA）时请改用 API Token 或升级面板。

**升级 3x-ui 后门户会消失吗？**
不会。门户是独立应用（独立目录 + 独立 SQLite），3x-ui 升级只替换面板自身文件，不碰门户。只要门户部署在独立目录 / 独立 Docker 卷（见 `docs/DEPLOY.md` §4/§5），用户、订单、套餐数据都在。真正需要关注的是接口兼容：3x-ui 大版本若改了面板 API，表现为「测试连接失败 / 订单 sync_pending」，改 `portal/src/integrations/xui-client.js` 一处即可；升级后按 `docs/DEPLOY.md` §8.7 做 3 步验证。

**不想手动装 Node / 想一条命令装好？**
用「懒人安装」：`scripts/install.sh`（自动装 Node 24、建服务）或 `docker compose up -d --build`，见上方「懒人安装」一节。

## 相关文档

- [docs/DEPLOY.md](docs/DEPLOY.md) —— 部署与运维手册（Docker / systemd / nginx / 备份恢复 / 排障）
- [docs/api-contract.md](docs/api-contract.md) —— 前后端 API 契约（接口、订单状态、开通规则、设置键）
- [docs/frontend-spec.md](docs/frontend-spec.md) —— 前端页面规范
- [docs/design-system.md](docs/design-system.md) —— 视觉设计规范 v3（卡片定价页风格：居中标题、三列价格卡、推荐卡高亮、全站卡片堆叠）
