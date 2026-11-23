#!/usr/bin/env bash
# scripts/guard_expose.sh — 启动安全守卫：对外可达但未启用鉴权时拒绝启动。
#
# 背景：这套控制台把 tsm-hub 管理口令留在服务端，/?role= 只是流程门禁不是身份认证。
# 一旦对外可达又没配 HTPASSWD_FILE，任何人都能匿名读写管理端点（含明文 Key）。
# 容器内 LUME_BIND=0.0.0.0 是端口映射必需，不能据此判断；真正的对外边界有两处：
#   1. 本机 make run/dev：LUME_BIND 是否为回环地址
#   2. docker compose：ports 映射的宿主侧是否为回环地址（127.0.0.1 / ::1）
# 两种模式都检查 HTPASSWD_FILE（空 = 无鉴权）。命中即 exit 1 阻断启动。
#
# 用法：
#   bash scripts/guard_expose.sh local   # 检查 make run/dev（读 LUME_BIND 环境变量）
#   bash scripts/guard_expose.sh docker  # 检查 docker-compose.yml 的端口映射 + .env
# 环境变量 EXPOSE_GUARD=off 可显式关闭（不推荐，仅供受控内网/反代后使用）。

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

MODE="${1:-local}"

if [ "${EXPOSE_GUARD:-}" = "off" ]; then
  echo "⚠️  对外暴露守卫已被 EXPOSE_GUARD=off 显式关闭"
  exit 0
fi

# 回环地址判定：127.0.0.0/8、::1、localhost、空（默认 = 脚本内 127.0.0.1）。
is_loopback() {
  local h="$1"
  [ -z "$h" ] && return 0
  case "$h" in
    127.*|localhost|::1|"[::1]") return 0 ;;
    *) return 1 ;;
  esac
}

# HTPASSWD_FILE 是否启用：空/未设置 = 无鉴权。
has_auth() {
  local v="${HTPASSWD_FILE:-}"
  [ -n "$v" ]
}

# 从 .env 读单个键（不整份加载，避免误执行/泄露），仅取非密键。
env_get() {
  local key="$1"
  [ -f .env ] || return 0
  awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/, ""); print; exit}' .env
}

deny() {
  echo "⛔ 启动被安全守卫拦截：$1" >&2
  echo "   当前配置对外可达但未启用 Basic Auth，任何人都能匿名读写管理端点。" >&2
  echo "   处理方式（二选一）：" >&2
  echo "     1) 收回到本机：本模式把监听/端口映射改回 127.0.0.1" >&2
  echo "     2) 启用鉴权：make auth 生成账号，再在 .env 设 HTPASSWD_FILE=<路径>" >&2
  echo "   如确需无鉴权对外（如受控内网 + 外部反代鉴权），设 EXPOSE_GUARD=off 显式豁免。" >&2
  exit 1
}

if [ "$MODE" = "local" ]; then
  bind="${LUME_BIND:-$(env_get LUME_BIND)}"
  if ! is_loopback "$bind" && ! has_auth; then
    deny "LUME_BIND=${bind}（非回环）且未设 HTPASSWD_FILE"
  fi
  echo "✓ 启动守卫：本机模式（LUME_BIND=${bind:-127.0.0.1}）通过"

elif [ "$MODE" = "docker" ]; then
  # compose 端口映射宿主侧：匹配 "<host>:<container>" 形态，跳过纯容器端口与注释。
  exposed=$(awk '
    /^[[:space:]]*-[[:space:]]*"/ {
      line=$0
      sub(/^[[:space:]]*-[[:space:]]*"/, "", line)
      sub(/".*$/, "", line)
      n=split(line, a, ":")
      if (n>=2) print a[1]   # 宿主侧地址
    }
  ' docker-compose.yml | grep -v '^$' | sort -u)

  public=""
  for h in $exposed; do
    if ! is_loopback "$h"; then public="$public $h"; fi
  done

  hp="${HTPASSWD_FILE:-$(env_get HTPASSWD_FILE)}"
  if [ -n "$public" ] && [ -z "$hp" ]; then
    deny "docker-compose.yml 端口映射到宿主地址${public}（对外可达）且未设 HTPASSWD_FILE"
  fi
  echo "✓ 启动守卫：docker 模式（宿主映射 ${exposed:-未显式绑定}）通过"

else
  echo "用法: $0 {local|docker}" >&2
  exit 2
fi
