# 3x-ui 独立用户门户 —— 部署与运维手册

本文覆盖：架构、Docker / systemd 部署、nginx 反向代理与 HTTPS、安全加固、备份恢复、升级、日志与健康检查、故障排查。

> 日常使用与功能说明见 [../README.md](../README.md)；接口与设置键见 [api-contract.md](api-contract.md)。
> 文中命令默认在 Linux（Debian/Ubuntu/CentOS 均可）执行，涉及 Windows 本地调试的地方单独标注。

## 1. 架构与部署形态

```
浏览器 ──HTTPS──▶ nginx（443，TLS 终止、安全响应头）
                    │  proxy_pass http://127.0.0.1:8090
                    ▼
            门户后端 Node.js（只监听 127.0.0.1:8090）
              ├── 静态资源：public/（零构建 SPA，hash 路由）
              ├── 业务：登录/会话/CSRF、套餐、订单、充值
              ├── SQLite：data/portal.db（门户独有）
              └── REST API（admin scope Token）
                    │
                    ▼
            3x-ui 面板（Go，默认 2053）──▶ 节点 / 入站 / 客户端 / 订阅（subId）
```

| 组件 | 职责 | 默认端口 |
|---|---|---|
| 门户前端 | 用户 / 管理页面，静态 ES Module，由门户后端托管 | 随门户 |
| 门户后端 | HTTP、会话鉴权、订单与开通逻辑、支付回调 | 8090 |
| 门户数据库 | 门户自己的用户 / 订单 / 设置，SQLite 单文件 | — |
| 3x-ui 面板 | 节点、入站、客户端（新增/续期）、订阅 | 2053（以实际为准） |

要点：

- **3x-ui 核心不改动**。门户只通过面板 REST API 操作它，3x-ui 的数据库、配置、升级互不影响。
- **两个数据库是分开的**：3x-ui 用它的（默认 `/etc/x-ui/x-ui.db`），门户用 `data/portal.db`。门户不是 3x-ui 的备份，反之亦然。
- 门户数据库是单文件 SQLite，备份、迁移、回滚围绕这个文件 + `.env` / `.secret` 密钥文件。
- 门户端口（8090）**不要直接暴露公网**，对外只开 nginx 的 443。

部署形态二选一：

| 方式 | 适用 | 章节 |
|---|---|---|
| systemd 直接跑 Node | 推荐；主机已有 Node 24 或愿意安装 | §5 |
| Docker（`node:24-alpine`） | 不想在宿主机装 Node；已有容器平台 | §4 |

## 2. 前置条件

> 使用 §12 的「一键安装脚本」时，Node 24 会自动安装（apt/dnf/yum/apk 或官方二进制兜底），可跳过本节的手动 Node 安装。

- **Node.js >= 22.5，推荐 Node 24**（`node:sqlite` 需要 22.5+）。容器镜像已内置。
- 一个能访问的 **3x-ui 面板**，并已取得 **admin scope API Token**（§3.1）。
- 一个域名 + 可签发的 HTTPS 证书（支付回调必须是 HTTPS）。
- 门户与 3x-ui 之间的网络连通性：同机走 `127.0.0.1`，跨机走内网 IP / 域名 + 端口放行。
- root 或 sudo（安装 systemd 单元、nginx、证书）。

检查 Node：

```bash
node --version    # 需要 >= v22.5.0，推荐 v24.x
command -v node   # systemd 单元里要用绝对路径
```

## 3. 公共准备（两种部署方式都要做）

### 3.1 准备 3x-ui 认证方式（二选一）

**方式 A：API Token（推荐，新版 3x-ui）**

面板入口：**设置 → 安全设定 → API 令牌 → 新建令牌**（权限选「管理员 admin」），令牌只显示一次，请立即保存。
也可以用命令行（二进制名可能是 `x-ui`，也可能是 `3x-ui`）：

```bash
x-ui setting -getApiToken true -tokenName portal -tokenScope admin
```

3x-ui 跑在 Docker 里：

```bash
docker exec -it <3x-ui容器名> x-ui setting -getApiToken true -tokenName portal -tokenScope admin
```

输出里的 `apiToken:` 即 Token。**建议为门户单独创建一个 Token**（名字用 `portal`）：便于泄漏时单独吊销，也不影响其它集成。

**方式 B：面板账号密码（旧版 3x-ui，或没有 Token 功能时）**

```dotenv
XUI_USERNAME=面板用户名
XUI_PASSWORD=面板密码
```

注意：面板账号开启**两步验证（2FA）**时账号密码模式不可用（登录需要动态码），请改用方式 A 或给门户单独建一个关闭 2FA 的面板账号。门户已自动处理 3x-ui 的登录 CSRF 校验，无需额外配置。

### 3.2 确认面板地址与 webBasePath

