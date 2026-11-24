# tsmhub-lume

**A Lume + React console for tsm-hub**: a single Lume process serves the static site, SPA fallback, and a same-origin JSON BFF, wrapping the management REST API of [tsm-hub](../tsm-hub) (a home-grown LLM gateway with custom keys and smart routing) into a console that the browser can use directly.

> Positioning: this is tsm-hub's **second web layer**, not a replacement for the original admin console. tsm-hub natively hosts an Angular console via Go `embed`, where the browser calls `/api/admin/*` directly (supplying its own `X-Admin-Token`). Here we switch to **Lume hosting + server-side credential injection**: the browser communicates only with Lume over same-origin requests; the admin password and `sk-tr-` client key stay inside the Lume process and never land in `localStorage` or the page source.

[中文文档](README.zh.md)

## Architecture

```
Browser (React SPA, holds no credentials)
   │   same-origin GET /app.js + /api/*
   ▼
┌────────────────────────────────────────────────┐
│  Lume single process  tsmhub_lume.lume          │
│  ├─ server{}  docroot=./www  spa=true fallback  │
│  ├─ routes  GET/POST/DELETE/PATCH  /api/*       │
│  │     └─ guard.check(execute|approve) gate     │
│  └─ src/api.lume  upstream client               │
│        X-Admin-Token / Bearer sk-tr-  injected  │
└────────────────────┬───────────────────────────┘
                     │  http://tsm-hub:9070 (docker network)
                     ▼
            tsm-hub admin plane /api/admin/*
            (Go gateway: keys + smart routing + capability pool + audit)
```

- **Credential boundary**: `X-Admin-Token` (`TSM_ADMIN`/`TSM_ADMIN_FILE`) and the `sk-tr-` client key (`TSM_CLIENT_KEY`) are read only in `src/api.lume` and are never accessible to the browser.
- **Write operations**: routes first pass `guard.check` (the lume-core approval gate, following the execute/approve chain via `?role=`); only then does `api.proxy` forward them. Read operations pass straight through.

## Tech stack

| Component | Role |
| --- | --- |
| **lume** (framework binary) | HTTP server: `server{}` + routes + SPA fallback + outbound `http_*` proxying |
| **lume-core** | `vendor/lume-core/lib/approval.lume` — write-operation approval gate (separation-of-duties model) |
| **React 18 + TypeScript** | Console SPA, bundled by esbuild into `www/app.js` and served directly by the Lume docroot |

## Layout

```
tsmhub_lume.lume           Lume entry: server{} + all routes (BFF)
src/api.lume              tsm-hub upstream client + first-paint aggregation (holds the admin credential server-side)
src/guard.lume            write gate (lume-core/lib/approval.lume)
src/web/api.ts            frontend API client (same-origin, no token)
src/web/app.tsx           React console shell (routing + layout + error boundary)
src/web/pages/            15 pages (overview / providers / balances / routes / keys / usage / models /
                          recommendations / observability / audit / memory / capabilities / agent / test / settings)
src/web/components.tsx    shared display components; src/web/utils.ts pure helpers; src/web/hooks.ts data/action hooks
www/                      docroot: index.html + app.css + built app.js
scripts/vendor_lume.sh    sync the lume binary and lume-core/lib into vendor/
scripts/smoke.sh          read-only HTTP smoke test
vendor/lume-core/lib/     lume-core shared modules (committed, with a version stamp)
```

## Quick start

Prerequisites: tsm-hub already running locally (default `127.0.0.1:9070`), Node 18+, and a local lume checkout at `work/lume/` (the script fetches from the GitHub release when it is missing).

```bash
cd work/golang/tsmhub-lume

# 1) Sync the lume binary + lume-core/lib
make vendor

# 2) Start (automatically runs lume --check + tsc + esbuild bundling, then Lume in the foreground)
TSM_ADMIN='<tsm-hub admin_token>' make dev
#    → http://127.0.0.1:8097
```

