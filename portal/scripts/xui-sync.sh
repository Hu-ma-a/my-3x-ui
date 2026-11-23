#!/usr/bin/env bash
# ============================================================
# 3x-ui 用户门户 · 跟随自检脚本
#
# 由 portal-xui-sync.timer 定时调用（安装时加 --watch 才会创建）：
#   - 读取本机 3x-ui 当前端口 / webBasePath / 版本
#   - 端口或 basePath 变化时更新门户配置并重启门户
#   - 门户访问 3x-ui 返回 401/403 时，重新创建专用 API Token「portal」并更新
#
# 也可手动执行立即同步：
#   sudo systemctl start portal-xui-sync.service
# ============================================================
set -euo pipefail

ENV_FILE="${PORTAL_ENV_FILE:-/etc/portal/portal.env}"
PORTAL_SERVICE="portal.service"
STATE_FILE="/etc/portal/xui-version"
TAG="portal-xui-sync"

log() { printf '[%s] %s\n' "$TAG" "$*"; }
warn() { printf '[%s] %s\n' "$TAG" "$*" >&2; }

[ -f "$ENV_FILE" ] || { warn "未找到 $ENV_FILE，跳过"; exit 0; }

env_get() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true
}

env_set() {
  local key="$1" value="$2" escaped
  escaped="$(printf '%s' "$value" | sed -e 's/[\/&|]/\\&/g')"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

find_bin() {
  local bin
  bin="$(command -v x-ui 2>/dev/null || true)"
  [ -n "$bin" ] || bin="$(command -v 3x-ui 2>/dev/null || true)"
  [ -n "$bin" ] || { [ -x /usr/local/x-ui/x-ui ] && bin="/usr/local/x-ui/x-ui"; }
  [ -n "$bin" ] || { [ -x /usr/bin/x-ui ] && bin="/usr/bin/x-ui"; }
  printf '%s' "${bin:-}"
}

normalize_base() {
  local raw="${1:-/}"
  case "$raw" in
    /*) ;;
    *) raw="/$raw" ;;
  esac
  case "$raw" in
    */) ;;
    *) raw="$raw/" ;;
  esac
  printf '%s' "$raw"
}

http_code() {
  local url="$1" extra="${2:-}"
  if command -v curl >/dev/null 2>&1; then
    curl $extra -sS -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || printf '000'
  else
    printf '000'
  fi
}

BIN="$(find_bin)"
[ -n "$BIN" ] || { warn "未检测到 3x-ui CLI（x-ui / 3x-ui），跳过"; exit 0; }

SHOW="$("$BIN" setting -show true 2>/dev/null || true)"
PORT="$(printf '%s\n' "$SHOW" | grep -E '^port: ' | tail -n1 | cut -d: -f2- | tr -d '[:space:]')"
BASEPATH="$(printf '%s\n' "$SHOW" | grep -E '^webBasePath: ' | tail -n1 | cut -d: -f2- | tr -d '[:space:]')"
[ -n "$PORT" ] || { warn "无法读取 3x-ui 端口，跳过"; exit 0; }
BASEPATH="$(normalize_base "$BASEPATH")"

VERSION="$("$BIN" -v 2>/dev/null | tail -n1 || true)"
if [ -n "$VERSION" ] && [ -f "$STATE_FILE" ]; then
  if [ "$(cat "$STATE_FILE" 2>/dev/null || true)" != "$VERSION" ]; then
    log "检测到 3x-ui 已升级到 ${VERSION}"
  fi
fi
[ -n "$VERSION" ] && printf '%s\n' "$VERSION" >"$STATE_FILE" 2>/dev/null || true

SCHEME="http"
if printf '%s' "$SHOW" | grep -q 'Panel is secure with SSL'; then SCHEME="https"; fi
PROBE_EXTRA=""
[ "$SCHEME" = "https" ] && PROBE_EXTRA="-k"
PROBE_URL="${SCHEME}://127.0.0.1:${PORT}${BASEPATH}panel/api/server/status"
if [ "$(http_code "$PROBE_URL" "$PROBE_EXTRA")" = "000" ] && [ "$SCHEME" = "https" ]; then
  SCHEME="http"
  PROBE_EXTRA=""
  PROBE_URL="http://127.0.0.1:${PORT}${BASEPATH}panel/api/server/status"
