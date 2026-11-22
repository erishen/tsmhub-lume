# syntax=docker/dockerfile:1
# tsmhub-lume —— Lume BFF + React 控制台镜像
#
# 两个阶段：
#   ui        node 里把 src/web/*.tsx 打包成 www/app.js（纯静态产物）
#   runtime   alpine + lume 二进制 + 本项目入口/docroot，一个进程就是整站
#            （静态文件 + SPA 回退 + 同源 JSON API），不需要 nginx / Node。
#
# lume 是静态 C 单二进制。release tarball 由 make docker 在宿主侧预下载并做
# SHA256 校验（vendor/lume/lume-linux-x64-static.tar.gz，gitignore；升级版本改
# Makefile 里的 LUME_LINUX_VERSION / LUME_LINUX_SHA256），这里 COPY 进来后再次
# 校验再解包 —— 构建期零网络依赖（VM 内 apk CDN / GitHub 都可能被重置），
# 本机与 CI 行为一致。

ARG NODE_IMAGE=node:20-alpine
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

# ---------- 阶段 1b：lume 二进制（release tarball，宿主侧已预下载） ----------
FROM ${RUNTIME_IMAGE} AS lume-bin
ARG LUME_SHA256=8da8cb7e307b303e490eb80ad92800b6362418bb882824b74c6939f0672fd3b0
COPY vendor/lume/lume-linux-x64-static.tar.gz /tmp/lume.tgz
RUN echo "${LUME_SHA256}  /tmp/lume.tgz" | sha256sum -c - \
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
