// src/web/pages/ExternalPanels.tsx — 外部能力采纳面板（tools/skills/mcps 候选）
import API from '../api'
import { useAction, useLoad } from '../hooks'
import { ErrorBox, Panel, Spinner, Table } from '../components'
import { arr, g } from '../utils'

function dynCols(rows: any[], max = 6) {
  return Object.keys(rows[0] || {}).slice(0, max).map((c) => ({
    title: c,
    render: (r: any) => {
      const v = g(r, c)
      return typeof v === 'object' ? <code>{JSON.stringify(v).slice(0, 120)}</code> : <span className="wrap">{String(v ?? '—')}</span>
    },
  }))
}

// 外部工具：列表 + 采纳/忽略（approve 闸门）。
export function ExternalToolsPanel({ role }: { role: string }) {
  const { data, error, loading, reload } = useLoad<any>(() => API.externalTools())
  const act = useAction(role)
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const rows = arr(data, 'external_tools')
  const cols = dynCols(rows)
  cols.push({
    title: '操作',
    render: (r: any) => {
      const name = String(g(r, 'name', '?'))
      return (
        <div className="row-actions">
          <button className="btn sm" disabled={act.busy} onClick={() => act.run(() => API.adoptExternalTool(name, role), reload)}>
            采纳
          </button>
          <button
            className="btn sm danger"
            disabled={act.busy}
            onClick={() => {
              if (window.confirm(`忽略外部工具 ${name}？`)) act.run(() => API.ignoreExternalTool(name, role), reload)
            }}
          >
            忽略
          </button>
        </div>
      )
    },
  })
  return (
    <Panel title={`外部工具 (${rows.length})`}>
      {act.msg && <div className={act.msg.startsWith('操作失败') ? 'notice err' : 'notice ok'}>{act.msg}</div>}
      <Table columns={cols} rows={rows} empty="无外部工具候选" />
    </Panel>
  )
}

// 外部技能候选：只读列表。
export function ExternalSkillCandidates() {
  const { data, error, loading, reload } = useLoad<any>(() => API.externalSkillCandidates())
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const rows = arr(data, 'candidates')
  return (
    <Panel title={`外部技能候选 (${rows.length})`}>
      <Table columns={dynCols(rows)} rows={rows} empty="无外部技能候选" />
    </Panel>
  )
}

// 外部 MCP 候选：按 server 展示 + 建议/采纳/忽略。
export function ExternalMcpCandidates({ role }: { role: string }) {
  const { data, error, loading, reload } = useLoad<any>(() => API.externalMcpCandidates())
  const act = useAction(role)
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const rows = arr(data, 'candidates')
  const cols = dynCols(rows)
  cols.push({
    title: '操作',
    render: (r: any) => {
      const server = String(g(r, 'server', g(r, 'server_name', '?')))
      return (
        <div className="row-actions">
          <button
            className="btn sm"
            disabled={act.busy}
            onClick={() => act.run(() => API.suggestExternalMcp({ server, tools: g(r, 'tools', []) }, role), reload)}
          >
            建议
          </button>
          <button className="btn sm" disabled={act.busy} onClick={() => act.run(() => API.adoptExternalMcp(server, role), reload)}>
            采纳
          </button>
          <button
            className="btn sm danger"
            disabled={act.busy}
            onClick={() => {
              if (window.confirm(`忽略外部 MCP ${server}？`)) act.run(() => API.ignoreExternalMcp(server, role), reload)
            }}
          >
            忽略
          </button>
        </div>
      )
    },
  })
  return (
    <Panel title={`外部 MCP 候选 (${rows.length})`}>
      {act.msg && <div className={act.msg.startsWith('操作失败') ? 'notice err' : 'notice ok'}>{act.msg}</div>}
      <Table columns={cols} rows={rows} empty="无外部 MCP 候选" />
    </Panel>
  )
}