You can also put the credential in a file (better for production — it won't appear in the process environment):

```bash
mkdir -p .data
printf '%s' '<tsm-hub admin_token>' > .data/admin.token
TSM_ADMIN_FILE=.data/admin.token make dev
```

Build / check / test:

```bash
make test        # static gate: lume --check + tsc + esbuild + vitest (no runtime required)
make test-fe     # frontend unit tests only (vitest, jsdom)
make test-local  # static gate + a self-contained smoke test on a temporary instance, cleaned up afterwards (no upstream required)
make check       # lume --check: syntax + types
make typecheck   # tsc --noEmit
make ui          # esbuild → www/app.js
make smoke       # one read-only smoke pass against a running service (includes upstream endpoints by default; add --no-upstream)
make logs-clean  # truncate logs/access.log (it grows during long runs; safe defaults: 0600 / no query strings)
make stop        # stop the service on port 8097
```

`make dev` now depends on `test`, so the full static gate (including frontend unit tests) runs before startup.

### Frontend unit tests

`src/web/app.test.tsx` uses vitest + jsdom + @testing-library/react to cover: pure functions for value retrieval/formatting and status styling, routing and role persistence, the `Badge`/`Stat`/`Table`/`Panel` components, and `ErrorBoundary` (catches child render errors and shows a retryable error card instead of a blank page). The entry point `src/web/main.tsx` handles mounting; `app.tsx` has no side effects and can be imported directly by tests.

## CI

`.github/workflows/ci.yml` runs two jobs on pushes to `main` and on any PR:

1. `test`: `make vendor` (fetch lume + lume-core from the release) → `make test` (lume --check + tsc + esbuild) → `make test-local` (self-contained smoke test on a temporary instance, cleaned up afterwards).
2. `docker`: `docker build` (the lume-bin stage also downloads from the release) → start a container and smoke-test the BFF's own endpoints.

Neither job depends on an upstream tsm-hub, local images, or a sibling checkout — a fresh clone goes green.

> ⚠️ The variable is `TSM_ADMIN`, **not** `TSM_ADMIN_TOKEN`: Lume's `env()` returns `null` for names containing `TOKEN` / `SECRET` / `API_KEY` / `PASSWORD` / `CREDENTIAL` (to prevent scripts from reading secrets). Naming it `TSM_ADMIN_TOKEN` would make it permanently null here. The same applies to `TSM_CLIENT_KEY` (used by the Playground) — its name contains only `KEY`, not `API_KEY`.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `TSM_BASE` | `http://127.0.0.1:9070` | tsm-hub upstream address (loopback/private network; `http_*` uses explicit `allow_private`) |
| `TSM_ADMIN` | empty | tsm-hub admin credential, used only inside the Lume process, injected as `X-Admin-Token` |
| `TSM_ADMIN_FILE` | empty | read the credential from a file, takes precedence over `TSM_ADMIN`; trailing newline is trimmed |
| `TSM_CLIENT_KEY` | empty | optional `sk-tr-…` client key for the Playground page; when empty the page shows a hint |
| `TSM_WRITE_GATE` | `off` | write gate: `off` / `execute` / `approve` |
| `LUME_BIND` / `LUME_PORT` | `127.0.0.1` / `8097` | listen address |
| `HTPASSWD_FILE` | empty | after `make auth` generates accounts, set to `/app/.data/htpasswd` (Docker) / `.data/htpasswd` (local); required for external exposure |
| `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_TIMEOUT` | see below | model upstream settings for the lume agent (`/react/api/chat`), see the "lume agent" section |

## API

All endpoints are same-origin; the browser needs no token. When the upstream is unreachable, the BFF uniformly returns `502 { ok:false, error }` and the frontend displays a retryable error bar.

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | health check for this service + the upstream (`/healthz` and `/api/admin/health`) |
| `GET /api/meta` | upstream address + write-gate policy |
| `GET /api/overview` | first-paint aggregation: counts / today & cumulative usage / quota alerts / provider health / recent audit |
| `GET /api/providers` | provider list |
| `POST /api/providers` | add/update a provider (execute) |
| `POST /api/providers/probe` | probe a model (execute) |
| `DELETE /api/providers/:id` | delete a provider (approve) |
| `GET /api/routes` / `POST /api/routes` / `DELETE /api/routes/:model` | route table CRUD |
| `GET /api/keys` / `POST /api/keys` / `DELETE /api/keys/:id` | key list / issue / delete |
| `PATCH /api/keys/:id` | update a key (name/model/quota, execute) |
| `POST /api/keys/:id/toggle` | enable/disable a key (execute) |
| `GET /api/keys/:id/plaintext` | view key plaintext (approve; viewable once within 2 minutes of creation) |
| `GET /api/usage` | usage (`?days=`) |
| `POST /api/usage/clear` | clear usage (approve) |
| `GET /api/observability` | monitoring overview |
| `GET /api/audit-logs` | audit log (`?limit=`) |
| `GET /api/balances` | provider balances (upstream probes run serially, may be slow) |
| `GET /api/models` / `/api/models/recommendations` | model catalog / recommendations |
| `POST /api/models/refresh` | refresh the model catalog (execute) |
| `GET /api/memory` / `DELETE /api/memory` | session memory read / clear (approve) |
| `GET /api/tools` / `/api/skills` / `/api/mcps` / `/api/fastpath` | capability pool |
| `POST /api/tools/invoke` | invoke a tool (execute) |
| `GET /api/skills/:name` | skill details |
| `POST /api/mcps/:name` / `DELETE /api/mcps/:name` | add/delete an MCP (execute) |
| `POST /api/fastpath/:name/promote` / `DELETE /api/fastpath/:name` | promote/delete a fastpath (approve) |
| `POST /api/fastpath/generate` | generate a fastpath (approve) |
| `GET /api/external-tools` / `POST /api/external-tools/:name/adopt` / `DELETE /api/external-tools/:name` | external-tool candidates / adopt / ignore (approve) |
| `GET /api/external-skills/candidates` | external skill candidates |
| `GET /api/external-mcps/candidates` / `POST /api/external-mcps/suggest` / `POST /api/external-mcps/:server/adopt` / `DELETE /api/external-mcps/:server` | external-MCP candidates / suggest / adopt / ignore (approve) |
| `GET /api/a2a/overview` / `/api/a2a/tasks` | A2A overview / tasks |
| `POST /api/a2a/invoke` | invoke an A2A capability (execute) |
| `GET /api/sandbox/status` / `/api/platforms` | sandbox / upstream platforms |
| `GET /api/settings` / `POST /api/settings` | global settings read / update (approve) |
| `POST /api/chat` | Playground: calls `/v1/chat/completions` with a server-injected `sk-tr-` key |
| `GET/POST /v1/*` | **token pass-through service**: LLM client API, `X-Api-Key` forwarded to upstream `/v1/*` |

## Token pass-through service (`/v1/*`)

Lume also acts as tsm-hub's **LLM client entry point**: clients connect directly to Lume `/v1/*` with their own `sk-tr-` key, and Lume forwards the request verbatim to the upstream (key auth, smart routing, and proxying are all handled there).

```
LLM app/client  --X-Api-Key / Authorization: Bearer: sk-tr-…-->  Lume /v1/*  --pass-through-->  tsm-hub /v1/*
```

| Item | Description |
| --- | --- |
| Auth | Performed upstream. Lume only forwards the client key (one of `X-Api-Key` / `?api_key=` / `Authorization: Bearer`); when the client sends no key it **falls back to the server-side `TSM_CLIENT_KEY`** (see next row), and only when both are absent does the upstream return 401 `missing_key` |
| Endpoints | The whole `/v1/*` space is passed through: `chat/completions`, `models`, `tools`, `tools/invoke`, `skills`, `mcps` |
| Isolated from the admin plane | `/v1/*` does not use the `?role=` gate — it is a client API; only the admin plane `/api/*` uses the gate |
| Key source | client `X-Api-Key` / `Authorization: Bearer` header → then `?api_key=` → then fall back to server-side `TSM_CLIENT_KEY` |
| Path boundary | `/v1/*` accepts only the `/v1/` prefix with no `..` segment; Lume normalizes paths before routing (`/v1/../api/keys` → `/api/keys`, landing on a gated admin route), and `client_path_ok` checks again as defense in depth |

> ✅ **All three forms are accepted**: `X-Api-Key`, `?api_key=`, and **`Authorization: Bearer`** (Lume exposes the full `Authorization` as `req.authorization`, see `lang/bridge.c`; OpenAI-compatible clients and the lume agent can simply use a standard Bearer header). All three are normalized to the `Authorization: Bearer` the upstream expects.

> ⚠️ **Basic Auth is site-wide**: once `HTPASSWD_FILE` is configured, Lume performs Basic Auth at the C layer on every path (including `/v1/*`) before the upper-layer key pass-through runs. So after enabling auth for external exposure, OpenAI-compatible clients must send Basic Auth credentials on the same request in addition to their own `sk-tr-` key (or use a reverse proxy to expose `/v1/*` through an entry without htpasswd). This is not an issue when listening only on local `127.0.0.1` with Basic Auth disabled.

> ✅ **Streaming (lume ≥ v0.14.1)**: `/v1/*` uses the `proxy_stream` envelope — Lume connects to the upstream and **writes each chunk as it reads it** (true streaming, no full-response buffering). `stream:true` SSE arrives chunk by chunk (faster first byte, O(chunk) memory), and OpenAI clients consume it as a normal event stream.
> Docker uses v0.14.2 (downloaded from the release), and the local vendor worktree is the same version, so behavior matches.
> Lume versions earlier than v0.14.1 lack the `proxy_stream` envelope, so `/v1/*` falls back to non-streaming (it waits for the full response and returns it at once — functional but not token-level); long generations are covered by `timeout: 300s`.
>
> ✅ **Float precision (lume v0.14.2)**: lume's `stringify`/`str()`/`print()` use `lume_fmt_double` (shortest round-trip, aligned with Go's json), so `cost_usd`/`error_rate` are no longer truncated by `%g`. The admin plane's `/api/*` `proxy` also **passes the upstream JSON text through verbatim** (no re-serialization), and the aggregation endpoint `/api/overview` keeps full precision, matching the upstream.

