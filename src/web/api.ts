// src/web/api.ts — 与 Lume BFF 通信（同源，无 Token、无 CORS）
//
// 浏览器不持有 tsm-hub 的管理口令：所有 /api/* 请求都打到 Lume BFF，
// 由它在服务端注入 X-Admin-Token。写操作用 ?role= 声明角色（闸门流程校验）。

export interface Health {
  ok: boolean
  service: string
  upstream: string
  healthz_status: number
  upstream_status: number
  providers: number
  error: string
}

export interface Meta {
  service: string
  upstream: string
  gate: {
    mode: string
    chain: string[]
    roles: string[]
    execute_action: string
    approve_action: string
  }
  playground?: { client_key?: boolean }
  auth?: { enabled: boolean; user: string }
}

export interface Overview {
  ok: boolean
  upstream: string
  providers: number
  healthy: number
  routes: number
  keys: number
  requests_total: number
  today: Record<string, any> | null
  total: Record<string, any> | null
  warnings: any[]
  providers_health: any[]
  recent_logs: any[]
  errors?: Record<string, string>
}

export interface ChatReply {
  ok?: boolean
  error?: string
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  [key: string]: any
}

const REQUEST_TIMEOUT_MS = 25000

async function request<T>(path: string, init?: RequestInit, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<T> {
  // 前端超时要略短于 BFF 的 30s 上游超时，避免 BFF 卡死时页面无限 loading。
  // balances 等端点上游串行探测可能较慢，调用方可传更长 timeoutMs。
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
  let r: Response
  try {
    r = await fetch(path, {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`请求超时（${timeoutMs / 1000}s）`)
    throw e
  } finally {
    window.clearTimeout(timer)
  }
  const text = await r.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!r.ok) {
    const msg = (data && (data.error || data.err)) || r.statusText || `HTTP ${r.status}`
    throw new Error(String(msg))
  }
  return data as T
}

const withRole = (path: string, role?: string): string => {
  if (!role) return path
  return path + (path.includes('?') ? '&' : '?') + 'role=' + encodeURIComponent(role)
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body || {}),
})

