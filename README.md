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
src/web/pages/            15 个页面（总览/Providers/余额/路由/Keys/用量/模型/推荐/监控/审计/记忆/能力池/Agent/测试/设置）
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
| `HTPASSWD_FILE` | 空 | `make auth` 生成账号后设为 `/app/.data/htpasswd`（Docker）/ `.data/htpasswd`（本机）；对外暴露必须 |
| `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_TIMEOUT` | 见下文 | lume agent（`/react/api/chat`）的模型上游配置，见「lume agent」一节 |

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
| `GET/POST /v1/*` | **token 转发服务**：LLM 客户端 API，`X-Api-Key` 透传到上游 `/v1/*` |

## token 转发服务（`/v1/*`）

Lume 同时是 tsm-hub 的 **LLM 客户端入口**：客户端用自己的 `sk-tr-` Key 直连
Lume `/v1/*`，Lume 把请求原样转发到上游（Key 鉴权 + 智能路由 + 转发都由上游做）。

```
LLM 应用/客户端  --X-Api-Key / Authorization: Bearer: sk-tr-…-->  Lume /v1/*  --透传-->  tsm-hub /v1/*
```

| 项 | 说明 |
| --- | --- |
| 鉴权 | 在上游做。Lume 只透传客户端 Key（`X-Api-Key` / `?api_key=` / `Authorization: Bearer` 三选一），无 Key → 上游 401 `missing_key` |
| 端点 | 整个 `/v1/*` 空间透传：`chat/completions`、`models`、`tools`、`tools/invoke`、`skills`、`mcps` |
| 与管理面隔离 | `/v1/*` 不走 `?role=` 闸门——这是客户端 API；管理面 `/api/*` 才走闸门 |
| Key 来源 | 客户端 `X-Api-Key` / `Authorization: Bearer` 头 → 未带则 `?api_key=` → 未带则回退服务端 `TSM_CLIENT_KEY` |
| 路径边界 | `/v1/*` 只接受 `/v1/` 前缀且无 `..` 路径段；Lume 在路由前规范化路径（`/v1/../api/keys` → `/api/keys`，落到管理路由含闸门），`client_path_ok` 再拦一次作防御纵深 |

> ✅ **三种方式都接受**：`X-Api-Key`、`?api_key=`、**`Authorization: Bearer`**（Lume 把
> 完整 `Authorization` 暴露在 `req.authorization`，见 `lang/bridge.c`；OpenAI 兼容客户端
> 与 lume agent 用标准 Bearer 头即可）。三种都归一为上游认的 `Authorization: Bearer`。

> ✅ **流式（lume ≥ v0.14.1）**：`/v1/*` 用 `proxy_stream` 信封——Lume 连上游、
> **读一块写一块**（真流式，不缓冲整响应）。`stream:true` 的 SSE 逐块到达
> （首字节更快、内存 O(块)），OpenAI 客户端按正常 event-stream 消费。
> Docker 用 v0.14.2（release 下载），本地 vendor 工作树同版，行为一致。
> 早于 v0.14.1 的 lume 无 `proxy_stream` 信封，`/v1/*` 回退为非流式（等完整
> 响应一次性返回，功能可用但非 token 级）；长生成靠 `timeout: 300s` 兜底。
>
> ✅ **浮点精度（lume v0.14.2）**：lume `stringify`/`str()`/`print()` 用
> `lume_fmt_double`（最短 round-trip，对齐 Go json）——`cost_usd`/`error_rate`
> 不再被 `%g` 截断。管理面 `/api/*` 的 `proxy` 还**原样透传**上游 JSON 文本
> （不重序列化），聚合端点 `/api/overview` 也精度完整，与上游一致。

## 写操作闸门（lume-core）

`src/guard.lume` import `vendor/lume-core/lib/approval.lume`，用它的**职责分离（SoD）**模型。
动作是**互斥的**（不是等级包含）：执行者没有审批权，终审者不直接执行。

