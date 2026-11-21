// src/web/app.tsx — 应用外壳：路由 + 布局 + 错误边界。
// 页面拆分在 pages/、通用组件在 components.tsx、纯工具在 utils.ts、钩子在 hooks.ts。
// 这里聚合导出全部符号，测试与入口（main.tsx）继续从 './app' 导入，路径保持不变。

import React, { useCallback, useEffect, useState } from 'react'
import API, { Health, Meta } from './api'
import { NAV, ROLE_LABEL, ROLES, routeFromPath, readRole, writeRole, type RouteKey } from './utils'
import { OverviewPage } from './pages/Overview'
import { ProvidersPage } from './pages/Providers'
import { RoutesPage } from './pages/Routes'
import { KeysPage } from './pages/Keys'
import { UsagePage } from './pages/Usage'
import { ObservabilityPage } from './pages/Observability'
import { AuditPage } from './pages/Audit'
import { CapabilitiesPage } from './pages/Capabilities'
import { PlaygroundPage } from './pages/Playground'
import { BalancesPage } from './pages/Balances'
import { ModelsPage } from './pages/Models'
import { RecommendationsPage } from './pages/Recommendations'
import { SettingsPage } from './pages/Settings'
import { MemoryPage } from './pages/Memory'

// ---------- 应用外壳 ----------

export function App() {
  const [route, setRoute] = useState<RouteKey>(routeFromPath())
  const [role, setRole] = useState(readRole())
  const [meta, setMeta] = useState<Meta | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onPop = () => setRoute(routeFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const loadTop = useCallback(() => {
    API.meta().then(setMeta).catch(() => setMeta(null))
    API.health().then(setHealth).catch(() => setHealth(null))
  }, [])
  useEffect(() => {
    loadTop()
    const t = window.setInterval(loadTop, 30000)
    return () => window.clearInterval(t)
  }, [loadTop])

  const navigate = (k: RouteKey) => {
    history.pushState({}, '', `/${k}`)
    setRoute(k)
    setMenuOpen(false)
    window.scrollTo(0, 0)
  }

  const changeRole = (r: string) => {
    setRole(r)
    writeRole(r)
  }

  const page = (() => {
    switch (route) {
      case 'providers': return <ProvidersPage role={role} />
      case 'balances': return <BalancesPage />
      case 'routes': return <RoutesPage role={role} />
      case 'keys': return <KeysPage role={role} />
      case 'usage': return <UsagePage role={role} />
      case 'models': return <ModelsPage role={role} />
      case 'recommendations': return <RecommendationsPage />
      case 'observability': return <ObservabilityPage />
      case 'audit': return <AuditPage />
      case 'memory': return <MemoryPage role={role} />
      case 'capabilities': return <CapabilitiesPage role={role} />
      case 'playground': return <PlaygroundPage meta={meta} />
      case 'settings': return <SettingsPage role={role} />
      default: return <OverviewPage />
    }
  })()

  return (
    <div className="app">
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <div className="brand-mark">T</div>
          <div>
            <div className="brand-name">tsm-hub</div>
            <div className="brand-sub">Lume 控制台</div>
          </div>
        </div>
        <nav aria-label="主导航">
          {NAV.map((n) => (
            <button
              key={n.key}
              className={n.key === route ? 'nav-item active' : 'nav-item'}
              onClick={() => navigate(n.key)}
              aria-current={n.key === route ? 'page' : undefined}
            >
              <span className="nav-icon" aria-hidden="true">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="tiny">上游</div>
          <div className="mono tiny wrap">{meta?.upstream || '—'}</div>
          <div className="tiny">闸门 {meta?.gate?.mode || '—'}</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? '关闭菜单' : '打开菜单'} aria-expanded={menuOpen}>☰</button>
          <div className="topbar-title">
            {NAV.find((n) => n.key === route)?.label}
          </div>
          <div className="topbar-right">
            <span className={health?.ok ? 'health-dot ok' : 'health-dot err'} role="status" aria-label={health?.ok ? '上游正常' : '上游异常'} title={health?.error || ''} />
            <span className="tiny mono">{health?.ok ? '上游正常' : '上游异常'}</span>
            <label className="role-pick">
              <span className="tiny">角色</span>
              <select value={role} onChange={(e) => changeRole(e.target.value)} aria-label="操作角色">
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </label>
          </div>
        </header>
        <main className="content">{page}</main>
      </div>
      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} />}
    </div>
  )
}

// 错误边界：单页里任何渲染异常都显示可恢复的错误卡，而不是整页白屏。
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: any) {
    return { error: String(e?.message || e) }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="errorbox">
          <div>
            <strong>页面渲染出错</strong>
            <p>{this.state.error}</p>
          </div>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ---------- 桶导出：测试与入口从 './app' 拿到全部符号，兼容旧导入路径 ----------

export { g, arr, num, fmtNum, fmtCost, fmtTime, splitList, statusClass, routeFromPath, readRole, writeRole } from './utils'
export { Spinner, ErrorBox, Empty, Panel, Badge, Table, Stat, AggCards } from './components'
export {
  OverviewPage,
  ProvidersPage,
  RoutesPage,
  KeysPage,
  BalancesPage,
  ModelsPage,
  RecommendationsPage,
  SettingsPage,
  MemoryPage,
}

// 类型再导出：页面模块引用的类型保持可从 './app' 解析。
export type { RouteKey } from './utils'
export type { Overview, Health, Meta, ChatReply } from './api'
