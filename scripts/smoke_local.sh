#!/usr/bin/env bash
# scripts/smoke_local.sh —— 起一个临时 Lume 实例做自包含冒烟，然后自动清理
#
# 不要求上游 tsm-hub 在线：只测 BFF 自身的静态站点、SPA 回退与 /api/* 端点
# （--no-upstream 模式）。端口从 PORT 起自动找空闲。
#
# 用法: bash scripts/smoke_local.sh   （PORT 环境变量可覆盖起始端口，默认 8098）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LUME="$ROOT/vendor/lume/bin/lume"
ENTRY="$ROOT/tsmhub_lume.lume"
PORT="${PORT:-8098}"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

[ -x "$LUME" ] || { echo "✗ 缺少 $LUME（先跑 make vendor）" >&2; exit 1; }
[ -f "$ENTRY" ] || { echo "✗ 缺少 $ENTRY" >&2; exit 1; }

# 找空闲端口（避免撞上正在运行的服务）。
while lsof -ti tcp:"$PORT" >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

echo "▶ 起临时实例 127.0.0.1:$PORT …"
LUME_PORT="$PORT" "$LUME" "$ENTRY" >"$LOG" 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null || true; rm -f "$LOG"' EXIT

# 等就绪（最多 ~6s）。
ready=0
for _ in $(seq 1 20); do
  if curl -s --noproxy '*' -o /dev/null --max-time 1 "http://127.0.0.1:$PORT/api/meta" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.3
done
if [ "$ready" != "1" ]; then
  echo "✗ 临时实例未就绪，日志如下：" >&2
  tail -20 "$LOG" >&2 || true
  exit 1
fi

bash "$ROOT/scripts/smoke.sh" "http://127.0.0.1:$PORT" --no-upstream
RC=$?

kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
trap - EXIT
rm -f "$LOG"

if [ "$RC" = "0" ]; then
  echo "✓ 自包含冒烟通过（127.0.0.1:$PORT 已清理）"
else
  echo "✗ 自包含冒烟失败" >&2
fi
exit "$RC"
