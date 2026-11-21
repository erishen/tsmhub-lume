# syntax=docker/dockerfile:1
# tsmhub-lume —— Lume BFF + React 控制台镜像
#
# 两个阶段：
#   ui        node 里把 src/web/*.tsx 打包成 www/app.js（纯静态产物）
#   runtime   alpine + lume 二进制 + 本项目入口/docroot，一个进程就是整站
#            （静态文件 + SPA 回退 + 同源 JSON API），不需要 nginx / Node。
#
# lume 是静态 C 单二进制，从 GitHub release 下载（Linux x64 static，与 vendor
# 脚本同一版本 LUME_VERSION），因此构建不依赖任何本地镜像/兄弟 checkout，
# 本机与 CI 行为一致。想覆盖版本：--build-arg LUME_VERSION=vX.Y.Z。

ARG NODE_IMAGE=node:20-alpine
ARG LUME_VERSION=v0.14.1
ARG RUNTIME_IMAGE=alpine:3.20

# ---------- 阶段 1：React 控制台 ----------
FROM ${NODE_IMAGE} AS ui
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src/web ./src/web
COPY www/index.html www/app.css ./www/
RUN npm run build

# ---------- 阶段 1b：lume 二进制（GitHub release，Linux x64 static） ----------
FROM ${RUNTIME_IMAGE} AS lume-bin
ARG LUME_VERSION=v0.14.1
RUN apk add --no-cache curl tar \
 && curl -fsSL -o /tmp/lume.tgz "https://github.com/erishen/lume/releases/download/${LUME_VERSION}/lume-linux-x64-static.tar.gz" \
 && tar -xzf /tmp/lume.tgz -C /tmp \
 && BIN="$(find /tmp -name lume -type f | head -1)" \
 && install -m 755 "$BIN" /usr/local/bin/lume \
 && lume --version

# ---------- 阶段 2：运行时 ----------
FROM ${RUNTIME_IMAGE} AS runtime
COPY --from=lume-bin /usr/local/bin/lume /usr/local/bin/lume

RUN addgroup -S -g 10001 lume \
 && adduser -S -D -H -u 10001 -G lume lume \
 && mkdir -p /app/www /app/.data

WORKDIR /app
COPY --from=ui /web/www/ ./www/
COPY tsmhub_lume.lume ./
COPY src ./src
COPY vendor/lume-core ./vendor/lume-core
RUN chown -R 10001:10001 /app

# 上游默认指向同网络的 tsm-hub 容器；端口固定 18108（宿主机侧由 compose 发布）。
ENV LUME_BIND=0.0.0.0 \
    LUME_PORT=18108 \
    TSM_BASE=http://tsm-hub:9070 \
    TSM_WRITE_GATE=off

USER 10001
EXPOSE 18108

# 只看本进程是否在服务；上游掉线由 /api/health 的 ok 字段体现。
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:18108/api/health >/dev/null || exit 1

CMD ["/usr/local/bin/lume", "tsmhub_lume.lume"]