fi

CHANGED=0
CUR_URL="$(env_get XUI_URL)"
CUR_BASE="$(env_get XUI_BASE_PATH)"
CUR_TOKEN="$(env_get XUI_API_TOKEN)"
CUR_USER="$(env_get XUI_USERNAME)"
NEW_URL="${SCHEME}://127.0.0.1:${PORT}"

if [ "$CUR_URL" != "$NEW_URL" ]; then
  log "面板地址变化：${CUR_URL:-<空>} -> ${NEW_URL}"
  env_set XUI_URL "$NEW_URL"
  CHANGED=1
fi
if [ "$CUR_BASE" != "$BASEPATH" ]; then
  log "面板 basePath 变化：${CUR_BASE:-<空>} -> ${BASEPATH}"
  env_set XUI_BASE_PATH "$BASEPATH"
  CHANGED=1
fi
if [ "$SCHEME" = "https" ] && [ -z "$(env_get NODE_TLS_REJECT_UNAUTHORIZED)" ]; then
  log "面板启用 HTTPS，门户将关闭本地证书校验（NODE_TLS_REJECT_UNAUTHORIZED=0）"
  env_set NODE_TLS_REJECT_UNAUTHORIZED "0"
  CHANGED=1
fi

# 安装时 Token 没建成（或被人为清空），且没有使用账号密码模式：补建一个专用 Token
if [ -z "$CUR_TOKEN" ] && [ -z "$CUR_USER" ]; then
  TOKEN_OUT="$("$BIN" setting -getApiToken true -tokenName portal -tokenScope admin 2>&1 || true)"
  NEW_TOKEN="$(printf '%s\n' "$TOKEN_OUT" | grep -E '^apiToken: ' | tail -n1 | cut -d: -f2- | tr -d '[:space:]')"
  if [ -n "$NEW_TOKEN" ]; then
    log "门户缺少 API Token，已创建专用 Token「portal」并写入配置"
    env_set XUI_API_TOKEN "$NEW_TOKEN"
    CUR_TOKEN="$NEW_TOKEN"
    CHANGED=1
  else
    warn "自动补建 API Token 失败，请到门户「管理后台 → 系统设置」手动填写。"
  fi
fi

if [ "$CHANGED" = 0 ] && [ -n "$CUR_TOKEN" ]; then
  TOKEN_EXTRA=""
  [ "$SCHEME" = "https" ] && TOKEN_EXTRA="-k"
  CODE="$(curl ${TOKEN_EXTRA:-} -sS -o /dev/null -w '%{http_code}' --max-time 5 \
    -H "Authorization: Bearer ${CUR_TOKEN}" "${PROBE_URL}" 2>/dev/null || printf '000')"
  if [ "$CODE" = "401" ] || [ "$CODE" = "403" ]; then
    log "门户 API Token 失效（HTTP ${CODE}），重建专用 Token「portal」"
    TOKEN_OUT="$("$BIN" setting -getApiToken true -tokenName portal -tokenScope admin 2>&1 || true)"
    NEW_TOKEN="$(printf '%s\n' "$TOKEN_OUT" | grep -E '^apiToken: ' | tail -n1 | cut -d: -f2- | tr -d '[:space:]')"
    if [ -n "$NEW_TOKEN" ]; then
      env_set XUI_API_TOKEN "$NEW_TOKEN"
      CHANGED=1
    else
      warn "自动重建 Token 失败，请到门户「管理后台 → 系统设置」手动填写。"
    fi
  fi
fi

if [ "$CHANGED" = 1 ]; then
  log "配置已更新，重启门户"
  if [ "$(env_get PORTAL_DEPLOY_MODE)" = "docker" ]; then
    docker restart portal >/dev/null 2>&1 || warn "重启容器失败，请手动 docker restart portal"
  else
    systemctl restart "$PORTAL_SERVICE" || warn "重启 portal 失败，请查看 journalctl -u portal"
  fi
else
  log "3x-ui 配置无变化（${NEW_URL}${BASEPATH}）"
fi