- `XUI_URL` 必须填**门户进程能访问到的**面板地址。门户与面板同机：`http://127.0.0.1:2053`。
- 面板配置了 webBasePath（URL 基础路径）时，`XUI_BASE_PATH` 填同一值；否则保持 `/`。
- 若面板走 HTTPS 且证书是自签的，Node 会拒绝连接——建议给面板配正式证书，或使用内网 HTTP 地址。

### 3.3 准备入站与订阅地址

- 准备一个可用入站。开通时入站选择优先级：套餐绑定的入站 → 设置 `portal.defaultInboundIds`（「系统设置 → 默认入站」）→ 3x-ui 的第一个入站。
- 订阅：门户用客户端 `subId` 拼订阅链接。在「系统设置 → 订阅基地址」（`portal.subscriptionBaseUrl`）显式配置更可靠，例如 `https://sub.example.com/sub/`；留空则自动从 3x-ui 的 `subURI` / `subPath` 推导。

### 3.4 准备环境文件

以 `portal/.env.example` 为模板，生成生产环境文件（在 `portal/` 目录执行；systemd 用其中的第二份拷贝，Docker 用 `--env-file` 指向任意安全路径）：

```bash
cd portal
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"   # 生成 PORTAL_SECRET
```

必填项：

| 变量 | 要求 |
|---|---|
| `PORTAL_SECRET` | **生产必填**，建议 ≥32 字符随机串（低于 16 字符启动会报错）；用于会话 / CSRF / 签名。未设置时会自动生成并保存到数据目录 `.secret`（权限 600），备份时需一并备份 |
| `PORTAL_ADMIN_PASSWORD` | 首个管理员密码；不填则首次启动随机生成并打印一次 |
| `XUI_API_TOKEN` | §3.1 得到的 admin scope Token（或改用 `XUI_USERNAME` / `XUI_PASSWORD` 回退登录） |
| `PORTAL_PUBLIC_URL` | 门户对外地址，如 `https://portal.example.com`，支付回调 URL 依赖它 |

> **注意：环境变量只在首次启动生效。** 对设置表里还没有的键，才用环境变量写入初始值；之后以数据库 / 「系统设置」页为准，改环境变量不会覆盖已有设置。需要重置某项为环境变量值时，删除对应设置键后重启。

