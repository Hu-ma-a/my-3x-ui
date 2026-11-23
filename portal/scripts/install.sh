#!/usr/bin/env bash
# ============================================================
# 3x-ui 独立用户门户 · 一键安装 / 升级脚本
#
# 推荐用法（GitHub 已发布时可以一行装完，本地会零配置自动识别 3x-ui）：
#   curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/portal/scripts/install.sh \
#     | sudo bash -s -- --repo OWNER/REPO
#
# 已经拿到代码时（在仓库根目录执行；与 3x-ui 同机可零配置）：
#   sudo bash portal/scripts/install.sh
#   sudo bash portal/scripts/install.sh --watch   # 让门户跟着 3x-ui 升级自动同步配置
#
# 其他：--docker 用容器部署；--dry-run 只打印计划；--help 查看全部参数。
# ============================================================
set -euo pipefail

PORTAL_USER="${PORTAL_USER:-portal}"
PORTAL_DIR="${PORTAL_DIR:-/opt/portal}"
PORTAL_ENV_DIR="${PORTAL_ENV_DIR:-/etc/portal}"
PORTAL_ENV_FILE="${PORTAL_ENV_FILE:-$PORTAL_ENV_DIR/portal.env}"
PORTAL_UNIT="/etc/systemd/system/portal.service"
DEFAULT_PORT="8090"
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=5

MODE="systemd"          # systemd | docker
ACTION="install"        # install | upgrade | uninstall
DRY_RUN=0
FORCE=0
NO_NODE_INSTALL=0
NODE_BIN=""
REPO="${PORTAL_REPO:-}"
REF="${PORTAL_REF:-main}"
GH_MIRROR="${PORTAL_GH_MIRROR:-}"
IMAGE="${PORTAL_IMAGE:-}"
PORT="${PORTAL_PORT:-$DEFAULT_PORT}"
BIND_HOST="${PORTAL_BIND_HOST:-0.0.0.0}"
XUI_URL_ARG="${PORTAL_XUI_URL:-http://127.0.0.1:2053}"
XUI_TOKEN_ARG="${PORTAL_XUI_TOKEN:-}"
XUI_USER_ARG="${PORTAL_XUI_USERNAME:-}"
XUI_PASS_ARG="${PORTAL_XUI_PASSWORD:-}"
XUI_BASE_PATH_ARG="${PORTAL_XUI_BASE_PATH:-/}"
ADMIN_USER_ARG="${PORTAL_ADMIN_USERNAME:-admin}"
ADMIN_PASS_ARG="${PORTAL_ADMIN_PASSWORD:-}"
PUBLIC_URL_ARG="${PORTAL_PUBLIC_URL:-}"
AUTO_DETECT=1
WATCH=0
INSECURE_TLS=0
XUI_URL_SET=0
XUI_TOKEN_SET=0
XUI_BASE_SET=0

SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -e "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd || true)"
fi
LOCAL_PORTAL_DIR=""
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../server.js" ]; then
  LOCAL_PORTAL_DIR="$(cd "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"
fi

GENERATED_ADMIN_PASSWORD=0
EXISTING_DB=0
STAGING_DIR=""

blue() { printf '\033[1;34m[portal]\033[0m %s\n' "$*"; }
yellow() { printf '\033[1;33m[portal]\033[0m %s\n' "$*" >&2; }
red() { printf '\033[1;31m[portal]\033[0m %s\n' "$*" >&2; }
die() { red "$*"; exit 1; }

cleanup() {
  if [ -n "$STAGING_DIR" ] && [ -d "$STAGING_DIR" ]; then rm -rf "$STAGING_DIR"; fi
}
trap cleanup EXIT

