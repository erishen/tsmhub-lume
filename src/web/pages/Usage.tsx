// src/web/pages/Usage.tsx — 用量页
import { useState } from 'react'
import API from '../api'
import { useAction, useLoad } from '../hooks'
import { AggCards, ErrorBox, Panel, Spinner, Table } from '../components'
import { arr, fmtCost, fmtNum, g, num } from '../utils'

export function UsagePage({ role }: { role: string }) {
  const [days, setDays] = useState(7)
  const { data, error, loading, reload } = useLoad<any>(() => API.usage(days), [days])
  const act = useAction(role)
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const byDay = arr(data, 'days', 'daily')
  const byModel = arr(data, 'models', 'by_model')
  const byKey = arr(data, 'keys', 'by_key')
  // /api/usage 的 models/keys 是 {model, usage:{...}} 嵌套，提取出用量聚合本身。
  const aggOf = (r: any) => (r && typeof r === 'object' && g(r, 'usage')) || r || {}

  return (
    <>
      <Panel title="用量统计" extra={
        <div className="row-actions">
          <select value={days} onChange={(e) => setDays(num(e.target.value, 7))}>
            {[7, 14, 30, 90].map((d) => <option key={d} value={d}>近 {d} 天</option>)}
          </select>
          <button
            className="btn sm danger"
            disabled={act.busy}
            onClick={() => {
              if (window.confirm('清空全部用量统计？此操作不可逆。'))
                act.run(() => API.clearUsage(role), reload)
            }}
          >
            清空用量
          </button>
        </div>
      }>
        {act.msg && <div className={act.msg.startsWith('操作失败') ? 'notice err' : 'notice ok'}>{act.msg}</div>}
        <AggCards agg={data?.total || data} />
      </Panel>
      <Panel title="按天">
        <Table
          columns={[
            { title: '日期', render: (r) => String(g(r, 'date', g(r, 'day', '—'))) },
            { title: '请求', render: (r) => fmtNum(g(r, 'requests')) },
            { title: 'Prompt', render: (r) => fmtNum(g(r, 'prompt_tokens')) },
            { title: 'Completion', render: (r) => fmtNum(g(r, 'completion_tokens')) },
            { title: '成本', render: (r) => fmtCost(g(r, 'cost_usd')) },
          ]}
          rows={byDay}
        />
      </Panel>
      <Panel title="按模型">
        <Table
          columns={[
            { title: '模型', render: (r) => <code>{String(g(r, 'model', '—'))}</code> },
            { title: '请求', render: (r) => fmtNum(g(aggOf(r), 'requests')) },
            { title: 'Tokens', render: (r) => fmtNum(g(aggOf(r), 'total_tokens', g(aggOf(r), 'tokens'))) },
            { title: '成本', render: (r) => fmtCost(g(aggOf(r), 'cost_usd')) },
          ]}
          rows={byModel}
        />
      </Panel>
      <Panel title="按 Key">
        <Table
          columns={[
            { title: 'Key', render: (r) => String(g(r, 'name', g(r, 'key_id', '—'))) },
            { title: '请求', render: (r) => fmtNum(g(aggOf(r), 'requests')) },
            { title: 'Tokens', render: (r) => fmtNum(g(aggOf(r), 'total_tokens', g(aggOf(r), 'tokens'))) },
            { title: '成本', render: (r) => fmtCost(g(aggOf(r), 'cost_usd')) },
          ]}
          rows={byKey}
        />
      </Panel>
    </>
  )
}
