#!/usr/bin/env bash
# scripts/smoke.sh —— 对运行中的 tsmhub-lume 做一次只读 HTTP 冒烟
#
# 用法:
#   bash scripts/smoke.sh [BASE] [--no-upstream]
#     BASE          默认 http://127.0.0.1:8097
#     --no-upstream 跳过依赖上游 tsm-hub 的端点（自包含冒烟用，不要求上游在线）
#
# 说明: /api/health、/api/meta、/api/overview 是 BFF 自身端点，上游掉线时
# BFF 仍返回 200（body 里 ok:false），所以它们永远测 200；/api/providers 等
# 透传端点依赖上游在线，上游异常时返回 502，因此默认模式把它们也当 200 测，
# --no-upstream 时跳过。
set -uo pipefail

BASE="${1:-http://127.0.0.1:8097}"
NO_UPSTREAM=0
[ "${2:-}" = "--no-upstream" ] && NO_UPSTREAM=1

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
fail=0

check() {
  local path="$1" expect="${2:-200}" code
  code="$(curl -s --noproxy '*' -o "$TMP" -w '%{http_code}' --max-time 8 "$BASE$path" || echo 000)"
  if [ "$code" = "$expect" ]; then
    echo "✓ GET $path → $code"
  else
    echo "✗ GET $path → $code（期望 $expect）" >&2
    head -c 400 "$TMP" >&2 || true
    echo >&2
    fail=1
  fi
}

check /
check /app.css
check /app.js
check /api/health
check /api/meta
check /api/overview

if [ "$NO_UPSTREAM" = "0" ]; then
  # 以下端点依赖上游 tsm-hub 在线且管理口令正确；上游异常时返回 502。
  check /api/providers
  check /api/routes
  check /api/keys
  check /api/usage
fi

exit "$fail"