usage() {
  cat <<'TXT'
3x-ui 用户门户一键安装 / 升级脚本

用法：sudo bash install.sh [选项]   或   curl -fsSL <raw-url> | sudo bash -s -- [选项]

安装与升级
  --repo OWNER/REPO     源码 GitHub 仓库（curl 方式必填；本地目录执行可省略）
  --ref REF             源码分支或标签，默认 main
  --gh-mirror URL       服务器访问 GitHub 困难时使用镜像前缀，例如 https://ghproxy.net/
                        （脚本下载 Release / 源码时会拼成 URL: https://ghproxy.net/https://github.com/...）
  --upgrade             升级：保留 data/ 与 /etc/portal/portal.env，只替换程序文件
  --uninstall           停止并移除服务（保留数据目录，打印路径）

部署形态
  --docker              用 Docker 部署（默认 systemd）
  --image IMAGE         Docker 镜像（默认 ghcr.io/REPO-portal:latest；本地构建则留空）
  --dir PATH            程序目录，默认 /opt/portal
  --port PORT           门户端口，默认 8090
  --bind-host HOST      监听地址，默认 0.0.0.0（仅本机反代可用 127.0.0.1）

初始化配置
  --auto / --no-auto    自动识别本机 3x-ui 的端口 / basePath 并创建专用 API Token（默认开启）
  --watch               安装 6 小时定时自检：3x-ui 升级 / 改端口后自动同步门户配置
  --xui-url URL         3x-ui 面板地址，默认 http://127.0.0.1:2053
  --xui-token TOKEN     3x-ui admin scope API Token（新版面板「设置 → 安全设定 → API 令牌」）
  --xui-user USER       面板账号（旧版 3x-ui 没有 Token 功能时改用账号密码，需关闭 2FA）
  --xui-pass PASS       面板密码（配合 --xui-user）
  --xui-base-path PATH  面板 webBasePath，默认 /
  --admin-user NAME     首个管理员用户名，默认 admin
  --admin-pass PASS     首个管理员密码（不填则随机生成并打印一次）
  --public-url URL      门户对外地址（用于支付回调，可留空）

其他
  --no-node-install     不自动安装 Node.js（默认在 apt/dnf/yum/apk 上自动装 Node 24）
  --node-bin PATH       指定 systemd 使用的 node 绝对路径
  --dry-run             只打印计划，不修改系统
  -h, --help            显示本帮助

示例
  sudo bash install.sh --repo me/3x-ui --xui-token 'xxxx'
  sudo bash install.sh --upgrade --repo me/3x-ui
  sudo bash install.sh --docker --repo me/3x-ui --xui-token 'xxxx'
TXT
}

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:-}"; shift 2 ;;
    --ref) REF="${2:-}"; shift 2 ;;
    --gh-mirror) GH_MIRROR="${2:-}"; shift 2 ;;
    --image) IMAGE="${2:-}"; shift 2 ;;
    --dir) PORTAL_DIR="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --bind-host) BIND_HOST="${2:-}"; shift 2 ;;
    --xui-url) XUI_URL_ARG="${2:-}"; XUI_URL_SET=1; shift 2 ;;
    --xui-token) XUI_TOKEN_ARG="${2:-}"; XUI_TOKEN_SET=1; shift 2 ;;
    --xui-user) XUI_USER_ARG="${2:-}"; shift 2 ;;
    --xui-pass) XUI_PASS_ARG="${2:-}"; shift 2 ;;
    --xui-base-path) XUI_BASE_PATH_ARG="${2:-}"; XUI_BASE_SET=1; shift 2 ;;
    --admin-user) ADMIN_USER_ARG="${2:-}"; shift 2 ;;
    --admin-pass) ADMIN_PASS_ARG="${2:-}"; shift 2 ;;
    --public-url) PUBLIC_URL_ARG="${2:-}"; shift 2 ;;
    --auto) AUTO_DETECT=1; shift ;;
    --no-auto) AUTO_DETECT=0; shift ;;
    --watch) WATCH=1; shift ;;
    --upgrade) ACTION="upgrade"; shift ;;
    --uninstall) ACTION="uninstall"; shift ;;
    --docker) MODE="docker"; shift ;;
    --no-node-install) NO_NODE_INSTALL=1; shift ;;
    --node-bin) NODE_BIN="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（用 --help 查看用法）" ;;
  esac
done

[ -n "$PORTAL_DIR" ] || die "--dir 不能为空"
[ -n "$PORT" ] || die "--port 不能为空"

require_root() {
  if [ "$DRY_RUN" = 1 ]; then return 0; fi
  if [ "$(id -u)" != 0 ]; then
    die "需要 root 权限：请用 sudo bash $0 ...（或加 --dry-run 查看计划）"
  fi
  if [ "$MODE" != "docker" ] && ! command -v systemctl >/dev/null 2>&1; then
    die "未检测到 systemd。请改用 Docker 部署（加 --docker），或在支持 systemd 的系统上安装。"
  fi
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v major minor rest
  v="$(node -p 'process.versions.node' 2>/dev/null || true)"
  [ -n "$v" ] || return 1
  major="${v%%.*}"
  rest="${v#*.}"
  minor="${rest%%.*}"
  [ "$major" -gt "$NODE_MIN_MAJOR" ] && return 0
  [ "$major" -eq "$NODE_MIN_MAJOR" ] && [ "$minor" -ge "$NODE_MIN_MINOR" ] && return 0
  return 1
}

install_node() {
  local pm=""
  if command -v apt-get >/dev/null 2>&1; then pm="apt"
  elif command -v dnf >/dev/null 2>&1; then pm="dnf"
  elif command -v yum >/dev/null 2>&1; then pm="yum"
  elif command -v apk >/dev/null 2>&1; then pm="apk"
  fi
  if [ -z "$pm" ]; then
    die "未识别的包管理器，无法自动安装 Node.js >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}。请手动安装（推荐 Node 24）后重试，或加 --no-node-install 跳过。"
  fi
  blue "正在安装 Node.js 24（$pm）…"
  case "$pm" in
    apt)
      apt-get update -y
      apt-get install -y curl ca-certificates
      curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
      apt-get install -y nodejs
      ;;
    dnf|yum)
      "$pm" install -y curl
      curl -fsSL https://rpm.nodesource.com/setup_24.x | bash -
      "$pm" install -y nodejs
      ;;
    apk)
      apk add --no-cache nodejs
      ;;
  esac
  if ! node_ok; then
    yellow "包管理器安装的 Node 不满足版本要求，尝试官方二进制兜底…"
  fi
}

install_node_binary_fallback() {
  node_ok && return 0
  local arch
  arch="$(uname -m 2>/dev/null || true)"
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *)
      yellow "未知架构 ${arch:-?}，无法自动安装 Node，请手动安装 Node 24。"
      return 0
      ;;
  esac
  command -v curl >/dev/null 2>&1 || { yellow "缺少 curl，无法下载 Node 官方二进制。"; return 0; }
  local version
  version="$(curl -fsSL https://nodejs.org/dist/index.json 2>/dev/null | grep -o '"version":"v24\.[0-9.]*"' | head -n1 | cut -d'"' -f4)"
  [ -n "$version" ] || { yellow "无法解析 Node 24 版本号，请手动安装。"; return 0; }
  blue "下载 Node ${version} 官方二进制（linux-${arch}）…"
  local tmp
  tmp="$(mktemp -d)"
  if curl -fsSL -o "$tmp/node.tar.xz" "https://nodejs.org/dist/${version}/node-${version}-linux-${arch}.tar.xz"; then
    tar -xJf "$tmp/node.tar.xz" -C "$tmp" >/dev/null 2>&1 || true
    if [ -d "$tmp/node-${version}-linux-${arch}/bin" ]; then
      install -d /usr/local/lib/nodejs
      rm -rf "/usr/local/lib/nodejs/node-${version}-linux-${arch}"
      mv "$tmp/node-${version}-linux-${arch}" /usr/local/lib/nodejs/
      ln -sf "/usr/local/lib/nodejs/node-${version}-linux-${arch}/bin/node" /usr/local/bin/node
      ln -sf "/usr/local/lib/nodejs/node-${version}-linux-${arch}/bin/npm" /usr/local/bin/npm 2>/dev/null || true
      ln -sf "/usr/local/lib/nodejs/node-${version}-linux-${arch}/bin/npx" /usr/local/bin/npx 2>/dev/null || true
      hash -r 2>/dev/null || true
    fi
  fi
  rm -rf "$tmp"
  node_ok || yellow "Node 自动安装未成功，请手动安装 Node 24（https://nodejs.org/）后重试。"
}