其余变量（`PORTAL_HOST`、`PORTAL_PORT`、`PORTAL_DB_PATH`、`PORTAL_TRUST_PROXY`、`PORTAL_LOG_LEVEL`、`XUI_*`、`PAY_*`、`EPAY_*`）完整清单见 [../README.md](../README.md#环境变量)。

## 4. Docker 部署

构建上下文是 **`portal/` 目录**（`.dockerignore` 也在这个目录），不要在仓库根目录直接 `docker build .`。

### 4.1 构建

```bash
# 在仓库根目录执行
docker build -t 3x-ui-portal:1.0.0 portal/
```

镜像基于 `node:24-alpine`，无 npm 依赖、无构建阶段；以非 root 的 `node` 用户运行，数据目录 `/data` 声明为 `VOLUME`，`EXPOSE 8090`。

### 4.2 运行

```bash
docker run -d --name portal --restart unless-stopped \
  -p 127.0.0.1:8090:8090 \
  -v portal-data:/data \
  -e PORTAL_HOST=0.0.0.0 \
  -e PORTAL_DB_PATH=/data/portal.db \
  --env-file portal/.env \
  3x-ui-portal:1.0.0
```

- `-p 127.0.0.1:8090:8090`：只绑定回环地址，公网只经 nginx 访问；不要写成 `-p 8090:8090` 直接暴露。
- `-v portal-data:/data`：SQLite 持久化，**必须挂载**，否则重建容器数据全丢。也可以用宿主机目录：`-v /opt/portal-data:/data`。
- `-e PORTAL_HOST=0.0.0.0` / `-e PORTAL_DB_PATH=/data/portal.db`：显式覆盖。**`--env-file` 的优先级高于镜像内 `ENV`**，如果 env 文件里还写着 systemd 用的 `PORTAL_HOST=127.0.0.1` 或 `PORTAL_DB_PATH=./data/portal.db`，容器会监听错地址或把数据库写到容器内的 `/app/data`（不持久化）。要么按上面的 `-e` 显式覆盖，要么在给 Docker 用的 env 文件里改这两项。
- 镜像内已设 `PORTAL_DATA_DIR=/data`，自动生成的 `.secret` 等数据也落在数据卷里，容器重建后不会丢。若在 env 文件里覆盖了 `PORTAL_DB_PATH`，请确保它仍在 `/data` 下（数据卷内）。
- 容器内必须监听 `0.0.0.0`，否则端口映射进不来。
- 容器以非 root 的 `node` 用户（uid 1000）运行，挂载宿主机目录时注意属主：`sudo chown -R 1000:1000 /opt/portal-data`。

### 4.3 容器内访问 3x-ui

容器里的 `127.0.0.1` 是**容器自己**，不是宿主机：

| 3x-ui 位置 | 做法 |
|---|---|
| 宿主机上（非容器） | 加 `--add-host=host.docker.internal:host-gateway`，`XUI_URL=http://host.docker.internal:2053` |
| 同机另一个容器 | 两个容器加入同一 Docker 网络（`--network <网络名>`），`XUI_URL=http://<3x-ui容器名>:2053` |
| 另一台机器 | `XUI_URL=http://<内网IP或域名>:2053`，放行防火墙端口 |

```bash
# 示例：3x-ui 在宿主机上
docker run -d --name portal --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 127.0.0.1:8090:8090 \
  -v portal-data:/data \
  -e PORTAL_HOST=0.0.0.0 \
  -e PORTAL_DB_PATH=/data/portal.db \
  -e XUI_URL=http://host.docker.internal:2053 \
  --env-file portal/.env \
  3x-ui-portal:1.0.0
```

### 4.4 docker compose（可选）

在 `portal/` 下自建 `docker-compose.yml`（示例，不是仓库交付文件）：

```yaml
services:
  portal:
    build: .
    image: 3x-ui-portal:1.0.0
    container_name: portal
    restart: unless-stopped
    ports:
      - "127.0.0.1:8090:8090"
    env_file: .env
    environment:
      PORTAL_HOST: 0.0.0.0
      PORTAL_DB_PATH: /data/portal.db
    volumes:
      - portal-data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8090/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

volumes:
  portal-data:
```

```bash
cd portal && docker compose up -d --build
```

### 4.5 验证与运维命令

```bash
docker ps --filter name=portal                       # STATUS 列应显示 healthy
docker exec portal node -e "fetch('http://127.0.0.1:8090/api/health').then(r=>r.text()).then(console.log)"
docker logs -f portal                                # 看启动日志（含首次生成的管理员密码，只打印一次）
docker restart portal
```

镜像里保留了 `scripts/`：`docker run --rm -p 8090:8090 3x-ui-portal:1.0.0 npm run demo` 可以在容器里跑演示（无需真实 3x-ui，访问地址以脚本输出为准）。

## 5. systemd 部署（推荐）

### 5.1 创建运行用户与目录

```bash
sudo useradd --system --home /opt/portal --shell /usr/sbin/nologin portal
sudo mkdir -p /opt/portal /etc/portal /opt/portal/data
```

版式约定（`deploy/portal.service` 按此路径写好）：

| 路径 | 用途 | 属主 / 权限 |
|---|---|---|
| `/opt/portal` | 程序目录（`package.json`、`server.js`、`src/`、`public/`、`scripts/`） | `portal:portal`，目录 755 |
| `/etc/portal/portal.env` | 环境变量文件（内容即 `.env`） | `root:root`，**600** |
| `/opt/portal/data` | SQLite 数据目录（`portal.db` + `-wal` / `-shm`） | `portal:portal`，**700** |

### 5.2 部署代码

```bash
# 在仓库根目录执行：只同步运行所需文件，不带 data/ 与测试
sudo rsync -a --delete \
  --exclude 'data' --exclude 'test' --exclude '.env' \
  portal/ /opt/portal/

sudo install -m 600 -o root -g root portal/.env /etc/portal/portal.env
sudo chown -R portal:portal /opt/portal
sudo chmod 700 /opt/portal/data
```

> 也可以用 git 部署，但**不要把 `data/` 和 `.env` 放进代码同步范围**。

### 5.3 安装并启动单元

```bash
sudo cp /opt/portal/deploy/portal.service /etc/systemd/system/portal.service
sudo systemctl daemon-reload
sudo systemctl enable --now portal
```

`deploy/portal.service` 已包含的加固项：

- `User=portal` / `Group=portal`：非 root 运行；
- `NoNewPrivileges=yes`：进程不能提权；
- `ProtectSystem=strict` + `ReadWritePaths=/opt/portal/data`：全盘只读，**只有数据目录可写**；
- `PrivateTmp=yes`、`PrivateDevices=yes`：私有 `/tmp`、不暴露设备节点；
- `ProtectHome=yes`：看不到 `/home`、`/root`；
- `UMask=0077`：新建文件默认 600；
- `ProtectKernelTunables` / `ProtectKernelModules` / `ProtectControlGroups` / `ProtectClock` / `ProtectHostname`、`RestrictSUIDSGID`、`RestrictRealtime`、`RestrictNamespaces`、`LockPersonality`、`SystemCallArchitectures=native`、`RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`；
- `CapabilityBoundingSet=`（空）：8090 是非特权端口，不需要任何 capability；
- `Restart=on-failure` + `RestartSec=5s` + 启动限流。

**注意事项：**

1. 单元里 `ExecStart=/usr/bin/node`。用 `command -v node` 确认实际路径并改单元；通过 nvm / fnm / Volta 装在用户目录的 Node **不适用**（`ProtectHome=yes` 会挡住，且 systemd 不加载 shell 配置）。
2. 若修改 `PORTAL_DB_PATH`，必须同步把新的数据库目录加入 `ReadWritePaths=`，否则 SQLite 无法写入。
3. `ProtectProc` / `ProcSubset` 需要 systemd >= 247，老版本会忽略这两行并给出警告，不影响启动。
4. 单元里不写任何密钥；全部经 `EnvironmentFile=/etc/portal/portal.env` 注入。

### 5.4 验证

```bash
sudo systemctl status portal --no-pager
sudo journalctl -u portal -n 50 --no-pager
curl -fsS http://127.0.0.1:8090/api/health
# {"ok":true,"data":{"status":"ok","version":"1.0.0","time":...}}
```

首次启动时若数据库没有管理员，会创建 `PORTAL_ADMIN_USERNAME`（默认 `admin`）账号；**未提供 `PORTAL_ADMIN_PASSWORD` 时会随机生成密码并在日志里打印一次**：

```bash
sudo journalctl -u portal -n 100 --no-pager | grep -i admin
```

登录后立刻在「账号设置」改密，并从日志/配置里删掉明文密码。

## 6. nginx 反向代理与 HTTPS

示例见 [`deploy/nginx.conf.example`](../deploy/nginx.conf.example)。

### 6.1 证书

```bash
sudo apt install -y nginx certbot python3-certbot-nginx   # Debian/Ubuntu
sudo certbot --nginx -d portal.example.com
```

或把自有证书路径填进配置的 `ssl_certificate` / `ssl_certificate_key`。

### 6.2 配置

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/conf.d/portal.conf
sudo vi /etc/nginx/conf.d/portal.conf     # 改 server_name 与证书路径
sudo nginx -t && sudo systemctl reload nginx
```

示例已包含：

- HTTP → HTTPS 301 跳转；
- TLS 1.2/1.3，HSTS、`X-Content-Type-Options`、`X-Frame-Options: DENY`、`Referrer-Policy`、`Permissions-Policy`（CSP 注释掉，按需开启）；
- 转发头：`Host`、`X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto`、`X-Forwarded-Host`；
- 超时：`proxy_connect_timeout 5s`、`proxy_send_timeout 60s`、`proxy_read_timeout 60s`（门户调用 3x-ui 默认最长 15s，开通/重试可能更久，读超时要足够）；
- `/api/payment/notify/` 与 `/api/payment/return/` 单独放行（支付回调无会话、无 CSRF，**不得加认证**）；
- `/assets/` 长缓存（只用 `expires`，避免 location 内 `add_header` 覆盖 server 级安全头）。

> **注意**：门户应用自身也会发送 CSP、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 等安全头，nginx 示例里也配了一份。同名头出现两次时浏览器会叠加处理（CSP 取交集）。如果前端资源被 CSP 拦截，先核对应用发出的 CSP，再把 nginx 里重复的头注释掉；HSTS 建议保留在 nginx 层。

### 6.3 门户侧配套

反向代理后，`.env` 里建议这样设置：

```dotenv
PORTAL_HOST=127.0.0.1
PORTAL_TRUST_PROXY=true
PORTAL_PUBLIC_URL=https://portal.example.com
```

- `PORTAL_TRUST_PROXY=true` 才会信任 `X-Forwarded-For` / `X-Forwarded-Proto`；否则门户看到的客户端 IP 全是 `127.0.0.1`，**登录失败限流会误伤所有用户**。
- 正因为信任代理头，门户端口只能绑 `127.0.0.1`、且不能绕过 nginx 直接访问，否则客户端可伪造 `X-Forwarded-For`。

### 6.4 支付回调 URL

易支付后台或「系统设置 → 支付」里配置：

| 用途 | URL |
|---|---|
| 异步通知 | `https://portal.example.com/api/payment/notify/epay` |
| 同步跳回 | `https://portal.example.com/api/payment/return/epay` |

> **注意**：回调 URL 的取值优先级是「系统设置里的 `notifyUrl` / `returnUrl`」→ `PORTAL_PUBLIC_URL` → 按请求 Host 推断。生产请显式配置 `PORTAL_PUBLIC_URL`（并在设置页核对），避免因反代头缺失推导出 `http://127.0.0.1:8090`。

## 7. 安全加固清单

部署完成前逐条确认：

- [ ] 全站 HTTPS，HTTP 301 跳转，HSTS 已开启；证书自动续期（`systemctl status certbot.timer`）。
- [ ] `PORTAL_SECRET` 显式设置为 ≥32 字符随机串（或确认 `data/.secret` 已生成并纳入备份），且未提交到仓库 / 未出现在日志里。
- [ ] `/etc/portal/portal.env`（或 Docker 的 env 文件）权限 `600`、属主 root。
- [ ] 数据目录 700、`portal.db` 及 `-wal` / `-shm`、`.secret` 权限 600，属主为运行用户。
- [ ] 3x-ui 使用**门户专用** admin scope Token；泄露可单独吊销。
- [ ] 门户只监听 `127.0.0.1`（或 Docker 只 publish 到 `127.0.0.1`）；防火墙未开放 8090。
- [ ] `PORTAL_TRUST_PROXY=true` 仅在与 nginx 同机 / 可信网络下开启。
- [ ] 生产环境 `PAY_PROVIDERS` 不含 `mock`，`PAY_MOCK_AUTO_COMPLETE=false`。
- [ ] 支付回调路径无 Basic Auth / IP 白名单拦截。
- [ ] 开放注册按业务决定（`portal.registrationEnabled`），管理员账号使用强密码。
- [ ] 定期备份 `data/portal.db`（含 WAL）与 `.secret`，备份文件权限 600 且异地留存。
- [ ] 日志不打印密钥：排障开 `PORTAL_LOG_LEVEL=debug` 后注意导出范围。
- [ ] 反向代理只信任来自内网的 `X-Forwarded-For`；门户端口不可绕过 nginx 直接被公网访问。

## 8. 运维

### 8.1 日志

systemd：

```bash
sudo journalctl -u portal -f                 # 实时
sudo journalctl -u portal --since today      # 今天
sudo journalctl -u portal -p err             # 只看错误
```

Docker：

```bash
docker logs -f --tail 200 portal
```

- 级别由 `PORTAL_LOG_LEVEL` 控制：`info`（默认）/ `debug`。排障时临时打开 `debug`，完成后改回 `info` 并重启。
- journald 自动轮转；若要限制占用，在 `/etc/systemd/journald.conf` 设 `SystemMaxUse=`。Docker 建议给 json-file 配轮转：

```bash
docker run ... --log-opt max-size=20m --log-opt max-file=5 ...
```

### 8.2 健康检查

```bash
curl -fsS http://127.0.0.1:8090/api/health
# 正常：{"ok":true,"data":{"status":"ok","version":"1.0.0","time":...}}
```

- 返回 200 且 `data.status = "ok"` 即进程存活（用于存活探针；3x-ui 连通性请用「管理 → 系统设置 → 测试连接」确认）。
- Docker 镜像自带 `HEALTHCHECK`，`docker ps` 的 STATUS 列会显示 healthy / unhealthy。
- 接监控时用同一命令：非 200 或连接失败即告警。
- 注意：若修改 `PORTAL_PORT`，Docker 健康检查里的端口要同步改（或用 `--health-cmd` 覆盖）。

### 8.3 备份

必须备份的内容：

1. `data/portal.db`（**连同 `portal.db-wal` / `portal.db-shm`**，如果存在）；
2. 数据目录下的 `.secret`（仅在未显式设置 `PORTAL_SECRET` 时生成）——丢了会导致所有会话失效，但不影响账号密码登录；
3. 环境文件（`/etc/portal/portal.env` 或 Docker 使用的 `.env`）——里面有 `PORTAL_SECRET` 与 3x-ui Token，**单独加密保存**。

SQLite 默认开启 WAL：直接用 `cp` 复制主文件在写入瞬间可能拿到不一致快照，推荐用 SQLite 在线备份：

```bash
# 宿主机上有 sqlite3（Debian/Ubuntu: apt install sqlite3）
sqlite3 /opt/portal/data/portal.db ".backup '/var/backups/portal-$(date +%F).db'"
```

没有 `sqlite3` CLI 时，二选一：

```bash
# 方式 A：停服后用 docker cp 复制（停止写入，快照一致）
docker stop portal
docker cp portal:/data/portal.db  ./portal-$(date +%F).db
docker cp portal:/data/portal.db-wal ./portal-$(date +%F).db-wal 2>/dev/null || true
docker cp portal:/data/.secret ./portal-$(date +%F).secret 2>/dev/null || true
docker start portal

# 方式 B：短暂停服后复制文件（systemd）
sudo systemctl stop portal
sudo cp -a /opt/portal/data/portal.db* /var/backups/portal-$(date +%F)/
sudo cp -a /opt/portal/data/.secret /var/backups/portal-$(date +%F).secret 2>/dev/null || true
sudo systemctl start portal
```

> **注意**：只复制 `portal.db` 而丢掉 `-wal` 文件，可能丢失最近未 checkpoint 的订单/用户数据。最稳妥的是 `.backup` 命令或停服后连 `-wal` / `-shm` 一起复制。

每日备份（systemd 主机，cron 示例）：

```cron
# /etc/cron.d/portal-backup
17 3 * * * root sqlite3 /opt/portal/data/portal.db ".backup '/var/backups/portal-$(date +\%F).db'" && find /var/backups -name 'portal-*.db' -mtime +30 -delete
```

备份文件权限 `600`；备份里含用户数据与密码哈希，按敏感数据处理。

### 8.4 恢复

```bash
sudo systemctl stop portal
sudo cp -a /var/backups/portal-2026-11-20.db /opt/portal/data/portal.db
sudo rm -f /opt/portal/data/portal.db-wal /opt/portal/data/portal.db-shm
sudo chown portal:portal /opt/portal/data/portal.db
sudo chmod 600 /opt/portal/data/portal.db
sudo systemctl start portal
curl -fsS http://127.0.0.1:8090/api/health
```

Docker：

```bash
docker stop portal
docker run --rm -v portal-data:/data -v "$PWD":/backup alpine \
  sh -c "rm -f /data/portal.db-wal /data/portal.db-shm && cp /backup/portal-2026-11-20.db /data/portal.db && chown -R 1000:1000 /data && chmod 600 /data/portal.db"
docker start portal
```

> **注意**：容器以非 root 的 `node` 用户（uid 1000）运行，恢复后的数据库文件属主必须改成 `1000:1000` 且可读，否则门户会因 SQLite 无法打开而启动失败。上面的 `chown` 就是为此。

恢复后确认 `PORTAL_SECRET` 与备份时一致（否则旧会话失效，但用户可用原密码重新登录；`PORTAL_SECRET` 更换本身是安全的）。

### 8.5 升级

原则：**先备份，再换代码，只替换程序文件，保留 `data/` 与 env 文件。**

```bash
# 1) 备份（数据库 + .secret + env）
sqlite3 /opt/portal/data/portal.db ".backup '/var/backups/portal-pre-upgrade-$(date +%F).db'"
sudo cp -a /etc/portal/portal.env /var/backups/portal.env.$(date +%F)
sudo cp -a /opt/portal/data/.secret /var/backups/portal.secret.$(date +%F) 2>/dev/null || true

# 2) 停服
sudo systemctl stop portal

# 3) 替换程序文件（保留 data/）
sudo rsync -a --delete \
  --exclude 'data' --exclude 'test' --exclude '.env' \
  /path/to/new/portal/ /opt/portal/
sudo chown -R portal:portal /opt/portal

# 4) 启动并验证
sudo systemctl start portal
curl -fsS http://127.0.0.1:8090/api/health
sudo journalctl -u portal -n 50 --no-pager
```

Docker 升级：

```bash
docker build -t 3x-ui-portal:1.0.1 portal/
docker stop portal && docker rename portal portal-old
docker run -d --name portal --restart unless-stopped \
  -p 127.0.0.1:8090:8090 -v portal-data:/data \
  -e PORTAL_HOST=0.0.0.0 -e PORTAL_DB_PATH=/data/portal.db \
  --env-file portal/.env \
  3x-ui-portal:1.0.1
# 验证通过后清理：docker rm portal-old
```

回滚：换回旧镜像 tag / 旧代码目录，并从升级前的备份恢复数据库（若新版本已改过数据库结构）。**注意：升级前务必确认备份可用，不要跳过第 1 步。**

### 8.6 从旧机器迁移

1. 新机器按 §5 或 §4 装好门户（先不启动，或启动后立即停）；
2. 迁移 `data/portal.db`（及 `-wal` / `-shm`）、`data/.secret` 与 env 文件；
3. 确认属主 / 权限（600）与 `PORTAL_DB_PATH` 指向正确；
4. 启动并验证 `/api/health`，然后登录检查用户、订单、设置是否齐全；
5. 更新「系统设置 → 3x-ui」为新的面板地址（若面板也迁移了），点「测试连接」。

### 8.7 升级 3x-ui 会不会影响门户

分两层看：

1. **文件与数据层：不会（前提是按本文档把门户独立部署）。**
   - 门户是独立进程 + 独立 SQLite，不写 3x-ui 数据库、不改 3x-ui 代码。
   - 3x-ui 官方升级脚本只替换面板自身（默认 `/usr/local/x-ui`、systemd unit、`/etc/x-ui` 配置），不会删除门户目录或门户数据卷。
   - **唯一会丢的情况**：把门户放在 3x-ui 的安装目录 / 代码仓库目录里，然后整目录重装、重解压、`rsync --delete` 覆盖或换服务器。因此门户务必放在独立目录（本文档用 `/opt/portal`）或独立 Docker 卷（`portal-data`）；升级前按 §8.3 备份 `data/portal.db` + `data/.secret` + env。
   - Docker 特别注意：不要和 3x-ui 共用同一 compose 后执行 `docker compose down -v`，那会删除命名卷。

2. **接口兼容层：可能有变化，但不会「消失」，且只需小改一处。**
   - 门户只通过 3x-ui 的 REST API 工作（入站列表、客户端新增/更新、订阅链接、面板设置），兼容逻辑集中在 `portal/src/integrations/xui-client.js` 一个文件。
   - 3x-ui 大版本若改动这些接口，表现是「测试连接失败 / 订单 sync_pending」，改这一个文件即可，不需要重装门户。
   - 两类只是配置变化：面板端口 / webBasePath / 域名变了，或重装面板后 API Token 重新生成 → 到「系统设置 → 3x-ui」更新地址或 Token 即可。

**3x-ui 升级后的 3 步验证**：

1. 「系统设置 → 3x-ui → 测试连接」，确认能列出入站；
2. 用一个测试账号走一次最便宜的购买（或测试环境用模拟支付），确认 3x-ui 里客户端被**新增/续期**；
3. 看订单状态是否 `provisioned`，失败则看订单详情 `provisionError` 并按 §9 处理。

> 说明：官方 3x-ui 发布包不包含本门户（`portal/` 是你这份代码里的独立应用），所以重新下载 3x-ui 新版不会把门户带过去，也不会覆盖已独立部署的门户；请把门户按 §4/§5 独立部署并单独备份。

## 9. 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 启动报 `node:sqlite` / `Cannot find module 'node:sqlite'` | Node 版本 < 22.5 | 升级到 Node 24；确认 systemd / PATH 用的是升级后的 `node`（`command -v node`） |
| 日志出现 `ExperimentalWarning: SQLite is an experimental feature` | `node:sqlite` 的实验特性提示 | 正常现象；npm 脚本已带 `--no-warnings`，直接 `node server.js` 时忽略即可 |
| 3x-ui 接口 401 / 403 | Token 无效、scope 不是 admin、有空格、面板限制来源 IP | §3.1 重新生成 admin scope Token；「系统设置 → 测试连接」验证；核对 `.env` 与设置页是否一致 |
| 连接 3x-ui 被拒 / 超时 | `XUI_URL` 从门户主机不可达；webBasePath 不匹配；Docker 内 `127.0.0.1` 指向容器自己 | 用 `curl -v <XUI_URL>` 从门户主机验证；`XUI_BASE_PATH` 与面板一致；Docker 按 §4.3 改 `host.docker.internal` / 同一网络 |
| 支付回调失败 / 不到账 | 回调 URL 非公网、非 HTTPS、`EPAY_KEY` 不匹配、路径被认证拦截 | 核对两个回调 URL；在 nginx access log 中 grep `payment` 看请求是否到达；`/api/payment/notify/` 放行认证；商户后台重发通知 |
| 订单 `sync_pending` | 开通 3x-ui 失败（token、入站不存在、参数非法、超时） | 看订单详情 `provisionError`；修复后「订单管理 → 重试开通」；后台每 30 秒自动重试 |
| 订阅地址不正确 / 打不开 | `portal.subscriptionBaseUrl` 未配、3x-ui `subURI`/`subPath` 不完整、订阅服务未开 | 「系统设置 → 订阅基地址」显式配置（如 `https://sub.example.com/sub/`）；验证 3x-ui 订阅端口/域名可达 |
| 登录后反复跳登录 / 会话无效 | `PORTAL_SECRET` 变更；用 HTTP 访问导致浏览器丢弃 `Secure` Cookie；反代缺 `X-Forwarded-Proto` / `X-Forwarded-Host` | 统一 `PORTAL_SECRET`；确认全站 HTTPS；`PORTAL_TRUST_PROXY=true` 并检查 nginx 转发头 |
| 登录提示 429 `too_many_attempts` | 同 IP+用户名 15 分钟内失败 5 次 | 等待 15 分钟；确认 `PORTAL_TRUST_PROXY` 正确（否则代理 IP 被共享限流） |
| 端口被占用（`EADDRINUSE`） | 8090 已被其它进程使用 | 用 `ss -ltnp` 查看 8090 占用进程；改 `PORTAL_PORT`（Docker 健康检查端口需同步） |
| 管理员密码丢失 | 无离线重置命令 | 能登录时在「账号设置」修改；完全无法登录时，先从备份恢复或联系维护者，**不要手工改数据库** |

## 10. 测试与演示

```bash
cd portal
npm test        # node --no-warnings --test test/
npm run demo    # node --no-warnings scripts/demo.js：内置模拟 3x-ui，演示完整流程
```

- `npm test`：门户后端测试（`node:test`，不需要网络与 3x-ui）。
- `npm run demo`：启动内置的模拟 3x-ui 与示例数据，按脚本输出访问即可走完 **注册 → 购买套餐 → 模拟支付 → 开通 → 查看订阅** 流程；适合验证部署与前端页面，不依赖真实面板。
- 上线前建议在预发环境跑一遍真实流程：用 `mock` 支付买一个套餐，确认 3x-ui 中出现了 `u{userId}@portal` 客户端、订阅链接可用，再切换正式支付方式。

## 11. 常用命令速查

```bash
# 健康检查
curl -fsS http://127.0.0.1:8090/api/health

# systemd
sudo systemctl start|stop|restart|status portal
sudo journalctl -u portal -f

# Docker
docker logs -f --tail 200 portal
docker restart portal
docker exec portal node -e "fetch('http://127.0.0.1:8090/api/health').then(r=>r.text()).then(console.log)"

# 备份（在线、一致）
sqlite3 /opt/portal/data/portal.db ".backup '/var/backups/portal-$(date +%F).db'"

# nginx
sudo nginx -t && sudo systemctl reload nginx
sudo tail -f /var/log/nginx/access.log | grep -E 'payment|api'

# 3x-ui token 重新生成
x-ui setting -getApiToken true -tokenScope admin
```

## 12. 一键安装与升级（懒人模式）

不想按 §4/§5 手动操作时，用仓库自带脚本（Linux；自动安装 Node 24、建用户/目录/配置/systemd 并启动）：

```bash
# 安装：与 3x-ui 同机时零配置（自动识别端口/basePath 并创建专用 Token「portal」）
sudo bash portal/scripts/install.sh

# 跟随模式：每 6 小时自检 3x-ui 的版本/端口/basePath/Token 变化并自动同步
sudo bash portal/scripts/install.sh --watch

# 3x-ui 在另一台机器 / 在 Docker 里：手动指定
sudo bash portal/scripts/install.sh --xui-url http://10.0.0.5:2053 --xui-token '你的Token'

# 升级：保留 /opt/portal/data 与 /etc/portal/portal.env
sudo bash portal/scripts/install.sh --upgrade

# Docker 部署 / 升级（数据卷 portal-data，自动备份数据库）
sudo bash portal/scripts/install.sh --docker --repo OWNER/REPO
sudo bash portal/scripts/install.sh --docker --upgrade

# 只打印计划，不改系统
sudo bash portal/scripts/install.sh --dry-run
```

跟随自检的行为：`portal-xui-sync.timer` 每 6 小时运行一次，读取本机 3x-ui 的端口、basePath 和版本；有变化就更新 `/etc/portal/portal.env` 并重启门户；若门户访问 3x-ui 返回 401/403，会重建名为 `portal` 的 API Token 并更新配置。想立即执行一次：`sudo systemctl start portal-xui-sync.service`；查看结果：`journalctl -u portal-xui-sync.service`。

也可以用 `portal/docker-compose.yml`：

```bash
cd portal && cp .env.example .env && docker compose up -d --build
```

GitHub 发布（得到 Release 的 `portal.tar.gz` 与 `ghcr.io/<owner>/<repo>-portal` 镜像，供上面的一键命令/`docker run` 使用）：
推送 tag `portal-v1.0.0`，或手动运行 `portal-release` workflow（见 `.github/workflows/portal-release.yml`）。

安装脚本参数与行为：`portal/scripts/install.sh --help`；安装位置、端口、管理员账号均可通过参数覆盖。

## 13. 版本更新（后台一键更新 / 检查更新）

systemd 安装或执行 `--upgrade` 时，安装脚本会追加 `portal-update.timer`（每 30 秒处理一次更新请求）和 root 执行器 `/usr/local/lib/portal/update-runner.mjs`。管理员可在 **管理 → 系统设置 → 版本更新**：

- **检查更新**：读取 GitHub 最新 `portal-v*` Release，与当前 `VERSION` 比较；
- **立即更新**：下载 `portal.tar.gz`（发布包附带 `.sha256` 时校验），调用 `install.sh --upgrade` 自动替换程序文件、备份数据库并重启门户。

更新源配置（systemd 一键安装时自动写入）：

```dotenv
PORTAL_UPDATE_REPO=OWNER/REPO
PORTAL_UPDATE_MIRROR=https://ghproxy.net/   # 可选：服务器访问 GitHub 困难时
```

命令行只检查不安装：

```bash
sudo bash /opt/portal/scripts/install.sh --check-update --repo OWNER/REPO
```

> 后台一键更新仅支持 systemd 部署：门户进程以 `portal` 用户运行且代码目录只读，更新由 root 的 timer 执行，不需要给 Web 进程 root 权限。Docker 部署请 `docker pull` 新镜像后重启容器；数据库和 `/etc/portal/portal.env` 在升级时始终保留。
