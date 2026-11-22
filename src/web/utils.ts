// src/web/utils.ts — 纯工具：导航配置、取值、格式化、状态样式、路由/角色持久化。
// 无 React / DOM 依赖（仅 location/localStorage），便于单测与页面模块复用。

export const NAV = [
  { key: 'overview', label: '总览', icon: '▦' },
  { key: 'providers', label: 'Providers', icon: '⬡' },
  { key: 'balances', label: '余额', icon: '¤' },
  { key: 'routes', label: '路由表', icon: '⇄' },
  { key: 'keys', label: 'Keys', icon: '⚿' },
  { key: 'usage', label: '用量', icon: '▤' },
  { key: 'models', label: '模型', icon: '▣' },
  { key: 'recommendations', label: '推荐', icon: '★' },
  { key: 'observability', label: '监控', icon: '◉' },
  { key: 'audit', label: '审计', icon: '≡' },
  { key: 'memory', label: '记忆', icon: '≣' },
  { key: 'capabilities', label: '能力池', icon: '✦' },
  { key: 'agent', label: 'Agent', icon: '✷' },
  { key: 'playground', label: '测试', icon: '▷' },
  { key: 'settings', label: '设置', icon: '⚙' },
] as const

export type RouteKey = (typeof NAV)[number]['key']
export const KEYS = NAV.map((n) => n.key) as readonly string[]

export const ROLES = ['agent_operator', 'agent_reviewer', 'agent_reviewer_second', 'human_admin']
export const ROLE_LABEL: Record<string, string> = {
  agent_operator: '操作员',
  agent_reviewer: '一审',
  agent_reviewer_second: '二审',
  human_admin: '终审',
}
export const ROLE_KEY = 'tsmhub_lume_role'

// ---------- 取值 ----------

export const g = (o: any, k: string, d?: any): any => (o && typeof o === 'object' && k in o ? o[k] : d)

export function arr(o: any, ...keys: string[]): any[] {
  for (const k of keys) {
    const v = g(o, k)
    if (Array.isArray(v)) return v
  }
  return []
}

export function num(v: any, d = 0): number {
  if (typeof v === 'number' && isFinite(v)) return v
  const n = Number(v)
  return v != null && v !== '' && isFinite(n) ? n : d
}

// ---------- 格式化 ----------

export function fmtNum(v: any): string {
  const n = num(v, NaN)
  return isNaN(n) ? '—' : n.toLocaleString('zh-CN')
}

export function fmtCost(v: any): string {
  const n = num(v, NaN)
  return isNaN(n) ? '—' : `$${n.toFixed(4)}`
}

export function fmtTime(v: any): string {
  if (!v) return '—'
  const t = new Date(v)
  if (isNaN(t.getTime()) || t.getFullYear() < 2000) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`
}

export function splitList(v: string): string[] {
  return v
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// ---------- 路由 / 角色 ----------

export function routeFromPath(): RouteKey {
  const p = location.pathname.replace(/^\/+|\/+$/g, '')
  return KEYS.includes(p) ? (p as RouteKey) : 'overview'
}

export function readRole(): string {
  try {
    const r = localStorage.getItem(ROLE_KEY) || ''
    return ROLES.includes(r) ? r : 'agent_operator'
  } catch {
    return 'agent_operator'
  }
}

export function writeRole(role: string) {
  try {
    localStorage.setItem(ROLE_KEY, role)
  } catch {
    /* 隐私模式忽略 */
  }
}

// ---------- 状态样式 ----------

export function statusClass(s?: string): string {
  if (s === 'ok' || s === 'healthy' || s === 'success' || s === 'enabled' || s === 'true')
    return 'badge ok'
  if (s === 'running' || s === 'half-open' || s === 'degraded') return 'badge warn'
  if (s === 'failed' || s === 'err' || s === 'cooling' || s === 'false') return 'badge err'
  return 'badge gray'
}