resolve_node_bin() {
  if [ -n "$NODE_BIN" ]; then
    [ -x "$NODE_BIN" ] || die "--node-bin 指向的文件不可执行：$NODE_BIN"
    return 0
  fi
  NODE_BIN="$(command -v node 2>/dev/null || true)"
  [ -n "$NODE_BIN" ] || die "未找到 node，请先安装 Node.js >= 22.5"
  local real
  real="$(readlink -f "$NODE_BIN" 2>/dev/null || printf '%s' "$NODE_BIN")"
  case "$real" in
    /root/*|/home/*)
      die "node 位于 $real，systemd 服务（ProtectHome=yes）无法访问。请用 NodeSource 安装到 /usr/bin/node，或显式传 --node-bin /usr/bin/node。"
      ;;
  esac
  NODE_BIN="$real"
}

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

gen_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 9
  else
    head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

ensure_user_and_dirs() {
  if ! id -u "$PORTAL_USER" >/dev/null 2>&1; then
    blue "创建系统用户：$PORTAL_USER"
    useradd --system --home "$PORTAL_DIR" --shell /usr/sbin/nologin "$PORTAL_USER" >/dev/null 2>&1 || \
      adduser -S -H -h "$PORTAL_DIR" -s /sbin/nologin "$PORTAL_USER"
  fi
  mkdir -p "$PORTAL_DIR" "$PORTAL_ENV_DIR" "$PORTAL_DIR/data"
  local grp
  grp="$(id -gn "$PORTAL_USER" 2>/dev/null || printf '%s' "$PORTAL_USER")"
  chown -R "$PORTAL_USER:$grp" "$PORTAL_DIR"
  chmod 700 "$PORTAL_DIR/data"
}

update_env_key() {
  local key="$1" value="$2" file="$3" escaped
  escaped="$(printf '%s' "$value" | sed -e 's/[\/&|]/\\&/g')"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

write_env_systemd() {
  local fresh=1
  if [ -f "$PORTAL_ENV_FILE" ]; then
    fresh=0
    chmod 600 "$PORTAL_ENV_FILE" || true
    if [ "$ACTION" = "upgrade" ]; then
      blue "保留现有配置：$PORTAL_ENV_FILE"
      [ -n "$XUI_URL_ARG" ] && update_env_key "XUI_URL" "$XUI_URL_ARG" "$PORTAL_ENV_FILE"
      [ -n "$XUI_TOKEN_ARG" ] && update_env_key "XUI_API_TOKEN" "$XUI_TOKEN_ARG" "$PORTAL_ENV_FILE"
      [ -n "$PUBLIC_URL_ARG" ] && update_env_key "PORTAL_PUBLIC_URL" "$PUBLIC_URL_ARG" "$PORTAL_ENV_FILE"
      return 0
    fi
    if [ "$FORCE" != 1 ]; then
      yellow "检测到已有配置文件 $PORTAL_ENV_FILE，保留不动（如需重建请加 --force）"
      return 0
    fi
  fi
  [ "$fresh" = 1 ] || blue "重建配置文件：$PORTAL_ENV_FILE"

  local secret pass
  secret="$(gen_secret)"
  if [ -n "$ADMIN_PASS_ARG" ]; then
    pass="$ADMIN_PASS_ARG"
  else
    pass="$(gen_password)"
    GENERATED_ADMIN_PASSWORD=1
  fi
  local tmp
  tmp="$(mktemp)"
  cat >"$tmp" <<EOF
# 3x-ui 用户门户配置（由 install.sh 生成，权限 600）
PORTAL_HOST=${BIND_HOST}
PORTAL_PORT=${PORT}
PORTAL_SECRET=${secret}
PORTAL_DATA_DIR=${PORTAL_DIR}/data
PORTAL_DB_PATH=${PORTAL_DIR}/data/portal.db
PORTAL_ADMIN_USERNAME=${ADMIN_USER_ARG}
PORTAL_ADMIN_PASSWORD=${pass}
PORTAL_PUBLIC_URL=${PUBLIC_URL_ARG}
PORTAL_TRUST_PROXY=false
PORTAL_LOG_LEVEL=info
PORTAL_DEPLOY_MODE=systemd

XUI_URL=${XUI_URL_ARG}
XUI_BASE_PATH=${XUI_BASE_PATH_ARG}
XUI_API_TOKEN=${XUI_TOKEN_ARG}
XUI_USERNAME=${XUI_USER_ARG}
XUI_PASSWORD=${XUI_PASS_ARG}
XUI_TIMEOUT_MS=15000

PAY_PROVIDERS=mock,manual,epay
PAY_MOCK_AUTO_COMPLETE=false
EOF
  install -m 600 "$tmp" "$PORTAL_ENV_FILE"
  rm -f "$tmp"
}

write_env_docker() {
  local fresh=1
  if [ -f "$PORTAL_ENV_FILE" ]; then
    fresh=0
    chmod 600 "$PORTAL_ENV_FILE" || true
    if [ "$ACTION" = "upgrade" ]; then
      blue "保留现有配置：$PORTAL_ENV_FILE"
      [ -n "$XUI_URL_ARG" ] && update_env_key "XUI_URL" "$XUI_URL_ARG" "$PORTAL_ENV_FILE"
      [ -n "$XUI_TOKEN_ARG" ] && update_env_key "XUI_API_TOKEN" "$XUI_TOKEN_ARG" "$PORTAL_ENV_FILE"
      [ -n "$PUBLIC_URL_ARG" ] && update_env_key "PORTAL_PUBLIC_URL" "$PUBLIC_URL_ARG" "$PORTAL_ENV_FILE"
      # Docker 的数据路径与监听地址必须固定为容器内取值
      update_env_key "PORTAL_HOST" "0.0.0.0" "$PORTAL_ENV_FILE"
      update_env_key "PORTAL_DATA_DIR" "/data" "$PORTAL_ENV_FILE"
      update_env_key "PORTAL_DB_PATH" "/data/portal.db" "$PORTAL_ENV_FILE"
      return 0
    fi
    if [ "$FORCE" != 1 ]; then
      yellow "检测到已有配置文件 $PORTAL_ENV_FILE，保留不动（如需重建请加 --force）"
      return 0
    fi
  fi
  local secret pass tmp
  secret="$(gen_secret)"
  if [ -n "$ADMIN_PASS_ARG" ]; then
    pass="$ADMIN_PASS_ARG"
  else
    pass="$(gen_password)"
    GENERATED_ADMIN_PASSWORD=1
  fi
  tmp="$(mktemp)"
  cat >"$tmp" <<EOF
# 3x-ui 用户门户配置（Docker，由 install.sh 生成）
PORTAL_HOST=0.0.0.0
PORTAL_PORT=8090
PORTAL_DATA_DIR=/data
PORTAL_DB_PATH=/data/portal.db
PORTAL_SECRET=${secret}
PORTAL_ADMIN_USERNAME=${ADMIN_USER_ARG}
PORTAL_ADMIN_PASSWORD=${pass}
PORTAL_PUBLIC_URL=${PUBLIC_URL_ARG}
PORTAL_TRUST_PROXY=false
PORTAL_DEPLOY_MODE=docker

XUI_URL=${XUI_URL_ARG}
XUI_BASE_PATH=${XUI_BASE_PATH_ARG}
XUI_API_TOKEN=${XUI_TOKEN_ARG}
XUI_USERNAME=${XUI_USER_ARG}
XUI_PASSWORD=${XUI_PASS_ARG}
XUI_TIMEOUT_MS=15000

PAY_PROVIDERS=mock,manual,epay
PAY_MOCK_AUTO_COMPLETE=false
EOF
  install -m 600 "$tmp" "$PORTAL_ENV_FILE"
  rm -f "$tmp"
}

fetch_source() {
  local dest="$1"
  mkdir -p "$dest"
  if [ -n "$LOCAL_PORTAL_DIR" ]; then
    blue "使用本地代码目录：$LOCAL_PORTAL_DIR"
    ( cd "$LOCAL_PORTAL_DIR" && tar -cf - \
        --exclude='./data' --exclude='./test' \
        --exclude='./node_modules' --exclude='./.env' --exclude='./.git' . ) \
      | ( cd "$dest" && tar -xf - )
  else
    [ -n "$REPO" ] || die "无法确定源码来源：请加 --repo OWNER/REPO 指定 GitHub 仓库，或在代码目录内直接运行本脚本。"
    blue "从 GitHub 下载源码：$REPO（$REF）"
    local tmp_tgz="${dest}.download.tgz"
    local mirror=""
    if [ -n "$GH_MIRROR" ]; then
      mirror="${GH_MIRROR%/}"
      blue "使用 GitHub 镜像前缀：$mirror"
    fi
    local release_url="${mirror:+$mirror/}https://github.com/${REPO}/releases/latest/download/portal.tar.gz"
    local branch_url="${mirror:+$mirror/}https://codeload.github.com/${REPO}/tar.gz/refs/heads/${REF}"
    local tag_url="${mirror:+$mirror/}https://codeload.github.com/${REPO}/tar.gz/refs/tags/${REF}"
    if curl -fsSL -o "$tmp_tgz" "$release_url" 2>/dev/null; then
      tar -xzf "$tmp_tgz" -C "$dest"
    else
      if ! curl -fsSL -o "$tmp_tgz" "$branch_url"; then
        curl -fsSL -o "$tmp_tgz" "$tag_url" || \
          die "下载源码失败：请确认仓库 $REPO 存在、分支/标签 $REF 正确；若服务器访问 GitHub 困难，可加 --gh-mirror https://ghproxy.net/"
      fi
      local extract_dir="${dest}.src"
      rm -rf "$extract_dir"
      mkdir -p "$extract_dir"
      tar -xzf "$tmp_tgz" -C "$extract_dir" --strip-components=1
      [ -d "$extract_dir/portal" ] || die "下载的源码里没有 portal/ 目录，请确认仓库结构（portal/ 位于仓库根目录）"
      ( cd "$extract_dir/portal" && tar -cf - . ) | ( cd "$dest" && tar -xf - )
      rm -rf "$extract_dir"
    fi
    rm -f "$tmp_tgz"
    if [ -d "$dest/portal" ] && [ ! -f "$dest/server.js" ]; then
      ( cd "$dest/portal" && tar -cf - . ) | ( cd "$dest" && tar -xf - )
      rm -rf "$dest/portal"
    fi
    [ -f "$dest/server.js" ] || die "源码准备失败：缺少 server.js"
  fi
}

health_ok() {
  local port="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 2 "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1
  else
    node -e "fetch('http://127.0.0.1:${port}/api/health').then(function(r){process.exit(r.ok?0:1)}).catch(function(){process.exit(1)})" >/dev/null 2>&1
  fi
}

wait_health() {
  local port="$1" i=0
  while [ "$i" -lt 40 ]; do
    if health_ok "$port"; then return 0; fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

write_unit() {
  local tmp
  tmp="$(mktemp)"
  cat >"$tmp" <<EOF
[Unit]
Description=3x-ui Independent User Portal
Documentation=file:${PORTAL_DIR}/README.md
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=10

[Service]
Type=simple
User=${PORTAL_USER}
Group=${PORTAL_USER}
WorkingDirectory=${PORTAL_DIR}
EnvironmentFile=${PORTAL_ENV_FILE}
Environment=NODE_ENV=production
ExecStart=${NODE_BIN} --no-warnings server.js
Restart=on-failure
RestartSec=5s
KillSignal=SIGTERM
TimeoutStopSec=15
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=${PORTAL_DIR}/data
UMask=0077
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
RestrictNamespaces=yes
LockPersonality=yes
SystemCallArchitectures=native
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
EOF
  install -m 644 "$tmp" "$PORTAL_UNIT"
  rm -f "$tmp"
}

server_ip() {
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{print $1}' | grep -E '^[0-9.]+$' | head -n1
  fi
}

print_summary() {
  local ip scheme host url
  ip="$(server_ip || true)"
  host="$BIND_HOST"
  if [ "$host" = "0.0.0.0" ] || [ "$host" = "::" ]; then host="${ip:-127.0.0.1}"; fi
  url="http://${host}:${PORT}"
  echo
  echo "============================================================"
  echo " 3x-ui 用户门户安装完成"
  echo " 访问地址:  ${url}"
  if [ "$ACTION" = "upgrade" ]; then
    echo " 管理员:    ${ADMIN_USER_ARG}（沿用现有配置与数据库）"
  elif [ "$EXISTING_DB" = 1 ]; then
    echo " 管理员:    ${ADMIN_USER_ARG}（检测到已有数据库，账号与密码沿用数据库）"
  elif [ "$GENERATED_ADMIN_PASSWORD" = 1 ]; then
    echo " 管理员:    ${ADMIN_USER_ARG}"
    echo " 初始密码:  ${ADMIN_PASS_GENERATED:-（见 ${PORTAL_ENV_FILE}）}"
  else
    echo " 管理员:    ${ADMIN_USER_ARG}"
    echo " 初始密码:  使用你传入的 --admin-pass"
  fi
  echo " 配置文件:  ${PORTAL_ENV_FILE}"
  echo " 数据目录:  ${PORTAL_DIR}/data"
  echo " 3x-ui:    ${XUI_URL_ARG}${XUI_BASE_PATH_ARG}"
  if [ -n "$XUI_TOKEN_ARG" ]; then
    echo " 认证方式:  API Token"
  elif [ -n "$XUI_USER_ARG" ]; then
    echo " 认证方式:  面板账号密码（${XUI_USER_ARG}）"
  else
    echo " 认证方式:  未配置（登录后到「系统设置 → 3x-ui 连接」填写）"
  fi
  echo " 服务管理:  systemctl status|restart|stop portal"
  echo " 升级命令:  sudo bash $0 --upgrade"
  [ "$WATCH" = 1 ] && echo " 跟随自检:  每 6 小时自动同步（portal-xui-sync.timer，可 systemctl start portal-xui-sync.service 立即同步）"
  echo "------------------------------------------------------------"
  echo " 下一步："
  echo "  1) 打开 ${url} 用管理员登录；"
  echo "  2) 进入「管理后台 → 系统设置」，点「测试连接」；"
  echo "     Token 没填的话，在这里填 3x-ui API Token（admin scope）即可。"
  echo "  3) 生产环境请配置 HTTPS 反向代理（docs/DEPLOY.md §6），"
  echo "     并保留 data/ 与 ${PORTAL_ENV_FILE} 的备份。"
  echo "============================================================"
}

print_docker_summary() {
  local ip host url
  ip="$(server_ip || true)"
  host="$BIND_HOST"
  if [ "$host" = "0.0.0.0" ] || [ "$host" = "::" ]; then host="${ip:-127.0.0.1}"; fi
  url="http://${host}:${PORT}"
  echo
  echo "============================================================"
  echo " 3x-ui 用户门户（Docker）安装完成"
  echo " 访问地址:  ${url}"
  if [ "$ACTION" = "upgrade" ]; then
    echo " 管理员:    ${ADMIN_USER_ARG}（沿用现有配置与数据库）"
  elif [ "$EXISTING_DB" = 1 ]; then
    echo " 管理员:    ${ADMIN_USER_ARG}（检测到已有数据库，账号与密码沿用数据库）"
  elif [ "$GENERATED_ADMIN_PASSWORD" = 1 ]; then
    echo " 管理员:    ${ADMIN_USER_ARG}"
    echo " 初始密码:  ${ADMIN_PASS_GENERATED:-（见 ${PORTAL_ENV_FILE}）}"
  else
    echo " 管理员:    ${ADMIN_USER_ARG}"
    echo " 初始密码:  使用你传入的 --admin-pass"
  fi
  echo " 配置文件:  ${PORTAL_ENV_FILE}"
  echo " 容器名:    portal（数据卷 portal-data）"
  echo " 常用命令:  docker logs -f portal / docker restart portal"
  echo " 升级命令:  sudo $0 --docker --upgrade"
  echo "============================================================"
}

find_xui_bin() {
  local bin
  bin="$(command -v x-ui 2>/dev/null || true)"
  [ -n "$bin" ] || bin="$(command -v 3x-ui 2>/dev/null || true)"
  if [ -z "$bin" ] && [ -x /usr/local/x-ui/x-ui ]; then bin="/usr/local/x-ui/x-ui"; fi
  if [ -z "$bin" ] && [ -x /usr/bin/x-ui ]; then bin="/usr/bin/x-ui"; fi
  printf '%s' "$bin"
}

xui_reachable() {
  local url="$1" extra="${2:-}" code
  command -v curl >/dev/null 2>&1 || return 1
  code="$(curl $extra -sS -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null || printf '000')"
  [ "$code" != "000" ]
}

detect_xui() {
  if [ "$XUI_URL_SET" = 1 ] && [ "$XUI_BASE_SET" = 1 ]; then
    if [ "$XUI_TOKEN_SET" = 1 ] || { [ -n "$XUI_USER_ARG" ] && [ -n "$XUI_PASS_ARG" ]; }; then return 0; fi
  fi
  local bin show port base scheme probe extra token_out new_token token_hint
  bin="$(find_xui_bin)"
  if [ -z "$bin" ]; then
    yellow "未检测到本机 3x-ui CLI（x-ui / 3x-ui），跳过自动识别；可稍后在门户「系统设置」里填写面板地址与 Token。"
    return 0
  fi
  show="$("$bin" setting -show true 2>/dev/null || true)"
  port="$(printf '%s\n' "$show" | grep -E '^port: ' | tail -n1 | cut -d: -f2- | tr -d '[:space:]')"
  base="$(printf '%s\n' "$show" | grep -E '^webBasePath: ' | tail -n1 | cut -d: -f2- | tr -d '[:space:]')"
  if [ -z "$port" ]; then
    yellow "检测到 3x-ui（$bin）但读取设置失败；请确认面板已初始化，或手动传 --xui-url / --xui-token。"
    return 0
  fi
  case "$base" in /*) ;; *) base="/$base" ;; esac
  case "$base" in */) ;; *) base="$base/" ;; esac
  if printf '%s' "$show" | grep -q 'Panel is secure with SSL'; then scheme="https"; else scheme="http"; fi
  probe="${scheme}://127.0.0.1:${port}${base}panel/api/server/status"
  extra=""
  [ "$scheme" = "https" ] && extra="-k"
  if ! xui_reachable "$probe" "$extra"; then
    if [ "$scheme" = "https" ] && xui_reachable "http://127.0.0.1:${port}${base}panel/api/server/status" ""; then
      scheme="http"
      probe="http://127.0.0.1:${port}${base}panel/api/server/status"
      extra=""
    elif [ "$scheme" = "http" ] && xui_reachable "https://127.0.0.1:${port}${base}panel/api/server/status" "-k"; then
      scheme="https"
      probe="https://127.0.0.1:${port}${base}panel/api/server/status"
      extra="-k"
    fi
  fi
  if ! xui_reachable "$probe" "$extra"; then
    yellow "检测到 3x-ui 配置（端口 ${port}），但本机访问不到面板（未启动或未监听 127.0.0.1）。请先启动面板，或用 --xui-url 指定。"
    return 0
  fi
  if [ "$XUI_URL_SET" = 0 ]; then
    if [ "$MODE" = "docker" ]; then
      XUI_URL_ARG="${scheme}://host.docker.internal:${port}"
    else
      XUI_URL_ARG="${scheme}://127.0.0.1:${port}"
    fi
  fi
  if [ "$XUI_BASE_SET" = 0 ]; then XUI_BASE_PATH_ARG="$base"; fi
  if [ "$scheme" = "https" ]; then INSECURE_TLS=1; fi
  token_hint=""
  if [ "$XUI_TOKEN_SET" = 0 ] && [ -z "$XUI_USER_ARG" ] && [ "$DRY_RUN" = 0 ]; then
    token_out="$("$bin" setting -getApiToken true -tokenName portal -tokenScope admin 2>&1 || true)"
    new_token="$(printf '%s\n' "$token_out" | grep -E '^apiToken: ' | tail -n1 | cut -d: -f2- | tr -d '[:space:]')"
    if [ -n "$new_token" ]; then
      XUI_TOKEN_ARG="$new_token"
      token_hint="；已创建专用 API Token「portal」"
    else
      yellow "当前 3x-ui 未返回 API Token（可能是不含该功能的旧版面板，或面板账号启用了 2FA）。"
      yellow "→ 可以：① 升级 3x-ui 后在「设置 → 安全设定 → API 令牌」新建一个 admin 令牌；"
      yellow "→ 或 ② 用面板账号密码重跑：sudo bash $0 ... --xui-user 用户名 --xui-pass 密码（需关闭该账号的 2FA）"
    fi
  fi
  [ "$XUI_TOKEN_SET" = 0 ] && [ -n "$XUI_USER_ARG" ] && token_hint="；使用面板账号密码连接"
  [ "$XUI_TOKEN_SET" = 0 ] && [ "$DRY_RUN" = 1 ] && token_hint="（dry-run 不创建 Token）"
  blue "自动识别 3x-ui：${scheme}://127.0.0.1:${port}${base}${token_hint}"
  if [ "$INSECURE_TLS" = 1 ]; then
    yellow "面板启用了 HTTPS：门户将使用本地 https 并关闭证书校验（NODE_TLS_REJECT_UNAUTHORIZED=0）；条件允许时建议改用 nginx 反代 + 受信证书。"
  fi
}