| 角色 | 可执行的动作 |
| --- | --- |
| `agent_operator` | `execute`（改 Provider / 路由 / Key、调用工具、探测、刷新） |
| `agent_reviewer` | `review_first`（一审） |
| `agent_reviewer_second` | `review_second`（二审） |
| `human_admin` | `approve`（删除、清空、改全局设置）、`override`、`audit` |

| 模式 | 行为 |
| --- | --- |
| `off`（默认） | 不校验，单人开发 |
| `execute` | 可逆写操作（execute）需 `agent_operator`；不可逆操作（approve）需 `human_admin` |
| `approve` | 所有写操作都需 `human_admin` |

> ⚠️ **SoD 互斥**：`human_admin` **没有** `execute`——终审者不绕过流程直接执行。所以
> `execute` 模式下，常规写（改 Provider/Key、调用工具、刷新）必须用 `agent_operator`，
> 不可逆写（删/清空/改设置）必须用 `human_admin`，由前端顶栏角色选择器切换。
> 对**多角色团队**这是正确分工；单管理员控制台可保持 `off` 或用 `approve` 模式。

角色由前端顶栏选择器放进 `?role=` 查询参数（Lume 的 `req` 不暴露请求头）。这是**流程门禁**，
不是身份认证——真正的身份边界交给 `HTPASSWD_FILE` 或反向代理。

**对外暴露前必须启用 Basic Auth**（全站生效，含 `/react/api/chat`）：

```bash
make auth     # 交互式生成 .data/htpasswd：bcrypt 哈希 + 第三列角色，权限 600
# .env 里设 HTPASSWD_FILE=/app/.data/htpasswd（Docker）或 .data/htpasswd（本机 make dev）
docker compose up -d   # 环境变量变更，无需重建镜像
```

开启后 `req.user` / `req.roles` 由框架从 htpasswd 填充，**写角色只认第三列**
（`user:hash:human_admin,agent_operator`），前端 `?role=` 被完全忽略；未配角色列
的账号登录后仍无法执行任何写操作（fail closed）。顶栏角色选择器会自动隐藏，
改为显示当前身份。生产同时建议设 `TSM_WRITE_GATE=execute`（`.env` 已 gitignore），
身份与流程两层都齐；本机 loopback 保持两项目为空即可，用法不变。

## lume agent（内置 Agent 聊天）

控制台「Agent」页接的是 **lume 框架原生的 agent 栈**（agent-httpd 静态链进 lume
二进制）：`POST /react/api/chat`，同源 SSE（note / delta / error / done 信封）。
该端点由框架层在路由分发前拦截，Lume 脚本层无需（也无法）注册它。

- **模型上游**：`LLM_API_URL`（OpenAI 兼容，**必须写完整的 `/v1/chat/completions`
  端点**——agent C 层直接 POST 这个 URL，不追加路径）+ `LLM_API_KEY` + `LLM_MODEL`
  + `LLM_TIMEOUT`。Docker 里默认 `http://tsm-hub:9070/v1/chat/completions`，
  Key 复用 `TSM_CLIENT_KEY`（compose 里映射为 `LLM_API_KEY`）；本地 `make dev`
  时写进项目根 `.env`（lume 从运行目录读取）。**`LLM_API_KEY` 留空 = 内置离线
  演示引擎**，可离线开发/测试，不花钱。容器运行时需要 `curl`（agent fork 它打上游），
  镜像里已装。
- **控制台只读工具**：`tsmhub_lume.lume` 注册了 5 个只读 tool（overview / usage /
  routes / keys / provider_health），agent 的 ReAct 循环可直接调用，回答「多少
  key、今天花了多少」这类控制台问题；**不拥有任何写权限**——写操作仍走
  `/api/*` 的 `?role=` 闸门路由。