export const API = {
  health: () => request<Health>('/api/health'),
  meta: () => request<Meta>('/api/meta'),
  overview: () => request<Overview>('/api/overview'),

  listProviders: () => request<any>('/api/providers'),
  createProvider: (body: unknown, role?: string) =>
    request<any>(withRole('/api/providers', role), post(body)),
  probeProvider: (body: unknown, role?: string) =>
    request<any>(withRole('/api/providers/probe', role), post(body)),
  deleteProvider: (id: string, role?: string) =>
    request<any>(withRole(`/api/providers/${encodeURIComponent(id)}`, role), { method: 'DELETE' }),

  listBalances: () => request<any>('/api/balances', undefined, 60000),
  listModels: () => request<any>('/api/models'),
  listRecommendations: () => request<any>('/api/models/recommendations'),

  listRoutes: () => request<any>('/api/routes'),
  createRoute: (body: unknown, role?: string) =>
    request<any>(withRole('/api/routes', role), post(body)),
  deleteRoute: (model: string, role?: string) =>
    request<any>(withRole(`/api/routes/${encodeURIComponent(model)}`, role), { method: 'DELETE' }),

  listKeys: () => request<any>('/api/keys'),
  createKey: (body: unknown, role?: string) =>
    request<any>(withRole('/api/keys', role), post(body)),
  toggleKey: (id: string, role?: string) =>
    request<any>(withRole(`/api/keys/${encodeURIComponent(id)}/toggle`, role), post()),
  deleteKey: (id: string, role?: string) =>
    request<any>(withRole(`/api/keys/${encodeURIComponent(id)}`, role), { method: 'DELETE' }),

  usage: (days = 7) => request<any>(`/api/usage?days=${days}`),
  clearUsage: (role?: string) => request<any>(withRole('/api/usage/clear', role), post()),
  observability: () => request<any>('/api/observability'),
  auditLogs: (limit = 100) => request<any>(`/api/audit-logs?limit=${limit}`),

  tools: () => request<any>('/api/tools'),
  skills: () => request<any>('/api/skills'),
  mcps: () => request<any>('/api/mcps'),
  fastpath: () => request<any>('/api/fastpath'),
  a2a: () => request<any>('/api/a2a/overview'),
  sandbox: () => request<any>('/api/sandbox/status'),
  platforms: () => request<any>('/api/platforms'),
  settings: () => request<any>('/api/settings'),
  updateSettings: (body: unknown, role?: string) =>
    request<any>(withRole('/api/settings', role), post(body)),

  // 能力池写操作（BFF 有 execute/approve 闸门）
  invokeTool: (name: string, args: unknown, role?: string) =>
    request<any>(withRole('/api/tools/invoke', role), post({ name, args })),
  a2aTasks: (n = 20) => request<any>(`/api/a2a/tasks?n=${n}`),
  promoteFastpath: (name: string, role?: string) =>
    request<any>(withRole(`/api/fastpath/${encodeURIComponent(name)}/promote`, role), post()),
  deleteFastpath: (name: string, role?: string) =>
    request<any>(withRole(`/api/fastpath/${encodeURIComponent(name)}`, role), { method: 'DELETE' }),
  upsertMcp: (name: string, body: unknown, role?: string) =>
    request<any>(withRole(`/api/mcps/${encodeURIComponent(name)}`, role), post(body)),
  deleteMcp: (name: string, role?: string) =>
    request<any>(withRole(`/api/mcps/${encodeURIComponent(name)}`, role), { method: 'DELETE' }),
  revealKey: (id: string, role?: string) =>
    request<any>(withRole(`/api/keys/${encodeURIComponent(id)}/plaintext`, role)),
  updateKey: (id: string, body: unknown, role?: string) =>
    request<any>(withRole(`/api/keys/${encodeURIComponent(id)}`, role), { method: 'PATCH', body: JSON.stringify(body) }),

  refreshModels: (role?: string) =>
    request<any>(withRole('/api/models/refresh', role), post()),
  skillDetail: (name: string) => request<any>(`/api/skills/${encodeURIComponent(name)}`),
  a2aInvoke: (tool: string, arguments_: unknown, role?: string) =>
    request<any>(withRole('/api/a2a/invoke', role), post({ tool, arguments: arguments_ })),
  memory: () => request<any>('/api/memory'),
  clearMemory: (role?: string) =>
    request<any>(withRole('/api/memory', role), { method: 'DELETE' }),

  // 外部能力采纳
  externalTools: () => request<any>('/api/external-tools'),
  adoptExternalTool: (name: string, role?: string) =>
    request<any>(withRole(`/api/external-tools/${encodeURIComponent(name)}/adopt`, role), post()),
  ignoreExternalTool: (name: string, role?: string) =>
    request<any>(withRole(`/api/external-tools/${encodeURIComponent(name)}`, role), { method: 'DELETE' }),
  externalSkillCandidates: () => request<any>('/api/external-skills/candidates'),
  externalMcpCandidates: () => request<any>('/api/external-mcps/candidates'),
  suggestExternalMcp: (body: unknown, role?: string) =>
    request<any>(withRole('/api/external-mcps/suggest', role), post(body)),
  adoptExternalMcp: (server: string, role?: string) =>
    request<any>(withRole(`/api/external-mcps/${encodeURIComponent(server)}/adopt`, role), post()),
  ignoreExternalMcp: (server: string, role?: string) =>
    request<any>(withRole(`/api/external-mcps/${encodeURIComponent(server)}`, role), { method: 'DELETE' }),
  fastpathGenerate: (query: string, role?: string) =>
    request<any>(withRole('/api/fastpath/generate', role), post({ query })),

  chat: (model: string, messages: Array<{ role: string; content: string }>) =>
    request<ChatReply>('/api/chat', post({ model, messages, stream: false })),
}

export default API