apply_tls_env() {
  [ "$INSECURE_TLS" = 1 ] || return 0
  [ -f "$PORTAL_ENV_FILE" ] || return 0
  if grep -q '^NODE_TLS_REJECT_UNAUTHORIZED=' "$PORTAL_ENV_FILE" 2>/dev/null; then
    update_env_key "NODE_TLS_REJECT_UNAUTHORIZED" "0" "$PORTAL_ENV_FILE"
  else
    printf '\n# 面板使用自签 HTTPS 时，仅对门户进程关闭本地证书校验\nNODE_TLS_REJECT_UNAUTHORIZED=0\n' >>"$PORTAL_ENV_FILE"
  fi
}

install_watch_units() {
  local sync_script="${PORTAL_DIR}/scripts/xui-sync.sh"
  if [ ! -f "$sync_script" ]; then
    yellow "未找到 ${sync_script}，跳过 --watch（跟随自检）安装"
    return 0
  fi
  cat >/etc/systemd/system/portal-xui-sync.service <<EOF
[Unit]
Description=3x-ui portal config sync (follow local 3x-ui changes)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash ${sync_script}
EOF
  cat >/etc/systemd/system/portal-xui-sync.timer <<'EOF'
[Unit]
Description=Sync portal config with local 3x-ui every 6 hours

[Timer]
OnBootSec=3min
OnUnitActiveSec=6h
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now portal-xui-sync.timer >/dev/null 2>&1 || {
    yellow "启用跟随自检失败，可手动执行：systemctl start portal-xui-sync.service"
    return 0
  }
  blue "已安装跟随自检：每 6 小时检查 3x-ui 的版本 / 端口 / basePath / Token 变化并自动同步"
}