## Write gate (lume-core)

`src/guard.lume` imports `vendor/lume-core/lib/approval.lume` and uses its **separation-of-duties (SoD)** model. Actions are **mutually exclusive** (not a hierarchy): an executor cannot approve, and a final approver does not execute directly.

| Role | Actions allowed |
| --- | --- |
| `agent_operator` | `execute` (change providers / routes / keys, invoke tools, probe, refresh) |
| `agent_reviewer` | `review_first` (first review) |
| `agent_reviewer_second` | `review_second` (second review) |
| `human_admin` | `approve` (delete, clear, change global settings), `override`, `audit` |

| Mode | Behavior |
| --- | --- |
| `off` (default) | no checks, for solo development |
| `execute` | reversible writes (execute) require `agent_operator`; irreversible ones (approve) require `human_admin` |
| `approve` | all writes require `human_admin` |

> ⚠️ **SoD is exclusive**: `human_admin` does **not** have `execute` — a final approver does not bypass the flow and execute directly. So in `execute` mode, routine writes (change provider/key, invoke a tool, refresh) must use `agent_operator`, while irreversible writes (delete/clear/change settings) must use `human_admin`, switched via the role selector in the top bar. This is the correct split for **multi-role teams**; a single-admin console can stay `off` or use `approve` mode.

