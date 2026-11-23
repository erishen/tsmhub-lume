#!/usr/bin/env bash
# scripts/vendor_lume.sh —— 把 lume 二进制 + lume-core/lib 固定到仓内 vendor/
#
# 为什么需要 vendor：
#   1) src/guard.lume 通过源码路径 import vendor/lume-core/lib/approval.lume，
#      解释器在运行时按路径读盘 —— 库文件必须真实存在于这个位置；
#   2) 单独 clone 本仓时没有 ../lume 兄弟 checkout，所以优先从它们同步，
#      其次从 GitHub release 拉指定版本。
#
# 布局：
#   vendor/lume/bin/lume          framework 二进制（软链到兄弟 checkout，或 release 包）
#   vendor/lume-core/lib/*.lume   共享 .lume 模块（入库；带版本戳）
#   vendor/.vendor-stamp          记录二进制版本 + 库来源，便于复核
#
# 用法：
#   bash scripts/vendor_lume.sh          同步（本地优先，缺失则 release）
#   bash scripts/vendor_lume.sh --check  只验证是否就绪
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor"
LUME_BIN="$VENDOR/lume/bin/lume"
CORE_LIB="$VENDOR/lume-core/lib"
STAMP="$VENDOR/.vendor-stamp"
ENTRY="$ROOT/tsmhub_lume.lume"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

# release 兜底用的已发布版本（本地兄弟 checkout 优先，版本以 .vendor-stamp 为准）。
# 默认从仓库根目录的 lume.version 读取（与 Makefile / Docker / CI 同一数据源），
# 环境变量仍可显式覆盖以便临时试版本。
if [ -f "$ROOT/lume.version" ]; then
  . "$ROOT/lume.version"
fi
LUME_VERSION="${LUME_VERSION:-v0.14.2}"
LUME_CORE_TAG="${LUME_CORE_TAG:-$LUME_VERSION}"
LUME_REPO="${LUME_REPO:-erishen/lume}"
LUME_CORE_REPO="${LUME_CORE_REPO:-erishen/lume-core}"

# 本地兄弟 checkout：work/golang/tsmhub-lume → work/lume/{lume,lume-core}
LOCAL_LUME="$ROOT/../../lume/lume"
LOCAL_CORE="$ROOT/../../lume/lume-core"

if [ "$CHECK_ONLY" = "1" ]; then
  [ -x "$LUME_BIN" ] || { echo "✗ 缺少 $LUME_BIN（先跑 make vendor）" >&2; exit 1; }
  [ -f "$CORE_LIB/approval.lume" ] || { echo "✗ 缺少 $CORE_LIB/approval.lume（先跑 make vendor）" >&2; exit 1; }
  "$LUME_BIN" --check "$ENTRY" >/dev/null 2>&1 \
    || { echo "✗ $LUME_BIN --check tsmhub_lume.lume 失败（二进制/库版本不匹配？）" >&2; exit 1; }
  echo "✓ vendor 就绪（$(tr '\n' ' ' < "$STAMP" 2>/dev/null)）"
  exit 0
fi

mkdir -p "$(dirname "$LUME_BIN")" "$CORE_LIB"

if [ -x "$LOCAL_LUME/bin/lume" ] && [ -d "$LOCAL_CORE/lib" ]; then
  # 本地开发：软链二进制（macOS 上 cp 会破坏 codesign），复制工作树里的库。
  ln -sfn "$LOCAL_LUME/bin/lume" "$LUME_BIN"
  for f in "$LOCAL_CORE"/lib/*.lume; do
    cp "$f" "$CORE_LIB/"
  done
  libsrc="working-tree"
  if git -C "$LOCAL_CORE" rev-parse --git-dir >/dev/null 2>&1; then
    libsrc="working-tree@$(git -C "$LOCAL_CORE" rev-parse --short HEAD)"
  fi
  {
    echo "source=local-checkout"
    echo "bin=$("$LUME_BIN" --version 2>/dev/null | head -1 || echo unknown)"
    echo "lib=$libsrc"
    echo "lib_files=$(ls "$CORE_LIB" | wc -l | tr -d ' ')"
  } > "$STAMP"
else
  # release 缓存命中：stamp 记录 source=release + 版本一致，且二进制/库都在，则跳过下载。
  # 本地开发走上面的 local-checkout 分支（stamp 不匹配 source=release），行为不变。
  if [ -x "$LUME_BIN" ] && [ -f "$CORE_LIB/approval.lume" ] && [ -f "$STAMP" ] \
     && grep -q "source=release" "$STAMP" && grep -q "bin=${LUME_VERSION}" "$STAMP" \
     && grep -q "lib_tag=${LUME_CORE_TAG}" "$STAMP"; then
    echo "▶ vendor 已就绪（release ${LUME_VERSION} 缓存命中，跳过下载）"
    exit 0
  fi
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) echo "✗ 不支持的系统：$(uname -s)" >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) carch=arm64 ;;
    x86_64 | amd64) carch=x64 ;;
    *) echo "✗ 不支持的架构：$(uname -m)" >&2; exit 1 ;;
  esac
  tmp="$ROOT/.vendor-dl.$$"
  mkdir -p "$tmp"
  trap 'rm -rf "$tmp"' EXIT

  # release 资产命名：linux 有 -static 包，darwin 只有动态链接包。
  asset="lume-${os}-${carch}.tar.gz"
  if [ "$os" = "linux" ]; then asset="lume-${os}-${carch}-static.tar.gz"; fi
  echo "▶ 拉 ${LUME_REPO} ${LUME_VERSION} (${asset})"
  curl -fsSL --retry 3 -o "$tmp/lume.tar.gz" \
    "https://github.com/${LUME_REPO}/releases/download/${LUME_VERSION}/${asset}"
  tar -xzf "$tmp/lume.tar.gz" -C "$tmp"
  src_bin="$(find "$tmp" -name lume -type f | head -1)"
  [ -n "$src_bin" ] || { echo "✗ 包里找不到 lume 二进制" >&2; exit 1; }
  install -m 755 "$src_bin" "$LUME_BIN"

  echo "▶ 拉 ${LUME_CORE_REPO} ${LUME_CORE_TAG} (${os}-${carch})"
  curl -fsSL --retry 3 -o "$tmp/core.tar.gz" \
    "https://github.com/${LUME_CORE_REPO}/releases/download/${LUME_CORE_TAG}/lume-core-${os}-${carch}.tar.gz"
  tar -xzf "$tmp/core.tar.gz" -C "$tmp"
  cp "$tmp"/lume-core-*/lib/*.lume "$CORE_LIB/"

  {
    echo "source=release"
    echo "bin=${LUME_VERSION}(${LUME_REPO})"
    echo "lib_tag=${LUME_CORE_TAG}(${LUME_CORE_REPO})"
    echo "lib_files=$(ls "$CORE_LIB" | wc -l | tr -d ' ')"
  } > "$STAMP"
fi

echo "▶ vendor 已就绪：$(tr '\n' ' ' < "$STAMP")"