do_uninstall() {
  require_root
  if [ "$MODE" = "docker" ]; then
    command -v docker >/dev/null 2>&1 || die "未找到 docker"
    if docker ps -a --format '{{.Names}}' | grep -qx 'portal'; then
      blue "移除容器 portal（保留数据卷 portal-data）"
      docker rm -f portal >/dev/null
    fi
    echo "已移除容器。数据卷 portal-data 与 ${PORTAL_ENV_FILE} 保留。"
    exit 0
  fi
  blue "停止并禁用 portal 服务"
  systemctl stop portal 2>/dev/null || true
  systemctl disable portal 2>/dev/null || true
  systemctl disable --now portal-xui-sync.timer 2>/dev/null || true
  rm -f "$PORTAL_UNIT" /etc/systemd/system/portal-xui-sync.timer /etc/systemd/system/portal-xui-sync.service
  systemctl daemon-reload 2>/dev/null || true
  echo "已移除 systemd 服务。程序目录 ${PORTAL_DIR}、数据目录 ${PORTAL_DIR}/data 与 ${PORTAL_ENV_FILE} 保留。"
  exit 0
}

install_systemd() {
  require_root
  if [ "$ACTION" = "install" ] && [ -f "$PORTAL_UNIT" ] && [ "$FORCE" != 1 ]; then
    die "检测到已安装（$PORTAL_UNIT）。升级请加 --upgrade；重装请加 --force。"
  fi
  if [ "$ACTION" = "install" ] && [ -f "$PORTAL_DIR/server.js" ] && [ "$FORCE" != 1 ]; then
    die "检测到程序目录已有文件（$PORTAL_DIR）。升级请加 --upgrade；重装请加 --force。"
  fi

  if [ "$ACTION" = "install" ]; then
    if [ -f "$PORTAL_DIR/data/portal.db" ]; then EXISTING_DB=1; fi
    if ! node_ok; then
      if [ "$NO_NODE_INSTALL" = 1 ]; then
        die "Node.js 版本不满足 >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}，请手动安装 Node 24 后重试。"
      fi
      install_node
      install_node_binary_fallback
    fi
  fi
  if ! node_ok; then
    if [ "$NO_NODE_INSTALL" = 1 ]; then
      die "Node.js 版本不满足 >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}，请手动安装 Node 24 后重试。"
    fi
    install_node
    install_node_binary_fallback
  fi
  resolve_node_bin
  blue "Node: $NODE_BIN ($(node --version))"

  ensure_user_and_dirs

  STAGING_DIR="$(mktemp -d /tmp/portal-install.XXXXXX)"
  fetch_source "$STAGING_DIR"

  if [ "$ACTION" = "upgrade" ]; then
    blue "升级前备份数据库"
    local backup_dir="/var/backups/portal"
    mkdir -p "$backup_dir"
    if [ -f "$PORTAL_DIR/data/portal.db" ]; then
      if command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 "$PORTAL_DIR/data/portal.db" ".backup '${backup_dir}/portal-pre-upgrade-$(date +%Y%m%d%H%M%S).db'" || \
          cp -a "$PORTAL_DIR/data/portal.db" "${backup_dir}/portal-pre-upgrade-$(date +%Y%m%d%H%M%S).db"
      else
        cp -a "$PORTAL_DIR/data/portal.db" "${backup_dir}/portal-pre-upgrade-$(date +%Y%m%d%H%M%S).db"
      fi
      blue "数据库已备份到 ${backup_dir}"
    fi
    systemctl stop portal 2>/dev/null || true
  fi

  blue "部署程序文件到 $PORTAL_DIR（保留 data/ 与 .env）"
  ( cd "$STAGING_DIR" && tar -cf - --exclude='./data' --exclude='./.env' . ) | ( cd "$PORTAL_DIR" && tar -xf - )
  chown -R "$PORTAL_USER:$PORTAL_USER" "$PORTAL_DIR"
  chmod 700 "$PORTAL_DIR/data" || true

  write_env_systemd
  apply_tls_env
  if [ "$GENERATED_ADMIN_PASSWORD" = 1 ]; then
    ADMIN_PASS_GENERATED="$(grep '^PORTAL_ADMIN_PASSWORD=' "$PORTAL_ENV_FILE" | head -n1 | cut -d= -f2-)"
  fi
  write_unit

  blue "启动服务"
  systemctl daemon-reload
  systemctl enable portal >/dev/null 2>&1 || true
  systemctl restart portal
  if wait_health "$PORT"; then
    if [ "$WATCH" = 1 ]; then install_watch_units; fi
    print_summary
  else
    yellow "服务已启动但健康检查未通过，请查看日志：journalctl -u portal -n 80 --no-pager"
    journalctl -u portal -n 40 --no-pager || true
    exit 1
  fi
}

