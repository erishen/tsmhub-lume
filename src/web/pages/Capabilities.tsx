// src/web/pages/Capabilities.tsx — 能力池页（读 + 关键写操作）
import React, { useState } from 'react'
import API from '../api'
import { useAction, useLoad } from '../hooks'
import { Badge, ErrorBox, Panel, Spinner, Table } from '../components'
import { arr, g } from '../utils'
import { ExternalMcpCandidates, ExternalSkillCandidates, ExternalToolsPanel } from './ExternalPanels'

const CAP_TABS = ['tools', 'skills', 'mcps', 'fastpath', 'a2a', 'sandbox', 'platforms'] as const
type CapTab = (typeof CAP_TABS)[number]

const LIST_KEYS: Record<CapTab, string[]> = {
  tools: ['tools'],
  skills: ['skills'],
  mcps: ['mcps', 'servers'],
  fastpath: ['plugins', 'items', 'fastpaths'],
  a2a: ['peers', 'tasks', 'capabilities'],
  sandbox: ['tools', 'containers'],
  platforms: ['platforms'],
}

// A2A 任务列表：单独加载（/api/a2a/tasks），与 overview 并排展示。
function A2ATasks() {
  const { data, error, loading, reload } = useLoad<any>(() => API.a2aTasks())
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const tasks = arr(data, 'tasks')
  return (
    <Panel title={`A2A 任务 (${tasks.length})`}>
      <Table
        columns={[
          { title: 'ID', render: (r) => <code>{String(g(r, 'id', '—'))}</code> },
          { title: '类型', render: (r) => String(g(r, 'type', '—')) },
          { title: '状态', render: (r) => <Badge value={g(r, 'status')} /> },
          { title: '节点', render: (r) => String(g(r, 'agent', g(r, 'node', '—'))) },
          { title: '时间', render: (r) => String(g(r, 'updated_at', g(r, 'ts', g(r, 'created_at', '—')))) },
        ]}
        rows={tasks}
        empty="暂无 A2A 任务"
      />
    </Panel>
  )
}

