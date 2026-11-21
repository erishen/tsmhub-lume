# tsmhub-lume

**tsm-hub 的 Lume + React 控制台**：Lume 单进程同时做静态站、SPA 回退和同源 JSON BFF，
把 [tsm-hub](../tsm-hub)（自制 Key + 智能路由的 LLM 网关）的管理 REST API 包装成一个
浏览器可直接用的控制台。

> 定位：这是 tsm-hub 的**第二 Web 层**，不是替换原管理台。tsm-hub 原生用 Go `embed` 托管
> Angular 控制台，浏览器直接打 `/api/admin/*`（要自己带 `X-Admin-Token`）。这里换成
> **Lume 托管 + 服务端注入口令**：浏览器只与 Lume 同源通信，管理口令和 `sk-tr-` 客户端 Key
> 都留在 Lume 进程里，不落到 `localStorage` 或页面源码。

## 架构

```
浏览器 (React SPA, 不持口令)
   │   同源 GET /app.js + /api/*
   ▼
┌────────────────────────────────────────────────┐
│  Lume 单进程  tsmhub_lume.lume                  │
│  ├─ server{}  docroot=./www  spa=true 回退      │
│  ├─ 路由  GET/POST/DELETE/PATCH  /api/*         │
│  │     └─ guard.check(execute|approve) 审批闸门  │
│  └─ src/api.lume  上游客户端                     │
│        X-Admin-Token / Bearer sk-tr-  服务端注入 │
└────────────────────┬───────────────────────────┘
                     │  http://tsm-hub:9070（docker 网络）
                     ▼
            tsm-hub 管理面 /api/admin/*
            （Go 网关：Key + 智能路由 + 能力池 + 审计）
```

- **口令边界**：`X-Admin-Token`（`TSM_ADMIN`/`TSM_ADMIN_FILE`）与 `sk-tr-` 客户端 Key
  （`TSM_CLIENT_KEY`）只在 `src/api.lume` 里读取，浏览器永远接触不到。
- **写操作**：路由层先过 `guard.check`（lume-core 审批闸门，按 `?role=` 走
  execute/approve 链），通过才 `api.proxy` 转发；读操作直接透传。

## 技术栈

| 组件 | 角色 |
| --- | --- |
| **lume**（framework 二进制） | HTTP 服务：`server{}` + 路由 + SPA 回退 + 出站 `http_*` 代理 |
| **lume-core** | `vendor/lume-core/lib/approval.lume` —— 写操作审批闸门（职责分离模型） |
| **React 18 + TypeScript** | 控制台 SPA，esbuild 打包成 `www/app.js`，由 Lume docroot 直接伺服 |

## 目录

```
tsmhub_lume.lume           Lume 入口：server{} + 全部路由（BFF）
src/api.lume              tsm-hub 上游客户端 + 首屏聚合（服务端持有管理口令）
src/guard.lume            写操作闸门（lume-core/lib/approval.lume）
src/web/api.ts            前端 API 客户端（同源，无 Token）
src/web/app.tsx           React 控制台外壳（路由 + 布局 + 错误边界）
src/web/pages/            13 个页面（总览/Providers/余额/路由/Keys/用量/模型/推荐/监控/审计/能力池/测试/设置）
src/web/components.tsx    通用展示组件；src/web/utils.ts 纯工具；src/web/hooks.ts 数据/操作钩子
www/                      docroot：index.html + app.css + 构建产物 app.js
scripts/vendor_lume.sh    同步 lume 二进制与 lume-core/lib 到 vendor/
scripts/smoke.sh          只读 HTTP 冒烟
vendor/lume-core/lib/      lume-core 共享模块（入库，带版本戳）
```

## 快速开始

前置：tsm-hub 已在本机运行（默认 `127.0.0.1:9070`），Node 18+，Lume 本地 checkout 在
`work/lume/`（缺失时脚本自动从 GitHub release 拉取）。

```bash
cd work/golang/tsmhub-lume

# 1) 同步 lume 二进制 + lume-core/lib
make vendor

# 2) 启动（自动做 lume --check + tsc + esbuild 打包，然后前台起 Lume）
TSM_ADMIN='<tsm-hub 的 admin_token>' make dev
#    → http://127.0.0.1:8097
```

也可以把口令放文件里（更适合生产，不出现在进程环境里）：

```bash
mkdir -p .data
printf '%s' '<tsm-hub 的 admin_token>' > .data/admin.token
TSM_ADMIN_FILE=.data/admin.token make dev
```

构建 / 校验 / 测试：