install_docker() {
  require_root
  command -v docker >/dev/null 2>&1 || die "未找到 docker，请先安装 Docker，或去掉 --docker 用 systemd 部署。"
  if docker volume inspect portal-data >/dev/null 2>&1; then EXISTING_DB=1; fi
  ensure_user_and_dirs

  local image="$IMAGE"
  local build_local=0
  if [ -z "$image" ]; then
    if [ -n "$REPO" ] && [ "$ACTION" != "upgrade" ]; then
      image="ghcr.io/$(printf '%s' "$REPO" | tr '[:upper:]' '[:lower:]')-portal:latest"
    elif [ -n "$REPO" ]; then
      image="ghcr.io/$(printf '%s' "$REPO" | tr '[:upper:]' '[:lower:]')-portal:latest"
    else
      image="3x-ui-portal:local"
      build_local=1
    fi
  fi

  STAGING_DIR="$(mktemp -d /tmp/portal-install.XXXXXX)"
  if [ "$build_local" = 1 ]; then
    fetch_source "$STAGING_DIR"
    blue "本地构建镜像：$image"
    docker build -t "$image" "$STAGING_DIR" >/dev/null || die "镜像构建失败"
  else
    blue "拉取镜像：$image"
    docker pull "$image" || die "拉取镜像失败。可改用 --image 指定镜像，或不用 --docker 走源码安装。"
  fi

  write_env_docker
  apply_tls_env
  if [ "$GENERATED_ADMIN_PASSWORD" = 1 ]; then
    ADMIN_PASS_GENERATED="$(grep '^PORTAL_ADMIN_PASSWORD=' "$PORTAL_ENV_FILE" | head -n1 | cut -d= -f2-)"
  fi

  if docker ps -a --format '{{.Names}}' | grep -qx 'portal'; then
    if [ "$ACTION" = "upgrade" ]; then
      local backup_dir="/var/backups/portal"
      mkdir -p "$backup_dir"
      if docker ps --format '{{.Names}}' | grep -qx 'portal'; then
        blue "升级前备份数据卷内数据库到 ${backup_dir}"
        docker run --rm -v portal-data:/data -v "${backup_dir}:/backup" --entrypoint sh "$image" \
          -c "cp -a /data/portal.db /backup/portal-pre-upgrade-$(date +%Y%m%d%H%M%S).db 2>/dev/null || true" || true
      fi
    fi
    blue "移除旧容器 portal（数据卷 portal-data 保留）"
    docker rm -f portal >/dev/null
  fi
  blue "启动容器 portal"
  docker run -d --name portal --restart unless-stopped \
    -p "${BIND_HOST}:${PORT}:8090" \
    -v portal-data:/data \
    --add-host=host.docker.internal:host-gateway \
    --env-file "$PORTAL_ENV_FILE" \
    "$image" >/dev/null || die "容器启动失败，请用 docker logs portal 查看"

  if wait_health "$PORT"; then
    print_docker_summary
  else
    yellow "容器已启动但健康检查未通过，请查看日志：docker logs -f portal"
    docker logs --tail 40 portal || true
    exit 1
  fi
}