- **router 目录同步**：`ROUTER_API_URL`（默认复用 `LLM_API_URL`）指向 tsm-hub 的
  **base**（compose 里显式设为 `http://tsm-hub:9070/v1`，会拼 `/v1/tools` 等后缀），
  启动时把上游 `GET /v1/tools` 目录同步为代理工具（调用时转发
  `POST /v1/tools/invoke`），skills/MCP 一并挂载；与本地内建/脚本工具同名时
  本地实现优先。注意它**不能**和 `LLM_API_URL`（完整 chat 端点）写成同一个值。
- **模型选择**：Agent 页有模型下拉，选项实时取自 `GET /api/routes` 的路由名
  （即 tsm-hub 控制台配置的那些），空 model 的默认路由不列出。默认 `auto`
  不传 `model` 字段；选中后请求体带 `model`，由 tsm-hub 按路由表选 provider
  并 failover。服务端可选 `LLM_ALLOWED_MODELS`（逗号分隔）限制可覆盖的模型名，
  留空则不限制、由上游裁决——路由表增删后无需改这里。
- **会话记忆**：前端按 `sess-<hex>` 生成 sessionId，同一 id 服务端重放历史上下文；
  「新会话」按钮换 id 即清空。
- **安全边界**：端点有同源 + POST-only 校验（`chat_origin_ok`），跨域 POST 403；
  但它不走 `?role=` 闸门——对外部署务必配 `HTPASSWD_FILE`（Basic Auth 全站生效，
  会一并保护该端点），成本另由 Key 的额度兜底。LLM 凭据只在服务端，浏览器不可见。

| 变量 | 默认（compose） | 说明 |
| --- | --- | --- |
| `LLM_API_URL` | `http://tsm-hub:9070/v1/chat/completions` | agent 的 OpenAI 兼容上游（完整 chat 端点） |
| `LLM_API_KEY` | 复用 `TSM_CLIENT_KEY` | 留空 = 离线演示引擎 |
| `ROUTER_API_URL` | `http://tsm-hub:9070/v1` | router 目录同步的 base（拼 `/v1/tools` 等） |
| `LLM_MODEL` | `auto` | 默认模型名（走 tsm-hub 路由表）；页面选中模型时覆盖 |
| `LLM_ALLOWED_MODELS` | 空 | 可选：请求 `model` 覆盖白名单（逗号分隔）；留空 = 不限制，由 tsm-hub 裁决 |
| `LLM_TIMEOUT` | `120` | 单次生成超时秒数 |

> 注意：这些变量由 agent-httpd 在 **C 层**直接读取，不经过 Lume 的 `env()`——
> 所以名字里含 `API_KEY` 在这里**不会**被屏蔽（那条屏蔽规则只约束 DSL 里的
> `env()` 调用）。

## 控制台页面

总览 / Providers / 余额 / 路由表 / Keys / 用量 / 模型 / 推荐 / 监控 / 审计 / 记忆 / 能力池（tools·skills·mcps·fastpath·a2a·sandbox·platforms，含调用/详情/增删/提升/删除/外部候选采纳/生成写操作）/ **Agent（lume 原生聊天，见上节）** / 测试 / 设置。
深色主题、响应式侧栏、30 秒自动刷新上游健康状态。

## Docker

容器里不需要宿主 Node：`Dockerfile` 两段构建，runtime 只有 alpine + lume 二进制
（uid 10001，非 root），一个进程负责静态文件、SPA 回退和 `/api/*`。
lume 二进制由 `make docker` 在**宿主侧**下载 tarball 并校验 SHA256
（`LUME_LINUX_VERSION` 默认 `v0.14.2`，与 vendor 脚本同一版本），Dockerfile 只
COPY + 二次校验——构建期零网络依赖（VM 内 apk CDN / GitHub 常被 TLS 重置），
本机与 CI 行为一致。

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
（本次实测：lume `0.14.2` + lume-core 工作树 `de7ce92`）；单独 clone 时从 GitHub
release 拉 `LUME_VERSION` / `LUME_CORE_TAG`（默认 `v0.14.2`）。