export function CapabilitiesPage({ role }: { role: string }) {
  const [tab, setTab] = useState<CapTab>('tools')
  const act = useAction(role)
  const loaders: Record<CapTab, () => Promise<any>> = {
    tools: API.tools,
    skills: API.skills,
    mcps: API.mcps,
    fastpath: API.fastpath,
    a2a: API.a2a,
    sandbox: API.sandbox,
    platforms: API.platforms,
  }
  const { data, error, loading, reload } = useLoad<any>(loaders[tab], [tab])
  const [invoke, setInvoke] = useState('')
  const [mcpOpen, setMcpOpen] = useState(false)
  const [mcp, setMcp] = useState({ name: '', command: '', transport: 'stdio', url: '' })
  const [skillDetail, setSkillDetail] = useState('')
  const [a2aTool, setA2aTool] = useState('')
  const [a2aArgs, setA2aArgs] = useState('{}')
  const [fpQuery, setFpQuery] = useState('')

  let body: React.ReactNode = null
  if (loading) body = <Spinner />
  else if (error) body = <ErrorBox error={error} onRetry={reload} />
  else if (data && typeof data === 'object') {
    const rows = arr(data, ...LIST_KEYS[tab])
    if (rows.length) {
      const cols = Object.keys(rows[0] || {}).slice(0, 8).map((c) => ({
        title: c,
        render: (r: any) => {
          const v = g(r, c)
          return typeof v === 'object' ? <code>{JSON.stringify(v).slice(0, 140)}</code> : <span className="wrap">{String(v ?? '—')}</span>
        },
      }))
      // 各 tab 写操作列
      if (tab === 'tools') {
        cols.push({
          title: '操作',
          render: (r: any) => (
            <button
              className="btn sm"
              disabled={act.busy}
              onClick={async () => {
                const name = String(g(r, 'name', '?'))
                const raw = window.prompt(`调用工具 ${name}：输入 JSON 参数`, '{}')
                if (raw == null) return
                let args: any = {}
                try {
                  args = JSON.parse(raw || '{}')
                } catch {
                  setInvoke('参数不是合法 JSON')
                  return
                }
                act.run(async () => {
                  const res = await API.invokeTool(name, args, role)
                  setInvoke(`调用 ${name} 完成：${JSON.stringify(res).slice(0, 220)}`)
                })
              }}
            >
              调用
            </button>
          ),
        })
      } else if (tab === 'fastpath') {
        cols.push({
          title: '操作',
          render: (r: any) => (
            <div className="row-actions">
              <button
                className="btn sm"
                disabled={act.busy}
                onClick={() => {
                  const name = String(g(r, 'name', '?'))
                  act.run(() => API.promoteFastpath(name, role), reload)
                }}
              >
                提升
              </button>
              <button
                className="btn sm danger"
                disabled={act.busy}
                onClick={() => {
                  const name = String(g(r, 'name', '?'))
                  if (window.confirm(`删除 fastpath ${name}？`)) act.run(() => API.deleteFastpath(name, role), reload)
                }}
              >
                删除
              </button>
            </div>
          ),
        })
      } else if (tab === 'skills') {
        cols.push({
          title: '操作',
          render: (r: any) => (
            <button
              className="btn sm"
              disabled={act.busy}
              onClick={async () => {
                const name = String(g(r, 'name', '?'))
                act.run(async () => {
                  const d = await API.skillDetail(name)
                  setSkillDetail(`技能「${name}」：${JSON.stringify(d).slice(0, 300)}`)
                })
              }}
            >
              详情
            </button>
          ),
        })
      } else if (tab === 'mcps') {
        cols.push({
          title: '操作',
          render: (r: any) => (
            <button
              className="btn sm danger"
              disabled={act.busy}
              onClick={() => {
                const name = String(g(r, 'name', '?'))
                if (window.confirm(`删除 MCP ${name}？`)) act.run(() => API.deleteMcp(name, role), reload)
              }}
            >
              删除
            </button>
          ),
        })
      }
      body = <Table columns={cols} rows={rows} />
    } else {
      body = (
        <div className="kv">
          {Object.keys(data).map((k) => (
            <div key={k} className="kv-row">
              <span className="kv-key">{k}</span>
              <span className="wrap">{typeof g(data, k) === 'object' ? JSON.stringify(g(data, k)).slice(0, 200) : String(g(data, k))}</span>
            </div>
          ))}
        </div>
      )
    }
  }

  return (
    <Panel title="能力池">
      <div className="tabs">
        {CAP_TABS.map((t) => (
          <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'mcps' && (
        <div className="row-actions">
          <button className="btn" onClick={() => setMcpOpen(!mcpOpen)}>
            {mcpOpen ? '取消' : '+ 新增 MCP'}
          </button>
        </div>
      )}
      {mcpOpen && tab === 'mcps' && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            act.run(
              () => API.upsertMcp(mcp.name, { command: mcp.command, transport: mcp.transport, url: mcp.url }, role),
              () => {
                setMcpOpen(false)
                reload()
              },
            )
          }}
        >
          <label>名称<input value={mcp.name} onChange={(e) => setMcp({ ...mcp, name: e.target.value })} required placeholder="my-server" /></label>
          <label>命令<input value={mcp.command} onChange={(e) => setMcp({ ...mcp, command: e.target.value })} placeholder="npx -y @modelcontextprotocol/server-…" /></label>
          <label>传输
            <select value={mcp.transport} onChange={(e) => setMcp({ ...mcp, transport: e.target.value })}>
              <option value="stdio">stdio</option>
              <option value="sse">sse</option>
              <option value="streamable-http">streamable-http</option>
            </select>
          </label>
          <label>URL<input value={mcp.url} onChange={(e) => setMcp({ ...mcp, url: e.target.value })} placeholder="http://…（sse/http 用）" /></label>
          <button className="btn primary" disabled={act.busy} type="submit">保存</button>
        </form>
      )}

      {act.msg && <div className={act.msg.startsWith('操作失败') ? 'notice err' : 'notice ok'}>{act.msg}</div>}
      {invoke && <div className="notice ok">{invoke}</div>}
      {skillDetail && <div className="notice ok">{skillDetail}</div>}
      {tab === 'a2a' && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            let args: any = {}
            try {
              args = JSON.parse(a2aArgs || '{}')
            } catch {
              setSkillDetail('A2A 参数不是合法 JSON')
              return
            }
            act.run(async () => {
              const res = await API.a2aInvoke(a2aTool, args, role)
              setSkillDetail(`A2A 调用完成：${JSON.stringify(res).slice(0, 260)}`)
            })
          }}
        >
          <label>工具<input value={a2aTool} onChange={(e) => setA2aTool(e.target.value)} required placeholder="capability/name" /></label>
          <label>参数 (JSON)<input value={a2aArgs} onChange={(e) => setA2aArgs(e.target.value)} /></label>
          <button className="btn primary" disabled={act.busy} type="submit">调用</button>
        </form>
      )}
      {tab === 'fastpath' && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            act.run(async () => {
              const res = await API.fastpathGenerate(fpQuery, role)
              setInvoke(`生成完成：${JSON.stringify(res).slice(0, 220)}`)
            })
          }}
        >
          <label>查询描述<input value={fpQuery} onChange={(e) => setFpQuery(e.target.value)} required placeholder="例：需要从 CSV 提取并聚合" /></label>
          <button className="btn primary" disabled={act.busy} type="submit">生成</button>
        </form>
      )}
      {tab === 'tools' && <ExternalToolsPanel role={role} />}
      {tab === 'skills' && <ExternalSkillCandidates />}
      {tab === 'mcps' && <ExternalMcpCandidates role={role} />}
      {body}
      {tab === 'a2a' && <A2ATasks />}
    </Panel>
  )
}