if [ "$ACTION" != "uninstall" ] && [ "$AUTO_DETECT" = 1 ]; then
  detect_xui
fi

if [ "$DRY_RUN" = 1 ]; then
  echo "== DRY-RUN：以下操作不会真正执行 =="
  if [ "$MODE" = "docker" ]; then
    echo "方式: Docker 容器（镜像 ${IMAGE:-自动}）"
    echo "配置文件: $PORTAL_ENV_FILE"
    echo "数据卷:   portal-data（保留）"
    echo "端口:     ${BIND_HOST}:${PORT}:8090"
    echo "3x-ui:    ${XUI_URL_ARG}${XUI_BASE_PATH_ARG}（Token $([ -n "$XUI_TOKEN_ARG" ] && echo 已获取 || echo 未配置)）"
    [ -n "$REPO" ] && echo "镜像来源: ghcr.io/$(printf '%s' "$REPO" | tr '[:upper:]' '[:lower:]')-portal:latest（或 --image 指定）"
    [ -z "$REPO" ] && echo "本地代码目录构建: ${LOCAL_PORTAL_DIR:-（未检测到，需 --repo）}"
  else
    echo "方式: systemd 服务"
    echo "程序目录: $PORTAL_DIR"
    echo "配置文件: $PORTAL_ENV_FILE"
    echo "服务单元: $PORTAL_UNIT"
    echo "监听:     ${BIND_HOST}:${PORT}"
    echo "数据目录: $PORTAL_DIR/data"
    echo "3x-ui:    ${XUI_URL_ARG}${XUI_BASE_PATH_ARG}（Token $([ -n "$XUI_TOKEN_ARG" ] && echo 已获取 || echo 未配置)）"
    echo "跟随自检: $([ "$WATCH" = 1 ] && echo 安装（每 6 小时） || echo 未启用（可加 --watch）)"
    echo "源码来源: ${LOCAL_PORTAL_DIR:-GitHub $REPO（$REF）}"
    if node_ok; then echo "Node 检查: 通过 ($(node --version))"; else echo "Node 检查: 不满足，将尝试自动安装 Node 24"; fi
  fi
  echo "== DRY-RUN 结束 =="
  exit 0
fi

case "$ACTION" in
  uninstall) do_uninstall ;;
  install|upgrade)
    if [ "$MODE" = "docker" ]; then install_docker; else install_systemd; fi
    ;;
  *) die "未知操作：$ACTION" ;;
esac
