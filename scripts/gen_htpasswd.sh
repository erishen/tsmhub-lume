#!/usr/bin/env bash
# scripts/gen_htpasswd.sh — 生成/覆盖 Basic Auth 账号（bcrypt + 服务端角色列）。
#
# 用法：make auth（交互式）。产物写到 .data/htpasswd（已 gitignore，权限 600）。
# 角色写在 htpasswd 行第三列：user:hash:role1,role2 —— 框架把它作为可信
# req.roles 传给 DSL，写操作闸门只认它，前端 ?role= 在认证模式下被忽略。
# 只接受 bcrypt：本机 macOS 的 crypt(3) 验不了 $6$ 哈希，bcrypt 全平台可用。
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=.data/htpasswd
mkdir -p .data

BIN=$(command -v htpasswd 2>/dev/null || true)
if [ -z "$BIN" ] && [ -x /usr/sbin/htpasswd ]; then BIN=/usr/sbin/htpasswd; fi
if [ -z "$BIN" ]; then
  echo '错误：找不到 htpasswd（需支持 -B/bcrypt）。' >&2
  exit 1
fi

read -rp '用户名 [admin]: ' user
user=${user:-admin}
read -rp '角色（逗号分隔，可留空=不授予写权限） [human_admin,agent_operator]: ' roles_raw
roles_raw=${roles_raw:-human_admin,agent_operator}

# 角色白名单与 vendor/lume-core/lib/approval.lume 一致；写错会 fail closed，
# 这里提前拦住，避免生成一个「登录了但什么也做不了」的账号。
roles=''
IFS=',' read -ra parts <<< "$roles_raw"
for r in "${parts[@]}"; do
  r=$(printf '%s' "$r" | tr -d '[:space:]')
  [ -n "$r" ] || continue
  case "$r" in
    agent_operator|agent_reviewer|agent_reviewer_second|human_admin) ;;
    *) echo "错误：未知角色 ${r}（可用：agent_operator / agent_reviewer / agent_reviewer_second / human_admin）" >&2; exit 1 ;;
  esac
  if [ -n "$roles" ]; then roles="$roles,$r"; else roles="$r"; fi
done

read -rsp '密码: ' pass; echo
read -rsp '确认密码: ' pass2; echo
if [ -z "$pass" ] || [ "$pass" != "$pass2" ]; then
  echo '错误：密码为空或两次不一致。' >&2
  exit 1
fi

line=$("$BIN" -bnB "$user" "$pass")
hash=${line#*:}

tmp=$(mktemp)
if [ -f "$OUT" ]; then
  awk -F: -v u="$user" '$1 != u' "$OUT" > "$tmp"   # 同名用户覆盖，不重复
else
  : > "$tmp"
fi
printf '%s:%s:%s\n' "$user" "$hash" "$roles" >> "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$OUT"

echo "✓ 已写入 ${OUT}（用户 ${user}，角色 ${roles:-无}；密码未回显）"
echo '  Docker：在 .env 设 HTPASSWD_FILE=/app/.data/htpasswd 后 docker compose up -d'
echo '  本机：在 .env 设 HTPASSWD_FILE=.data/htpasswd 后 make dev'