```bash
make test        # 静态门禁：lume --check + tsc + esbuild + vitest（无需运行环境）
make test-fe     # 仅前端单测（vitest，jsdom）
make test-local  # 静态门禁 + 起临时实例做自包含冒烟，测完自动清理（不依赖上游）
make check       # lume --check：语法 + 类型
make typecheck   # tsc --noEmit
make ui          # esbuild → www/app.js
make smoke       # 对运行中的服务做一次只读冒烟（默认含上游端点，可加 --no-upstream）
make logs-clean  # 截断 logs/access.log（长期运行会增长，默认安全：0600/不记 query string）
make stop        # 停掉 8097 上的服务
```

`make dev` 现在以 `test` 为前置，启动前自动跑完整静态门禁（含前端单测）。

### 前端单测

`src/web/app.test.tsx` 用 vitest + jsdom + @testing-library/react 覆盖：取值/格式化/状态
样式的纯函数、路由与角色持久化、`Badge`/`Stat`/`Table`/`Panel` 组件、`ErrorBoundary`
（捕获子组件渲染异常并显示可重试错误卡，防整页白屏）。入口 `src/web/main.tsx`
负责挂载，`app.tsx` 无副作用，可被测试直接导入。

## CI

`.github/workflows/ci.yml` 在 push 到 `main` 或任意 PR 上跑两个 job：

1. `test`：`make vendor`（release 拉 lume + lume-core）→ `make test`（lume --check +
   tsc + esbuild）→ `make test-local`（临时实例自包含冒烟，测完清理）。
2. `docker`：`docker build`（lume-bin 阶段也从 release 下载）→ 起容器冒烟 BFF 自身端点。

两个 job 都**不依赖上游 tsm-hub、不依赖本地镜像或兄弟 checkout**，clone 后即可绿。

> ⚠️ 变量名是 `TSM_ADMIN`，**不是** `TSM_ADMIN_TOKEN`：Lume 的 `env()` 会对名字里含
> `TOKEN` / `SECRET` / `API_KEY` / `PASSWORD` / `CREDENTIAL` 的变量返回 `null`
> （防机密被脚本读走）。直接叫 `TSM_ADMIN_TOKEN` 在这里恒为 null。
> `TSM_CLIENT_KEY` 同理（Playground 用），名字里只有 `KEY`、没有 `API_KEY`。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `TSM_BASE` | `http://127.0.0.1:9070` | tsm-hub 上游地址（回环/私网，`http_*` 显式 `allow_private`） |
| `TSM_ADMIN` | 空 | tsm-hub 管理口令，只在 Lume 进程内使用，注入 `X-Admin-Token` |
| `TSM_ADMIN_FILE` | 空 | 从文件读口令，优先于 `TSM_ADMIN`；末尾换行会被裁掉 |
| `TSM_CLIENT_KEY` | 空 | 可选 `sk-tr-…` 客户端 Key，Playground 页面用；留空则该页给出提示 |
| `TSM_WRITE_GATE` | `off` | 写操作闸门：`off` / `execute` / `approve` |
| `LUME_BIND` / `LUME_PORT` | `127.0.0.1` / `8097` | 监听地址 |
| `HTPASSWD_FILE` | 空 | 设置后启用 Basic Auth（对外暴露时必须） |

## API

全部同源，浏览器无需任何 Token。BFF 对上游不可达统一返回 `502 { ok:false, error }`，
前端显示可重试的错误条。

