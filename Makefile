# tsmhub-lume — Makefile
#
#   make vendor      同步 lume 二进制 + lume-core/lib 到 vendor/
#   make check       lume --check 语法/类型校验
#   make typecheck   tsc 前端类型检查
#   make ui          esbuild 打包 React 控制台（→ www/app.js）
#   make test        静态门禁 = check + typecheck + ui（无需运行环境）
#   make test-local  静态门禁 + 起临时实例做自包含冒烟（不依赖上游）
#   make dev         test + 前台启动（http://127.0.0.1:8097）
#   make run         只启动（假定 ui 已构建）
#   make stop        停掉本端口上的服务
#   make smoke       对运行中的服务做一次只读 HTTP 冒烟
#   make docker      构建镜像并起容器（127.0.0.1:18108）
#
# 上游 tsm-hub 默认 http://127.0.0.1:9070；管理口令用 TSM_ADMIN 环境变量传入
# （不能叫 TOKEN —— Lume 的 env() 会屏蔽那类变量名）。

SHELL := /bin/bash
LUME     ?= vendor/lume/bin/lume
PORT     ?= 8097
TSM_BASE ?= http://127.0.0.1:9070

# lume 版本/SHA 的唯一数据源（lume.version），供 Makefile / shell / CI / Dockerfile 共用。
# 升级 lume：只改 lume.version 两行，删掉 tarball 重跑 make docker。
include lume.version
export LUME_VERSION LUME_SHA256

# docker 构建用的 lume release tarball：宿主侧下载 + SHA256 校验（宿主网络可控、
# 可走代理），Dockerfile 只 COPY + 二次校验 —— 构建期不再访问网络（VM 内 apk
# CDN 与 GitHub 都可能被重置）。
LUME_LINUX_TGZ := vendor/lume/lume-linux-x64-static.tar.gz

$(LUME_LINUX_TGZ):
	@echo "▶ 下载 lume $(LUME_VERSION) linux-x64-static（宿主侧）"
	curl -fsSL --http1.1 --retry 3 --retry-all-errors -C - -o $@ \
	  "https://github.com/erishen/lume/releases/download/$(LUME_VERSION)/lume-linux-x64-static.tar.gz"
	@echo "$(LUME_SHA256)  $@" | \
	  if command -v sha256sum >/dev/null 2>&1; then sha256sum -c -; else shasum -a 256 -c -; fi

.PHONY: vendor auth check typecheck ui node_modules test-fe test test-local run dev stop smoke clean logs-clean docker docker-logs docker-down

vendor:
	@bash scripts/vendor_lume.sh

# 交互式生成 Basic Auth 账号（bcrypt + 角色列）到 .data/htpasswd；
# 启用方式见脚本末尾提示，默认不启用（本机 loopback 用法不变）。
auth:
	@bash scripts/gen_htpasswd.sh

check: vendor
	@$(LUME) --check tsmhub_lume.lume
	@echo "✓ lume 脚本校验通过"

node_modules: package.json
	@npm ci --no-audit --no-fund

typecheck: node_modules
	@npm run typecheck

ui: node_modules
	@./node_modules/.bin/esbuild src/web/main.tsx --bundle --minify --format=esm --jsx=automatic --outfile=www/app.js
	@echo "✓ www/app.js 已构建"

test-fe: node_modules
	@npm run test-fe

# 静态门禁：lume 语法/类型 + tsc + esbuild + 前端单测，全部无外部依赖。
test: check typecheck ui test-fe
	@echo "✓ 静态门禁通过（lume --check + tsc + esbuild + vitest）"

# 静态门禁 + 自包含运行时冒烟（起临时实例，测完自动清理，不要求上游在线）。
test-local: test
	@bash scripts/smoke_local.sh

run: ui
	@bash scripts/guard_expose.sh local
	@echo "▶ http://127.0.0.1:$(PORT)  (上游 $(TSM_BASE))"
	@LUME_PORT=$(PORT) TSM_BASE=$(TSM_BASE) $(LUME) tsmhub_lume.lume

dev: test
	@bash scripts/guard_expose.sh local
	@echo "▶ http://127.0.0.1:$(PORT)  (上游 $(TSM_BASE))"
	@LUME_PORT=$(PORT) TSM_BASE=$(TSM_BASE) $(LUME) tsmhub_lume.lume

stop:
	@pids=$$(lsof -ti tcp:$(PORT) 2>/dev/null || true); \
	if [ -n "$$pids" ]; then kill $$pids && echo "已停 $(PORT)"; else echo "$(PORT) 无监听进程"; fi

smoke:
	@bash scripts/smoke.sh http://127.0.0.1:$(PORT)

# 容器：http://127.0.0.1:18108；上游默认走 host.docker.internal:9070。
docker: $(LUME_LINUX_TGZ)
	@bash scripts/guard_expose.sh docker
	@docker compose up -d --build
	@echo "▶ http://127.0.0.1:18108"

docker-logs:
	@docker compose logs -f --tail=100

docker-down:
	@docker compose down

clean:
	@rm -f www/app.js
	@rm -rf node_modules

# Lume 把访问日志写进 logs/access.log，长期运行会增长（默认安全：0600、
# 不记录 query string 与请求体）。手动截断即可，无需引入 logrotate。
logs-clean:
	@rm -f logs/*.log 2>/dev/null || true
	@echo "✓ 已清空 logs/（Lume 下次写访问日志会重建）"