Roles are placed into the `?role=` query parameter by the top-bar selector (Lume's `req` does not expose headers). This is a **flow gate**, not authentication — the real identity boundary is `HTPASSWD_FILE` or a reverse proxy.

**Basic Auth must be enabled before external exposure** (site-wide, including `/react/api/chat`):

```bash
make auth     # interactively generate .data/htpasswd: bcrypt hash + role in the third column, mode 600
# in .env set HTPASSWD_FILE=/app/.data/htpasswd (Docker) or .data/htpasswd (local make dev)
docker compose up -d   # env change only, no image rebuild needed
```

> 🛡️ **Startup safety guard**: `make run` / `make dev` / `make docker` run `scripts/guard_expose.sh` before starting — it refuses to start when the service is **externally reachable without Basic Auth**: local mode checks whether `LUME_BIND` is non-loopback; docker mode checks the host side of the compose port mapping. `LUME_BIND=0.0.0.0` inside the container is required for port mapping and does not count as external — the real boundary is the host-side `127.0.0.1` mapping. For a controlled internal network or external reverse-proxy auth, set `EXPOSE_GUARD=off` to opt out explicitly.

Once enabled, `req.user` / `req.roles` are filled by the framework from htpasswd, and **write roles come only from the third column** (`user:hash:human_admin,agent_operator`); the frontend's `?role=` is fully ignored; accounts without a role column still cannot perform any write operation (fail closed). The top-bar role selector hides automatically and shows the current identity instead. For production also set `TSM_WRITE_GATE=execute` (`.env` is gitignored) so both the identity and flow layers are in place; on local loopback it is fine to leave both empty.

## lume agent (built-in Agent chat)

The console's "Agent" page connects to the **native agent stack of the lume framework** (agent-httpd statically linked into the lume binary): `POST /react/api/chat`, same-origin SSE (note / delta / error / done envelopes). The framework intercepts this endpoint before route dispatch, so the Lume script layer neither needs nor can register it.

- **Model upstream**: `LLM_API_URL` (OpenAI-compatible, **must be the complete `/v1/chat/completions` endpoint** — the agent C layer POSTs this URL directly and appends nothing) + `LLM_API_KEY` + `LLM_MODEL` + `LLM_TIMEOUT`. In Docker the default is `http://tsm-hub:9070/v1/chat/completions`, with the key reusing `TSM_CLIENT_KEY` (mapped to `LLM_API_KEY` in compose); for local `make dev`, put it in the project-root `.env` (lume reads from the working directory). **An empty `LLM_API_KEY` means the built-in offline demo engine**, so you can develop/test offline at no cost. The container needs `curl` at runtime (the agent forks it to call the upstream), which is installed in the image.
- **Read-only console tools**: `tsmhub_lume.lume` registers 5 read-only tools (overview / usage / routes / keys / provider_health) that the agent's ReAct loop can call to answer console questions such as "how many keys, how much spent today"; **no write permissions** — write operations still go through the `?role=` gate on `/api/*`.
- **Router catalog sync**: `ROUTER_API_URL` (defaults to `LLM_API_URL`) points to tsm-hub's **base** (explicitly `http://tsm-hub:9070/v1` in compose, which appends `/v1/tools` etc.); at startup it syncs the upstream `GET /v1/tools` catalog as proxy tools (calls are forwarded to `POST /v1/tools/invoke`), with skills/MCPs mounted as well; local built-in/script tools win on name collisions. Note that it **cannot** be the same value as `LLM_API_URL` (the complete chat endpoint).
- **Model selection**: the Agent page has a model dropdown populated live from the route names in `GET /api/routes` (i.e. those configured in the tsm-hub console); the default route with an empty model is not listed. The default `auto` sends no `model` field; selecting one adds `model` to the request body, and tsm-hub picks a provider by its route table and fails over. The server can optionally set `LLM_ALLOWED_MODELS` (comma-separated) to restrict which model names may be requested; empty means no restriction and the upstream decides — route-table changes need no edit here.
- **Session memory & history**: the frontend generates a `sessionId` as `sess-<hex>`; the same id replays historical context server-side; the "New session" button swaps the id and clears it. After each turn the conversation is saved to browser localStorage (up to 20 entries), switchable/deletable via the "History" dropdown in the toolbar, and recoverable after a refresh or reopening the tab — archives stay in the browser only and are never uploaded. The current session id is kept separately in sessionStorage (invalid once the tab is closed). Each answer bubble has two actions: **Copy** (raw Markdown) and **Retry** — "Retry" regenerates in the current session (keeping prior memory); "Fresh context" uses a new id so the server has no old memory (old answers won't bias the new one, at the cost of prior turns no longer entering server-side memory, although the frontend transcript still shows them). Both discard the old answer for that turn and everything after it.
- **Local archive privacy note**: conversation content (questions and answers) is stored in plaintext in the browser's `localStorage`, up to 20 entries with no automatic expiry. It may contain tsm-hub management data such as key names, usage, and costs — but **no plaintext keys** (the `tsm_keys` tool returns only prefixes). On a shared or public computer, the next user of the same browser profile can see these histories, so avoid discussing sensitive information in such environments. To clear them: delete entries one by one in the toolbar's "History" dropdown, or clear site data in the browser to wipe everything at once. If deploying for multiple people, recommend that each person use a separate browser profile.
- **Security boundary**: the endpoint has same-origin + POST-only checks (`chat_origin_ok`), cross-origin POSTs get 403; it does not use the `?role=` gate — for external deployment be sure to configure `HTPASSWD_FILE` (Basic Auth is site-wide and protects this endpoint too), with cost further backed by the key's quota. LLM credentials stay server-side and are invisible to the browser.

| Variable | Default (compose) | Description |
| --- | --- | --- |
| `LLM_API_URL` | `http://tsm-hub:9070/v1/chat/completions` | OpenAI-compatible upstream for the agent (complete chat endpoint) |
| `LLM_API_KEY` | reuses `TSM_CLIENT_KEY` | empty = offline demo engine |
| `ROUTER_API_URL` | `http://tsm-hub:9070/v1` | base for router catalog sync (appends `/v1/tools` etc.) |
| `LLM_MODEL` | `auto` | default model name (via tsm-hub route table); overridden when a model is selected in the page |
| `LLM_ALLOWED_MODELS` | empty | optional: whitelist for requested `model` overrides (comma-separated); empty = no restriction, decided by tsm-hub |
| `LLM_TIMEOUT` | `120` | per-generation timeout in seconds |

> Note: these variables are read directly by agent-httpd at the **C layer**, bypassing Lume's `env()` — so names containing `API_KEY` are **not** masked here (that masking rule only applies to `env()` calls in the DSL).

## Console pages

Overview / Providers / Balances / Route table / Keys / Usage / Models / Recommendations / Observability / Audit / Memory / Capabilities (tools·skills·mcps·fastpath·a2a·sandbox·platforms, including invoke/details/add-delete/promote/remove/external-candidate adoption/generate writes) / **Agent (native lume chat, see above)** / Test / Settings.
Dark theme, responsive sidebar, upstream health refreshed automatically every 30 seconds.

## Docker

No host Node is needed in the container: the `Dockerfile` builds in two stages and the runtime is just alpine + the lume binary (uid 10001, non-root), with one process serving static files, SPA fallback, and `/api/*`.
The lume binary is downloaded as a tarball and SHA256-verified on the **host** by `make docker`. The version and checksum have a **single source of truth** in the root `lume.version` (currently `v0.14.2`); the Makefile, vendor script, Dockerfile build-arg, and CI all read from it, so upgrading means editing one place. The Dockerfile only COPYs and re-verifies with the passed SHA — zero network dependency at build time (the apk CDN / GitHub in the VM are often TLS-reset), with consistent behavior locally and in CI.

```bash
make docker        # → http://127.0.0.1:18108
make docker-logs
docker compose down
```

- Port **18108** (published only to `127.0.0.1`).
- Joins the existing `tsm-hub_default` network; inside the container the upstream is `http://tsm-hub:9070` (tsm-hub only exposes 9070 on its own container network; the host-side mapping on 19070 is not reachable from inside the container).
- The upstream credential comes from the mounted file `.data/admin.token` (`TSM_ADMIN_FILE`), never baked into the image or placed on the command line.

## Version

`vendor/.vendor-stamp` records the binary version and library source. When a sibling checkout exists locally it is used (measured here: lume `0.14.2` + lume-core worktree `de7ce92`); a fresh clone fetches from the GitHub release using `LUME_VERSION` / `LUME_CORE_TAG` (defaulting to `lume.version`, currently `v0.14.2`).