| 端点 | 说明 |
| --- | --- |
| `GET /api/health` | 本服务 + 上游健康检查（`/healthz` 与 `/api/admin/health`） |
| `GET /api/meta` | 上游地址 + 写操作闸门策略 |
| `GET /api/overview` | 首屏聚合：计数 / 今日&累计用量 / 额度告警 / Provider 健康 / 最近审计 |
| `GET /api/providers` | Provider 列表 |
| `POST /api/providers` | 新增/更新 Provider（execute） |
| `POST /api/providers/probe` | 探测模型（execute） |
| `DELETE /api/providers/:id` | 删除 Provider（approve） |
| `GET /api/routes` / `POST /api/routes` / `DELETE /api/routes/:model` | 路由表增删改 |
| `GET /api/keys` / `POST /api/keys` / `DELETE /api/keys/:id` | Key 列表/签发/删除 |
| `PATCH /api/keys/:id` | 更新 Key（名称/模型/额度，execute） |
| `POST /api/keys/:id/toggle` | 启停 Key（execute） |
| `GET /api/keys/:id/plaintext` | 查看 Key 明文（approve；创建后 2 分钟内可看一次） |
| `GET /api/usage` | 用量（`?days=`） |
| `POST /api/usage/clear` | 清空用量（approve） |
| `GET /api/observability` | 监控概览 |
| `GET /api/audit-logs` | 审计日志（`?limit=`） |
| `GET /api/balances` | Provider 余额（上游串行探测，可能较慢） |
| `GET /api/models` / `/api/models/recommendations` | 模型目录 / 推荐 |
| `POST /api/models/refresh` | 刷新模型目录（execute） |
| `GET /api/memory` / `DELETE /api/memory` | 会话记忆读取 / 清空（approve） |
| `GET /api/tools` / `/api/skills` / `/api/mcps` / `/api/fastpath` | 能力池 |
| `POST /api/tools/invoke` | 调用工具（execute） |
| `GET /api/skills/:name` | 技能详情 |
| `POST /api/mcps/:name` / `DELETE /api/mcps/:name` | 新增/删除 MCP（execute） |
| `POST /api/fastpath/:name/promote` / `DELETE /api/fastpath/:name` | 提升/删除 fastpath（approve） |
| `POST /api/fastpath/generate` | 生成 fastpath（approve） |
| `GET /api/external-tools` / `POST /api/external-tools/:name/adopt` / `DELETE /api/external-tools/:name` | 外部工具 候选/采纳/忽略（approve） |
| `GET /api/external-skills/candidates` | 外部技能候选 |
| `GET /api/external-mcps/candidates` / `POST /api/external-mcps/suggest` / `POST /api/external-mcps/:server/adopt` / `DELETE /api/external-mcps/:server` | 外部 MCP 候选/建议/采纳/忽略（approve） |
| `GET /api/a2a/overview` / `/api/a2a/tasks` | A2A 概览 / 任务 |
| `POST /api/a2a/invoke` | A2A 调用能力（execute） |
| `GET /api/sandbox/status` / `/api/platforms` | 沙箱 / 上游平台 |
| `GET /api/settings` / `POST /api/settings` | 全局设置读取 / 更新（approve） |
| `POST /api/chat` | Playground：经服务端注入 `sk-tr-` Key 打 `/v1/chat/completions` |

## 写操作闸门（lume-core）

`src/guard.lume` import `vendor/lume-core/lib/approval.lume`，用它的**职责分离**模型：

| 角色 | 可执行的动作 |
| --- | --- |
| `agent_operator` | `execute`（改 Provider / 路由 / Key、探测、刷新） |
| `human_admin` | `approve`（删除、清空、改全局设置） |

| 模式 | 行为 |
| --- | --- |
| `off`（默认） | 不校验，单人开发 |
| `execute` | 可逆写操作需 `agent_operator`；不可逆操作仍需 `human_admin` |
| `approve` | 所有写操作都需 `human_admin` |

角色由前端顶栏选择器放进 `?role=` 查询参数（Lume 的 `req` 不暴露请求头）。这是**流程门禁**，
不是身份认证——真正的身份边界交给 `HTPASSWD_FILE` 或反向代理。

## 控制台页面

总览 / Providers / 余额 / 路由表 / Keys / 用量 / 模型 / 推荐 / 监控 / 审计 / 记忆 / 能力池（tools·skills·mcps·fastpath·a2a·sandbox·platforms，含调用/详情/增删/提升/删除/外部候选采纳/生成写操作）/ 测试 / 设置。
深色主题、响应式侧栏、30 秒自动刷新上游健康状态。

## Docker

容器里不需要宿主 Node：`Dockerfile` 两段构建，runtime 只有 alpine + lume 二进制
（uid 10001，非 root），一个进程负责静态文件、SPA 回退和 `/api/*`。
lume 二进制在构建期从 GitHub release 下载（Linux x64 static，`ARG LUME_VERSION`
默认 `v0.13.1`，与 vendor 脚本同一版本），**不依赖本地镜像或兄弟 checkout**，
因此本机与 CI 行为一致。

```bash
make docker        # → http://127.0.0.1:18108
make docker-logs
docker compose down
```

- 端口 **18108**（只发布到 `127.0.0.1`）。
- 接入已有的 `tsm-hub_default` 网络，容器内用 `http://tsm-hub:9070` 访问上游
  （tsm-hub 只把 9070 暴露在自己的容器网络里，宿主侧映射的 19070 在容器里够不着）。
- 上游口令走挂载文件 `.data/admin.token`（`TSM_ADMIN_FILE`），不进镜像、不上命令行。

## 版本

`vendor/.vendor-stamp` 记录二进制版本与库来源。本地兄弟 checkout 存在时用它
（本次实测：lume `0.14.0` + lume-core 工作树 `de7ce92`）；单独 clone 时从 GitHub
release 拉 `LUME_VERSION` / `LUME_CORE_TAG`（默认 `v0.13.1`）。
